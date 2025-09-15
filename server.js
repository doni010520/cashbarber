const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const axios = require('axios'); // Necessário para a chamada de API

// Aplica o modo Stealth para o Puppeteer
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
    baseUrl: 'https://painel.cashbarber.com.br',
    apiUrl: 'https://api.cashbarber.com.br/api/painel/comandas/simpleListComandasAgenda',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    }
};

/**
 * Usa o navegador apenas para fazer login e capturar o token de autorização.
 * @returns {Promise<string>} O token de acesso.
 */
async function getAuthToken() {
    console.log('Iniciando navegador para capturar token...');
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        let authToken = null;

        // Prepara um "ouvinte" para interceptar a resposta da rede que contém o token
        page.on('response', async (response) => {
            if (response.url().includes('/api/auth/login') && response.ok()) {
                const jsonResponse = await response.json();
                if (jsonResponse.access_token) {
                    authToken = jsonResponse.access_token;
                    console.log('Token de acesso capturado com sucesso!');
                }
            }
        });

        // Executa o processo de login
        await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('form.kt-form', { visible: true });
        await page.type('input[name="email"]', CONFIG.credentials.email);
        await page.type('input[name="password"]', CONFIG.credentials.password);
        await page.click('#kt_login_signin_submit');

        // Aguarda o token ser capturado (com um tempo limite para evitar loops infinitos)
        await new Promise((resolve, reject) => {
            let attempts = 0;
            const interval = setInterval(() => {
                if (authToken) {
                    clearInterval(interval);
                    resolve(authToken);
                } else if (attempts > 20) { // Timeout de 10 segundos
                    clearInterval(interval);
                    reject(new Error('Não foi possível capturar o token após o login.'));
                }
                attempts++;
            }, 500);
        });

        return authToken;

    } finally {
        if (browser) await browser.close();
        console.log('Navegador fechado.');
    }
}

/**
 * Busca os dados da agenda diretamente da API.
 * @param {string} token - O token de autenticação.
 * @param {string} date - A data no formato YYYY-MM-DD.
 * @param {number} filialId - O ID da filial.
 */
async function fetchScheduleFromAPI(token, date, filialId) {
    console.log(`Buscando dados da API para a filial ${filialId} no dia ${date}...`);

    const payload = {
        com_id_filial: filialId,
        date: `${date} 00:00:00`
    };

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    try {
        const response = await axios.post(CONFIG.apiUrl, payload, { headers });
        return { success: true, date: date, filialId: filialId, data: response.data };
    } catch (error) {
        console.error('Erro ao chamar a API:', error.response?.data || error.message);
        throw new Error('Falha ao buscar dados da API do Cash Barber.');
    }
}

// Endpoint principal da API
app.post('/get-schedule', async (req, res) => {
    const { date, filialId } = req.body;
    if (!date || !filialId) {
        return res.status(400).json({ success: false, error: 'Os campos "date" (YYYY-MM-DD) e "filialId" são obrigatórios.' });
    }

    try {
        const token = await getAuthToken();
        const scheduleData = await fetchScheduleFromAPI(token, date, filialId);
        res.json(scheduleData);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço de API Cash Barber (v4.0)   ║
║    Endpoint: POST /get-schedule        ║
║    Rodando na porta ${PORT}                  ║
╚════════════════════════════════════════╝
    `);
});
