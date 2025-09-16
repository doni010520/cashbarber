const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

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
 * Função base para iniciar o navegador e fazer login.
 */
async function startBrowserAndLogin() {
    console.log('Iniciando navegador e fazendo login...');
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('form.kt-form', { visible: true, timeout: 15000 });
    await page.type('input[name="email"]', CONFIG.credentials.email);
    await page.type('input[name="password"]', CONFIG.credentials.password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('#kt_login_signin_submit')
    ]);
    console.log('Login bem-sucedido.');
    return { browser, page };
}

/**
 * Extrai o HTML da agenda do dia ATUAL.
 */
async function getTodayHTML() {
    let browser;
    try {
        const { page: loggedInPage, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance; // Para garantir que o browser seja fechado no finally

        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        await loggedInPage.goto(agendaUrl, { waitUntil: 'networkidle2' });
        await loggedInPage.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });

        const dataAtual = await loggedInPage.$eval('.date-text', el => el.textContent.trim());
        console.log(`Página carregada com a data de hoje: ${dataAtual}`);

        const htmlContent = await loggedInPage.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date: dataAtual, html: htmlContent };

    } catch (error) {
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Clica N vezes para avançar e extrai o HTML do dia futuro.
 * @param {number} clicks - O número de vezes para clicar.
 */
async function getFutureDayHTML(clicks) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        await page.goto(agendaUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        
        for (let i = 0; i < clicks; i++) {
            const dataAntesDoClique = await page.$eval('.date-text', el => el.textContent.trim());
            console.log(`Avançando do dia '${dataAntesDoClique}'... (Clique ${i + 1}/${clicks})`);
            await page.click('.arrow-buttons svg:last-child');
            await page.waitForFunction(
                (dataAnterior) => document.querySelector('.date-text')?.textContent.trim() !== dataAnterior,
                { timeout: 20000 },
                dataAntesDoClique
            );
        }

        const dataFinal = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Data final alcançada: ${dataFinal}`);

        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date: dataFinal, html: htmlContent };
    } catch (error) {
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// Endpoint para HOJE
app.post('/get-today-html', async (req, res) => {
    try {
        const result = await getTodayHTML();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint para DIAS FUTUROS
app.post('/get-future-day-html', async (req, res) => {
    const clicks = req.body.clicks;
    if (clicks === undefined || clicks < 1) {
        return res.status(400).json({ success: false, error: 'O campo "clicks" é obrigatório e deve ser 1 ou mais.' });
    }
    try {
        const result = await getFutureDayHTML(Number(clicks));
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço de Extração de HTML (v5.5)  ║
║    Endpoints:                          ║
║      - POST /get-today-html            ║
║      - POST /get-future-day-html       ║
╚════════════════════════════════════════╝
    `);
});
