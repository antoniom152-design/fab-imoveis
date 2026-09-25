/* ════════════════════════════════════════════════════════════════
   CFIAe — LINKS, DISPAROS e RELATÓRIOS (pedido 96.3)
   CONFIRMADO 24/09/2026: projeto certo é o do "Cadastro Único"
   (var PLANILHA_CADASTRO_ID = 'WAL Imóveis — Sistema Web · Cadastro
   Único', o que já tem crm_pessoa_verificar_codigo_, crm_indicacao_listar_,
   PLANILHA_CRM_LEADS_ID etc.) — Antonio confirmou colando o .gs
   completo. A função de resposta JSONP desse projeto é jsonpOut_
   (não "responderJsonp_", nome suposto na 1ª versão deste arquivo).

   COMO INSTALAR — 2 passos:

   1) Cole o BLOCO DE FUNÇÕES abaixo em qualquer lugar do arquivo,
      antes do comentário "══ doGet / doPost ══" (fora de qualquer
      outra função).

   2) Dentro de doGet(), no switch(action), acrescente estas 5 linhas
      (em qualquer ordem, antes do "default:"):

        case 'crm_cfiae_link_criar':        result = crm_cfiae_link_criar_(p); break;
        case 'crm_cfiae_link_listar':       result = crm_cfiae_link_listar_(); break;
        case 'crm_cfiae_disparo_criar':     result = crm_cfiae_disparo_criar_(p); break;
        case 'crm_cfiae_disparo_listar':    result = crm_cfiae_disparo_listar_(); break;
        case 'crm_cfiae_indicacoes_listar': result = crm_cfiae_indicacoes_listar_(p); break;

   Não precisa mexer em doPost() — todas essas 5 actions (mesmo as que
   escrevem) passam por doGet/JSONP, mesmo padrão já usado por
   crm_indicacao_criar/crm_pessoa_cadastrar nesse arquivo.

   PLANILHA — usa SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID), a
   MESMA planilha "WAL — CRM de Leads" que já tem AGENTES / INDICACOES
   / AGENDAMENTOS_VISITA_LEAD (constantes já existem no projeto — não
   precisa declarar de novo).

   Crie 2 abas novas nessa planilha, linha 1 = cabeçalho exatamente
   como abaixo (ordem importa, é lida por índice de coluna):

   Aba "CFIAE_LINKS":
     A: Id_Link | B: EmpId | C: EmpNome | D: DataHora | E: AgenteId | F: Observacao

   Aba "CFIAE_DISPAROS":
     A: Id_Disparo | B: Id_Link | C: EmpId | D: EmpNome | E: DataDisparo | F: AgenteId | G: Observacao

   Nenhuma aba nova precisa ser criada para os Relatórios — a contagem
   de Leads/Em Análise/Visitas Agendadas/Fechamentos é calculada em
   cima do que já existe em INDICACOES (coluna Campanha_Id, já
   gravada por crm_indicacao_publica_criar_ quando o link tem
   &campanha=) e AGENDAMENTOS_VISITA_LEAD (coluna Lead_Id).
   ════════════════════════════════════════════════════════════════ */

function crm_cfiae_link_criar_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
    var sheet = ss.getSheetByName('CFIAE_LINKS');
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
  var ss = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
  var sheet = ss.getSheetByName('CFIAE_LINKS');
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
    var ss = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
    var sheet = ss.getSheetByName('CFIAE_DISPAROS');
    if (!sheet) return { status: 'erro', message: 'Aba CFIAE_DISPAROS não encontrada.' };
    var idDisparo = 'DSP' + Utilities.formatDate(new Date(), 'GMT-3', 'yyyyMMddHHmmss');
    sheet.appendRow([idDisparo, p.idLink, p.empId, p.empNome, p.dataDisparo, p.agenteId, p.observacao || '']);
    return { status: 'ok', idDisparo: idDisparo };
  } catch (e) {
    return { status: 'erro', message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function crm_cfiae_disparo_listar_() {
  var ss = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
  var sheet = ss.getSheetByName('CFIAE_DISPAROS');
  if (!sheet) return { status: 'erro', message: 'Aba CFIAE_DISPAROS não encontrada.', itens: [] };
  var rows = sheet.getDataRange().getValues();
  var itens = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    itens.push({
      idDisparo: r[0], idLink: r[1], empId: r[2], empNome: r[3],
      dataDisparo: (r[4] instanceof Date) ? r[4].toISOString() : r[4],
      agenteId: r[5], observacao: r[6]
    });
  }
  itens.reverse();
  return { status: 'ok', itens: itens };
}

/* ═══ RELATÓRIOS (pedido 96.3, parte 2) ═══
   Sem OTP de propósito — o Painel do CFIAe não tem login de pessoa
   (mesmo padrão das 4 funções acima), então esta action recebe o
   agenteId direto e devolve TODAS as indicações desse agente, já
   com o flag "visitaAgendada" calculado (join por Lead_Id em
   AGENDAMENTOS_VISITA_LEAD) pra não precisar de uma 2ª chamada. */
function crm_cfiae_indicacoes_listar_(p) {
  var agenteId = String(p.agenteId || '').trim();
  if (!agenteId) return { status: 'erro', message: 'agenteId é obrigatório.', itens: [] };

  var ss = SpreadsheetApp.openById(PLANILHA_CRM_LEADS_ID);
  var abaInd = ss.getSheetByName(ABA_INDICACOES);
  if (!abaInd) return { status: 'erro', message: 'Aba INDICACOES não encontrada.', itens: [] };

  var headersInd = abaInd.getRange(1, 1, 1, abaInd.getLastColumn()).getValues()[0];
  var colInd = {};
  headersInd.forEach(function (h, i) { colInd[h] = i; });

  var linhasAgendadas = {};
  var abaAgenda = ss.getSheetByName(ABA_AGENDAMENTOS_VISITA_LEAD);
  if (abaAgenda && abaAgenda.getLastRow() > 1) {
    var headersAg = abaAgenda.getRange(1, 1, 1, abaAgenda.getLastColumn()).getValues()[0];
    var colLeadId = headersAg.indexOf('Lead_Id');
    if (colLeadId !== -1) {
      var valoresAg = abaAgenda.getRange(2, 1, abaAgenda.getLastRow() - 1, abaAgenda.getLastColumn()).getValues();
      valoresAg.forEach(function (r) {
        var leadId = String(r[colLeadId] || '').trim();
        if (leadId) linhasAgendadas[leadId] = true;
      });
    }
  }

  var itens = [];
  if (abaInd.getLastRow() > 1) {
    var valoresInd = abaInd.getRange(2, 1, abaInd.getLastRow() - 1, abaInd.getLastColumn()).getValues();
    valoresInd.forEach(function (r) {
      var linhaAgenteId = String(r[colInd['Agente_Id']] || '').trim();
      if (linhaAgenteId !== agenteId) return;
      var id = String(r[colInd['Id']] || '').trim();
      if (!id) return;
      var criadoEm = r[colInd['Criado_em']];
      itens.push({
        id: id,
        nomeCliente: r[colInd['Nome_Cliente']] || '',
        empId: r[colInd['Emp_Id']] || '',
        status: r[colInd['Status']] || 'agente',
        campanhaId: colInd['Campanha_Id'] !== undefined ? String(r[colInd['Campanha_Id']] || '').trim() : '',
        criadoEm: (criadoEm instanceof Date) ? criadoEm.toISOString() : criadoEm,
        visitaAgendada: !!linhasAgendadas[id]
      });
    });
  }
  itens.reverse();
  return { status: 'ok', itens: itens };
}
