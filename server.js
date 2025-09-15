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
 * Função principal que navega para o próximo dia e extrai o HTML
 */
async function getNextDayHTML() {
    let browser;
    try {
        console.log('Iniciando navegador em modo stealth...');
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
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

        // 2. Navegar para a página de agendamentos (vai carregar o dia de hoje)
        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        console.log(`Navegando para a página de agendamentos: ${agendaUrl}`);
        await page.goto(agendaUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        
        const dataInicial = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Página carregada com a data inicial: ${dataInicial}`);

        // 3. Clicar no botão para avançar para o próximo dia
        console.log('Clicando na seta para avançar o dia...');
        const nextDayButtonSelector = '.arrow-buttons svg:last-child';
        await page.waitForSelector(nextDayButtonSelector, { visible: true });
        await page.click(nextDayButtonSelector);

        // 4. Esperar a agenda recarregar após o clique
        console.log('Aguardando a agenda do próximo dia carregar...');
        await page.waitForNetworkIdle({ timeout: 10000 });

        const dataFinal = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Nova data carregada: ${dataFinal}`);

        // 5. Extrair o HTML completo da página final
        console.log('Extraindo o código HTML...');
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        
        console.log('HTML extraído com sucesso.');
        return { success: true, date: dataFinal, html: htmlContent };

    } catch (error) {
        console.error('ERRO DURANTE O PROCESSO:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('Navegador fechado.');
        }
    }
}

// Endpoint da API para executar a ação
app.post('/get-next-day-html', async (req, res) => {
    try {
        const result = await getNextDayHTML();
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
║     (Avançar 1 dia)                    ║
║     Endpoint: POST /get-next-day-html  ║
╚════════════════════════════════════════╝
    `);
});
