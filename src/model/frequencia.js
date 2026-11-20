// Model: frequência e Busca Ativa (abertura automática de casos por excesso de faltas).
const db = require("./db");
const { SISTEMA, registrarLog } = require("./log");

// Critério da Busca Ativa: quantas faltas, em quantos dias, tornam o caso "significativo".
// Para mudar a regra, basta alterar estes dois números.
const BUSCA_ATIVA = { faltas: 5, dias: 30 };

// ---------- Busca Ativa: o sistema conta as faltas e abre os casos sozinho ----------
async function executarSincronizacao() {
  const [novos] = await db.query(`SELECT p.id_aluno AS aluno_id, COUNT(*) AS faltas FROM tb_presencas p
    WHERE p.status = 'Ausente' AND p.data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND p.data <= CURDATE()
      AND p.data > COALESCE((SELECT DATE(MAX(b.encerrada_em)) FROM tb_busca_ativa b WHERE b.id_aluno = p.id_aluno), '1900-01-01')
      AND p.id_aluno NOT IN (SELECT id_aluno FROM tb_busca_ativa WHERE status = 'Em acompanhamento')
    GROUP BY p.id_aluno HAVING COUNT(*) >= ?`, [BUSCA_ATIVA.dias, BUSCA_ATIVA.faltas]);
  for (const n of novos) {
    const [r] = await db.query("INSERT INTO tb_busca_ativa (id_aluno, faltas_ao_abrir) VALUES (?, ?)", [n.aluno_id, n.faltas]);
    await db.query("INSERT INTO tb_busca_ativa_registros (id_busca_ativa, id_usuario, nome_usuario, texto) VALUES (?, NULL, 'Sistema', ?)",
      [r.insertId, `Caso aberto automaticamente: ${n.faltas} faltas nos últimos ${BUSCA_ATIVA.dias} dias.`]);
    const [[a]] = await db.query("SELECT nome AS nome FROM tb_alunos WHERE id_aluno = ?", [n.aluno_id]);
    await registrarLog(SISTEMA, "busca_ativa_aberta", `${a.nome} (${n.faltas} faltas)`);
  }
}
// Fila simples: evita que duas telas abram o mesmo caso duas vezes ao mesmo tempo
let filaSync = Promise.resolve();
const sincronizarBuscaAtiva = () => (filaSync = filaSync.catch(() => {}).then(executarSincronizacao));

// Dia que os quadros mostram: hoje, se for dia de aula; no fim de semana, o último dia de aula com chamada registrada.
async function dataReferencia() {
  const [[r]] = await db.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje, DAYOFWEEK(CURDATE()) IN (1, 7) AS fim_de_semana,
    (SELECT DATE_FORMAT(MAX(data), '%Y-%m-%d') FROM tb_presencas WHERE data <= CURDATE() AND DAYOFWEEK(data) NOT IN (1, 7)) AS ultimo_dia_letivo`);
  return { data: r.fim_de_semana ? r.ultimo_dia_letivo || r.hoje : r.hoje, hoje: r.hoje, fim_de_semana: !!r.fim_de_semana };
}
const percentual = (presentes, ausentes) => (presentes + ausentes) ? Math.round(presentes * 1000 / (presentes + ausentes)) / 10 : null;

module.exports = { BUSCA_ATIVA, executarSincronizacao, filaSync, sincronizarBuscaAtiva, dataReferencia, percentual };
