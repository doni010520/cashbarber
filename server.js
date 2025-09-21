const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

// Aplica o Modo Stealth para tornar o robô indetectável
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// --- Configurações Centralizadas ---
const CONFIG = {
    baseUrl: 'https://painel.cashbarber.com.br',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    // Mapeia o nome do profissional (em minúsculas) para o ID no formulário
    professionalIds: {
        'bruno oliveira': '73',
        'miguel oliveira': '74',
        'maicon fraga': '18522'
    }
};

/**
 * Função base para iniciar o navegador, aplicar o modo stealth e fazer login.
 * Reutilizada por todas as outras funções.
 * @returns {Promise<{browser: puppeteer.Browser, page: puppeteer.Page}>}
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

/**
 * Extrai o HTML da agenda do dia ATUAL.
 */
async function getTodayHTML() {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true });
        const date = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Página de hoje carregada: ${date}`);
        const html = await page.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date, html };
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

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true });

        for (let i = 0; i < clicks; i++) {
            const dataAntes = await page.$eval('.date-text', el => el.textContent.trim());
            console.log(`Avançando do dia '${dataAntes}'... (Clique ${i + 1}/${clicks})`);
            await page.click('.arrow-buttons svg:last-child');
            await page.waitForFunction(
                (dataAnterior) => document.querySelector('.date-text')?.textContent.trim() !== dataAnterior,
                { timeout: 20000 },
                dataAntes
            );
        }

        const date = await page.$eval('.date-text', el => el.textContent.trim());
        console.log(`Data final alcançada: ${date}`);
        const html = await page.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date, html };
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * NOVA FUNÇÃO: Cria um agendamento no sistema.
 * @param {object} data - Contém os dados do agendamento.
 */
async function createAppointment(data) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.buttons .btn-v2-blue');
        await page.click('.buttons .btn-v2-blue'); // Botão "Novo agendamento"
        await page.waitForSelector('.modal-dialog', { visible: true });
        console.log('Modal de agendamento aberto.');

        // 1. Cliente
        console.log(`Buscando cliente: ${data.clientName}`);
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        const suggestionSelector = '.MuiAutocomplete-popper li';
        await page.waitForSelector(suggestionSelector, { visible: true });
        await page.evaluate((name) => {
            const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
            const target = options.find(opt => opt.textContent.toLowerCase().includes(name.toLowerCase()));
            if (target) target.click();
        }, data.clientName);
        console.log('Cliente selecionado.');

        // 2. Data e Horários
        const [startHour, startMinute] = data.startTime.split(':').map(Number);
        const endDate = new Date(new Date().setHours(startHour, startMinute, 0) + (data.totalDuration * 60000));
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        await page.type('input[name="age_data"]', data.date);
        await page.type('input[name="age_inicio"]', data.startTime);
        await page.type('input[name="age_fim"]', endTime);
        console.log(`Data e horários preenchidos: ${data.date} das ${data.startTime} às ${endTime}`);
        
        // 3. Profissional
        const professionalId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        if (!professionalId) throw new Error(`ID do profissional "${data.professionalName}" não encontrado.`);
        await page.select('div.modal-body > div > div:nth-child(7) > div > div > div > select', professionalId);
        console.log(`Profissional selecionado: ${data.professionalName}`);

        // 4. Serviços (em loop)
        for (const serviceName of data.services) {
            console.log(`Adicionando serviço: ${serviceName}`);
            await page.type('#id_usuario_servico', serviceName, { delay: 100 });
            await page.waitForSelector(suggestionSelector, { visible: true });
            await page.evaluate((name) => {
                const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
                const target = options.find(opt => opt.textContent.toLowerCase().includes(name.toLowerCase()));
                if (target) target.click();
            }, serviceName);
            await page.click('.col-sm-1 .btn'); // Botão "+"
            await page.waitForTimeout(500);
        }
        console.log('Todos os serviços foram adicionados.');

        // 5. Salvar
        await page.click('button[type="submit"]');
        console.log('Clicou em "Salvar agendamento".');

        // 6. Esperar confirmação
        await page.waitForSelector('.modal-dialog', { hidden: true, timeout: 15000 });
        console.log('Agendamento criado com sucesso!');

        return { success: true, message: 'Agendamento criado com sucesso!', data };
    } catch (error) {
        console.error('ERRO AO CRIAR AGENDAMENTO:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}


// --- ENDPOINTS DA API ---

app.post('/get-today-html', async (req, res) => {
    try {
        const result = await getTodayHTML();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/get-future-day-html', async (req, res) => {
    const clicks = req.body.clicks === undefined ? 0 : Number(req.body.clicks);
    try {
        const result = await getFutureDayHTML(clicks);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/create-appointment', async (req, res) => {
    const data = req.body;
    if (!data.clientName || !data.professionalName || !data.date || !data.startTime || !data.services || !data.totalDuration) {
        return res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes.' });
    }
    try {
        const result = await createAppointment(data);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço de Automação Cash Barber    ║
║    (v6.0 - Busca e Criação)            ║
╚════════════════════════════════════════╝
    `);
});

