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

        // 2. Navegar para a página de agendamentos
        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        console.log(`Navegando para a página de agendamentos: ${agendaUrl}`);
        await page.goto(agendaUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        
        // Armazena o texto da data inicial
        const dataInicial = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Página carregada com a data inicial: ${dataInicial}`);

        // 3. Clicar para avançar o dia
        console.log('Clicando na seta para avançar o dia...');
        const nextDayButtonSelector = '.arrow-buttons svg:last-child';
        await page.waitForSelector(nextDayButtonSelector, { visible: true });
        await page.click(nextDayButtonSelector);

        // 4. ESPERA INTELIGENTE: Aguarda a data na tela mudar
        console.log('Aguardando a atualização da data na tela...');
        await page.waitForFunction(
            (dataAnterior) => {
                const dataAtual = document.querySelector('.date-text')?.textContent.trim();
                // Retorna true quando a data for diferente da anterior
                return dataAtual && dataAtual !== dataAnterior;
            },
            { timeout: 15000 }, // Timeout de 15 segundos
            dataInicial // Passa a data inicial como argumento para a função
        );

        const dataFinal = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Nova data carregada com sucesso: ${dataFinal}`);

        // 5. Extrair o HTML completo
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

// Endpoint da API
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
║     (v5.1 - Espera Inteligente)        ║
║     Endpoint: POST /get-next-day-html  ║
╚════════════════════════════════════════╝
    `);
});
