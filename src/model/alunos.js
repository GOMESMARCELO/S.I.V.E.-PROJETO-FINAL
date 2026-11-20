// Model: consulta de aluno com a regra de quem pode vê-lo.
const db = require("./db");
const { nomeTurma } = require("./utilitarios");

// Quem pode mexer na ficha de um aluno: gestão (todos), professor (só a própria turma), responsável (só o próprio filho)
async function alunoPermitido(usuario, alunoId) {
  const [[aluno]] = await db.query(`SELECT id_aluno AS id, nome AS nome, ${nomeTurma("tb_alunos")} AS sala, matricula AS matricula, situacao AS situacao, DATE_FORMAT(situacao_em, '%d/%m/%Y') AS situacao_em, situacao_motivo AS situacao_motivo FROM tb_alunos WHERE id_aluno = ?`, [alunoId]);
  if (!aluno) return null;
  if (usuario.papel === "admin") return aluno;
  if (usuario.papel === "professor" && usuario.turmas.includes(aluno.sala)) return aluno;
  if (usuario.papel === "pai" && usuario.filhos.includes(aluno.id)) return aluno;
  return null;
}

module.exports = { alunoPermitido };
