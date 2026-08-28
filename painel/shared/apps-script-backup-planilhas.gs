/* ══════════════════════════════════════════════════════════════════
   WAL Imóveis — Backup Diário das Planilhas
   Data: 28-08-2026
   ══════════════════════════════════════════════════════════════════
   Projeto ISOLADO, numa conta Google PESSOAL (não Workspace) — mesmo
   motivo do apps-script-upload-documentos-agente.gs: a conta Workspace
   que roda os outros backends deste sistema bloqueia DriveApp por
   política de segurança do domínio, e este script PRECISA de DriveApp
   pra copiar as planilhas pra pasta de destino. Não tem como rodar
   isso na conta Workspace.

   Faz uma cópia completa (arquivo novo, Google Sheets, com todas as
   abas/fórmulas/formatação) de cada planilha listada em
   PLANILHAS_BACKUP, todo dia de madrugada, salvando na pasta de
   destino no Drive (Antonio, 28/08/2026). Apaga sozinho cópias com
   mais de RETENCAO_DIAS pra pasta não crescer pra sempre.

   ── COMO IMPLANTAR (1ª vez) ──
   1. Na conta PESSOAL que já roda apps-script-upload-documentos-agente.gs
      (ou outra conta pessoal à sua escolha — só não pode ser a
      Workspace), crie um projeto Apps Script novo (script.google.com
      → Novo projeto, ou Extensões → Apps Script numa planilha
      qualquer dessa conta — não precisa estar ligado a planilha
      nenhuma). Cole todo este arquivo.
   2. Garanta que essa conta pessoal tem acesso de LEITURA (Leitor já
      basta) às 4 planilhas listadas em PLANILHAS_BACKUP abaixo, e
      acesso de EDITOR na pasta de destino (PASTA_DESTINO_ID) —
      compartilhe cada uma com o e-mail dessa conta pessoal se ainda
      não tiver (Compartilhar → cole o e-mail → Leitor/Editor).
   3. Rode a função testeAutorizarDrive() uma vez pelo editor (▶
      Executar) pra forçar a tela de autorização de Drive de uma vez
      só, antes de qualquer outra coisa.
   4. Implantar → Nova implantação → Aplicativo da Web → Executar como
      "Eu", Quem pode acessar "Qualquer pessoa" → Implantar.
   5. Cole a URL /exec em BACKUP_API_URL no topo do admin.html.
   6. Clique em "▶ Ativar Backup Diário" na aba Backup do admin.html
      (ou rode configurarGatilhoDiario() uma vez pelo editor) — isso
      liga um gatilho de tempo que roda TODO santo dia às 3h da manhã,
      mesmo com o navegador fechado. O admin.html só liga/desliga e
      mostra o status; quem executa de verdade é o próprio Google.
═══════════════════════════════════════════════════════════════════ */

var PLANILHAS_BACKUP = [
  { id: '1UKSyzkYpVxtsSb4UrBvgslp7FFXtYk8DUeqJVGzk0M0', nome: 'Leads Landing Page FAB' },
  { id: '1Gl7YzDSVoXr_EIwv78L50I8uErhmVRhvwwaJ-2xYwnk', nome: 'WAL Imóveis — Portfólio' },
  { id: '1QKt4iVS_JaFI9Ir_gpOpAUcR4t8rrNJbYwLaH84BUdI', nome: 'Gestão de Usuários e Dashboards' },
  { id: '1LeIsShjdVMKuB99cJf_N-eBW3M8lf_uo-la88CQjvH4', nome: 'WAL — CRM de Leads' }
];
var PASTA_DESTINO_ID = '1xQw-3yUvkPZ6uMgqrY0Z_fbNqlmXTTWM';
var RETENCAO_DIAS = 30;
var ADMIN_PIN = 'FAB2024'; // mesmo PIN já usado no resto do admin.html
var TZ = Session.getScriptTimeZone() || 'America/Sao_Paulo';
var MARCADOR_NOME = ' — Backup '; // identifica arquivos criados por este script na pasta

function s_(v) { return (v === null || v === undefined) ? '' : String(v); }
function agora_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function autorizarAdmin_(pin) { return s_(pin).trim() === ADMIN_PIN; }

/* Copia cada planilha da lista pra pasta de destino + limpa backups
   vencidos. Chamada tanto pelo gatilho automático (de madrugada, sem
   ninguém olhando) quanto manualmente via "Rodar Agora" no
   admin.html — o mesmo código nos dois casos, sem duplicar lógica. */
function executarBackup() {
  var pasta = DriveApp.getFolderById(PASTA_DESTINO_ID);
  var carimbo = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm');
  var resultados = [];

  PLANILHAS_BACKUP.forEach(function (p) {
    try {
      var original = DriveApp.getFileById(p.id);
      var nomeCopia = p.nome + MARCADOR_NOME + carimbo;
      original.makeCopy(nomeCopia, pasta);
      resultados.push({ planilha: p.nome, status: 'ok' });
    } catch (e) {
      resultados.push({ planilha: p.nome, status: 'error', mensagem: e.message });
    }
  });

  var apagados = limparBackupsAntigos_(pasta);
  var relatorio = { executadoEm: agora_(), resultados: resultados, apagados: apagados };
  PropertiesService.getScriptProperties().setProperty('ULTIMO_BACKUP', JSON.stringify(relatorio));
  return relatorio;
}

/* Só apaga (joga no lixo, não some de vez) arquivos cujo nome contém
   MARCADOR_NOME — nunca mexe em nada que alguém tenha colocado na
   pasta manualmente — e só os com mais de RETENCAO_DIAS. */
function limparBackupsAntigos_(pasta) {
  var limite = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
  var arquivos = pasta.getFiles();
  var apagados = 0;
  while (arquivos.hasNext()) {
    var arq = arquivos.next();
    if (arq.getName().indexOf(MARCADOR_NOME) === -1) continue;
    if (arq.getDateCreated() < limite) { arq.setTrashed(true); apagados++; }
  }
  return apagados;
}

/* Idempotente — remove qualquer gatilho antigo desta função antes de
   criar um novo, então dá pra clicar em "Ativar" de novo sem
   duplicar backups no mesmo dia. */
function configurarGatilhoDiario() {
  removerGatilho();
  ScriptApp.newTrigger('executarBackup').timeBased().everyDays(1).atHour(3).create();
  return { status: 'ok', ativo: true };
}
function removerGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'executarBackup') ScriptApp.deleteTrigger(t);
  });
  return { status: 'ok', ativo: false };
}
function statusBackup_() {
  var ativo = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'executarBackup'; });
  var ultimoRaw = PropertiesService.getScriptProperties().getProperty('ULTIMO_BACKUP');
  return {
    status: 'ok', ativo: ativo,
    ultimo: ultimoRaw ? JSON.parse(ultimoRaw) : null,
    planilhas: PLANILHAS_BACKUP.map(function (p) { return p.nome; }),
    retencaoDias: RETENCAO_DIAS
  };
}

/* Função de teste manual — rode uma vez pelo editor (▶ Executar) na
   1ª implantação pra forçar a tela de autorização de Drive de uma vez
   só, antes de testar via API de verdade. */
function testeAutorizarDrive() {
  var pasta = DriveApp.getFolderById(PASTA_DESTINO_ID);
  var teste = pasta.createFolder('_teste_autorizacao_apagar');
  teste.setTrashed(true);
}

function jsonpOut_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) body = callback + '(' + body + ')';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* Tudo via GET+JSONP (mesmo padrão de equipeJsonp em admin.html) —
   inclusive as ações que mudam estado (rodar_agora/ativar/desativar):
   são rápidas e sem payload grande, então não precisam do padrão
   fire-and-forget POST usado pra upload de arquivo em outros
   backends deste sistema. Todas exigem authPin. */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var callback = (e && e.parameter && e.parameter.callback) || '';
  var p = (e && e.parameter) || {};
  try {
    if (!autorizarAdmin_(p.authPin)) return jsonpOut_(callback, { status: 'error', message: 'PIN incorreto ou ausente.' });
    var result;
    switch (action) {
      case 'status':      result = statusBackup_(); break;
      case 'rodar_agora': result = executarBackup(); result.status = 'ok'; break;
      case 'ativar':      result = configurarGatilhoDiario(); break;
      case 'desativar':   result = removerGatilho(); break;
      default:            result = { status: 'error', message: 'Ação desconhecida: ' + action };
    }
    return jsonpOut_(callback, result);
  } catch (err) {
    return jsonpOut_(callback, { status: 'error', message: err.message });
  }
}
