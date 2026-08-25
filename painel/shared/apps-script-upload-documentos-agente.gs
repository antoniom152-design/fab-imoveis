/* ═══════════════════════════════════════════════════════════════════
   WAL Imóveis — Upload de Documentos do Autocadastro (RG/CNH,
   comprovante de residência) pro Google Drive
   Data: 24-08-2026
   Google Sheets URL: https://script.google.com/macros/s/AKfycbwyVnBvuwYL56uLAM0AA86Ioe7q-u9AB7vgg8WUpVeHY4DAJwjPiFvxJIdUpzOTcBisCw/exec
   Código de implantação: AKfycbwyVnBvuwYL56uLAM0AA86Ioe7q-u9AB7vgg8WUpVeHY4DAJwjPiFvxJIdUpzOTcBisCw
   PASTA_DOCUMENTOS_CADASTRO_ID  
   link da pasta: https://drive.google.com/drive/folders/1wCfmfSvoiX9WUMNwiheF156E4CtKvueg?usp=sharing
   ═══════════════════════════════════════════════════════════════════
   Projeto ISOLADO, criado numa conta Google PESSOAL (não Workspace) de
   propósito. Motivo: o projeto principal do cadastro
   (apps-script-sistema-web-cadastro.gs) roda numa conta Workspace
   corporativa da WAL, e essa conta bloqueia chamadas ao DriveApp por
   política de segurança do domínio — mesmo depois do usuário conceder
   a autorização na tela de consentimento, a chamada real falha com
   "Access denied: DriveApp". Resolver isso exigiria um admin do
   Workspace mexer em Segurança → Controles de API, e mesmo assim não
   era garantido. Mais simples e sem risco: isolar só esta ação (upload
   de documento) num projeto novo, numa conta sem essa restrição.

   Só cuida do upload — login, OTP, cadastro do agente/corretor/
   atendente continuam 100% no projeto original
   (apps-script-sistema-web-cadastro.gs), sem nenhuma mudança de
   comportamento pro resto do Sistema Web.

   ── COMO IMPLANTAR (1ª vez) ──
   1. No Google Drive da conta PESSOAL (a que você quer usar), crie um
      projeto Apps Script novo (script.google.com → Novo projeto, ou
      Extensões → Apps Script numa planilha qualquer dessa conta — não
      precisa estar ligado a planilha nenhuma, esse script só usa
      Drive). Cole todo este arquivo.
   2. Garanta que essa conta pessoal tem acesso de EDITOR nestes 2
      recursos (compartilhe se ainda não tiver):
      - A pasta do Drive de destino: PASTA_DOCUMENTOS_CADASTRO_ID
        abaixo (https://drive.google.com/drive/folders/1PheLkFZrPBT-R5zHExtMpTEMSwZyquao)
      - A planilha "WAL — CRM de Leads" (PLANILHA_CRM_LEADS_ID) — só
        precisa poder LER a aba de OTP e ESCREVER na aba da pessoa
        (AGENTES/CORRETOR/ATENDENTES), mas mais simples compartilhar
        como Editor.
      - A planilha "WAL Sistema Web — Cadastro Único"
        (PLANILHA_CADASTRO_ID) — só leitura da aba OTP_CODES, pra
        validar a sessão. Compartilhar como Editor também é mais
        simples, mesmo que só precise ler.
      Se não quiser compartilhar as planilhas, dá pra simplificar este
      script pra não validar sessão nem gravar a URL de volta — ver
      comentário em crm_pessoa_upload_documentos_ abaixo.
   3. Implantar → Nova implantação → Aplicativo da Web → Executar como
      "Eu" (a conta pessoal), Quem pode acessar "Qualquer pessoa" →
      Implantar. Na hora de implantar/testar, o Google vai pedir
      autorização — aceite (essa conta pessoal não tem a restrição do
      Workspace, deve funcionar direto).
   4. Copie a URL /exec e cole em UPLOAD_DOCUMENTOS_API_URL no topo do
      painel/agente/dashboard-agente.html (troque o valor placeholder).
═══════════════════════════════════════════════════════════════════ */

/* Mesma pasta e mesmas planilhas já usadas pelo projeto principal —
   ver apps-script-sistema-web-cadastro.gs pros mesmos IDs/comentários
   de origem. Repetidos aqui de propósito (projeto isolado, sem como
   importar de outro .gs). */
var PASTA_DOCUMENTOS_CADASTRO_ID = '1PheLkFZrPBT-R5zHExtMpTEMSwZyquao';
var PLANILHA_CADASTRO_ID = '1QKt4iVS_JaFI9Ir_gpOpAUcR4t8rrNJbYwLaH84BUdI';
var ABA_OTP               = 'OTP_CODES';
var PLANILHA_CRM_LEADS_ID = '1LeIsShjdVMKuB99cJf_N-eBW3M8lf_uo-la88CQjvH4';
var ABA_AGENTES    = 'AGENTES';
var ABA_CORRETOR   = 'CORRETOR';
var ABA_ATENDENTES = 'ATENDENTES';
var CRM_PESSOA_ABAS_ = { agente: ABA_AGENTES, corretor: ABA_CORRETOR, atendente: ABA_ATENDENTES };

function s_(v) { return (v === null || v === undefined) ? '' : String(v); }
function normalizarEmail_(v) { return s_(v).trim().toLowerCase(); }
function headersDe_(aba) { return aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); }); }
function jsonOut_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function comLock_(fn) {
  var lock = LockService.getScriptLock();
  var ok = lock.tryLock(10000);
  try { return fn(); } finally { if (ok) lock.releaseLock(); }
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
/* Mesma lógica de apps-script-sistema-web-cadastro.gs — a sessão foi
   validada por OTP naquele projeto, mas OTP_CODES é uma planilha
   comum, então dá pra ler ela daqui também (desde que compartilhada
   com esta conta). */
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
function crm_pessoaAba_(tipo) {
  var t = s_(tipo).trim().toLowerCase();
  var nomeAba = CRM_PESSOA_ABAS_[t];
  if (!nomeAba) return null;
  var ss = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
  var aba = ss.getSheetByName(nomeAba);
  if (!aba) return null;
  return { tipo: t, aba: aba };
}

/* Acha (ou cria) a subpasta da pessoa dentro de
   PASTA_DOCUMENTOS_CADASTRO_ID. Reaproveita a pasta se já existir uma
   com o mesmo nome (ex.: pessoa reenviou documento). */
function pastaDocumentosPessoa_(nome) {
  var raiz = DriveApp.getFolderById(PASTA_DOCUMENTOS_CADASTRO_ID);
  var nomeLimpo = s_(nome).trim() || 'Sem nome';
  var existentes = raiz.getFoldersByName(nomeLimpo);
  if (existentes.hasNext()) return existentes.next();
  return raiz.createFolder(nomeLimpo);
}

/* Recebe os documentos (RG/CNH, comprovante de residência) em base64
   e salva no Drive, numa subpasta com o nome da pessoa. Também tenta
   gravar as URLs na aba da pessoa (AGENTES/CORRETOR/ATENDENTES), nas
   colunas Doc_RG_URL / Doc_Comprovante_Residencia_URL — SE existirem
   (não falha se não existirem).
   Se não quiser compartilhar as planilhas com esta conta pessoal, dá
   pra simplificar: trocar a validação de sessão por uma checagem mais
   simples (ex.: nenhuma, já que o endpoint é fire-and-forget e não
   devolve dado nenhum de volta) e pular o bloco que grava na planilha
   — os arquivos continuam indo pro Drive normalmente. */
function crm_pessoa_upload_documentos_(data) {
  var email = normalizarEmail_(data.email);
  if (!_sessaoOtpValida_(email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var ctx = crm_pessoaAba_(data.tipo);
  if (!ctx) return { status: 'error', message: 'Tipo de pessoa inválido.' };
  var documentos = data.documentos || [];
  if (!documentos.length) return { status: 'error', message: 'Nenhum documento recebido.' };

  return comLock_(function () {
    var linha = acharLinhaPorChave_(ctx.aba, 'Email', email);
    if (linha === -1) return { status: 'error', message: 'Cadastro não encontrado.' };
    var pessoa = lerAbaObjetos_(ctx.aba).find(function (p) { return normalizarEmail_(p.Email) === email; });
    var pasta = pastaDocumentosPessoa_((pessoa && pessoa.Nome) || data.nome);

    var urlPorDescricao = {};
    documentos.forEach(function (doc) {
      if (!doc.base64) return;
      var blob = Utilities.newBlob(Utilities.base64Decode(doc.base64), doc.tipo || 'application/octet-stream', doc.nome || (doc.descricao || 'documento'));
      var arquivo = pasta.createFile(blob);
      urlPorDescricao[doc.descricao || doc.nome] = arquivo.getUrl();
    });

    var headers = headersDe_(ctx.aba);
    var mapaColunas = { 'RG_ou_CNH': 'Doc_RG_URL', 'Comprovante_Residencia': 'Doc_Comprovante_Residencia_URL', 'Contrato_Assinado': 'Doc_Contrato_Assinado_URL' };
    Object.keys(urlPorDescricao).forEach(function (desc) {
      var colNome = mapaColunas[desc];
      var colIdx = colNome ? headers.indexOf(colNome) : -1;
      if (colIdx !== -1) ctx.aba.getRange(linha, colIdx + 1).setValue(urlPorDescricao[desc]);
    });

    return { status: 'ok', pastaUrl: pasta.getUrl(), urls: urlPorDescricao };
  });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var out;
    switch (data.action) {
      case 'crm_pessoa_upload_documentos': out = crm_pessoa_upload_documentos_(data); break;
      default: out = { status: 'error', message: 'Ação desconhecida: ' + data.action };
    }
    return jsonOut_(out);
  } catch (err) {
    Logger.log('ERRO doPost: ' + err.message);
    return jsonOut_({ status: 'error', message: err.message });
  }
}

/* Função de teste manual — rode uma vez pelo editor (▶ Executar) na
   1ª implantação pra forçar a tela de autorização de leitura+escrita
   do Drive de uma vez só, antes de testar via API de verdade. */
function testeAutorizarDrive() {
  var pasta = DriveApp.getFolderById(PASTA_DOCUMENTOS_CADASTRO_ID);
  var teste = pasta.createFolder('_teste_autorizacao_apagar');
  teste.setTrashed(true);
}
