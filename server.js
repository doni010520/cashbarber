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

        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        await page.goto(agendaUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true });

        const dataAtual = await page.$eval('.date-text', el => el.textContent.trim());
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        return { success: true, date: dataAtual, html: htmlContent };
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Clica N vezes para avançar e extrai o HTML do dia futuro.
 */
async function getFutureDateHTML(clicks) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        await page.goto(agendaUrl, { waitUntil: 'networkidle2' });
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


/**
 * Cria um agendamento no sistema.
 */
async function createAppointment(data) {
    let browser;
    let page;
    try {
        const { page: loggedInPage, browser: browserInstance } = await startBrowserAndLogin();
        page = loggedInPage;
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.buttons .btn-v2-blue');
        await page.click('.buttons .btn-v2-blue');
        
        await page.waitForSelector('#age_id_cliente', { visible: true });
        console.log('Modal de agendamento carregado.');

        console.log(`Buscando cliente: ${data.clientName}`);
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        await page.waitForSelector('.MuiAutocomplete-popper li', { visible: true });
        await page.click('.MuiAutocomplete-popper li');
        console.log('Cliente selecionado.');
        
        const [startHour, startMinute] = data.startTime.split(':').map(Number);
        const endDate = new Date(new Date().setHours(startHour, startMinute, 0) + (parseInt(data.totalDuration, 10) || 30) * 60000);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        await page.type('input[name="age_data"]', data.date);
        await page.type('input[name="age_inicio"]', data.startTime);
        await page.type('input[name="age_fim"]', endTime);
        console.log(`Horários preenchidos: ${data.startTime} - ${endTime}`);
        
        const professionalId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        if (!professionalId) throw new Error(`ID do profissional "${data.professionalName}" não encontrado.`);
        
        const allSelects = await page.$$('.modal-body .select-v2 select');
        if (allSelects.length < 3) {
            throw new Error('Não foi possível encontrar o menu dropdown de Profissional.');
        }
        await allSelects[2].select(professionalId);
        console.log('Profissional selecionado.');
        
        // --- CORREÇÃO APLICADA AQUI ---
        // Adiciona uma pausa deliberada para permitir que o site carregue os serviços do profissional.
        await page.waitForTimeout(1500);

        const serviceInputSelector = '#id_usuario_servico';
        const addServiceButtonSelector = '.col-sm-1 .btn';
        const suggestionSelector = '.MuiAutocomplete-popper li';
        const addedServicesTableSelector = '.table-v2.with-total tbody tr';

        for (let i = 0; i < data.services.length; i++) {
            const serviceName = data.services[i];
            await page.click(serviceInputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(serviceInputSelector, serviceName, { delay: 150 });
            
            try {
                await page.waitForSelector(suggestionSelector, { visible: true, timeout: 10000 });
            } catch (e) {
                console.error(`Lista de sugestões para "${serviceName}" não apareceu.`);
                await page.screenshot({ path: 'debug_servico_falhou.png' });
                throw new Error(`A lista de sugestões para o serviço "${serviceName}" não apareceu.`);
            }

            await page.click(suggestionSelector);
            await page.click(addServiceButtonSelector);
            await page.waitForFunction(
                (selector, count) => document.querySelectorAll(selector).length === count + 1,
                { timeout: 10000 },
                addedServicesTableSelector, i
            );
            console.log(`Serviço "${serviceName}" adicionado.`);
        }
        
        await page.click('button[type="submit"]');
        console.log('Botão "Salvar" clicado.');

        await page.waitForSelector('.swal2-popup', { visible: true, timeout: 15000 });
        const title = await page.$eval('.swal2-title', el => el.textContent).catch(() => '');
        if (title.toLowerCase().includes('sucesso') || title.toLowerCase().includes('agendado')) {
            return { success: true, message: 'Agendamento criado com sucesso!' };
        } else {
            const message = await page.$eval('.swal2-html-container', el => el.textContent).catch(() => '');
            throw new Error(`O site retornou um erro: ${title} - ${message}`);
        }

    } catch (error) {
        if (page && !page.isClosed()) {
           await page.screenshot({ path: 'erro_agendamento.png' });
        }
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// ENDPOINTS
app.post('/get-today-html', async (req, res) => {
    try {
        res.json(await getTodayHTML());
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/get-future-day-html', async (req, res) => {
    try {
        const clicks = req.body.clicks;
        res.json(await getFutureDateHTML(Number(clicks) || 0));
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/create-appointment', async (req, res) => {
    try {
        res.json(await createAppointment(req.body));
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço Cash Barber v8.2 - Final    ║
║    - Buscar Horários (Hoje/Futuro)     ║
║    - Criar Agendamentos (Scraping)     ║
╚════════════════════════════════════════╝
    `);
});

