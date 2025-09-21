const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const axios = require('axios');

// Aplica o Modo Stealth para tornar o Puppeteer indetetável
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
    // A URL base para as chamadas de API que descobrimos
    apiUrl: 'https://api.cashberber.com.br/api/painel',
    // A URL da página de login
    loginUrl: 'https://painel.cashbarber.com.br',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    },
};

// Um cache simples para guardar o token e evitar logins repetidos a cada chamada
let authTokenCache = { token: null, expires: 0 };

/**
 * Usa o Puppeteer apenas uma vez para fazer login e capturar o Token de Autenticação.
 * Reutiliza o token se ainda for válido para otimizar o processo.
 */
async function getAuthToken() {
    // Se o token em cache ainda for válido, reutiliza-o
    if (authTokenCache.token && authTokenCache.expires > Date.now()) {
        console.log('A usar o token de autenticação em cache.');
        return authTokenCache.token;
    }
    
    console.log('A iniciar o navegador para capturar um novo token...');
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        let token = null;

        // "Ouve" as respostas da rede para encontrar a que contém o token de login
        page.on('response', async (response) => {
            if (response.url().includes('/api/auth/login') && response.ok()) {
                const jsonResponse = await response.json();
                if (jsonResponse.access_token) {
                    token = jsonResponse.access_token;
                }
            }
        });

        // Processo de login
        await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('form.kt-form');
        await page.type('input[name="email"]', CONFIG.credentials.email);
        await page.type('input[name="password"]', CONFIG.credentials.password);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#kt_login_signin_submit')
        ]);

        // Aguarda a captura do token
        await new Promise((resolve, reject) => {
            let attempts = 0;
            const interval = setInterval(() => {
                if (token) {
                    clearInterval(interval);
                    resolve();
                } else if (attempts > 20) { // Timeout de 10 segundos
                    clearInterval(interval);
                    reject(new Error('Não foi possível capturar o token após o login.'));
                }
                attempts++;
            }, 500);
        });

        // Guarda o novo token em cache por 50 minutos
        authTokenCache = { token, expires: Date.now() + 50 * 60 * 1000 };
        console.log('Novo token capturado e guardado em cache.');
        return token;

    } finally {
        if (browser) await browser.close();
    }
}

// FERRAMENTA 1: Encontrar o ID do cliente pelo nome
app.post('/find-client', async (req, res) => {
    const { clientName } = req.body;
    if (!clientName) return res.status(400).json({ success: false, error: 'O nome do cliente é obrigatório.' });

    try {
        const token = await getAuthToken();
        const response = await axios.post(`${CONFIG.apiUrl}/clientes/simpleList`, 
            { termo: clientName },
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        
        const clients = response.data;
        if (clients.length === 0) {
            return res.status(404).json({ success: false, error: `Nenhum cliente encontrado com o nome "${clientName}".` });
        }
        
        console.log(`Cliente encontrado: ${clients[0].cli_name} (ID: ${clients[0].id})`);
        res.json({ success: true, client: clients[0] });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FERRAMENTA 2: Encontrar IDs de serviços pelo nome
app.post('/find-services', async (req, res) => {
    const { professionalId, serviceNames } = req.body;
    if (!professionalId || !serviceNames || !Array.isArray(serviceNames)) {
        return res.status(400).json({ success: false, error: 'professionalId e uma lista de serviceNames são obrigatórios.' });
    }

    try {
        const token = await getAuthToken();
        // Chama a API que lista todos os serviços de um profissional
        const response = await axios.post(`${CONFIG.apiUrl}/usuarios/servicos/${professionalId}`, {}, {
             headers: { 'Authorization': `Bearer ${token}` } 
        });

        const allServices = response.data;
        // "Traduz" os nomes dos serviços para os seus IDs
        const foundServices = serviceNames.map(nameToFind => {
            const found = allServices.find(s => s.ser_nome.toLowerCase() === nameToFind.toLowerCase());
            return found ? { id: found.id, name: found.ser_nome } : null;
        }).filter(Boolean);

        if (foundServices.length !== serviceNames.length) {
             return res.status(404).json({ success: false, error: 'Um ou mais serviços não foram encontrados para este profissional.' });
        }
        
        console.log('Serviços encontrados:', foundServices);
        res.json({ success: true, services: foundServices });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FERRAMENTA 3: Criar o agendamento via API
app.post('/create-appointment-api', async (req, res) => {
    const { clientId, professionalId, serviceIds, date, startTime, totalDuration, filialId = 22 } = req.body;

    try {
        const token = await getAuthToken();
        
        // Calcula a hora de fim
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const startDate = new Date(`${date}T${startTime}:00`);
        const endDate = new Date(startDate.getTime() + totalDuration * 60000);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;

        // Monta o payload (dados) exatamente como a API espera
        const payload = {
            age_id_cliente: clientId,
            age_id_user: professionalId,
            age_inicio: `${date} ${startTime}`,
            age_fim: `${date} ${endTime}`,
            age_id_filial: filialId,
            age_tipo: 'Agendamento',
            servicos: serviceIds
        };
        
        console.log('A enviar payload de agendamento:', payload);
        const response = await axios.post(`${CONFIG.apiUrl}/agendamentos`, payload, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        res.json({ success: true, message: 'Agendamento criado com sucesso via API!', data: response.data });

    } catch (error) {
        const errorMessage = error.response?.data?.errors?.[0] || error.message;
        console.error("ERRO AO CRIAR AGENDAMENTO VIA API:", errorMessage);
        res.status(500).json({ success: false, error: `Falha ao criar agendamento: ${errorMessage}` });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço de API Cash Barber (vFINAL) ║
║    - /find-client                      ║
║    - /find-services                    ║
║    - /create-appointment-api           ║
╚════════════════════════════════════════╝
    `);
});

