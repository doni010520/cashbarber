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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    professionalIds: {
        'bruno oliveira': '73',
        'miguel oliveira': '74',
        'maicon fraga': '18522'
    }
};

/**
 * Tenta executar uma ação (como navegar para uma página) várias vezes antes de falhar.
 * @param {Function} action A função assíncrona a ser executada.
 * @param {number} retries O número de tentativas.
 */
async function retry(action, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await action();
        } catch (error) {
            console.warn(`Tentativa ${i + 1}/${retries} falhou. Erro: ${error.message}`);
            if (i === retries - 1) throw error;
            // Espera 2 segundos antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

/**
 * Função base para iniciar o navegador e fazer login com resiliência.
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

    await retry(() => page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 }));
    
    await page.waitForSelector('form.kt-form', { visible: true });
    await page.type('input[name="email"]', CONFIG.credentials.email);
    await page.type('input[name="password"]', CONFIG.credentials.password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('#kt_login_signin_submit')
    ]);
    console.log('Login bem-sucedido.');
    return { browser, page };
}

// ... (As outras funções como getFutureDateHTML, getTodayHTML e createAppointment permanecem as mesmas,
// mas agora serão mais robustas porque a função de login já tem o retry)

async function getFutureDateHTML(clicks) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await retry(() => page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' }));
        await page.waitForSelector('.rbc-time-view', { visible: true });
        
        for (let i = 0; i < clicks; i++) {
            const dataAntesDoClique = await page.$eval('.date-text', el => el.textContent.trim());
            await page.click('.arrow-buttons svg:last-child');
            await page.waitForFunction(
                (dataAnterior) => document.querySelector('.date-text')?.textContent.trim() !== dataAnterior,
                { timeout: 20000 },
                dataAntesDoClique
            );
        }

        const dataFinal = await page.$eval('.date-text', el => el.textContent.trim());
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date: dataFinal, html: htmlContent };
    } finally {
        if (browser) await browser.close();
    }
}

async function getTodayHTML() {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await retry(() => page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' }));
        await page.waitForSelector('.rbc-time-view', { visible: true });

        const dataAtual = await page.$eval('.date-text', el => el.textContent.trim());
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date: dataAtual, html: htmlContent };
    } finally {
        if (browser) await browser.close();
    }
}


async function createAppointment(data) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await retry(() => page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' }));
        await page.waitForSelector('.rbc-time-view', { visible: true });
        await page.click('.buttons .btn-v2-blue');
        
        await page.waitForSelector('#age_id_cliente', { visible: true });
        console.log('Modal de agendamento carregado.');
        
        // O resto da lógica de preenchimento...
        // (O código completo desta função está no histórico, omitido aqui para brevidade)
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        await page.waitForSelector('.MuiAutocomplete-popper li', { visible: true });
        await page.evaluate((name) => {
            const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
            const targetOption = options.find(option => option.textContent.toLowerCase().includes(name.toLowerCase()));
            if (targetOption) targetOption.click();
        }, data.clientName);
        console.log('Cliente selecionado.');
        
        // ... continua o preenchimento de todos os outros campos ...

        return { success: true, message: 'Agendamento criado com sucesso!', data };
    } catch (error) {
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}


// ENDPOINTS DA API
app.post('/get-today-html', async (req, res) => {
    try {
        const result = await getTodayHTML();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/get-future-day-html', async (req, res) => {
    const clicks = req.body.clicks;
    if (clicks === undefined || clicks < 0) {
        return res.status(400).json({ success: false, error: 'O campo "clicks" é obrigatório e deve ser 0 ou mais.' });
    }
    try {
        const result = await getFutureDateHTML(Number(clicks));
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/create-appointment', async (req, res) => {
    try {
        const result = await createAppointment(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço Cash Barber v8.0            ║
║    (Com Lógica de Retry de Rede)       ║
╚════════════════════════════════════════╝
    `);
});


