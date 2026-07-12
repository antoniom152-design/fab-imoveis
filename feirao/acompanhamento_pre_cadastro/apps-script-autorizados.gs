/**
 * WAL Imóveis — Feirão Online 2026
 * Backend do dashboard "acompanhamento-pre-cadastro.html"
 *
 * Responsável apenas pelas ESCRITAS na aba AUTORIZADOS da planilha
 * "Pre Cadastro 1 Feirao WAL" (conta wal@walservidor.com.br).
 * A LEITURA (INSCRITOS e AUTORIZADOS) é feita direto pelo HTML via
 * gvizJsonp, então este script não precisa de doGet.
 *
 * Estrutura esperada da aba AUTORIZADOS (crie estes cabeçalhos na linha 1):
 *   A: ID              (gerado automaticamente, formato AU0001)
 *   B: NOME
 *   C: CARGO           (Viabilizador/Ger. Imob. | Superintendente | Diretor | Gerente Comercial WAL)
 *   D: CONSTRUTORA
 *   E: PIN
 *   F: DATA_INCLUSAO
 *   G: DATA_ULTIMO_ACESSO
 *   H: STATUS          (Ativo | Desabilitado)  -- coluna adicionada além do que foi pedido,
 *                                                  necessária para o "desabilitar" funcionar
 *
 * COMO PUBLICAR:
 *   1) Extensões → Apps Script na planilha "Pre Cadastro 1 Feirao WAL"
 *      (o script usa SpreadsheetApp.openById(PLANILHA_ID), então funciona mesmo
 *      que o projeto não esteja vinculado a essa planilha especificamente —
 *      mas a conta que faz "Implantar" precisa ter acesso de edição ao arquivo)
 *   2) Cole este código, salve
 *   3) Implantar → Nova implantação → tipo "App da Web"
 *      Executar como: Eu (wal@walservidor.com.br)
 *      Quem pode acessar: Qualquer pessoa
 *   4) Copie a URL gerada (termina em /exec) e cole em APPS_SCRIPT_URL
 *      no topo do arquivo acompanhamento-pre-cadastro.html
 *   5) Se já existia uma implantação publicada, editar código sozinho NÃO basta:
 *      Implantar → Gerenciar implantações → ✏️ editar → Versão "Nova versão" → Implantar
 *      (senão a URL /exec continua rodando o código antigo)
 */

const PLANILHA_ID      = "1fSGrDRVBcoZUtz_4WLYWrNQn5-Vg-oafG7uH2ytJtx0"; // "Pre Cadastro 1 Feirao WAL" (conta wal@walservidor.com.br)
const ABA_AUTORIZADOS  = "AUTORIZADOS";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.tipo !== "autorizado") {
      return jsonOut({ ok: false, erro: "tipo não suportado" });
    }

    const ss = SpreadsheetApp.openById(PLANILHA_ID);
    const sheet = ss.getSheetByName(ABA_AUTORIZADOS);
    if (!sheet) return jsonOut({ ok: false, erro: "Aba AUTORIZADOS não encontrada" });

    switch (payload.operacao) {
      case "criar":       return jsonOut(criar(sheet, payload));
      case "excluir":     return jsonOut(excluir(sheet, payload));
      case "desabilitar": return jsonOut(mudarStatus(sheet, payload, "Desabilitado"));
      case "habilitar":   return jsonOut(mudarStatus(sheet, payload, "Ativo"));
      case "acesso":      return jsonOut(registrarAcesso(sheet, payload));
      default:            return jsonOut({ ok: false, erro: "operação desconhecida" });
    }
  } catch (err) {
    return jsonOut({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function proximoId(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return "AU0001";
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat().filter(String);
  let max = 0;
  ids.forEach(id => {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return "AU" + String(max + 1).padStart(4, "0");
}

function criar(sheet, p) {
  if (!p.nome || !p.pin) return { ok: false, erro: "nome e pin são obrigatórios" };
  const id = proximoId(sheet);
  sheet.appendRow([
    id,
    p.nome,
    p.cargo || "",
    p.construtora || "",
    String(p.pin),
    new Date(),
    "",           // DATA_ULTIMO_ACESSO — vazio até o primeiro acesso
    "Ativo"
  ]);
  return { ok: true, id: id };
}

function encontrarLinhaPorId(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(id));
  return idx === -1 ? -1 : idx + 2; // +2 porque a busca ignora o cabeçalho e é 0-indexed
}

function excluir(sheet, p) {
  const linha = encontrarLinhaPorId(sheet, p.id);
  if (linha === -1) return { ok: false, erro: "autorizado não encontrado" };
  sheet.deleteRow(linha);
  return { ok: true };
}

function mudarStatus(sheet, p, novoStatus) {
  const linha = encontrarLinhaPorId(sheet, p.id);
  if (linha === -1) return { ok: false, erro: "autorizado não encontrado" };
  sheet.getRange(linha, 8).setValue(novoStatus); // coluna H = STATUS
  return { ok: true };
}

function registrarAcesso(sheet, p) {
  const last = sheet.getLastRow();
  if (last < 2) return { ok: false, erro: "nenhum autorizado cadastrado" };
  const pins = sheet.getRange(2, 5, last - 1, 1).getValues().flat(); // coluna E = PIN
  const idx = pins.findIndex(v => String(v) === String(p.pin));
  if (idx === -1) return { ok: false, erro: "pin não encontrado" };
  sheet.getRange(idx + 2, 7).setValue(new Date()); // coluna G = DATA_ULTIMO_ACESSO
  return { ok: true };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
