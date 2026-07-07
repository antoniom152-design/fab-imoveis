/* ══════════════════════════════════════════════════════════════
   WAL FEIRÃO — Apps Script Operacional (1º Feirão de Imóveis)
   Dedicado só para o dashboard-feirao-lead.html — planilha própria,
   separada do CRM/Reserva de produção, para não competir por cota de
   execução/lock com o sistema do dia a dia da WAL.

   COMO IMPLANTAR:
   1. Crie uma planilha nova no Google Sheets chamada
      "WAL Feirão — Dados Operacionais" e copie o ID dela para
      PLANILHA_FEIRAO_ID abaixo.
   2. Abra Extensões → Apps Script nessa planilha, cole este arquivo.
   3. Rode a função `setupPlanilhaFeirao` uma vez (menu Executar →
      selecione a função → Executar). Isso cria todas as abas com
      cabeçalho, validação e proteção.
   4. Rode `criarTriggerNotificacoes` uma vez para instalar o gatilho
      de tempo que processa a fila de e-mail/WhatsApp.
   5. Implantar → Nova implantação → Aplicativo da Web → Executar como
      "Eu", Quem pode acessar "Qualquer pessoa". Copie a URL gerada e
      cole em FEIRAO_API_URL no dashboard-feirao-lead.html.
   6. Preencha PLANILHA_PRECADASTRO_ID (aba INSCRITOS) e
      PLANILHA_PRINCIPAL_ID (aba SIMULACOES, já usada por
      index.html/simulador.html) abaixo — os IDs já conhecidos do
      ecossistema WAL foram deixados preenchidos quando confirmados.
══════════════════════════════════════════════════════════════ */

/* ─── CONFIGURAÇÃO ────────────────────────────────────────────── */
var PLANILHA_FEIRAO_ID       = 'COLOQUE_AQUI_O_ID_DA_PLANILHA_WAL_FEIRAO_OPERACIONAL';

// Planilha principal de leads (já em produção) — usada só para também
// gravar a simulação na aba SIMULACOES genérica (mantém o contador que
// index.html/simulador.html já leem) e para o link com Drive de docs.
var PLANILHA_PRINCIPAL_ID    = '1UKSyzkYpVxtsSb4UrBvgslp7FFXtYk8DUeqJVGzk0M0';
var ABA_SIMULACOES_GERAL     = 'SIMULACOES';

// Planilha "Pre Cadastro 1 Feirao WAL" (aba INSCRITOS) — preencha o ID
// real. Enquanto estiver vazio, o login por e-mail simplesmente pula
// essa checagem (fail-soft) e só usa a aba PARTICIPANTES.
var PLANILHA_PRECADASTRO_ID  = '';
var ABA_INSCRITOS            = 'INSCRITOS';

var ABA_PARTICIPANTES   = 'PARTICIPANTES';
var ABA_JORNADA         = 'JORNADA_EVENTOS';
var ABA_SIMULACOES_FEIR = 'SIMULACOES_FEIRAO';
var ABA_CREDITO         = 'ANALISES_CREDITO';
var ABA_VISITAS_AGENDA  = 'AGENDAMENTOS_VISITA';
var ABA_MENSAGENS       = 'MENSAGENS_CONSULTOR';
var ABA_CHAT            = 'CHAT_MENSAGENS';
var ABA_PIX             = 'RESERVAS_PIX_FEIRAO';
var ABA_PAGAMENTO       = 'FLUXO_PAGAMENTO';
var ABA_FILA            = 'FILA_NOTIFICACOES';
var ABA_CONFIG          = 'CONFIG';

var PASTA_DRIVE_DOCS_ID = ''; // opcional — se vazio, cria/usa a pasta "WAL Feirão — Documentos Crédito"
var EMAIL_EQUIPE_FEIRAO = 'wal.imoveiseconsultoria@gmail.com';
var TZ = 'America/Sao_Paulo';

/* ─── SETUP ────────────────────────────────────────────────────── */
function setupPlanilhaFeirao() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);

  criarAbaSeNaoExiste_(ss, ABA_PARTICIPANTES, [
    'CPF', 'Nome', 'Email', 'WhatsApp', 'Vinculo', 'CRM_Lead_Id',
    'Emp_Selecionado', 'Unidade_Selecionada', 'Etapa_Atual',
    'Criado_em', 'Atualizado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_JORNADA, [
    'CPF', 'Evento_Key', 'Detalhe', 'Timestamp'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_SIMULACOES_FEIR, [
    'CPF', 'Nome', 'Email', 'Emp_Id', 'Valor_Imovel', 'Entrada', 'Prazo',
    'Taxa', 'Sistema_Escolhido', 'Encargo_SAC', 'Encargo_Price',
    'Encargo_CFIAe', 'Encargo_POUPEX', 'Timestamp'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_CREDITO, [
    'Protocolo', 'CPF', 'Nome', 'Email', 'Telefone', 'Estado_Civil',
    'Conjuge_Nome', 'Emp_Id', 'Unidade', 'Documentos_JSON', 'Status',
    'Valor_Aprovado', 'Entrada_Minima', 'Taxa', 'Data_Envio',
    'Data_Limite', 'Data_Liberacao', 'Consultor', 'Observacoes'
  ]);
  var abaCred = ss.getSheetByName(ABA_CREDITO);
  abaCred.getRange('K2:K999').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['enviado', 'em_analise', 'aprovado', 'reprovado'], true)
      .setAllowInvalid(true).build());

  criarAbaSeNaoExiste_(ss, ABA_VISITAS_AGENDA, [
    'CPF', 'Nome', 'Telefone', 'Emp_Id', 'Emp_Nome', 'Data', 'Horario',
    'Pessoas', 'Formato', 'Observacoes', 'Status', 'Timestamp'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_MENSAGENS, [
    'CPF', 'Nome', 'Telefone', 'Email', 'Assunto', 'Mensagem',
    'Timestamp', 'Status', 'Resposta', 'Respondido_em'
  ]);

  // Chat ao vivo (polling) entre atendente e lead — cada linha é UMA
  // mensagem, thread = CPF. Ver feirao_chatEnviar_/feirao_chatBuscar_.
  criarAbaSeNaoExiste_(ss, ABA_CHAT, [
    'CPF', 'Nome', 'Remetente', 'Texto', 'Timestamp', 'Lida'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_PIX, [
    'CPF', 'Nome', 'Emp_Id', 'Emp_Nome', 'Unidade', 'Valor', 'Status',
    'Data_Pagamento', 'Timestamp'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_PAGAMENTO, [
    'CPF', 'Emp_Id', 'Unidade', 'Estado_JSON', 'Progresso_Pct',
    'Atualizado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_FILA, [
    'Tipo', 'Destinatario', 'Payload_JSON', 'Processado', 'Criado_em'
  ]);

  var abaConfig = criarAbaSeNaoExiste_(ss, ABA_CONFIG, ['Chave', 'Valor']);
  if (abaConfig.getLastRow() < 2) {
    abaConfig.appendRow(['Negocios_Fechados_Base', 17]);
  }

  SpreadsheetApp.getUi().alert(
    '✅ Planilha do Feirão configurada!\n\n' +
    'Próximos passos:\n' +
    '1. Rode "criarTriggerNotificacoes" uma vez.\n' +
    '2. Implante como Aplicativo da Web (Executar como Eu, Acesso: Qualquer pessoa).\n' +
    '3. Cole a URL gerada em FEIRAO_API_URL no dashboard-feirao-lead.html.'
  );
}

function criarAbaSeNaoExiste_(ss, nome, headers) {
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length)
      .setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, headers.length).protect().setWarningOnly(true);
  }
  return aba;
}

function criarTriggerNotificacoes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processarFilaNotificacoes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processarFilaNotificacoes').timeBased().everyMinutes(2).create();
}

/* ─── UTILITÁRIOS ──────────────────────────────────────────────── */
function agora_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function s_(v) { return (v === null || v === undefined) ? '' : String(v); }
function limparDoc_(v) { return s_(v).replace(/\D/g, ''); }

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function jsonpOut_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) body = callback + '(' + body + ')';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* Executa fn() protegido por lock — usado em toda operação
   "achar linha → atualizar" para evitar corrida entre requisições
   simultâneas. Nunca envolve chamadas lentas (e-mail/WhatsApp) —
   só o read-modify-write da planilha. */
function comLock_(fn) {
  var lock = LockService.getScriptLock();
  var ok = lock.tryLock(10000);
  try {
    return fn();
  } finally {
    if (ok) lock.releaseLock();
  }
}

/* Lê uma aba inteira como array de objetos {header: valor} */
function lerAbaObjetos_(aba) {
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return [];
  var headers = dados[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (linha.every(function (c) { return c === '' || c === null || c === undefined; })) continue;
    var obj = { _row: i + 1 };
    headers.forEach(function (h, idx) { obj[h] = linha[idx]; });
    out.push(obj);
  }
  return out;
}

/* Acha o número da linha (1-based) cujo valor na coluna `header` bate
   com `valor` (comparação exata em string). Retorna -1 se não achar. */
function acharLinhaPorChave_(aba, header, valor) {
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return -1;
  var headers = dados[0].map(function (h) { return String(h).trim(); });
  var col = headers.indexOf(header);
  if (col === -1) return -1;
  var alvo = s_(valor).trim().toLowerCase();
  for (var i = 1; i < dados.length; i++) {
    if (s_(dados[i][col]).trim().toLowerCase() === alvo) return i + 1;
  }
  return -1;
}

/* ─── doGet — leituras com resposta (JSONP) ───────────────────── */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var callback = (e && e.parameter && e.parameter.callback) || '';
  try {
    var result;
    if (action === 'feirao_login') {
      result = feirao_login_(e.parameter.chave || '');
    } else if (action === 'feirao_status_credito') {
      result = feirao_statusCredito_(e.parameter.protocolo || '');
    } else if (action === 'feirao_stats') {
      result = feirao_stats_();
    } else if (action === 'feirao_chat_buscar') {
      result = feirao_chatBuscar_(e.parameter.cpf || '', e.parameter.since || '', e.parameter.leitor || '');
    } else if (action === 'feirao_chat_threads') {
      result = feirao_chatThreads_();
    } else {
      result = { error: 'Ação desconhecida: ' + action };
    }
    return jsonpOut_(callback, result);
  } catch (err) {
    return jsonpOut_(callback, { error: err.message });
  }
}

/* ─── doPost — escritas (fire-and-forget, no-cors no cliente) ─── */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var out = { status: 'ok' };
    if (data.action === 'feirao_participante') out = feirao_participante_(data);
    else if (data.action === 'feirao_evento') out = feirao_evento_(data);
    else if (data.action === 'feirao_simulacao') out = feirao_simulacao_(data);
    else if (data.action === 'feirao_credito') out = feirao_credito_(data);
    else if (data.action === 'feirao_agendamento') out = feirao_agendamento_(data);
    else if (data.action === 'feirao_mensagem') out = feirao_mensagem_(data);
    else if (data.action === 'feirao_chat_enviar') out = feirao_chatEnviar_(data);
    else if (data.action === 'feirao_pix') out = feirao_pix_(data);
    else if (data.action === 'feirao_pagamento') out = feirao_pagamento_(data);
    else out = { status: 'error', message: 'Ação desconhecida: ' + data.action };
    return jsonOut_(out);
  } catch (err) {
    Logger.log('ERRO doPost: ' + err.message);
    return jsonOut_({ status: 'error', message: err.message });
  }
}

/* ══════════════════════ LOGIN / PARTICIPANTE ══════════════════ */

function feirao_login_(chaveInput) {
  var chave = s_(chaveInput).trim();
  if (!chave) return { found: false };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_PARTICIPANTES);
  var linhas = lerAbaObjetos_(aba);
  var cpfBusca = limparDoc_(chave);
  var emailBusca = chave.toLowerCase();

  var achado = linhas.find(function (l) {
    return (cpfBusca && limparDoc_(l.CPF) === cpfBusca) ||
           (l.Email && s_(l.Email).toLowerCase() === emailBusca);
  });
  if (achado) {
    return {
      found: true, origem: 'participante',
      cpf: s_(achado.CPF), nome: s_(achado.Nome), email: s_(achado.Email),
      whatsapp: s_(achado.WhatsApp), vinculo: s_(achado.Vinculo),
      empSelecionado: s_(achado.Emp_Selecionado), unidadeSelecionada: s_(achado.Unidade_Selecionada),
      etapaAtual: s_(achado.Etapa_Atual)
    };
  }

  // Fail-soft: só olha INSCRITOS (pré-cadastro) se o ID estiver configurado
  if (PLANILHA_PRECADASTRO_ID) {
    try {
      var ssPre = SpreadsheetApp.openById(PLANILHA_PRECADASTRO_ID);
      var abaInsc = ssPre.getSheetByName(ABA_INSCRITOS);
      if (abaInsc) {
        var inscritos = lerAbaObjetos_(abaInsc);
        var achadoInsc = inscritos.find(function (l) {
          return l.email && s_(l.email).toLowerCase() === emailBusca;
        });
        if (achadoInsc) {
          return {
            found: true, origem: 'inscrito',
            nome: s_(achadoInsc.nome), email: s_(achadoInsc.email),
            whatsapp: s_(achadoInsc.whatsapp), vinculo: s_(achadoInsc.categoria)
          };
        }
      }
    } catch (e) { Logger.log('feirao_login_ INSCRITOS erro: ' + e.message); }
  }
  return { found: false };
}

function feirao_participante_(data) {
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PARTICIPANTES);
    var cpf = limparDoc_(data.cpf);
    if (!cpf) return { status: 'error', message: 'CPF obrigatório' };
    var linha = acharLinhaPorChave_(aba, 'CPF', cpf);
    var now = agora_();
    if (linha === -1) {
      aba.appendRow([
        cpf, data.nome || '', data.email || '', data.whatsapp || '', data.vinculo || '',
        data.crmLeadId || '', data.empSelecionado || '', data.unidadeSelecionada || '',
        data.etapaAtual || '', now, now
      ]);
    } else {
      var vals = aba.getRange(linha, 1, 1, 11).getValues()[0];
      aba.getRange(linha, 1, 1, 11).setValues([[
        cpf,
        data.nome !== undefined ? data.nome : vals[1],
        data.email !== undefined ? data.email : vals[2],
        data.whatsapp !== undefined ? data.whatsapp : vals[3],
        data.vinculo !== undefined ? data.vinculo : vals[4],
        data.crmLeadId !== undefined ? data.crmLeadId : vals[5],
        data.empSelecionado !== undefined ? data.empSelecionado : vals[6],
        data.unidadeSelecionada !== undefined ? data.unidadeSelecionada : vals[7],
        data.etapaAtual !== undefined ? data.etapaAtual : vals[8],
        vals[9], now
      ]]);
    }
    return { status: 'ok' };
  });
}

/* ══════════════════════ JORNADA (append-only) ═════════════════ */
function feirao_evento_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_JORNADA);
  comLock_(function () {
    aba.appendRow([limparDoc_(data.cpf), data.eventoKey || '', data.detalhe || '', agora_()]);
  });
  return { status: 'ok' };
}

/* ══════════════════════ SIMULAÇÃO ══════════════════════════════ */
function feirao_simulacao_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_SIMULACOES_FEIR);
  comLock_(function () {
    aba.appendRow([
      limparDoc_(data.cpf), data.nome || '', data.email || '', data.empId || '',
      data.valorImovel || 0, data.entrada || 0, data.prazo || 0, data.taxa || 0,
      data.sistemaEscolhido || '', data.encargoSac || 0, data.encargoPrice || 0,
      data.encargoCfiae || 0, data.encargoPoupex || 0, agora_()
    ]);
  });
  // Também grava na aba SIMULACOES genérica (compat com index.html/simulador.html),
  // sem travar a resposta principal caso essa planilha esteja indisponível.
  try {
    var ssPrincipal = SpreadsheetApp.openById(PLANILHA_PRINCIPAL_ID);
    var abaGeral = ssPrincipal.getSheetByName(ABA_SIMULACOES_GERAL);
    if (abaGeral) {
      abaGeral.appendRow([
        Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss'),
        data.whatsapp || '', data.nome || '', data.email || '', 1
      ]);
    }
  } catch (e) { Logger.log('feirao_simulacao_ SIMULACOES geral erro: ' + e.message); }
  return { status: 'ok' };
}

/* ══════════════════════ ANÁLISE DE CRÉDITO ═════════════════════ */
function feirao_credito_(data) {
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CREDITO);
    var protocolo = data.protocolo || '';
    if (!protocolo) return { status: 'error', message: 'Protocolo obrigatório' };

    var linksDocumentos = salvarDocumentosDrive_(data.documentos || [], protocolo);

    var linha = acharLinhaPorChave_(aba, 'Protocolo', protocolo);
    var now = agora_();
    var dataLimite = data.dataLimite || Utilities.formatDate(new Date(Date.now() + 24 * 3600000), TZ, "yyyy-MM-dd'T'HH:mm:ss");
    if (linha === -1) {
      aba.appendRow([
        protocolo, limparDoc_(data.cpf), data.nome || '', data.email || '', data.telefone || '',
        data.estadoCivil || '', data.conjugeNome || '', data.empId || '', data.unidade || '',
        JSON.stringify(linksDocumentos), 'enviado', 0, 0, data.taxa || 0,
        now, dataLimite, '', '', ''
      ]);
    } else {
      aba.getRange(linha, 10, 1, 1).setValue(JSON.stringify(linksDocumentos)); // Documentos_JSON
    }

    // Enfileira notificação para a equipe (não bloqueia a resposta ao usuário)
    enfileirarNotificacao_('credito_recebido', EMAIL_EQUIPE_FEIRAO, {
      protocolo: protocolo, nome: data.nome, telefone: data.telefone, email: data.email
    });

    return { status: 'ok', protocolo: protocolo };
  });
}

function feirao_statusCredito_(protocolo) {
  if (!protocolo) return { found: false };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CREDITO);
  var linhas = lerAbaObjetos_(aba);
  var achado = linhas.find(function (l) { return s_(l.Protocolo) === protocolo; });
  if (!achado) return { found: false };
  return {
    found: true,
    status: s_(achado.Status) || 'enviado',
    valorAprovado: Number(achado.Valor_Aprovado) || 0,
    entradaMinima: Number(achado.Entrada_Minima) || 0,
    taxa: Number(achado.Taxa) || 0,
    dataLimite: s_(achado.Data_Limite),
    dataLiberacao: s_(achado.Data_Liberacao)
  };
}

/* Ferramenta para o consultor aprovar/reprovar sem editar células direto —
   rodar via menu (aprovarCreditoMenu) ou diretamente no editor. */
function aprovarCredito(protocolo, valorAprovado, entradaMinima, taxa) {
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CREDITO);
    var linha = acharLinhaPorChave_(aba, 'Protocolo', protocolo);
    if (linha === -1) return { status: 'error', message: 'Protocolo não encontrado' };
    aba.getRange(linha, 11, 1, 6).setValues([[ // Status .. Data_Liberacao
      'aprovado', valorAprovado, entradaMinima, taxa,
      aba.getRange(linha, 15).getValue(), agora_()
    ]]);
    return { status: 'ok' };
  });
}

function aprovarCreditoMenu() {
  var ui = SpreadsheetApp.getUi();
  var protocolo = ui.prompt('Aprovar Crédito', 'Protocolo:', ui.ButtonSet.OK_CANCEL).getResponseText();
  var valor = Number(ui.prompt('Valor aprovado (R$):', ui.ButtonSet.OK_CANCEL).getResponseText()) || 0;
  var entrada = Number(ui.prompt('Entrada mínima (R$):', ui.ButtonSet.OK_CANCEL).getResponseText()) || 0;
  var taxa = Number(ui.prompt('Taxa concedida (% a.a.):', ui.ButtonSet.OK_CANCEL).getResponseText()) || 8.3;
  var r = aprovarCredito(protocolo, valor, entrada, taxa);
  ui.alert(r.status === 'ok' ? '✅ Crédito aprovado!' : '❌ ' + r.message);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Feirão WAL')
    .addItem('Configurar planilha (1ª vez)', 'setupPlanilhaFeirao')
    .addItem('Instalar gatilho de notificações (1ª vez)', 'criarTriggerNotificacoes')
    .addSeparator()
    .addItem('Aprovar Crédito (protocolo)...', 'aprovarCreditoMenu')
    .addToUi();
}

/* Decodifica anexos base64 (mesmo padrão de reserva.html/App Script WAL -
   Reserva) e salva no Drive; devolve só os links para a planilha. */
function salvarDocumentosDrive_(documentos, protocolo) {
  if (!documentos || !documentos.length) return [];
  var pasta = obterPastaDocumentos_();
  var subPasta = pasta.createFolder(protocolo);
  var links = [];
  documentos.forEach(function (doc) {
    try {
      if (!doc.base64 || doc.base64.length > 13000000) return; // ~10MB, evita payload gigante
      var bytes = Utilities.base64Decode(doc.base64);
      var blob = Utilities.newBlob(bytes, doc.tipo || 'application/octet-stream', doc.nome || 'documento');
      var arquivo = subPasta.createFile(blob);
      links.push({ campo: doc.campo || '', nome: doc.nome || '', url: arquivo.getUrl() });
    } catch (e) { Logger.log('salvarDocumentosDrive_ erro: ' + e.message); }
  });
  return links;
}
function obterPastaDocumentos_() {
  if (PASTA_DRIVE_DOCS_ID) return DriveApp.getFolderById(PASTA_DRIVE_DOCS_ID);
  var nome = 'WAL Feirão — Documentos Crédito';
  var it = DriveApp.getFoldersByName(nome);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nome);
}

/* ══════════════════════ AGENDAMENTO DE VISITA ══════════════════ */
function feirao_agendamento_(data) {
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_VISITAS_AGENDA);
    if (data.acao === 'cancelar') {
      var linha = acharLinhaPorChave_(aba, 'CPF', limparDoc_(data.cpf));
      if (linha !== -1) aba.getRange(linha, 11).setValue('cancelado'); // Status
      return { status: 'ok' };
    }
    aba.appendRow([
      limparDoc_(data.cpf), data.nome || '', data.telefone || '', data.empId || '',
      data.empNome || '', data.data || '', data.horario || '', data.pessoas || '',
      data.formato || '', data.observacoes || '', 'confirmado', agora_()
    ]);
    enfileirarNotificacao_('agendamento', EMAIL_EQUIPE_FEIRAO, {
      nome: data.nome, telefone: data.telefone, empNome: data.empNome,
      data: data.data, horario: data.horario
    });
    return { status: 'ok' };
  });
}

/* ══════════════════════ MENSAGEM AO CONSULTOR ══════════════════ */
function feirao_mensagem_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_MENSAGENS);
  comLock_(function () {
    aba.appendRow([
      limparDoc_(data.cpf), data.nome || '', data.telefone || '', data.email || '',
      data.assunto || '', data.mensagem || '', agora_(), 'nao_lida', '', ''
    ]);
  });
  enfileirarNotificacao_('mensagem_consultor', EMAIL_EQUIPE_FEIRAO, {
    nome: data.nome, telefone: data.telefone, assunto: data.assunto, mensagem: data.mensagem
  });
  return { status: 'ok' };
}

/* ══════════════════════ CHAT AO VIVO (polling) ══════════════════
   Substitui o WhatsApp Web no atendimento: atendente e lead trocam
   mensagens dentro do próprio dashboard. Thread = CPF. O widget
   (feirao/shared/chat-widget.js) faz polling em feirao_chat_buscar
   a cada poucos segundos passando `since` (timestamp da última
   mensagem já recebida) para trazer só o que é novo. */
function feirao_chatEnviar_(data) {
  return comLock_(function () {
    var cpf = limparDoc_(data.cpf);
    if (!cpf) return { status: 'error', message: 'CPF obrigatório' };
    var remetente = data.remetente === 'atendente' ? 'atendente' : 'cliente';
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CHAT);
    aba.appendRow([cpf, data.nome || '', remetente, data.texto || '', agora_(), false]);
    if (remetente === 'cliente') {
      enfileirarNotificacao_('chat_nova_mensagem', EMAIL_EQUIPE_FEIRAO, {
        cpf: cpf, nome: data.nome, texto: data.texto
      });
    }
    return { status: 'ok' };
  });
}

/* leitor = quem está buscando ('cliente' ou 'atendente') — usado só
   pra saber quais mensagens marcar como lidas (as da OUTRA ponta). */
function feirao_chatBuscar_(cpfInput, sinceInput, leitorInput) {
  var cpf = limparDoc_(cpfInput);
  if (!cpf) return { mensagens: [] };
  var leitor = leitorInput === 'atendente' ? 'atendente' : 'cliente';
  var remetenteAlheio = leitor === 'atendente' ? 'cliente' : 'atendente';

  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CHAT);
  var linhas = lerAbaObjetos_(aba);

  var mensagens = [];
  var linhasParaMarcarLidas = [];
  linhas.forEach(function (l) {
    if (s_(l.CPF) !== cpf) return;
    if (sinceInput && s_(l.Timestamp) <= sinceInput) return; // já entregue antes
    mensagens.push({
      remetente: s_(l.Remetente), texto: s_(l.Texto),
      timestamp: s_(l.Timestamp), nome: s_(l.Nome)
    });
    if (s_(l.Remetente) === remetenteAlheio && l.Lida !== true) linhasParaMarcarLidas.push(l._row);
  });

  if (linhasParaMarcarLidas.length) {
    comLock_(function () {
      linhasParaMarcarLidas.forEach(function (row) { aba.getRange(row, 6).setValue(true); }); // coluna Lida
    });
  }
  return { mensagens: mensagens };
}

/* Lista de conversas (uma por CPF) com a última mensagem e contagem
   de não lidas do lado do cliente — usada pelo inbox do atendente. */
function feirao_chatThreads_() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CHAT);
  var linhas = lerAbaObjetos_(aba);

  var porCpf = {}, naoLidasPorCpf = {};
  linhas.forEach(function (l) {
    var cpf = s_(l.CPF);
    if (!cpf) return;
    if (!porCpf[cpf] || s_(l.Timestamp) > porCpf[cpf].ultimoTimestamp) {
      porCpf[cpf] = {
        cpf: cpf, nome: s_(l.Nome), ultimaMensagem: s_(l.Texto),
        ultimoTimestamp: s_(l.Timestamp), ultimoRemetente: s_(l.Remetente)
      };
    }
    if (s_(l.Remetente) === 'cliente' && l.Lida !== true) {
      naoLidasPorCpf[cpf] = (naoLidasPorCpf[cpf] || 0) + 1;
    }
  });

  var threads = Object.keys(porCpf).map(function (cpf) {
    var t = porCpf[cpf];
    t.naoLidas = naoLidasPorCpf[cpf] || 0;
    return t;
  });
  threads.sort(function (a, b) { return a.ultimoTimestamp < b.ultimoTimestamp ? 1 : -1; });
  return { threads: threads };
}

/* ══════════════════════ PIX / RESERVA (autodeclarado) ═══════════ */
function feirao_pix_(data) {
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PIX);
    var dados = aba.getDataRange().getValues();
    var linha = -1;
    for (var i = 1; i < dados.length; i++) {
      if (limparDoc_(dados[i][0]) === limparDoc_(data.cpf) && s_(dados[i][2]) === s_(data.empId)) { linha = i + 1; break; }
    }
    var status = data.paga ? 'autodeclarado_pendente_confirmacao' : 'nao_pago';
    if (linha === -1) {
      aba.appendRow([
        limparDoc_(data.cpf), data.nome || '', data.empId || '', data.empNome || '',
        data.unidade || '', data.valor || 0, status, data.dataPagamento || '', agora_()
      ]);
    } else {
      aba.getRange(linha, 6, 1, 3).setValues([[data.valor || 0, status, data.dataPagamento || '']]);
    }
    if (data.paga) {
      enfileirarNotificacao_('pix_autodeclarado', EMAIL_EQUIPE_FEIRAO, {
        nome: data.nome, empNome: data.empNome, valor: data.valor
      });
    }
    return { status: 'ok' };
  });
}

/* ══════════════════════ FLUXO DE PAGAMENTO ══════════════════════ */
function feirao_pagamento_(data) {
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PAGAMENTO);
    var linha = acharLinhaPorChave_(aba, 'CPF', limparDoc_(data.cpf));
    var row = [
      limparDoc_(data.cpf), data.empId || '', data.unidade || '',
      JSON.stringify(data.estado || {}), data.progressoPct || 0, agora_()
    ];
    if (linha === -1) aba.appendRow(row);
    else aba.getRange(linha, 1, 1, row.length).setValues([row]);
    return { status: 'ok' };
  });
}

/* ══════════════════════ ESTATÍSTICAS "AO VIVO" ══════════════════ */
function feirao_stats_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('feirao_stats');
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var base = 17;
  var abaConfig = ss.getSheetByName(ABA_CONFIG);
  if (abaConfig) {
    var cfg = lerAbaObjetos_(abaConfig);
    var linhaBase = cfg.find(function (l) { return l.Chave === 'Negocios_Fechados_Base'; });
    if (linhaBase) base = Number(linhaBase.Valor) || base;
  }

  var confirmados = 0;
  var abaPix = ss.getSheetByName(ABA_PIX);
  if (abaPix) {
    confirmados += lerAbaObjetos_(abaPix).filter(function (l) {
      return l.Status === 'autodeclarado_pendente_confirmacao' || l.Status === 'confirmado';
    }).length;
  }
  var abaCredito = ss.getSheetByName(ABA_CREDITO);
  var aprovados = 0;
  if (abaCredito) {
    aprovados = lerAbaObjetos_(abaCredito).filter(function (l) { return l.Status === 'aprovado'; }).length;
  }

  var result = { negociosFechados: base + confirmados, aprovacoesCredito: aprovados };
  cache.put('feirao_stats', JSON.stringify(result), 120); // 2 min
  return result;
}

/* ══════════════════════ FILA DE NOTIFICAÇÕES ════════════════════
   Efeitos colaterais lentos (e-mail/WhatsApp) nunca bloqueiam a
   resposta ao usuário — viram uma linha aqui e um gatilho de tempo
   (a cada 2 min, ver criarTriggerNotificacoes) processa em lote. */
function enfileirarNotificacao_(tipo, destinatario, payload) {
  try {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_FILA);
    aba.appendRow([tipo, destinatario, JSON.stringify(payload), false, agora_()]);
  } catch (e) { Logger.log('enfileirarNotificacao_ erro: ' + e.message); }
}

function processarFilaNotificacoes() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_FILA);
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (dados[i][3] === true) continue; // já processado
    var tipo = dados[i][0], destinatario = dados[i][1];
    var payload = {};
    try { payload = JSON.parse(dados[i][2] || '{}'); } catch (e) {}
    try {
      MailApp.sendEmail({
        to: destinatario,
        subject: '🎪 Feirão WAL — ' + tipo,
        body: JSON.stringify(payload, null, 2)
      });
      aba.getRange(i + 1, 4).setValue(true);
    } catch (e) {
      Logger.log('processarFilaNotificacoes erro linha ' + (i + 1) + ': ' + e.message);
    }
  }
}
