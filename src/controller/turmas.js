// Controller: o que cada endereço da API faz — turmas.
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { rota } = require("../middlewares/rota");
const { nomeTurma } = require("../model/utilitarios");

// ---------- Turmas (só administração) ----------
// Renomear uma turma atualiza alunos, professores, comunicados e eventos (ON UPDATE CASCADE no banco).
const TURNOS = ["Manhã", "Tarde", "Integral", "Noite"];
function lerTurma(b) {
  const nome = String(b.nome || "").trim().replace(/\s+/g, " "), ano = Number(b.ano_letivo), turno = b.turno ? String(b.turno) : null;
  if (!nome || nome.length > 40) return { erro: "Informe o nome da turma (até 40 caracteres)." };
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return { erro: "Informe o ano letivo (ex.: 2026)." };
  if (turno && !TURNOS.includes(turno)) return { erro: "Turno inválido." };
  return { nome, ano, turno };
}
const listarTurmas = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT t.id_turma AS id, t.nome AS nome, t.ano_letivo AS ano_letivo, t.turno AS turno, t.ativa AS ativa,
    (SELECT COUNT(*) FROM tb_alunos a WHERE ${nomeTurma("a")} = t.nome AND a.situacao = 'Ativo') AS alunos,
    (SELECT GROUP_CONCAT(u.nome ORDER BY u.nome SEPARATOR ', ') FROM tb_professor_turma pt JOIN tb_usuarios u ON u.id_usuario = pt.id_usuario WHERE pt.id_turma = t.id_turma) AS professores
    FROM tb_turmas t ORDER BY t.ativa DESC, t.ano_letivo DESC, t.nome`);
  res.json(linhas.map((l) => ({ ...l, ativa: !!l.ativa })));
});
const criarTurma = rota(async (req, res) => {
  const t = lerTurma(req.body);
  if (t.erro) return res.status(400).json({ erro: t.erro });
  try { await db.query("INSERT INTO tb_turmas (nome, ano_letivo, turno) VALUES (?, ?, ?)", [t.nome, t.ano, t.turno]); }
  catch (erro) { if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe uma turma com esse nome." }); throw erro; }
  await registrarLog(req.usuario, "turma_criada", `${t.nome} (${t.ano})`);
  res.status(201).json({ ok: true });
});
const atualizarTurma = rota(async (req, res) => {
  const t = lerTurma(req.body);
  if (t.erro) return res.status(400).json({ erro: t.erro });
  const [[antes]] = await db.query("SELECT nome AS nome FROM tb_turmas WHERE id_turma = ?", [req.params.id]);
  if (!antes) return res.status(404).json({ erro: "Turma não encontrada." });
  try { await db.query("UPDATE tb_turmas SET nome = ?, ano_letivo = ?, turno = ?, ativa = ? WHERE id_turma = ?", [t.nome, t.ano, t.turno, req.body.ativa !== false, req.params.id]); }
  catch (erro) { if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe uma turma com esse nome." }); throw erro; }
  await registrarLog(req.usuario, "turma_alterada", antes.nome === t.nome ? t.nome : `${antes.nome} → ${t.nome}`);
  res.json({ ok: true });
});

module.exports = { TURNOS, lerTurma, listarTurmas, criarTurma, atualizarTurma };
