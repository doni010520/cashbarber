const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const axios = require('axios');

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
    apiUrl: 'https://api.cashberber.com.br/api/painel',
    loginUrl: 'https://painel.cashbarber.com.br',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    },
};

let authTokenCache = { token: null, expires: 0 };

/**
 * Usa o Puppeteer para fazer login e capturar o Token.
 * Inclui logs de diagnóstico e screenshot em caso de falha.
 */
async function getAuthToken() {
    if (authTokenCache.token && authTokenCache.expires > Date.now()) {
        console.log('A usar o token de autenticação em cache.');
        return authTokenCache.token;
    }
    
    console.log('A iniciar o navegador para capturar um novo token...');
    let browser;
    let page;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();
        
        let token = null;
        let loginApiUrlFound = false;

        // Listener de diagnóstico: "ouve" todas as respostas da rede
        page.on('response', async (response) => {
            const url = response.url();
            // Verifica se é uma resposta de API (JSON)
            if (url.includes('/api/')) {
                console.log(`[LOG DE REDE] Resposta de API recebida de: ${url}`);
                if (url.includes('/auth/login') && response.ok()) {
                    loginApiUrlFound = true;
                    const jsonResponse = await response.json();
                    if (jsonResponse.access_token) {
                        token = jsonResponse.access_token;
                    } else {
                         console.warn('[LOG DE REDE] Resposta de login encontrada, mas sem "access_token".');
                    }
                }
            }
        });

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
                } else if (attempts > 30) { // Timeout de 15 segundos
                    clearInterval(interval);
                    if (!loginApiUrlFound) {
                        reject(new Error('A chamada à API de login não foi detetada. Verifique os logs de rede.'));
                    } else {
                        reject(new Error('Não foi possível capturar o token após o login. Verifique o screenshot "login_falhou.png".'));
                    }
                }
                attempts++;
            }, 500);
        });

        authTokenCache = { token, expires: Date.now() + 50 * 60 * 1000 };
        console.log('Novo token capturado e guardado em cache.');
        return token;

    } catch (error) {
        // Se a promessa for rejeitada, tira um screenshot antes de falhar
        console.error('ERRO NA CAPTURA DO TOKEN. A tirar screenshot de diagnóstico...');
        if (page) {
            await page.screenshot({ path: 'login_falhou.png', fullPage: true });
            console.log('Screenshot "login_falhou.png" salvo. Por favor, verifique a imagem para ver se há mensagens de erro na tela.');
        }
        throw error; // Re-lança o erro original
    } finally {
        if (browser) await browser.close();
    }
}

// ENDPOINTS (sem alterações)
app.post('/find-client', async (req, res) => {
    try {
        const { clientName } = req.body;
        const token = await getAuthToken();
        const response = await axios.post(`${CONFIG.apiUrl}/clientes/simpleList`, { termo: clientName }, { headers: { 'Authorization': `Bearer ${token}` } });
        res.json({ success: true, client: response.data[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/find-services', async (req, res) => {
    try {
        const { professionalId, serviceNames } = req.body;
        const token = await getAuthToken();
        const response = await axios.post(`${CONFIG.apiUrl}/usuarios/servicos/${professionalId}`, {}, { headers: { 'Authorization': `Bearer ${token}` } });
        const allServices = response.data;
        const foundServices = serviceNames.map(name => allServices.find(s => s.ser_nome.toLowerCase() === name.toLowerCase())).filter(Boolean).map(s => ({ id: s.id, name: s.ser_nome }));
        res.json({ success: true, services: foundServices });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/create-appointment-api', async (req, res) => {
    try {
        const { clientId, professionalId, serviceIds, date, startTime, totalDuration, filialId = 22 } = req.body;
        const token = await getAuthToken();
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const startDate = new Date(`${date}T${startTime}:00`);
        const endDate = new Date(startDate.getTime() + totalDuration * 60000);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        const payload = {
            age_id_cliente: clientId,
            age_id_user: professionalId,
            age_inicio: `${date} ${startTime}`,
            age_fim: `${date} ${endTime}`,
            age_id_filial: filialId,
            age_tipo: 'Agendamento',
            servicos: serviceIds
        };
        const response = await axios.post(`${CONFIG.apiUrl}/agendamentos`, payload, { headers: { 'Authorization': `Bearer ${token}` } });
        res.json({ success: true, message: 'Agendamento criado com sucesso via API!', data: response.data });
    } catch (error) {
        const errorMessage = error.response?.data?.errors?.[0] || error.message;
        res.status(500).json({ success: false, error: `Falha ao criar agendamento: ${errorMessage}` });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço de API Cash Barber (vFINAL-DIAG) ║
╚════════════════════════════════════════╝
    `);
});

