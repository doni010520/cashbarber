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
    baseUrl: 'https://painel.cashberber.com.br',
    apiUrl: 'https://api.cashberber.com.br/api/painel/comandas/simpleListComandasAgenda',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    }
};

/**
 * Usa o Puppeteer para fazer login e capturar o Token de Autenticação.
 * Esta versão tem logs de diagnóstico adicionais.
 */
async function getAuthToken() {
    console.log('Iniciando navegador para capturar token...');
    let browser;
    let page; // Declarar a page aqui para ser acessível no catch
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();

        let authToken = null;
        
        // Listener de diagnóstico: loga todas as respostas JSON
        page.on('response', async (response) => {
            const url = response.url();
            if (response.headers()['content-type']?.includes('application/json')) {
                console.log(`[LOG DE REDE] Resposta JSON recebida de: ${url}`);
                if (url.includes('/api/auth/login') && response.ok()) {
                    const jsonResponse = await response.json();
                    if (jsonResponse.access_token) {
                        authToken = jsonResponse.access_token;
                        console.log('TOKEN DE ACESSO CAPTURADO!');
                    } else {
                        console.log('[LOG DE REDE] Resposta de login encontrada, mas sem "access_token". Conteúdo:', jsonResponse);
                    }
                }
            }
        });

        // Processo de login
        await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('form.kt-form', { visible: true });
        await page.type('input[name="email"]', CONFIG.credentials.email);
        await page.type('input[name="password"]', CONFIG.credentials.password);
        await page.click('#kt_login_signin_submit');

        // Aguarda o token ser capturado (com tempo de espera maior)
        await new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 60; // Timeout de 30 segundos (60 * 500ms)
            const interval = setInterval(() => {
                if (authToken) {
                    clearInterval(interval);
                    resolve(authToken);
                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    // O erro que você viu é gerado aqui
                    reject(new Error('Não foi possível capturar o token após o login.'));
                }
                attempts++;
            }, 500);
        });

        return authToken;

    } catch (error) {
        // Se o token não for encontrado, tira um screenshot antes de falhar
        if (page) {
            console.log('Erro na captura do token, salvando screenshot de diagnóstico...');
            await page.screenshot({ path: 'login_falhou.png' });
            console.log('Screenshot "login_falhou.png" salvo.');
        }
        throw error; // Re-lança o erro original
    } finally {
        if (browser) await browser.close();
        console.log('Navegador fechado.');
    }
}

async function fetchScheduleFromAPI(token, date, filialId) {
    console.log(`Buscando dados da API para a filial ${filialId} no dia ${date}...`);
    const payload = { com_id_filial: filialId, date: `${date} 00:00:00` };
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    try {
        const response = await axios.post(CONFIG.apiUrl, payload, { headers });
        return { success: true, date: date, filialId: filialId, data: response.data };
    } catch (error) {
        console.error('Erro ao chamar a API:', error.response?.data || error.message);
        throw new Error('Falha ao buscar dados da API do Cash Barber.');
    }
}

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
║    Serviço de API Cash Barber (v4.1)   ║
║    (Modo Detetive)                     ║
║    Endpoint: POST /get-schedule        ║
╚════════════════════════════════════════╝
    `);
});
