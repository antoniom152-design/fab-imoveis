/* ══════════════════════════════════════════════════════════════════
   COMPARTILHAMENTO SEGURO — componente compartilhado
   Usado por: painel/agente/dashboard-agente.html, imovel.html e
   mapa-empreendimentos.html (carregado via <script src>). Não depende
   de nenhuma variável dessas páginas — a única coisa que espera achar
   no escopo global é CADASTRO_API_URL (já declarado em todas as três,
   mesmo backend), usado só pra registrar o evento de compartilhamento
   (se não existir, o registro é pulado silenciosamente).

   Fluxo de 2 etapas (pedido do Antonio, 04/09/2026):
   1) Cartão institucional da WAL Imóveis — apresenta a empresa antes
      de qualquer link, pra reduzir o receio de quem recebe.
   2) Mensagem da oportunidade (empreendimento ou mapa) — já com o
      link oficial e a assinatura do Agente.

   Segurança: o domínio nunca vem do chamador. Cada página passa só
   `caminho` (path+query, sem domínio) e este arquivo monta o link
   final sempre como WAL_DOMINIO_OFICIAL + caminho — não existe campo
   nem parâmetro que deixe outro domínio entrar aqui.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WAL_DOMINIO_OFICIAL = 'https://walservidor.com.br';

  // Caminho do próprio arquivo (painel/shared/) — a imagem do cartão
  // fica em assets/images/compartilhamento/, duas pastas acima, então
  // essa conta funciona igual não importa qual página carregou o
  // script (dashboard-agente.html está em painel/agente/, imovel.html
  // e mapa-empreendimentos.html estão na raiz).
  var _scriptEl = document.currentScript;
  var _scriptDir = _scriptEl ? _scriptEl.src.replace(/[^/]*$/, '') : '';
  var CARTAO_IMG_URL = _scriptDir + '../../assets/images/compartilhamento/cartao-wal-imoveis.png';

  var TEXTO_INSTITUCIONAL =
    'Antes de compartilhar a oportunidade, apresento a *WAL Imóveis*, responsável pela plataforma *WAL Servidor*.\n' +
    'Trabalhamos com atendimento imobiliário digital, curadoria de imóveis e acompanhamento durante toda a jornada de aquisição.\n' +
    'Os links enviados por mim utilizarão sempre o domínio oficial:\n' +
    '🔒 walservidor.com.br';

  /* ── util ── */
  function montarLinkOficial_(caminho) {
    var limpo = String(caminho || '').replace(/^\/+/, '');
    return WAL_DOMINIO_OFICIAL + '/' + limpo;
  }
  function esc_(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function sanitizarTextoLivre_(txt, max) {
    var t = String(txt || '');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/https?:\/\/\S+/gi, '');
    t = t.replace(/[\r\n]{3,}/g, '\n\n').trim();
    if (max && t.length > max) t = t.slice(0, max).trim() + '…';
    return t;
  }
  function normalizarWhatsapp_(v) {
    var digitos = String(v || '').replace(/\D/g, '');
    if (!digitos) return '';
    if (digitos.length <= 11) digitos = '55' + digitos;
    return digitos;
  }
  function truncar_(txt, max) {
    var t = String(txt || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).trim() + '…' : t;
  }
  function precoTexto_(min, max) {
    function fmt(v) { return v >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : 'R$ ' + v.toLocaleString('pt-BR') + ' mil'; }
    if (min > 0 && max > 0 && max !== min) return 'De ' + fmt(min) + ' a ' + fmt(max);
    if (min > 0) return 'A partir de ' + fmt(min);
    if (max > 0) return 'Até ' + fmt(max);
    return '';
  }

  /* ── monta [LOCALIZACAO] (seção 6 do pedido) ── */
  function montarLocalizacao_(emp) {
    var cidadeUf = [emp.cidade, emp.uf].filter(Boolean).join('/');
    return [emp.bairro, cidadeUf].filter(Boolean).join(' — ') || cidadeUf || '';
  }

  /* ── monta [CARACTERISTICAS_FORMATADAS] só com o que existe de
     verdade — nunca inventa suíte/varanda/vaga/proximidade que não
     estão cadastrados (ver limitação explicada ao Antonio antes de
     implementar: a planilha hoje só tem quartos, preço e descrição
     como campos estruturados). ── */
  function montarCaracteristicas_(emp) {
    var linhas = [];
    if (emp.quartos) {
      var n = String(emp.quartos).trim();
      linhas.push(/^\d+$/.test(n) ? ('Apartamentos de ' + n + (n === '1' ? ' quarto' : ' quartos')) : n);
    }
    var preco = precoTexto_(Number(emp.precoMin) || 0, Number(emp.precoMax) || 0);
    if (!preco && emp.faixa) preco = emp.faixa;
    if (!preco && emp.valor > 0) preco = 'A partir de R$ ' + Number(emp.valor).toLocaleString('pt-BR') + ' mil';
    if (preco) linhas.push(preco);
    if (emp.tipo) linhas.push('Situação: ' + emp.tipo);
    var desc = truncar_(emp.descricao, 160);
    if (desc) linhas.push(desc);
    return linhas.filter(Boolean).map(function (l) { return '• ' + l; }).join('\n');
  }

  /* ── mensagens (seção 3/8 do pedido) ── */
  function montarMensagemEmpreendimento_(opts, apresentacao) {
    var ag = opts.agente, emp = opts.empreendimento;
    var localizacao = montarLocalizacao_(emp);
    var caracteristicas = montarCaracteristicas_(emp);
    var link = montarLinkOficial_(opts.caminho);
    var linhas = [];
    if (apresentacao) linhas.push(apresentacao, '');
    linhas.push('Olá! Sou *' + ag.nome + '*, agente parceiro da *WAL Servidor*.');
    linhas.push(localizacao ? ('Quero apresentar uma oportunidade em *' + localizacao + '*:') : 'Quero apresentar uma oportunidade:');
    linhas.push('🏢 *' + emp.nome + (emp.construtora ? ' — ' + emp.construtora : '') + '*');
    if (caracteristicas) linhas.push(caracteristicas);
    linhas.push('🔒 *Acesse com segurança pelo site oficial da WAL Servidor:*');
    linhas.push(link);
    linhas.push('Se preferir, fale comigo antes de acessar:');
    linhas.push('*' + ag.nome + '*');
    linhas.push('Agente parceiro WAL Servidor');
    linhas.push('📱 ' + ag.whatsapp);
    linhas.push('_Valores, unidades e condições comerciais estão sujeitos à disponibilidade e a alterações pela incorporadora._');
    return { texto: linhas.filter(function (l) { return l !== null && l !== undefined; }).join('\n'), link: link };
  }
  function montarMensagemMapa_(opts, apresentacao) {
    var ag = opts.agente;
    var link = montarLinkOficial_(opts.caminho);
    var linhas = [];
    if (apresentacao) linhas.push(apresentacao, '');
    linhas.push('Olá! Sou *' + ag.nome + '*, agente parceiro da *WAL Servidor*.');
    linhas.push('Preparei uma seleção de empreendimentos para você consultar pelo mapa da WAL Servidor' + (opts.contadorTexto ? ' (' + opts.contadorTexto + ')' : '') + '.');
    linhas.push('No mapa, você poderá visualizar localização, faixa de preço, características, entorno e outras informações importantes para sua decisão.');
    linhas.push('🔒 *Acesse com segurança pelo site oficial da WAL Servidor:*');
    linhas.push(link);
    linhas.push('Se preferir, fale comigo antes de acessar:');
    linhas.push('*' + ag.nome + '*');
    linhas.push('Agente parceiro WAL Servidor');
    linhas.push('📱 ' + ag.whatsapp);
    return { texto: linhas.join('\n'), link: link };
  }

  /* ── registro de eventos (seção 14) — melhor esforço, nunca trava o
     fluxo se falhar ou se a página não tiver CADASTRO_API_URL. ── */
  function logEvento_(evento, opts, canal) {
    try {
      if (typeof CADASTRO_API_URL === 'undefined' || !CADASTRO_API_URL) return;
      var body = JSON.stringify({
        action: 'crm_share_evento_registrar',
        evento: evento,
        agenteId: (opts.agente && opts.agente.id) || '',
        tipo: opts.tipo || '',
        referencia: opts.tipo === 'empreendimento' ? ((opts.empreendimento && opts.empreendimento.nome) || '') : 'mapa',
        canal: canal || ''
      });
      fetch(CADASTRO_API_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: body }).catch(function () {});
    } catch (e) {}
  }

  /* ── CSS (injetado uma única vez) ── */
  function injetarEstilo_() {
    if (document.getElementById('wal-comp-seguro-style')) return;
    var css = '' +
      '.wcs-overlay{position:fixed;inset:0;background:rgba(10,22,40,.82);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Arial,Helvetica,sans-serif}' +
      '.wcs-box{background:#fff;border-radius:12px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 12px 40px rgba(0,0,0,.4)}' +
      '.wcs-head{background:#0A1628;padding:18px 22px;border-radius:12px 12px 0 0;position:sticky;top:0;z-index:1}' +
      '.wcs-title{color:#C9A84C;font-size:17px;font-weight:800;margin:0 0 3px}' +
      '.wcs-subtitle{color:#b9c2d0;font-size:12.5px;line-height:1.4;margin:0}' +
      '.wcs-close{position:absolute;top:14px;right:16px;background:none;border:none;color:#8A96A8;font-size:20px;cursor:pointer;line-height:1}' +
      '.wcs-steps{display:flex;gap:6px;padding:12px 22px 0}' +
      '.wcs-steps span{flex:1;height:4px;border-radius:2px;background:#e2e6ec}' +
      '.wcs-steps span.on{background:#C9A84C}' +
      '.wcs-body{padding:18px 22px 22px}' +
      '.wcs-pane{display:none}' +
      '.wcs-pane.on{display:block}' +
      '.wcs-img{width:100%;border-radius:8px;margin-bottom:14px;background:#f0f2f5;display:block}' +
      '.wcs-txt{white-space:pre-wrap;font-size:13px;line-height:1.55;color:#33404f;background:#f7f8fa;border:1px solid #e2e6ec;border-radius:8px;padding:12px 14px;margin-bottom:14px}' +
      '.wcs-link{font-size:12.5px;font-weight:700;color:#0A1628;background:#fff8e1;border:1px solid #C9A84C;border-radius:6px;padding:9px 12px;margin-bottom:14px;word-break:break-all}' +
      '.wcs-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px 14px;border-radius:7px;font-size:13.5px;font-weight:700;border:none;cursor:pointer;text-decoration:none;margin-bottom:9px;font-family:inherit}' +
      '.wcs-btn-wpp{background:#25D366;color:#fff}' +
      '.wcs-btn-gold{background:#C9A84C;color:#0A1628}' +
      '.wcs-btn-navy{background:#0A1628;color:#C9A84C}' +
      '.wcs-btn-outline{background:#fff;color:#0A1628;border:1px solid #d5dae2}' +
      '.wcs-btn-ghost{background:none;color:#7f8c9a;font-weight:600;padding:8px}' +
      '.wcs-hint{font-size:11.5px;color:#99a3ad;text-align:center;margin:2px 0 14px;line-height:1.4}' +
      '.wcs-label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#7f8c9a;font-weight:700;margin-bottom:5px}' +
      '.wcs-personal{width:100%;padding:9px 11px;border:1px solid #d5dae2;border-radius:6px;font-size:12.5px;font-family:inherit;resize:vertical;min-height:52px;margin-bottom:14px;box-sizing:border-box}' +
      '.wcs-charcount{font-size:10.5px;color:#99a3ad;text-align:right;margin:-10px 0 12px}';
    var style = document.createElement('style');
    style.id = 'wal-comp-seguro-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ── HTML estático do modal (sem nenhum dado dinâmico interpolado —
     o conteúdo variável é sempre preenchido depois via textContent) ── */
  function injetarModal_() {
    if (document.getElementById('wcs-overlay')) return;
    var wrap = document.createElement('div');
    wrap.id = 'wcs-overlay';
    wrap.className = 'wcs-overlay';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="wcs-box">' +
        '<div class="wcs-head">' +
          '<button type="button" class="wcs-close" id="wcs-btn-fechar">✕</button>' +
          '<div class="wcs-title">🔒 Compartilhamento seguro</div>' +
          '<div class="wcs-subtitle">Apresente primeiro a WAL Imóveis e depois compartilhe a oportunidade com seu link de agente.</div>' +
          '<div class="wcs-steps"><span id="wcs-dot-1"></span><span id="wcs-dot-2"></span></div>' +
        '</div>' +
        '<div class="wcs-body">' +
          '<div class="wcs-pane" id="wcs-pane-1">' +
            '<img class="wcs-img" id="wcs-cartao-img" alt="Cartão institucional WAL Imóveis">' +
            '<div class="wcs-txt" id="wcs-texto-institucional"></div>' +
            '<button type="button" class="wcs-btn wcs-btn-gold" id="wcs-btn-compartilhar-cartao">1. Compartilhar cartão institucional</button>' +
            '<a class="wcs-btn wcs-btn-outline" id="wcs-btn-baixar-cartao" download="cartao-wal-imoveis.png">⬇️ Baixar cartão</a>' +
            '<button type="button" class="wcs-btn wcs-btn-outline" id="wcs-btn-copiar-texto-inst">📋 Copiar texto de apresentação</button>' +
            '<div class="wcs-hint">Após enviar o cartão institucional, retorne a esta tela para compartilhar a oportunidade.</div>' +
            '<button type="button" class="wcs-btn wcs-btn-navy" id="wcs-btn-continuar">Continuar para a oportunidade →</button>' +
          '</div>' +
          '<div class="wcs-pane" id="wcs-pane-2">' +
            '<label class="wcs-label">Apresentação pessoal (opcional)</label>' +
            '<textarea class="wcs-personal" id="wcs-personalizacao" maxlength="220" placeholder="Ex.: Foi um prazer falar com você hoje!"></textarea>' +
            '<div class="wcs-charcount" id="wcs-charcount">0/220</div>' +
            '<div class="wcs-txt" id="wcs-texto-oportunidade"></div>' +
            '<div class="wcs-link" id="wcs-link-oficial"></div>' +
            '<a class="wcs-btn wcs-btn-wpp" id="wcs-btn-enviar-wpp" target="_blank" rel="noopener">📱 Enviar pelo WhatsApp</a>' +
            '<button type="button" class="wcs-btn wcs-btn-outline" id="wcs-btn-copiar-mensagem">📋 Copiar mensagem</button>' +
            '<button type="button" class="wcs-btn wcs-btn-outline" id="wcs-btn-copiar-link">🔗 Copiar somente o link</button>' +
            '<button type="button" class="wcs-btn wcs-btn-ghost" id="wcs-btn-voltar">← Voltar ao cartão institucional</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) fechar_(); });
    document.getElementById('wcs-btn-fechar').addEventListener('click', fechar_);
    document.getElementById('wcs-btn-continuar').addEventListener('click', function () { logEvento_('share_intro_ok', _estado, ''); irParaEtapa_(2); });
    document.getElementById('wcs-btn-voltar').addEventListener('click', function () { irParaEtapa_(1); });
    document.getElementById('wcs-btn-copiar-texto-inst').addEventListener('click', function (e) {
      copiarTexto_(TEXTO_INSTITUCIONAL, e.target);
      logEvento_('share_intro_text_copied', _estado, 'copiar_texto');
    });
    document.getElementById('wcs-btn-compartilhar-cartao').addEventListener('click', compartilharCartao_);
    document.getElementById('wcs-btn-enviar-wpp').addEventListener('click', function () { logEvento_('share_opportunity_whatsapp', _estado, 'whatsapp'); });
    document.getElementById('wcs-btn-copiar-mensagem').addEventListener('click', function (e) {
      copiarTexto_(_estado._mensagem.texto, e.target);
      logEvento_('share_opportunity_text_copied', _estado, 'copiar_mensagem');
    });
    document.getElementById('wcs-btn-copiar-link').addEventListener('click', function (e) {
      copiarTexto_(_estado._mensagem.link, e.target);
      logEvento_('share_official_link_copied', _estado, 'copiar_link');
    });
    document.getElementById('wcs-personalizacao').addEventListener('input', function (e) {
      document.getElementById('wcs-charcount').textContent = e.target.value.length + '/220';
      atualizarPreviaOportunidade_();
    });
  }

  function copiarTexto_(txt, btn) {
    navigator.clipboard.writeText(txt).then(function () {
      if (!btn) return;
      var orig = btn.textContent;
      btn.textContent = '✅ Copiado!';
      setTimeout(function () { btn.textContent = orig; }, 2000);
    }).catch(function () {});
  }

  function fechar_() {
    var ov = document.getElementById('wcs-overlay');
    if (ov) ov.style.display = 'none';
  }

  function irParaEtapa_(n) {
    document.getElementById('wcs-pane-1').classList.toggle('on', n === 1);
    document.getElementById('wcs-pane-2').classList.toggle('on', n === 2);
    document.getElementById('wcs-dot-1').classList.toggle('on', true);
    document.getElementById('wcs-dot-2').classList.toggle('on', n === 2);
    if (n === 2) atualizarPreviaOportunidade_();
  }

  function atualizarPreviaOportunidade_() {
    var apresentacao = sanitizarTextoLivre_(document.getElementById('wcs-personalizacao').value, 220);
    var msg = _estado.tipo === 'mapa'
      ? montarMensagemMapa_(_estado, apresentacao)
      : montarMensagemEmpreendimento_(_estado, apresentacao);
    _estado._mensagem = msg;
    document.getElementById('wcs-texto-oportunidade').textContent = msg.texto;
    document.getElementById('wcs-link-oficial').textContent = msg.link;
    document.getElementById('wcs-btn-enviar-wpp').href = 'https://wa.me/?text=' + encodeURIComponent(msg.texto);
  }

  // Precisa estar pronto ANTES do clique: iOS Safari (e vários
  // navegadores móveis) só deixa navigator.share() abrir se ele for
  // chamado sem nenhum "await" no meio do gesto de clique — um
  // `await fetch(...)` ali no meio (por menor que seja) já é o
  // suficiente pro navegador não considerar mais "ação direta do
  // usuário" e rejeitar o compartilhamento sem avisar nada (o clique
  // parecia não fazer nada — bug real reportado pelo Antonio,
  // 04/09/2026). Por isso a imagem é buscada assim que o modal abre
  // (ver abrirCompartilhamentoSeguro), não no clique do botão.
  var _cartaoFile = null;
  function precarregarCartaoArquivo_() {
    if (_cartaoFile !== null) return;
    fetch(CARTAO_IMG_URL).then(function (r) { return r.blob(); }).then(function (blob) {
      _cartaoFile = new File([blob], 'cartao-wal-imoveis.png', { type: blob.type || 'image/png' });
    }).catch(function () {});
  }

  function compartilharCartao_() {
    if (_cartaoFile && navigator.canShare && navigator.canShare({ files: [_cartaoFile] })) {
      navigator.share({ files: [_cartaoFile], text: TEXTO_INSTITUCIONAL })
        .then(function () { logEvento_('share_institutional_card', _estado, 'web_share'); })
        .catch(function () {
          // Usuário cancelou o compartilhamento nativo, ou o navegador
          // não confirma o resultado — não bloqueia o fluxo por causa
          // disso (o navegador normalmente não informa se o envio foi
          // concluído).
        });
      return;
    }
    if (navigator.share) {
      // Ainda sem a imagem pronta (raro — usuário clicou muito rápido)
      // ou o navegador compartilha texto mas não arquivo: manda o
      // texto mesmo assim (com o link do domínio oficial dentro), não
      // deixa o botão sem fazer nada.
      navigator.share({ text: TEXTO_INSTITUCIONAL })
        .then(function () { logEvento_('share_institutional_card', _estado, 'web_share_texto'); })
        .catch(function () {});
      return;
    }
    document.getElementById('wcs-btn-baixar-cartao').click();
    logEvento_('share_institutional_card', _estado, 'download');
  }

  var _estado = null;

  window.abrirCompartilhamentoSeguro = function (opts) {
    opts = opts || {};
    if (!opts.agente || !opts.agente.nome || !opts.agente.whatsapp) {
      alert('Não foi possível gerar o compartilhamento porque o cadastro do agente está incompleto. Atualize seu nome e WhatsApp para continuar.');
      return;
    }
    opts.agente = { id: opts.agente.id || '', nome: opts.agente.nome, whatsapp: opts.agente.whatsapp };
    _estado = opts;

    injetarEstilo_();
    injetarModal_();

    document.getElementById('wcs-cartao-img').src = CARTAO_IMG_URL;
    document.getElementById('wcs-texto-institucional').textContent = TEXTO_INSTITUCIONAL;
    document.getElementById('wcs-btn-baixar-cartao').href = CARTAO_IMG_URL;
    precarregarCartaoArquivo_();
    var temShareArquivo = !!(navigator.canShare && (function () { try { return navigator.canShare({ files: [new File([], 'x.png', { type: 'image/png' })] }); } catch (e) { return false; } })());
    document.getElementById('wcs-btn-compartilhar-cartao').style.display = (navigator.share) ? 'flex' : 'none';
    document.getElementById('wcs-btn-baixar-cartao').style.display = temShareArquivo ? 'none' : 'flex';

    document.getElementById('wcs-personalizacao').value = '';
    document.getElementById('wcs-charcount').textContent = '0/220';
    irParaEtapa_(1);

    document.getElementById('wcs-overlay').style.display = 'flex';
    logEvento_('share_safe_started', opts, '');
  };
})();
