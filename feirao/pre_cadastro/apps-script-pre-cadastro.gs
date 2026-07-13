/**
 * WAL Imóveis — Feirão Online 2026
 * Apps Script "Pre Cadastro do Feirao"
 * Backend do formulário "pre-cadastro-feirao.html" — grava cada envio como
 * uma nova linha na aba INSCRITOS da planilha "Pre Cadastro 1 Feirao WAL"
 * (conta wal@walservidor.com.br).
 *
 * Mapeamento por NOME de cabeçalho (linha 1 da aba INSCRITOS), não por
 * posição de coluna — por isso, para adicionar um campo novo, basta:
 *   1) Criar a coluna com o cabeçalho correspondente na aba INSCRITOS
 *   2) Adicionar a chave em valoresPorColuna abaixo
 *
 * COMO PUBLICAR/ATUALIZAR:
 *   Implantar → Gerenciar implantações → ✏️ editar → Versão "Nova versão" → Implantar
 *   (a URL .../exec não muda, então nada precisa ser alterado no HTML)
 */

const ABA_INSCRITOS = 'INSCRITOS';

function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(ABA_INSCRITOS);
    if(!sh) throw new Error('Aba "'+ABA_INSCRITOS+'" não encontrada');

    const ultimaColuna = sh.getLastColumn();
    const headers = sh.getRange(1,1,1,ultimaColuna).getValues()[0].map(h => String(h).trim().toUpperCase());

    const novoId = 'PC' + String(sh.getLastRow()).padStart(4,'0');
    const autoriza = body.autorizaContato === true ? 'Sim' : (body.autorizaContato === false ? 'Não' : (body.autorizaContato || ''));

    const valoresPorColuna = {
      'ID': novoId,
      'DATA_INCLUSAO': body.dataCadastro || new Date().toISOString(),
      'NOME': body.nome || '',
      'WHATSAPP': body.whatsapp || '',
      'EMAIL': body.email || '',
      'INSTITUICAO': body.categoria || '',
      'REGIAO_INTERESSE': body.regiao || '',
      'TEM_FGTS': body.fgts || '',
      'AUTORIZA_CONTATO': autoriza,
      'CPF': '',
      'VOCE_E': '',
      'CODIGO_AGENTE': body.codigoAgente || ''
    };

    const linha = headers.map(h => valoresPorColuna.hasOwnProperty(h) ? valoresPorColuna[h] : '');
    sh.appendRow(linha);
  } catch(err){
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}
