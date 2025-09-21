const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// Configuração com modo debug
const CONFIG = {
    baseUrl: 'https://painel.cashbarber.com.br',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    professionalIds: {
        'bruno oliveira': '73',
        'miguel oliveira': '74',
        'maicon fraga': '18522'
    },
    debug: process.env.DEBUG === 'true',
    verboseLogs: process.env.VERBOSE_LOGS !== 'false', // Padrão true
    headless: process.env.HEADLESS !== 'false', // Padrão true
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '60') * 1000,
    createTimeout: parseInt(process.env.CREATE_APPOINTMENT_TIMEOUT || '300') * 1000,
    screenshotsDir: '/app/screenshots'
};

// Log de inicialização
console.log('🚀 Cash Barber Service v9.4 - Configuração:');
console.log(`   📍 URL Base: ${CONFIG.baseUrl}`);
console.log(`   🐛 Debug: ${CONFIG.debug ? 'ATIVADO' : 'Desativado'}`);
console.log(`   📝 Logs Detalhados: ${CONFIG.verboseLogs ? 'ATIVADO' : 'Desativado'}`);
console.log(`   🖥️  Modo Headless: ${CONFIG.headless ? 'Sim' : 'NÃO (Navegador Visível)'}`);
console.log(`   ⏱️  Timeout Padrão: ${CONFIG.defaultTimeout/1000}s`);
console.log(`   ⏱️  Timeout Criação: ${CONFIG.createTimeout/1000}s`);

// Criar diretório de screenshots se não existir
async function ensureScreenshotsDir() {
    if (CONFIG.debug) {
        try {
            await fs.mkdir(CONFIG.screenshotsDir, { recursive: true });
        } catch (error) {
            console.log('Erro ao criar diretório de screenshots:', error.message);
        }
    }
}

// Função para capturar screenshot com timestamp
async function takeScreenshot(page, stepName) {
    if (CONFIG.debug) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${timestamp}-${stepName}.png`;
            const filepath = path.join(CONFIG.screenshotsDir, filename);
            await page.screenshot({ path: filepath, fullPage: true });
            console.log(`📸 Screenshot salvo: ${filename}`);
        } catch (error) {
            console.log('Erro ao capturar screenshot:', error.message);
        }
    }
}

// Função melhorada para iniciar o navegador
async function startBrowserAndLogin() {
    if (CONFIG.verboseLogs) console.log('🚀 Iniciando navegador otimizado...');
    
    const browserOptions = {
        headless: CONFIG.headless ? 'new' : false,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    };
    
    if (CONFIG.headless) {
        browserOptions.args.push('--single-process');
    }
    
    const browser = await puppeteer.launch(browserOptions);
    const page = await browser.newPage();
    
    // Configurações de página
    page.setDefaultTimeout(60000);
    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Interceptar requisições para logs debug
    if (CONFIG.debug) {
        page.on('console', msg => console.log('🌐 Console:', msg.text()));
        page.on('pageerror', error => console.log('❌ Erro na página:', error.message));
    }

    // Login
    console.log('📝 Fazendo login...');
    await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await takeScreenshot(page, 'login-page');
    
    await page.waitForSelector('form.kt-form', { visible: true });
    await page.type('input[name="email"]', CONFIG.credentials.email, { delay: 50 });
    await page.type('input[name="password"]', CONFIG.credentials.password, { delay: 50 });
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        page.click('#kt_login_signin_submit')
    ]);
    
    await takeScreenshot(page, 'after-login');
    console.log('✅ Login bem-sucedido.');
    
    return { browser, page };
}

// Função para aguardar elemento com retry
async function waitForSelectorWithRetry(page, selector, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await page.waitForSelector(selector, { 
                visible: true, 
                timeout: 20000,
                ...options 
            });
            return true;
        } catch (error) {
            console.log(`⏳ Tentativa ${i + 1}/${retries} para selector: ${selector}`);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    return false;
}

// Extrai o HTML da agenda do dia ATUAL
async function getTodayHTML() {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        console.log('📅 Navegando para agenda...');
        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        await page.goto(agendaUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await waitForSelectorWithRetry(page, '.rbc-time-view');
        
        await takeScreenshot(page, 'agenda-today');

        const dataAtual = await page.$eval('.date-text', el => el.textContent.trim());
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        
        console.log(`✅ HTML extraído para: ${dataAtual}`);
        return { success: true, date: dataAtual, html: htmlContent };
    } catch (error) {
        console.error('❌ Erro ao buscar HTML de hoje:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// Clica N vezes para avançar e extrai o HTML do dia futuro
async function getFutureDateHTML(clicks) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        console.log(`📅 Navegando para agenda e avançando ${clicks} dias...`);
        const agendaUrl = `${CONFIG.baseUrl}/agendamento`;
        await page.goto(agendaUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await waitForSelectorWithRetry(page, '.rbc-time-view');
        
        for (let i = 0; i < clicks; i++) {
            const dataAntesDoClique = await page.$eval('.date-text', el => el.textContent.trim());
            console.log(`➡️ Avançando dia ${i + 1}/${clicks}...`);
            
            await page.click('.arrow-buttons svg:last-child');
            await page.waitForFunction(
                (dataAnterior) => document.querySelector('.date-text')?.textContent.trim() !== dataAnterior,
                { timeout: 30000 },
                dataAntesDoClique
            );
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await takeScreenshot(page, `agenda-plus-${clicks}-days`);
        
        const dataFinal = await page.$eval('.date-text', el => el.textContent.trim());
        const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
        
        console.log(`✅ HTML extraído para: ${dataFinal}`);
        return { success: true, date: dataFinal, html: htmlContent };
    } catch (error) {
        console.error('❌ Erro ao buscar HTML futuro:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// Cria um agendamento com melhorias completas
async function createAppointment(data) {
    let browser;
    const startTime = Date.now();
    
    try {
        console.log('📝 Iniciando criação de agendamento:', JSON.stringify(data, null, 2));
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        // Navegar para a página de agendamento
        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2', timeout: 60000 });
        await takeScreenshot(page, 'appointment-page');
        
        // Aguardar e clicar no botão de novo agendamento
        console.log('🔍 Procurando botão de novo agendamento...');
        await waitForSelectorWithRetry(page, '.buttons .btn-v2-blue');
        await page.click('.buttons .btn-v2-blue');
        
        // Aguardar o modal carregar
        console.log('⏳ Aguardando modal...');
        await waitForSelectorWithRetry(page, '#age_id_cliente');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await takeScreenshot(page, 'modal-opened');
        
        // Preencher nome do cliente com retry
        console.log(`👤 Cliente: ${data.clientName}`);
        let clientSelected = false;
        for (let retry = 0; retry < 3 && !clientSelected; retry++) {
            try {
                await page.click('#age_id_cliente', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('#age_id_cliente', data.clientName, { delay: 150 });
                
                await page.waitForSelector('.MuiAutocomplete-popper li', { 
                    visible: true, 
                    timeout: 15000 
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
                await page.click('.MuiAutocomplete-popper li');
                clientSelected = true;
                console.log('✅ Cliente selecionado');
            } catch (error) {
                console.log(`⚠️ Tentativa ${retry + 1} de selecionar cliente`);
            }
        }
        
        if (!clientSelected) throw new Error('Não foi possível selecionar o cliente');
        
        // Calcular horário de fim
        const [startHour, startMinute] = data.startTime.split(':').map(Number);
        const durationMinutes = parseInt(data.totalDuration, 10) || 30;
        const endDate = new Date();
        endDate.setHours(startHour);
        endDate.setMinutes(startMinute + durationMinutes);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        // Preencher data e horários
        console.log(`📅 Data: ${data.date}, Horário: ${data.startTime} - ${endTime}`);
        await page.evaluate((date) => {
            document.querySelector('input[name="age_data"]').value = date;
        }, data.date);
        await page.evaluate((time) => {
            document.querySelector('input[name="age_inicio"]').value = time;
        }, data.startTime);
        await page.evaluate((time) => {
            document.querySelector('input[name="age_fim"]').value = time;
        }, endTime);
        
        // Selecionar profissional
        console.log(`💈 Profissional: ${data.professionalName}`);
        const professionalId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        
        if (!professionalId) {
            throw new Error(`ID do profissional não encontrado: ${data.professionalName}`);
        }
        
        const allSelects = await page.$$('.modal-body .select-v2 select');
        if (allSelects[2]) {
            await allSelects[2].select(professionalId);
            console.log('✅ Profissional selecionado');
        } else {
            throw new Error('Select do profissional não encontrado');
        }
        
        // Aguardar carregamento dos serviços
        console.log('⏳ Aguardando carregamento dos serviços...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await takeScreenshot(page, 'professional-selected');

        // Garantir que services seja array
        const services = Array.isArray(data.services) ? data.services : [data.services];
        
        // Adicionar serviços
        for (let i = 0; i < services.length; i++) {
            const serviceName = services[i];
            console.log(`🔧 Adicionando serviço ${i + 1}/${services.length}: ${serviceName}`);
            
            let serviceAdded = false;
            for (let retry = 0; retry < 3 && !serviceAdded; retry++) {
                try {
                    // Limpar e digitar serviço
                    await page.click('#id_usuario_servico', { clickCount: 3 });
                    await page.keyboard.press('Backspace');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    await page.type('#id_usuario_servico', serviceName, { delay: 200 });
                    
                    // Aguardar sugestões
                    await page.waitForSelector('.MuiAutocomplete-popper li', { 
                        visible: true, 
                        timeout: 15000 
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Clicar na primeira sugestão
                    await page.click('.MuiAutocomplete-popper li:first-child');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Adicionar serviço
                    await page.click('.col-sm-1 .btn');
                    
                    // Verificar se foi adicionado
                    await page.waitForFunction(
                        (selector, expectedCount) => {
                            const rows = document.querySelectorAll(selector);
                            return rows.length === expectedCount;
                        },
                        { timeout: 10000 },
                        '.table-v2.with-total tbody tr',
                        i + 1
                    );
                    
                    serviceAdded = true;
                    console.log(`✅ Serviço adicionado: ${serviceName}`);
                } catch (error) {
                    console.log(`⚠️ Tentativa ${retry + 1} para serviço: ${serviceName}`);
                    await takeScreenshot(page, `service-error-${i}-${retry}`);
                }
            }
            
            if (!serviceAdded) {
                throw new Error(`Não foi possível adicionar o serviço: ${serviceName}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
        await takeScreenshot(page, 'before-submit');
        
        // Submeter formulário
        console.log('📤 Enviando agendamento...');
        await page.click('button[type="submit"]');

        // Aguardar confirmação
        await page.waitForSelector('.swal2-popup', { visible: true, timeout: 30000 });
        await takeScreenshot(page, 'result-popup');
        
        const title = await page.$eval('.swal2-title', el => el.textContent).catch(() => '');
        const message = await page.$eval('.swal2-html-container', el => el.textContent).catch(() => '');
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (title.toLowerCase().includes('sucesso') || title.toLowerCase().includes('agendado')) {
            console.log(`✅ Agendamento criado com sucesso em ${elapsed}s!`);
            return { 
                success: true, 
                message: 'Agendamento criado com sucesso!',
                executionTime: `${elapsed}s`
            };
        } else {
            throw new Error(`O site retornou: ${title} - ${message}`);
        }
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`❌ Erro após ${elapsed}s:`, error.message);
        
        if (CONFIG.debug && browser) {
            const page = (await browser.pages())[0];
            await takeScreenshot(page, 'error-final');
        }
        
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// Inicializar
ensureScreenshotsDir();

// ENDPOINTS
app.post('/get-today-html', async (req, res) => {
    try { 
        const result = await getTodayHTML();
        res.json(result); 
    } catch (error) { 
        console.error('Endpoint error:', error);
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.post('/get-future-day-html', async (req, res) => {
    try {
        const clicks = req.body.clicks === undefined ? 0 : Number(req.body.clicks);
        const result = await getFutureDateHTML(clicks);
        res.json(result);
    } catch (error) {
        console.error('Endpoint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/create-appointment', async (req, res) => {
    try { 
        const result = await createAppointment(req.body);
        res.json(result); 
    } catch (error) { 
        console.error('Endpoint error:', error);
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// Health check com informações do sistema
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        version: '9.4',
        timestamp: new Date().toISOString(),
        debug: CONFIG.debug,
        uptime: process.uptime()
    });
});

// Endpoint para listar screenshots (apenas em modo debug)
app.get('/screenshots', async (req, res) => {
    if (!CONFIG.debug) {
        return res.status(404).json({ error: 'Debug mode disabled' });
    }
    
    try {
        const files = await fs.readdir(CONFIG.screenshotsDir);
        res.json({ screenshots: files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para baixar screenshot (apenas em modo debug)
app.get('/screenshots/:filename', async (req, res) => {
    if (!CONFIG.debug) {
        return res.status(404).json({ error: 'Debug mode disabled' });
    }
    
    const filepath = path.join(CONFIG.screenshotsDir, req.params.filename);
    res.sendFile(filepath);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║    Serviço Cash Barber v9.4 - Complete  ║
║    Porta: ${PORT}                             ║
║    Debug: ${CONFIG.debug ? 'ON' : 'OFF'}                          ║
║    Endpoints:                            ║
║    - POST /get-today-html                ║
║    - POST /get-future-day-html           ║
║    - POST /create-appointment            ║
║    - GET  /health                        ║
${CONFIG.debug ? '║    - GET  /screenshots                   ║\n║    - GET  /screenshots/:filename         ║' : ''}
╚══════════════════════════════════════════╝
    `);
});
