/* ════════════════════════════════════════════════════════════════
   CFIAe — LINKS e DISPAROS
   Cole estas funções no MESMO projeto Apps Script do cadastro
   único (o que já tem crm_indicacao_listar, crm_pessoa_verificar_codigo
   etc.) e registre as 4 novas actions no seu roteador de doGet
   (o switch/if que já trata "action=..."), no mesmo padrão das
   demais — por exemplo:

     if (action === 'crm_cfiae_link_criar')     return responderJsonp_(crm_cfiae_link_criar_(e.parameter), e.parameter.callback);
     if (action === 'crm_cfiae_link_listar')    return responderJsonp_(crm_cfiae_link_listar_(), e.parameter.callback);
     if (action === 'crm_cfiae_disparo_criar')  return responderJsonp_(crm_cfiae_disparo_criar_(e.parameter), e.parameter.callback);
     if (action === 'crm_cfiae_disparo_listar') return responderJsonp_(crm_cfiae_disparo_listar_(), e.parameter.callback);

   ⚠️ Troque "responderJsonp_" pelo nome real da sua função que já
   envolve a resposta em "callback(JSON.stringify(...))" — não tenho
   o .gs completo pra copiar o nome exato, então ajuste essa parte.

   PLANILHA — crie 2 abas novas na MESMA planilha do cadastro único
   (a que já tem AGENTES / INDICACOES):

   Aba "CFIAE_LINKS" — linha 1 = cabeçalho:
     A: Id_Link | B: EmpId | C: EmpNome | D: DataHora | E: AgenteId | F: Observacao

   Aba "CFIAE_DISPAROS" — linha 1 = cabeçalho:
     A: Id_Disparo | B: Id_Link | C: EmpId | D: EmpNome | E: DataDisparo | F: AgenteId
   ════════════════════════════════════════════════════════════════ */

function crm_cfiae_link_criar_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CFIAE_LINKS');
    if (!sheet) return { status: 'erro', message: 'Aba CFIAE_LINKS não encontrada.' };
    var agora = new Date();
    var idLink = 'LNK' + Utilities.formatDate(agora, 'GMT-3', 'yyyyMMddHHmmss');
    sheet.appendRow([idLink, p.empId, p.empNome, agora, p.agenteId, p.observacao || '']);
    return { status: 'ok', idLink: idLink, dataHora: agora.toISOString() };
  } catch (e) {
    return { status: 'erro', message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function crm_cfiae_link_listar_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CFIAE_LINKS');
  if (!sheet) return { status: 'erro', message: 'Aba CFIAE_LINKS não encontrada.', itens: [] };
  var rows = sheet.getDataRange().getValues();
  var itens = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    itens.push({
      idLink: r[0], empId: r[1], empNome: r[2],
      dataHora: (r[3] instanceof Date) ? r[3].toISOString() : r[3],
      agenteId: r[4], observacao: r[5]
    });
  }
  itens.reverse(); // mais recentes primeiro
  return { status: 'ok', itens: itens };
}

function crm_cfiae_disparo_criar_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CFIAE_DISPAROS');
    if (!sheet) return { status: 'erro', message: 'Aba CFIAE_DISPAROS não encontrada.' };
    var idDisparo = 'DSP' + Utilities.formatDate(new Date(), 'GMT-3', 'yyyyMMddHHmmss');
    sheet.appendRow([idDisparo, p.idLink, p.empId, p.empNome, p.dataDisparo, p.agenteId]);
    return { status: 'ok', idDisparo: idDisparo };
  } catch (e) {
    return { status: 'erro', message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function crm_cfiae_disparo_listar_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CFIAE_DISPAROS');
  if (!sheet) return { status: 'erro', message: 'Aba CFIAE_DISPAROS não encontrada.', itens: [] };
  var rows = sheet.getDataRange().getValues();
  var itens = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    itens.push({
      idDisparo: r[0], idLink: r[1], empId: r[2], empNome: r[3],
      dataDisparo: r[4], agenteId: r[5]
    });
  }
  itens.reverse();
  return { status: 'ok', itens: itens };
}
