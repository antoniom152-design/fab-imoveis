/* ================================================
 *  WAL CRM — Apps Script
 *  Planilha: WAL — CRM de Leads  |  Aba: LEADS
 *  Deploy (Web App): CRM_SCRIPT_URL_DEFAULT / CRM_SCRIPT_URL / CRM_URL /
 *  CRM_URL_RES / CRM_URL_SIM — mesma URL, nomes de variável diferentes
 *  por arquivo (admin.html, index.html, reserva.html, simulador.html,
 *  mapa-empreendimentos.html):
 *  https://script.google.com/macros/s/AKfycbysCi84QtlgGXxHNy8VnuCOisIZy8VE-LSxU4H1aQtVDYX7HFAQlEIstFT5d0AGE8E3/exec
 *
 *  Projeto Apps Script separado de painel/shared/apps-script-sistema-web-
 *  cadastro.gs — cuida só do CRUD da aba LEADS (criar/atualizar/excluir/
 *  addInteracao/criarOuAtualizar). O histórico de atendimento (coluna Q
 *  "Histórico (JSON)") deixou de ser a fonte usada pelas telas desde
 *  11/09/2026 — ver painel/shared/apps-script-sistema-web-cadastro.gs
 *  (aba HISTORICO_ATENDIMENTO_LEAD é a fonte única agora); esse script
 *  continua sendo o único responsável por criar/atualizar/excluir o
 *  LEAD em si.
 *
 *  Colado aqui em 11/09/2026 a partir do código atual no editor do Apps
 *  Script (colado pelo Antonio) — antes dessa data não havia NENHUMA
 *  cópia local deste script; só existia um backup manual desatualizado
 *  em "Txt/Backup - da Planilha = WAL — CRM de Leads.txt" (05/08/26,
 *  já divergente do atual — por exemplo, aquela cópia antiga casava
 *  lead existente por telefone OU e-mail em criarOuAtualizarLead(),
 *  a versão atual (abaixo) casa só por e-mail).
 * ================================================ */

function agoraBR() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
}

function setupCRM() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('LEADS') || ss.getActiveSheet();
  sheet.setName('LEADS');

  var cols = [
    'ID','Status','Prioridade','Nome','Telefone','Email',
    'Origem','Consultor','Solicitação','Orçamento','Área',
    'Observações','Próxima Ação','Data Próxima Ação',
    'Criado em','Atualizado em','Histórico (JSON)'
  ];
  var hdr = sheet.getRange(1, 1, 1, cols.length);
  hdr.setValues([cols])
     .setBackground('#0A1628').setFontColor('#C9A84C')
     .setFontWeight('bold').setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 38);

  [60,120,90,200,140,220,110,150,320,200,180,200,260,130,160,160,10]
    .forEach(function(w,i){ sheet.setColumnWidth(i+1, w||10); });
  sheet.hideColumns(17);

  var dv = SpreadsheetApp.newDataValidation;
  sheet.getRange('B2:B2000').setDataValidation(
    dv().requireValueInList(['novo','contato','proposta','aguardando','visita','fechado','perdido'],true)
        .setAllowInvalid(false).build());
  sheet.getRange('C2:C2000').setDataValidation(
    dv().requireValueInList(['alta','media','baixa'],true)
        .setAllowInvalid(false).build());

  var rng = sheet.getRange('A2:P2000');
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$B2="fechado"')
      .setBackground('#E8F5E9').setFontColor('#2E7D32')
      .setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$B2="perdido"')
      .setBackground('#EEEEEE').setFontColor('#9E9E9E')
      .setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$C2="alta"')
      .setBackground('#FFF3F3')
      .setRanges([rng]).build()
  ]);
  hdr.protect().setDescription('Cabeçalho').setWarningOnly(true);
  SpreadsheetApp.getUi().alert('✅ CRM configurado!');
}

/* ── Leitura via GET (JSONP) ─────────────────── */
function doGet(e) {
  var cb    = e.parameter.callback;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LEADS');
  if (!sheet) return resp(cb, {error:'Aba LEADS não encontrada'});

  var vals = sheet.getDataRange().getValues();
  if (vals.length <= 1) return resp(cb, {leads:[]});

  var leads = vals.slice(1).map(function(r){
    var hist = [];
    try { hist = JSON.parse(String(r[16]||'[]')); } catch(x){}
    function s(v) {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
      return String(v);
    }

    function sDataHora(v) {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
      return String(v);
    }

    return {
      id:s(r[0]), status:s(r[1])||'novo', prioridade:s(r[2])||'media',
      nome:s(r[3]), telefone:s(r[4]), email:s(r[5]), origem:s(r[6]),
      consultor:s(r[7]), solicitacao:s(r[8]), orcamento:s(r[9]),
      area:s(r[10]), obs:s(r[11]), proxacao:s(r[12]), proxdata:s(r[13]),
      criado_em:sDataHora(r[14]), atualizado_em:sDataHora(r[15]), historico:hist
    };
  }).filter(function(r){ return r.id && r.nome; });

  return resp(cb, {leads:leads});
}

function resp(cb, obj) {
  var body = JSON.stringify(obj);
  if (cb) body = cb + '(' + body + ')';
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ── Escrita via POST ────────────────────────── */
function doPost(e) {
  try {
    var p     = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LEADS');
    if (!sheet) return jsonOut({error:'Aba não encontrada'});

    if (p.action === 'criar')            return jsonOut(criarLead(sheet, p.lead));
    if (p.action === 'atualizar')        return jsonOut(atualizarLead(sheet, p.lead));
    if (p.action === 'excluir')          return jsonOut(excluirLead(sheet, p.id));
    if (p.action === 'addInteracao')     return jsonOut(addInteracao(sheet, p.id, p.interacao));
    if (p.action === 'criarOuAtualizar') return jsonOut(criarOuAtualizarLead(sheet, p.lead, p.interacao));
    return jsonOut({error:'Ação desconhecida'});
  } catch(err) { return jsonOut({error:err.message}); }
}

function criarLead(sheet, lead) {
  var id  = 'CRM_' + Date.now();
  var now = agoraBR();
  sheet.appendRow([
    id, lead.status||'novo', lead.prioridade||'media',
    lead.nome||'', lead.telefone||'', lead.email||'',
    lead.origem||'', lead.consultor||'', lead.solicitacao||'',
    lead.orcamento||'', lead.area||'', lead.obs||'',
    lead.proxacao||'', lead.proxdata||'', now, now,
    JSON.stringify(lead.historico||[])
  ]);
  return {ok:true, id:id};
}

function criarOuAtualizarLead(sheet, lead, interacao) {
  var emailBusca = String(lead.email || '').toLowerCase().trim();
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var rowEmail = String(vals[i][5] || '').toLowerCase().trim();
    if (emailBusca && rowEmail === emailBusca) {
      var hist = [];
      try { hist = JSON.parse(String(vals[i][16]||'[]')); } catch(x){}
      if (interacao) hist.push(interacao);
      sheet.getRange(i+1, 16).setValue(agoraBR());
      sheet.getRange(i+1, 17).setValue(JSON.stringify(hist));
      return {ok:true, acao:'interacao', id:String(vals[i][0])};
    }
  }
  return criarLead(sheet, lead);
}

function atualizarLead(sheet, lead) {
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(lead.id)) {
      var now  = agoraBR();
      var hist = lead.historico !== undefined
        ? lead.historico
        : (function(){ try{return JSON.parse(String(vals[i][16]||'[]'));}catch(x){return [];} })();
      sheet.getRange(i+1, 1, 1, 17).setValues([[
        lead.id,
        lead.status      || vals[i][1],
        lead.prioridade  || vals[i][2],
        lead.nome        || vals[i][3],
        lead.telefone    !== undefined ? lead.telefone    : vals[i][4],
        lead.email       !== undefined ? lead.email       : vals[i][5],
        lead.origem      !== undefined ? lead.origem      : vals[i][6],
        lead.consultor   !== undefined ? lead.consultor   : vals[i][7],
        lead.solicitacao !== undefined ? lead.solicitacao : vals[i][8],
        lead.orcamento   !== undefined ? lead.orcamento   : vals[i][9],
        lead.area        !== undefined ? lead.area        : vals[i][10],
        lead.obs         !== undefined ? lead.obs         : vals[i][11],
        lead.proxacao    !== undefined ? lead.proxacao    : vals[i][12],
        lead.proxdata    !== undefined ? lead.proxdata    : vals[i][13],
        vals[i][14], now, JSON.stringify(hist)
      ]]);
      return {ok:true};
    }
  }
  return {error:'Lead não encontrado'};
}

function excluirLead(sheet, id) {
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) {
      sheet.deleteRow(i+1);
      return {ok:true};
    }
  }
  return {error:'Lead não encontrado'};
}

function addInteracao(sheet, id, interacao) {
  var vals = sheet.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) {
      var hist = [];
      try { hist = JSON.parse(String(vals[i][16]||'[]')); } catch(x){}
      hist.push(interacao);
      sheet.getRange(i+1, 16).setValue(agoraBR());
      sheet.getRange(i+1, 17).setValue(JSON.stringify(hist));
      return {ok:true};
    }
  }
  return {error:'Lead não encontrado'};
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
