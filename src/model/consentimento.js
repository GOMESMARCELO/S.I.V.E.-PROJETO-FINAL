// Model: situação do termo de consentimento de cada aluno.
const db = require("./db");
const { CONSENTIMENTO } = require("../view/consentimento");

const OPCOES_CONSENTIMENTO = CONSENTIMENTO.opcoes.map((o) => o.id);
// pendente (nunca assinou esta versão) | autorizado (todos os itens) | parcial (alguns) | nao_autorizado (nenhum, inclui revogação)
function statusConsentimento(c) {
  if (!c) return "pendente";
  const n = OPCOES_CONSENTIMENTO.filter((id) => c[id]).length;
  return n === OPCOES_CONSENTIMENTO.length ? "autorizado" : n === 0 ? "nao_autorizado" : "parcial";
}
// completo = false (professor): só vê o estado e as escolhas, sem o nome de quem assinou, o código e o histórico
async function consentimentoDoAluno(alunoId, completo) {
  const [linhas] = await db.query("SELECT id_consentimento AS id, versao AS versao, informacoes AS informacoes, imagem AS imagem, monitoramento AS monitoramento, assinado_nome AS assinado_nome, DATE_FORMAT(assinado_em, '%d/%m/%Y %H:%i') AS assinado_em, codigo AS codigo FROM tb_consentimentos WHERE id_aluno = ? ORDER BY id_consentimento DESC", [alunoId]);
  const historico = linhas.map((c) => ({ ...c, informacoes: !!c.informacoes, imagem: !!c.imagem, monitoramento: !!c.monitoramento }));
  const atual = historico.find((c) => c.versao === CONSENTIMENTO.versao) || null;
  const resposta = { versao_atual: CONSENTIMENTO.versao, status: statusConsentimento(atual), atual: null };
  if (atual) resposta.atual = completo ? atual : { informacoes: atual.informacoes, imagem: atual.imagem, monitoramento: atual.monitoramento, assinado_em: atual.assinado_em };
  if (completo) resposta.historico = historico;
  return resposta;
}

module.exports = { OPCOES_CONSENTIMENTO, statusConsentimento, consentimentoDoAluno };
