const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

// Aplica o Modo Stealth para evitar detecção de robô
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
    baseUrl: 'https://painel.cashbarber.com.br',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
};

/**
 * Função principal que executa a automação para extrair o HTML
 * @param {string} date - Data no formato YYYY-MM-DD
 */
async function getPageHTML(date) {
    let browser;
    try {
        console.log('Iniciando navegador em modo stealth...');
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);

        // 1. Login
        console.log('Realizando login...');
        await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('form.kt-form', { visible: true, timeout: 15000 });
        await page.type('input[name="email"]', CONFIG.credentials.email);
        await page.type('input[name="password"]', CONFIG.credentials.password);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#kt_login_signin_submit')
        ]);
        console.log('Login bem-sucedido.');

        // 2. Navegar para a data correta
        const targetUrl = `${CONFIG.baseUrl}/agendamento?data=${date}`;
        console.log(`Navegando para: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        console.log('Página da agenda carregada.');
        
        // Espera extra opcional para garantir a renderização completa
        await new Promise(resolve => setTimeout(resolve, 2000)); 

        // 3. Extrair o HTML completo da página
        console.log('Extraindo o código HTML...');
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        
        console.log('HTML extraído com sucesso.');
        return { success: true, date: date, html: htmlContent };

    } catch (error) {
        console.error('ERRO DURANTE A EXTRAÇÃO DE HTML:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('Navegador fechado.');
        }
    }
}

// Endpoint da API para executar a extração
app.post('/extract-html', async (req, res) => {
    const { date } = req.body;
    if (!date) {
        return res.status(400).json({ success: false, error: 'A data é obrigatória (formato YYYY-MM-DD)' });
    }

    try {
        const result = await getPageHTML(date);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║     Serviço de Extração de HTML        ║
║     Endpoint: POST /extract-html       ║
║     Rodando na porta ${PORT}                 ║
╚════════════════════════════════════════╝
    `);
});
