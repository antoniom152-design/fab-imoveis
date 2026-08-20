/* ══════════════════════════════════════════════════════════
   WAL IMÓVEIS — Apps Script · Formulário de Reserva e Leads
   ⚙ CONFIGURE as variáveis abaixo antes de implantar
   Data: 04-08-26 as 08:40h
   Alterado: 20-08-2026 as 10:30hs
══════════════════════════════════════════════════════════ */

var EMAIL_DESTINO  = 'comercial@walservidor.com.br';
var WPP_DADOS      = [
  { phone: '5522998136409', apikey: '8406411' },
  { phone: '5521972443592', apikey: '' }
];
var LOG_PLANILHA   = true;
var PLANILHA_ID    = '1UKSyzkYpVxtsSb4UrBvgslp7FFXtYk8DUeqJVGzk0M0';
var ABA_RESERVA    = 'RESERVA';
var ABA_LEADS      = 'Leads';
var ABA_SIMULACOES = 'SIMULACOES';
var ABA_VISITAS    = 'VISITAS';
var ABA_VISITAS_EMP = 'VISITAS_EMPREENDIMENTOS';
var ABA_EBOOK      = 'EBOOK FINANCIAMENTO';
var ABA_CONSTRUTORAS    = 'CONSTRUTORAS';
var PLANILHA_IMOVEIS_ID = '1Gl7YzDSVoXr_EIwv78L50I8uErhmVRhvwwaJ-2xYwnk'; // WAL Imóveis — Portfólio
var ABA_IMOVEIS         = 'IMOVEISDISPONIVEIS';
var PASTA_DRIVE_ID = '';
var TZ              = Session.getScriptTimeZone() || 'America/Sao_Paulo';

/* Remetente do e-mail — via API transacional do Brevo, NÃO
   MailApp.sendEmail(). Essa conta Google Workspace bloqueia o escopo
   "mail.send" para Apps Script (mesmo motivo que já quebrou o envio
   de e-mail do Feirão Online) — era exatamente isso que impedia
   publicar qualquer versão nova deste script (erro 400: invalid_scope
   ao tentar reautorizar). UrlFetchApp usa o escopo "script.external_
   request", que é permitido. Requer a propriedade de script
   BREVO_API_KEY (Configurações do projeto ⚙ → Propriedades do script)
   — projeto separado dos outros, a chave precisa ser configurada aqui
   também. */
var BREVO_SENDER_EMAIL = 'wal@walservidor.com.br';
var BREVO_SENDER_NOME  = 'WAL Imóveis';

function brevoApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
}

/* opts.replyTo: e-mail para responder · opts.attachments: [{content:base64, name}] */
function enviarEmailBrevo_(destinatario, assunto, corpoHtml, opts) {
  var apiKey = brevoApiKey_();
  if (!apiKey) { Logger.log('enviarEmailBrevo_: BREVO_API_KEY não configurada nas Propriedades do script.'); return false; }
  opts = opts || {};
  var payload = {
    sender: { name: BREVO_SENDER_NOME, email: BREVO_SENDER_EMAIL },
    to: [{ email: destinatario }],
    subject: assunto
  };
  if (opts.textOnly) payload.textContent = corpoHtml; else payload.htmlContent = corpoHtml;
  if (opts.replyTo) payload.replyTo = { email: opts.replyTo };
  if (opts.attachments && opts.attachments.length) payload.attachment = opts.attachments;
  try {
    var resp = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'api-key': apiKey, accept: 'application/json' },
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    });
    var codigoResp = resp.getResponseCode();
    if (codigoResp >= 200 && codigoResp < 300) return true;
    Logger.log('enviarEmailBrevo_ erro: Brevo respondeu ' + codigoResp + ' — ' + resp.getContentText());
    return false;
  } catch (e) {
    Logger.log('enviarEmailBrevo_ erro: ' + e.message);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════ */

/* ─── doGet — leitura JSONP para o painel admin ─────────── */
function doGet(e) {
  var action   = (e && e.parameter && e.parameter.action)   || '';
  var callback = (e && e.parameter && e.parameter.callback) || 'callback';

  try {
    var result = {};

    if (action === 'getLeads') {
      result = lerAba(ABA_LEADS);
    } else if (action === 'getReservas') {
      result = lerAba(ABA_RESERVA);
    } else if (action === 'getSimulacoes') {
      result = lerAba(ABA_SIMULACOES);
    } else if (action === 'getVisitas') {
      result = lerAba(ABA_VISITAS);
    } else if (action === 'getVisitasEmpreendimentos') {
      result = lerAba(ABA_VISITAS_EMP);
    } else if (action === 'checkSim') {
      result = checkTelefone(ABA_SIMULACOES, e.parameter.fone || '');
    } else if (action === 'checkEbook') {
      result = checkTelefone(ABA_EBOOK, e.parameter.fone || '');
    } else if (action === 'getConstrutoras') {
      result = lerAba(ABA_CONSTRUTORAS);
    } else {
      result = { error: 'Ação desconhecida: ' + action };
    }

    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);

  } catch (err) {
    Logger.log('ERRO doGet: ' + err.message);
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify({ error: err.message }) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

/* Verifica se um telefone existe na aba — retorna { exists: true/false } */
function checkTelefone(nomeAba, fone) {
  if (!fone) return { exists: false };
  var foneLimpo = fone.replace(/\D/g, '');
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = ss.getSheetByName(nomeAba);
    if (!aba) return { exists: false };
    var dados = aba.getDataRange().getValues();
    if (dados.length < 2) return { exists: false };
    var headers = dados[0].map(function(h) { return String(h).trim().toLowerCase(); });
    // Procura coluna chamada "telefone", "whatsapp", "fone" ou "celular"
    var colIdx = -1;
    ['telefone','whatsapp','fone','celular'].forEach(function(nome) {
      if (colIdx === -1) {
        var idx = headers.indexOf(nome);
        if (idx !== -1) colIdx = idx;
      }
    });
    if (colIdx === -1) return { exists: false, info: 'Coluna de telefone não encontrada' };
    for (var i = 1; i < dados.length; i++) {
      var cel = String(dados[i][colIdx] || '').replace(/\D/g, '');
      if (cel === foneLimpo) return { exists: true };
    }
    return { exists: false };
  } catch (err) {
    Logger.log('checkTelefone erro: ' + err.message);
    return { exists: false };
  }
}

/* Lê uma aba e retorna { rows: [ {col1: val, col2: val, ...}, ... ] } */
function lerAba(nomeAba) {
  var ss  = SpreadsheetApp.openById(PLANILHA_ID);
  var aba = ss.getSheetByName(nomeAba);
  if (!aba) return { rows: [], info: 'Aba "' + nomeAba + '" não encontrada' };

  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return { rows: [] };

  var headers = dados[0].map(function(h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    // Ignora linhas completamente vazias
    if (linha.every(function(c) { return c === '' || c === null || c === undefined; })) continue;
    var obj = {};
    headers.forEach(function(h, idx) {
      var v = linha[idx];
      // Se o Sheets converteu a célula pra Data (comum quando o texto gravado
      // parece uma data), String(v) gera "Thu May 28 2026 15:08:37 GMT-0300
      // (Horário Padrão de Brasília)" — formata em dd/MM/yyyy HH:mm:ss (o
      // formato que filtraPorData(), no admin.html, já sabe reconhecer).
      if (v instanceof Date) {
        obj[h] = Utilities.formatDate(v, TZ, 'dd/MM/yyyy HH:mm:ss');
      } else {
        obj[h] = v !== undefined && v !== null ? String(v) : '';
      }
    });
    rows.push(obj);
  }
  return { rows: rows };
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if      (data.tipo === 'reserva')            processarReserva(data);
    else if (data.tipo === 'lead')               processarLead(data);
    else if (data.tipo === 'simulacao')          processarSimulacao(data);
    else if (data.tipo === 'ebook')              processarEbook(data);
    else if (data.tipo === 'compartilhar_email')  processarCompartilharEmail(data);
    else if (data.tipo === 'visita')              processarVisita(data);
    else if (data.tipo === 'visita_empreendimento') processarVisitaEmpreendimento(data);
    else if (data.tipo === 'imovel')              processarImovel(data);
    else if (data.tipo === 'construtora')         processarConstrutora(data);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('ERRO doPost: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ─── LEAD (formulário index.html) ────────────────────── */
function processarLead(data) {

  // 1. Salva na aba Leads
  if (LOG_PLANILHA) {
    try {
      var ss  = SpreadsheetApp.openById(PLANILHA_ID);
      var aba = ss.getSheetByName(ABA_LEADS);
      if (!aba) {
        aba = ss.insertSheet(ABA_LEADS);
        aba.appendRow([
          'Timestamp','Nome','WhatsApp','Posto/Cargo','Base/Unidade',
          'Cidade Desejada','Faixa de Valor','Forma de Pagamento','Origem',
          'Estado','Bairro Desejado','Imovel de Interesse','E-mail'
        ]);
        aba.getRange(1,1,1,13).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
        aba.setFrozenRows(1);
      }
      // Coluna 'E-mail' entrou depois (05/08/2026) — vai como col M, no fim,
      // pra não mexer na ordem das colunas A→L já em uso na aba real.
      aba.appendRow([
        data.timestamp        || '',   // col A — Timestamp
        data.nome             || '',   // col B — Nome
        data.whatsapp         || '',   // col C — WhatsApp
        data.posto            || '',   // col D — Posto/Cargo
        data.base             || '',   // col E — Base/Unidade
        data.cidade           || '',   // col F — Cidade Desejada
        data.faixa_valor      || '',   // col G — Faixa de Valor
        data.forma_pagamento  || '',   // col H — Forma de Pagamento
        data.origem           || '',   // col I — Origem
        data.estado           || '',   // col J — Estado
        data.bairro_desejado  || '',   // col K — Bairro Desejado
        data.imovel_interesse || '',   // col L — Imovel de Interesse
        data.email             || ''   // col M — E-mail
      ]);
      Logger.log('Lead salvo na aba ' + ABA_LEADS);
    } catch (e) { Logger.log('Lead planilha erro: ' + e.message); }
  }

  // 2. Envia e-mail de notificação
  try {
    enviarEmailBrevo_(EMAIL_DESTINO, '📋 Novo Lead — ' + (data.nome || 'Desconhecido'),
        '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">' +
        '<div style="background:#0A1628;padding:18px 24px;border-bottom:3px solid #C9A84C">' +
          '<h2 style="color:#C9A84C;margin:0;font-size:18px">WAL Imóveis — Novo Lead</h2>' +
          '<p style="color:#8A96A8;margin:4px 0 0;font-size:12px">Recebido em: ' + (data.timestamp || '') + '</p>' +
        '</div>' +
        '<div style="padding:24px;background:#f9f9f9">' +
          '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
            linhaHtml('Nome',                 data.nome) +
            linhaHtml('E-mail',               data.email) +
            linhaHtml('WhatsApp',             data.whatsapp) +
            linhaHtml('Posto/Cargo',          data.posto) +
            linhaHtml('Base/Unidade',         data.base) +
            linhaHtml('Estado (UF)',           data.estado) +
            linhaHtml('Cidade Desejada',      data.cidade) +
            linhaHtml('Bairro Desejado',      data.bairro_desejado) +
            linhaHtml('Faixa de Valor',       data.faixa_valor) +
            linhaHtml('Forma de Pagamento',   data.forma_pagamento) +
            linhaHtml('Imóvel de Interesse',  data.imovel_interesse) +
            linhaHtml('Quer Agendar',         data.quer_agendar) +
            linhaHtml('Origem',               data.origem) +
          '</table>' +
        '</div>' +
        '<div style="background:#0A1628;padding:12px;text-align:center">' +
          '<p style="color:#555;font-size:11px;margin:0">WAL Imóveis · CRECI 12261-J</p>' +
        '</div></div>');
  } catch (e) { Logger.log('Lead email erro: ' + e.message); }
}

/* ─── RESERVA COMPLETA (reserva.html) ─────────────────── */
function processarReserva(data) {

  var temConjuge = !!(data.conjuge && data.conjuge.nome && data.conjuge.nome.trim() !== '');
  Logger.log('temConjuge: ' + temConjuge);
  if (temConjuge) Logger.log('Cônjuge: ' + data.conjuge.nome);

  // 1. Prepara anexos (formato Brevo — base64 direto, sem precisar de Blob)
  var anexosBrevo = [];
  if (data.documentos) {
    data.documentos.forEach(function (doc) {
      if (doc.base64 && doc.base64.length < 13000000) {
        anexosBrevo.push({ content: doc.base64, name: doc.nome || 'documento' });
      }
    });
  }

  // 2. Separa docs titular / cônjuge
  var docsTitular = (data.documentos || []).filter(function (d) {
    return d.descricao.indexOf('Cônjuge') === -1;
  });
  var docsConjuge = (data.documentos || []).filter(function (d) {
    return d.descricao.indexOf('Cônjuge') !== -1;
  });

  // 3. Monta e-mail HTML
  var cor = '#C9A84C';

  var secaoConjuge = '';
  if (temConjuge) {
    secaoConjuge =
      '<h2 style="color:#0A1628;border-bottom:2px solid ' + cor + ';padding-bottom:6px;font-size:16px;margin-top:24px">💍 Cônjuge / Companheiro(a)</h2>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">' +
        linhaHtml('Nome',         data.conjuge.nome) +
        linhaHtml('Nascimento',   data.conjuge.nascimento) +
        linhaHtml('Telefone/WPP', data.conjuge.telefone) +
        linhaHtml('E-mail',       data.conjuge.email || '—') +
        linhaHtml('CPF',          data.conjuge.cpf) +
      '</table>';
  }

  var secaoDocsConjuge = '';
  if (temConjuge && docsConjuge.length > 0) {
    secaoDocsConjuge =
      '<h2 style="color:#0A1628;border-bottom:2px solid ' + cor + ';padding-bottom:6px;font-size:16px">📎 Docs Cônjuge (' + docsConjuge.length + ')</h2>' +
      '<ul style="font-size:14px;color:#333">' +
        docsConjuge.map(function (d) { return '<li>' + d.descricao + ': ' + d.nome + '</li>'; }).join('') +
      '</ul>';
  }

  var assunto = temConjuge
    ? '🏠 Nova Reserva — ' + data.nome + ' e cônjuge ' + data.conjuge.nome + ' | ' + data.empreendimento
    : '🏠 Nova Reserva — ' + data.nome + ' | ' + data.empreendimento;

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">' +
    '<div style="background:#0A1628;padding:24px 32px;border-bottom:3px solid ' + cor + '">' +
      '<h1 style="color:' + cor + ';margin:0;font-size:22px">WAL Imóveis</h1>' +
      '<p style="color:#8A96A8;margin:4px 0 0;font-size:12px">CRECI 12261-J · Nova Solicitação de Reserva</p>' +
    '</div>' +
    '<div style="background:#f9f9f9;padding:28px 32px">' +
      '<p style="font-size:13px;color:#888">Recebida em: ' + data.timestamp + '</p>' +
      '<h2 style="color:#0A1628;border-bottom:2px solid ' + cor + ';padding-bottom:6px;font-size:16px">👤 Dados do Titular</h2>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">' +
        linhaHtml('Nome',            data.nome) +
        linhaHtml('Nascimento',      data.nascimento) +
        linhaHtml('Telefone/WPP',    data.telefone) +
        linhaHtml('E-mail',          data.email) +
        linhaHtml('CPF',             data.cpf) +
        linhaHtml('Estado Civil',    data.estado_civil) +
      '</table>' +
      secaoConjuge +
      '<h2 style="color:#0A1628;border-bottom:2px solid ' + cor + ';padding-bottom:6px;font-size:16px;margin-top:24px">🏠 Dados do Imóvel</h2>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">' +
        linhaHtml('Empreendimento',   data.empreendimento, true) +
        linhaHtml('Faixa de Valor',   data.faixa_valor) +
        linhaHtml('Valor de Entrada', data.valor_entrada) +
        linhaHtml('Forma Pagamento',  data.forma_pagamento) +
        linhaHtml('Detalhes',         data.detalhes || 'Não informado') +
      '</table>' +
      '<h2 style="color:#0A1628;border-bottom:2px solid ' + cor + ';padding-bottom:6px;font-size:16px">📎 Docs Titular (' + docsTitular.length + ')</h2>' +
      '<ul style="font-size:14px;color:#333">' +
        docsTitular.map(function (d) { return '<li>' + d.descricao + ': ' + d.nome + '</li>'; }).join('') +
      '</ul>' +
      secaoDocsConjuge +
      '<div style="background:#0A1628;padding:14px 18px;border-left:4px solid ' + cor + ';margin-top:20px">' +
        '<p style="color:#E8C97A;margin:0;font-size:14px;font-weight:bold">⚡ Entre em contato em até 24 horas.</p>' +
        '<p style="color:#8A96A8;margin:6px 0 0;font-size:12px">WhatsApp: ' + data.telefone + '</p>' +
      '</div>' +
    '</div>' +
    '<div style="background:#0A1628;padding:14px;text-align:center">' +
      '<p style="color:#555;font-size:11px;margin:0">WAL Imóveis · CRECI 12261-J</p>' +
    '</div></div>';

  // 4. Envia e-mail para a imobiliária
  enviarEmailBrevo_(EMAIL_DESTINO, assunto, html, { replyTo: data.email, attachments: anexosBrevo });

  // 5. E-mail de confirmação ao cliente
  try {
    enviarEmailBrevo_(data.email, '✅ WAL Imóveis — Recebemos sua reserva!',
        '<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">' +
        '<div style="background:#0A1628;padding:24px;border-bottom:3px solid #C9A84C;text-align:center">' +
          '<h1 style="color:#C9A84C;margin:0">WAL Imóveis</h1></div>' +
        '<div style="padding:28px;background:#f9f9f9">' +
          '<p>Olá, <strong>' + data.nome + '</strong>!</p>' +
          '<p style="color:#555;line-height:1.7">Recebemos sua solicitação para <strong>' + data.empreendimento + '</strong>.<br>' +
          'Entraremos em contato em até <strong>24 horas</strong> pelo número <strong>' + data.telefone + '</strong>.</p>' +
          '<p style="color:#555">Dúvidas? WhatsApp: <a href="https://wa.me/5521972443592" style="color:#C9A84C">(21) 97244-3592</a></p>' +
        '</div></div>');
  } catch (e) { Logger.log('Erro e-mail cliente: ' + e.message); }

  // 6. WhatsApp via CallMeBot
  var wppTxt =
    '🏠 *NOVA RESERVA – WAL Imóveis*\n\n' +
    '👤 *Titular: ' + data.nome + '*\n' +
    '📱 ' + data.telefone + '\n' +
    '📧 ' + data.email + '\n' +
    '🆔 CPF: ' + data.cpf + '\n' +
    '💍 ' + data.estado_civil +
    (temConjuge
      ? '\n\n👤 *Cônjuge: ' + data.conjuge.nome + '*\n' +
        '📱 ' + data.conjuge.telefone + '\n' +
        '🆔 CPF: ' + data.conjuge.cpf
      : '') +
    '\n\n🏠 *' + data.empreendimento + '*\n' +
    '💰 ' + data.faixa_valor + '\n' +
    '💵 Entrada: ' + data.valor_entrada + '\n' +
    '💳 ' + data.forma_pagamento + '\n' +
    (data.detalhes ? '📝 ' + data.detalhes + '\n' : '') +
    '📎 ' + (data.documentos ? data.documentos.length : 0) + ' doc(s)\n' +
    '⏰ ' + data.timestamp;

  WPP_DADOS.forEach(function (n) {
    if (!n.apikey || n.apikey === '') return;
    try {
      var url = 'https://api.callmebot.com/whatsapp.php?phone=' + n.phone +
                '&text=' + encodeURIComponent(wppTxt) + '&apikey=' + n.apikey;
      UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      Logger.log('WPP enviado: ' + n.phone);
    } catch (e) { Logger.log('WPP erro ' + n.phone + ': ' + e.message); }
  });

  // 7. Grava na aba RESERVA
  if (LOG_PLANILHA) {
    try {
      var ss  = SpreadsheetApp.openById(PLANILHA_ID);
      var aba = ss.getSheetByName(ABA_RESERVA);
      if (!aba) {
        aba = ss.insertSheet(ABA_RESERVA);
        aba.appendRow([
          'Timestamp', 'Nome Titular', 'Nascimento', 'Telefone', 'E-mail', 'CPF',
          'Estado Civil',
          'Nome Cônjuge', 'Nasc. Cônjuge', 'Tel. Cônjuge', 'E-mail Cônjuge', 'CPF Cônjuge',
          'Empreendimento', 'Faixa Valor', 'Valor Entrada', 'Forma Pagamento', 'Detalhes', 'Qtd Docs'
        ]);
        aba.getRange(1, 1, 1, 18)
           .setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
        aba.setFrozenRows(1);
      }
      aba.appendRow([
        data.timestamp,
        data.nome,
        data.nascimento,
        data.telefone,
        data.email,
        data.cpf,
        data.estado_civil,
        temConjuge ? data.conjuge.nome                 : '',
        temConjuge ? data.conjuge.nascimento            : '',
        temConjuge ? data.conjuge.telefone              : '',
        temConjuge ? (data.conjuge.email        || '')  : '',
        temConjuge ? data.conjuge.cpf                  : '',
        data.empreendimento,
        data.faixa_valor,
        data.valor_entrada,
        data.forma_pagamento,
        data.detalhes  || '',
        (data.documentos || []).length
      ]);
      Logger.log('Reserva salva na aba ' + ABA_RESERVA);
    } catch (e) { Logger.log('Reserva planilha erro: ' + e.message); }
  }
}

/* ─── SIMULAÇÃO (modal simulador no index.html) ─────────── */
function processarSimulacao(data) {
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = ss.getSheetByName(ABA_SIMULACOES);
    if (!aba) {
      aba = ss.insertSheet(ABA_SIMULACOES);
      aba.appendRow(['Timestamp','Nome','Telefone','E-mail','Acessos']);
      aba.getRange(1,1,1,5).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
      aba.setFrozenRows(1);
    }
    if (data.atualizar) {
      // Incrementa contador de acessos da linha existente
      var dados  = aba.getDataRange().getValues();
      var headers = dados[0].map(function(h){ return String(h).trim().toLowerCase(); });
      var colFone = headers.indexOf('telefone');
      var colAcesso = headers.indexOf('acessos');
      if (colFone !== -1 && colAcesso !== -1) {
        var foneLimpo = String(data.telefone || '').replace(/\D/g,'');
        for (var i = 1; i < dados.length; i++) {
          if (String(dados[i][colFone]).replace(/\D/g,'') === foneLimpo) {
            aba.getRange(i+1, colAcesso+1).setValue((parseInt(dados[i][colAcesso])||0) + 1);
            break;
          }
        }
      }
    } else {
      aba.appendRow([
        data.timestamp || new Date().toLocaleString('pt-BR'),
        data.nome      || '',
        data.telefone  || '',
        data.email     || '',
        1
      ]);
    }
    Logger.log('Simulacao salva');
  } catch(e) { Logger.log('Simulacao erro: ' + e.message); }
}

/* ─── EBOOK (modal ebook no index.html) ─────────────────── */
function processarEbook(data) {
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = ss.getSheetByName(ABA_EBOOK);
    if (!aba) {
      aba = ss.insertSheet(ABA_EBOOK);
      aba.appendRow(['Timestamp','Nome','Telefone','E-mail','Acessos','Página']);
      aba.getRange(1,1,1,6).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
      aba.setFrozenRows(1);
    }
    if (data.atualizar) {
      var dados   = aba.getDataRange().getValues();
      var headers = dados[0].map(function(h){ return String(h).trim().toLowerCase(); });
      var colFone   = headers.indexOf('telefone');
      var colAcesso = headers.indexOf('acessos');
      if (colFone !== -1 && colAcesso !== -1) {
        var foneLimpo = String(data.telefone || '').replace(/\D/g,'');
        for (var i = 1; i < dados.length; i++) {
          if (String(dados[i][colFone]).replace(/\D/g,'') === foneLimpo) {
            aba.getRange(i+1, colAcesso+1).setValue((parseInt(dados[i][colAcesso])||0) + 1);
            break;
          }
        }
      }
    } else {
      aba.appendRow([
        data.timestamp || new Date().toLocaleString('pt-BR'),
        data.nome      || '',
        data.telefone  || '',
        data.email     || '',
        1,
        data.pagina    || ''
      ]);
    }
    Logger.log('Ebook salvo');
  } catch(e) { Logger.log('Ebook erro: ' + e.message); }
}

/* ─── COMPARTILHAR IMÓVEL POR E-MAIL (botão em index.html/imovel.html) ── */
function processarCompartilharEmail(data) {
  var ok = enviarEmailBrevo_(data.destinatario, data.assunto || 'Imóvel WAL Imóveis', data.corpo || '', { textOnly: true });
  if (!ok) throw new Error('Falha ao enviar e-mail via Brevo.');
}

/* ─── CONTADOR DE VISITAS (carregamento de index.html) ──── */
function processarVisita(data) {
  if (!LOG_PLANILHA) return;
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = ss.getSheetByName(ABA_VISITAS);
    if (!aba) {
      aba = ss.insertSheet(ABA_VISITAS);
      aba.appendRow(['Data/Hora', 'Data', 'Página', 'Origem', 'Tempo']);
      aba.getRange(1, 1, 1, 5).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
      aba.setFrozenRows(1);
    }
    var ts = data.timestamp || new Date().toLocaleString('pt-BR');
    aba.appendRow([ts, ts, data.pagina || '', data.referrer || '', '']);
  } catch (e) { Logger.log('Visita erro: ' + e.message); }
}

/* ─── VISITA A EMPREENDIMENTO (imovel.html, ao abrir um imóvel) ── */
/* Uma linha por Data+Empreendimento — soma um Contador a cada nova visita
   naquele dia, em vez de logar cada visita como linha própria. */
function processarVisitaEmpreendimento(data) {
  if (!LOG_PLANILHA) return;
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = ss.getSheetByName(ABA_VISITAS_EMP);
    if (!aba) {
      aba = ss.insertSheet(ABA_VISITAS_EMP);
      aba.appendRow(['Data', 'imovelId', 'Empreendimento', 'Contador']);
      aba.getRange(1, 1, 1, 4).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
      aba.setFrozenRows(1);
    }
    var hoje = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
    var imovelId = data.imovelId || '';

    var dados = aba.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      // Mesmo problema do lerAba(): se o Sheets converteu a célula da coluna
      // Data pra um objeto Date de verdade, String(dados[i][0]) nunca bate
      // com "hoje" (string dd/MM/yyyy) — precisa reformatar antes de comparar.
      var celData = dados[i][0];
      var dataLinha = (celData instanceof Date) ? Utilities.formatDate(celData, TZ, 'dd/MM/yyyy') : String(celData);
      if (dataLinha === hoje && String(dados[i][1]) === imovelId) {
        aba.getRange(i + 1, 4).setValue((parseInt(dados[i][3], 10) || 0) + 1);
        return;
      }
    }
    aba.appendRow([hoje, imovelId, data.nome || '', 1]);
  } catch (e) { Logger.log('VisitaEmpreendimento erro: ' + e.message); }
}

/* ─── IMÓVEL — criar ou editar linha na planilha de imóveis ─ */
function processarImovel(data) {
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_IMOVEIS_ID);
    var aba = ss.getSheetByName(ABA_IMOVEIS);
    if (!aba) { Logger.log('Aba ' + ABA_IMOVEIS + ' não encontrada'); return; }

    // Monta a linha na ordem das colunas A→W
    // A=ID | B=Ativo | C=Tipo | D=Construtora | E=Cidade | F=Nome
    // G=Descricao | H=Imagem | I=Faixa | J=Valor | K=Qtd | L=Blog
    // M=Data | N=Obs | O=Destaque | P=UF | Q=Bairro | R=Link Drive
    // (R já é usado pelo admin.html — campo "Link Drive", ver linha
    //  ~848 e coletarDadosForm()/g(17) em admin.html — por isso os
    //  campos novos do feirão entram DEPOIS dele, a partir de S)
    // S=Quartos | T=Preço Mín (R$) | U=Preço Máx (R$) | V=Entrega Prevista
    // W=Feirao_On_Line (colunas novas — feirão de imóveis, ver
    //   configurarCamposFeirao())
    // X=Projeto (coluna nova — Porto Maravilha/Praça Onze Maravilha/etc.,
    //   ver configurarCampoProjeto())
    var ativo    = data.ativo    === true || data.ativo    === 'true';
    var destaque = data.destaque === true || data.destaque === 'true';
    var feiraoOnLine = (data.feirao_on_line === true || data.feirao_on_line === 'true' || data.feirao_on_line === 'Sim') ? 'Sim' : 'Não';

    if (data.operacao === 'corrigir_id' && data.id && data.novoId) {
      // Corrige só a coluna A (ID) de uma linha existente — usado pra
      // consertar IDs sem o prefixo "IMO-" gerados por engano (ver
      // conversa 18/08/2026). Não usa o "editar" normal porque aquele
      // nunca toca na coluna A de propósito (preserva o ID).
      var dadosCorrigir = aba.getDataRange().getValues();
      var linhaCorrigir = -1;
      for (var ci = 1; ci < dadosCorrigir.length; ci++) {
        if (String(dadosCorrigir[ci][0]) === String(data.id)) { linhaCorrigir = ci + 1; break; }
      }
      if (linhaCorrigir === -1) { Logger.log('corrigir_id: ID não encontrado: ' + data.id); return; }
      var jaExiste = dadosCorrigir.some(function(l) { return String(l[0]) === String(data.novoId); });
      if (jaExiste) { Logger.log('corrigir_id: novoId já existe, abortado: ' + data.novoId); return; }
      aba.getRange(linhaCorrigir, 1).setValue(data.novoId);
      Logger.log('ID corrigido: ' + data.id + ' → ' + data.novoId);
      return;
    }

    if (data.operacao === 'editar' && data.id) {
      // Localiza a linha pelo ID (col A)
      var dados = aba.getDataRange().getValues();
      var linhaIdx = -1;
      for (var i = 1; i < dados.length; i++) {
        if (String(dados[i][0]) === String(data.id)) { linhaIdx = i + 1; break; }
      }
      if (linhaIdx === -1) { Logger.log('ID não encontrado: ' + data.id); return; }

      // Atualiza coluna por coluna (preserva ID e Data)
      var r = aba.getRange(linhaIdx, 1, 1, 24).getValues()[0];
      r[1]  = ativo;
      r[2]  = data.tipo_imovel  || r[2];
      r[3]  = data.construtora  || r[3];
      r[4]  = data.cidade       || r[4];
      r[5]  = data.nome         || r[5];
      r[6]  = data.descricao    !== undefined ? data.descricao  : r[6];
      r[7]  = data.imagem       !== undefined ? data.imagem     : r[7];
      r[8]  = data.faixa        || r[8];
      r[9]  = data.valor        !== undefined ? data.valor      : r[9];
      r[10] = data.qtd          !== undefined ? data.qtd        : r[10];
      r[11] = data.blog         !== undefined ? data.blog       : r[11];
      // r[12] = Data — preserva
      r[13] = data.obs          !== undefined ? data.obs        : r[13];
      r[14] = destaque;
      r[15] = data.uf           || r[15];
      r[16] = data.bairro       !== undefined ? data.bairro     : r[16];
      r[17] = data.link_drive   !== undefined ? data.link_drive : r[17];
      r[18] = data.quartos      !== undefined ? data.quartos    : r[18];
      r[19] = data.preco_min    !== undefined ? parseFloat(data.preco_min) || 0 : r[19];
      r[20] = data.preco_max    !== undefined ? parseFloat(data.preco_max) || 0 : r[20];
      r[21] = data.entrega      !== undefined ? data.entrega    : r[21];
      r[22] = data.feirao_on_line !== undefined ? feiraoOnLine  : r[22];
      r[23] = data.projeto       !== undefined ? data.projeto  : r[23];
      aba.getRange(linhaIdx, 1, 1, 24).setValues([r]);
      Logger.log('Imóvel atualizado: ID ' + data.id);

    } else {
      // Novo imóvel — gera ID no padrão "IMO-NNN" já usado na planilha
      // (busca o maior número já usado em col A, IMO-551 ou 551, e soma 1 —
      // não usa o número da linha, que gerava IDs sem o prefixo IMO- e sem
      // relação com a numeração real já em uso)
      var colA    = aba.getRange(2, 1, Math.max(aba.getLastRow() - 1, 0), 1).getValues();
      var maiorNum = 0;
      colA.forEach(function(linha) {
        var m = String(linha[0] || '').match(/(\d+)/);
        if (m) {
          var n = parseInt(m[1], 10);
          if (n > maiorNum) maiorNum = n;
        }
      });
      var novoId = 'IMO-' + (maiorNum + 1);
      var hoje = new Date().toLocaleDateString('pt-BR');
      aba.appendRow([
        novoId, ativo,
        data.tipo_imovel  || '',
        data.construtora  || '',
        data.cidade       || '',
        data.nome         || '',
        data.descricao    || '',
        data.imagem       || '',
        data.faixa        || '',
        data.valor        || 0,
        data.qtd          || '',
        data.blog         || '',
        hoje,
        data.obs          || '',
        destaque,
        data.uf           || '',
        data.bairro       || '',
        data.link_drive   || '',
        data.quartos      || '',
        parseFloat(data.preco_min) || 0,
        parseFloat(data.preco_max) || 0,
        data.entrega      || '',
        feiraoOnLine,
        data.projeto      || ''
      ]);
      Logger.log('Imóvel criado: ' + data.nome);
    }
  } catch(e) { Logger.log('processarImovel erro: ' + e.message); }
}

/* ─── CONSTRUTORA — criar, editar ou excluir linha ─────── */
function processarConstrutora(data) {
  try {
    var ss  = SpreadsheetApp.openById(PLANILHA_ID);
    var aba = ss.getSheetByName(ABA_CONSTRUTORAS);

    // Cria aba se não existir
    if (!aba) {
      aba = ss.insertSheet(ABA_CONSTRUTORAS);
      aba.appendRow([
        'ID','Nome','Telefone','Site','Viabilizador','Tel Viabilizador',
        'Comissão (%)','Link Drive','Data Inclusão',
        'Estados de Atuação','Cidades de Atuação','Observações'
      ]);
      aba.getRange(1,1,1,12).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
      aba.setFrozenRows(1);
      Logger.log('Aba CONSTRUTORAS criada');
    }

    var d = data.dados || {};
    var acao = data.acao || 'criar';

    if (acao === 'excluir') {
      var linhas = aba.getDataRange().getValues();
      for (var i = 1; i < linhas.length; i++) {
        if (String(linhas[i][0]) === String(d.id)) {
          aba.deleteRow(i + 1);
          Logger.log('Construtora excluída: ID ' + d.id);
          return;
        }
      }
      Logger.log('Construtora não encontrada para excluir: ' + d.id);
      return;
    }

    if (acao === 'editar') {
      var linhas2 = aba.getDataRange().getValues();
      for (var j = 1; j < linhas2.length; j++) {
        if (String(linhas2[j][0]) === String(d.id)) {
          aba.getRange(j + 1, 1, 1, 12).setValues([[
            d.id, d.nome, d.telefone, d.site,
            d.viabilizador, d.tel_viab, d.comissao,
            d.drive, d.data, d.estados, d.cidades, d.obs
          ]]);
          Logger.log('Construtora atualizada: ' + d.nome);
          return;
        }
      }
      Logger.log('ID não encontrado para editar: ' + d.id);
      return;
    }

    // criar
    aba.appendRow([
      d.id, d.nome, d.telefone, d.site,
      d.viabilizador, d.tel_viab, d.comissao,
      d.drive, d.data, d.estados, d.cidades, d.obs
    ]);
    Logger.log('Construtora criada: ' + d.nome);

  } catch(e) { Logger.log('processarConstrutora erro: ' + e.message); }
}

/* ─── FEIRÃO DE IMÓVEIS — adiciona as colunas novas S→W na aba
   IMOVEISDISPONIVEIS (Quartos, Preço Mín, Preço Máx, Entrega Prevista,
   Feirao_On_Line). Rodar uma única vez. Não mexe nas colunas A→R
   existentes (R = Link Drive, já usada pelo admin.html), então não
   quebra nada que já lê/grava essa planilha. Referência apenas — essas
   colunas já existem em produção, não precisa rodar de novo. ─── */
function configurarCamposFeirao() {
  var ss  = SpreadsheetApp.openById(PLANILHA_IMOVEIS_ID);
  var aba = ss.getSheetByName(ABA_IMOVEIS);
  if (!aba) { Logger.log('Aba ' + ABA_IMOVEIS + ' não encontrada'); return; }

  var headerRow = aba.getRange(1, 19, 1, 5);
  headerRow.setValues([[
    'Quartos', 'Preço Mín (R$)', 'Preço Máx (R$)', 'Entrega Prevista', 'Feirao_On_Line'
  ]]);
  headerRow.setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
  headerRow.protect().setDescription('Cabeçalho — não editar').setWarningOnly(true);

  aba.getRange('W2:W999').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['Sim', 'Não'], true)
      .setAllowInvalid(false).build());
  aba.getRange('W2:W999').setValue('Não');

  aba.setColumnWidth(19, 90);
  aba.setColumnWidth(20, 110);
  aba.setColumnWidth(21, 110);
  aba.setColumnWidth(22, 130);
  aba.setColumnWidth(23, 120);

  SpreadsheetApp.getUi().alert(
    '✅ Colunas do Feirão criadas em IMOVEISDISPONIVEIS!\n\n' +
    'Preencha (ou peça para a equipe preencher, ou use o admin.html\n' +
    'atualizado) Quartos, Preço Mín/Máx, Entrega e marque\n' +
    'Feirao_On_Line = "Sim" nos imóveis que devem aparecer na Vitrine\n' +
    'do 1º Feirão de Imóveis.'
  );
}

/* ─── PROJETO — adiciona a coluna X (24ª) na aba IMOVEISDISPONIVEIS
   ('Porto Maravilha', 'Praça Onze Maravilha', 'Expansão Porto
   Maravilha - São Cristóvão', 'Reviver Centro', ou outra digitada
   pelo usuário no admin.html). Rodar uma única vez. Não mexe nas
   colunas A→W existentes, então não quebra nada que já lê/grava essa
   planilha. Referência apenas — depois de rodada uma vez não precisa
   rodar de novo. ─── */
function configurarCampoProjeto() {
  var ss  = SpreadsheetApp.openById(PLANILHA_IMOVEIS_ID);
  var aba = ss.getSheetByName(ABA_IMOVEIS);
  if (!aba) { Logger.log('Aba ' + ABA_IMOVEIS + ' não encontrada'); return; }

  var headerCell = aba.getRange(1, 24, 1, 1);
  headerCell.setValue('Projeto');
  headerCell.setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
  headerCell.protect().setDescription('Cabeçalho — não editar').setWarningOnly(true);

  aba.setColumnWidth(24, 160);

  // Sem SpreadsheetApp.getUi().alert() de propósito — travava (esperando um
  // popup que só renderiza com a planilha aberta numa aba do navegador) ao
  // rodar direto pelo editor do Apps Script. Ver Logger de execução (Ver →
  // Registros) para confirmar que rodou.
  Logger.log('Coluna "Projeto" criada em IMOVEISDISPONIVEIS (coluna X).');
}

/* ─── AUXILIAR: linha HTML ─────────────────────────────── */
function linhaHtml(label, valor, negrito) {
  return '<tr style="background:#fff;border-bottom:1px solid #eee">' +
    '<td style="padding:8px 12px;color:#888;width:38%"><strong>' + label + '</strong></td>' +
    '<td style="padding:8px 12px' + (negrito ? ';font-weight:bold' : '') + '">' + (valor || '—') + '</td>' +
    '</tr>';
}

/* ─── TESTE SIMULAÇÃO (nova entrada) ───────────────────── */
function testarSimulacao() {
  var dados = {
    atualizar: false,
    timestamp: new Date().toLocaleString('pt-BR'),
    nome:      'TESTE Simulação',
    telefone:  '(21) 99999-8888',
    email:     'teste@teste.com'
  };
  Logger.log('Iniciando testarSimulacao: ' + JSON.stringify(dados));
  processarSimulacao(dados);

  // Verifica se foi gravado
  var ss  = SpreadsheetApp.openById(PLANILHA_ID);
  var aba = ss.getSheetByName(ABA_SIMULACOES);
  if (aba) {
    var linhas = aba.getDataRange().getValues();
    Logger.log('Cabeçalho: ' + JSON.stringify(linhas[0]));
    Logger.log('Última linha: ' + JSON.stringify(linhas[linhas.length - 1]));
    Logger.log('Total de linhas (com cabeçalho): ' + linhas.length);
  }
}

/* ─── TESTE BREVO (envia um e-mail de teste para EMAIL_DESTINO) ── */
function testarBrevo() {
  var ok = enviarEmailBrevo_(EMAIL_DESTINO, '🧪 Teste Brevo — WAL Imóveis',
    '<p>Se você recebeu este e-mail, o envio via Brevo está funcionando ' +
    'neste script (substituindo o MailApp, que estava bloqueado).</p>');
  Logger.log(ok ? '✅ testarBrevo: enviado com sucesso' : '❌ testarBrevo: falhou — confira BREVO_API_KEY nas Propriedades do script e o Log de execução acima');
}

/* ─── TESTE WHATSAPP ───────────────────────────────────── */
function testarWhatsApp() {
  var url = 'https://api.callmebot.com/whatsapp.php' +
            '?phone=5522998136409&text=Teste+WAL+Imoveis&apikey=8406411';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    Logger.log('HTTP: ' + resp.getResponseCode());
    Logger.log('Resp: ' + resp.getContentText());
  } catch (e) { Logger.log('ERRO: ' + e.message); }
}

/* ─── TESTE PLANILHA (verifica acesso e abas) ──────────── */
function testarPlanilha() {
  try {
    Logger.log('Abrindo planilha ID: ' + PLANILHA_ID);
    var ss = SpreadsheetApp.openById(PLANILHA_ID);
    Logger.log('Planilha: ' + ss.getName());

    var abas = ss.getSheets().map(function(s){ return s.getName(); });
    Logger.log('Abas existentes: ' + abas.join(', '));

    var aba = ss.getSheetByName(ABA_LEADS);
    if (aba) {
      Logger.log('✅ Aba "' + ABA_LEADS + '" encontrada — ' + aba.getLastRow() + ' linhas');
    } else {
      Logger.log('❌ Aba "' + ABA_LEADS + '" NÃO encontrada — será criada automaticamente no próximo lead');
    }
  } catch(e) {
    Logger.log('❌ ERRO: ' + e.message);
  }
}

/* ─── CONFIGURA COLUNA 'E-mail' NA ABA LEADS JÁ EXISTENTE ───
   processarLead() só escreve o cabeçalho quando cria a aba do zero —
   como ABA_LEADS já existia em produção antes da coluna E-mail (col M)
   ser adicionada, o cabeçalho da coluna M nunca foi escrito sozinho.
   Rode esta função uma única vez (▶ no editor, sem precisar publicar
   nova versão) pra adicionar o rótulo 'E-mail' em M1 com a mesma
   formatação do resto do cabeçalho. Se preferir, também dá pra digitar
   "E-mail" na célula M1 manualmente — o efeito é o mesmo. */
function configurarColunaEmailLeads() {
  var ss  = SpreadsheetApp.openById(PLANILHA_ID);
  var aba = ss.getSheetByName(ABA_LEADS);
  if (!aba) { Logger.log('Aba ' + ABA_LEADS + ' não encontrada'); return; }
  var celula = aba.getRange(1, 13);
  celula.setValue('E-mail');
  celula.setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
  Logger.log('✅ Cabeçalho "E-mail" adicionado em M1 da aba ' + ABA_LEADS);
}

/* ─── TESTE LEAD (grava linha real com todos os 13 campos, incl. E-mail) */
function testarLead() {
  var dados = {
    timestamp:        new Date().toLocaleString('pt-BR'),
    nome:             'TESTE Automático',
    email:            'teste@walservidor.com.br',
    whatsapp:         '(21) 99999-9999',
    posto:            'Sargento',
    base:             'Galeão',
    cidade:           'Rio de Janeiro',
    faixa_valor:      'Até R$ 500.000',
    forma_pagamento:  'POUPEX',
    origem:           'Teste Script',
    estado:           'RJ',
    bairro_desejado:  'Barra da Tijuca',
    imovel_interesse: 'Residencial Teste'
  };
  Logger.log('Iniciando testarLead com dados: ' + JSON.stringify(dados));
  processarLead(dados);
  Logger.log('✅ testarLead concluído — verifique a aba "' + ABA_LEADS + '" na planilha');
}

/* ─── TESTE VISITA A EMPREENDIMENTO (cria a aba na 1ª vez) ─ */
function testarVisitaEmpreendimento() {
  var dados = { imovelId: 'TESTE001', nome: 'Empreendimento Teste' };
  Logger.log('Iniciando testarVisitaEmpreendimento com dados: ' + JSON.stringify(dados));
  processarVisitaEmpreendimento(dados);
  Logger.log('✅ testarVisitaEmpreendimento concluído — verifique a aba "' + ABA_VISITAS_EMP + '" na planilha');
}
