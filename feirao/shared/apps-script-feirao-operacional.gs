/* ══════════════════════════════════════════════════════════════════════
   WAL FEIRÃO — API CENTRAL (Apps Script)
   ════════════════════════════════════════════════════════════════════════
   Backend único para os 7 dashboards do Feirão Online 2026. Fusão de:
     - "Apps Script WAL Feirao - Operacional.gs" (versão mais madura, tinha
       login/simulação/crédito/agendamento/mensagem/chat/pix/pagamento reais)
     - "apps-script-feirao-operacional.gs" antigo (só tinha a Torre de
       Controle — feirao_resumo / feirao_get_controle / feirao_set_controle)
   + todas as ações novas de Viabilizador/Atendente/Agente/Diretor que
   faltavam, + login por e-mail com código OTP, + autorização por PIN
   no servidor (authPin) nas ações sensíveis.

   Ver: feirao/materiais/documentacao-tecnica-banco-de-dados.html para o
   dicionário de dados e o contrato de integração completo.

   ────────────────────────────────────────────────────────────────────
   COMO IMPLANTAR (só o humano consegue fazer estes passos)
   ────────────────────────────────────────────────────────────────────
   1. Crie uma planilha nova no Google Sheets chamada
      "WAL Feirão — Dados Operacionais" e copie o ID dela (está na URL,
      entre /d/ e /edit) para PLANILHA_FEIRAO_ID logo abaixo.
   2. Nessa planilha: Extensões → Apps Script, apague o Code.gs padrão e
      cole este arquivo inteiro.
   3. No editor do Apps Script, rode a função `setupPlanilhaFeirao` uma
      vez (menu Executar → selecione a função → Executar). Isso cria
      todas as abas com cabeçalho.
   4. Crie uma conta no Brevo (brevo.com, plano grátis serve), verifique
      um remetente e autentique o domínio (SPF/DKIM/DMARC — o Brevo gera
      os registros DNS prontos). Gere uma API key e cole-a nas
      Propriedades do Script deste projeto (⚙️ Configurações do projeto →
      Propriedades do script → BREVO_API_KEY = sua chave). NUNCA cole a
      chave direto no código-fonte. Ajuste também `BREVO_SENDER_EMAIL`/
      `BREVO_SENDER_NOME` logo abaixo se o remetente for diferente.
      (Motivo: contas novas do Google Workspace bloqueiam envio de
      e-mail automatizado — MailApp/GmailApp — por semanas até acumular
      faturamento + tempo de conta paga; o Brevo contorna isso.)
   5. Rode `criarTriggerNotificacoes` uma vez (instala o gatilho a cada
      1 min que envia os e-mails da fila — inclui os códigos OTP de
      login do Lead). Na primeira vez que `processarFilaNotificacoes`
      rodar (mesmo via gatilho), pode ser preciso autorizar manualmente
      uma vez (Executar → selecione a função → Executar → aceite a
      permissão "Conectar a um serviço externo") — gatilhos automáticos
      não conseguem pedir autorização sozinhos.
   6. Implantar → Nova implantação → Tipo "Aplicativo da Web":
        Executar como: Eu
        Quem pode acessar: Qualquer pessoa
      Copie a URL gerada (termina em /exec).
   7. Cole essa URL em `FEIRAO_API_URL` (e em `WAL_CONTROLE_API_URL`,
      que é a mesma URL) nos arquivos:
        dashboard-diretor-wal.html, dashboard-feirao-lead.html,
        dashboard-feirao-atendente.html, dashboard-viabilizador-wal.html,
        dashboard-agente.html, pre-cadastro-feirao.html
      (isso é feito nas Fases B/C/D deste projeto — eu edito os arquivos,
      só a URL em si depende de você ter feito os passos 1-5 primeiro).
   8. Sempre que editar este código depois de já ter implantado uma vez:
      Implantar → Gerenciar implantações → ✏️ editar → Versão "Nova
      versão" → Implantar (senão a URL /exec continua rodando o código
      antigo).
   9. Troque os PINs de exemplo abaixo (PIN_DIRETORIA_TORRE,
      PIN_GERENTE_ATENDIMENTO) por valores só seus antes de divulgar
      qualquer link.

   ────────────────────────────────────────────────────────────────────
   MODELO DE AUTORIZAÇÃO (authPin)
   ────────────────────────────────────────────────────────────────────
   Toda ação de escrita sensível (suspender o Feirão, decidir crédito,
   ler dados bancários de agente, editar empreendimento/unidade, etc.)
   exige um campo `authPin` no payload, validado no SERVIDOR contra:
     - PIN_DIRETORIA_TORRE (fixo, papel 'diretor_torre')
     - PIN_GERENTE_ATENDIMENTO (fixo, papel 'gerente_atendimento')
     - aba ATENDENTES desta planilha (papel 'atendente', só se Ativo)
     - aba AUTORIZADOS da planilha "Pre Cadastro 1 Feirao WAL" (papéis
       'viabilizador' / 'superintendente' / 'diretor_operacional',
       coluna CARGO, já com CONSTRUTORA associada — mesma aba que
       acompanhamento-pre-cadastro.html já usa)
   Isso fecha o buraco de segurança de antes: sem isso, qualquer pessoa
   que lesse o código-fonte da página descobria a URL do Apps Script e
   podia chamar qualquer ação diretamente (o PIN era só decoração no
   HTML, nunca checado no servidor).
   ════════════════════════════════════════════════════════════════════ */

/* ─── CONFIGURAÇÃO ────────────────────────────────────────────────── */
var PLANILHA_FEIRAO_ID       = '1jMV3Yg5HzyETgYMBif9CJs4FprTQjEzilFdVE0XhlQ8';

// Planilha "Pre Cadastro 1 Feirao WAL" (abas INSCRITOS e AUTORIZADOS) —
// já em produção, ID confirmado. Usada aqui para: (a) fail-soft no login
// do Lead por e-mail, e (b) validar PIN de Viabilizador/Superintendente/
// Diretor operacional (papel + construtora) direto da aba AUTORIZADOS.
var PLANILHA_PRECADASTRO_ID  = '1fSGrDRVBcoZUtz_4WLYWrNQn5-Vg-oafG7uH2ytJtx0';
var ABA_INSCRITOS            = 'INSCRITOS';
var ABA_AUTORIZADOS          = 'AUTORIZADOS';

// Planilha principal de leads (já em produção) — só para espelhar a
// simulação na aba SIMULACOES genérica que index.html/simulador.html
// já leem. Nunca bloqueia a resposta principal se falhar.
var PLANILHA_PRINCIPAL_ID    = '1UKSyzkYpVxtsSb4UrBvgslp7FFXtYk8DUeqJVGzk0M0';
var ABA_SIMULACOES_GERAL     = 'SIMULACOES';

/* Abas da planilha WAL Feirão — Dados Operacionais */
var ABA_PARTICIPANTES   = 'PARTICIPANTES';
var ABA_OTP             = 'OTP_CODES';
var ABA_JORNADA         = 'JORNADA_EVENTOS';
var ABA_SIMULACOES_FEIR = 'SIMULACOES_FEIRAO';
var ABA_CREDITO         = 'ANALISES_CREDITO';
var ABA_CONTRATOS       = 'CONTRATOS';
var ABA_VISITAS_AGENDA  = 'AGENDAMENTOS_VISITA';
var ABA_MENSAGENS       = 'MENSAGENS_CONSULTOR';
var ABA_CHAT            = 'CHAT_MENSAGENS';
var ABA_PIX             = 'RESERVAS_PIX_FEIRAO';
var ABA_PAGAMENTO       = 'FLUXO_PAGAMENTO';
var ABA_FLUXOS_SALVOS   = 'FLUXOS_PAGAMENTO_SALVOS';
var ABA_CONSTRUTORAS    = 'CONSTRUTORAS';
var ABA_EMPREENDIMENTOS = 'EMPREENDIMENTOS';
var ABA_UNIDADES        = 'UNIDADES';
var ABA_SOLICITACOES    = 'SOLICITACOES_VIABILIZADOR';
var ABA_RESERVAS        = 'RESERVAS';
var ABA_ESCALONAMENTOS  = 'ESCALONAMENTOS';
var ABA_ATENDENTES      = 'ATENDENTES';
var ABA_AGENTES         = 'AGENTES';
var ABA_AGENTES_BANCO   = 'AGENTES_DADOS_BANCARIOS';
var ABA_COMISSOES       = 'COMISSOES';
var ABA_INDICACOES      = 'INDICACOES';
var ABA_CONTROLE        = 'CONTROLE';
var ABA_LOG_SENSIVEL    = 'LOG_ACESSO_SENSIVEL';
var ABA_FILA            = 'FILA_NOTIFICACOES';
var ABA_CONFIG          = 'CONFIG';

var PASTA_DRIVE_DOCS_ID = ''; // opcional — se vazio, cria/usa a pasta "WAL Feirão — Documentos Crédito"
var EMAIL_EQUIPE_FEIRAO = 'wal.imoveiseconsultoria@gmail.com';
// E-mail comercial para onde vão os documentos de Análise de Crédito e os
// pedidos de Chave PIX quando a construtora ainda não tem uma cadastrada.
var EMAIL_COMERCIAL_FEIRAO = 'comercial@walservidor.com.br';
var TZ = 'America/Sao_Paulo';

// PINs fixos de papéis que não vêm de planilha (troque antes de publicar).
var PIN_DIRETORIA_TORRE      = '2026'; // mesmo PIN de dashboard-diretor-wal.html
var PIN_GERENTE_ATENDIMENTO  = '9090'; // mesmo PIN de dashboard-feirao-atendente.html
var NOME_GERENTE_ATENDIMENTO = 'Waldyr Gomes';

// Vocabulário único de status do funil (ver documentacao-tecnica-banco-de-dados.html §2)
var ETAPAS_FUNIL = ['novo', 'contato', 'proposta_analise', 'reserva', 'assinatura', 'fechado', 'perdido'];
/* Status de UNIDADE (aba UNIDADES) — união dos vocabulários dos dois
   dashboards que gravam unidades: o do Atendente/Gerente (interesse/
   proposta/reserva/assinatura/indisponivel) e o do Viabilizador
   (disponivel/reservada/vendida/indisponivel). Unidade não é funil de
   lead, por isso não usa ETAPAS_FUNIL. */
var STATUS_UNIDADE = ['disponivel', 'interesse', 'proposta', 'reserva', 'reservada', 'assinatura', 'vendida', 'indisponivel'];
var SUBSTATUS_CREDITO = ['enviado', 'em_analise', 'aprovado', 'reprovado'];

/* ─── SETUP ───────────────────────────────────────────────────────── */
function setupPlanilhaFeirao() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);

  criarAbaSeNaoExiste_(ss, ABA_PARTICIPANTES, [
    'Email', 'Nome', 'CPF', 'WhatsApp', 'Vinculo', 'CRM_Lead_Id',
    'Emp_Selecionado', 'Unidade_Selecionada', 'Etapa_Funil',
    'Criado_em', 'Atualizado_em', 'Atendente_Id', 'Prioridade', 'Origem'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_OTP, [
    'Email', 'Codigo', 'Expira_em', 'Verificado', 'Session_Token', 'Session_Expira_em', 'Criado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_JORNADA, ['Email', 'Evento_Key', 'Detalhe', 'Timestamp']);

  criarAbaSeNaoExiste_(ss, ABA_SIMULACOES_FEIR, [
    'Email', 'Nome', 'Emp_Id', 'Valor_Imovel', 'Entrada', 'Prazo',
    'Taxa', 'Sistema_Escolhido', 'Encargo_SAC', 'Encargo_Price',
    'Encargo_CFIAe', 'Encargo_POUPEX', 'Timestamp'
  ]);

  var abaCred = criarAbaSeNaoExiste_(ss, ABA_CREDITO, [
    'Protocolo', 'Email', 'CPF', 'Nome', 'Telefone', 'Estado_Civil',
    'Conjuge_Nome', 'Emp_Id', 'Unidade', 'Documentos_JSON', 'Sub_Status',
    'Valor_Aprovado', 'Entrada_Minima', 'Taxa', 'Data_Envio',
    'Data_Limite', 'Data_Liberacao', 'Consultor', 'Parecer'
  ]);
  abaCred.getRange('K2:K999').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SUBSTATUS_CREDITO, true).setAllowInvalid(true).build());

  criarAbaSeNaoExiste_(ss, ABA_CONTRATOS, [
    'Protocolo', 'Email', 'Nome', 'Emp_Id', 'Unidade', 'Solicitado_em',
    'Enviado', 'Enviado_em', 'Assinado', 'Assinado_em', 'Cobranca_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_VISITAS_AGENDA, [
    'Email', 'Nome', 'Telefone', 'Emp_Id', 'Emp_Nome', 'Data', 'Horario',
    'Pessoas', 'Formato', 'Observacoes', 'Status', 'Timestamp'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_MENSAGENS, [
    'Email', 'Nome', 'Telefone', 'Assunto', 'Mensagem',
    'Timestamp', 'Status', 'Resposta', 'Respondido_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_CHAT, ['Email', 'Nome', 'Remetente', 'Texto', 'Timestamp', 'Lida']);

  criarAbaSeNaoExiste_(ss, ABA_PIX, [
    'Email', 'Nome', 'Emp_Id', 'Emp_Nome', 'Unidade', 'Valor', 'Status',
    'Data_Pagamento', 'Timestamp'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_PAGAMENTO, [
    'Email', 'Emp_Id', 'Unidade', 'Estado_JSON', 'Progresso_Pct', 'Atualizado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_CONSTRUTORAS, [
    'ID', 'Nome', 'Telefone', 'Site', 'Viabilizador', 'Telefone_Viabilizador',
    'Comissao_%', 'Link_Drive', 'Data_Inclusao', 'Estados_de_Atuacao',
    'Cidades_de_Atuacao', 'Observacoes', 'Ativa', 'Chave_PIX'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_EMPREENDIMENTOS, [
    'Id', 'Nome', 'Construtora_ID', 'Construtora', 'Bairro', 'Cidade', 'UF', 'Tipo_Imovel',
    'Entrega', 'Entrada', 'Sinal', 'Condicoes', 'Cond_Feirao', 'Criado_em',
    'Descricao_do_Imovel', 'Tipologia', 'Faixa_de_Valor', 'Valor_a_Partir_De',
    'Qtd_Unidades', 'Data_Cadastro', 'URL_da_Imagem', 'Link_Drive', 'Link_Blogger',
    'Destaque_Pagina_Principal', 'Obs_Interna', 'Ativo'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_UNIDADES, [
    'Id', 'Emp_Id', 'Bloco_Torre', 'Unidade', 'Tipologia', 'Valor', 'Status', 'Atualizado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_SOLICITACOES, [
    'Id', 'Tipo', 'Emp_Id', 'Atendente_Nome', 'Email_Lead', 'Descricao',
    'Valor', 'Status', 'Parecer', 'Criado_em', 'Respondido_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_RESERVAS, [
    'Id', 'Email_Lead', 'Cliente_Nome', 'Cliente_CPF', 'Cliente_Telefone',
    'Orgao', 'Patente', 'Renda_Declarada', 'Renda_Conjuge', 'Atendente_Id',
    'Emp_Nome', 'Unidade_Desc', 'Valor_Unidade', 'Valor_Sinal', 'Status',
    'Parecer_Viabilizador', 'Parecer_Data', 'Email_Enviado',
    'Docs_Cliente_JSON', 'Conjuge_JSON', 'Criado_em', 'Atualizado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_ESCALONAMENTOS, [
    'Id', 'Emp_Id', 'Tipo', 'Descricao', 'Valor', 'Status', 'Criado_em', 'Despacho', 'Despacho_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_ATENDENTES, ['Id', 'Nome', 'WhatsApp', 'Pin', 'Ativo', 'Criado_em']);

  criarAbaSeNaoExiste_(ss, ABA_AGENTES, [
    'Id', 'Nome', 'Email', 'CPF', 'WhatsApp', 'Nascimento', 'Profissao',
    'Senha_Hash', 'Status', 'Habilitado', 'Criado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_AGENTES_BANCO, [
    'Agente_Id', 'Banco', 'Agencia', 'Conta', 'Tipo_Conta', 'Pix', 'Atualizado_em'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_COMISSOES, [
    'Id', 'Tipo', 'Pessoa_Id', 'Pessoa_Nome', 'Cliente', 'Emp_Id', 'Valor', 'Status', 'Data'
  ]);

  criarAbaSeNaoExiste_(ss, ABA_INDICACOES, [
    'Id', 'Agente_Id', 'Nome_Cliente', 'Telefone', 'Email', 'Emp_Id',
    'Orcamento', 'Interesse', 'Status', 'Criado_em'
  ]);

  var abaControle = criarAbaSeNaoExiste_(ss, ABA_CONTROLE, ['Chave', 'Valor']);
  if (abaControle.getLastRow() < 2) {
    abaControle.appendRow(['estado', JSON.stringify({
      fairStatus: 'nao_iniciado', motivo: '', mensagem: '',
      modulos: { precadastro: true, lead: true, atendente: true, viabilizador: true, agente: true },
      autor: '', ts: new Date().toISOString()
    })]);
  }

  criarAbaSeNaoExiste_(ss, ABA_LOG_SENSIVEL, ['Timestamp', 'Quem', 'Acao', 'Alvo']);
  criarAbaSeNaoExiste_(ss, ABA_FILA, ['Tipo', 'Destinatario', 'Payload_JSON', 'Processado', 'Criado_em']);

  var abaConfig = criarAbaSeNaoExiste_(ss, ABA_CONFIG, ['Chave', 'Valor']);
  if (abaConfig.getLastRow() < 2) abaConfig.appendRow(['Negocios_Fechados_Base', 0]);

  avisar_(
    '✅ Planilha do Feirão configurada!\n\n' +
    'Próximos passos:\n' +
    '1. Rode "criarTriggerNotificacoes" uma vez.\n' +
    '2. Implante como Aplicativo da Web (Executar como Eu, Acesso: Qualquer pessoa).\n' +
    '3. Cole a URL gerada em FEIRAO_API_URL nos dashboards.'
  );
}

function criarAbaSeNaoExiste_(ss, nome, headers) {
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(headers);
    aba.getRange(1, 1, 1, headers.length).setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, headers.length).protect().setWarningOnly(true);
  }
  return aba;
}

/* Mostra pop-up quando há interface (menu da planilha); no editor ou em
   contexto sem UI, cai no Registro de execução (Logger) em vez de quebrar. */
function avisar_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

/* Migração da Fase 1 (dashboard do atendente conectado à planilha).
   Idempotente — pode rodar quantas vezes precisar (só cria o que falta):
   1. Acrescenta as colunas Atendente_Id / Prioridade / Origem em PARTICIPANTES.
   2. Cria a aba RESERVAS.
   3. Semeia a aba ATENDENTES com os 4 atendentes demo (PINs 1111–4444)
      caso ela esteja vazia — mesmos PINs demo dos dashboards.
   O resultado aparece em pop-up (menu da planilha) ou no Registro de
   execução (editor). Se algo falhar, o erro real fica no Registro. */
function setupFase1() {
  try {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var relatorio = [];

    var abaPart = ss.getSheetByName(ABA_PARTICIPANTES);
    if (!abaPart) {
      relatorio.push('ATENÇÃO: aba PARTICIPANTES não existe — rode setupPlanilhaFeirao() primeiro.');
    } else {
      var headers = abaPart.getRange(1, 1, 1, abaPart.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
      ['Atendente_Id', 'Prioridade', 'Origem'].forEach(function (col) {
        if (headers.indexOf(col) === -1) {
          abaPart.getRange(1, abaPart.getLastColumn() + 1).setValue(col)
            .setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
          headers.push(col);
          relatorio.push('PARTICIPANTES: coluna ' + col + ' criada.');
        } else {
          relatorio.push('PARTICIPANTES: coluna ' + col + ' já existia.');
        }
      });
    }

    criarAbaSeNaoExiste_(ss, ABA_RESERVAS, [
      'Id', 'Email_Lead', 'Cliente_Nome', 'Cliente_CPF', 'Cliente_Telefone',
      'Orgao', 'Patente', 'Renda_Declarada', 'Renda_Conjuge', 'Atendente_Id',
      'Emp_Nome', 'Unidade_Desc', 'Valor_Unidade', 'Valor_Sinal', 'Status',
      'Parecer_Viabilizador', 'Parecer_Data', 'Email_Enviado',
      'Docs_Cliente_JSON', 'Conjuge_JSON', 'Criado_em', 'Atualizado_em'
    ]);
    relatorio.push('Aba RESERVAS verificada/criada.');

    var abaAt = ss.getSheetByName(ABA_ATENDENTES);
    if (abaAt && abaAt.getLastRow() < 2) {
      [
        ['AT0001', 'Ana Paula Ribeiro', '21987650001', '1111', true, agora_()],
        ['AT0002', 'Carlos Menezes',    '21987650002', '2222', true, agora_()],
        ['AT0003', 'Fernanda Souza',    '21987650003', '3333', true, agora_()],
        ['AT0004', 'Bruno Castro',      '21987650004', '4444', true, agora_()]
      ].forEach(function (linha) { abaAt.appendRow(linha); });
      relatorio.push('ATENDENTES: 4 atendentes demo semeados (PINs 1111–4444).');
    } else if (abaAt) {
      relatorio.push('ATENDENTES: já tinha ' + (abaAt.getLastRow() - 1) + ' linha(s) — nada semeado.');
    }

    var msg = '✅ Migração Fase 1 concluída!\n\n' + relatorio.join('\n');
    Logger.log(msg);
    avisar_(msg);
  } catch (err) {
    Logger.log('setupFase1 ERRO: ' + err.message + '\n' + (err.stack || ''));
    throw err;
  }
}

/* Só CONFERE (não altera nada): mostra no Registro de execução se as
   colunas, a aba RESERVAS e os atendentes da Fase 1 estão no lugar. */
function verificarFase1() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var out = [];
  var abaPart = ss.getSheetByName(ABA_PARTICIPANTES);
  var headers = abaPart ? abaPart.getRange(1, 1, 1, abaPart.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  ['Atendente_Id', 'Prioridade', 'Origem'].forEach(function (col) {
    out.push('PARTICIPANTES.' + col + ': ' + (headers.indexOf(col) !== -1 ? 'OK' : 'FALTA'));
  });
  out.push('Aba RESERVAS: ' + (ss.getSheetByName(ABA_RESERVAS) ? 'OK' : 'FALTA'));
  var abaAt = ss.getSheetByName(ABA_ATENDENTES);
  out.push('ATENDENTES: ' + (abaAt ? Math.max(abaAt.getLastRow() - 1, 0) : 0) + ' linha(s) cadastrada(s)');
  var msg = 'Verificação Fase 1:\n' + out.join('\n');
  Logger.log(msg);
  avisar_(msg);
}

/* criarAbaSeNaoExiste_ só grava os cabeçalhos na primeira vez que a aba é
   criada — numa aba que já existia antes desta mudança (como CONSTRUTORAS),
   a coluna nova não aparece sozinha só de publicar o .gs. Rode esta função
   uma vez pelo editor (▶ Executar → selecione adicionarColunaChavePix →
   Executar) para criar a coluna Chave_PIX em CONSTRUTORAS. Depois é só
   preencher a chave PIX de cada construtora nessa coluna, na planilha. */
function adicionarColunaChavePix() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CONSTRUTORAS);
  if (!aba) { avisar_('Aba CONSTRUTORAS não existe — rode setupPlanilhaFeirao() primeiro.'); return; }
  var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.indexOf('Chave_PIX') !== -1) { avisar_('A coluna Chave_PIX já existe em CONSTRUTORAS — nada a fazer.'); return; }
  aba.getRange(1, aba.getLastColumn() + 1).setValue('Chave_PIX')
    .setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
  avisar_('Coluna Chave_PIX criada em CONSTRUTORAS! Agora preencha a chave PIX de cada construtora nessa coluna, na planilha.');
}

/* Mesmo motivo do adicionarColunaChavePix acima — PARTICIPANTES já existia
   antes desta mudança, então a coluna nova não aparece sozinha só de
   publicar o .gs. Rode uma vez pelo editor (▶ Executar →
   adicionarColunaFavoritos → Executar). */
function adicionarColunaFavoritos() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_PARTICIPANTES);
  if (!aba) { avisar_('Aba PARTICIPANTES não existe — rode setupPlanilhaFeirao() primeiro.'); return; }
  var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.indexOf('Empreendimentos_Favoritos') !== -1) { avisar_('A coluna Empreendimentos_Favoritos já existe em PARTICIPANTES — nada a fazer.'); return; }
  aba.getRange(1, aba.getLastColumn() + 1).setValue('Empreendimentos_Favoritos')
    .setBackground('#0A1628').setFontColor('#C9A84C').setFontWeight('bold');
  avisar_('Coluna Empreendimentos_Favoritos criada em PARTICIPANTES!');
}

function criarTriggerNotificacoes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processarFilaNotificacoes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processarFilaNotificacoes').timeBased().everyMinutes(1).create();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Feirão WAL')
    .addItem('Configurar planilha (1ª vez)', 'setupPlanilhaFeirao')
    .addItem('Migração Fase 1 — dashboard do atendente (1ª vez)', 'setupFase1')
    .addItem('Verificar migração Fase 1 (só confere)', 'verificarFase1')
    .addItem('Adicionar coluna Chave_PIX em CONSTRUTORAS (1ª vez)', 'adicionarColunaChavePix')
    .addItem('Adicionar coluna Favoritos em PARTICIPANTES (1ª vez)', 'adicionarColunaFavoritos')
    .addItem('Instalar gatilho de notificações (1ª vez)', 'criarTriggerNotificacoes')
    .addSeparator()
    .addItem('Aprovar Crédito (protocolo)...', 'aprovarCreditoMenu')
    .addToUi();
}

/* ─── UTILITÁRIOS ─────────────────────────────────────────────────── */
function agora_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function s_(v) { return (v === null || v === undefined) ? '' : String(v); }
function limparDoc_(v) { return s_(v).replace(/\D/g, ''); }
function normalizarEmail_(v) { return s_(v).trim().toLowerCase(); }

function jsonOut_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function jsonpOut_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) body = callback + '(' + body + ')';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* Executa fn() protegido por lock — usado em toda operação
   "achar linha → atualizar" para evitar corrida entre requisições
   simultâneas. Nunca envolve chamadas lentas (e-mail/WhatsApp/Drive) —
   só o read-modify-write da planilha. */
function comLock_(fn) {
  var lock = LockService.getScriptLock();
  var ok = lock.tryLock(10000);
  try { return fn(); } finally { if (ok) lock.releaseLock(); }
}

function lerAbaObjetos_(aba) {
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return [];
  var headers = dados[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    if (linha.every(function (c) { return c === '' || c === null || c === undefined; })) continue;
    var obj = { _row: i + 1 };
    headers.forEach(function (h, idx) { obj[h] = linha[idx]; });
    out.push(obj);
  }
  return out;
}

function acharLinhaPorChave_(aba, header, valor) {
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return -1;
  var headers = dados[0].map(function (h) { return String(h).trim(); });
  var col = headers.indexOf(header);
  if (col === -1) return -1;
  var alvo = s_(valor).trim().toLowerCase();
  for (var i = 1; i < dados.length; i++) {
    if (s_(dados[i][col]).trim().toLowerCase() === alvo) return i + 1;
  }
  return -1;
}

function gerarId_(aba, prefixo) {
  var ids = aba.getDataRange().getValues().slice(1).map(function (r) { return String(r[0] || ''); });
  var max = 0;
  ids.forEach(function (id) {
    var n = parseInt(id.replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefixo + String(max + 1).padStart(4, '0');
}

function gerarToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function registrarLogSensivel_(quem, acao, alvo) {
  try {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    ss.getSheetByName(ABA_LOG_SENSIVEL).appendRow([agora_(), quem, acao, alvo]);
  } catch (e) { Logger.log('registrarLogSensivel_ erro: ' + e.message); }
}

/* ══════════════════ AUTORIZAÇÃO (authPin) ═══════════════════════════
   Toda ação sensível chama autorizarAcao_(authPin, ['papel1','papel2'])
   e só prossegue se o retorno tiver ok:true. */
function autorizarAcao_(authPin, papeisPermitidos) {
  var pin = s_(authPin).trim();
  if (!pin) return { ok: false, erro: 'PIN de autorização obrigatório para esta ação.' };

  if (papeisPermitidos.indexOf('diretor_torre') !== -1 && pin === PIN_DIRETORIA_TORRE) {
    return { ok: true, papel: 'diretor_torre', nome: 'Diretoria' };
  }
  if (papeisPermitidos.indexOf('gerente_atendimento') !== -1 && pin === PIN_GERENTE_ATENDIMENTO) {
    return { ok: true, papel: 'gerente_atendimento', nome: NOME_GERENTE_ATENDIMENTO };
  }
  if (papeisPermitidos.indexOf('atendente') !== -1) {
    var at = acharAtendentePorPin_(pin);
    if (at) return { ok: true, papel: 'atendente', nome: at.Nome, id: at.Id };
  }
  var papeisConstrutora = ['viabilizador', 'superintendente', 'diretor_operacional'];
  if (papeisPermitidos.some(function (p) { return papeisConstrutora.indexOf(p) !== -1; })) {
    var au = acharAutorizadoPorPin_(pin);
    if (au && au.ok && papeisPermitidos.indexOf(au.papel) !== -1) return au;
  }
  return { ok: false, erro: 'PIN inválido ou sem permissão para esta ação.' };
}

function acharAtendentePorPin_(pin) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_ATENDENTES);
  var linhas = lerAbaObjetos_(aba);
  var achado = linhas.find(function (l) { return s_(l.Pin) === pin && l.Ativo === true; });
  return achado ? { Id: s_(achado.Id), Nome: s_(achado.Nome) } : null;
}

/* CARGO na aba AUTORIZADOS (planilha Pre Cadastro) → papel unificado */
var CARGO_PARA_PAPEL_ = {
  'Viabilizador/Ger. Imob.': 'viabilizador',
  'Superintendente': 'superintendente',
  'Diretor': 'diretor_operacional'
};

function acharAutorizadoPorPin_(pin) {
  try {
    var ss = SpreadsheetApp.openById(PLANILHA_PRECADASTRO_ID);
    var aba = ss.getSheetByName(ABA_AUTORIZADOS);
    if (!aba) return { ok: false };
    var linhas = lerAbaObjetos_(aba);
    var achado = linhas.find(function (l) { return s_(l.PIN) === pin; });
    if (!achado) return { ok: false };
    if (s_(achado.STATUS).toLowerCase().indexOf('desab') === 0) return { ok: false, erro: 'Acesso desabilitado.' };
    var papel = CARGO_PARA_PAPEL_[s_(achado.CARGO)];
    if (!papel) return { ok: false };
    return { ok: true, papel: papel, nome: s_(achado.NOME), construtora: s_(achado.CONSTRUTORA), id: s_(achado.ID) };
  } catch (e) {
    Logger.log('acharAutorizadoPorPin_ erro: ' + e.message);
    return { ok: false, erro: 'Falha ao consultar autorizados.' };
  }
}

/* ══════════════════ doGet — leituras (JSONP) ═══════════════════════ */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var callback = (e && e.parameter && e.parameter.callback) || '';
  var p = (e && e.parameter) || {};
  try {
    var result;
    switch (action) {
      case 'feirao_resumo':              result = { ok: true, dados: montarResumo_() }; break;
      case 'feirao_get_controle':        result = { ok: true, controle: lerControle_() }; break;
      case 'feirao_lista_participantes': result = feirao_listaParticipantes_(p); break;
      case 'feirao_login_verificar_codigo': result = feirao_loginVerificarCodigo_(p); break;
      case 'feirao_compartilhar_email':  result = feirao_compartilharEmail_(p); break;
      case 'feirao_status_credito':      result = feirao_statusCredito_(p.protocolo || ''); break;
      case 'feirao_listar_analises_credito': result = feirao_listarAnalisesCredito_(p); break;
      case 'feirao_listar_mensagens':     result = feirao_listarMensagens_(p); break;
      case 'feirao_mensagens_lead':       result = feirao_mensagensLead_(p.email || '', p.sessionToken || ''); break;
      case 'feirao_mensagem':            result = feirao_mensagem_(p); break;
      case 'feirao_listar_pix':          result = feirao_listarPix_(p); break;
      case 'feirao_status_contrato':     result = feirao_statusContrato_(p.email || '', p.sessionToken || '', p.authPin || ''); break;
      case 'feirao_simulacao_status':    result = feirao_simulacaoStatus_(p.email || '', p.sessionToken || '', p.authPin || ''); break;
      case 'feirao_pagamento_status':    result = feirao_pagamentoStatus_(p.email || '', p.sessionToken || '', p.authPin || ''); break;
      case 'feirao_fluxo_salvar':        result = feirao_fluxoSalvoCrud_(p); break;
      case 'feirao_favorito_toggle':      result = feirao_favoritoToggle_(Object.assign({}, p, { favoritos: (function(){ try { return JSON.parse(p.favoritos||'[]'); } catch(e){ return []; } })() })); break;
      case 'feirao_favoritos_lead':       result = feirao_favoritosLead_(p.email || '', p.sessionToken || ''); break;
      case 'feirao_listar_fluxos_salvos': result = feirao_listarFluxosSalvos_(p); break;
      case 'feirao_listar_agendamentos': result = feirao_listarAgendamentos_(p); break;
      case 'feirao_stats':               result = feirao_stats_(); break;
      case 'feirao_chat_buscar':         result = feirao_chatBuscar_(p.email || '', p.since || '', p.leitor || '', p.sessionToken || '', p.authPin || ''); break;
      case 'feirao_chat_threads':        result = feirao_chatThreads_(p); break;
      case 'feirao_listar_construtoras':  result = { ok: true, itens: feirao_listarConstrutoras_(p) }; break;
      case 'feirao_listar_empreendimentos': result = { ok: true, itens: feirao_listarEmpreendimentos_(p.construtoraId || p.construtora || '') }; break;
      case 'feirao_listar_unidades':     result = { ok: true, itens: feirao_listarUnidades_(p.empId || '') }; break;
      case 'feirao_listar_solicitacoes': result = feirao_listarSolicitacoes_(p); break;
      case 'feirao_listar_escalonamentos': result = feirao_listarEscalonamentos_(p); break;
      case 'feirao_listar_atendentes':   result = { ok: true, itens: feirao_listarAtendentesPublico_() }; break;
      case 'feirao_listar_atendentes_admin': result = feirao_listarAtendentesAdmin_(p); break;
      case 'feirao_listar_leads':        result = feirao_listarLeads_(p); break;
      case 'feirao_listar_reservas':     result = feirao_listarReservas_(p); break;
      case 'feirao_listar_agentes':      result = feirao_listarAgentes_(p); break;
      case 'feirao_agente_bancario':     result = feirao_agenteBancarioConsultar_(p); break;
      case 'feirao_listar_comissoes':    result = feirao_listarComissoes_(p); break;
      case 'feirao_login_construtora':   result = feirao_loginConstrutora_(p.pin || ''); break;
      case 'feirao_agente_login':        result = feirao_agenteCrud_({operacao:'login', email:p.email||'', senha:p.senha||''}); break;
      case 'feirao_login_atendente':     result = feirao_loginAtendente_(p.pin || ''); break;
      default:                           result = { ok: false, erro: 'Ação desconhecida: ' + action };
    }
    return jsonpOut_(callback, result);
  } catch (err) {
    return jsonpOut_(callback, { ok: false, erro: err.message });
  }
}

/* ══════════════════ doPost — escritas (no-cors, fire-and-forget) ═══ */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var out;
    switch (data.action) {
      case 'feirao_set_controle':            out = feirao_setControle_(data); break;
      case 'feirao_login_solicitar_codigo':  out = feirao_loginSolicitarCodigo_(data); break;
      case 'feirao_participante':            out = feirao_participante_(data); break;
      case 'feirao_evento':                  out = feirao_evento_(data); break;
      case 'feirao_simulacao':               out = feirao_simulacao_(data); break;
      case 'feirao_credito':                 out = feirao_credito_(data); break;
      case 'feirao_credito_decisao':         out = feirao_creditoDecisao_(data); break;
      case 'feirao_contrato_status':         out = feirao_contratoStatusEscrita_(data); break;
      case 'feirao_agendamento':             out = feirao_agendamento_(data); break;
      case 'feirao_mensagem_responder':      out = feirao_mensagemResponder_(data); break;
      case 'feirao_chat_enviar':             out = feirao_chatEnviar_(data); break;
      case 'feirao_pix':                     out = feirao_pix_(data); break;
      case 'feirao_pagamento':               out = feirao_pagamento_(data); break;
      case 'feirao_construtora':             out = feirao_construtoraCrud_(data); break;
      case 'feirao_empreendimento':          out = feirao_empreendimentoCrud_(data); break;
      case 'feirao_unidade':                 out = feirao_unidadeCrud_(data); break;
      case 'feirao_solicitacao_viabilizador': out = feirao_solicitacaoCrud_(data); break;
      case 'feirao_escalonamento':           out = feirao_escalonamentoCrud_(data); break;
      case 'feirao_atendente':               out = feirao_atendenteCrud_(data); break;
      case 'feirao_lead_status':             out = feirao_leadStatus_(data); break;
      case 'feirao_lead_atribuir':           out = feirao_leadAtribuir_(data); break;
      case 'feirao_reserva':                 out = feirao_reservaCrud_(data); break;
      case 'feirao_agente':                  out = feirao_agenteCrud_(data); break;
      case 'feirao_agente_bancario_definir': out = feirao_agenteBancarioDefinir_(data); break;
      case 'feirao_comissao':                out = feirao_comissaoCrud_(data); break;
      case 'feirao_indicacao':               out = feirao_indicacaoCrud_(data); break;
      default:                               out = { status: 'error', message: 'Ação desconhecida: ' + data.action };
    }
    return jsonOut_(out);
  } catch (err) {
    Logger.log('ERRO doPost: ' + err.message);
    return jsonOut_({ status: 'error', message: err.message });
  }
}

/* ══════════════════════ TORRE DE CONTROLE ═══════════════════════════ */
function lerControle_() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var dados = ss.getSheetByName(ABA_CONTROLE).getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (dados[i][0] === 'estado') { try { return JSON.parse(dados[i][1]); } catch (e) { return null; } }
  }
  return null;
}

function feirao_setControle_(body) {
  var auth = autorizarAcao_(body.authPin, ['diretor_torre']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CONTROLE);
    var dados = aba.getDataRange().getValues();
    var estado = {
      fairStatus: body.fairStatus || 'ativo', motivo: body.motivo || '', mensagem: body.mensagem || '',
      modulos: body.modulos || {}, autor: body.autor || auth.nome, ts: body.ts || new Date().toISOString()
    };
    var achou = false;
    for (var i = 1; i < dados.length; i++) {
      if (dados[i][0] === 'estado') { aba.getRange(i + 1, 2).setValue(JSON.stringify(estado)); achou = true; break; }
    }
    if (!achou) aba.appendRow(['estado', JSON.stringify(estado)]);
    registrarLogSensivel_(auth.nome, 'feirao_set_controle', estado.fairStatus);
    return { status: 'ok' };
  });
}

/* Agrega dados reais das abas para o Dashboard do Diretor. */
function montarResumo_() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var jornada = lerAbaObjetos_(ss.getSheetByName(ABA_JORNADA));
  var participantes = lerAbaObjetos_(ss.getSheetByName(ABA_PARTICIPANTES));
  var pix = lerAbaObjetos_(ss.getSheetByName(ABA_PIX));
  var credito = lerAbaObjetos_(ss.getSheetByName(ABA_CREDITO));
  var emps = lerAbaObjetos_(ss.getSheetByName(ABA_EMPREENDIMENTOS));
  var atendentes = lerAbaObjetos_(ss.getSheetByName(ABA_ATENDENTES));

  var cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000);
  var ativos5min = {}, simulacoes = 0, creditoEnviado = 0, creditoAprovado = 0;
  jornada.forEach(function (ev) {
    var ts = new Date(ev.Timestamp);
    if (!isNaN(ts.getTime()) && ts > cincoMinAtras) ativos5min[ev.Email] = 1;
    if (ev.Evento_Key === 'simulacao') simulacoes++;
    if (ev.Evento_Key === 'credito_enviado') creditoEnviado++;
    if (ev.Evento_Key === 'credito_liberado') creditoAprovado++;
  });

  var reservas = pix.filter(function (l) { return l.Status && l.Status !== 'nao_pago'; }).length;
  var valorReservado = pix.reduce(function (acc, l) { return acc + (Number(l.Valor) || 0); }, 0);
  var vendas = credito.filter(function (l) { return l.Sub_Status === 'aprovado'; }).length;

  var construtoraStats = {};
  emps.forEach(function (e) {
    var c = s_(e.Construtora) || 'Sem construtora';
    if (!construtoraStats[c]) construtoraStats[c] = { leads: 0, simulacoes: 0, reservas: 0, vendas: 0, valorVendido: 0 };
  });
  pix.forEach(function (l) {
    var emp = emps.find(function (e) { return s_(e.Id) === s_(l.Emp_Id); });
    var c = emp ? s_(emp.Construtora) : null;
    if (c && construtoraStats[c]) construtoraStats[c].reservas++;
  });

  var empreendimentosResumo = emps.map(function (e) {
    var idStr = s_(e.Id);
    return {
      nome: s_(e.Nome), construtora: s_(e.Construtora),
      views: 0,
      reservas: pix.filter(function (l) { return s_(l.Emp_Id) === idStr; }).length,
      vendas: credito.filter(function (l) { return s_(l.Emp_Id) === idStr && l.Sub_Status === 'aprovado'; }).length
    };
  });

  var atendentesResumo = atendentes.filter(function (a) { return a.Ativo === true; }).map(function (a) {
    return { nome: s_(a.Nome), status: 'online', leadsAtivos: 0, tempoMedioResp: '—', fechados: 0 };
  });

  var feed = jornada.slice(-15).reverse().map(function (ev) {
    return { tipo: ev.Evento_Key, html: s_(ev.Detalhe) || s_(ev.Evento_Key), ts: ev.Timestamp };
  });

  return {
    precadastros: participantes.length, inscritosFeira: participantes.filter(function (p) { return p.Etapa_Funil; }).length,
    atividade5min: Object.keys(ativos5min).length,
    simulacoes: simulacoes, creditoEnviado: creditoEnviado, creditoAprovado: creditoAprovado,
    reservas: reservas, vendas: vendas,
    valorVendido: 0, valorReservado: valorReservado,
    construtoraStats: construtoraStats, empreendimentos: empreendimentosResumo,
    atendentes: atendentesResumo, feed: feed
  };
}

function feirao_listaParticipantes_(p) {
  var auth = autorizarAcao_(p.authPin, ['diretor_torre', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_PARTICIPANTES));
  return {
    ok: true,
    participantes: linhas.map(function (l) {
      return {
        id: l.Email, dataCadastro: l.Criado_em, nome: s_(l.Nome), email: s_(l.Email),
        whatsapp: s_(l.WhatsApp), categoria: s_(l.Vinculo), etapaFunil: s_(l.Etapa_Funil)
      };
    })
  };
}

/* ══════════════════════ LOGIN OTP DO LEAD ═══════════════════════════ */
function feirao_loginSolicitarCodigo_(data) {
  var email = normalizarEmail_(data.email);
  if (!email || email.indexOf('@') === -1) return { status: 'error', message: 'E-mail inválido.' };
  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  var expiraEm = agora_().replace(/T.*/, '') + 'T' + Utilities.formatDate(new Date(Date.now() + 10 * 60000), TZ, 'HH:mm:ss');

  comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_OTP);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    var row = [email, codigo, expiraEm, false, '', '', agora_()];
    if (linha === -1) aba.appendRow(row); else aba.getRange(linha, 1, 1, row.length).setValues([row]);
  });

  enfileirarNotificacao_('login_codigo', email, {
    assuntoDireto: '🔑 Seu código de acesso — Feirão WAL',
    corpoDireto: 'Seu código de acesso ao Feirão Online WAL é: ' + codigo + '\n\nVálido por 10 minutos. Se você não pediu este código, ignore este e-mail.'
  });
  return { status: 'ok' };
}

function feirao_loginVerificarCodigo_(data) {
  var email = normalizarEmail_(data.email);
  var codigo = s_(data.codigo).trim();
  if (!email || !codigo) return { status: 'error', message: 'E-mail e código são obrigatórios.' };

  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_OTP);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    if (linha === -1) return { status: 'error', message: 'Solicite um novo código.' };
    var vals = aba.getRange(linha, 1, 1, 7).getValues()[0];
    var expiraEm = new Date(vals[2]);
    if (codigo !== s_(vals[1])) return { status: 'error', message: 'Código incorreto.' };
    if (!isNaN(expiraEm.getTime()) && expiraEm < new Date()) return { status: 'error', message: 'Código expirado. Solicite outro.' };

    var token = gerarToken_();
    var tokenExpira = new Date(Date.now() + 24 * 3600000).toISOString();
    aba.getRange(linha, 4, 1, 3).setValues([[true, token, tokenExpira]]);

    // PARTICIPANTES é a fonte de verdade de quem já é Lead cadastrado — não
    // o localStorage do navegador do cliente. Sem isto, um Lead que loga de
    // outro aparelho/navegador (ou limpou os dados do site) era tratado
    // como "primeiro acesso" e tinha que recadastrar, mesmo já constando
    // na planilha. Devolve os dados existentes para o cliente reconhecer.
    var abaPart = ss.getSheetByName(ABA_PARTICIPANTES);
    var linhaPart = acharLinhaPorChave_(abaPart, 'Email', email);
    if (linhaPart === -1) {
      abaPart.appendRow([email, data.nome || '', '', '', '', '', '', '', 'novo', agora_(), agora_()]);
      return { status: 'ok', sessionToken: token, novo: true };
    }
    var headersPart = abaPart.getRange(1, 1, 1, abaPart.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var colFav = headersPart.indexOf('Empreendimentos_Favoritos');
    var p = abaPart.getRange(linhaPart, 1, 1, abaPart.getLastColumn()).getValues()[0];
    var favoritos = [];
    if (colFav !== -1) { try { favoritos = JSON.parse(p[colFav] || '[]'); } catch (e) {} }
    return {
      status: 'ok', sessionToken: token, novo: false,
      nome: s_(p[1]), cpf: s_(p[2]), whatsapp: s_(p[3]), vinculo: s_(p[4]), favoritos: favoritos
    };
  });
}

/* ══════════════════════ EMPREENDIMENTOS FAVORITOS DO LEAD ═════════════
   Lista simples de Emp_Id guardada como JSON numa única coluna de
   PARTICIPANTES — não precisa de aba própria, é só "curtir/descurtir". */
function feirao_favoritoToggle_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_PARTICIPANTES);
  var email = normalizarEmail_(data.email);
  return comLock_(function () {
    var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var colFav = headers.indexOf('Empreendimentos_Favoritos');
    if (colFav === -1) return { status: 'error', message: 'Coluna Empreendimentos_Favoritos não existe — rode adicionarColunaFavoritos() no editor.' };
    var favoritosJson = JSON.stringify(Array.isArray(data.favoritos) ? data.favoritos : []);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    var now = agora_();
    if (linha === -1) {
      var novaLinha = new Array(headers.length).fill('');
      novaLinha[headers.indexOf('Email')] = email;
      novaLinha[headers.indexOf('Etapa_Funil')] = 'novo';
      novaLinha[headers.indexOf('Criado_em')] = now;
      novaLinha[headers.indexOf('Atualizado_em')] = now;
      novaLinha[colFav] = favoritosJson;
      aba.appendRow(novaLinha);
    } else {
      aba.getRange(linha, colFav + 1).setValue(favoritosJson);
      var colAtu = headers.indexOf('Atualizado_em');
      if (colAtu !== -1) aba.getRange(linha, colAtu + 1).setValue(now);
    }
    return { status: 'ok' };
  });
}

function feirao_favoritosLead_(email, sessionToken) {
  if (!validarSessaoLead_(email, sessionToken)) return { ok: false, erro: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_PARTICIPANTES);
  var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var colFav = headers.indexOf('Empreendimentos_Favoritos');
  if (colFav === -1) return { ok: true, favoritos: [] };
  var linha = acharLinhaPorChave_(aba, 'Email', normalizarEmail_(email));
  if (linha === -1) return { ok: true, favoritos: [] };
  var valor = aba.getRange(linha, colFav + 1).getValue();
  var favoritos = [];
  try { favoritos = JSON.parse(valor || '[]'); } catch (e) {}
  return { ok: true, favoritos: favoritos };
}

/* Valida um sessionToken de Lead — usado por toda ação de escrita do
   Lead (participante/evento/simulacao/credito/agendamento/mensagem/
   chat/pix/pagamento) para confirmar que quem está escrevendo já
   verificou aquele e-mail por OTP. */
function validarSessaoLead_(email, sessionToken) {
  var emailN = normalizarEmail_(email);
  var token = s_(sessionToken).trim();
  if (!emailN || !token) return false;
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_OTP));
  var achado = linhas.find(function (l) { return normalizarEmail_(l.Email) === emailN; });
  if (!achado || achado.Verificado !== true || s_(achado.Session_Token) !== token) return false;
  var exp = new Date(achado.Session_Expira_em);
  return !isNaN(exp.getTime()) && exp > new Date();
}

function feirao_loginConstrutora_(pin) {
  var au = acharAutorizadoPorPin_(pin);
  if (!au.ok) return { found: false, erro: au.erro || 'PIN não encontrado.' };
  return { found: true, papel: au.papel, nome: au.nome, construtora: au.construtora };
}

function feirao_loginAtendente_(pin) {
  if (pin === PIN_GERENTE_ATENDIMENTO) return { found: true, papel: 'gerente_atendimento', nome: NOME_GERENTE_ATENDIMENTO };
  var at = acharAtendentePorPin_(pin);
  if (at) return { found: true, papel: 'atendente', nome: at.Nome, id: at.Id };
  return { found: false };
}

function feirao_listarAtendentesPublico_() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  return lerAbaObjetos_(ss.getSheetByName(ABA_ATENDENTES))
    .filter(function (a) { return a.Ativo === true; })
    .map(function (a) { return { id: s_(a.Id), nome: s_(a.Nome) }; });
}

/* ══════════════════════ PARTICIPANTE / JORNADA ═══════════════════════ */
function feirao_participante_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PARTICIPANTES);
    var email = normalizarEmail_(data.email);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    var now = agora_();
    if (linha === -1) {
      aba.appendRow([
        email, data.nome || '', data.cpf || '', data.whatsapp || '', data.vinculo || '',
        data.crmLeadId || '', data.empSelecionado || '', data.unidadeSelecionada || '',
        data.etapaFunil || 'novo', now, now
      ]);
    } else {
      var vals = aba.getRange(linha, 1, 1, 11).getValues()[0];
      aba.getRange(linha, 1, 1, 11).setValues([[
        email,
        data.nome !== undefined ? data.nome : vals[1],
        data.cpf !== undefined ? data.cpf : vals[2],
        data.whatsapp !== undefined ? data.whatsapp : vals[3],
        data.vinculo !== undefined ? data.vinculo : vals[4],
        data.crmLeadId !== undefined ? data.crmLeadId : vals[5],
        data.empSelecionado !== undefined ? data.empSelecionado : vals[6],
        data.unidadeSelecionada !== undefined ? data.unidadeSelecionada : vals[7],
        data.etapaFunil !== undefined ? data.etapaFunil : vals[8],
        vals[9], now
      ]]);
    }
    return { status: 'ok' };
  });
}

function feirao_evento_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  comLock_(function () {
    ss.getSheetByName(ABA_JORNADA).appendRow([normalizarEmail_(data.email), data.eventoKey || '', data.detalhe || '', agora_()]);
  });
  return { status: 'ok' };
}

function feirao_leadStatus_(data) {
  var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  if (ETAPAS_FUNIL.indexOf(data.etapaFunil) === -1) return { status: 'error', message: 'Etapa de funil inválida.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PARTICIPANTES);
    var linha = acharLinhaPorChave_(aba, 'Email', normalizarEmail_(data.email));
    if (linha === -1) return { status: 'error', message: 'Lead não encontrado.' };
    aba.getRange(linha, 9).setValue(data.etapaFunil); // Etapa_Funil
    aba.getRange(linha, 11).setValue(agora_()); // Atualizado_em
    return { status: 'ok' };
  });
}

function feirao_listarLeads_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_PARTICIPANTES));
  return {
    ok: true,
    leads: linhas.map(function (l) {
      return {
        email: s_(l.Email), nome: s_(l.Nome), cpf: s_(l.CPF), whatsapp: s_(l.WhatsApp),
        vinculo: s_(l.Vinculo), empSelecionado: s_(l.Emp_Selecionado), unidadeSelecionada: s_(l.Unidade_Selecionada),
        etapaFunil: s_(l.Etapa_Funil) || 'novo', criadoEm: l.Criado_em, atualizadoEm: l.Atualizado_em,
        atendenteId: s_(l.Atendente_Id), prioridade: s_(l.Prioridade), origem: s_(l.Origem)
      };
    })
  };
}

/* Gerente encaminha (ou remove) um lead para um atendente. Grava nas
   colunas Atendente_Id / Prioridade criadas pela migração setupFase1(). */
function feirao_leadAtribuir_(data) {
  var auth = autorizarAcao_(data.authPin, ['gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PARTICIPANTES);
    var linha = acharLinhaPorChave_(aba, 'Email', normalizarEmail_(data.email));
    if (linha === -1) return { status: 'error', message: 'Lead não encontrado.' };
    var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var colAt = headers.indexOf('Atendente_Id') + 1;
    var colPri = headers.indexOf('Prioridade') + 1;
    if (colAt < 1) return { status: 'error', message: 'Coluna Atendente_Id não existe — rode setupFase1() no editor.' };
    aba.getRange(linha, colAt).setValue(s_(data.atendenteId));
    if (colPri >= 1 && data.prioridade !== undefined) aba.getRange(linha, colPri).setValue(s_(data.prioridade));
    aba.getRange(linha, 11).setValue(agora_()); // Atualizado_em
    return { status: 'ok' };
  });
}

/* ══════════════════════ SIMULAÇÃO ════════════════════════════════════ */
function feirao_simulacao_(data) {
  // grava o próprio lead (sessão OTP) OU atendente/gerente em nome dele (authPin)
  var pelaEquipe = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!pelaEquipe && !validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  comLock_(function () {
    ss.getSheetByName(ABA_SIMULACOES_FEIR).appendRow([
      normalizarEmail_(data.email), data.nome || '', data.empId || '', data.valorImovel || 0,
      data.entrada || 0, data.prazo || 0, data.taxa || 0, data.sistemaEscolhido || '',
      data.encargoSac || 0, data.encargoPrice || 0, data.encargoCfiae || 0, data.encargoPoupex || 0, agora_()
    ]);
  });
  try {
    var ssPrincipal = SpreadsheetApp.openById(PLANILHA_PRINCIPAL_ID);
    var abaGeral = ssPrincipal.getSheetByName(ABA_SIMULACOES_GERAL);
    if (abaGeral) {
      abaGeral.appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss'), data.whatsapp || '', data.nome || '', data.email || '', 1]);
    }
  } catch (e) { Logger.log('feirao_simulacao_ SIMULACOES geral erro: ' + e.message); }
  return { status: 'ok' };
}

/* Exige prova de posse do e-mail (sessionToken do OTP) OU authPin de
   atendente/gerente — sem isso, qualquer um que soubesse/adivinhasse um
   e-mail conseguiria ler a simulação financeira daquela pessoa. */
function feirao_simulacaoStatus_(email, sessionToken, authPin) {
  var emailN = normalizarEmail_(email);
  if (!emailN) return { found: false };
  var autorizado = validarSessaoLead_(emailN, sessionToken) || autorizarAcao_(authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!autorizado) return { found: false, erro: 'Não autorizado.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_SIMULACOES_FEIR));
  for (var i = linhas.length - 1; i >= 0; i--) {
    if (normalizarEmail_(linhas[i].Email) === emailN) {
      var l = linhas[i];
      return {
        found: true, sistema: s_(l.Sistema_Escolhido), valor: Number(l.Valor_Imovel) || 0,
        entrada: Number(l.Entrada) || 0, prazo: Number(l.Prazo) || 0, taxa: Number(l.Taxa) || 0, timestamp: l.Timestamp
      };
    }
  }
  return { found: false };
}

/* ══════════════════════ ANÁLISE DE CRÉDITO ═══════════════════════════ */
function feirao_credito_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CREDITO);
    var protocolo = data.protocolo || '';
    if (!protocolo) return { status: 'error', message: 'Protocolo obrigatório' };

    var linksDocumentos = salvarDocumentosDrive_(data.documentos || [], protocolo);
    var linha = acharLinhaPorChave_(aba, 'Protocolo', protocolo);
    var now = agora_();
    var dataLimite = data.dataLimite || Utilities.formatDate(new Date(Date.now() + 48 * 3600000), TZ, "yyyy-MM-dd'T'HH:mm:ss");
    if (linha === -1) {
      aba.appendRow([
        protocolo, normalizarEmail_(data.email), limparDoc_(data.cpf), data.nome || '', data.telefone || '',
        data.estadoCivil || '', data.conjugeNome || '', data.empId || '', data.unidade || '',
        JSON.stringify(linksDocumentos), 'enviado', 0, 0, data.taxa || 0, now, dataLimite, '', '', ''
      ]);
    } else {
      aba.getRange(linha, 10, 1, 1).setValue(JSON.stringify(linksDocumentos));
    }
    enfileirarNotificacaoAnaliseCredito_(data, protocolo, linksDocumentos);
    return { status: 'ok', protocolo: protocolo };
  });
}

/* Monta o aviso de nova análise de crédito com assunto e corpo próprios
   (via assuntoDireto/corpoDireto, o mesmo mecanismo usado pelas outras
   notificações — ver processarFilaNotificacoes) e separa os documentos do
   titular dos documentos do cônjuge (campos docConjId/docConjRenda) quando
   o Estado Civil é Casado(a)/União Estável. Vão como LINKS do Drive (não
   como anexo binário) — os documentos já são gravados no Drive por
   salvarDocumentosDrive_ logo acima, e reanexá-los ao e-mail duplicaria
   dados e esbarraria em limite de tamanho de anexo sem necessidade: o
   link já abre/baixa o arquivo direto no Drive. */
function enfileirarNotificacaoAnaliseCredito_(data, protocolo, linksDocumentos) {
  var casado = data.estadoCivil === 'casado';
  var campoConjuge = { docConjId: true, docConjRenda: true };
  var docsTitular = [], docsConjuge = [];
  (linksDocumentos || []).forEach(function (d) {
    (campoConjuge[d.campo] ? docsConjuge : docsTitular).push(d);
  });
  var linhaDoc = function (d) { return '- ' + (d.nome || d.campo || 'documento') + ': ' + d.url; };

  var corpo = 'Nova análise de crédito recebida no Feirão Online WAL.\n\n' +
    'Protocolo: ' + protocolo + '\n' +
    'Nome: ' + (data.nome || '') + '\n' +
    'CPF: ' + (data.cpf || '') + '\n' +
    'Telefone: ' + (data.telefone || '') + '\n' +
    'E-mail: ' + (data.email || '') + '\n' +
    'Estado civil: ' + (casado ? 'Casado(a) / União Estável' : (data.estadoCivil || 'não informado')) + '\n' +
    (casado ? 'Cônjuge: ' + (data.conjugeNome || 'não informado') + '\n' : '') +
    'Empreendimento: ' + (data.empId || '—') + ' · Unidade: ' + (data.unidade || '—') + '\n\n' +
    'Documentos do titular (' + docsTitular.length + '):\n' +
    (docsTitular.length ? docsTitular.map(linhaDoc).join('\n') : '(nenhum documento novo neste envio)') + '\n' +
    (casado ? '\nDocumentos do cônjuge (' + docsConjuge.length + '):\n' +
      (docsConjuge.length ? docsConjuge.map(linhaDoc).join('\n') : '⚠️ Nenhum documento do cônjuge anexado — confirme com o cliente.') + '\n' : '');

  enfileirarNotificacao_('credito_recebido', EMAIL_COMERCIAL_FEIRAO, {
    assuntoDireto: 'Documentos para Analise de Credito de: ' + (data.nome || 'Lead sem nome'),
    corpoDireto: corpo
  });
}

function feirao_statusCredito_(protocolo) {
  if (!protocolo) return { found: false };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_CREDITO));
  var achado = linhas.find(function (l) { return s_(l.Protocolo) === protocolo; });
  if (!achado) return { found: false };
  return {
    found: true, status: s_(achado.Sub_Status) || 'enviado',
    valorAprovado: Number(achado.Valor_Aprovado) || 0, entradaMinima: Number(achado.Entrada_Minima) || 0,
    taxa: Number(achado.Taxa) || 0, dataLimite: s_(achado.Data_Limite), dataLiberacao: s_(achado.Data_Liberacao)
  };
}

/* Lista as análises de crédito reais para o painel do atendente/gerente
   — antes desta action o painel usava um fluxo local (STATE.solicitacoesViabilizador)
   desconectado do protocolo real que o lead gera em feirao_credito_. */
function feirao_listarAnalisesCredito_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CREDITO);
  if (!aba) return { ok: true, itens: [] };
  return {
    ok: true,
    itens: lerAbaObjetos_(aba).map(function (l) {
      return {
        protocolo: s_(l.Protocolo), email: s_(l.Email), cpf: s_(l.CPF), nome: s_(l.Nome), telefone: s_(l.Telefone),
        estadoCivil: s_(l.Estado_Civil), conjugeNome: s_(l.Conjuge_Nome), empId: s_(l.Emp_Id), unidade: s_(l.Unidade),
        status: s_(l.Sub_Status) || 'enviado', valorAprovado: Number(l.Valor_Aprovado) || 0, entradaMinima: Number(l.Entrada_Minima) || 0,
        taxa: Number(l.Taxa) || 0, dataEnvio: s_(l.Data_Envio), dataLimite: s_(l.Data_Limite), dataLiberacao: s_(l.Data_Liberacao),
        consultor: s_(l.Consultor), parecer: s_(l.Parecer)
      };
    })
  };
}

/* Atendente/Gerente aprova ou reprova — porta a ação proposta em
   apps-script-ponte-atendente-lead.gs, agora conectada de verdade. */
function feirao_creditoDecisao_(data) {
  var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  if (SUBSTATUS_CREDITO.indexOf(data.status) === -1) return { status: 'error', message: 'Status inválido.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CREDITO);
    var linha = acharLinhaPorChave_(aba, 'Protocolo', data.protocolo);
    if (linha === -1) return { status: 'error', message: 'Protocolo não encontrado.' };
    aba.getRange(linha, 11, 1, 8).setValues([[
      data.status, data.valorAprovado || 0, data.entradaMinima || 0, data.taxa || aba.getRange(linha, 14).getValue(),
      aba.getRange(linha, 15).getValue(), aba.getRange(linha, 16).getValue(), agora_(), auth.nome
    ]]);
    aba.getRange(linha, 19).setValue(data.parecer || '');
    return { status: 'ok' };
  });
}

function aprovarCredito(protocolo, valorAprovado, entradaMinima, taxa) {
  return feirao_creditoDecisao_({ protocolo: protocolo, status: 'aprovado', valorAprovado: valorAprovado, entradaMinima: entradaMinima, taxa: taxa, authPin: PIN_GERENTE_ATENDIMENTO });
}

function aprovarCreditoMenu() {
  var ui = SpreadsheetApp.getUi();
  var protocolo = ui.prompt('Aprovar Crédito', 'Protocolo:', ui.ButtonSet.OK_CANCEL).getResponseText();
  var valor = Number(ui.prompt('Valor aprovado (R$):', ui.ButtonSet.OK_CANCEL).getResponseText()) || 0;
  var entrada = Number(ui.prompt('Entrada mínima (R$):', ui.ButtonSet.OK_CANCEL).getResponseText()) || 0;
  var taxa = Number(ui.prompt('Taxa concedida (% a.a.):', ui.ButtonSet.OK_CANCEL).getResponseText()) || 8.3;
  var r = aprovarCredito(protocolo, valor, entrada, taxa);
  ui.alert(r.status === 'ok' ? '✅ Crédito aprovado!' : '❌ ' + r.message);
}

function salvarDocumentosDrive_(documentos, protocolo) {
  if (!documentos || !documentos.length) return [];
  var pasta = obterPastaDocumentos_();
  var subPasta = pasta.createFolder(protocolo);
  var links = [];
  documentos.forEach(function (doc) {
    try {
      if (!doc.base64 || doc.base64.length > 13000000) return;
      var bytes = Utilities.base64Decode(doc.base64);
      var blob = Utilities.newBlob(bytes, doc.tipo || 'application/octet-stream', doc.nome || 'documento');
      var arquivo = subPasta.createFile(blob);
      links.push({ campo: doc.campo || '', nome: doc.nome || '', url: arquivo.getUrl() });
    } catch (e) { Logger.log('salvarDocumentosDrive_ erro: ' + e.message); }
  });
  return links;
}
function obterPastaDocumentos_() {
  if (PASTA_DRIVE_DOCS_ID) return DriveApp.getFolderById(PASTA_DRIVE_DOCS_ID);
  var nome = 'WAL Feirão — Documentos Crédito';
  var it = DriveApp.getFoldersByName(nome);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nome);
}

/* ══════════════════════ CONTRATO ═════════════════════════════════════ */
function feirao_contratoStatusEscrita_(data) {
  var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var email = normalizarEmail_(data.email);
  if (!email) return { status: 'error', message: 'E-mail obrigatório.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_CONTRATOS);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    if (linha === -1) {
      aba.appendRow([
        data.protocolo || '', email, data.nome || '', data.empId || '', data.unidade || '', agora_(),
        !!data.enviado, data.enviado ? agora_() : '', !!data.assinado, data.assinado ? agora_() : '', data.cobranca ? agora_() : ''
      ]);
      return { status: 'ok', criado: true };
    }
    var vals = aba.getRange(linha, 1, 1, 11).getValues()[0];
    aba.getRange(linha, 1, 1, 11).setValues([[
      vals[0], email, vals[2], vals[3], vals[4], vals[5],
      data.enviado !== undefined ? !!data.enviado : vals[6],
      data.enviado ? agora_() : vals[7],
      data.assinado !== undefined ? !!data.assinado : vals[8],
      data.assinado ? agora_() : vals[9],
      data.cobranca ? agora_() : vals[10]
    ]]);
    return { status: 'ok' };
  });
}

function feirao_statusContrato_(email, sessionToken, authPin) {
  var emailN = normalizarEmail_(email);
  if (!emailN) return { found: false };
  var autorizado = validarSessaoLead_(emailN, sessionToken) || autorizarAcao_(authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!autorizado) return { found: false, erro: 'Não autorizado.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_CONTRATOS));
  var achado = linhas.find(function (l) { return normalizarEmail_(l.Email) === emailN; });
  if (!achado) return { found: false };
  return {
    found: true, enviado: !!achado.Enviado, enviadoEm: s_(achado.Enviado_em),
    assinado: !!achado.Assinado, assinadoEm: s_(achado.Assinado_em)
  };
}

/* ══════════════════════ AGENDAMENTO DE VISITA ═══════════════════════ */
function feirao_agendamento_(data) {
  // agenda o próprio lead (sessão OTP) OU atendente/gerente em nome dele (authPin)
  var pelaEquipe = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!pelaEquipe && !validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_VISITAS_AGENDA);
    var email = normalizarEmail_(data.email);
    if (data.acao === 'cancelar') {
      var linha = acharLinhaPorChave_(aba, 'Email', email);
      if (linha !== -1) aba.getRange(linha, 11).setValue('cancelado');
      return { status: 'ok' };
    }
    aba.appendRow([
      email, data.nome || '', data.telefone || '', data.empId || '', data.empNome || '',
      data.data || '', data.horario || '', data.pessoas || '', data.formato || '',
      data.observacoes || '', 'confirmado', agora_()
    ]);
    enfileirarNotificacao_('agendamento', EMAIL_EQUIPE_FEIRAO, { nome: data.nome, telefone: data.telefone, empNome: data.empNome, data: data.data, horario: data.horario });
    return { status: 'ok' };
  });
}

/* Sheets converte datas/horas digitadas em objetos Date — normaliza para
   texto estável antes de devolver ao dashboard. */
function dataISO_(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : s_(v); }
function horaTexto_(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'HH:mm') : s_(v); }
function dataBR_(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'dd/MM/yyyy') : s_(v); }

/* Lista os agendamentos de visita para o painel do Atendente/Gerente —
   inclui as visitas que o próprio lead marcou pelo dashboard dele. */
function feirao_listarAgendamentos_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  return {
    ok: true,
    itens: lerAbaObjetos_(ss.getSheetByName(ABA_VISITAS_AGENDA)).map(function (a) {
      return {
        email: normalizarEmail_(a.Email), nome: s_(a.Nome), telefone: s_(a.Telefone),
        empId: s_(a.Emp_Id), empNome: s_(a.Emp_Nome), data: dataISO_(a.Data), horario: horaTexto_(a.Horario),
        pessoas: s_(a.Pessoas), formato: s_(a.Formato), observacoes: s_(a.Observacoes),
        status: s_(a.Status), timestamp: s_(a.Timestamp)
      };
    })
  };
}

/* ══════════════════════ MENSAGEM AO CONSULTOR ═══════════════════════ */
function feirao_mensagem_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  comLock_(function () {
    ss.getSheetByName(ABA_MENSAGENS).appendRow([
      normalizarEmail_(data.email), data.nome || '', data.telefone || '', data.assunto || '',
      data.mensagem || '', agora_(), 'nao_lida', '', ''
    ]);
  });
  enfileirarNotificacao_('mensagem_consultor', EMAIL_EQUIPE_FEIRAO, { nome: data.nome, telefone: data.telefone, assunto: data.assunto, mensagem: data.mensagem });
  return { status: 'ok' };
}

/* Histórico das PRÓPRIAS mensagens do lead (não do atendente/gerente) —
   autenticado por sessão OTP, não por PIN. Alimenta o "Histórico de
   mensagens" no painel Falar com Consultor do dashboard do lead. */
function feirao_mensagensLead_(email, sessionToken) {
  if (!validarSessaoLead_(email, sessionToken)) return { ok: false, erro: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_MENSAGENS);
  if (!aba) return { ok: true, itens: [] };
  var emailN = normalizarEmail_(email);
  var itens = lerAbaObjetos_(aba)
    .filter(function (l) { return normalizarEmail_(l.Email) === emailN; })
    .map(function (l) {
      return {
        assunto: s_(l.Assunto), mensagem: s_(l.Mensagem), timestamp: s_(l.Timestamp),
        status: s_(l.Status) || 'nao_lida', resposta: s_(l.Resposta), respondidoEm: s_(l.Respondido_em)
      };
    });
  return { ok: true, itens: itens };
}

/* Lista MENSAGENS_CONSULTOR para o painel do atendente/gerente — antes
   desta action a mensagem só existia como e-mail para a equipe, sem
   histórico consultável dentro do sistema. */
function feirao_listarMensagens_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_MENSAGENS);
  if (!aba) return { ok: true, itens: [] };
  return {
    ok: true,
    itens: lerAbaObjetos_(aba).map(function (l) {
      return {
        email: s_(l.Email), nome: s_(l.Nome), telefone: s_(l.Telefone), assunto: s_(l.Assunto),
        mensagem: s_(l.Mensagem), timestamp: s_(l.Timestamp), status: s_(l.Status) || 'nao_lida',
        resposta: s_(l.Resposta), respondidoEm: s_(l.Respondido_em)
      };
    })
  };
}

/* Marca uma mensagem como respondida (identificada por Email+Timestamp,
   já que a aba não tem coluna de Id dedicada). */
function feirao_mensagemResponder_(data) {
  var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_MENSAGENS);
    var linhas = lerAbaObjetos_(aba);
    var achado = linhas.find(function (l) {
      return normalizarEmail_(l.Email) === normalizarEmail_(data.email) && s_(l.Timestamp) === s_(data.timestamp);
    });
    if (!achado) return { status: 'error', message: 'Mensagem não encontrada.' };
    aba.getRange(achado._row, 7, 1, 3).setValues([['respondida', data.resposta || '', agora_()]]);
    return { status: 'ok' };
  });
}

/* Compartilhamento de empreendimento por e-mail — botão "Compartilhar"
   do dashboard do lead. Não usa mailto (que abriria o cliente de e-mail
   do PRÓPRIO lead); envia de verdade pela fila/Brevo já usada para os
   códigos OTP, com remetente wal@walservidor.com.br (BREVO_SENDER_EMAIL). */
function feirao_compartilharEmail_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var destinatario = normalizarEmail_(data.destinatario);
  if (!destinatario) return { status: 'error', message: 'E-mail do destinatário obrigatório.' };
  enfileirarNotificacao_('compartilhar_imovel', destinatario, {
    assuntoDireto: data.assunto || 'Confira este imóvel — Feirão Online WAL',
    corpoDireto: data.corpo || ''
  });
  return { status: 'ok' };
}

/* ══════════════════════ CHAT AO VIVO (polling) ═══════════════════════
   Thread = e-mail normalizado do lead (o widget feirao/shared/chat-widget.js
   já foi ajustado para mandar `email` em vez de `cpf` — ver Fase B). */
function feirao_chatEnviar_(data) {
  return comLock_(function () {
    var email = normalizarEmail_(data.email);
    if (!email) return { status: 'error', message: 'E-mail obrigatório' };
    var remetente = data.remetente === 'atendente' ? 'atendente' : 'cliente';
    if (remetente === 'cliente' && !validarSessaoLead_(email, data.sessionToken)) {
      return { status: 'error', message: 'Sessão de e-mail não verificada.' };
    }
    if (remetente === 'atendente') {
      var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
      if (!auth.ok) return { status: 'error', message: auth.erro };
    }
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    ss.getSheetByName(ABA_CHAT).appendRow([email, data.nome || '', remetente, data.texto || '', agora_(), false]);
    if (remetente === 'cliente') enfileirarNotificacao_('chat_nova_mensagem', EMAIL_EQUIPE_FEIRAO, { email: email, nome: data.nome, texto: data.texto });
    return { status: 'ok' };
  });
}

/* Exige prova de posse do e-mail (sessionToken) quando quem lê é o
   cliente, ou authPin de atendente/gerente quando é a equipe — sem
   isso, qualquer um que soubesse/adivinhasse o e-mail de um lead
   conseguiria ler a conversa privada dele com o consultor. */
function feirao_chatBuscar_(emailInput, sinceInput, leitorInput, sessionToken, authPin) {
  var email = normalizarEmail_(emailInput);
  if (!email) return { mensagens: [] };
  var leitor = leitorInput === 'atendente' ? 'atendente' : 'cliente';
  var remetenteAlheio = leitor === 'atendente' ? 'cliente' : 'atendente';
  var autorizado = leitor === 'atendente'
    ? autorizarAcao_(authPin, ['atendente', 'gerente_atendimento']).ok
    : validarSessaoLead_(email, sessionToken);
  if (!autorizado) return { mensagens: [], erro: 'Não autorizado.' };

  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CHAT);
  var linhas = lerAbaObjetos_(aba);

  var mensagens = [];
  var linhasParaMarcarLidas = [];
  linhas.forEach(function (l) {
    if (normalizarEmail_(l.Email) !== email) return;
    if (sinceInput && s_(l.Timestamp) <= sinceInput) return;
    mensagens.push({ remetente: s_(l.Remetente), texto: s_(l.Texto), timestamp: s_(l.Timestamp), nome: s_(l.Nome) });
    if (s_(l.Remetente) === remetenteAlheio && l.Lida !== true) linhasParaMarcarLidas.push(l._row);
  });

  if (linhasParaMarcarLidas.length) {
    comLock_(function () { linhasParaMarcarLidas.forEach(function (row) { aba.getRange(row, 6).setValue(true); }); });
  }
  return { mensagens: mensagens };
}

function feirao_chatThreads_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro, threads: [] };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_CHAT));

  var porEmail = {}, naoLidasPorEmail = {};
  linhas.forEach(function (l) {
    var email = normalizarEmail_(l.Email);
    if (!email) return;
    if (!porEmail[email] || s_(l.Timestamp) > porEmail[email].ultimoTimestamp) {
      porEmail[email] = { email: email, nome: s_(l.Nome), ultimaMensagem: s_(l.Texto), ultimoTimestamp: s_(l.Timestamp), ultimoRemetente: s_(l.Remetente) };
    }
    if (s_(l.Remetente) === 'cliente' && l.Lida !== true) naoLidasPorEmail[email] = (naoLidasPorEmail[email] || 0) + 1;
  });

  var threads = Object.keys(porEmail).map(function (email) {
    var t = porEmail[email];
    t.naoLidas = naoLidasPorEmail[email] || 0;
    return t;
  });
  threads.sort(function (a, b) { return a.ultimoTimestamp < b.ultimoTimestamp ? 1 : -1; });
  return { ok: true, threads: threads };
}

/* ══════════════════════ PIX / RESERVA (autodeclarado) ═══════════════ */
function feirao_pix_(data) {
  if (!validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PIX);
    var email = normalizarEmail_(data.email);
    var dados = aba.getDataRange().getValues();
    var linha = -1;
    for (var i = 1; i < dados.length; i++) {
      if (normalizarEmail_(dados[i][0]) === email && s_(dados[i][2]) === s_(data.empId)) { linha = i + 1; break; }
    }
    var status = data.paga ? 'autodeclarado_pendente_confirmacao' : 'nao_pago';
    if (linha === -1) {
      aba.appendRow([email, data.nome || '', data.empId || '', data.empNome || '', data.unidade || '', data.valor || 0, status, data.dataPagamento || '', agora_()]);
    } else {
      aba.getRange(linha, 6, 1, 3).setValues([[data.valor || 0, status, data.dataPagamento || '']]);
    }
    if (data.paga) enfileirarNotificacao_('pix_autodeclarado', EMAIL_EQUIPE_FEIRAO, { nome: data.nome, empNome: data.empNome, valor: data.valor });
    return { status: 'ok' };
  });
}

/* Lista RESERVAS_PIX_FEIRAO (pagamento de reserva autodeclarado pelo
   lead) para o painel do atendente/gerente. */
function feirao_listarPix_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_PIX);
  if (!aba) return { ok: true, itens: [] };
  return {
    ok: true,
    itens: lerAbaObjetos_(aba).map(function (l) {
      return {
        email: s_(l.Email), nome: s_(l.Nome), empId: s_(l.Emp_Id), empNome: s_(l.Emp_Nome), unidade: s_(l.Unidade),
        valor: Number(l.Valor) || 0, status: s_(l.Status) || 'nao_pago', dataPagamento: s_(l.Data_Pagamento), timestamp: s_(l.Timestamp)
      };
    })
  };
}

/* ══════════════════════ FLUXO DE PAGAMENTO ═══════════════════════════ */
function feirao_pagamento_(data) {
  // grava o próprio lead (sessão OTP) OU atendente/gerente em nome dele (authPin)
  var pelaEquipe = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!pelaEquipe && !validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  return comLock_(function () {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    var aba = ss.getSheetByName(ABA_PAGAMENTO);
    var email = normalizarEmail_(data.email);
    var linha = acharLinhaPorChave_(aba, 'Email', email);
    var row = [email, data.empId || '', data.unidade || '', JSON.stringify(data.estado || {}), data.progressoPct || 0, agora_()];
    if (linha === -1) aba.appendRow(row); else aba.getRange(linha, 1, 1, row.length).setValues([row]);
    return { status: 'ok' };
  });
}

/* Lê o fluxo de pagamento de um lead — mesmo esquema de autorização de
   feirao_simulacaoStatus_: sessão OTP do próprio lead OU authPin da equipe. */
function feirao_pagamentoStatus_(email, sessionToken, authPin) {
  var emailN = normalizarEmail_(email);
  if (!emailN) return { found: false };
  var autorizado = validarSessaoLead_(emailN, sessionToken) || autorizarAcao_(authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!autorizado) return { found: false, erro: 'Não autorizado.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var linhas = lerAbaObjetos_(ss.getSheetByName(ABA_PAGAMENTO));
  for (var i = linhas.length - 1; i >= 0; i--) {
    if (normalizarEmail_(linhas[i].Email) === emailN) {
      var l = linhas[i];
      var estado = {};
      try { estado = JSON.parse(s_(l.Estado_JSON) || '{}'); } catch (e) {}
      return { found: true, empId: s_(l.Emp_Id), unidade: s_(l.Unidade), estado: estado, progressoPct: Number(l.Progresso_Pct) || 0, atualizadoEm: s_(l.Atualizado_em) };
    }
  }
  return { found: false };
}

/* ══════════════════════ FLUXOS DE PAGAMENTO SALVOS ═══════════════════
   Diferente de FLUXO_PAGAMENTO (rascunho único por lead, sobrescrito a
   cada ajuste automático) — aqui é o "Salvar" intencional do cliente:
   cada empreendimento/unidade vira um registro à parte, que ele pode
   revisitar e editar depois, e que o atendente/gerente também enxerga.
   criarAbaSeNaoExiste_ cria a aba sozinha no primeiro uso — não precisa
   de migração manual como Chave_PIX (que foi coluna nova numa aba já
   existente; aqui é aba nova, criarAbaSeNaoExiste_ já resolve). */
var FLUXO_SALVO_HEADERS_ = ['Id', 'Email', 'Nome', 'Emp_Id', 'Emp_Nome', 'Unidade', 'Estado_JSON', 'Progresso_Pct', 'Criado_em', 'Atualizado_em'];

function feirao_fluxoSalvoCrud_(data) {
  var pelaEquipe = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!pelaEquipe && !validarSessaoLead_(data.email, data.sessionToken)) return { status: 'error', message: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = criarAbaSeNaoExiste_(ss, ABA_FLUXOS_SALVOS, FLUXO_SALVO_HEADERS_);
  var email = normalizarEmail_(data.email);

  return comLock_(function () {
    if (data.operacao === 'remover') {
      var linhaDel = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linhaDel === -1) return { status: 'error', message: 'Fluxo não encontrado.' };
      if (!pelaEquipe && normalizarEmail_(aba.getRange(linhaDel, 2).getValue()) !== email) {
        return { status: 'error', message: 'Este fluxo não pertence a este e-mail.' };
      }
      aba.deleteRow(linhaDel);
      return { status: 'ok' };
    }

    var now = agora_();
    var linhas = lerAbaObjetos_(aba);
    // Reaproveita o registro do mesmo empreendimento/unidade se já existir
    // — clicar em "Salvar" de novo pro mesmo imóvel atualiza, não duplica.
    var existente = data.id
      ? linhas.find(function (l) { return s_(l.Id) === s_(data.id); })
      : linhas.find(function (l) {
          return normalizarEmail_(l.Email) === email && s_(l.Emp_Id) === s_(data.empId || '') && s_(l.Unidade) === s_(data.unidade || '');
        });

    if (existente) {
      var row = existente._row;
      aba.getRange(row, 3).setValue(data.nome || '');
      aba.getRange(row, 5).setValue(data.empNome || '');
      aba.getRange(row, 7).setValue(data.estadoJson || '{}');
      aba.getRange(row, 8).setValue(data.progressoPct || 0);
      aba.getRange(row, 10).setValue(now);
      return { status: 'ok', id: s_(existente.Id) };
    }

    var id = gerarId_(aba, 'FP');
    aba.appendRow([id, email, data.nome || '', data.empId || '', data.empNome || '', data.unidade || '', data.estadoJson || '{}', data.progressoPct || 0, now, now]);
    return { status: 'ok', id: id };
  });
}

/* Lead vê só os próprios fluxos (sessão OTP); atendente/gerente veem os
   de um e-mail específico (p.email) ou todos, se p.email vier vazio. */
function feirao_listarFluxosSalvos_(p) {
  var pelaEquipe = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']).ok;
  if (!pelaEquipe && !validarSessaoLead_(p.email, p.sessionToken)) return { ok: false, erro: 'Sessão de e-mail não verificada.' };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = criarAbaSeNaoExiste_(ss, ABA_FLUXOS_SALVOS, FLUXO_SALVO_HEADERS_);
  var itens = lerAbaObjetos_(aba);
  var emailFiltro = normalizarEmail_(p.email || '');
  if (emailFiltro) itens = itens.filter(function (l) { return normalizarEmail_(l.Email) === emailFiltro; });
  return {
    ok: true,
    itens: itens.map(function (l) {
      var estado = {};
      try { estado = JSON.parse(s_(l.Estado_JSON) || '{}'); } catch (e) {}
      return {
        id: s_(l.Id), email: s_(l.Email), nome: s_(l.Nome), empId: s_(l.Emp_Id), empNome: s_(l.Emp_Nome),
        unidade: s_(l.Unidade), estado: estado, progressoPct: Number(l.Progresso_Pct) || 0,
        criadoEm: s_(l.Criado_em), atualizadoEm: s_(l.Atualizado_em)
      };
    })
  };
}

/* ══════════════════════ CONSTRUTORAS (CRUD do Gerente/Diretor) ══════ */
function feirao_construtoraCrud_(data) {
  var auth = autorizarAcao_(data.authPin, ['gerente_atendimento', 'diretor_torre']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_CONSTRUTORAS);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      var id = s_(data.id) || gerarId_(aba, 'CT'); // aceita id do cliente (espelho fire-and-forget)
      if (data.id && acharLinhaPorChave_(aba, 'ID', id) !== -1) return { status: 'error', message: 'Construtora já existe.' };
      aba.appendRow([
        id, data.nome || '', data.telefone || '', data.site || '', data.viabilizador || '',
        data.telefoneViabilizador || '', data.comissaoPct || 0, data.linkDrive || '', agora_(),
        data.estadosAtuacao || '', data.cidadesAtuacao || '', data.observacoes || '', true, data.chavePix || ''
      ]);
      registrarLogSensivel_(auth.nome, 'feirao_construtora_criar', id);
      return { status: 'ok', id: id };
    }
    var linha = acharLinhaPorChave_(aba, 'ID', data.id);
    if (linha === -1) return { status: 'error', message: 'Construtora não encontrada.' };
    if (data.operacao === 'excluir') {
      var emUso = acharLinhaPorChave_(ss.getSheetByName(ABA_EMPREENDIMENTOS), 'Construtora_ID', data.id);
      if (emUso !== -1) return { status: 'error', message: 'Existe(m) empreendimento(s) vinculado(s) a esta construtora — remova ou realoque antes de excluir.' };
      aba.deleteRow(linha);
      registrarLogSensivel_(auth.nome, 'feirao_construtora_excluir', data.id);
      return { status: 'ok' };
    }
    if (data.operacao === 'ativar' || data.operacao === 'desativar') {
      aba.getRange(linha, 13).setValue(data.operacao === 'ativar');
      return { status: 'ok' };
    }
    if (data.operacao === 'atualizar') {
      var campos = ['Nome', 'Telefone', 'Site', 'Viabilizador', 'Telefone_Viabilizador', 'Comissao_%', 'Link_Drive', 'Estados_de_Atuacao', 'Cidades_de_Atuacao', 'Observacoes', 'Chave_PIX'];
      var chaves = ['nome', 'telefone', 'site', 'viabilizador', 'telefoneViabilizador', 'comissaoPct', 'linkDrive', 'estadosAtuacao', 'cidadesAtuacao', 'observacoes', 'chavePix'];
      var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
      campos.forEach(function (campoHeader, idx) {
        if (data[chaves[idx]] !== undefined) aba.getRange(linha, headers.indexOf(campoHeader) + 1).setValue(data[chaves[idx]]);
      });
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

function feirao_listarConstrutoras_(p) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_CONSTRUTORAS));
  if (p && p.somenteAtivas) itens = itens.filter(function (c) { return c.Ativa === true; });
  return itens.map(function (c) {
    return {
      id: s_(c.ID), nome: s_(c.Nome), telefone: s_(c.Telefone), site: s_(c.Site),
      viabilizador: s_(c.Viabilizador), telefoneViabilizador: s_(c.Telefone_Viabilizador),
      comissaoPct: Number(c['Comissao_%']) || 0, linkDrive: s_(c.Link_Drive), dataInclusao: c.Data_Inclusao,
      estadosAtuacao: s_(c.Estados_de_Atuacao), cidadesAtuacao: s_(c.Cidades_de_Atuacao),
      observacoes: s_(c.Observacoes), chavePix: s_(c.Chave_PIX), ativa: c.Ativa !== false
    };
  });
}

/* ══════════════════════ EMPREENDIMENTOS / UNIDADES (Viabilizador) ═══ */
function feirao_empreendimentoCrud_(data) {
  var auth = autorizarAcao_(data.authPin, ['viabilizador', 'superintendente', 'diretor_operacional', 'diretor_torre', 'gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_EMPREENDIMENTOS);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      if (auth.construtora && data.construtora && data.construtora !== auth.construtora) {
        return { status: 'error', message: 'Você só pode cadastrar empreendimentos da sua construtora.' };
      }
      if (!data.construtoraId) return { status: 'error', message: 'Empreendimento precisa estar vinculado a uma construtora (construtoraId obrigatório).' };
      var construtoraRow = acharLinhaPorChave_(ss.getSheetByName(ABA_CONSTRUTORAS), 'ID', data.construtoraId);
      if (construtoraRow === -1) return { status: 'error', message: 'Construtora não encontrada.' };
      var construtoraNome = s_(ss.getSheetByName(ABA_CONSTRUTORAS).getRange(construtoraRow, 2).getValue());
      var id = s_(data.id) || gerarId_(aba, 'EMP'); // aceita id do cliente (espelho fire-and-forget)
      if (data.id && acharLinhaPorChave_(aba, 'Id', id) !== -1) return { status: 'error', message: 'Empreendimento já existe.' };
      aba.appendRow([
        id, data.nome || '', data.construtoraId, construtoraNome, data.bairro || '', data.cidade || '',
        data.uf || '', data.tipoImovel || '', data.entrega || '', data.entrada || '', data.sinal || '',
        data.condicoes || '', data.condFeirao || '', agora_(),
        data.descricaoImovel || '', data.tipologia || '', data.faixaValor || '', data.valorAPartirDe || 0,
        data.qtdUnidades || 0, data.dataCadastro || agora_(), data.urlImagem || '', data.linkDrive || '',
        data.linkBlogger || '', !!data.destaquePaginaPrincipal, data.obsInterna || '',
        data.ativo === undefined ? true : !!data.ativo
      ]);
      return { status: 'ok', id: id };
    }
    var linha = acharLinhaPorChave_(aba, 'Id', data.id);
    if (linha === -1) return { status: 'error', message: 'Empreendimento não encontrado.' };
    var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    if (auth.construtora && s_(aba.getRange(linha, headers.indexOf('Construtora') + 1).getValue()) !== auth.construtora) {
      return { status: 'error', message: 'Sem permissão sobre empreendimento de outra construtora.' };
    }
    if (data.operacao === 'excluir') { aba.deleteRow(linha); return { status: 'ok' }; }
    if (data.operacao === 'ativar' || data.operacao === 'desativar') {
      aba.getRange(linha, headers.indexOf('Ativo') + 1).setValue(data.operacao === 'ativar');
      return { status: 'ok' };
    }
    if (data.operacao === 'atualizar') {
      if (data.construtoraId !== undefined) {
        var novaConstrutoraRow = acharLinhaPorChave_(ss.getSheetByName(ABA_CONSTRUTORAS), 'ID', data.construtoraId);
        if (novaConstrutoraRow === -1) return { status: 'error', message: 'Construtora não encontrada.' };
        var novoNome = s_(ss.getSheetByName(ABA_CONSTRUTORAS).getRange(novaConstrutoraRow, 2).getValue());
        aba.getRange(linha, headers.indexOf('Construtora_ID') + 1).setValue(data.construtoraId);
        aba.getRange(linha, headers.indexOf('Construtora') + 1).setValue(novoNome);
      }
      var campos = ['Nome', 'Bairro', 'Cidade', 'UF', 'Tipo_Imovel', 'Entrega', 'Entrada', 'Sinal', 'Condicoes', 'Cond_Feirao',
        'Descricao_do_Imovel', 'Tipologia', 'Faixa_de_Valor', 'Valor_a_Partir_De', 'Qtd_Unidades', 'Data_Cadastro',
        'URL_da_Imagem', 'Link_Drive', 'Link_Blogger', 'Destaque_Pagina_Principal', 'Obs_Interna', 'Ativo'];
      var chaves = ['nome', 'bairro', 'cidade', 'uf', 'tipoImovel', 'entrega', 'entrada', 'sinal', 'condicoes', 'condFeirao',
        'descricaoImovel', 'tipologia', 'faixaValor', 'valorAPartirDe', 'qtdUnidades', 'dataCadastro',
        'urlImagem', 'linkDrive', 'linkBlogger', 'destaquePaginaPrincipal', 'obsInterna', 'ativo'];
      campos.forEach(function (campoHeader, idx) {
        if (data[chaves[idx]] !== undefined) aba.getRange(linha, headers.indexOf(campoHeader) + 1).setValue(data[chaves[idx]]);
      });
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

function feirao_listarEmpreendimentos_(filtro) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_EMPREENDIMENTOS));
  if (filtro) itens = itens.filter(function (e) { return s_(e.Construtora) === filtro || s_(e.Construtora_ID) === filtro; });
  return itens.map(function (e) {
    return {
      id: s_(e.Id), nome: s_(e.Nome), construtoraId: s_(e.Construtora_ID), construtora: s_(e.Construtora),
      bairro: s_(e.Bairro), cidade: s_(e.Cidade), uf: s_(e.UF), tipoImovel: s_(e.Tipo_Imovel),
      entrega: dataBR_(e.Entrega), entrada: s_(e.Entrada), sinal: s_(e.Sinal), condicoes: s_(e.Condicoes),
      // Cond_Feirao agora é o TEXTO da condição especial (ex.: "5% de
      // desconto à vista"); linhas antigas com booleano viram texto vazio.
      condFeirao: (e.Cond_Feirao === true || e.Cond_Feirao === false) ? '' : s_(e.Cond_Feirao), criadoEm: e.Criado_em,
      descricaoImovel: s_(e.Descricao_do_Imovel), tipologia: s_(e.Tipologia), faixaValor: s_(e.Faixa_de_Valor),
      valorAPartirDe: Number(e.Valor_a_Partir_De) || 0, qtdUnidades: Number(e.Qtd_Unidades) || 0,
      dataCadastro: e.Data_Cadastro, urlImagem: s_(e.URL_da_Imagem), linkDrive: s_(e.Link_Drive),
      linkBlogger: s_(e.Link_Blogger), destaquePaginaPrincipal: !!e.Destaque_Pagina_Principal,
      obsInterna: s_(e.Obs_Interna), ativo: e.Ativo !== false
    };
  });
}

function feirao_unidadeCrud_(data) {
  var papeis = ['viabilizador', 'superintendente', 'diretor_operacional', 'diretor_torre', 'gerente_atendimento'];
  // atendente só muda STATUS (marca proposta/reserva/assinatura ao avançar o
  // lead) — criar/editar/excluir unidades segue restrito aos papéis acima
  if (data.operacao === 'status') papeis.push('atendente');
  var auth = autorizarAcao_(data.authPin, papeis);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_UNIDADES);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      // aceita o id do cliente: os dashboards espelham via no-cors (fire-and-
      // forget) e não conseguem ler o id gerado — mandando o próprio id, o
      // registro local e o da planilha ficam sempre iguais.
      var id = s_(data.id) || gerarId_(aba, 'UN');
      if (data.id && acharLinhaPorChave_(aba, 'Id', id) !== -1) return { status: 'error', message: 'Unidade já existe.' };
      aba.appendRow([id, data.empId || '', data.blocoTorre || '', data.unidade || '', data.tipologia || '', data.valor || 0, data.status || 'disponivel', agora_()]);
      return { status: 'ok', id: id };
    }
    var linha = acharLinhaPorChave_(aba, 'Id', data.id);
    if (linha === -1) return { status: 'error', message: 'Unidade não encontrada.' };
    if (data.operacao === 'excluir') { aba.deleteRow(linha); return { status: 'ok' }; }
    if (data.operacao === 'status') {
      if (STATUS_UNIDADE.indexOf(data.status) === -1) return { status: 'error', message: 'Status inválido.' };
      aba.getRange(linha, 7).setValue(data.status);
      aba.getRange(linha, 8).setValue(agora_());
      return { status: 'ok' };
    }
    if (data.operacao === 'atualizar') {
      if (data.blocoTorre !== undefined) aba.getRange(linha, 3).setValue(data.blocoTorre);
      if (data.unidade !== undefined) aba.getRange(linha, 4).setValue(data.unidade);
      if (data.tipologia !== undefined) aba.getRange(linha, 5).setValue(data.tipologia);
      if (data.valor !== undefined) aba.getRange(linha, 6).setValue(data.valor);
      aba.getRange(linha, 8).setValue(agora_());
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

function feirao_listarUnidades_(empId) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_UNIDADES));
  if (empId) itens = itens.filter(function (u) { return s_(u.Emp_Id) === s_(empId); });
  return itens.map(function (u) {
    return { id: s_(u.Id), empId: s_(u.Emp_Id), blocoTorre: s_(u.Bloco_Torre), unidade: s_(u.Unidade), tipologia: s_(u.Tipologia), valor: Number(u.Valor) || 0, status: s_(u.Status) || 'novo' };
  });
}

/* ══════════════════════ SOLICITAÇÕES AO VIABILIZADOR ═════════════════ */
function feirao_solicitacaoCrud_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_SOLICITACOES);

  if (data.operacao === 'criar') {
    var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
    if (!auth.ok) return { status: 'error', message: auth.erro };
    return comLock_(function () {
      var id = gerarId_(aba, 'SV');
      aba.appendRow([id, data.tipo || 'outro', data.empId || '', auth.nome, normalizarEmail_(data.emailLead), data.descricao || '', data.valor || 0, 'pendente', '', agora_(), '']);
      return { status: 'ok', id: id };
    });
  }
  if (data.operacao === 'decidir') {
    var authV = autorizarAcao_(data.authPin, ['viabilizador', 'superintendente', 'diretor_operacional']);
    if (!authV.ok) return { status: 'error', message: authV.erro };
    if (['aprovado', 'recusado'].indexOf(data.status) === -1) return { status: 'error', message: 'Status inválido.' };
    return comLock_(function () {
      var linha = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linha === -1) return { status: 'error', message: 'Solicitação não encontrada.' };
      aba.getRange(linha, 8, 1, 3).setValues([[data.status, data.parecer || '', agora_()]]);
      return { status: 'ok' };
    });
  }
  return { status: 'error', message: 'Operação inválida.' };
}

function feirao_listarSolicitacoes_(p) {
  var auth = autorizarAcao_(p.authPin, ['viabilizador', 'superintendente', 'diretor_operacional', 'atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_SOLICITACOES));
  return {
    ok: true,
    itens: itens.map(function (s) {
      return { id: s_(s.Id), tipo: s_(s.Tipo), empId: s_(s.Emp_Id), atendenteNome: s_(s.Atendente_Nome), emailLead: s_(s.Email_Lead), descricao: s_(s.Descricao), valor: Number(s.Valor) || 0, status: s_(s.Status), parecer: s_(s.Parecer), criadoEm: s.Criado_em };
    })
  };
}

/* ══════════════════════ RESERVAS (Gerente/Atendente) ═════════════════
   Upsert por Id: o dashboard envia o próprio id (fire-and-forget via
   no-cors não devolve resposta), então criar e atualizar são a mesma
   operação — se o Id já existe atualiza, senão insere. */
var RESERVA_CAMPOS_ = [
  ['Email_Lead', 'emailLead'], ['Cliente_Nome', 'clienteNome'], ['Cliente_CPF', 'clienteCpf'],
  ['Cliente_Telefone', 'clienteTelefone'], ['Orgao', 'orgao'], ['Patente', 'patente'],
  ['Renda_Declarada', 'rendaDeclarada'], ['Renda_Conjuge', 'rendaConjuge'], ['Atendente_Id', 'atendenteId'],
  ['Emp_Nome', 'empNome'], ['Unidade_Desc', 'unidadeDesc'], ['Valor_Unidade', 'valorUnidade'],
  ['Valor_Sinal', 'valorSinal'], ['Status', 'status'], ['Parecer_Viabilizador', 'parecerViabilizador'],
  ['Parecer_Data', 'parecerData'], ['Email_Enviado', 'emailEnviado'],
  ['Docs_Cliente_JSON', 'docsClienteJson'], ['Conjuge_JSON', 'conjugeJson']
];
function feirao_reservaCrud_(data) {
  var auth = autorizarAcao_(data.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_RESERVAS);
  if (!aba) return { status: 'error', message: 'Aba RESERVAS não existe — rode setupFase1() no editor.' };

  return comLock_(function () {
    if (data.operacao === 'remover') {
      var linhaDel = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linhaDel === -1) return { status: 'error', message: 'Reserva não encontrada.' };
      aba.deleteRow(linhaDel);
      return { status: 'ok' };
    }
    var id = s_(data.id) || gerarId_(aba, 'RSV');
    var headers = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var linha = acharLinhaPorChave_(aba, 'Id', id);
    var now = agora_();
    if (linha === -1) {
      var nova = headers.map(function (h) {
        if (h === 'Id') return id;
        if (h === 'Criado_em') return data.criadoEm || now;
        if (h === 'Atualizado_em') return now;
        var campo = RESERVA_CAMPOS_.find(function (c) { return c[0] === h; });
        return campo && data[campo[1]] !== undefined ? data[campo[1]] : '';
      });
      aba.appendRow(nova);
    } else {
      RESERVA_CAMPOS_.forEach(function (c) {
        if (data[c[1]] === undefined) return;
        var col = headers.indexOf(c[0]) + 1;
        if (col >= 1) aba.getRange(linha, col).setValue(data[c[1]]);
      });
      var colAtu = headers.indexOf('Atualizado_em') + 1;
      if (colAtu >= 1) aba.getRange(linha, colAtu).setValue(now);
    }
    return { status: 'ok', id: id };
  });
}

function feirao_listarReservas_(p) {
  var auth = autorizarAcao_(p.authPin, ['atendente', 'gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_RESERVAS);
  if (!aba) return { ok: true, itens: [] };
  return {
    ok: true,
    itens: lerAbaObjetos_(aba).map(function (r) {
      var obj = { id: s_(r.Id), criadoEm: s_(r.Criado_em), atualizadoEm: s_(r.Atualizado_em) };
      RESERVA_CAMPOS_.forEach(function (c) { obj[c[1]] = (r[c[0]] === undefined) ? '' : r[c[0]]; });
      return obj;
    })
  };
}

/* ══════════════════════ ESCALONAMENTOS (Superintendente → Diretor op.) */
function feirao_escalonamentoCrud_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_ESCALONAMENTOS);

  if (data.operacao === 'criar') {
    var auth = autorizarAcao_(data.authPin, ['viabilizador', 'superintendente']);
    if (!auth.ok) return { status: 'error', message: auth.erro };
    return comLock_(function () {
      var id = gerarId_(aba, 'ESC');
      aba.appendRow([id, data.empId || '', data.tipo || '', data.descricao || '', data.valor || 0, 'pendente', agora_(), '', '']);
      return { status: 'ok', id: id };
    });
  }
  if (data.operacao === 'encaminhar') {
    var authS = autorizarAcao_(data.authPin, ['superintendente']);
    if (!authS.ok) return { status: 'error', message: authS.erro };
    return comLock_(function () {
      var linha = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linha === -1) return { status: 'error', message: 'Não encontrado.' };
      aba.getRange(linha, 6).setValue('encaminhado');
      return { status: 'ok' };
    });
  }
  if (data.operacao === 'decidir') {
    var authD = autorizarAcao_(data.authPin, ['superintendente', 'diretor_operacional']);
    if (!authD.ok) return { status: 'error', message: authD.erro };
    var sufixo = authD.papel === 'diretor_operacional' ? '_diretoria' : '';
    if (['aprovado', 'recusado'].indexOf(data.status) === -1) return { status: 'error', message: 'Status inválido.' };
    return comLock_(function () {
      var linha = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linha === -1) return { status: 'error', message: 'Não encontrado.' };
      aba.getRange(linha, 6, 1, 3).setValues([[data.status + sufixo, data.despacho || '', agora_()]]);
      return { status: 'ok' };
    });
  }
  return { status: 'error', message: 'Operação inválida.' };
}

function feirao_listarEscalonamentos_(p) {
  var auth = autorizarAcao_(p.authPin, ['viabilizador', 'superintendente', 'diretor_operacional']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_ESCALONAMENTOS));
  return {
    ok: true,
    itens: itens.map(function (e) {
      return { id: s_(e.Id), empId: s_(e.Emp_Id), tipo: s_(e.Tipo), descricao: s_(e.Descricao), valor: Number(e.Valor) || 0, status: s_(e.Status), criadoEm: e.Criado_em, despacho: s_(e.Despacho) };
    })
  };
}

/* ══════════════════════ ATENDENTES (CRUD do Gerente) ════════════════ */
function feirao_atendenteCrud_(data) {
  var auth = autorizarAcao_(data.authPin, ['gerente_atendimento']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_ATENDENTES);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      var ativos = lerAbaObjetos_(aba).filter(function (a) { return a.Ativo === true; });
      if (ativos.length >= 20) return { status: 'error', message: 'Limite de 20 atendentes ativos atingido.' };
      if (!/^[0-9]{4,6}$/.test(s_(data.pin))) return { status: 'error', message: 'PIN deve ter de 4 a 6 dígitos.' };
      var id = gerarId_(aba, 'AT');
      aba.appendRow([id, data.nome || '', data.whatsapp || '', String(data.pin), true, agora_()]);
      return { status: 'ok', id: id };
    }
    var linha = acharLinhaPorChave_(aba, 'Id', data.id);
    if (linha === -1) return { status: 'error', message: 'Atendente não encontrado.' };
    if (data.operacao === 'toggle') { aba.getRange(linha, 5).setValue(!aba.getRange(linha, 5).getValue()); return { status: 'ok' }; }
    if (data.operacao === 'remover') { aba.deleteRow(linha); return { status: 'ok' }; }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

/* Listagem completa para o painel do Gerente — inclui PIN, WhatsApp e
   inativos, por isso exige o PIN do gerente (a pública só devolve
   id + nome dos ativos, para a tela de login). */
function feirao_listarAtendentesAdmin_(p) {
  var auth = autorizarAcao_(p.authPin, ['gerente_atendimento']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  return {
    ok: true,
    itens: lerAbaObjetos_(ss.getSheetByName(ABA_ATENDENTES)).map(function (a) {
      return { id: s_(a.Id), nome: s_(a.Nome), whatsapp: s_(a.WhatsApp), pin: s_(a.Pin), ativo: a.Ativo === true, criadoEm: s_(a.Criado_em) };
    })
  };
}

/* ══════════════════════ AGENTES (cadastro + CRUD do Diretor) ════════ */
function hashSenha_(senha) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(senha), Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function feirao_agenteCrud_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_AGENTES);

  if (data.operacao === 'cadastrar') {
    // Auto-serviço público — status inicial sempre "pendente", exige aprovação do Diretor.
    var email = normalizarEmail_(data.email);
    if (!email || !data.senha) return { status: 'error', message: 'E-mail e senha são obrigatórios.' };
    return comLock_(function () {
      if (acharLinhaPorChave_(aba, 'Email', email) !== -1) return { status: 'error', message: 'Já existe um cadastro com este e-mail.' };
      var id = gerarId_(aba, 'AG');
      aba.appendRow([id, data.nome || '', email, data.cpf || '', data.whatsapp || '', data.nascimento || '', data.profissao || '', hashSenha_(data.senha), 'pendente', false, agora_()]);
      return { status: 'ok', id: id };
    });
  }
  if (data.operacao === 'login') {
    var email2 = normalizarEmail_(data.email);
    var linhas = lerAbaObjetos_(aba);
    var achado = linhas.find(function (a) { return normalizarEmail_(a.Email) === email2; });
    if (!achado || achado.Senha_Hash !== hashSenha_(data.senha)) return { found: false };
    return { found: true, id: s_(achado.Id), nome: s_(achado.Nome), status: s_(achado.Status), habilitado: !!achado.Habilitado };
  }
  if (data.operacao === 'habilitar') {
    var auth = autorizarAcao_(data.authPin, ['diretor_torre']);
    if (!auth.ok) return { status: 'error', message: auth.erro };
    return comLock_(function () {
      var linha = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linha === -1) return { status: 'error', message: 'Agente não encontrado.' };
      aba.getRange(linha, 9, 1, 2).setValues([['aprovado', true]]);
      return { status: 'ok' };
    });
  }
  return { status: 'error', message: 'Operação inválida.' };
}

function feirao_listarAgentes_(p) {
  var auth = autorizarAcao_(p.authPin, ['diretor_torre']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_AGENTES));
  return {
    ok: true,
    itens: itens.map(function (a) {
      return { id: s_(a.Id), nome: s_(a.Nome), email: s_(a.Email), cpf: s_(a.CPF), whatsapp: s_(a.WhatsApp), status: s_(a.Status), habilitado: !!a.Habilitado };
    })
  };
}

/* Dados bancários: o próprio agente PODE gravar os seus (self-service,
   necessário para receber comissão), mas só o Diretor pode LER de volta
   — toda leitura fica registrada em LOG_ACESSO_SENSIVEL. */
function feirao_agenteBancarioDefinir_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var abaAgentes = ss.getSheetByName(ABA_AGENTES);
  var linhaAgente = lerAbaObjetos_(abaAgentes).find(function (a) { return normalizarEmail_(a.Email) === normalizarEmail_(data.email); });
  if (!linhaAgente) return { status: 'error', message: 'Agente não encontrado.' };
  if (linhaAgente.Senha_Hash !== hashSenha_(data.senha)) return { status: 'error', message: 'Senha incorreta.' };

  return comLock_(function () {
    var aba = ss.getSheetByName(ABA_AGENTES_BANCO);
    var linha = acharLinhaPorChave_(aba, 'Agente_Id', linhaAgente.Id);
    var row = [linhaAgente.Id, data.banco || '', data.agencia || '', data.conta || '', data.tipoConta || '', data.pix || '', agora_()];
    if (linha === -1) aba.appendRow(row); else aba.getRange(linha, 1, 1, row.length).setValues([row]);
    return { status: 'ok' };
  });
}

function feirao_agenteBancarioConsultar_(p) {
  var auth = autorizarAcao_(p.authPin, ['diretor_torre']);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_AGENTES_BANCO));
  var achado = itens.find(function (i) { return s_(i.Agente_Id) === s_(p.agenteId); });
  registrarLogSensivel_(auth.nome, 'feirao_agente_bancario', s_(p.agenteId));
  if (!achado) return { ok: true, found: false };
  return { ok: true, found: true, banco: s_(achado.Banco), agencia: s_(achado.Agencia), conta: s_(achado.Conta), tipoConta: s_(achado.Tipo_Conta), pix: s_(achado.Pix) };
}

/* ══════════════════════ COMISSÕES / INDICAÇÕES ═══════════════════════ */
function feirao_comissaoCrud_(data) {
  var auth = autorizarAcao_(data.authPin, ['diretor_torre']);
  if (!auth.ok) return { status: 'error', message: auth.erro };
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_COMISSOES);

  return comLock_(function () {
    if (data.operacao === 'criar') {
      var id = gerarId_(aba, 'CM');
      aba.appendRow([id, data.tipo || 'agente', data.pessoaId || '', data.pessoaNome || '', data.cliente || '', data.empId || '', data.valor || 0, 'aguardando', agora_()]);
      return { status: 'ok', id: id };
    }
    if (data.operacao === 'atualizar') {
      var linha = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linha === -1) return { status: 'error', message: 'Comissão não encontrada.' };
      if (['aguardando', 'pago', 'cancelado'].indexOf(data.status) === -1) return { status: 'error', message: 'Status inválido.' };
      aba.getRange(linha, 8).setValue(data.status);
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

function feirao_listarComissoes_(p) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var itens = lerAbaObjetos_(ss.getSheetByName(ABA_COMISSOES));
  // Diretor vê tudo; um agente (por e-mail) vê só as próprias.
  if (p.email) {
    var abaAgentes = ss.getSheetByName(ABA_AGENTES);
    var agente = lerAbaObjetos_(abaAgentes).find(function (a) { return normalizarEmail_(a.Email) === normalizarEmail_(p.email); });
    if (!agente) return { ok: true, itens: [] };
    itens = itens.filter(function (c) { return s_(c.Pessoa_Id) === s_(agente.Id); });
  } else {
    var auth = autorizarAcao_(p.authPin, ['diretor_torre']);
    if (!auth.ok) return { ok: false, erro: auth.erro };
  }
  return {
    ok: true,
    itens: itens.map(function (c) { return { id: s_(c.Id), tipo: s_(c.Tipo), cliente: s_(c.Cliente), empId: s_(c.Emp_Id), valor: Number(c.Valor) || 0, status: s_(c.Status), data: c.Data }; })
  };
}

function feirao_indicacaoCrud_(data) {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_INDICACOES);
  var abaAgentes = ss.getSheetByName(ABA_AGENTES);
  var agente = lerAbaObjetos_(abaAgentes).find(function (a) { return normalizarEmail_(a.Email) === normalizarEmail_(data.emailAgente); });
  if (!agente || agente.Senha_Hash !== hashSenha_(data.senhaAgente)) return { status: 'error', message: 'Sessão de agente inválida.' };

  return comLock_(function () {
    if (data.operacao === 'criar') {
      var id = gerarId_(aba, 'IN');
      aba.appendRow([id, agente.Id, data.nomeCliente || '', data.telefone || '', data.email || '', data.empId || '', data.orcamento || '', data.interesse || '', 'agente', agora_()]);
      return { status: 'ok', id: id };
    }
    if (data.operacao === 'atualizar') {
      var linha = acharLinhaPorChave_(aba, 'Id', data.id);
      if (linha === -1) return { status: 'error', message: 'Indicação não encontrada.' };
      if (s_(aba.getRange(linha, 2).getValue()) !== agente.Id) return { status: 'error', message: 'Sem permissão sobre esta indicação.' };
      if (data.status !== undefined) aba.getRange(linha, 9).setValue(data.status);
      return { status: 'ok' };
    }
    return { status: 'error', message: 'Operação inválida.' };
  });
}

/* ══════════════════════ ESTATÍSTICAS "AO VIVO" ═══════════════════════ */
function feirao_stats_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('feirao_stats');
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var base = 0;
  var abaConfig = ss.getSheetByName(ABA_CONFIG);
  if (abaConfig) {
    var cfg = lerAbaObjetos_(abaConfig);
    var linhaBase = cfg.find(function (l) { return l.Chave === 'Negocios_Fechados_Base'; });
    if (linhaBase) base = Number(linhaBase.Valor) || base;
  }

  var confirmados = 0;
  var abaPix = ss.getSheetByName(ABA_PIX);
  if (abaPix) confirmados += lerAbaObjetos_(abaPix).filter(function (l) { return l.Status === 'autodeclarado_pendente_confirmacao' || l.Status === 'confirmado'; }).length;

  var abaCredito = ss.getSheetByName(ABA_CREDITO);
  var aprovados = 0;
  if (abaCredito) aprovados = lerAbaObjetos_(abaCredito).filter(function (l) { return l.Sub_Status === 'aprovado'; }).length;

  var result = { negociosFechados: base + confirmados, aprovacoesCredito: aprovados };
  cache.put('feirao_stats', JSON.stringify(result), 120);
  return result;
}

/* ══════════════════════ FILA DE NOTIFICAÇÕES ═════════════════════════
   Efeitos colaterais lentos (e-mail) nunca bloqueiam a resposta ao
   usuário. `corpoDireto`/`assuntoDireto` no payload permitem mandar um
   e-mail de conteúdo fixo (usado pelo código OTP de login); sem eles, o
   e-mail vira um aviso interno em JSON para a equipe. */
function enfileirarNotificacao_(tipo, destinatario, payload) {
  try {
    var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
    ss.getSheetByName(ABA_FILA).appendRow([tipo, destinatario, JSON.stringify(payload), false, agora_()]);
  } catch (e) { Logger.log('enfileirarNotificacao_ erro: ' + e.message); }
}

/* Envio via API transacional do Brevo, não mais MailApp.sendEmail() — o
   Google restringe envio automatizado (Apps Script/SMTP relay) para
   domínios externos em contas Workspace novas, até acumular um valor
   faturado + um tempo mínimo de conta paga (confirmado pelo Suporte
   Google em 18/07/2026). Ver documentacao-tecnica-backend-unificado.html.
   Requer a propriedade de script BREVO_API_KEY configurada (Apps Script
   → ⚙️ Configurações do projeto → Propriedades do script — nunca deixar
   a chave escrita direto no código-fonte). */
var BREVO_SENDER_EMAIL = 'wal@walservidor.com.br'; // precisa ser um remetente "Verificado" no Brevo
var BREVO_SENDER_NOME  = 'WAL Imóveis — Feirão';

function brevoApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
}

function processarFilaNotificacoes() {
  var ss = SpreadsheetApp.openById(PLANILHA_FEIRAO_ID);
  var aba = ss.getSheetByName(ABA_FILA);
  var dados = aba.getDataRange().getValues();
  var apiKey = brevoApiKey_();
  for (var i = 1; i < dados.length; i++) {
    if (dados[i][3] === true) continue;
    var tipo = dados[i][0], destinatario = dados[i][1];
    var payload = {};
    try { payload = JSON.parse(dados[i][2] || '{}'); } catch (e) {}
    try {
      if (!apiKey) throw new Error('BREVO_API_KEY não configurada nas Propriedades do script.');
      var resp = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'api-key': apiKey, accept: 'application/json' },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          sender: { name: BREVO_SENDER_NOME, email: BREVO_SENDER_EMAIL },
          to: [{ email: destinatario }],
          subject: payload.assuntoDireto || ('🎪 Feirão WAL — ' + tipo),
          textContent: payload.corpoDireto || JSON.stringify(payload, null, 2)
        })
      });
      var codigoResp = resp.getResponseCode();
      if (codigoResp >= 200 && codigoResp < 300) {
        aba.getRange(i + 1, 4).setValue(true);
      } else {
        Logger.log('processarFilaNotificacoes erro linha ' + (i + 1) + ': Brevo respondeu ' + codigoResp + ' — ' + resp.getContentText());
      }
    } catch (e) { Logger.log('processarFilaNotificacoes erro linha ' + (i + 1) + ': ' + e.message); }
  }
}
