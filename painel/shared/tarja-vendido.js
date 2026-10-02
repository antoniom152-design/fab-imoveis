/* ═══ TARJA "100% VENDIDO" (pedido 106) ═══
   Componente compartilhado — mesma tarja em todas as telas que mostram
   a imagem de um empreendimento (index, imoveis, imovel, mapa, reserva,
   chat, painéis e admin).

   Controle: coluna "Vendido" (AB) da aba IMOVEISDISPONIVEIS, valor
   "Sim" = 100% vendido. Marcada pelo admin.html (Portfólio → editar
   imóvel → "100% Vendido") ou digitando "Sim" direto na planilha.

   A coluna é achada pelo NOME do cabeçalho (não pela posição), então se
   ela ainda não existir na planilha nada quebra — só ninguém aparece
   como vendido.

   Uso:
     const iv = WalVendido.indiceColuna(table);        // gviz table
     const vendido = WalVendido.daLinha(row, iv);      // true/false
     html = WalVendido.envolver(imgHtml, vendido);     // <img> → com tarja
     html = WalVendido.tarja(vendido, 'pequena');      // só a tarja (pai precisa de position)
     lista = WalVendido.ordenar(lista, item => item.vendido);  // vendidos no final
*/
(function () {
  if (window.WalVendido) return;

  var CSS =
    '.wal-vendido-wrap{position:relative;display:block;overflow:hidden}' +
    '.wal-vendido-wrap>img{display:block}' +
    '.wal-vendido-wrap.mini{display:inline-block;vertical-align:middle}' +
    '.wal-vendido-pai{position:relative;overflow:hidden}' +
    '.wal-tarja-vendido{position:absolute;left:-25%;right:-25%;top:50%;' +
      'transform:translateY(-50%) rotate(-12deg);z-index:4;pointer-events:none;' +
      'background:rgba(200,16,46,.93);color:#fff;text-align:center;' +
      'font-family:Arial,Helvetica,sans-serif;font-weight:900;letter-spacing:.14em;' +
      'font-size:18px;line-height:1;padding:9px 0;white-space:nowrap;' +
      'border-top:2px solid rgba(255,255,255,.85);border-bottom:2px solid rgba(255,255,255,.85);' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35);text-shadow:0 1px 2px rgba(0,0,0,.35)}' +
    '.wal-tarja-vendido.pequena{font-size:10px;padding:5px 0;letter-spacing:.08em;border-width:1px}' +
    '.wal-tarja-vendido.mini{left:0;right:0;transform:translateY(-50%);font-size:5.5px;padding:2px 0;letter-spacing:0;border-width:1px;box-shadow:none}' +
    '.wal-tarja-vendido.grande{font-size:34px;padding:16px 0;border-width:3px}' +
    '@media(max-width:600px){.wal-tarja-vendido.grande{font-size:22px;padding:11px 0}}';

  function injetarCss() {
    if (document.getElementById('wal-tarja-vendido-css')) return;
    var st = document.createElement('style');
    st.id = 'wal-tarja-vendido-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  injetarCss();

  function ehVendido(v) {
    if (v === true) return true;
    return /^(sim|true|s|x|vendido|100%)$/i.test(String(v == null ? '' : v).trim());
  }

  function indiceColuna(table) {
    if (!table || !table.cols) return -1;
    for (var i = 0; i < table.cols.length; i++) {
      var lbl = String(table.cols[i].label || '').trim().toLowerCase();
      if (lbl === 'vendido' || lbl === '100% vendido') return i;
    }
    return -1;
  }

  function daLinha(row, indice) {
    if (indice < 0 || !row || !row.c) return false;
    var c = row.c[indice];
    return !!c && ehVendido(c.v != null ? c.v : c.f);
  }

  // tamanho: '' (padrão, cards) | 'pequena' (miniaturas) | 'mini' (ícone de tabela) | 'grande' (imagem principal)
  function tarja(vendido, tamanho) {
    return vendido ? '<div class="wal-tarja-vendido' + (tamanho ? ' ' + tamanho : '') + '">100% VENDIDO</div>' : '';
  }

  function envolver(imgHtml, vendido, tamanho) {
    if (!vendido) return imgHtml;
    return '<div class="wal-vendido-wrap' + (tamanho === 'mini' ? ' mini' : '') + '">' + imgHtml + tarja(true, tamanho) + '</div>';
  }

  // Para uma <img> que já existe na página (modal de detalhe etc.): embrulha
  // e põe a tarja se vendido; desfaz se não (o mesmo modal é reaberto pra
  // empreendimentos diferentes).
  function aplicarEmImg(img, vendido, tamanho) {
    if (!img || !img.parentNode) return;
    var pai = img.parentNode;
    var embrulhada = pai.classList && pai.classList.contains('wal-vendido-wrap');
    if (vendido && !embrulhada) {
      var wrap = document.createElement('div');
      wrap.className = 'wal-vendido-wrap';
      // herda o espaçamento/arredondamento da própria <img>
      var cs = window.getComputedStyle(img);
      wrap.style.marginBottom = cs.marginBottom; wrap.style.borderRadius = cs.borderRadius;
      img.style.marginBottom = '0';
      pai.insertBefore(wrap, img);
      wrap.appendChild(img);
      wrap.insertAdjacentHTML('beforeend', tarja(true, tamanho));
    } else if (!vendido && embrulhada) {
      img.style.marginBottom = '';
      pai.parentNode.insertBefore(img, pai);
      pai.parentNode.removeChild(pai);
    }
  }

  // Ordenação estável: mantém a ordem original entre os disponíveis e
  // entre os vendidos, só move os vendidos pro final.
  function ordenar(lista, fnVendido) {
    return (lista || []).map(function (item, i) { return { item: item, i: i, v: fnVendido(item) ? 1 : 0 }; })
      .sort(function (a, b) { return a.v - b.v || a.i - b.i; })
      .map(function (x) { return x.item; });
  }

  window.WalVendido = {
    ehVendido: ehVendido,
    indiceColuna: indiceColuna,
    daLinha: daLinha,
    tarja: tarja,
    envolver: envolver,
    aplicarEmImg: aplicarEmImg,
    ordenar: ordenar,
    injetarCss: injetarCss
  };
})();
