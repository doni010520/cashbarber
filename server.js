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
 * Clica N vezes para avançar os dias e extrai o HTML final.
 * @param {number} clicks - O número de vezes para clicar em 'próximo dia'.
 */
async function getFutureDateHTML(clicks = 0) {
    let browser;
    try {
        console.log(`Iniciando navegador para avançar ${clicks} dia(s)...`);
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
        await page.goto(agendaUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        console.log(`Página da agenda carregada no dia atual.`);

        // 3. Loop para clicar e avançar os dias
        for (let i = 0; i < clicks; i++) {
            const dataAntesDoClique = await page.$eval('.date-text', el => el.textContent.trim());
            console.log(`Avançando do dia '${dataAntesDoClique}'... (Clique ${i + 1}/${clicks})`);

            const nextDayButtonSelector = '.arrow-buttons svg:last-child';
            await page.click(nextDayButtonSelector);

            // Espera inteligente: aguarda a data na tela mudar
            await page.waitForFunction(
                (dataAnterior) => {
                    const dataAtual = document.querySelector('.date-text')?.textContent.trim();
                    return dataAtual && dataAtual !== dataAnterior;
                },
                { timeout: 20000 },
                dataAntesDoClique
            );
        }

        const dataFinal = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Data final alcançada: ${dataFinal}`);

        // 4. Extrair o HTML final
        console.log('Extraindo o código HTML...');
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        
        console.log('HTML extraído com sucesso.');
        return { success: true, date: dataFinal, html: htmlContent };

    } catch (error) {
        console.error('ERRO DURANTE O PROCESSO:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// Endpoint da API
app.post('/get-html-by-clicks', async (req, res) => {
    // Pega o número de cliques do corpo da requisição. Se não vier, usa 0 (dia atual).
    const clicks = req.body.clicks === undefined ? 0 : Number(req.body.clicks);

    try {
        const result = await getFutureDateHTML(clicks);
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
║     (v5.4 - Cliques Dinâmicos)         ║
║     Endpoint: POST /get-html-by-clicks ║
╚════════════════════════════════════════╝
    `);
});
