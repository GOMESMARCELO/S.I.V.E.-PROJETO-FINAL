// Model: consultas de turmas.
const db = require("./db");

// A turma existe? (o banco também recusa, mas assim a mensagem é clara)
async function turmaExiste(nome) {
  const [[t]] = await db.query("SELECT nome AS nome FROM tb_turmas WHERE nome = ?", [String(nome || "").trim()]);
  return t ? t.nome : null;
}

module.exports = { turmaExiste };
