/**
 * WAL IMÓVEIS — MALA DIRETA (campanha de reativação de leads)  ·  v3 (operada pelo admin.html)
 * apps-script-mala-direta.gs — pedido 110.7 (08/10/2026)
 *
 * Origem: Code.gs v2 desta mesma pasta (modelado com o Claude). Mudanças desta versão:
 *   - Operação pela aba "Mala Direta" do admin.html (API com authPin), no lugar do Painel.html
 *     do Apps Script (google.script.run). A lógica de envio, textos, webhook e recadastro é a mesma.
 *   - Importação de leads colados no admin.html, marcação manual de status (ex.: lead que
 *     respondeu SAIR no WhatsApp) e "tentar pelo WhatsApp" para quem teve e-mail inválido.
 *   - Catálogo: ignora imóveis inativos/100% vendidos e lê o estágio de "Tipo de Imóvel".
 *
 * ── COMO IMPLANTAR (1ª vez) ──
 *   1. Crie uma planilha NOVA e PRIVADA: "WAL — Mala Direta" (separada da planilha pública do site).
 *   2. Na planilha: Extensões › Apps Script. Confira o nome do projeto no topo do editor
 *      (sugestão: "WAL — Mala Direta") e cole TODO este arquivo no lugar do Código.gs.
 *   3. Rode configurarMalaDireta() uma vez pelo editor (▶ Executar) e autorize. Ela cria as abas
 *      CAMPANHA_LEADS, CAMPANHA_LOG e CAMPANHA_TEXTOS.
 *   4. Implantar › Nova implantação › Aplicativo da Web › Executar como "Eu",
 *      Quem pode acessar "Qualquer pessoa". Copie a URL /exec.
 *   5. Propriedades do script (Configurações do projeto › Propriedades do script):
 *        BREVO_API_KEY   chave v3 da Brevo (xkeysib-...)
 *        URL_API         a URL /exec do passo 4
 *        WEBHOOK_KEY     um segredo qualquer, que vai na URL do webhook da Brevo (?k=...)
 *        BREVO_LIST_ID   (opcional) lista da Brevo para quem autorizar e-mail no recadastro
 *        PIN_CAMPANHA    (opcional) PIN extra; o admin.html já entra com o ADMIN_PIN abaixo
 *   6. Cole a URL /exec em MD_API_URL (admin.html) e em CONFIG.API_URL (recadastro.html).
 *
 * Contrato com recadastro.html (v5):
 *   GET  ?a=catalogo        -> {ok:true, imoveis:[{id,nome,cidade,bairro,estagio,preco,url}]}
 *   GET  ?a=visita&t=TOKEN  -> {ok:true}  (registra a visita; não devolve nenhum dado pessoal)
 *   POST {acao:'recadastro'} com Content-Type text/plain -> {ok:true} SOMENTE depois de gravar
 *
 * Contrato com admin.html (aba Mala Direta):
 *   GET  ?action=md_*&authPin=...&callback=fn   (JSONP, ações pequenas)
 *   POST {action:'md_*', authPin:'...', ...}    (text/plain; prévia, salvar textos, importar)
 *   Resposta: {status:'ok', ...} ou {status:'error', message:'...'}
 */

// Mesmo PIN do admin.html (const ADMIN_PIN). Se PIN_CAMPANHA existir nas propriedades, também vale.
const ADMIN_PIN = 'FAB2024';

const CFG = {
  ABA_LEADS: 'CAMPANHA_LEADS',
  ABA_LOG: 'CAMPANHA_LOG',
  ABA_TEXTOS: 'CAMPANHA_TEXTOS',
  TAG: 'reativacao-fab-2026',
  URL_RECADASTRO: 'https://walservidor.com.br/recadastro.html',
  URL_IMOVEL: 'https://walservidor.com.br/imovel.html',
  PLANILHA_SITE: '1Gl7YzDSVoXr_EIwv78L50I8uErhmVRhvwwaJ-2xYwnk',
  ABA_SITE: 'IMOVEISDISPONIVEIS',
  REMETENTE_NOME: 'Antonio | WAL Imóveis',
  REMETENTE_EMAIL: 'comercial@walservidor.com.br',   // domínio autenticado na Brevo (DKIM/DMARC)
  RODAPE: 'WAL Imóveis e Consultoria · CRECI 12261-J · (21) 99726-3950 · comercial@walservidor.com.br',
  EMAIL_AVISO: '',            // recebe aviso de pedido de consultor ('' = não avisa)
  LOTE_MAX: 100,              // máximo por clique/execução
  LIMITE_DIA: 280,            // plano grátis da Brevo = 300/dia; folga para transacionais
  DIAS_LEMBRETE: 5,           // dias entre o 1º envio e o lembrete
  DIAS_VALIDADE_TOKEN: 120,   // link do e-mail vale 120 dias após o 1º envio
  MESES_LEAD_RECENTE: 6,
  FUSO: 'America/Sao_Paulo',
  // Chaves iguais às regiões do recadastro.html (parâmetro ?regiao=)
  REGIOES: {
    RJ:      { nome: 'Rio de Janeiro',      opcoes: '62 opções no estado do Rio (Rio de Janeiro, Niterói e São Pedro da Aldeia)' },
    SPA:     { nome: 'São Pedro da Aldeia', opcoes: '62 opções no estado do Rio (Rio de Janeiro, Niterói e São Pedro da Aldeia)' },
    SJC:     { nome: 'Vale do Paraíba',     opcoes: '20 opções em São Paulo (Vale do Paraíba, capital e litoral)' },
    SP:      { nome: 'São Paulo',           opcoes: '20 opções em São Paulo (capital, Vale do Paraíba e litoral)' },
    LITORAL: { nome: 'Caraguatatuba',       opcoes: '20 opções em São Paulo (litoral, Vale do Paraíba e capital)' },
    GERAL:   { nome: 'Rio de Janeiro e São Paulo', opcoes: '82 empreendimentos no Rio de Janeiro e em São Paulo' }
  }
};

const COLUNAS = ['ID', 'NOME', 'TELEFONE', 'EMAIL', 'ORIGEM', 'EMPREENDIMENTO', 'DT_CADASTRO',
  'CANAL', 'TOKEN', 'STATUS', 'ENVIOS', 'DT_ENVIO_1', 'DT_ENVIO_2', 'DT_ABERTURA', 'DT_CLIQUE',
  'DT_RECADASTRO', 'SITUACAO', 'EMAIL_ATUAL', 'CIDADE_INTERESSE', 'OBJETIVO', 'PRAZO', 'VINCULO',
  'OBSERVACOES', 'SOLICITA_ATENDIMENTO', 'DT_ATENDIDO', 'CONSENT_EMAIL', 'CONSENT_WHATSAPP',
  'VERSAO_TEXTO', 'CAMPANHA', 'MSG_ID', 'OBS'];

// Funil: status automático só sobe. Os finais não voltam por evento automático;
// só o próprio lead, pelo formulário, muda um status final.
const NIVEL = { PENDENTE: 0, ENVIADO: 1, ABRIU: 2, CLICOU: 3, RECADASTROU: 4 };
const FINAIS = ['COMPROU', 'SEM_INTERESSE', 'SAIR', 'INVALIDO', 'SPAM', 'DUPLICADO', 'ERRO_ENVIO'];
const SITUACAO_STATUS = { buscando: 'RECADASTROU', adiou: 'RECADASTROU', comprou: 'COMPROU',
  sem_interesse: 'SEM_INTERESSE', nao_contatar: 'SAIR' };
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_TOKEN = /^[a-f0-9]{32}$/;

/* ============================== PREPARAÇÃO ============================== */

/** 1) Rode uma vez pelo editor: cria as abas de leads, de registro e de textos. Pode rodar de novo. */
function configurarMalaDireta() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.ABA_LEADS) || ss.insertSheet(CFG.ABA_LEADS);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, COLUNAS.length).setValues([COLUNAS]).setFontWeight('bold')
      .setBackground('#0b1f3a').setFontColor('#d9b76a');
    sh.setFrozenRows(1);
  }
  const lg = ss.getSheetByName(CFG.ABA_LOG) || ss.insertSheet(CFG.ABA_LOG);
  if (lg.getLastRow() === 0) {
    lg.getRange(1, 1, 1, 5).setValues([['DATA', 'ID', 'CANAL', 'EVENTO', 'DETALHE']]).setFontWeight('bold')
      .setBackground('#0b1f3a').setFontColor('#d9b76a');
    lg.setFrozenRows(1);
  }
  abaTextos_();   // aba CAMPANHA_TEXTOS com os textos padrão, editáveis pelo admin.html
  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && padrao.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(padrao);
  return 'Abas prontas: ' + [CFG.ABA_LEADS, CFG.ABA_LOG, CFG.ABA_TEXTOS].join(', ');
}

/**
 * 2) Cole os leads (NOME, TELEFONE, EMAIL, ORIGEM, EMPREENDIMENTO, DT_CADASTRO) e rode.
 * Gera ID e TOKEN, define o CANAL (sem e-mail válido vai para WhatsApp), normaliza a
 * ORIGEM e marca como DUPLICADO quem repete e-mail OU telefone de outro lead.
 * Quem tem e-mail é preparado primeiro: se a mesma pessoa está na lista de e-mail e na do
 * WhatsApp, ela recebe só o e-mail. Pode rodar de novo ao colar mais leads.
 */
function prepararLeads() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const L = lerLeads_(), c = L.cab;
    const vistos = {};          // 'e:email' ou 't:DDD+8 dígitos' -> ID de quem chegou primeiro
    const chaveFone = function (v) { const f = normalizarFone_(v); return f ? 't:' + f.slice(2, 4) + f.slice(-8) : ''; };
    let seq = 0, novos = 0;
    L.linhas.forEach(function (r) {
      const id = String(r[c.ID]);
      if (/^L\d+$/.test(id)) seq = Math.max(seq, parseInt(id.slice(1), 10));
      if (!r[c.TOKEN] || r[c.STATUS] === 'DUPLICADO') return;
      const e = String(r[c.EMAIL]).trim().toLowerCase(), t = chaveFone(r[c.TELEFONE]);
      if (e) vistos['e:' + e] = vistos['e:' + e] || id;
      if (t) vistos[t] = vistos[t] || id;
    });
    const temEmail = function (r) { return RE_EMAIL.test(String(r[c.EMAIL]).trim().toLowerCase()); };
    const novas = L.linhas.filter(function (r) { return String(r[c.NOME]).trim() && !r[c.TOKEN]; });
    novas.filter(temEmail).concat(novas.filter(function (r) { return !temEmail(r); })).forEach(function (r) {
      const email = String(r[c.EMAIL]).trim().toLowerCase(), t = chaveFone(r[c.TELEFONE]);
      seq++; novos++;
      r[c.ID] = 'L' + ('0000' + seq).slice(-4);
      r[c.TOKEN] = novoToken_();
      r[c.EMAIL] = email;
      r[c.ORIGEM] = normalizarOrigem_(r[c.ORIGEM]);
      r[c.CANAL] = RE_EMAIL.test(email) ? 'EMAIL' : 'WHATSAPP';
      r[c.ENVIOS] = 0;
      const igual = (email && vistos['e:' + email]) || (t && vistos[t]);
      if (igual) {
        r[c.STATUS] = 'DUPLICADO';
        r[c.OBS] = 'Mesma pessoa que ' + igual;
      } else {
        r[c.STATUS] = 'PENDENTE';
        if (email) vistos['e:' + email] = r[c.ID];
        if (t) vistos[t] = r[c.ID];
      }
    });
    gravar_(L, ['ID', 'TOKEN', 'EMAIL', 'ORIGEM', 'CANAL', 'ENVIOS', 'STATUS', 'OBS']);
    log_([[new Date(), '', 'SISTEMA', 'PREPARAR', novos + ' leads preparados']]);
    return novos;
  } finally {
    lock.releaseLock();
  }
}

/* ============================== ENVIO (BREVO) ============================== */

/** Para usar em gatilho de tempo, se quiser envio diário automático. */
function envioAgendado() {
  try { enviarLote(1, CFG.LOTE_MAX); } catch (e) { log_([[new Date(), '', 'EMAIL', 'ERRO', String(e.message)]]); }
}

/** Envia um lote. etapa 1 = primeira mensagem; etapa 2 = lembrete a quem não clicou. */
function enviarLote(etapa, qtd) {
  etapa = Number(etapa) === 2 ? 2 : 1;
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty('BREVO_API_KEY');
  const urlApi = props.getProperty('URL_API');
  if (!chave || !urlApi) throw new Error('Defina BREVO_API_KEY e URL_API nas propriedades do script.');

  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  let fila;
  lock.waitLock(30000);
  try {
    if (cache.get('ENVIANDO')) throw new Error('Já existe um envio em andamento. Aguarde terminar.');
    const saldo = CFG.LIMITE_DIA - enviadosHoje_();
    const n = Math.min(Number(qtd) || CFG.LOTE_MAX, CFG.LOTE_MAX, saldo);
    if (n <= 0) throw new Error('Limite diário de ' + CFG.LIMITE_DIA + ' envios atingido.');
    fila = filaEmail_(lerLeads_(), etapa).slice(0, n);
    if (!fila.length) return { enviados: 0, falhas: 0, msg: 'Fila da etapa ' + etapa + ' está vazia.' };
    cache.put('ENVIANDO', '1', 600);
  } finally {
    lock.releaseLock();
  }

  const resultados = {};   // token -> {ok, msgId, erro, definitivo}
  const textos = lerTextos_();   // texto salvo no painel no momento do envio
  let saida;
  try {
    for (let i = 0; i < fila.length; i += 10) {
      const grupo = fila.slice(i, i + 10);
      const resps = UrlFetchApp.fetchAll(grupo.map(function (lead) {
        const m = montarEmail_(lead, etapa, urlApi, textos);
        return {
          url: 'https://api.brevo.com/v3/smtp/email',
          method: 'post',
          contentType: 'application/json',
          headers: { 'api-key': chave, accept: 'application/json' },
          muteHttpExceptions: true,
          payload: JSON.stringify({
            sender: { name: CFG.REMETENTE_NOME, email: CFG.REMETENTE_EMAIL },
            replyTo: { name: CFG.REMETENTE_NOME, email: CFG.REMETENTE_EMAIL },
            to: [{ email: lead.email, name: lead.nome }],
            subject: m.assunto,
            htmlContent: m.html,
            textContent: m.texto,
            tags: [CFG.TAG, 'etapa' + etapa]
          })
        };
      }));
      resps.forEach(function (resp, k) {
        const cod = resp.getResponseCode();
        let corpo = {};
        try { corpo = JSON.parse(resp.getContentText() || '{}'); } catch (e) { /* corpo não JSON */ }
        resultados[grupo[k].token] = (cod === 201 || cod === 202)
          ? { ok: true, msgId: corpo.messageId || '' }
          : { ok: false, definitivo: cod >= 400 && cod < 500 && cod !== 429,
              erro: 'Brevo ' + cod + ': ' + String(corpo.message || '').slice(0, 120) };
      });
      Utilities.sleep(400);
    }
  } finally {
    // Grava o que foi efetivamente enviado, mesmo se o laço for interrompido.
    lock.waitLock(30000);
    try {
      saida = registrarEnvios_(resultados, etapa);
    } finally {
      lock.releaseLock();
      cache.remove('ENVIANDO');
    }
  }
  return saida;
}

function registrarEnvios_(resultados, etapa) {
  const L = lerLeads_(), c = L.cab, agora = new Date(), logs = [];
  let ok = 0, falhas = 0;
  L.linhas.forEach(function (r) {
    const res = resultados[r[c.TOKEN]];
    if (!res) return;
    if (res.ok) {
      ok++;
      r[c.ENVIOS] = etapa;
      r[c['DT_ENVIO_' + etapa]] = agora;
      r[c.MSG_ID] = res.msgId;
      r[c.STATUS] = subir_(r[c.STATUS], 'ENVIADO');
      logs.push([agora, r[c.ID], 'EMAIL', 'ENVIO_' + etapa, res.msgId]);
    } else {
      falhas++;
      r[c.OBS] = res.erro;
      if (res.definitivo) r[c.STATUS] = 'ERRO_ENVIO';
      logs.push([agora, r[c.ID], 'EMAIL', 'FALHA_' + etapa, res.erro]);
    }
  });
  gravar_(L, ['ENVIOS', 'DT_ENVIO_1', 'DT_ENVIO_2', 'MSG_ID', 'STATUS', 'OBS']);
  log_(logs);
  if (ok) PropertiesService.getScriptProperties().setProperty(chaveDia_(), String(enviadosHoje_() + ok));
  return { enviados: ok, falhas: falhas, msg: ok + ' enviados, ' + falhas + ' falhas.' };
}

/** Fila de e-mail. Leads mais recentes saem primeiro: engajam mais e protegem a reputação do domínio. */
function filaEmail_(L, etapa) {
  const c = L.cab, corte = Date.now() - CFG.DIAS_LEMBRETE * 864e5;
  return L.linhas.filter(function (r) {
    if (r[c.CANAL] !== 'EMAIL' || !RE_EMAIL.test(String(r[c.EMAIL]))) return false;
    if (etapa === 1) return r[c.STATUS] === 'PENDENTE' && Number(r[c.ENVIOS]) === 0;
    return Number(r[c.ENVIOS]) === 1 && (r[c.STATUS] === 'ENVIADO' || r[c.STATUS] === 'ABRIU') &&
      r[c.DT_ENVIO_1] instanceof Date && r[c.DT_ENVIO_1].getTime() <= corte;
  }).sort(function (a, b) {
    return tempo_(b[c.DT_CADASTRO]) - tempo_(a[c.DT_CADASTRO]);
  }).map(function (r) {
    return { token: r[c.TOKEN], id: r[c.ID], nome: String(r[c.NOME]).trim(), email: String(r[c.EMAIL]).trim(),
      origem: r[c.ORIGEM], empreendimento: String(r[c.EMPREENDIMENTO]).trim(), dtCadastro: r[c.DT_CADASTRO] };
  });
}

/* ============================== MENSAGENS ============================== */
/*
 * Os textos ficam na aba CAMPANHA_TEXTOS e são editados no painel, em "Textos das mensagens".
 *   Variáveis: {primeiro_nome} {empreendimento} {regiao} {opcoes} {link}
 *   Blocos:    [antigo]…[/antigo]  [recente]…[/recente]
 *              [com_empreendimento]…[/com_empreendimento]  [sem_empreendimento]…[/sem_empreendimento]
 *   Uma linha em branco separa parágrafos. **texto** vira negrito (no WhatsApp, *texto*).
 * O rodapé legal e o link de descadastro do e-mail são fixos e não podem ser removidos.
 */
const TEXTOS_PADRAO = {
  EMAIL1_ASSUNTO: '{primeiro_nome}, a WAL mudou desde o seu contato',
  EMAIL1_CORPO: [
    'Olá, {primeiro_nome}.',
    '[com_empreendimento]Você falou com a WAL sobre o **{empreendimento}**.[/com_empreendimento][sem_empreendimento]Você falou com a WAL sobre imóveis em {regiao}.[/sem_empreendimento]',
    '[antigo]Naquela época, nossa oferta era pequena e cada simulação dependia de conversas, agendamentos e dias de espera. Ouvimos quem nos procurou e reconstruímos o atendimento.[/antigo][recente]Desde então, ampliamos bastante o que oferecemos.[/recente]',
    'Hoje são {opcoes}, entre lançamentos, imóveis em construção, novos e usados. No mapa, você vê a região, o entorno e os trajetos, e compara estimativas de financiamento em 4 instituições, na hora.',
    'Mesmo que não tenhamos avançado no primeiro contato, queremos retomar a conversa, se ainda fizer sentido para você.'
  ].join('\n\n'),
  EMAIL1_BOTAO: 'Ver o que mudou',
  EMAIL2_ASSUNTO: '{primeiro_nome}, ainda faz sentido para você?',
  EMAIL2_CORPO: [
    'Olá, {primeiro_nome}.',
    'Há alguns dias, convidamos você a conhecer o novo atendimento da WAL.',
    'Se ainda procura imóvel em {regiao}, o link abaixo mostra as opções e o mapa. Se seus planos mudaram, conte para nós em um minuto.',
    'Esta é a última mensagem desta campanha.'
  ].join('\n\n'),
  EMAIL2_BOTAO: 'Ver as opções e atualizar minha busca',
  EMAIL_NOTA: 'Seus planos mudaram? Na mesma página você pode nos contar, inclusive se já comprou ou se prefere não receber mais mensagens.',
  EMAIL_ASSINATURA: 'Antonio\nWAL Imóveis e Consultoria',
  WHATS_TEXTO: [
    'Olá, {primeiro_nome}! Aqui é o Antonio, da WAL Imóveis (CRECI 12261-J).',
    '[com_empreendimento]Você falou com a gente sobre o {empreendimento}. [/com_empreendimento][sem_empreendimento]Você falou com a gente sobre imóveis. [/sem_empreendimento]Desde então, a WAL mudou bastante: hoje são {opcoes}, com mapa da região e estimativas de financiamento em 4 instituições, na hora.',
    'Veja o que mudou e, se quiser, atualize sua busca:\n{link}',
    'Se não quiser mais mensagens, responda SAIR.'
  ].join('\n\n')
};
const TEXTOS_ROTULO = {
  EMAIL1_ASSUNTO: 'Assunto do 1º e-mail', EMAIL1_CORPO: 'Texto do 1º e-mail', EMAIL1_BOTAO: 'Botão do 1º e-mail',
  EMAIL2_ASSUNTO: 'Assunto do lembrete', EMAIL2_CORPO: 'Texto do lembrete', EMAIL2_BOTAO: 'Botão do lembrete',
  EMAIL_NOTA: 'Nota após o botão', EMAIL_ASSINATURA: 'Assinatura', WHATS_TEXTO: 'Mensagem de WhatsApp'
};
const VARIAVEIS = ['primeiro_nome', 'empreendimento', 'regiao', 'opcoes', 'link'];
const BLOCOS = ['antigo', 'recente', 'com_empreendimento', 'sem_empreendimento'];

function abaTextos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CFG.ABA_TEXTOS);
  if (!sh) sh = ss.insertSheet(CFG.ABA_TEXTOS);
  if (sh.getLastRow() === 0) {
    const agora = new Date();
    sh.getRange(1, 1, 1, 3).setValues([['CHAVE', 'VALOR', 'ATUALIZADO_EM']]).setFontWeight('bold');
    sh.getRange(2, 1, Object.keys(TEXTOS_PADRAO).length, 3).setValues(Object.keys(TEXTOS_PADRAO).map(function (k) {
      return [k, TEXTOS_PADRAO[k], agora];
    }));
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Textos em vigor: os da aba CAMPANHA_TEXTOS; o padrão cobre qualquer chave ausente ou vazia. */
function lerTextos_() {
  const t = Object.assign({}, TEXTOS_PADRAO);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.ABA_TEXTOS);
  if (!sh || sh.getLastRow() < 2) return t;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    const k = String(r[0]).trim(), v = String(r[1]).replace(/^'(?=[=+\-@])/, '');
    if (k in TEXTOS_PADRAO && v.trim()) t[k] = v;
  });
  return t;
}

function datasTextos_() {
  const d = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.ABA_TEXTOS);
  if (!sh || sh.getLastRow() < 2) return d;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[2] instanceof Date) d[String(r[0]).trim()] = Utilities.formatDate(r[2], CFG.FUSO, 'dd/MM/yyyy HH:mm');
  });
  return d;
}

function validarTextos_(t) {
  const erros = [];
  Object.keys(TEXTOS_PADRAO).forEach(function (k) {
    const v = String(t[k] == null ? '' : t[k]), nome = TEXTOS_ROTULO[k];
    if (!v.trim()) { erros.push(nome + ': não pode ficar vazio.'); return; }
    const max = /ASSUNTO$/.test(k) ? 150 : /BOTAO$/.test(k) ? 60 : 4000;
    if (v.length > max) erros.push(nome + ': passou de ' + max + ' caracteres.');
    (v.match(/\{[^{}]*\}/g) || []).forEach(function (x) {
      if (VARIAVEIS.indexOf(x.slice(1, -1)) < 0) erros.push(nome + ': a variável ' + x + ' não existe.');
    });
    (v.match(/\[\/?[^\[\]]*\]/g) || []).forEach(function (x) {
      if (BLOCOS.indexOf(x.replace(/[\[\]\/]/g, '')) < 0) erros.push(nome + ': o bloco ' + x + ' não existe.');
    });
    BLOCOS.forEach(function (b) {
      if (v.split('[' + b + ']').length !== v.split('[/' + b + ']').length) {
        erros.push(nome + ': o bloco [' + b + '] precisa abrir e fechar ([' + b + ']…[/' + b + ']).');
      }
    });
  });
  if (String(t.WHATS_TEXTO || '').indexOf('{link}') < 0) erros.push('Mensagem de WhatsApp: inclua {link}, senão o lead não recebe o endereço da página.');
  return erros.filter(function (e, i, a) { return a.indexOf(e) === i; });
}

function contexto_(lead, link) {
  const reg = CFG.REGIOES[lead.origem] || CFG.REGIOES.GERAL;
  const recente = tempo_(lead.dtCadastro) > Date.now() - CFG.MESES_LEAD_RECENTE * 30 * 864e5;
  const emp = String(lead.empreendimento || '').trim();
  return {
    vars: { primeiro_nome: primeiroNome_(lead.nome), empreendimento: emp, regiao: reg.nome, opcoes: reg.opcoes, link: link },
    flags: { antigo: !recente, recente: recente, com_empreendimento: !!emp, sem_empreendimento: !emp }
  };
}

/** Aplica blocos e variáveis. Em HTML, o texto do modelo e os dados do lead são escapados. */
function aplicarModelo_(tpl, ctx, html) {
  let s = String(tpl == null ? '' : tpl).replace(/\r/g, '');
  s = s.replace(/\[(antigo|recente|com_empreendimento|sem_empreendimento)\]([\s\S]*?)\[\/\1\]/g, function (m, b, conteudo) {
    return ctx.flags[b] ? conteudo : '';
  });
  if (html) s = esc_(s);
  return s.replace(/\{([a-z_]+)\}/g, function (m, v) {
    return v in ctx.vars ? (html ? esc_(ctx.vars[v]) : String(ctx.vars[v])) : m;
  });
}

function paragrafos_(s) {
  return String(s).split(/\n[ \t]*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
}
function negritoHtml_(s) { return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }
function semNegrito_(s) { return s.replace(/\*\*(.+?)\*\*/g, '$1'); }

function linkRecadastro_(lead, canal) {
  return CFG.URL_RECADASTRO + '?t=' + lead.token + '&regiao=' + (CFG.REGIOES[lead.origem] ? lead.origem : 'GERAL') +
    '&utm_source=' + canal + '&utm_medium=mala-direta&utm_campaign=' + CFG.TAG;
}

function montarEmail_(lead, etapa, urlApi, textos) {
  textos = textos || lerTextos_();
  const link = linkRecadastro_(lead, 'email');
  const sair = urlApi + '?a=sair&t=' + lead.token;
  const ctx = contexto_(lead, link), p = 'EMAIL' + etapa + '_';
  const assunto = aplicarModelo_(textos[p + 'ASSUNTO'], ctx, false).replace(/\s+/g, ' ').trim();
  const botao = aplicarModelo_(textos[p + 'BOTAO'], ctx, false).replace(/\s+/g, ' ').trim();
  const corpoH = paragrafos_(aplicarModelo_(textos[p + 'CORPO'], ctx, true)).map(negritoHtml_);
  const corpoT = paragrafos_(aplicarModelo_(textos[p + 'CORPO'], ctx, false)).map(semNegrito_);
  const notaH = paragrafos_(aplicarModelo_(textos.EMAIL_NOTA, ctx, true)).map(negritoHtml_);
  const notaT = paragrafos_(aplicarModelo_(textos.EMAIL_NOTA, ctx, false)).map(semNegrito_);
  const assH = negritoHtml_(aplicarModelo_(textos.EMAIL_ASSINATURA, ctx, true).trim());
  const assT = semNegrito_(aplicarModelo_(textos.EMAIL_ASSINATURA, ctx, false).trim());

  const html =
    '<div style="background:#f5f7fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">' +
    '<tr><td style="background:#0b1f3a;padding:18px 24px;color:#d9b76a;font-size:17px;font-weight:bold;letter-spacing:1px">WAL IMÓVEIS</td></tr>' +
    '<tr><td style="padding:26px 24px 8px;color:#1c2733;font-size:16px;line-height:1.6">' +
    corpoH.map(function (b) { return '<p style="margin:0 0 14px">' + b + '</p>'; }).join('') +
    '<p style="margin:24px 0;text-align:center"><a href="' + link + '" style="background:#d9b76a;color:#0b1f3a;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:8px;display:inline-block">' + esc_(botao) + '</a></p>' +
    notaH.map(function (b) { return '<p style="margin:0 0 18px;color:#5d6875;font-size:14px">' + b + '</p>'; }).join('') +
    '<p style="margin:0 0 20px">' + assH + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 24px;background:#eef3f8;color:#5d6875;font-size:12px;line-height:1.6">' +
    esc_(CFG.RODAPE) + '<br>Você recebe esta mensagem porque entrou em contato com a WAL sobre imóveis. ' +
    '<a href="' + sair + '" style="color:#5d6875">Não quero mais receber</a>.' +
    '</td></tr></table></div>';

  const texto = corpoT.join('\n\n') + '\n\n' + botao + ': ' + link + '\n\n' +
    (notaT.length ? notaT.join('\n\n') + '\n\n' : '') + assT + '\n\n' + CFG.RODAPE + '\nNão quer mais receber? ' + sair;

  return { assunto: assunto, html: html, texto: texto };
}

function montarWhats_(lead, textos) {
  textos = textos || lerTextos_();
  const ctx = contexto_(lead, linkRecadastro_(lead, 'whatsapp'));
  return aplicarModelo_(textos.WHATS_TEXTO, ctx, false)
    .replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ============================== WEB APP ============================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return jsonp_(p.callback, admin_(p.action, p));   // admin.html (JSONP)
  if (p.a === 'sair') return paginaSair_(p);
  if (p.a === 'catalogo') return catalogo_();
  if (p.a === 'visita') { registrarVisita_(p.t); return json_({ ok: true }); }
  return json_({ ok: false });
}

function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false }); }
  if (d.action) return json_(admin_(d.action, d));                  // admin.html (POST text/plain)
  if (d.event) {   // webhook da Brevo
    const k = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
    if (!k || (e.parameter || {}).k !== k) return json_({ ok: false });
    webhookBrevo_(d);
    return json_({ ok: true });
  }
  if (d.acao === 'recadastro') {
    try { return json_(recadastrar_(d)); }
    catch (err) {
      log_([[new Date(), '', 'SITE', 'ERRO_RECADASTRO', String(err.message).slice(0, 120)]]);
      return json_({ ok: false });
    }
  }
  return json_({ ok: false });
}

/** Catálogo público para a página. Colunas detectadas pelo cabeçalho; cache de 10 minutos. */
function catalogo_() {
  const cache = CacheService.getScriptCache();
  const salvo = cache.get('CATALOGO');
  if (salvo) return ContentService.createTextOutput(salvo).setMimeType(ContentService.MimeType.JSON);
  const v = SpreadsheetApp.openById(CFG.PLANILHA_SITE).getSheetByName(CFG.ABA_SITE).getDataRange().getDisplayValues();
  const rot = v[0].map(semAcento_);
  const PADROES = {   // ajuste aqui se algum campo não for encontrado
    id: [/^id$/, /^cod/], nome: [/empreend/, /^nome$/, /titulo/], cidade: [/cidade/, /municipio/],
    bairro: [/bairro/], estagio: [/estagio/, /fase/, /^tipo de imovel/, /^status$/, /situacao/], preco: [/preco/, /valor/],
    ativo: [/^ativo$/], vendido: [/^vendido$/]
  };
  const idx = {};
  Object.keys(PADROES).forEach(function (k) {
    idx[k] = -1;
    PADROES[k].some(function (re) {
      const i = rot.findIndex(function (h) { return re.test(h); });
      if (i >= 0) { idx[k] = i; return true; }
      return false;
    });
  });
  if (idx.nome < 0 || idx.cidade < 0) return json_({ ok: false });
  const vistos = {}, imoveis = [];
  v.slice(1).forEach(function (r) {
    const cel = function (k) { return idx[k] >= 0 ? String(r[idx[k]]).trim() : ''; };
    const nome = cel('nome'), cidade = cel('cidade'), chave = semAcento_(nome + '|' + cidade);
    if (!nome || vistos[chave]) return;              // uma linha por empreendimento
    if (/^(false|falso|nao|não|0)$/i.test(cel('ativo'))) return;           // inativo no admin.html
    if (/^(true|verdadeiro|sim|1)$/i.test(cel('vendido'))) return;         // 100% vendido (pedido 106)
    vistos[chave] = true;
    const id = cel('id');
    imoveis.push({ id: id, nome: nome, cidade: cidade, bairro: cel('bairro'), estagio: cel('estagio'),
      preco: /^[R$\s0.,]*$/.test(cel('preco')) ? '' : cel('preco'), url: id ? CFG.URL_IMOVEL + '?id=' + encodeURIComponent(id) : '' });
  });
  const saida = JSON.stringify({ ok: true, imoveis: imoveis });
  if (saida.length < 90000) cache.put('CATALOGO', saida, 600);
  return ContentService.createTextOutput(saida).setMimeType(ContentService.MimeType.JSON);
}

/** Visita pelo link: marca CLICOU. Não devolve nada sobre o lead. */
function registrarVisita_(token) {
  token = String(token || '');
  if (!RE_TOKEN.test(token)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const L = lerLeads_(), c = L.cab;
    const r = L.linhas.filter(function (x) { return x[c.TOKEN] === token; })[0];
    if (!r || r[c.DT_CLIQUE] || !tokenValido_(r, c)) return;
    r[c.DT_CLIQUE] = new Date();
    r[c.STATUS] = subir_(r[c.STATUS], 'CLICOU');
    gravar_(L, ['DT_CLIQUE', 'STATUS']);
    log_([[new Date(), r[c.ID], r[c.CANAL], 'VISITA', '']]);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Recadastro do formulário v5. Responde {ok:true} só depois de gravar.
 * Identidade: o token localiza o lead, mas só atualiza a linha se o telefone conferir.
 * Link encaminhado para outra pessoa vira um lead novo, sem tocar no original.
 */
function recadastrar_(d) {
  if (d.site) return { ok: false };                                    // honeypot
  const nome = limpar_(d.nome, 80);
  const fone = normalizarFone_(d.telefone);
  const email = String(d.email || '').trim().toLowerCase().slice(0, 120);
  const situacao = String(d.situacao || '');
  if (nome.length < 3 || !fone || !SITUACAO_STATUS[situacao]) return { ok: false };
  if (email && (!RE_EMAIL.test(email) || /^[=+\-@]/.test(email))) return { ok: false };
  if (d.consentimento_email === true && !email) return { ok: false };

  const cache = CacheService.getScriptCache(), chaveTent = 'RC_' + fone;   // 5 envios/hora por telefone
  const tent = Number(cache.get(chaveTent) || 0);
  if (tent >= 5) return { ok: false };
  cache.put(chaveTent, String(tent + 1), 3600);

  const ativa = situacao === 'buscando' || situacao === 'adiou';
  const consEmail = d.consentimento_email === true && !!email && situacao !== 'nao_contatar' && situacao !== 'sem_interesse';
  const consWhats = d.consentimento_whatsapp === true && situacao !== 'nao_contatar' && situacao !== 'sem_interesse';
  const atendimento = ativa && d.solicita_atendimento === true;
  const agora = new Date(), carimbo = Utilities.formatDate(agora, CFG.FUSO, 'dd/MM/yyyy HH:mm');
  let ref, emailsLead;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const L = lerLeads_(), c = L.cab;
    const token = String(d.t || '').toLowerCase();
    let r = RE_TOKEN.test(token) ? L.linhas.filter(function (x) { return x[c.TOKEN] === token; })[0] : null;
    let via = '';
    if (r && (!tokenValido_(r, c) || !mesmoFone_(r[c.TELEFONE], fone))) { via = r[c.ID]; r = null; }
    if (!r) r = L.linhas.filter(function (x) { return mesmoFone_(x[c.TELEFONE], fone); })[0] || null;   // sem link: procura pelo telefone
    const nova = !r;
    if (nova) {
      r = L.vazia.slice();
      r[c.ID] = 'S' + Utilities.formatDate(agora, CFG.FUSO, 'yyMMddHHmmss') + Math.floor(Math.random() * 10);
      r[c.NOME] = nome; r[c.EMAIL] = email;
      r[c.ORIGEM] = normalizarOrigem_(d.cidade || d.regiao_campanha); r[c.DT_CADASTRO] = agora;
      r[c.CANAL] = 'SITE'; r[c.TOKEN] = novoToken_(); r[c.ENVIOS] = 0;
      r[c.OBS] = via ? 'Chegou pelo link de ' + via + ' com outro telefone ou link vencido' : '';
    }
    r[c.TELEFONE] = "'" + fone;                        // telefone confirmado agora (corrige cadastros antigos sem o 9)
    r[c.SITUACAO] = situacao;
    if (email) r[c.EMAIL_ATUAL] = email;
    r[c.CIDADE_INTERESSE] = ativa ? limpar_(d.cidade, 60) : '';
    r[c.OBJETIVO] = ativa ? limpar_(d.objetivo, 60) : '';
    r[c.PRAZO] = ativa ? limpar_(d.prazo, 40) : '';
    r[c.VINCULO] = ativa ? limpar_(d.vinculo, 60) : '';
    r[c.OBSERVACOES] = ativa ? limpar_(d.observacoes, 600) : '';
    r[c.SOLICITA_ATENDIMENTO] = atendimento ? 'SIM' : '';
    if (atendimento) r[c.DT_ATENDIDO] = '';
    // Consentimento novo substitui o anterior, marcado ou desmarcado, com data e versão do texto.
    r[c.CONSENT_EMAIL] = (consEmail ? 'SIM ' : 'NAO ') + carimbo;
    r[c.CONSENT_WHATSAPP] = (consWhats ? 'SIM ' : 'NAO ') + carimbo;
    r[c.VERSAO_TEXTO] = limpar_(d.versao_texto, 60);
    r[c.CAMPANHA] = limpar_(d.campanha || d.regiao_campanha, 60);
    r[c.DT_RECADASTRO] = agora;
    r[c.STATUS] = SITUACAO_STATUS[situacao];
    if (nova) L.sh.appendRow(r);
    else gravar_(L, ['TELEFONE', 'SITUACAO', 'EMAIL_ATUAL', 'CIDADE_INTERESSE', 'OBJETIVO', 'PRAZO', 'VINCULO', 'OBSERVACOES',
      'SOLICITA_ATENDIMENTO', 'DT_ATENDIDO', 'CONSENT_EMAIL', 'CONSENT_WHATSAPP', 'VERSAO_TEXTO', 'CAMPANHA',
      'DT_RECADASTRO', 'STATUS']);
    log_([[agora, r[c.ID], r[c.CANAL], 'RECADASTRO', situacao + (atendimento ? ' · pediu consultor' : '')]]);
    ref = { id: r[c.ID], nome: String(r[c.NOME]), cidade: r[c.CIDADE_INTERESSE], prazo: r[c.PRAZO] };
    emailsLead = [String(r[c.EMAIL]).toLowerCase(), String(r[c.EMAIL_ATUAL]).toLowerCase()]
      .filter(function (x, i, a) { return RE_EMAIL.test(x) && a.indexOf(x) === i; });
  } finally {
    lock.releaseLock();
  }

  // Fora do lock: a gravação já está feita; integrações externas não travam a planilha.
  try {
    if (situacao === 'nao_contatar') emailsLead.forEach(function (x) { brevoBloquear_(x); });
    else if (consEmail) brevoLista_(email, true);
    else emailsLead.forEach(function (x) { brevoLista_(x, false); });
  } catch (err) { log_([[new Date(), ref.id, 'BREVO', 'ERRO_SINCRONIA', String(err.message).slice(0, 120)]]); }
  if (atendimento && CFG.EMAIL_AVISO) {
    try {
      MailApp.sendEmail(CFG.EMAIL_AVISO, 'Pedido de consultor: ' + ref.nome + ' (' + ref.id + ')',
        'Cidade: ' + ref.cidade + '\nPrazo: ' + ref.prazo + '\nVeja os dados no painel da campanha.');
    } catch (err) { /* aviso é acessório */ }
  }
  // PONTO DE INTEGRAÇÃO: gravação do lead na planilha/CRM principal do sistema.
  return { ok: true };
}

/* ---------- Brevo: contatos ---------- */

function brevo_(metodo, caminho, corpo) {
  const chave = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if (!chave) return null;
  return UrlFetchApp.fetch('https://api.brevo.com/v3' + caminho, {
    method: metodo, contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'api-key': chave, accept: 'application/json' }, payload: JSON.stringify(corpo)
  });
}

/** Entra ou sai da lista de quem autorizou e-mail. */
function brevoLista_(email, entrar) {
  const lista = Number(PropertiesService.getScriptProperties().getProperty('BREVO_LIST_ID'));
  if (!lista) return;
  if (entrar) brevo_('post', '/contacts', { email: email, listIds: [lista], updateEnabled: true });
  else brevo_('post', '/contacts/lists/' + lista + '/contacts/remove', { emails: [email] });
}

/** Pedido de não contato: bloqueia o e-mail na Brevo (cria o contato bloqueado se não existir). */
function brevoBloquear_(email) {
  brevo_('post', '/contacts', { email: email, emailBlacklisted: true, updateEnabled: true });
}

/* ---------- Webhook ---------- */

/** Eventos de e-mail transacional da Brevo. Idempotente: evento repetido não muda nada. */
function webhookBrevo_(ev) {
  if (JSON.stringify(ev).indexOf(CFG.TAG) < 0) return;    // só eventos desta campanha
  const email = String(ev.email || '').trim().toLowerCase();
  const tipo = tipoEvento_(ev.event);
  if (!email) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const L = lerLeads_(), c = L.cab;
    const r = L.linhas.filter(function (x) {
      return String(x[c.EMAIL]).toLowerCase() === email && x[c.STATUS] !== 'DUPLICADO';
    })[0];
    if (!r) return;
    const antes = r[c.STATUS];
    if (tipo === 'unique_opened' || tipo === 'opened') {
      if (!r[c.DT_ABERTURA]) r[c.DT_ABERTURA] = new Date();
      r[c.STATUS] = subir_(r[c.STATUS], 'ABRIU');
    } else if (tipo === 'hard_bounce' || tipo === 'invalid_email' || tipo === 'blocked') {
      r[c.STATUS] = subir_(r[c.STATUS], 'INVALIDO');
      r[c.OBS] = tipo + (ev.reason ? ': ' + String(ev.reason).slice(0, 100) : '');
    } else if (tipo === 'spam') {
      r[c.STATUS] = subir_(r[c.STATUS], 'SPAM');
    } else if (tipo === 'unsubscribed') {
      r[c.STATUS] = subir_(r[c.STATUS], 'SAIR');
    } else if (tipo === 'soft_bounce') {
      r[c.OBS] = 'soft_bounce' + (ev.reason ? ': ' + String(ev.reason).slice(0, 100) : '');
    } else {
      // request, delivered, click, deferred... ou um nome que a Brevo mudou: fica no log para conferir.
      log_([[new Date(), r[c.ID], 'EMAIL', 'EVENTO_IGNORADO', String(ev.event).slice(0, 60)]]);
      return;
    }
    gravar_(L, ['DT_ABERTURA', 'STATUS', 'OBS']);
    if (antes !== r[c.STATUS] || tipo === 'soft_bounce') log_([[new Date(), r[c.ID], 'EMAIL', tipo.toUpperCase(), '']]);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Nome do evento da Brevo no formato que o webhook trata. A Brevo já usou variações
 * (uniqueOpened, first_opening, invalid, complaint...) conforme a tela/versão do webhook.
 */
function tipoEvento_(nome) {
  const t = String(nome || '').replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
  const ALIAS = { first_opening: 'unique_opened', first_open: 'unique_opened', unique_open: 'unique_opened',
    open: 'opened', invalid: 'invalid_email', complaint: 'spam', hardbounce: 'hard_bounce', softbounce: 'soft_bounce',
    unsubscribe: 'unsubscribed' };
  return ALIAS[t] || t;
}

/** Descadastro em dois passos: leitores de e-mail abrem links sozinhos, então o GET só mostra o botão. */
function paginaSair_(p) {
  const token = String(p.t || '');
  const valido = RE_TOKEN.test(token);
  let corpo;
  if (valido && p.c === '1') {
    let emails = [];
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const L = lerLeads_(), c = L.cab;
      const r = L.linhas.filter(function (x) { return x[c.TOKEN] === token; })[0];
      if (r && r[c.STATUS] !== 'SAIR') {
        r[c.STATUS] = 'SAIR';
        gravar_(L, ['STATUS']);
        log_([[new Date(), r[c.ID], r[c.CANAL], 'SAIR', 'pelo link']]);
        emails = [r[c.EMAIL], r[c.EMAIL_ATUAL]].filter(function (x) { return RE_EMAIL.test(String(x)); });
      }
    } finally {
      lock.releaseLock();
    }
    emails.forEach(function (x) { try { brevoBloquear_(String(x).toLowerCase()); } catch (e) { /* segue */ } });
    corpo = '<h1>Pronto.</h1><p>Você não receberá mais mensagens da WAL Imóveis.</p>';
  } else if (valido) {
    const url = PropertiesService.getScriptProperties().getProperty('URL_API') + '?a=sair&c=1&t=' + token;
    corpo = '<h1>Deixar de receber?</h1><p>Confirme para não receber mais mensagens da WAL Imóveis.</p>' +
      '<p><a class="b" target="_top" href="' + url + '">Confirmar</a></p>';
  } else {
    corpo = '<h1>Link inválido.</h1>';
  }
  return HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial,sans-serif;background:#f5f7fa;color:#1c2733;text-align:center;padding:48px 16px}' +
    'h1{color:#0b1f3a;font-size:22px}.b{background:#0b1f3a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block}</style>' +
    corpo).setTitle('WAL Imóveis').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ============================== ADMIN.HTML (aba Mala Direta) ============================== */
/*
 * Todas as ações exigem authPin. Mesma lógica do antigo Painel.html (google.script.run),
 * agora chamada pelo admin.html via JSONP (GET) ou POST text/plain.
 */
const ACOES_ADMIN = {
  md_resumo:          function ()  { return resumo_(); },
  md_config:          function ()  { return configStatus_(); },
  md_enviar:          function (d) { return enviarLote(d.etapa, d.qtd); },
  md_teste_email:     function (d) { return testeEmail_(d.email, d.etapa); },
  md_whats:           function ()  { return { itens: filaWhats_() }; },
  md_marcar_whats:    function (d) { return { ok: marcarWhats_(String(d.id || '')) }; },
  md_consultor:       function ()  { return { itens: listaConsultor_() }; },
  md_marcar_atendido: function (d) { return { ok: marcarAtendido_(String(d.id || '')) }; },
  md_leads:           function ()  { return { itens: listaLeads_() }; },
  md_status_manual:   function (d) { return statusManual_(String(d.id || ''), String(d.novo || ''), d.motivo); },
  md_para_whats:      function (d) { return paraWhats_(String(d.id || '')); },
  md_preparar:        function ()  { return { preparados: prepararLeads() }; },
  md_importar:        function (d) { return importar_(objeto_(d.linhas)); },
  md_textos:          function ()  { return textosPainel_(); },
  md_previa:          function (d) { return previa_(objeto_(d.rascunho), objeto_(d.ex)); },
  md_salvar_textos:   function (d) { return salvarTextos_(objeto_(d.textos)); }
};

function admin_(action, d) {
  try {
    checarPin_(d.authPin);
    const fn = ACOES_ADMIN[action];
    if (!fn) return { status: 'error', message: 'Ação desconhecida: ' + action };
    const r = fn(d) || {};
    r.status = r.status || 'ok';
    return r;
  } catch (err) {
    return { status: 'error', message: String((err && err.message) || err) };
  }
}

/** Via GET os objetos chegam como texto JSON; via POST já chegam prontos. */
function objeto_(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function fmt_(d, padrao) {
  return d instanceof Date ? Utilities.formatDate(d, CFG.FUSO, padrao || 'dd/MM/yyyy HH:mm') : '';
}

function resumo_() {
  const L = lerLeads_(), c = L.cab;
  const status = {}, origem = {}, situacao = {};
  let whats = 0, consEmail = 0, consWhats = 0, consultor = 0;
  L.linhas.forEach(function (r) {
    if (!r[c.TOKEN]) return;
    const s = r[c.STATUS] || 'PENDENTE', o = r[c.ORIGEM] || 'GERAL';
    status[s] = (status[s] || 0) + 1;
    origem[o] = origem[o] || { total: 0, enviados: 0, visitou: 0, recadastrou: 0 };
    origem[o].total++;
    if (Number(r[c.ENVIOS]) > 0) origem[o].enviados++;
    if (r[c.DT_CLIQUE]) origem[o].visitou++;
    if (r[c.DT_RECADASTRO]) origem[o].recadastrou++;
    if (r[c.SITUACAO]) situacao[r[c.SITUACAO]] = (situacao[r[c.SITUACAO]] || 0) + 1;
    if (String(r[c.CONSENT_EMAIL]).indexOf('SIM') === 0) consEmail++;
    if (String(r[c.CONSENT_WHATSAPP]).indexOf('SIM') === 0) consWhats++;
    if (r[c.SOLICITA_ATENDIMENTO] === 'SIM' && !r[c.DT_ATENDIDO]) consultor++;
    if (r[c.CANAL] === 'WHATSAPP' && s === 'PENDENTE') whats++;
  });
  const semPreparar = L.linhas.filter(function (r) { return String(r[c.NOME]).trim() && !r[c.TOKEN]; }).length;
  const lg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.ABA_LOG);
  const ult = lg.getLastRow(), n = Math.min(30, ult - 1);
  const logs = n > 0 ? lg.getRange(ult - n + 1, 1, n, 5).getValues().reverse() : [];
  return {   // 'porStatus' e não 'status': 'status' é o campo ok/error da resposta da API
    porStatus: status, origem: origem, situacao: situacao, semPreparar: semPreparar,
    consEmail: consEmail, consWhats: consWhats, consultor: consultor,
    filaEtapa1: filaEmail_(L, 1).length, filaEtapa2: filaEmail_(L, 2).length, filaWhats: whats,
    enviadosHoje: enviadosHoje_(), limiteDia: CFG.LIMITE_DIA, loteMax: CFG.LOTE_MAX, diasLembrete: CFG.DIAS_LEMBRETE,
    logs: logs.map(function (l) {
      return [l[0] instanceof Date ? fmt_(l[0], 'dd/MM HH:mm') : String(l[0]), String(l[1]), String(l[2]), String(l[3]), String(l[4]).slice(0, 120)];
    })
  };
}

/** O que está ligado e o que falta, para a seção Configuração do admin.html. */
function configStatus_() {
  const pr = PropertiesService.getScriptProperties().getProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abas = {};
  [CFG.ABA_LEADS, CFG.ABA_LOG, CFG.ABA_TEXTOS].forEach(function (n) { abas[n] = !!ss.getSheetByName(n); });
  return {
    planilha: { nome: ss.getName(), url: ss.getUrl() }, abas: abas,
    brevo: !!pr.BREVO_API_KEY, urlApi: pr.URL_API || '', webhook: !!pr.WEBHOOK_KEY, listaId: pr.BREVO_LIST_ID || '',
    webhookUrl: pr.URL_API && pr.WEBHOOK_KEY ? pr.URL_API + '?k=' + pr.WEBHOOK_KEY : '',
    remetente: CFG.REMETENTE_NOME + ' <' + CFG.REMETENTE_EMAIL + '>', tag: CFG.TAG,
    urlRecadastro: CFG.URL_RECADASTRO, limiteDia: CFG.LIMITE_DIA, loteMax: CFG.LOTE_MAX,
    diasLembrete: CFG.DIAS_LEMBRETE, diasValidade: CFG.DIAS_VALIDADE_TOKEN
  };
}

/** E-mail de teste para um endereço seu, com lead fictício. Não entra na planilha nem no webhook. */
function testeEmail_(email, etapa) {
  email = String(email || '').trim().toLowerCase();
  if (!RE_EMAIL.test(email)) throw new Error('Informe um e-mail válido para o teste.');
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty('BREVO_API_KEY');
  const urlApi = props.getProperty('URL_API');
  if (!chave || !urlApi) throw new Error('Defina BREVO_API_KEY e URL_API nas propriedades do script.');
  etapa = Number(etapa) === 2 ? 2 : 1;
  const lead = { nome: 'Antonio Teste', origem: 'RJ', empreendimento: 'Residencial Porto Novo',
    dtCadastro: new Date(2023, 2, 10), token: '0123456789abcdef0123456789abcdef' };
  const m = montarEmail_(lead, etapa, urlApi, lerTextos_());
  const resp = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'api-key': chave, accept: 'application/json' },
    payload: JSON.stringify({
      sender: { name: CFG.REMETENTE_NOME, email: CFG.REMETENTE_EMAIL },
      to: [{ email: email }], subject: '[TESTE] ' + m.assunto, htmlContent: m.html, textContent: m.texto,
      tags: ['mala-direta-teste']
    })
  });
  const cod = resp.getResponseCode();
  if (cod !== 201 && cod !== 202) throw new Error('Brevo ' + cod + ': ' + resp.getContentText().slice(0, 150));
  log_([[new Date(), '', 'EMAIL', 'TESTE_' + etapa, email]]);
  return { msg: 'E-mail de teste enviado para ' + email + '.' };
}

/** Fila do WhatsApp: devolve nome, link wa.me e o texto pronto. */
function filaWhats_() {
  const L = lerLeads_(), c = L.cab, textos = lerTextos_();
  return L.linhas.filter(function (r) {
    return r[c.CANAL] === 'WHATSAPP' && r[c.STATUS] === 'PENDENTE' && r[c.TOKEN];
  }).slice(0, 50).map(function (r) {
    const texto = montarWhats_({ nome: r[c.NOME], origem: r[c.ORIGEM], empreendimento: String(r[c.EMPREENDIMENTO]).trim(),
      token: r[c.TOKEN], dtCadastro: r[c.DT_CADASTRO] }, textos);
    const fone = normalizarFone_(r[c.TELEFONE]);
    return { id: r[c.ID], nome: String(r[c.NOME]), telefone: fone, origem: String(r[c.ORIGEM]),
      link: fone ? 'https://wa.me/' + fone + '?text=' + encodeURIComponent(texto) : '', texto: texto };
  });
}

function marcarWhats_(id) {
  return mudarLinha_(id, function (r, c) {
    if (r[c.CANAL] !== 'WHATSAPP' || r[c.STATUS] !== 'PENDENTE') return false;
    r[c.STATUS] = 'ENVIADO'; r[c.ENVIOS] = 1; r[c.DT_ENVIO_1] = new Date();
    return ['STATUS', 'ENVIOS', 'DT_ENVIO_1'];
  }, 'WHATSAPP', 'ENVIO_1');
}

/** Quem pediu para conversar com um consultor e ainda não foi atendido. */
function listaConsultor_() {
  const L = lerLeads_(), c = L.cab;
  return L.linhas.filter(function (r) { return r[c.SOLICITA_ATENDIMENTO] === 'SIM' && !r[c.DT_ATENDIDO]; })
    .sort(function (a, b) { return tempo_(a[c.DT_RECADASTRO]) - tempo_(b[c.DT_RECADASTRO]); })
    .map(function (r) {
      const fone = normalizarFone_(r[c.TELEFONE]);
      return { id: r[c.ID], nome: String(r[c.NOME]), telefone: fone, email: String(r[c.EMAIL_ATUAL] || r[c.EMAIL]),
        cidade: String(r[c.CIDADE_INTERESSE]), prazo: String(r[c.PRAZO]),
        objetivo: String(r[c.OBJETIVO]), vinculo: String(r[c.VINCULO]), obs: String(r[c.OBSERVACOES]).slice(0, 300),
        quando: fmt_(r[c.DT_RECADASTRO], 'dd/MM HH:mm'), link: fone ? 'https://wa.me/' + fone : '' };
    });
}

function marcarAtendido_(id) {
  return mudarLinha_(id, function (r, c) {
    if (r[c.SOLICITA_ATENDIMENTO] !== 'SIM' || r[c.DT_ATENDIDO]) return false;
    r[c.DT_ATENDIDO] = new Date();
    return ['DT_ATENDIDO'];
  }, 'PAINEL', 'ATENDIDO');
}

/** Todos os leads, para a lista do admin.html (filtros e busca são feitos no navegador). */
function listaLeads_() {
  const L = lerLeads_(), c = L.cab;
  return L.linhas.filter(function (r) { return String(r[c.NOME]).trim() || r[c.TOKEN]; }).map(function (r) {
    return {
      id: String(r[c.ID]), nome: String(r[c.NOME]), telefone: String(r[c.TELEFONE]).replace(/^'/, ''),
      email: String(r[c.EMAIL]), emailAtual: String(r[c.EMAIL_ATUAL]), origem: String(r[c.ORIGEM]),
      empreendimento: String(r[c.EMPREENDIMENTO]), canal: String(r[c.CANAL]),
      status: String(r[c.STATUS] || (r[c.TOKEN] ? 'PENDENTE' : 'NAO_PREPARADO')), envios: Number(r[c.ENVIOS]) || 0,
      dtCadastro: fmt_(r[c.DT_CADASTRO], 'dd/MM/yyyy'), dtEnvio1: fmt_(r[c.DT_ENVIO_1]), dtEnvio2: fmt_(r[c.DT_ENVIO_2]),
      dtAbertura: fmt_(r[c.DT_ABERTURA]), dtClique: fmt_(r[c.DT_CLIQUE]), dtRecadastro: fmt_(r[c.DT_RECADASTRO]),
      situacao: String(r[c.SITUACAO]), cidade: String(r[c.CIDADE_INTERESSE]), objetivo: String(r[c.OBJETIVO]),
      prazo: String(r[c.PRAZO]), vinculo: String(r[c.VINCULO]), observacoes: String(r[c.OBSERVACOES]),
      consultor: String(r[c.SOLICITA_ATENDIMENTO]), dtAtendido: fmt_(r[c.DT_ATENDIDO]),
      consEmail: String(r[c.CONSENT_EMAIL]), consWhats: String(r[c.CONSENT_WHATSAPP]),
      campanha: String(r[c.CAMPANHA]), obs: String(r[c.OBS])
    };
  });
}

/*
 * Status marcado à mão pelo operador. Caso típico: o lead respondeu SAIR no WhatsApp,
 * disse por telefone que já comprou, ou o número não existe. PENDENTE só desfaz
 * ERRO_ENVIO ou DUPLICADO (ex.: e-mail corrigido na planilha) — nunca reativa quem saiu.
 */
const STATUS_MANUAIS = ['SAIR', 'COMPROU', 'SEM_INTERESSE', 'INVALIDO', 'PENDENTE'];
function statusManual_(id, novo, motivo) {
  if (STATUS_MANUAIS.indexOf(novo) < 0) throw new Error('Status não permitido: ' + novo);
  let emails = [], erro = '';
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const L = lerLeads_(), c = L.cab;
    const r = L.linhas.filter(function (x) { return String(x[c.ID]) === id; })[0];
    if (!r) throw new Error('Lead ' + id + ' não encontrado.');
    const antes = String(r[c.STATUS] || 'PENDENTE');
    if (novo === 'PENDENTE' && ['ERRO_ENVIO', 'DUPLICADO'].indexOf(antes) < 0) {
      erro = 'Só é possível voltar para PENDENTE um lead com ERRO_ENVIO ou DUPLICADO.';
    } else if (antes !== novo) {
      r[c.STATUS] = novo;
      r[c.OBS] = limpar_('Manual (' + antes + ' → ' + novo + ')' + (motivo ? ': ' + motivo : ''), 200);
      gravar_(L, ['STATUS', 'OBS']);
      log_([[new Date(), id, 'PAINEL', 'STATUS_' + novo, limpar_(antes + (motivo ? ' · ' + motivo : ''), 120)]]);
      if (novo === 'SAIR') emails = [r[c.EMAIL], r[c.EMAIL_ATUAL]].filter(function (x) { return RE_EMAIL.test(String(x)); });
    }
  } finally {
    lock.releaseLock();
  }
  if (erro) throw new Error(erro);
  emails.forEach(function (x) { try { brevoBloquear_(String(x).toLowerCase()); } catch (e) { /* segue */ } });
  return { ok: true };
}

/** E-mail inválido ou recusado: passa o lead para a fila do WhatsApp, se tiver telefone. */
function paraWhats_(id) {
  let erro = '';
  const ok = mudarLinha_(id, function (r, c) {
    const antes = String(r[c.STATUS] || 'PENDENTE');
    if (r[c.CANAL] === 'WHATSAPP') { erro = 'Este lead já está no WhatsApp.'; return false; }
    if (['INVALIDO', 'ERRO_ENVIO', 'PENDENTE'].indexOf(antes) < 0) { erro = 'Só vai para o WhatsApp quem está PENDENTE, INVALIDO ou ERRO_ENVIO.'; return false; }
    if (!normalizarFone_(r[c.TELEFONE])) { erro = 'Lead sem telefone válido.'; return false; }
    r[c.CANAL] = 'WHATSAPP'; r[c.STATUS] = 'PENDENTE'; r[c.ENVIOS] = 0;
    r[c.OBS] = 'E-mail ' + antes + '; passou para WhatsApp em ' + fmt_(new Date(), 'dd/MM/yyyy');
    return ['CANAL', 'STATUS', 'ENVIOS', 'OBS'];
  }, 'PAINEL', 'PARA_WHATSAPP');
  if (!ok) throw new Error(erro || 'Lead ' + id + ' não encontrado.');
  return { ok: true };
}

/*
 * Importação colada no admin.html: [{nome, telefone, email, origem, empreendimento, dt_cadastro}].
 * Pula quem já está na planilha (mesmo e-mail ou mesmo telefone) e depois roda prepararLeads(),
 * que gera ID/TOKEN/CANAL e marca duplicados entre os novos.
 */
function importar_(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) throw new Error('Nenhuma linha recebida.');
  if (linhas.length > 2000) throw new Error('Máximo de 2000 leads por importação.');
  const chaveFone = function (v) { const f = normalizarFone_(v); return f ? 't:' + f.slice(2, 4) + f.slice(-8) : ''; };
  let pulados = 0, invalidos = 0, novas = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const L = lerLeads_(), c = L.cab, existe = {};
    L.linhas.forEach(function (r) {
      [r[c.EMAIL], r[c.EMAIL_ATUAL]].forEach(function (e) { e = String(e).trim().toLowerCase(); if (e) existe['e:' + e] = true; });
      const t = chaveFone(r[c.TELEFONE]); if (t) existe[t] = true;
    });
    const agora = fmt_(new Date(), 'dd/MM/yyyy');
    linhas.forEach(function (x) {
      x = x || {};
      const nome = limpar_(x.nome, 80);
      const email = String(x.email || '').trim().toLowerCase().slice(0, 120);
      const fone = normalizarFone_(x.telefone), t = chaveFone(x.telefone);
      const emailOk = RE_EMAIL.test(email) && !/^[=+\-@]/.test(email);
      if (nome.length < 2 || (!emailOk && !fone)) { invalidos++; return; }
      if ((emailOk && existe['e:' + email]) || (t && existe[t])) { pulados++; return; }
      if (emailOk) existe['e:' + email] = true;
      if (t) existe[t] = true;
      const r = L.vazia.slice();
      r[c.NOME] = nome;
      r[c.TELEFONE] = fone ? "'" + fone : limpar_(x.telefone, 20);
      r[c.EMAIL] = emailOk ? email : '';
      r[c.ORIGEM] = limpar_(x.origem, 40);
      r[c.EMPREENDIMENTO] = limpar_(x.empreendimento, 80);
      r[c.DT_CADASTRO] = lerData_(x.dt_cadastro);
      r[c.OBS] = 'Importado pelo admin em ' + agora;
      novas.push(r);
    });
    if (novas.length) L.sh.getRange(L.sh.getLastRow() + 1, 1, novas.length, novas[0].length).setValues(novas);
  } finally {
    lock.releaseLock();
  }
  if (novas.length) log_([[new Date(), '', 'PAINEL', 'IMPORTAR', novas.length + ' novos · ' + pulados + ' já existiam · ' + invalidos + ' sem contato']]);
  const preparados = novas.length ? prepararLeads() : 0;
  return { importados: novas.length, pulados: pulados, invalidos: invalidos, preparados: preparados };
}

/** dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd (com ou sem hora). '' se não reconhecer. */
function lerData_(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(ano, Number(m[2]) - 1, Number(m[1]));
    return isNaN(d) ? '' : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return '';
}

function mudarLinha_(id, fn, canal, evento) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const L = lerLeads_(), c = L.cab;
    const r = L.linhas.filter(function (x) { return String(x[c.ID]) === id; })[0];
    const cols = r ? fn(r, c) : false;
    if (!cols) return false;
    gravar_(L, cols);
    log_([[new Date(), id, canal, evento, 'admin']]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Textos das mensagens ---------- */

function textosPainel_() {
  return { textos: lerTextos_(), padrao: TEXTOS_PADRAO, rotulos: TEXTOS_ROTULO, datas: datasTextos_(),
    variaveis: VARIAVEIS, blocos: BLOCOS,
    regioes: Object.keys(CFG.REGIOES).map(function (k) { return { k: k, nome: CFG.REGIOES[k].nome }; }) };
}

/** Prévia com um lead fictício, usando exatamente a mesma montagem do envio. */
function previa_(rascunho, ex) {
  ex = ex || {};
  const t = Object.assign({}, TEXTOS_PADRAO);
  Object.keys(TEXTOS_PADRAO).forEach(function (k) { if (rascunho && rascunho[k] != null) t[k] = String(rascunho[k]); });
  const lead = { nome: 'Ana Paula Ribeiro', origem: CFG.REGIOES[ex.origem] ? ex.origem : 'RJ',
    empreendimento: ex.comEmpreendimento === false ? '' : 'Residencial Porto Novo',
    dtCadastro: ex.antigo === false ? new Date(Date.now() - 30 * 864e5) : new Date(2023, 2, 10),
    token: '0123456789abcdef0123456789abcdef' };
  const urlApi = PropertiesService.getScriptProperties().getProperty('URL_API') || 'https://script.google.com/macros/s/…/exec';
  const e1 = montarEmail_(lead, 1, urlApi, t), e2 = montarEmail_(lead, 2, urlApi, t);
  return { erros: validarTextos_(t), email1: { assunto: e1.assunto, html: e1.html }, email2: { assunto: e2.assunto, html: e2.html },
    whats: montarWhats_(lead, t) };
}

/** Salva os textos. Só grava se todos passarem na validação; registra no log o que mudou. */
function salvarTextos_(novos) {
  const t = {};
  Object.keys(TEXTOS_PADRAO).forEach(function (k) { t[k] = String(novos && novos[k] != null ? novos[k] : '').replace(/\r/g, ''); });
  const erros = validarTextos_(t);
  if (erros.length) return { ok: false, erros: erros };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = abaTextos_(), atual = lerTextos_(), datas = {}, agora = new Date(), mudou = [];
    sh.getDataRange().getValues().slice(1).forEach(function (r) { datas[String(r[0]).trim()] = r[2]; });
    const linhas = Object.keys(TEXTOS_PADRAO).map(function (k) {
      const alterou = t[k] !== atual[k];
      if (alterou) mudou.push(TEXTOS_ROTULO[k]);
      return [k, /^[=+\-@]/.test(t[k]) ? "'" + t[k] : t[k], alterou || !(datas[k] instanceof Date) ? agora : datas[k]];
    });
    const ult = sh.getLastRow();
    if (ult > linhas.length + 1) sh.getRange(linhas.length + 2, 1, ult - linhas.length - 1, 3).clearContent();
    sh.getRange(2, 1, linhas.length, 3).setValues(linhas);
    if (mudou.length) log_([[agora, '', 'PAINEL', 'TEXTOS', ('Alterado: ' + mudou.join(', ')).slice(0, 300)]]);
    return { ok: true, alterados: mudou.length, datas: datasTextos_() };
  } finally {
    lock.releaseLock();
  }
}

/** PIN com bloqueio: 5 erros seguidos travam o acesso por 15 minutos. */
function checarPin_(pin) {
  const cache = CacheService.getScriptCache();
  const erros = Number(cache.get('PIN_ERROS') || 0);
  if (erros >= 5) throw new Error('Painel bloqueado por 15 minutos após tentativas inválidas.');
  const extra = PropertiesService.getScriptProperties().getProperty('PIN_CAMPANHA');
  const p = String(pin == null ? '' : pin).trim();
  if (!p || (p !== ADMIN_PIN && p !== extra)) {
    cache.put('PIN_ERROS', String(erros + 1), 900);
    throw new Error('PIN inválido.');
  }
  cache.remove('PIN_ERROS');
}

/* ============================== UTILITÁRIOS ============================== */

function lerLeads_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.ABA_LEADS);
  if (!sh) throw new Error('Rode configurarCampanha() primeiro.');
  const v = sh.getDataRange().getValues();
  const cab = {};
  v[0].forEach(function (h, i) { cab[String(h).trim().toUpperCase()] = i; });
  COLUNAS.forEach(function (n) { if (!(n in cab)) throw new Error('Coluna ausente em ' + CFG.ABA_LEADS + ': ' + n); });
  return { sh: sh, cab: cab, linhas: v.slice(1), vazia: v[0].map(function () { return ''; }) };
}

/** Regrava somente as colunas indicadas (nunca a linha inteira). */
function gravar_(L, colunas) {
  if (!L.linhas.length) return;
  colunas.forEach(function (n) {
    const i = L.cab[n];
    L.sh.getRange(2, i + 1, L.linhas.length, 1).setValues(L.linhas.map(function (r) { return [r[i]]; }));
  });
}

function log_(linhas) {
  if (!linhas || !linhas.length) return;
  const lg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.ABA_LOG);
  lg.getRange(lg.getLastRow() + 1, 1, linhas.length, 5).setValues(linhas);
}

function subir_(atual, novo) {
  atual = atual || 'PENDENTE';
  if (atual === 'RECADASTROU' || FINAIS.indexOf(atual) >= 0) return atual;
  if (FINAIS.indexOf(novo) >= 0) return novo;
  return (NIVEL[novo] || 0) > (NIVEL[atual] || 0) ? novo : atual;
}

function tokenValido_(r, c) {
  const envio = r[c.DT_ENVIO_1];
  return !(envio instanceof Date) || Date.now() - envio.getTime() <= CFG.DIAS_VALIDADE_TOKEN * 864e5;
}

function novoToken_() { return Utilities.getUuid().replace(/-/g, ''); }

/** Telefone brasileiro no formato 55 + DDD + número; '' se inválido. */
function normalizarFone_(v) {
  let f = String(v || '').replace(/\D/g, '');
  if (f.length === 10 || f.length === 11) f = '55' + f;
  return /^55[1-9]{2}[2-9]\d{7,8}$/.test(f) ? f : '';
}

/** Mesma pessoa: compara DDD + 8 últimos dígitos (tolera o 9 extra de cadastros antigos). */
function mesmoFone_(a, b) {
  const x = normalizarFone_(a), y = normalizarFone_(b);
  return !!x && !!y && x.slice(2, 4) === y.slice(2, 4) && x.slice(-8) === y.slice(-8);
}

function normalizarOrigem_(v) {
  const s = semAcento_(v);
  if (/caragua|litoral/.test(s)) return 'LITORAL';
  if (/sjc|jose dos campos|jacarei|cacapava|taubate|vale/.test(s)) return 'SJC';
  if (/sao paulo|\bsp\b/.test(s)) return 'SP';
  if (/\bspa\b|pedro|aldeia|lagos/.test(s)) return 'SPA';
  if (/rio|\brj\b|niteroi/.test(s)) return 'RJ';
  return 'GERAL';
}

function semAcento_(v) {
  return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Texto vindo de formulário público: corta tamanho e neutraliza fórmula de planilha. */
function limpar_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function primeiroNome_(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : 'tudo bem';
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tempo_(d) { return d instanceof Date ? d.getTime() : 0; }

function chaveDia_() { return 'ENV_' + Utilities.formatDate(new Date(), CFG.FUSO, 'yyyyMMdd'); }

function enviadosHoje_() {
  return Number(PropertiesService.getScriptProperties().getProperty(chaveDia_()) || 0);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Resposta JSONP para o admin.html; sem callback válido, devolve JSON puro. */
function jsonp_(callback, obj) {
  const cb = String(callback || '');
  if (!/^[A-Za-z_$][\w$]{0,80}$/.test(cb)) return json_(obj);
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(obj) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
