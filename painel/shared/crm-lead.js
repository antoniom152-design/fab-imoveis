/* ═══ GRAVAÇÃO DE LEAD + HISTÓRICO NO CRM (pedido 110b) ═══
   Componente compartilhado por todos os formulários do site que criam um
   lead na "WAL — CRM de Leads".

   Problema que resolve: antes, cada página mandava AO MESMO TEMPO a
   criação do lead (aba LEADS, projeto CRM) e a 1ª interação (aba
   HISTORICO_ATENDIMENTO_LEAD, backend Cadastro Único). Como o histórico
   não sabia o ID do lead novo, o backend procurava por e-mail/telefone —
   e com dois leads do mesmo e-mail criados em sequência o histórico podia
   ir pro lead errado ou se perder.

   Agora é EM SEQUÊNCIA: cria o lead, lê o ID devolvido pelo CRM
   ({ok:true,id:"CRM_..."}) e só então grava o histórico JÁ COM o leadId.
   Se não der pra ler o ID (rede/CORS/timeout), o histórico vai sem
   leadId e o backend cai na busca por contato de antes — e o lead NUNCA
   é reenviado (a 1ª requisição pode ter chegado mesmo sem resposta, e
   reenviar duplicaria o lead).

   Uso:
     const leadId = await WalCRM.gravarLeadEHistorico(CRM_URL, CADASTRO_API_URL,
       { action:'criarOuAtualizar', lead:{...}, interacao:{...} },
       { action:'crm_lead_evento_publico', telefone, email, tipo, texto, origem });
   (sem await = fire-and-forget, a sequência acontece do mesmo jeito)
*/
(function () {
  if (window.WalCRM) return;

  function postComTimeout_(url, payload, ms, modo) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, {
      method: 'POST', mode: modo || 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload), signal: controller.signal
    }).finally(() => clearTimeout(timer));
  }

  async function gravarLeadEHistorico(crmUrl, cadastroUrl, crmPayload, eventoPayload, opts) {
    opts = opts || {};
    let leadId = '';
    try {
      const resp = await postComTimeout_(crmUrl, crmPayload, opts.timeoutCrmMs || 12000, 'cors');
      const txt = await resp.text();
      try { const j = JSON.parse(txt); leadId = (j && (j.id || j.lead_id)) || ''; } catch (e) {}
    } catch (e) { /* sem ID — o backend acha o lead pelo contato */ }

    if (eventoPayload) {
      const evento = Object.assign({}, eventoPayload, leadId ? { leadId: leadId } : {});
      try { await postComTimeout_(cadastroUrl, evento, opts.timeoutEventoMs || 10000, 'no-cors'); } catch (e) {}
    }
    return leadId;
  }

  window.WalCRM = { gravarLeadEHistorico: gravarLeadEHistorico };
})();
