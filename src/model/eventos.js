// Model: regras e consultas do calendário de eventos.
const db = require("./db");
const { nomeTurma } = require("./utilitarios");

// ---------- Calendário de eventos e banners ----------
const TIPOS_EVENTO = ["Evento", "Reunião", "Passeio", "Feriado", "Prazo"];
const TIPOS_BANNER = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const BANNER_MAXIMO = 2 * 1024 * 1024;
// Quem vê o quê: gestão vê tudo; professor vê os da escola toda e da própria turma; responsável, os da escola toda e da turma do filho.
async function filtroEventos(usuario) {
  if (usuario.papel === "admin") return { sql: "1 = 1", params: [] };
  let sala = usuario.sala;
  if (usuario.papel === "pai") sala = ((await db.query(`SELECT ${nomeTurma("tb_alunos")} AS sala FROM tb_alunos WHERE id_aluno = ?`, [usuario.aluno_id]))[0][0] || {}).sala;
  return { sql: `(${nomeTurma("e")} IS NULL OR ${nomeTurma("e")} = ?)`, params: [sala || ""] };
}
const CAMPOS_EVENTO = `e.id_evento AS id, e.titulo AS titulo, e.descricao AS descricao, e.tipo AS tipo, DATE_FORMAT(e.data, '%Y-%m-%d') AS data,
  DATE_FORMAT(e.data_fim, '%Y-%m-%d') AS data_fim, TIME_FORMAT(e.hora, '%H:%i') AS hora, e.local AS local, ${nomeTurma("e")} AS sala, e.destaque AS destaque,
  (e.banner_arquivo IS NOT NULL) AS tem_banner, e.criado_por_nome AS criado_por_nome, e.id_usuario AS criado_por_id`;

module.exports = { TIPOS_EVENTO, TIPOS_BANNER, BANNER_MAXIMO, filtroEventos, CAMPOS_EVENTO };
