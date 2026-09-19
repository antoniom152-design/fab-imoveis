/* ══════════════════════════════════════════════════════════════
   WAL CHAT WIDGET — painel de chat entre Atendente humano e Lead,
   com a IA respondendo por padrão até um humano entrar na conversa
   (pedido 90).

   Cópia adaptada de feirao/shared/chat-widget.js (mesma lógica de
   polling/otimista/dedupe, já validada no sistema do Feirão) — NÃO é
   o mesmo arquivo nem aponta pro mesmo backend: aqui é o CRM
   principal (Sistema Web), lá é o ecossistema separado do Feirão.
   Diferenças da versão original:
   - Thread = Lead_Id da aba LEADS (não e-mail — consistente com
     HISTORICO_ATENDIMENTO_LEAD, que também é chaveado por Lead_Id).
   - 3 remetentes possíveis ('lead'|'atendente'|'ia'), não 2 — é isso
     que deixa a IA (chat.html) e o Atendente (este widget) dividirem
     a mesma conversa sem o lead perceber troca de canal.
   - Lado atendente autentica por e-mail+sessionToken (sessão OTP já
     usada em todo o Sistema Web via crm_atendenteContexto_), não
     pelo PIN antigo do Feirão.
   - Lado lead sem sessão nenhuma — mesmo nível de confiança já
     aceito em crm_lead_evento_publico_ no apps-script-sistema-web-
     cadastro.gs (quem sabe o Lead_Id pode ler/escrever a própria
     conversa).

   Backend: painel/shared/apps-script-sistema-web-cadastro.gs (ações
   crm_lead_chat_enviar / crm_lead_chat_buscar / crm_atendente_chat_threads),
   planilha "WAL — CRM de Leads" (mesma de sempre no Sistema Web).
   Transporte = polling (POST no-cors pra escrever, GET com callback
   JSONP pra ler).

   USO — modo lead (uma conversa só, com quem responder — IA ou
   Atendente):
     WalChatWidget.init({
       apiUrl: CADASTRO_API_URL,
       role: 'lead',
       threadId: leadId,       // Lead_Id da aba LEADS (chave única)
       nome: nomeDoLead
     });

   USO — modo atendente (inbox com várias conversas, uma por lead):
     WalChatWidget.init({
       apiUrl: CADASTRO_API_URL,
       role: 'atendente',
       nome: nomeDoAtendente,
       email: emailDoAtendente,        // sessão OTP já verificada
       sessionToken: sessionTokenDoAtendente
     });
═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function normalizarId(v) { return String(v == null ? '' : v).trim(); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Escrita = POST no-cors, fire-and-forget (não dá pra ler a
     resposta nesse modo, mas o polling seguinte já traz a mensagem). */
  function post(apiUrl, action, payload) {
    if (!apiUrl || apiUrl.indexOf('COLOQUE_AQUI') === 0) return Promise.resolve(null);
    try {
      return fetch(apiUrl, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(Object.assign({ action: action }, payload))
      }).catch(function () {});
    } catch (e) { return Promise.resolve(null); }
  }

  /* Leitura = GET com callback JSONP (dá pra ler a resposta,
     diferente do POST no-cors). */
  function jsonp(apiUrl, action, params, timeoutMs) {
    return new Promise(function (resolve) {
      if (!apiUrl || apiUrl.indexOf('COLOQUE_AQUI') === 0) { resolve(null); return; }
      var cb = 'walChatCb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      var s = document.createElement('script');
      var timeout = setTimeout(function () { cleanup(); resolve(null); }, timeoutMs || 15000);
      function cleanup() { clearTimeout(timeout); delete global[cb]; s.parentNode && s.parentNode.removeChild(s); }
      global[cb] = function (data) { cleanup(); resolve(data); };
      var qs = new URLSearchParams(Object.assign({ action: action, callback: cb }, params || {}));
      s.onerror = function () { cleanup(); resolve(null); };
      s.src = apiUrl + '?' + qs.toString();
      document.body.appendChild(s);
    });
  }

  var CSS = '\
    .wal-chat-fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;\
      background:#0A1628;color:#C9A84C;border:2px solid #C9A84C;font-size:24px;cursor:pointer;\
      box-shadow:0 4px 16px rgba(0,0,0,.35);z-index:9998;display:flex;align-items:center;justify-content:center}\
    .wal-chat-badge{position:absolute;top:-4px;right:-4px;background:#D64545;color:#fff;font-size:11px;\
      font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px}\
    .wal-chat-panel{position:fixed;right:20px;bottom:88px;width:340px;max-width:calc(100vw - 32px);\
      height:480px;max-height:calc(100vh - 120px);background:#0F1E33;border:1px solid #2A3B55;\
      border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.45);z-index:9999;display:none;\
      flex-direction:column;overflow:hidden;font-family:inherit}\
    .wal-chat-panel.open{display:flex}\
    .wal-chat-head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0A1628;\
      border-bottom:1px solid #2A3B55;color:#C9A84C;font-weight:700;font-size:14px}\
    .wal-chat-title{flex:1}\
    .wal-chat-back,.wal-chat-close{background:none;border:none;color:#C9A84C;font-size:18px;cursor:pointer;padding:0 4px}\
    .wal-chat-threads{flex:1;overflow-y:auto}\
    .wal-chat-thread{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-bottom:1px solid #1B2A42;cursor:pointer}\
    .wal-chat-thread:hover{background:#152436}\
    .wal-chat-thread-sinal{background:rgba(214,69,69,.12);border-left:3px solid #D64545}\
    .wal-chat-thread-sinal .wal-chat-thread-name{color:#F3A5A5}\
    .wal-chat-thread-top{display:flex;justify-content:space-between;align-items:center;gap:6px}\
    .wal-chat-thread-name{color:#E7ECF3;font-size:13px;font-weight:600}\
    .wal-chat-thread-prev{color:#8A97AB;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
    .wal-chat-thread-badge{background:#D64545;color:#fff;font-size:11px;font-weight:700;min-width:18px;\
      height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 5px}\
    .wal-chat-empty{color:#8A97AB;font-size:13px;text-align:center;padding:24px 12px}\
    .wal-chat-body{flex:1;display:flex;flex-direction:column;overflow:hidden}\
    .wal-chat-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}\
    .wal-chat-msg{max-width:78%;padding:8px 11px;border-radius:10px;font-size:13px;line-height:1.4;word-wrap:break-word}\
    .wal-chat-msg.mine{align-self:flex-end;background:#C9A84C;color:#0A1628}\
    .wal-chat-msg.theirs{align-self:flex-start;background:#1B2A42;color:#E7ECF3}\
    .wal-chat-msg-time{display:block;font-size:10px;opacity:.65;margin-top:3px}\
    .wal-chat-inputrow{display:flex;gap:8px;padding:10px;border-top:1px solid #2A3B55;background:#0A1628}\
    .wal-chat-inputrow input{flex:1;background:#152436;border:1px solid #2A3B55;border-radius:8px;\
      padding:9px 10px;color:#E7ECF3;font-size:13px}\
    .wal-chat-inputrow button{background:#C9A84C;color:#0A1628;border:none;border-radius:8px;\
      padding:0 14px;font-weight:700;cursor:pointer;font-size:13px}\
    .wal-chat-msg.pending{opacity:.55}\
    .wal-chat-msg.failed{background:#3A1620;border:1px solid #D64545}\
    .wal-chat-msg-fail{display:block;color:#FCA5A5;font-size:11px;margin-top:4px;font-weight:600}\
  ';

  function injetarEstilos() {
    if (document.getElementById('wal-chat-styles')) return;
    var st = document.createElement('style');
    st.id = 'wal-chat-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function WalChatWidget(opts) {
    opts = opts || {};
    this.apiUrl   = opts.apiUrl || global.CADASTRO_API_URL || '';
    this.role     = opts.role === 'atendente' ? 'atendente' : 'lead';
    this.nome     = opts.nome || (this.role === 'atendente' ? 'Atendente WAL' : 'Você');
    this.mode     = this.role === 'atendente' ? 'inbox' : 'single';
    this.threadId = opts.threadId ? normalizarId(opts.threadId) : '';
    this.email        = opts.email || '';        // atendente: sessão OTP já verificada
    this.sessionToken = opts.sessionToken || '';  // atendente: idem; lead: sempre vazio (sem gate de OTP)
    this.pollMs   = opts.pollMs || 5000;

    this.activeThread  = this.mode === 'single' ? this.threadId : null;
    this.activeNome    = this.mode === 'single' ? this.nome : '';
    this.lastTimestamp = null;
    this.unread         = 0;
    this.pollTimer       = null;
    this.threadsPollTimer = null;
    this._pendentes = {}; // pendingKey -> texto — mensagens pintadas na tela mas ainda não confirmadas pelo servidor
    this._pintadas = {}; // assinatura -> true — evita pintar a mesma mensagem 2x quando dois polls se sobrepõem

    this._build();
    this._startBackgroundPolling();
  }

  WalChatWidget.prototype._build = function () {
    injetarEstilos();
    var self = this;

    this.btn = document.createElement('button');
    this.btn.className = 'wal-chat-fab';
    this.btn.type = 'button';
    this.btn.innerHTML = '💬<span class="wal-chat-badge" style="display:none"></span>';
    this.btn.onclick = function () { self.toggle(); };
    document.body.appendChild(this.btn);
    this.badgeEl = this.btn.querySelector('.wal-chat-badge');

    this.panel = document.createElement('div');
    this.panel.className = 'wal-chat-panel';
    document.body.appendChild(this.panel);

    if (this.mode === 'inbox') this._renderInboxShell(); else this._renderThreadShell(this.nome);
  };

  WalChatWidget.prototype.toggle = function () {
    var abrindo = !this.panel.classList.contains('open');
    this.panel.classList.toggle('open', abrindo);
    if (abrindo) {
      this.unread = 0;
      this._atualizarBadge();
      if (this.mode === 'inbox' && !this.activeThread) this._carregarThreads();
      else this._poll(true);
      this._startForegroundPolling();
    } else {
      this._stopForegroundPolling();
    }
  };

  /* ── modo INBOX (atendente) ─────────────────────────────────── */
  WalChatWidget.prototype._renderInboxShell = function () {
    var self = this;
    this.panel.innerHTML =
      '<div class="wal-chat-head">' +
        '<button class="wal-chat-back" style="display:none">←</button>' +
        '<div class="wal-chat-title">Conversas</div>' +
        '<button class="wal-chat-close">×</button>' +
      '</div>' +
      '<div class="wal-chat-threads"><div class="wal-chat-empty">Carregando…</div></div>';
    this.panel.querySelector('.wal-chat-close').onclick = function () { self.toggle(); };
    this.panel.querySelector('.wal-chat-back').onclick = function () { self._voltarParaThreads(); };
  };

  /* pedido 90.1.b — thread cuja última mensagem é o alerta "🆘" que
     chat.html grava quando o lead pede um atendente humano (ver
     sinalizarPedidoAtendente_). Reconhecido só pelo prefixo, sem
     mudança de schema/backend. */
  function pediuAtendente(t) { return /^🆘/.test(t.ultimaMensagem || ''); }

  WalChatWidget.prototype._carregarThreads = function () {
    var self = this;
    return jsonp(this.apiUrl, 'crm_atendente_chat_threads', { email: this.email, sessionToken: this.sessionToken }).then(function (data) {
      var lista = (data && data.threads) || [];
      var totalNaoLidas = lista.reduce(function (acc, t) { return acc + (t.naoLidas || 0); }, 0);
      self.unread = self.panel.classList.contains('open') ? 0 : totalNaoLidas;
      self._atualizarBadge();

      // dispara o alerta sonoro (reaproveita alertaSonoroTocar_/
      // alertaSonoroAtivo_ já usados pra leads novos na página que
      // hospeda o widget) só na primeira vez que uma thread aparece
      // pedindo atendente — não a cada poll enquanto ela continuar assim.
      var pedidosAgora = {};
      lista.forEach(function (t) { if (pediuAtendente(t)) pedidosAgora[t.leadId] = true; });
      if (self._pedidosAtendenteConhecidos) {
        var novoPedido = Object.keys(pedidosAgora).some(function (id) { return !self._pedidosAtendenteConhecidos[id]; });
        if (novoPedido && typeof global.alertaSonoroAtivo_ === 'function' && global.alertaSonoroAtivo_() && typeof global.alertaSonoroTocar_ === 'function') {
          global.alertaSonoroTocar_();
        }
      }
      self._pedidosAtendenteConhecidos = pedidosAgora;

      var box = self.panel.querySelector('.wal-chat-threads');
      if (!box) return;
      if (!lista.length) {
        box.innerHTML = '<div class="wal-chat-empty">Nenhuma conversa ainda.</div>';
        return;
      }
      box.innerHTML = lista.map(function (t) {
        var sinal = pediuAtendente(t);
        return '' +
          '<div class="wal-chat-thread' + (sinal ? ' wal-chat-thread-sinal' : '') + '" data-leadid="' + escapeHtml(t.leadId) + '" data-nome="' + escapeHtml(t.nome) + '">' +
            '<div class="wal-chat-thread-top">' +
              '<span class="wal-chat-thread-name">' + (sinal ? '🆘 ' : '') + escapeHtml(t.nome || t.leadId) + '</span>' +
              (t.naoLidas ? '<span class="wal-chat-thread-badge">' + t.naoLidas + '</span>' : '') +
            '</div>' +
            '<span class="wal-chat-thread-prev">' + escapeHtml(sinal ? 'Pediu para falar com um atendente' : (t.ultimaMensagem || '')) + '</span>' +
          '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.wal-chat-thread'), function (el) {
        el.onclick = function () { self._abrirThread(el.getAttribute('data-leadid'), el.getAttribute('data-nome')); };
      });
    });
  };

  WalChatWidget.prototype._abrirThread = function (leadId, nome) {
    this.activeThread = normalizarId(leadId);
    this.activeNome = nome || leadId;
    this.lastTimestamp = null;
    this._renderThreadShell(this.activeNome, true);
    this._poll(true);
  };

  WalChatWidget.prototype._voltarParaThreads = function () {
    this.activeThread = null;
    this.lastTimestamp = null;
    this._renderInboxShell();
    this._carregarThreads();
  };

  /* ── modo THREAD (conversa aberta — lead sempre está aqui) ────── */
  WalChatWidget.prototype._renderThreadShell = function (titulo, comVoltar) {
    var self = this;
    this._pintadas = {}; // container de mensagens vai ser recriado do zero — nada foi pintado nele ainda
    this._threadCarregado = false; // controla o "wipe" de primeira carga — ver _poll()
    this.panel.innerHTML =
      '<div class="wal-chat-head">' +
        (comVoltar ? '<button class="wal-chat-back">←</button>' : '') +
        '<div class="wal-chat-title">' + escapeHtml(titulo || 'Fale com a gente') + '</div>' +
        '<button class="wal-chat-close">×</button>' +
      '</div>' +
      '<div class="wal-chat-body">' +
        '<div class="wal-chat-messages"><div class="wal-chat-empty">Carregando…</div></div>' +
        '<div class="wal-chat-inputrow">' +
          '<input type="text" placeholder="Digite uma mensagem..." maxlength="1000" />' +
          '<button type="button">Enviar</button>' +
        '</div>' +
      '</div>';
    this.panel.querySelector('.wal-chat-close').onclick = function () { self.toggle(); };
    var back = this.panel.querySelector('.wal-chat-back');
    if (back) back.onclick = function () { self._voltarParaThreads(); };

    var input = this.panel.querySelector('.wal-chat-inputrow input');
    var sendBtn = this.panel.querySelector('.wal-chat-inputrow button');
    var enviar = function () {
      var texto = input.value.trim();
      if (!texto) return;
      self._enviar(texto);
      input.value = '';
    };
    sendBtn.onclick = enviar;
    input.onkeydown = function (e) { if (e.key === 'Enter') enviar(); };
  };

  /* Escrita = POST no-cors fire-and-forget: o navegador nunca sabe se o
     servidor aceitou (ex.: sessão do atendente expirada) só de olhar a
     resposta. Por isso a mensagem é pintada como "pending" e só perde
     esse estado quando ALGUM poll (o disparado logo depois de enviar,
     ou qualquer um de fundo) trouxer de volta uma mensagem igual,
     remetida por nós — sem isso em 8s, marcamos como falha visível em
     vez de deixar o usuário achando que enviou algo que nunca chegou
     à planilha. */
  WalChatWidget.prototype._enviar = function (texto) {
    if (!this.activeThread) return;
    var self = this;
    var pendingKey = 'p' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    var el = this._pintarMensagem({ remetente: this.role, texto: texto, timestamp: new Date().toISOString(), nome: this.nome }, pendingKey);
    if (el) el.classList.add('pending');
    this._pendentes[pendingKey] = texto;
    // o box já tem conteúdo real agora — impede que uma resposta atrasada
    // do carregamento inicial (disparado ao abrir a thread) apague esta
    // bolha ao "zerar" o container quando finalmente responder (ver _poll)
    this._threadCarregado = true;
    post(this.apiUrl, 'crm_lead_chat_enviar', {
      leadId: this.activeThread, nome: this.nome, remetente: this.role, texto: texto,
      email: this.email, sessionToken: this.sessionToken
    }).then(function () { self._poll(false); });
    setTimeout(function () {
      if (!self._pendentes[pendingKey]) return; // já foi confirmada por algum poll
      delete self._pendentes[pendingKey];
      var pendingEl = self.panel.querySelector('[data-pending="' + pendingKey + '"]');
      if (!pendingEl) return;
      pendingEl.classList.remove('pending');
      pendingEl.classList.add('failed');
      var warn = document.createElement('span');
      warn.className = 'wal-chat-msg-fail';
      warn.textContent = '⚠️ Não confirmado pelo servidor — sua sessão pode ter expirado. Atualize a página e tente de novo.';
      pendingEl.appendChild(warn);
    }, 8000);
  };

  WalChatWidget.prototype._pintarMensagem = function (m, pendingKey) {
    if (!pendingKey) {
      // mensagens "oficiais" (vindas do servidor) podem se repetir quando
      // dois polls ficam em voo ao mesmo tempo (ex.: o poll de confirmação
      // disparado logo após enviar + o poll periódico de fundo) — sem isso,
      // a mesma mensagem aparece duplicada na tela.
      var assinatura = m.remetente + '|' + m.texto + '|' + m.timestamp;
      if (this._pintadas[assinatura]) return null;
      this._pintadas[assinatura] = true;
    }
    var box = this.panel.querySelector('.wal-chat-messages');
    if (!box) return null;
    var vazio = box.querySelector('.wal-chat-empty');
    if (vazio) vazio.remove();
    // do lado do Atendente (role 'atendente'), tanto 'atendente' quanto
    // 'ia' são "nossas" mensagens (mesmo lado da conversa) — só 'lead' é
    // do outro lado. Do lado do lead (role 'lead'), só 'lead' é "minha".
    var mine = m.remetente === this.role || (this.role === 'atendente' && m.remetente === 'ia');
    var hora = '';
    try { hora = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    var div = document.createElement('div');
    div.className = 'wal-chat-msg ' + (mine ? 'mine' : 'theirs');
    if (pendingKey) div.setAttribute('data-pending', pendingKey);
    var rotulo = m.remetente === 'ia' ? '🤖 Assistente: ' : (m.remetente === 'atendente' && this.role === 'lead' ? '🧑‍💼 Atendente: ' : '');
    div.innerHTML = (rotulo ? '<b>' + rotulo + '</b>' : '') + escapeHtml(m.texto) + '<span class="wal-chat-msg-time">' + hora + '</span>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  };

  WalChatWidget.prototype._poll = function (primeiraCarga) {
    if (!this.activeThread) return Promise.resolve();
    var self = this;
    return jsonp(this.apiUrl, 'crm_lead_chat_buscar', {
      leadId: this.activeThread, since: this.lastTimestamp || '', leitor: this.role,
      email: this.email || '', sessionToken: this.sessionToken || ''
    }).then(function (data) {
      var mensagens = (data && data.mensagens) || [];
      // "primeiraCarga" só pode zerar o box se NADA aconteceu no meio tempo
      // (Apps Script pode demorar; se o usuário já digitou e enviou algo
      // enquanto essa resposta ainda estava a caminho, self._threadCarregado
      // já virou true em _enviar — sem essa checagem, esta resposta atrasada
      // apagaria a mensagem que o usuário acabou de mandar).
      if (primeiraCarga && !self._threadCarregado) {
        var box = self.panel.querySelector('.wal-chat-messages');
        if (box) box.innerHTML = mensagens.length ? '' : '<div class="wal-chat-empty">Nenhuma mensagem ainda. Diga oi 👋</div>';
      }
      self._threadCarregado = true;
      mensagens.forEach(function (m) {
        // esta mensagem confirma algum envio nosso ainda pendente? remove a
        // bolha otimista — a cópia "oficial" do servidor é pintada abaixo
        if (m.remetente === self.role) {
          Object.keys(self._pendentes).forEach(function (key) {
            if (self._pendentes[key] === m.texto) {
              delete self._pendentes[key];
              var pendingEl = self.panel.querySelector('[data-pending="' + key + '"]');
              if (pendingEl) pendingEl.remove();
            }
          });
        }
        self._pintarMensagem(m);
        if (!self.lastTimestamp || m.timestamp > self.lastTimestamp) self.lastTimestamp = m.timestamp;
        if (m.remetente !== self.role && !self.panel.classList.contains('open')) self.unread++;
      });
      self._atualizarBadge();
    });
  };

  WalChatWidget.prototype._atualizarBadge = function () {
    if (!this.badgeEl) return;
    if (this.unread > 0) {
      this.badgeEl.textContent = this.unread > 9 ? '9+' : String(this.unread);
      this.badgeEl.style.display = 'flex';
    } else {
      this.badgeEl.style.display = 'none';
    }
  };

  /* Polling de fundo (painel fechado): só o suficiente pra manter o
     badge de não-lidas atualizado, sem pintar mensagem nenhuma. */
  WalChatWidget.prototype._startBackgroundPolling = function () {
    var self = this;
    this.threadsPollTimer = setInterval(function () {
      if (self.panel.classList.contains('open')) return; // primeiro plano já cobre
      if (self.mode === 'inbox') self._carregarThreads();
      else self._poll(false);
    }, this.pollMs * 2);
  };

  WalChatWidget.prototype._startForegroundPolling = function () {
    var self = this;
    this._stopForegroundPolling();
    this.pollTimer = setInterval(function () {
      if (self.mode === 'inbox' && !self.activeThread) self._carregarThreads();
      else self._poll(false);
    }, this.pollMs);
  };

  WalChatWidget.prototype._stopForegroundPolling = function () {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  };

  global.WalChatWidget = {
    init: function (opts) { return new WalChatWidget(opts); }
  };
})(window);
