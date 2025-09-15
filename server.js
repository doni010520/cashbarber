const express = require('express');
// 1. IMPORTAÇÕES ATUALIZADAS
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

// 2. APLICAR O MODO STEALTH
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

const SELECTORS = {
    loginForm: 'form.kt-form',
    emailInput: 'input[name="email"]',
    passwordInput: 'input[name="password"]',
    submitButton: '#kt_login_signin_submit',
    calendarView: '.rbc-time-view',
    professionalHeaders: '.rbc-row.rbc-row-resource .rbc-header span',
    scheduleColumns: '.rbc-time-content .rbc-day-slot.rbc-time-column',
    eventContainer: '.rbc-events-container',
    eventElement: '.rbc-event'
};

async function login(page) {
    console.log('Iniciando login...');
    await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector(SELECTORS.loginForm, { visible: true });
    await page.type(SELECTORS.emailInput, CONFIG.credentials.email);
    await page.type(SELECTORS.passwordInput, CONFIG.credentials.password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click(SELECTORS.submitButton)
    ]);
    if (page.url().includes('/login')) throw new Error('Credenciais inválidas ou falha no login.');
    console.log('Login bem-sucedido.');
}

async function navigateToDate(page, date) {
    console.log(`Navegando para a agenda do dia ${date}...`);
    const targetUrl = `${CONFIG.baseUrl}/agendamento?data=${date}`;
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector(SELECTORS.calendarView, { visible: true });
    console.log('Página da agenda carregada.');
}

async function getSchedule(page, professionalName, date) {
    console.log(`Extraindo horários para ${professionalName}...`);
    
    const professionalsOnScreen = await page.$$eval(SELECTORS.professionalHeaders, (headers) =>
        headers.map(h => h.textContent.trim())
    );
    console.log('Profissionais na tela:', professionalsOnScreen.join(' | '));

    const profIndex = professionalsOnScreen.findIndex(p => p.toLowerCase().includes(professionalName.toLowerCase()));

    if (profIndex === -1) {
        throw new Error(`Profissional "${professionalName}" não encontrado na tela. Disponíveis: ${professionalsOnScreen.join(', ')}`);
    }

    const scheduleData = await page.$$eval(SELECTORS.scheduleColumns, (columns, index) => {
        const professionalColumn = columns[index];
        if (!professionalColumn) return { occupied: [] };

        const eventContainer = professionalColumn.querySelector('.rbc-events-container');
        if (!eventContainer) return { occupied: [] };

        const occupied = Array.from(eventContainer.children).map(eventEl => {
            const title = eventEl.getAttribute('title') || '';
            const match = title.match(/(\d{2}:\d{2})\s*–\s*(\d{2}:\d{2})/);
            if (!match) return null;
            
            const description = title.replace(match[0], '').replace(':', '').trim();
            return { start: match[1], end: match[2], description: description };
        }).filter(Boolean);

        return { occupied };
    }, profIndex);
    
    const occupiedSlots = scheduleData.occupied;
    const allSlots = [];
    for (let h = 9; h < 20; h++) {
        for (let m = 0; m < 60; m += 30) {
            allSlots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
        }
    }

    const timeToMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const freeSlots = allSlots.filter(slot => {
        const slotMinutes = timeToMinutes(slot);
        return !occupiedSlots.some(occupied => 
            slotMinutes >= timeToMinutes(occupied.start) && slotMinutes < timeToMinutes(occupied.end)
        );
    });

    return {
        success: true,
        professional: professionalName,
        date: date,
        freeSlots: freeSlots,
        occupiedSlots: occupiedSlots
    };
}

app.post('/automate', async (req, res) => {
    const { action, professionalName, date } = req.body;
    if (!action) return res.status(400).json({ success: false, error: 'Ação é obrigatória' });
    
    let browser;
    try {
        console.log('Iniciando automação com MODO STEALTH...');
        // 3. USAR O PUPPETEER MODIFICADO
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent(CONFIG.userAgent);
        
        await login(page);
        
        let result;
        const targetDate = date || new Date().toISOString().split('T')[0];

        switch (action) {
            case 'check':
            case 'list':
                await navigateToDate(page, targetDate);
                result = await getSchedule(page, professionalName || 'Bruno Oliveira', targetDate);
                break;
            default:
                result = { success: false, error: `Ação inválida: ${action}.` };
        }
        
        res.json(result);

    } catch (error) {
        console.error('ERRO FATAL NA AUTOMAÇÃO:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
        console.log('Automação finalizada.');
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║     Cash Barber Automation Service     ║
║     (v3.0 - MODO STEALTH)              ║
║     Rodando na porta ${PORT}                 ║
╚════════════════════════════════════════╝
    `);
});
