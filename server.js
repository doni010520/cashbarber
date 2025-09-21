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
 * Função base para iniciar o navegador e fazer login com otimizações.
 */
async function startBrowserAndLogin() {
    console.log('Iniciando navegador otimizado...');
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2', timeout: 45000 });
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
 * Cria um agendamento no sistema, com logs de depuração detalhados.
 */
async function createAppointment(data) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        console.log('[DEBUG] 1. A navegar para a página da agenda...');
        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.buttons .btn-v2-blue');
        await page.click('.buttons .btn-v2-blue');
        
        await page.waitForSelector('#age_id_cliente', { visible: true });
        console.log('[DEBUG] 2. Modal de agendamento carregado.');
        
        console.log(`[DEBUG] 3. A procurar cliente: ${data.clientName}`);
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        await page.waitForSelector('.MuiAutocomplete-popper li', { visible: true });
        await page.click('.MuiAutocomplete-popper li');
        console.log('[DEBUG] 4. Cliente selecionado.');
        
        const [startHour, startMinute] = data.startTime.split(':').map(Number);
        const endDate = new Date(new Date().setHours(startHour, startMinute, 0) + (parseInt(data.totalDuration, 10) || 30) * 60000);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        await page.type('input[name="age_data"]', data.date);
        await page.type('input[name="age_inicio"]', data.startTime);
        await page.type('input[name="age_fim"]', endTime);
        console.log(`[DEBUG] 5. Horários preenchidos: ${data.startTime} - ${endTime}`);
        
        const professionalId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        const allSelects = await page.$$('.modal-body .select-v2 select');
        await allSelects[2].select(professionalId);
        console.log('[DEBUG] 6. Profissional selecionado.');
        
        console.log('[DEBUG] 7. A aguardar 2.5 segundos para o carregamento dos serviços...');
        await new Promise(resolve => setTimeout(resolve, 2500));

        console.log('[DEBUG] 8. A iniciar a adição de serviços...');
        const serviceInputSelector = '#id_usuario_servico';
        const addServiceButtonSelector = '.col-sm-1 .btn';
        const suggestionSelector = '.MuiAutocomplete-popper li';
        const addedServicesTableSelector = '.table-v2.with-total tbody tr';

        for (let i = 0; i < data.services.length; i++) {
            const serviceName = data.services[i];
            console.log(`[DEBUG] 9a. A processar serviço: ${serviceName}`);
            
            await page.waitForSelector(serviceInputSelector, { visible: true });
            await page.click(serviceInputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(serviceInputSelector, serviceName, { delay: 150 });
            console.log(`[DEBUG] 9b. A aguardar sugestões para "${serviceName}"...`);
            
            await page.waitForSelector(suggestionSelector, { visible: true, timeout: 15000 });
            console.log('[DEBUG] 9c. Sugestões encontradas. A clicar...');
            await page.click(suggestionSelector);
            
            await page.click(addServiceButtonSelector);
            console.log('[DEBUG] 9d. Botão "+" clicado.');
            
            await page.waitForFunction(
                (selector, count) => document.querySelectorAll(selector).length === count + 1,
                { timeout: 10000 },
                addedServicesTableSelector, i
            );
            console.log(`[DEBUG] 9e. Serviço "${serviceName}" confirmado na tabela.`);
        }
        
        console.log('[DEBUG] 10. A clicar em "Salvar"...');
        await page.click('button[type="submit"]');

        console.log('[DEBUG] 11. A aguardar pop-up de confirmação...');
        await page.waitForSelector('.swal2-popup', { visible: true, timeout: 15000 });
        const title = await page.$eval('.swal2-title', el => el.textContent).catch(() => '');
        if (title.toLowerCase().includes('sucesso') || title.toLowerCase().includes('agendado')) {
            return { success: true, message: 'Agendamento criado com sucesso!' };
        } else {
            const message = await page.$eval('.swal2-html-container', el => el.textContent).catch(() => '');
            throw new Error(`O site retornou um erro: ${title} - ${message}`);
        }
    } catch (error) {
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}


// ENDPOINTS (o resto do ficheiro permanece igual)
app.post('/get-today-html', async (req, res) => {
    try { res.json(await getTodayHTML()); } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/get-future-day-html', async (req, res) => {
    try {
        const clicks = req.body.clicks === undefined ? 0 : Number(req.body.clicks);
        res.json(await getFutureDateHTML(clicks));
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/create-appointment', async (req, res) => {
    try { res.json(await createAppointment(req.body)); } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║    Serviço Cash Barber v9.1 - Debug    ║
╚════════════════════════════════════════╝
    `);
});

