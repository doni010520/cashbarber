const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

// Aplica o Modo Stealth para evitar a detecção de robôs
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
 * Função base para iniciar o navegador e fazer o login.
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
 * Clica N vezes para avançar os dias e extrai o HTML final.
 * @param {number} clicks - O número de cliques para avançar.
 */
async function getFutureDateHTML(clicks) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true });
        console.log(`Página da agenda carregada no dia atual.`);

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
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Cria um agendamento no sistema.
 * @param {object} data - Os dados do agendamento.
 */
async function createAppointment(data) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.buttons .btn-v2-blue');
        await page.click('.buttons .btn-v2-blue');
        
        await page.waitForSelector('#age_id_cliente', { visible: true, timeout: 15000 });
        console.log('Modal de agendamento carregado.');

        console.log(`Buscando cliente: ${data.clientName}`);
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        await page.waitForSelector('.MuiAutocomplete-popper li', { visible: true });
        await page.evaluate((name) => {
            const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
            const target = options.find(opt => opt.textContent.toLowerCase().includes(name.toLowerCase()));
            if (target) target.click(); else throw new Error(`Cliente "${name}" não encontrado na lista.`);
        }, data.clientName);
        console.log('Cliente selecionado.');
        
        const [h, m] = data.startTime.split(':').map(Number);
        const endDate = new Date(new Date().setHours(h, m, 0, 0) + (data.totalDuration * 60000));
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        await page.type('input[name="age_data"]', data.date);
        await page.type('input[name="age_inicio"]', data.startTime);
        await page.type('input[name="age_fim"]', endTime);
        console.log(`Horários preenchidos: ${data.startTime} - ${endTime}`);

        const profId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        if (!profId) throw new Error(`ID do profissional "${data.professionalName}" não configurado.`);
        await page.evaluate((id) => {
            document.querySelectorAll('.select-v2-label').forEach(label => {
                if (label.textContent.includes('Profissional')) {
                    const select = label.closest('.select-v2').querySelector('select');
                    if (select) {
                        select.value = id;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
        }, profId);
        console.log('Profissional selecionado.');
        
        for (const serviceName of data.services) {
            console.log(`Adicionando serviço: ${serviceName}`);
            await page.type('#id_usuario_servico', serviceName, { delay: 100 });
            await page.waitForSelector('.MuiAutocomplete-popper li', { visible: true });
            await page.evaluate((name) => {
                const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
                const target = options.find(opt => opt.textContent.toLowerCase().includes(name.toLowerCase()));
                if (target) target.click(); else throw new Error(`Serviço "${name}" não encontrado na lista.`);
            }, serviceName);
            await page.click('.col-sm-1 .btn');
            await new Promise(resolve => setTimeout(resolve, 500)); // Pausa para a UI atualizar
        }
        console.log('Serviços adicionados.');
        
        await page.click('button[type="submit"]');
        await page.waitForSelector('.modal-dialog', { hidden: true, timeout: 15000 });
        console.log('Agendamento criado com sucesso!');

        return { success: true, message: 'Agendamento criado com sucesso!', data };
    } finally {
        if (browser) await browser.close();
    }
}

// ==================
// === ENDPOINTS ====
// ==================

app.post('/get-today-html', async (req, res) => {
    try {
        // Chama a função de busca com 0 cliques para pegar o dia de hoje
        const result = await getFutureDateHTML(0);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/get-future-day-html', async (req, res) => {
    const clicks = req.body.clicks;
    if (clicks === undefined || clicks < 1) {
        return res.status(400).json({ success: false, error: 'O campo "clicks" é obrigatório e deve ser 1 ou mais.' });
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
║    Serviço Completo Cash Barber (v7.1)   ║
║    - /get-today-html                   ║
║    - /get-future-day-html              ║
║    - /create-appointment               ║
╚════════════════════════════════════════╝
    `);
});

