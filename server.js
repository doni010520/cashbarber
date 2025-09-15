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
    
    await page.goto(CONFIG.baseUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Aguardar formulário de login
    await page.waitForSelector('form.kt-form', { 
      visible: true,
      timeout: 10000 
    });
    
    // Preencher credenciais
    await page.type('input[name="email"]', CONFIG.credentials.email);
    await page.type('input[name="password"]', CONFIG.credentials.password);
    
    await delay(500);
    
    // Fazer login
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('#kt_login_signin_submit')
    ]);
    
    // Verificar se login foi bem sucedido
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      throw new Error('Login falhou - verifique as credenciais');
    }
    
    console.log('Login realizado com sucesso!');
    return { success: true };
    
  } catch (error) {
    console.error('Erro no login:', error);
    return { success: false, error: error.message };
  }
}

// ========== VERIFICAR DISPONIBILIDADE ==========
async function checkAvailability(page, professionalName, date) {
  try {
    console.log(`Verificando disponibilidade para ${professionalName} em ${date}`);
    
    // Navegar para agendamentos
    await page.goto(`${CONFIG.baseUrl}/agendamento`, {
      waitUntil: 'networkidle2'
    });
    
    await delay(3000); // Aguardar calendário carregar
    
    // Verificar horários no calendário
    const disponibilidade = await page.evaluate((profName) => {
      const profissionaisOrdem = ['Bruno Oliveira', 'Miguel Oliveira', 'Maicon Fraga'];
      
      const profIndex = profissionaisOrdem.findIndex(p => 
        p.toLowerCase().includes(profName.toLowerCase()) || 
        profName.toLowerCase().includes(p.toLowerCase().split(' ')[0])
      );
      
      if (profIndex === -1) {
        return { 
          success: false, 
          message: 'Profissional não encontrado',
          profissionaisDisponiveis: profissionaisOrdem
        };
      }
      
      // Buscar eventos do calendário
      const eventos = document.querySelectorAll('.rbc-event');
      const horariosOcupados = [];
      
      eventos.forEach(evento => {
        try {
          const colunaEvento = evento.closest('.rbc-day-slot');
          if (!colunaEvento) return;
          
          const todasColunas = document.querySelectorAll('.rbc-day-slot');
          const indexColuna = Array.from(todasColunas).indexOf(colunaEvento);
          
          if (indexColuna === profIndex) {
            const textoEvento = evento.textContent || '';
            const horariosMatch = textoEvento.match(/\d{2}:\d{2}/g);
            if (horariosMatch) {
              horariosOcupados.push(...horariosMatch);
            }
          }
        } catch (e) {
          console.error('Erro ao processar evento:', e);
        }
      });
      
      // Gerar todos os horários possíveis (14:00 às 20:00)
      const todosHorarios = [];
      for(let h = 14; h < 20; h++) {
        todosHorarios.push(`${h.toString().padStart(2, '0')}:00`);
        todosHorarios.push(`${h.toString().padStart(2, '0')}:30`);
      }
      
      // Filtrar horários livres
      const horariosLivres = todosHorarios.filter(h => 
        !horariosOcupados.includes(h)
      );
      
      return {
        success: true,
        profissional: profissionaisOrdem[profIndex],
        data: profName,
        horariosLivres: horariosLivres,
        horariosOcupados: horariosOcupados,
        totalLivres: horariosLivres.length,
        totalOcupados: horariosOcupados.length
      };
    }, professionalName);
    
    return disponibilidade;
    
  } catch (error) {
    console.error('Erro ao verificar disponibilidade:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// ========== CRIAR AGENDAMENTO ==========
async function createBooking(page, bookingData) {
  try {
    console.log('Criando agendamento:', bookingData);
    
    // Primeiro verificar disponibilidade
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
    
    // Clicar no botão "Novo agendamento"
    const btnNovo = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.textContent.trim() === 'Novo agendamento');
    });
    
    if (!btnNovo) {
      throw new Error('Botão "Novo agendamento" não encontrado');
    }
    
    await btnNovo.click();
    await delay(2000);
    
    // Aguardar modal abrir
    await page.waitForSelector('#age_id_cliente', { 
      visible: true,
      timeout: 5000 
    });
    
    // Preencher formulário
    const selects = await page.$$('select');
    
    // 1. Tipo de agendamento
    if (selects[0]) {
      await selects[0].select('Agendamento');
    }
    
    // 2. Cliente
    await page.click('#age_id_cliente');
    await page.type('#age_id_cliente', bookingData.clientName);
    await delay(1000);
    
    // 3. Data
    await page.evaluate((dateValue) => {
      const dateInput = document.querySelector('input[name="age_data"]');
      if (dateInput) {
        dateInput.value = dateValue;
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, bookingData.date);
    
    // 4. Hora início
    await page.evaluate((timeValue) => {
      const timeInput = document.querySelector('input[name="age_inicio"]');
      if (timeInput) {
        timeInput.value = timeValue;
        timeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, bookingData.time);
    
    // 5. Calcular e preencher hora fim
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
    
    // 6. Filial (Centro)
    if (selects[2]) {
      await selects[2].select(CONFIG.filialId);
    }
    
    // 7. Profissional
    const professionalId = CONFIG.profissionais[bookingData.professionalName] || 
                          CONFIG.profissionais[bookingData.professionalName.toLowerCase()] ||
                          '73'; // Default para Bruno
    
    if (selects[3]) {
      await selects[3].select(professionalId);
    }
    
    // 8. Serviço
    if (bookingData.services) {
      await page.click('#id_usuario_servico');
      await page.type('#id_usuario_servico', bookingData.services);
      await delay(1000);
    }
    
    await delay(1000);
    
    // 9. Salvar
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
    
    // Verificar se salvou com sucesso
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
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// ========== ENDPOINTS DA API ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'Cash Barber Automation',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal de automação
app.post('/automate', async (req, res) => {
  const { 
    action, 
    clientName, 
    clientPhone, 
    professionalName, 
    services, 
    date, 
    time, 
    duracao 
  } = req.body;
  
  console.log('Requisição recebida:', { action, clientName, date, time });
  
  // Validar dados obrigatórios
  if (!action) {
    return res.status(400).json({
      success: false,
      error: 'Ação é obrigatória (check, list ou create)'
    });
  }
  
  if (action === 'create' && (!clientName || !date || !time)) {
    return res.status(400).json({
      success: false,
      error: 'Para criar agendamento: clientName, date e time são obrigatórios'
    });
  }
  
  let browser;
  let page;
  
  try {
    console.log('Iniciando browser...');
    
    // Iniciar Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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
    
    // Fazer login
    const loginResult = await loginCashBarber(page);
    if (!loginResult.success) {
      throw new Error(loginResult.error || 'Falha no login');
    }
    
    let result;
    
    // Executar ação solicitada
    switch (action) {
      case 'check':
      case 'list':
        result = await checkAvailability(
          page, 
          professionalName || 'Bruno Oliveira', 
          date || new Date().toISOString().split('T')[0]
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
        result = {
          success: false,
          error: `Ação inválida: ${action}. Use: check, list ou create`
        };
    }
    
    console.log('Resultado:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Erro na automação:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
  } finally {
    // Fechar browser
    if (page) await page.close();
    if (browser) await browser.close();
    console.log('Browser fechado');
  }
});

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    name: 'Cash Barber Automation API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      automate: 'POST /automate'
    },
    actions: ['check', 'list', 'create'],
    example: {
      action: 'check',
      professionalName: 'Bruno Oliveira',
      date: '2025-01-20',
      time: '15:00'
    }
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║   Cash Barber Automation Service       ║
║   Rodando na porta ${PORT}                  ║
║   http://localhost:${PORT}                  ║
╚════════════════════════════════════════╝
  `);
});
