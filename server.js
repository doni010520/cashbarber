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
        
        // ==================================================================
        // <-- CORREÇÃO 1: Navegar para a URL com a data específica
        // Adicionamos o parâmetro `?data=` que o sistema usa para carregar a data correta.
        // ==================================================================
        const targetUrl = `${CONFIG.baseUrl}/agendamento?data=${date}`;
        console.log(`Navegando para: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        // ==================================================================
        // <-- CORREÇÃO 2: Esperar o calendário carregar os dados da nova data
        // Em vez de um delay fixo, esperamos um elemento chave do calendário aparecer.
        // ==================================================================
        await page.waitForSelector('.rbc-time-view', { visible: true, timeout: 15000 });
        console.log('Calendário da data especificada foi carregado.');
        
        const disponibilidade = await page.evaluate((profName, dataParam) => {
            try { // <-- MELHORIA: Adicionado try/catch para depuração dentro do browser
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
                // Se algo der errado dentro do browser, nós veremos o erro
                return { success: false, error: e.message, stack: e.stack };
            }
        }, professionalName, date);
        
        return disponibilidade;
        
    } catch (error) {
        console.error('Erro ao verificar disponibilidade:', error.message);
        return { success: false, error: error.message };
    }
}


// (O restante do seu código: createBooking, endpoints da API, etc. permanece o mesmo)
// ...
// ========== CRIAR AGENDAMENTO ==========
// ... (sem alterações) ...
// ========== ENDPOINTS DA API ==========
app.post('/automate', async (req, res) => {
    // ... (sem alterações aqui, mas a melhoria de depuração será adicionada) ...
    
    let browser;
    let page;
    
    try {
        console.log('Iniciando browser...');
        
        browser = await puppeteer.launch({ /* ... suas args ... */ });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        // <-- MELHORIA DE DEPURAÇÃO: Mostra os logs do console do browser no seu terminal
        page.on('console', msg => {
            for (let i = 0; i < msg.args().length; ++i) {
                console.log(`[BROWSER CONSOLE] ${i}: ${msg.args()[i]}`);
            }
        });

        // ... (resto do seu endpoint /automate) ...
        
    } catch (error) {
        // ...
    } finally {
        // ...
    }
});
// ... (resto do seu código)
