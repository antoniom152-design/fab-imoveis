/* ═══════════════════════════════════════════════════════════════════
   WAL Imóveis — Sistema Web · Cadastro Único (USUARIOS / DASHBOARDS)
   ═══════════════════════════════════════════════════════════════════
   Backend NOVO e ISOLADO, criado só para este recurso. Não compartilha
   planilha nem implantação com nenhum dos backends já em produção do
   Sistema Web (APPS_SCRIPT_URL / CRM_SCRIPT_URL_DEFAULT do admin.html
   e index.html, ou o SCRIPT_URL do reserva.html) nem com o Feirão
   Online (feirao/shared/apps-script-feirao-operacional.gs). Zero risco
   para o que já está no ar.

   Ver painel/diretoria/dashboard-gestao-usuarios.html (frontend) e
   feirao/materiais/proposta-reestruturacao-sistema-web.html (seção 6).

   ── COMO IMPLANTAR (1ª vez) ──
   1. Crie uma planilha Google nova e vazia (ex.: "WAL Sistema Web —
      Cadastro Único"). Copie o ID dela (o trecho entre /d/ e /edit na
      URL) e cole em PLANILHA_CADASTRO_ID logo abaixo.
   2. Nessa planilha: Extensões → Apps Script. Cole todo este arquivo.
   3. Rode setupCadastroUnico() uma vez (menu ▶ ou o menu "WAL ·
      Cadastro" que aparece ao abrir a planilha) e confirme que as
      abas USUARIOS e DASHBOARDS apareceram certas.
   4. Implantar → Nova implantação → Aplicativo da Web → Executar como
      "Eu", Quem pode acessar "Qualquer pessoa" → Implantar. Copie a
      URL /exec.
   5. Cole essa URL em CADASTRO_API_URL no topo do
      painel/diretoria/dashboard-gestao-usuarios.html.
═══════════════════════════════════════════════════════════════════ */

var PLANILHA_CADASTRO_ID = '1QKt4iVS_JaFI9Ir_gpOpAUcR4t8rrNJbYwLaH84BUdI'; // ID da planilha nova (passo 1 acima)
var ABA_USUARIOS         = 'USUARIOS';
var ABA_DASHBOARDS       = 'DASHBOARDS';
var ABA_OTP              = 'OTP_CODES';
var TZ                   = Session.getScriptTimeZone() || 'America/Sao_Paulo';

/* Planilha "WAL — CRM de Leads" (já em produção, gerida por outro
   script que não temos aqui) — acessada só por ID, mesma técnica já
   usada no Feirão para ler outras planilhas externas. Usada apenas
   pelo gate de e-mail/OTP dos 5 pontos de acesso do index.html
   (Simulador, E-book, Ver Todos, Consultor IA, Reserva). */
var PLANILHA_CRM_LEADS_ID = '1LeIsShjdVMKuB99cJf_N-eBW3M8lf_uo-la88CQjvH4';
var ABA_LEADS             = 'LEADS';

/* Mesmo PIN já usado hoje para entrar em admin.html — reaproveitado
   aqui até o Sistema Web ter um papel de Diretoria próprio (ver
   proposta, seção 2). Troque os dois lugares juntos se for alterado. */
var PIN_ADMIN_SISTEMA = 'FAB2024';

/* Remetente do e-mail de código de acesso — via API transacional do
   Brevo, NÃO MailApp.sendEmail() (Google bloqueia envio automatizado
   para domínios externos em contas Workspace novas; o Feirão já
   apanhou com isso, ver apps-script-feirao-operacional.gs). Requer a
   propriedade de script BREVO_API_KEY (Configurações do projeto ⚙ →
   Propriedades do script) — é um projeto separado do Feirão, a chave
   não é compartilhada, precisa ser configurada aqui de novo. */
var BREVO_SENDER_EMAIL = 'wal@walservidor.com.br';
var BREVO_SENDER_NOME  = 'WAL Imóveis';

var DASHBOARDS_SEED_ = [
  { id: 'CLIENTE',           nome: 'Cliente',           descricao: 'Comprador/lead com simulação, reserva e chat',   icone: '🏠', rota: 'painel/cliente/dashboard-cliente.html',                      ordem: 1 },
  { id: 'AGENTE',            nome: 'Agente Parceiro',   descricao: 'Indicador externo — comissão por indicação',     icone: '🤝', rota: 'painel/agente/dashboard-agente.html',                        ordem: 2 },
  { id: 'ATENDENTE',         nome: 'Atendente',         descricao: 'Triagem interna — recebe leads do Gerente',      icone: '🎧', rota: 'painel/atendente/dashboard-atendente.html',                  ordem: 3 },
  { id: 'GERENTE_COMERCIAL', nome: 'Gerente Comercial', descricao: 'Distribui leads, acompanha a equipe',            icone: '👥', rota: 'painel/gerente-comercial/dashboard-gerente-comercial.html', ordem: 4 },
  { id: 'CORRETOR_AUTONOMO', nome: 'Corretor Autônomo', descricao: 'Venda completa — do interesse ao contrato',      icone: '🧑‍💼', rota: 'painel/corretor/dashboard-corretor.html',                  ordem: 5 },
  { id: 'MARKETING',         nome: 'Marketing',         descricao: 'Origem de leads, campanhas, conteúdo',           icone: '📣', rota: 'painel/marketing/dashboard-marketing.html',                  ordem: 6 },
  { id: 'DIRETORIA',         nome: 'Diretoria',         descricao: 'Visão executiva consolidada do negócio',         icone: '📊', rota: 'painel/diretoria/dashboard-diretoria.html',                  ordem: 7 },
  { id: 'ADMIN',             nome: 'Admin',             descricao: 'Configuração técnica do site principal',         icone: '🛠️', rota: 'admin.html',                                                ordem: 8 }
];

/* ══════════════════ helpers genéricos ══════════════════ */
function agora_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function s_(v) { return (v === null || v === undefined) ? '' : String(v); }
function normalizarEmail_(v) { return s_(v).trim().toLowerCase(); }
function jsonOut_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function jsonpOut_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) body = callback + '(' + body + ')';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function comLock_(fn) {
  var lock = LockService.getScriptLock();
  var ok = lock.tryLock(10000);
  try { return fn(); } finally { if (ok) lock.releaseLock(); }
}
function criarAbaSeNaoExiste_(ss, nome, headers) {
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, headers.length).protect().setWarningOnly(true);
  }
  return aba;
}
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
function gerarId_(aba, prefixo) {
  var ids = aba.getDataRange().getValues().slice(1).map(function (r) { return String(r[0] || ''); });
  var max = 0;
  ids.forEach(function (id) {
    var n = parseInt(id.replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefixo + String(max + 1).padStart(4, '0');
}
function autorizarAdmin_(pin) {
  if (s_(pin).trim() !== PIN_ADMIN_SISTEMA) return { ok: false, erro: 'PIN incorreto ou ausente.' };
  return { ok: true };
}
function gerarToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}
function brevoApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
}
/* Envio síncrono (não enfileirado) — usado só pelo código de acesso,
   que precisa chegar rápido. Diferente do padrão de fila do Feirão
   (vários tipos de notificação, processados 1x/minuto); aqui é uma
   única chamada HTTP, não precisa de fila. */
function enviarEmailBrevo_(destinatario, assunto, corpo) {
  var apiKey = brevoApiKey_();
  if (!apiKey) { Logger.log('enviarEmailBrevo_: BREVO_API_KEY não configurada nas Propriedades do script.'); return false; }
  try {
    var resp = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'api-key': apiKey, accept: 'application/json' },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        sender: { name: BREVO_SENDER_NOME, email: BREVO_SENDER_EMAIL },
        to: [{ email: destinatario }],
        subject: assunto,
        textContent: corpo
      })
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

/* ══════════════════ menu (planilha) ══════════════════ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('WAL · Cadastro')
    .addItem('Configurar planilha (1ª vez)', 'setupCadastroUnico')
    .addToUi();
}

function setupCadastroUnico() {
  try {
    if (PLANILHA_CADASTRO_ID === 'COLOQUE_AQUI') throw new Error('Cole o ID da planilha em PLANILHA_CADASTRO_ID antes de rodar.');
    var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
    var relatorio = [];
    criarAbaSeNaoExiste_(ss, ABA_USUARIOS, ['ID', 'Email', 'Nome', 'Telefone', 'Dashboards', 'Dashboard_Padrao', 'Status', 'Construtora', 'Cadastrado_Por', 'Data_Cadastro', 'Ultimo_Acesso']);
    relatorio.push('Aba USUARIOS verificada/criada.');
    var abaDash = criarAbaSeNaoExiste_(ss, ABA_DASHBOARDS, ['Id_Dashboard', 'Nome', 'Descricao', 'Icone', 'Rota', 'Status', 'Ordem']);
    relatorio.push('Aba DASHBOARDS verificada/criada.');
    if (abaDash.getLastRow() < 2) {
      DASHBOARDS_SEED_.forEach(function (d) {
        abaDash.appendRow([d.id, d.nome, d.descricao, d.icone, d.rota, 'ativo', d.ordem]);
      });
      relatorio.push('DASHBOARDS semeada com os 8 papéis da proposta (primeira execução).');
    } else {
      relatorio.push('DASHBOARDS já tinha dados — semente não repetida.');
    }
    criarAbaSeNaoExiste_(ss, ABA_OTP, ['Email', 'Codigo', 'Expira_em', 'Verificado', 'Session_Token', 'Session_Expira_em', 'Criado_em']);
    relatorio.push('Aba OTP_CODES verificada/criada.');
    var msg = '✅ Cadastro Único configurado!\n\n' + relatorio.join('\n');
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* sem UI (rodado pelo editor) */ }
  } catch (err) {
    Logger.log('setupCadastroUnico ERRO: ' + err.message + '\n' + (err.stack || ''));
    throw err;
  }
}

/* ══════════════════ USUARIOS ══════════════════ */
function cadastro_listarUsuarios_(p) {
  var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_USUARIOS));
  if (p && p.status) itens = itens.filter(function (u) { return s_(u.Status).toLowerCase() === s_(p.status).toLowerCase(); });
  return itens.map(function (u) {
    return {
      id: s_(u.ID), email: s_(u.Email), nome: s_(u.Nome), telefone: s_(u.Telefone),
      dashboards: s_(u.Dashboards).split(',').map(function (d) { return d.trim(); }).filter(Boolean),
      dashboardPadrao: s_(u.Dashboard_Padrao), status: s_(u.Status) || 'ativo',
      construtora: s_(u.Construtora), cadastradoPor: s_(u.Cadastrado_Por),
      dataCadastro: s_(u.Data_Cadastro), ultimoAcesso: s_(u.Ultimo_Acesso)
    };
  });
}

function cadastro_usuarioCrud_(data) {
  var auth = autorizarAdmin_(data.authPin);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
  var aba = ss.getSheetByName(ABA_USUARIOS);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      var email = normalizarEmail_(data.email);
      if (!email) return { status: 'error', message: 'E-mail é obrigatório.' };
      if (acharLinhaPorChave_(aba, 'Email', email) !== -1) return { status: 'error', message: 'Já existe um usuário com esse e-mail.' };
      var id = gerarId_(aba, 'US');
      var dashboardsLista = Array.isArray(data.dashboards) ? data.dashboards.join(',') : s_(data.dashboards);
      var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      var camposCriar = {
        ID: id, Email: email, Nome: data.nome || '', Telefone: data.telefone || '',
        Dashboards: dashboardsLista, Dashboard_Padrao: data.dashboardPadrao || '',
        Status: data.status || 'pendente', Construtora: data.construtora || '',
        Cadastrado_Por: 'Admin', Data_Cadastro: agora_(), Ultimo_Acesso: ''
      };
      aba.appendRow(headers.map(function (h) { return camposCriar[h] !== undefined ? camposCriar[h] : ''; }));
      return { status: 'ok', id: id };
    }
    var linha = acharLinhaPorChave_(aba, 'Email', normalizarEmail_(data.email));
    if (linha === -1) return { status: 'error', message: 'Usuário não encontrado.' };
    if (data.operacao === 'excluir') {
      aba.deleteRow(linha);
      return { status: 'ok' };
    }
    if (data.operacao === 'ativar' || data.operacao === 'desativar') {
      var headersStatus = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      aba.getRange(linha, headersStatus.indexOf('Status') + 1).setValue(data.operacao === 'ativar' ? 'ativo' : 'inativo');
      return { status: 'ok' };
    }
    if (data.operacao === 'atualizar') {
      var campos = ['Nome', 'Telefone', 'Dashboards', 'Dashboard_Padrao', 'Status', 'Construtora'];
      var chaves = ['nome', 'telefone', 'dashboards', 'dashboardPadrao', 'status', 'construtora'];
      var headers2 = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      campos.forEach(function (campoHeader, idx) {
        var chave = chaves[idx];
        if (data[chave] === undefined) return;
        var valor = (chave === 'dashboards' && Array.isArray(data[chave])) ? data[chave].join(',') : data[chave];
        aba.getRange(linha, headers2.indexOf(campoHeader) + 1).setValue(valor);
      });
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

/* ══════════════════ DASHBOARDS ══════════════════ */
function cadastro_listarDashboards_(p) {
  var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_DASHBOARDS));
  if (p && p.somenteAtivos) itens = itens.filter(function (d) { return s_(d.Status).toLowerCase() === 'ativo'; });
  itens.sort(function (a, b) { return (Number(a.Ordem) || 0) - (Number(b.Ordem) || 0); });
  return itens.map(function (d) {
    return { id: s_(d.Id_Dashboard), nome: s_(d.Nome), descricao: s_(d.Descricao), icone: s_(d.Icone), rota: s_(d.Rota), status: s_(d.Status) || 'ativo', ordem: Number(d.Ordem) || 0 };
  });
}

function cadastro_dashboardCrud_(data) {
  var auth = autorizarAdmin_(data.authPin);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
  var aba = ss.getSheetByName(ABA_DASHBOARDS);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      var idDash = s_(data.id).trim().toUpperCase().replace(/\s+/g, '_');
      if (!idDash) return { status: 'error', message: 'Id do dashboard é obrigatório.' };
      if (acharLinhaPorChave_(aba, 'Id_Dashboard', idDash) !== -1) return { status: 'error', message: 'Já existe um dashboard com esse Id.' };
      var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      var camposCriar = {
        Id_Dashboard: idDash, Nome: data.nome || '', Descricao: data.descricao || '',
        Icone: data.icone || '', Rota: data.rota || '', Status: data.status || 'ativo', Ordem: data.ordem || 0
      };
      aba.appendRow(headers.map(function (h) { return camposCriar[h] !== undefined ? camposCriar[h] : ''; }));
      return { status: 'ok', id: idDash };
    }
    var linha = acharLinhaPorChave_(aba, 'Id_Dashboard', s_(data.id).trim().toUpperCase());
    if (linha === -1) return { status: 'error', message: 'Dashboard não encontrado.' };
    if (data.operacao === 'excluir') {
      aba.deleteRow(linha);
      return { status: 'ok' };
    }
    if (data.operacao === 'ativar' || data.operacao === 'desativar') {
      var headersStatus = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      aba.getRange(linha, headersStatus.indexOf('Status') + 1).setValue(data.operacao === 'ativar' ? 'ativo' : 'inativo');
      return { status: 'ok' };
    }
    if (data.operacao === 'atualizar') {
      var campos = ['Nome', 'Descricao', 'Icone', 'Rota', 'Status', 'Ordem'];
      var chaves = ['nome', 'descricao', 'icone', 'rota', 'status', 'ordem'];
      var headers2 = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      campos.forEach(function (campoHeader, idx) {
        if (data[chaves[idx]] !== undefined) aba.getRange(linha, headers2.indexOf(campoHeader) + 1).setValue(data[chaves[idx]]);
      });
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

/* ══════════════════ LOGIN — botão "Acessar meu Dashboard" ══════════
   Sequência (ver proposta-reestruturacao-sistema-web.html, seção 6):
   1·Clique (index.html) → 2·E-mail → 3·OTP → 4·Consulta → 5·Acesso.
   Mesmo desenho já validado em produção pelo Feirão
   (feirao_loginSolicitarCodigo_/feirao_loginVerificarCodigo_), com
   duas diferenças: e-mail enviado de forma síncrona (não enfileirado,
   só este backend não tem outros tipos de notificação que justifiquem
   fila) e a consulta a USUARIOS/DASHBOARDS embutida na verificação. */
function cadastro_loginSolicitarCodigo_(data) {
  var email = normalizarEmail_(data.email);
  if (!email || email.indexOf('@') === -1) return { status: 'error', message: 'E-mail inválido.' };
  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  var expiraEm = agora_().replace(/T.*/, '') + 'T' + Utilities.formatDate(new Date(Date.now() + 10 * 60000), TZ, 'HH:mm:ss');

  comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
    var aba = ss.getSheetByName(ABA_OTP);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    var row = [email, codigo, expiraEm, false, '', '', agora_()];
    if (linha === -1) aba.appendRow(row); else aba.getRange(linha, 1, 1, row.length).setValues([row]);
  });

  enviarEmailBrevo_(email, '🔑 Seu código de acesso — WAL Imóveis',
    'Seu código de acesso ao Sistema Web WAL Imóveis é: ' + codigo + '\n\nVálido por 10 minutos. Se você não pediu este código, ignore este e-mail.');
  return { status: 'ok' };
}

function cadastro_loginVerificarCodigo_(data) {
  var email = normalizarEmail_(data.email);
  var codigo = s_(data.codigo).trim();
  if (!email || !codigo) return { status: 'error', message: 'E-mail e código são obrigatórios.' };

  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
    var abaOtp = ss.getSheetByName(ABA_OTP);
    var linhaOtp = acharLinhaPorChave_(abaOtp, 'Email', email);
    if (linhaOtp === -1) return { status: 'error', message: 'Solicite um novo código.' };
    var vals = abaOtp.getRange(linhaOtp, 1, 1, 7).getValues()[0];
    var expiraEm = new Date(vals[2]);
    if (codigo !== s_(vals[1])) return { status: 'error', message: 'Código incorreto.' };
    if (!isNaN(expiraEm.getTime()) && expiraEm < new Date()) return { status: 'error', message: 'Código expirado. Solicite outro.' };

    var token = gerarToken_();
    var tokenExpira = new Date(Date.now() + 24 * 3600000).toISOString();
    abaOtp.getRange(linhaOtp, 4, 1, 3).setValues([[true, token, tokenExpira]]);

    var abaUsu = ss.getSheetByName(ABA_USUARIOS);
    var linhaUsu = acharLinhaPorChave_(abaUsu, 'Email', email);

    // E-mail confirmado por OTP mas ainda não cadastrado por um Admin —
    // cria a linha como pendente em vez de travar num beco sem saída,
    // mesmo princípio do Feirão (PARTICIPANTES ganha registro no
    // primeiro login verificado). A Diretoria ativa depois pela tela
    // de gestão.
    if (linhaUsu === -1) {
      var headersUsu = abaUsu.getRange(1, 1, 1, abaUsu.getLastColumn()).getValues()[0];
      var id = gerarId_(abaUsu, 'US');
      var camposCriar = {
        ID: id, Email: email, Nome: '', Telefone: '', Dashboards: '', Dashboard_Padrao: '',
        Status: 'pendente', Construtora: '', Cadastrado_Por: 'Auto (login)', Data_Cadastro: agora_(), Ultimo_Acesso: agora_()
      };
      abaUsu.appendRow(headersUsu.map(function (h) { return camposCriar[h] !== undefined ? camposCriar[h] : ''; }));
      return { status: 'ok', sessionToken: token, situacao: 'novo_pendente' };
    }

    var headersUsu2 = abaUsu.getRange(1, 1, 1, abaUsu.getLastColumn()).getValues()[0];
    abaUsu.getRange(linhaUsu, headersUsu2.indexOf('Ultimo_Acesso') + 1).setValue(agora_());
    var usuario = lerAbaObjetos_(abaUsu).find(function (u) { return normalizarEmail_(u.Email) === email; });
    var status = s_(usuario.Status).toLowerCase() || 'pendente';
    if (status !== 'ativo') return { status: 'ok', sessionToken: token, situacao: status === 'inativo' ? 'inativo' : 'pendente' };

    var dashboardsIds = s_(usuario.Dashboards).split(',').map(function (d) { return d.trim(); }).filter(Boolean);
    if (!dashboardsIds.length) return { status: 'ok', sessionToken: token, situacao: 'sem_dashboard' };

    var catalogo = cadastro_listarDashboards_({});
    var dashboards = dashboardsIds.map(function (id) {
      var d = catalogo.find(function (c) { return c.id === id; });
      return d ? { id: d.id, nome: d.nome, icone: d.icone, rota: d.rota } : { id: id, nome: id, icone: '📄', rota: '' };
    });
    var padraoId = s_(usuario.Dashboard_Padrao) || dashboardsIds[0];
    var padrao = dashboards.find(function (d) { return d.id === padraoId; }) || dashboards[0];

    return {
      status: 'ok', sessionToken: token, situacao: 'ok',
      dashboards: dashboards, dashboardPadrao: padrao.id, rotaPadrao: padrao.rota
    };
  });
}

/* ══════════════════ LEAD GATE — 5 pontos de acesso do index.html ═══
   (Simular Financiamento, Acessar E-book, Ver Todos, Consultor IA,
   Quero Reservar). Mesmo e-mail+OTP do botão "Acessar meu Dashboard"
   — reaproveita cadastro_loginSolicitarCodigo_ tal como está para o
   envio do código — mas a verificação e o cadastro aqui são
   próprios, consultando/gravando na aba LEADS (planilha "WAL — CRM
   de Leads"), não em USUARIOS. Duplica a validação de OTP em vez de
   reaproveitar cadastro_loginVerificarCodigo_ de propósito, para não
   arriscar tocar numa função já em produção do login de Dashboard. */
function cadastro_leadVerificarCodigo_(data) {
  var email = normalizarEmail_(data.email);
  var codigo = s_(data.codigo).trim();
  if (!email || !codigo) return { status: 'error', message: 'E-mail e código são obrigatórios.' };

  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
    var abaOtp = ss.getSheetByName(ABA_OTP);
    var linhaOtp = acharLinhaPorChave_(abaOtp, 'Email', email);
    if (linhaOtp === -1) return { status: 'error', message: 'Solicite um novo código.' };
    var vals = abaOtp.getRange(linhaOtp, 1, 1, 7).getValues()[0];
    var expiraEm = new Date(vals[2]);
    if (codigo !== s_(vals[1])) return { status: 'error', message: 'Código incorreto.' };
    if (!isNaN(expiraEm.getTime()) && expiraEm < new Date()) return { status: 'error', message: 'Código expirado. Solicite outro.' };

    var token = gerarToken_();
    var tokenExpira = new Date(Date.now() + 24 * 3600000).toISOString();
    abaOtp.getRange(linhaOtp, 4, 1, 3).setValues([[true, token, tokenExpira]]);

    var ssCrm = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
    var abaLeads = ssCrm.getSheetByName(ABA_LEADS);
    var linhaLead = acharLinhaPorChave_(abaLeads, 'Email', email);
    if (linhaLead === -1) return { status: 'ok', sessionToken: token, conhecido: false };

    var headersLead = abaLeads.getRange(1, 1, 1, abaLeads.getLastColumn()).getValues()[0];
    var colAtualizado = headersLead.indexOf('Atualizado em');
    if (colAtualizado !== -1) abaLeads.getRange(linhaLead, colAtualizado + 1).setValue(agora_());
    var colNome = headersLead.indexOf('Nome');
    var nomeExistente = colNome !== -1 ? s_(abaLeads.getRange(linhaLead, colNome + 1).getValue()) : '';
    return { status: 'ok', sessionToken: token, conhecido: true, nome: nomeExistente };
  });
}

/* ══════════════════ VERIFICAÇÃO DE E-MAIL — formulário "Quero
   conhecer as opções" (index.html) ══════════════════
   Só confirma que o código bate e não expirou (mesma validação
   duplicada de cadastro_loginVerificarCodigo_/cadastro_leadVerificarCodigo_,
   de propósito — não reaproveita nenhuma das duas pra não arriscar mexer
   numa função já em produção) — sem nenhum efeito colateral em USUARIOS
   nem na aba LEADS do CRM. Quem grava os dados do formulário depois disso
   é o próprio index.html, direto nos backends que aquele formulário já
   usava antes (GOOGLE_SCRIPT_URL e CRM_URL) — este script só prova que o
   e-mail é de verdade. */
function cadastro_email_verificar_codigo_(data) {
  var email = normalizarEmail_(data.email);
  var codigo = s_(data.codigo).trim();
  if (!email || !codigo) return { status: 'error', message: 'E-mail e código são obrigatórios.' };

  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
    var abaOtp = ss.getSheetByName(ABA_OTP);
    var linhaOtp = acharLinhaPorChave_(abaOtp, 'Email', email);
    if (linhaOtp === -1) return { status: 'error', message: 'Solicite um novo código.' };
    var vals = abaOtp.getRange(linhaOtp, 1, 1, 7).getValues()[0];
    var expiraEm = new Date(vals[2]);
    if (codigo !== s_(vals[1])) return { status: 'error', message: 'Código incorreto.' };
    if (!isNaN(expiraEm.getTime()) && expiraEm < new Date()) return { status: 'error', message: 'Código expirado. Solicite outro.' };

    var token = gerarToken_();
    var tokenExpira = new Date(Date.now() + 24 * 3600000).toISOString();
    abaOtp.getRange(linhaOtp, 4, 1, 3).setValues([[true, token, tokenExpira]]);

    return { status: 'ok', sessionToken: token };
  });
}

/* Confirma que este e-mail passou pelo OTP (Verificado=true, token
   confere, sessão ainda não expirou) antes de deixar gravar um lead
   novo — mesmo princípio de validarSessaoLead_ do Feirão. */
function _sessaoOtpValida_(email, sessionToken) {
  var emailN = normalizarEmail_(email);
  var token = s_(sessionToken).trim();
  if (!emailN || !token) return false;
  var ss = SpreadsheetApp.openById(PLANILHA_CADASTRO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_OTP));
  var achado = linhas.find(function (l) { return normalizarEmail_(l.Email) === emailN; });
  if (!achado || achado.Verificado !== true || s_(achado.Session_Token) !== token) return false;
  var exp = new Date(achado.Session_Expira_em);
  return !isNaN(exp.getTime()) && exp > new Date();
}

function cadastro_leadRegistrar_(data) {
  var email = normalizarEmail_(data.email);
  if (!_sessaoOtpValida_(email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var nome = s_(data.nome).trim();
  if (!nome) return { status: 'error', message: 'Nome é obrigatório.' };

  return comLock_(function () {
    var ssCrm = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
    var aba = ssCrm.getSheetByName(ABA_LEADS);
    // Corrida entre "verificar" e "registrar" (ex.: duplo clique) já pode
    // ter criado a linha — não duplica.
    if (acharLinhaPorChave_(aba, 'Email', email) !== -1) return { status: 'ok' };
    var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    var agoraStr = agora_();
    var camposCriar = {
      ID: 'CRM_' + Date.now(), Status: 'novo', Prioridade: 'alta', Nome: nome, Email: email,
      Origem: data.origem || '', 'Criado em': agoraStr, 'Atualizado em': agoraStr
    };
    aba.appendRow(headers.map(function (h) { return camposCriar[h] !== undefined ? camposCriar[h] : ''; }));
    return { status: 'ok' };
  });
}

/* ══════════════════ doGet / doPost ══════════════════ */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var callback = (e && e.parameter && e.parameter.callback) || '';
  var p = (e && e.parameter) || {};
  try {
    var result;
    switch (action) {
      case 'cadastro_listar_usuarios':   result = { ok: true, itens: cadastro_listarUsuarios_(p) }; break;
      case 'cadastro_listar_dashboards': result = { ok: true, itens: cadastro_listarDashboards_(p) }; break;
      case 'cadastro_login_verificar_codigo': result = cadastro_loginVerificarCodigo_(p); break;
      case 'cadastro_lead_verificar_codigo':  result = cadastro_leadVerificarCodigo_(p); break;
      case 'cadastro_email_verificar_codigo': result = cadastro_email_verificar_codigo_(p); break;
      default:                           result = { ok: false, erro: 'Ação desconhecida: ' + action };
    }
    return jsonpOut_(callback, result);
  } catch (err) {
    return jsonpOut_(callback, { ok: false, erro: err.message });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var out;
    switch (data.action) {
      case 'cadastro_usuario':   out = cadastro_usuarioCrud_(data); break;
      case 'cadastro_dashboard': out = cadastro_dashboardCrud_(data); break;
      case 'cadastro_login_solicitar_codigo': out = cadastro_loginSolicitarCodigo_(data); break;
      case 'cadastro_lead_registrar':         out = cadastro_leadRegistrar_(data); break;
      default:                   out = { status: 'error', message: 'Ação desconhecida: ' + data.action };
    }
    return jsonOut_(out);
  } catch (err) {
    Logger.log('ERRO doPost: ' + err.message);
    return jsonOut_({ status: 'error', message: err.message });
  }
}
