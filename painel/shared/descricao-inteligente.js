/* ══════════════════════════════════════════════════════════════════
   DESCRIÇÃO INTELIGENTE — componente compartilhado
   Usado por: index.html, imoveis.html, painel/atendente/dashboard_atendente.html
   e painel/agente/dashboard-agente.html (carregado via <script src>, depois
   de marked.js e DOMPurify). imovel.html tem sua própria cópia inline (única
   instância por página, já em produção) — este arquivo é a versão genérica
   para páginas com VÁRIOS cards de descrição na mesma tela.

   Detecta automaticamente se o texto (campo "Descrição do Imóvel" da aba
   IMOVEISDISPONIVEIS) tem Markdown ou é texto simples, formata em segurança
   (sanitizado com DOMPurify) e limita a exibição inicial a 7 linhas visuais,
   com botão "+ detalhes" / "− mostrar menos".

   Como usar em cada página:
   1) No HTML de cada card, no lugar do texto puro da descrição, usar:
        <div class="descricao-wrapper descricao-recolhida">
          <div class="descricao-imovel"></div>
        </div>
        <button class="botao-detalhes-descricao" type="button"
                aria-expanded="false" hidden>+ detalhes</button>
      (wrapper e botão sempre irmãos adjacentes — é assim que o clique
      no botão encontra o wrapper certo, sem precisar de id por card)
   2) Depois de inserir o HTML dos cards no DOM, para cada card chamar:
        preencherDescricaoInteligente(containerEl, textoDaPlanilha, mensagemVazia)
   3) Ao final, uma vez só, chamar:
        recalcularDescricoesInteligentes()
      (o próprio arquivo já recalcula sozinho no resize da janela e
      quando as fontes terminam de carregar)
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function normalizarQuebras(texto) {
    return String(texto || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  function possuiMarkdown(texto) {
    if (!texto || typeof texto !== 'string') return false;
    const padroesMarkdown = [
      /^#{1,6}\s+.+$/m,
      /\*\*[^*\n]+\*\*/,
      /^\s*[-*+]\s+.+$/m,
      /^\s*\d+\.\s+.+$/m,
      /^\s*>\s+.+$/m,
      /\[[^\]]+\]\([^)]+\)/
    ];
    return padroesMarkdown.some((padrao) => padrao.test(texto));
  }

  function pareceTituloSimples(texto) {
    const linha = texto.trim();
    if (!linha) return false;
    if (linha.length < 3 || linha.length > 90) return false;
    if (linha.split(/\s+/).length > 12) return false;
    if (linha.endsWith('.')) return false;
    const possuiLetras = /[A-Za-zÀ-ÿ]/.test(linha);
    const estaEmMaiusculas = possuiLetras && linha === linha.toLocaleUpperCase('pt-BR');
    return estaEmMaiusculas || linha.endsWith(':');
  }

  function renderizarTextoSimples(texto) {
    const fragmento = document.createDocumentFragment();
    const conteudo = normalizarQuebras(texto);
    if (!conteudo) return fragmento;

    const blocos = conteudo.split(/\n\s*\n/);
    let primeiroBlocoValido = true;

    blocos.forEach((bloco) => {
      const linhas = bloco.split('\n').map((linha) => linha.trim()).filter(Boolean);
      if (!linhas.length) return;

      const todasSaoItens = linhas.every((linha) => /^[-*•]\s+/.test(linha));

      if (todasSaoItens) {
        const lista = document.createElement('ul');
        linhas.forEach((linha) => {
          const item = document.createElement('li');
          item.textContent = linha.replace(/^[-*•]\s+/, '');
          lista.appendChild(item);
        });
        fragmento.appendChild(lista);
        primeiroBlocoValido = false;
        return;
      }

      if (linhas.length === 1 && pareceTituloSimples(linhas[0])) {
        const titulo = document.createElement(primeiroBlocoValido ? 'h2' : 'h3');
        titulo.textContent = linhas[0].replace(/:$/, '');
        fragmento.appendChild(titulo);
        primeiroBlocoValido = false;
        return;
      }

      const paragrafo = document.createElement('p');
      linhas.forEach((linha, indice) => {
        paragrafo.appendChild(document.createTextNode(linha));
        if (indice < linhas.length - 1) paragrafo.appendChild(document.createElement('br'));
      });
      fragmento.appendChild(paragrafo);
      primeiroBlocoValido = false;
    });

    return fragmento;
  }

  function renderizarMarkdown(texto) {
    if (typeof marked === 'undefined') throw new Error('A biblioteca marked.js não foi carregada.');
    if (typeof DOMPurify === 'undefined') throw new Error('A biblioteca DOMPurify não foi carregada.');

    const htmlConvertido = marked.parse(normalizarQuebras(texto), { breaks: false, gfm: true });
    const htmlSanitizado = DOMPurify.sanitize(htmlConvertido, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
      FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload']
    });

    const resultado = document.createElement('div');
    resultado.innerHTML = htmlSanitizado;

    resultado.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });

    return resultado;
  }

  function preencherDescricaoInteligente(container, descricao, mensagemVazia) {
    if (!container) return;
    container.replaceChildren();
    const conteudo = normalizarQuebras(descricao);

    if (!conteudo) {
      const mensagem = document.createElement('p');
      mensagem.className = 'descricao-indisponivel';
      mensagem.textContent = mensagemVazia || 'Descrição não disponível.';
      container.appendChild(mensagem);
      return;
    }

    try {
      if (possuiMarkdown(conteudo)) {
        container.appendChild(renderizarMarkdown(conteudo));
      } else {
        container.appendChild(renderizarTextoSimples(conteudo));
      }
    } catch (erro) {
      console.error('Não foi possível formatar a descrição:', erro);
      container.replaceChildren(renderizarTextoSimples(conteudo));
    }
  }

  function botaoDoWrapper(wrapper) {
    const proximo = wrapper.nextElementSibling;
    if (proximo && proximo.classList.contains('botao-detalhes-descricao')) return proximo;
    return wrapper.parentElement
      ? wrapper.parentElement.querySelector('.botao-detalhes-descricao')
      : null;
  }

  function avaliarWrapper(wrapper) {
    const botao = botaoDoWrapper(wrapper);
    const conteudo = wrapper.firstElementChild;
    if (!botao || !conteudo) return;

    if (!wrapper.classList.contains('descricao-expandida')) {
      wrapper.classList.add('descricao-recolhida');
      botao.textContent = '+ detalhes';
      botao.setAttribute('aria-expanded', 'false');
    }

    requestAnimationFrame(() => {
      if (wrapper.classList.contains('descricao-expandida')) return;
      const ultrapassaLimite = conteudo.scrollHeight > wrapper.clientHeight + 2;
      botao.hidden = !ultrapassaLimite;
      wrapper.classList.toggle('descricao-com-excedente', ultrapassaLimite);
      if (!ultrapassaLimite) wrapper.classList.remove('descricao-recolhida');
    });
  }

  function recalcularDescricoesInteligentes() {
    document.querySelectorAll('.descricao-wrapper').forEach(avaliarWrapper);
  }

  function alternarDescricao(wrapper) {
    const botao = botaoDoWrapper(wrapper);
    if (!botao) return;
    const estaExpandida = wrapper.classList.contains('descricao-expandida');

    if (estaExpandida) {
      wrapper.classList.remove('descricao-expandida');
      wrapper.classList.add('descricao-recolhida');
      botao.textContent = '+ detalhes';
      botao.setAttribute('aria-expanded', 'false');
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      wrapper.classList.remove('descricao-recolhida');
      wrapper.classList.add('descricao-expandida');
      botao.textContent = '− mostrar menos';
      botao.setAttribute('aria-expanded', 'true');
    }
  }

  document.addEventListener('click', (ev) => {
    const botao = ev.target.closest && ev.target.closest('.botao-detalhes-descricao');
    if (!botao) return;
    const wrapper = botao.previousElementSibling;
    if (wrapper && wrapper.classList.contains('descricao-wrapper')) {
      alternarDescricao(wrapper);
    }
  });

  let temporizadorDescricao;
  window.addEventListener('resize', () => {
    clearTimeout(temporizadorDescricao);
    temporizadorDescricao = setTimeout(recalcularDescricoesInteligentes, 150);
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(recalcularDescricoesInteligentes);
  }

  window.preencherDescricaoInteligente = preencherDescricaoInteligente;
  window.recalcularDescricoesInteligentes = recalcularDescricoesInteligentes;
})();
