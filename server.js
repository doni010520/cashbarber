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
            console.log(`Avançando do dia '${dataAntesDoClique}'... (Clique ${i + 1}/${clicks})`);
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
 * Cria um agendamento no sistema.
 * @param {object} data - Contém os dados do agendamento.
 */
async function createAppointment(data) {
    let browser;
    let page;
    try {
        const { page: loggedInPage, browser: browserInstance } = await startBrowserAndLogin();
        page = loggedInPage;
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.rbc-time-view', { visible: true });
        await page.click('.buttons .btn-v2-blue');
        
        await page.waitForSelector('#age_id_cliente', { visible: true });
        console.log('Modal de agendamento carregado.');

        console.log(`Buscando cliente: ${data.clientName}`);
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        await page.waitForSelector('.MuiAutocomplete-popper li', { visible: true });
        await page.evaluate((name) => {
            const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
            const targetOption = options.find(option => option.textContent.toLowerCase().includes(name.toLowerCase()));
            if (targetOption) targetOption.click();
        }, data.clientName);
        console.log('Cliente selecionado.');
        
        const [startHour, startMinute] = data.startTime.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(startHour, startMinute, 0, 0);
        const endDate = new Date(startDate.getTime() + (data.totalDuration || 30) * 60000);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        await page.type('input[name="age_data"]', data.date);
        await page.type('input[name="age_inicio"]', data.startTime);
        await page.type('input[name="age_fim"]', endTime);
        console.log(`Horários preenchidos: ${data.startTime} - ${endTime}`);
        
        const professionalId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        if (!professionalId) throw new Error(`ID do profissional "${data.professionalName}" não encontrado.`);
        
        await page.waitForSelector('xpath/.//div[label[contains(., "Profissional")]]//select');
        const professionalSelectHandle = await page.$('xpath/.//div[label[contains(., "Profissional")]]//select');
        await professionalSelectHandle.select(professionalId);
        console.log('Profissional selecionado.');

        console.log('Iniciando adição de serviços...');
        const serviceInputSelector = '#id_usuario_servico';
        const addServiceButtonSelector = '.col-sm-1 .btn';
        const suggestionSelector = '.MuiAutocomplete-popper li';
        const addedServicesTableSelector = '.table-v2.with-total tbody tr';

        for (let i = 0; i < data.services.length; i++) {
            const serviceName = data.services[i];
            const servicesAddedSoFar = i;
            await page.focus(serviceInputSelector);
            await page.click(serviceInputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(serviceInputSelector, serviceName, { delay: 150 });
            await page.waitForSelector(suggestionSelector, { visible: true });
            
            const clicked = await page.evaluate((name, selector) => {
                const options = Array.from(document.querySelectorAll(selector));
                const targetOption = options.find(option => option.textContent.toLowerCase().includes(name.toLowerCase()));
                if (targetOption) {
                    targetOption.click();
                    return true;
                }
                return false;
            }, serviceName, suggestionSelector);

            if (!clicked) throw new Error(`Sugestão para o serviço "${serviceName}" não foi encontrada.`);
            await page.click(addServiceButtonSelector);
            
            await page.waitForFunction(
                (selector, count) => document.querySelectorAll(selector).length === count + 1,
                { timeout: 10000 },
                addedServicesTableSelector, servicesAddedSoFar
            );
            console.log(`Serviço "${serviceName}" adicionado com sucesso.`);
        }
        
        await page.click('button[type="submit"]');
        console.log('Botão "Salvar agendamento" clicado.');

        // <-- MUDANÇA CRUCIAL: Espera pela confirmação real
        await page.waitForSelector('.swal2-popup', { visible: true, timeout: 15000 });
        console.log('Popup de confirmação/erro apareceu.');

        const title = await page.$eval('.swal2-title', (el) => el.textContent).catch(() => '');
        const message = await page.$eval('.swal2-html-container', (el) => el.textContent).catch(() => '');

        if (title.toLowerCase().includes('sucesso') || title.toLowerCase().includes('agendado')) {
            console.log('Mensagem de sucesso encontrada!');
            return { success: true, message: 'Agendamento criado com sucesso!', data: data };
        } else {
            // Se não for sucesso, consideramos um erro e retornamos a mensagem do site
            throw new Error(`O site retornou um erro: ${title} - ${message}`);
        }
        // Fim da mudança

    } catch (error) {
        console.error('ERRO AO CRIAR AGENDAMENTO:', error);
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
    const appointmentData = req.body;
    if (!appointmentData.clientName || !appointmentData.professionalName || !appointmentData.date || !appointmentData.startTime || !appointmentData.services) {
        return res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes.' });
    }
    try {
        const result = await createAppointment(appointmentData);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço Cash Barber v7.2 - Completo ║
║    - Buscar Horários (Hoje/Futuro)     ║
║    - Criar Agendamentos (Robusto)      ║
╚════════════════════════════════════════╝
    `);
});

