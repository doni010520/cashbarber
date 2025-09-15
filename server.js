const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ========== CONFIGURAÇÕES ==========
const CONFIG = {
    baseUrl: 'https://painel.cashbarber.com.br',
    credentials: {
        email: process.env.CASH_BARBER_EMAIL || 'elisangela_2011.jesus@hotmail.com',
        password: process.env.CASH_BARBER_PASSWORD || '123456'
    },
    profissionais: {
        'Bruno Oliveira': '73',
        'bruno': '73',
        'Bruno': '73',
        'Miguel Oliveira': '74',
        'miguel': '74',
        'Miguel': '74',
        'Maicon Fraga': '18522',
        'maicon': '18522',
        'Maicon': '18522'
    },
    filialId: '22' // Centro
};

// Função auxiliar para delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ========== FUNÇÃO DE LOGIN ==========
async function loginCashBarber(page) {
    try {
        console.log('Iniciando login no Cash Barber...');
        await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        await page.waitForSelector('form.kt-form', { visible: true, timeout: 10000 });
        
        await page.type('input[name="email"]', CONFIG.credentials.email);
        await page.type('input[name="password"]', CONFIG.credentials.password);
        await delay(500);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#kt_login_signin_submit')
        ]);
        
        const currentUrl = page.url();
        if (currentUrl.includes('/login')) {
            throw new Error('Login falhou - verifique as credenciais');
        }
        
        console.log('Login realizado com sucesso!');
        return { success: true };
        
    } catch (error) {
        console.error('Erro no login:', error.message);
        return { success: false, error: error.message };
    }
}

// ========== VERIFICAR DISPONIBILIDADE (VERSÃO CORRIGIDA) ==========
async function checkAvailability(page, professionalName, date) { // date no formato 'YYYY-MM-DD'
    try {
        console.log(`Verificando disponibilidade para ${professionalName} em ${date}`);
        
        // CORREÇÃO 1: Navegar para a URL com a data específica
        const targetUrl = `${CONFIG.baseUrl}/agendamento?data=${date}`;
        console.log(`Navegando para: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        // CORREÇÃO 2: Esperar o calendário carregar os dados da nova data
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        console.log('Calendário da data especificada foi carregado.');
        
        const disponibilidade = await page.evaluate((profName, dataParam) => {
            try { // MELHORIA: Adicionado try/catch para depuração dentro do browser
                console.log('Iniciando extração de dados para:', profName);
                
                const headers = document.querySelectorAll('.rbc-row.rbc-row-resource .rbc-header span');
                const profissionaisNaTela = Array.from(headers).map(h => h.textContent.trim());
                
                console.log('Profissionais encontrados na tela:', profissionaisNaTela.join(', '));
                
                const profIndex = profissionaisNaTela.findIndex(p => p.toLowerCase().includes(profName.toLowerCase()));
                
                if (profIndex === -1) {
                    return { success: false, message: `Profissional ${profName} não encontrado`, profissionaisDisponiveis: profissionaisNaTela };
                }
                
                console.log(`${profName} encontrado no índice ${profIndex}`);
                
                const colunas = document.querySelectorAll('.rbc-time-content .rbc-day-slot.rbc-time-column');
                console.log(`Total de colunas de horários: ${colunas.length}`);
                
                if (profIndex >= colunas.length) {
                    return { success: false, message: `Índice de profissional (${profIndex}) fora do alcance das colunas (${colunas.length})` };
                }
                
                const colunaProf = colunas[profIndex];
                const containerEventos = colunaProf.querySelector('.rbc-events-container');
                
                const periodosOcupados = [];
                if (containerEventos) {
                    const eventos = containerEventos.children;
                    console.log(`Encontrados ${eventos.length} eventos na coluna.`);
                    
                    Array.from(eventos).forEach((evento) => {
                        if (!evento.classList.contains('rbc-event')) return;
                        
                        const titulo = evento.getAttribute('title') || '';
                        const horariosMatch = titulo.match(/(\d{2}:\d{2})\s*–\s*(\d{2}:\d{2})/);
                        
                        if (horariosMatch) {
                            const isIntervalo = evento.classList.contains('break');
                            const descricaoCompleta = titulo.replace(horariosMatch[0], '').replace(':', '').trim();

                            periodosOcupados.push({
                                inicio: horariosMatch[1],
                                fim: horariosMatch[2],
                                tipo: isIntervalo ? 'intervalo' : 'agendamento',
                                descricao: descricaoCompleta,
                                tituloCompleto: titulo
                            });
                        }
                    });
                } else {
                    console.log('Nenhum container de eventos encontrado. Dia livre.');
                }
                
                console.log('Períodos ocupados extraídos:', periodosOcupados);

                const todosHorarios = [];
                for (let h = 9; h < 20; h++) {
                    for (let m = 0; m < 60; m += 10) {
                        todosHorarios.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
                    }
                }
                
                const horarioParaMinutos = (h) => { const [hora, min] = h.split(':').map(Number); return hora * 60 + min; };
                
                const horariosLivres = todosHorarios.filter(horario => {
                    const minutosHorario = horarioParaMinutos(horario);
                    return !periodosOcupados.some(periodo => {
                        const minutosInicio = horarioParaMinutos(periodo.inicio);
                        const minutosFim = horarioParaMinutos(periodo.fim);
                        return minutosHorario >= minutosInicio && minutosHorario < minutosFim;
                    });
                });

                const periodosLivres = [];
                if (horariosLivres.length > 0) {
                    let periodoAtual = { inicio: horariosLivres[0], fim: horariosLivres[0] };
                    for (let i = 1; i < horariosLivres.length; i++) {
                        const diffMinutos = horarioParaMinutos(horariosLivres[i]) - horarioParaMinutos(periodoAtual.fim);
                        if (diffMinutos === 10) {
                            periodoAtual.fim = horariosLivres[i];
                        } else {
                            periodosLivres.push(periodoAtual);
                            periodoAtual = { inicio: horariosLivres[i], fim: horariosLivres[i] };
                        }
                    }
                    periodosLivres.push(periodoAtual);
                }

                return {
                    success: true,
                    profissional: profName,
                    data: dataParam,
                    horariosLivres,
                    periodosLivres,
                    periodosOcupados,
                    resumo: {
                        temDisponibilidade: horariosLivres.length > 0,
                        proximoHorarioLivre: horariosLivres[0] || null,
                        periodosLivresContinuos: periodosLivres
                    }
                };
            } catch (e) {
                return { success: false, error: e.message, stack: e.stack };
            }
        }, professionalName, date);
        
        return disponibilidade;
        
    } catch (error) {
        console.error('Erro ao verificar disponibilidade:', error.message);
        return { success: false, error: error.message };
    }
}

// ========== CRIAR AGENDAMENTO ==========
async function createBooking(page, bookingData) {
    try {
        console.log('Criando agendamento:', bookingData);
        
        const disponibilidade = await checkAvailability(page, bookingData.professionalName, bookingData.date);
        if (!disponibilidade.success) {
            return disponibilidade;
        }
        
        if (!disponibilidade.horariosLivres.includes(bookingData.time)) {
            return {
                success: false,
                message: `Horário ${bookingData.time} não está disponível`,
                horariosLivres: disponibilidade.horariosLivres,
                sugestao: disponibilidade.horariosLivres.length > 0 
                    ? `Horários disponíveis: ${disponibilidade.horariosLivres.slice(0, 5).join(', ')}`
                    : 'Nenhum horário disponível nesta data'
            };
        }
        
        const btnNovo = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => b.textContent.trim().includes('Novo agendamento'));
        });
        
        if (!btnNovo) {
            throw new Error('Botão "Novo agendamento" não encontrado');
        }
        
        await btnNovo.click();
        await delay(2000);
        
        await page.waitForSelector('#age_id_cliente', { visible: true, timeout: 5000 });
        
        const selects = await page.$$('select');
        
        if (selects[0]) {
            await selects[0].select('Agendamento');
        }
        
        await page.click('#age_id_cliente');
        await page.type('#age_id_cliente', bookingData.clientName);
        await delay(1000);
        
        await page.evaluate((dateValue) => {
            const dateInput = document.querySelector('input[name="age_data"]');
            if (dateInput) {
                dateInput.value = dateValue;
                dateInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, bookingData.date);
        
        await page.evaluate((timeValue) => {
            const timeInput = document.querySelector('input[name="age_inicio"]');
            if (timeInput) {
                timeInput.value = timeValue;
                timeInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, bookingData.time);
        
        const [hora, minuto] = bookingData.time.split(':').map(Number);
        const duracao = bookingData.duracao || 30;
        const totalMinutos = hora * 60 + minuto + duracao;
        const horaFim = `${Math.floor(totalMinutos / 60).toString().padStart(2, '0')}:${(totalMinutos % 60).toString().padStart(2, '0')}`;
        
        await page.evaluate((timeValue) => {
            const timeInput = document.querySelector('input[name="age_fim"]');
            if (timeInput) {
                timeInput.value = timeValue;
                timeInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, horaFim);
        
        if (selects[2]) {
            await selects[2].select(CONFIG.filialId);
        }
        
        const professionalId = CONFIG.profissionais[bookingData.professionalName] || CONFIG.profissionais[bookingData.professionalName.toLowerCase()] || '73';
        if (selects[3]) {
            await selects[3].select(professionalId);
        }
        
        if (bookingData.services) {
            await page.click('#id_usuario_servico');
            await page.type('#id_usuario_servico', bookingData.services);
            await delay(1000);
        }
        
        await delay(1000);
        
        const btnSalvar = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => b.textContent.toLowerCase().includes('salvar'));
        });
        
        if (btnSalvar) {
            await btnSalvar.click();
        } else {
            await page.click('button[type="submit"]');
        }
        
        await delay(3000);
        
        const hasError = await page.$$('.alert-danger, .error-message');
        if (hasError && hasError.length > 0) {
            const errorText = await hasError[0].evaluate(el => el.textContent);
            throw new Error(`Erro ao salvar: ${errorText}`);
        }
        
        return {
            success: true,
            message: 'Agendamento criado com sucesso!',
            agendamento: {
                cliente: bookingData.clientName,
                telefone: bookingData.clientPhone,
                profissional: bookingData.professionalName,
                data: bookingData.date,
                horario: `${bookingData.time} - ${horaFim}`,
                servico: bookingData.services
            }
        };
        
    } catch (error) {
        console.error('Erro ao criar agendamento:', error);
        return { success: false, error: error.message };
    }
}

// ========== ENDPOINTS DA API ==========

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'Cash Barber Automation', version: '1.0.0' });
});

// Endpoint principal de automação
app.post('/automate', async (req, res) => {
    const { action, clientName, clientPhone, professionalName, services, date, time, duracao } = req.body;
    
    console.log('Requisição recebida:', { action, professionalName, date });
    
    if (!action) {
        return res.status(400).json({ success: false, error: 'Ação é obrigatória (check, list ou create)' });
    }
    
    if (action === 'create' && (!clientName || !date || !time)) {
        return res.status(400).json({ success: false, error: 'Para criar agendamento: clientName, date e time são obrigatórios' });
    }
    
    let browser;
    let page;
    
    try {
        console.log('Iniciando browser...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Deixe undefined para usar o padrão localmente
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        // MELHORIA DE DEPURAÇÃO: Mostra os logs do console do browser no seu terminal
        page.on('console', msg => {
            const logArgs = msg.args();
            for (let i = 0; i < logArgs.length; ++i) {
                logArgs[i].jsonValue().then(value => {
                    console.log(`[BROWSER CONSOLE] >`, value);
                });
            }
        });
        
        const loginResult = await loginCashBarber(page);
        if (!loginResult.success) {
            throw new Error(loginResult.error || 'Falha no login');
        }
        
        let result;
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        switch (action) {
            case 'check':
            case 'list':
                result = await checkAvailability(
                    page, 
                    professionalName || 'Bruno Oliveira', 
                    targetDate
                );
                break;
                
            case 'create':
                result = await createBooking(page, {
                    clientName,
                    clientPhone,
                    professionalName: professionalName || 'Bruno Oliveira',
                    services: services || 'Corte de Cabelo',
                    date,
                    time,
                    duracao: duracao || 30
                });
                break;
                
            default:
                result = { success: false, error: `Ação inválida: ${action}. Use: check, list ou create` };
        }
        
        console.log('Resultado final enviado:', result);
        res.json(result);
        
    } catch (error) {
        console.error('Erro na automação:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
        
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser fechado');
        }
    }
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        name: 'Cash Barber Automation API',
        version: '1.0.1', // Versão atualizada com correção
        status: 'online'
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║     Cash Barber Automation Service     ║
║     Rodando na porta ${PORT}                 ║
║     http://localhost:${PORT}             ║
╚════════════════════════════════════════╝
    `);
});
