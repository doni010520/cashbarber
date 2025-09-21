const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
    baseUrl: 'https://painel.cashberber.com.br',
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

async function createAppointment(data) {
    let browser;
    try {
        const { page, browser: browserInstance } = await startBrowserAndLogin();
        browser = browserInstance;

        await page.goto(`${CONFIG.baseUrl}/agendamento`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.buttons .btn-v2-blue');
        console.log('Página da agenda carregada. Abrindo modal...');
        
        await page.click('.buttons .btn-v2-blue');
        
        await page.waitForSelector('#age_id_cliente', { visible: true, timeout: 15000 });
        console.log('Modal de agendamento carregado.');

        console.log(`Buscando cliente: ${data.clientName}`);
        await page.type('#age_id_cliente', data.clientName, { delay: 100 });
        const suggestionSelector = '.MuiAutocomplete-popper li';
        await page.waitForSelector(suggestionSelector, { visible: true });
        await page.evaluate((name) => {
            const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
            const targetOption = options.find(option => option.textContent.toLowerCase().includes(name.toLowerCase()));
            if (targetOption) targetOption.click();
            else throw new Error(`Sugestão para o cliente "${name}" não foi encontrada.`);
        }, data.clientName);
        console.log('Cliente selecionado.');

        const startTime = data.startTime;
        const totalDuration = data.totalDuration || 30;
        
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(startHour, startMinute, 0, 0);
        const endDate = new Date(startDate.getTime() + totalDuration * 60000);
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        
        await page.type('input[name="age_data"]', data.date);
        await page.type('input[name="age_inicio"]', startTime);
        await page.type('input[name="age_fim"]', endTime);
        console.log(`Horários preenchidos: ${startTime} - ${endTime}`);

        // ==================================================================
        // <-- A CORREÇÃO ESTÁ AQUI
        // Lógica para encontrar o dropdown de profissional pelo seu texto.
        // ==================================================================
        console.log(`Selecionando profissional: ${data.professionalName}`);
        const professionalId = CONFIG.professionalIds[data.professionalName.toLowerCase()];
        if (!professionalId) throw new Error(`ID do profissional "${data.professionalName}" não foi encontrado na configuração.`);

        const selectProfessionalSuccess = await page.evaluate((profId) => {
            const allLabels = document.querySelectorAll('.select-v2-label');
            let professionalSelect = null;
            allLabels.forEach(label => {
                if (label.textContent.includes('Profissional')) {
                    professionalSelect = label.closest('.select-v2').querySelector('select');
                }
            });

            if (professionalSelect) {
                professionalSelect.value = profId;
                const event = new Event('change', { bubbles: true });
                professionalSelect.dispatchEvent(event);
                return true;
            }
            return false;
        }, professionalId);
        
        if (!selectProfessionalSuccess) {
            throw new Error('Não foi possível encontrar o menu dropdown de "Profissional".');
        }
        console.log('Profissional selecionado com sucesso.');
        // ==================================================================

        for (const serviceName of data.services) {
            console.log(`Adicionando serviço: ${serviceName}`);
            await page.type('#id_usuario_servico', serviceName, { delay: 100 });
            await page.waitForSelector(suggestionSelector, { visible: true });
            await page.evaluate((name) => {
                const options = Array.from(document.querySelectorAll('.MuiAutocomplete-popper li'));
                const targetOption = options.find(option => option.textContent.toLowerCase().includes(name.toLowerCase()));
                if (targetOption) targetOption.click();
                else throw new Error(`Sugestão para o serviço "${name}" não foi encontrada.`);
            }, serviceName);
            await page.click('.col-sm-1 .btn');
            await page.waitForTimeout(500);
        }
        console.log('Todos os serviços foram adicionados.');

        await page.click('button[type="submit"]');
        console.log('Clicou em "Salvar agendamento".');

        await page.waitForSelector('.modal-dialog', { hidden: true, timeout: 15000 });
        console.log('Agendamento criado com sucesso!');

        return { success: true, message: 'Agendamento criado com sucesso!', data: data };

    } catch (error) {
        console.error('ERRO AO CRIAR AGENDAMENTO:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// [Seus outros endpoints como /get-today-html, etc., podem continuar aqui]

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
    console.log(`Serviço de Automação Cash Barber v6.2 rodando na porta ${PORT}`);
});

