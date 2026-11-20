// Controller: o que cada endereço da API faz — chamada, frequência, Busca Ativa, entradas e saídas.
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { BUSCA_ATIVA, dataReferencia, percentual, sincronizarBuscaAtiva } = require("../model/frequencia");
const { dataValida, nomeTurma } = require("../model/utilitarios");
const { marcarPresencaPelaEntrada, statusAoVivo } = require("../model/monitoramento");
const { rota } = require("../middlewares/rota");

// ---------- Controle de frequência (só administração): todos os alunos em um dia ----------
const verFrequencia = rota(async (req, res) => {
  const ref = await dataReferencia();
  const data = dataValida(req.query.data) ? req.query.data : ref.data;
  const [alunos] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, p.status AS status, p.observacao AS observacao,
    (SELECT COUNT(*) FROM tb_presencas f WHERE f.id_aluno = a.id_aluno AND f.status = 'Ausente'
       AND f.data > DATE_SUB(?, INTERVAL ? DAY) AND f.data <= ?) AS faltas
    FROM tb_alunos a LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.data = ? WHERE a.situacao = 'Ativo' ORDER BY a.nome`,
    [data, BUSCA_ATIVA.dias, data, data]);
  const presentes = alunos.filter((a) => a.status === "Presente").length;
  const ausentes = alunos.filter((a) => a.status === "Ausente").length;
  res.json({ data, eh_hoje: data === ref.hoje, hoje: ref.hoje, fim_de_semana: ref.fim_de_semana && data === ref.data, dias_faltas: BUSCA_ATIVA.dias, limite_faltas: BUSCA_ATIVA.faltas,
    total: alunos.length, presentes, ausentes, sem_registro: alunos.length - presentes - ausentes, alunos });
});

// ---------- Busca Ativa (só administração) ----------
const listarBuscaAtiva = rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  const [casos] = await db.query(`SELECT b.id_busca_ativa AS id, b.id_aluno AS aluno_id, a.nome AS nome, ${nomeTurma("a")} AS sala, b.faltas_ao_abrir AS faltas_ao_abrir, b.status AS status,
    DATE_FORMAT(b.aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (SELECT COUNT(*) FROM tb_presencas f WHERE f.id_aluno = b.id_aluno AND f.status = 'Ausente'
       AND f.data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.data <= CURDATE()) AS faltas_atuais,
    (SELECT c.id_comunicacao_conselho FROM tb_comunicacoes_conselho c WHERE c.id_busca_ativa = b.id_busca_ativa ORDER BY c.id_comunicacao_conselho DESC LIMIT 1) AS comunicacao_id,
    (SELECT c.comunicado_em IS NOT NULL FROM tb_comunicacoes_conselho c WHERE c.id_busca_ativa = b.id_busca_ativa ORDER BY c.id_comunicacao_conselho DESC LIMIT 1) AS comunicacao_feita
    FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno
    ORDER BY (b.status = 'Em acompanhamento') DESC, b.id_busca_ativa DESC LIMIT 50`, [BUSCA_ATIVA.dias]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT id_busca_ativa AS busca_id, nome_usuario AS nome_usuario, texto AS texto, DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM tb_busca_ativa_registros WHERE id_busca_ativa IN (?) ORDER BY id_busca_ativa_registro`, [ids]))[0] : [];
  const alunosIds = [...new Set(casos.map((c) => c.aluno_id))];
  const contatos = alunosIds.length ? (await db.query(`SELECT ar.id_aluno AS aluno_id, r.nome AS nome, ar.parentesco AS parentesco, r.telefone AS telefone, r.telefone2 AS telefone2,
    r.email AS email, r.contato_preferido AS contato_preferido FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno IN (?) ORDER BY r.nome`, [alunosIds]))[0] : [];
  res.json({ criterio: BUSCA_ATIVA, casos: casos.map((c) => ({ ...c, registros: registros.filter((r) => r.busca_id === c.id), contatos: contatos.filter((x) => x.aluno_id === c.aluno_id) })) });
});

const registrarAcompanhamento = rota(async (req, res) => {
  const texto = (req.body.texto || "").trim();
  if (!texto || texto.length > 500) return res.status(400).json({ erro: "Escreva o acompanhamento (até 500 caracteres)." });
  const [[caso]] = await db.query("SELECT b.status AS status, a.nome AS nome FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno WHERE b.id_busca_ativa = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado." });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado." });
  await db.query("INSERT INTO tb_busca_ativa_registros (id_busca_ativa, id_usuario, nome_usuario, texto) VALUES (?, ?, ?, ?)", [req.params.id, req.usuario.id, req.usuario.nome, texto]);
  await registrarLog(req.usuario, "busca_ativa_acompanhamento", caso.nome);
  res.status(201).json({ ok: true });
});

const encerrarBuscaAtiva = rota(async (req, res) => {
  const [[caso]] = await db.query("SELECT b.status AS status, a.nome AS nome FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno WHERE b.id_busca_ativa = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado." });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado." });
  const texto = (req.body.texto || "").trim().slice(0, 450);
  await db.query("UPDATE tb_busca_ativa SET status = 'Resolvido', encerrada_em = NOW() WHERE id_busca_ativa = ?", [req.params.id]);
  await db.query("INSERT INTO tb_busca_ativa_registros (id_busca_ativa, id_usuario, nome_usuario, texto) VALUES (?, ?, ?, ?)",
    [req.params.id, req.usuario.id, req.usuario.nome, "Caso encerrado." + (texto ? " " + texto : "")]);
  await registrarLog(req.usuario, "busca_ativa_encerrada", caso.nome);
  res.json({ ok: true });
});

// ---------- Segurança (só administração) ----------
const listarAcessos = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.nome AS nome, COALESCE((SELECT cg.nome FROM tb_cameras cg WHERE cg.id_camera = ac.id_camera), 'Portaria') AS sala, ac.metodo AS metodo, DATE_FORMAT(ac.data_hora, '%H:%i:%s') AS hora
    FROM tb_acessos ac JOIN tb_alunos a ON a.id_aluno = ac.id_aluno
    ORDER BY ac.id_acesso DESC LIMIT 4`);
  res.json(linhas);
});

// Entrada registrada à mão pela portaria (aluno sem cadastro facial, câmera desligada etc.)
const registrarEntrada = rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT id_aluno AS id, nome AS nome FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [[cam]] = await db.query("SELECT id_camera AS id, nome AS nome FROM tb_cameras WHERE id_camera = ? AND tipo = 'Entrada'", [Number(req.body.cam_id) || 0]);
  await db.query("INSERT INTO tb_acessos (id_aluno, id_turma, id_camera, metodo) VALUES (?, (SELECT a.id_turma FROM tb_alunos a WHERE a.id_aluno = ?), ?, 'Manual')", [aluno.id, aluno.id, cam ? cam.id : null]); // turma do aluno no dia da entrada
  await marcarPresencaPelaEntrada(aluno.id, "registro da portaria");
  await registrarLog(req.usuario, "entrada_manual", `aluno id ${aluno.id}${cam ? " — " + cam.nome : ""}`);
  res.status(201).json({ ok: true });
});

const verSaida = rota(async (req, res) => {
  // escolhido na lista (turma -> aluno) vem pelo id; digitado vem pelo nome
  const porId = /^\d+$/.test(String(req.query.id || ""));
  const [alunos] = await db.query(`SELECT id_aluno AS id, nome AS nome, ${nomeTurma("tb_alunos")} AS sala, matricula AS matricula FROM tb_alunos WHERE situacao = 'Ativo' AND ${porId ? "id_aluno = ?" : "nome LIKE ?"} LIMIT 1`, [porId ? Number(req.query.id) : `%${req.query.nome || ""}%`]);
  if (!alunos.length) return res.json(null);
  const [responsaveis] = await db.query(`SELECT r.nome AS nome, ar.parentesco AS parentesco, r.telefone AS telefone, r.foto AS foto
    FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?`, [alunos[0].id]);
  const [status] = await statusAoVivo({ alunoId: alunos[0].id });
  res.json({ aluno: alunos[0], responsaveis, status });
});

const registrarSaida = rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT id_aluno AS id FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  await db.query("INSERT INTO tb_saidas (id_aluno, metodo, liberado_por_nome) VALUES (?, 'Liberação', ?)", [aluno.id, req.usuario.nome]);
  await registrarLog(req.usuario, "liberacao_saida", `aluno id ${req.body.aluno_id}`);
  res.status(201).json({ ok: true });
});

// ---------- Minha Turma e chamada (só professores) ----------
const verMinhaTurma = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, p.status AS status_hoje, p.observacao AS obs_hoje,
    (SELECT COUNT(*) FROM tb_pendencias q WHERE q.id_aluno = a.id_aluno AND q.status = 'Aberta')
      + (SELECT COUNT(*) FROM tb_autorizacoes z WHERE z.id_aluno = a.id_aluno AND z.assinada = FALSE AND (z.valida_ate IS NULL OR z.valida_ate >= CURDATE())) AS pendencias,
    (SELECT COUNT(*) FROM tb_presencas f WHERE f.id_aluno = a.id_aluno AND f.status = 'Ausente'
       AND f.data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.data <= CURDATE()) AS faltas,
    GROUP_CONCAT(DISTINCT CONCAT(r.nome, ' (', ar.parentesco, ') ', IFNULL(r.telefone,'')) SEPARATOR ' • ') AS responsaveis
    FROM tb_alunos a LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.data = CURDATE()
    LEFT JOIN tb_aluno_resp ar ON ar.id_aluno = a.id_aluno LEFT JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel
    WHERE ${nomeTurma("a")} = ? AND a.situacao = 'Ativo' GROUP BY a.id_aluno, a.nome, p.status, p.observacao ORDER BY a.nome`, [BUSCA_ATIVA.dias, req.usuario.sala]);
  const aoVivo = new Map((await statusAoVivo({ sala: req.usuario.sala })).map((s) => [s.id, s]));
  // origem_hoje: "portao" quando a presença foi marcada pela entrada (câmera ou portaria) e o professor ainda não confirmou na chamada
  res.json({ dias_faltas: BUSCA_ATIVA.dias, alunos: linhas.map((l) => ({ ...l, agora: aoVivo.get(l.id) || null,
    origem_hoje: l.status_hoje ? (/^Entrada/.test(l.obs_hoje || "") ? "portao" : "chamada") : null })) });
});

// Chamada de hoje: o professor marca Presente/Ausente só para os alunos da própria turma
const salvarChamada = rota(async (req, res) => {
  const registros = req.body.registros;
  if (!Array.isArray(registros) || !registros.length) return res.status(400).json({ erro: "Marque a presença dos alunos antes de salvar." });
  const [daTurma] = await db.query(`SELECT id_aluno AS id FROM tb_alunos WHERE ${nomeTurma("tb_alunos")} = ? AND situacao = 'Ativo'`, [req.usuario.sala]);
  const permitidos = new Set(daTurma.map((a) => a.id));
  for (const r of registros) {
    if (!permitidos.has(Number(r.aluno_id))) return res.status(403).json({ erro: "Esse aluno não é da sua turma." });
    if (!["Presente", "Ausente"].includes(r.status)) return res.status(400).json({ erro: "Status inválido." });
  }
  for (const r of registros) {
    await db.query(`INSERT INTO tb_presencas (id_aluno, data, status, observacao) VALUES (?, CURDATE(), ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), observacao = VALUES(observacao)`,
      [r.aluno_id, r.status, r.status === "Presente" ? "Presença registrada na chamada" : "Falta registrada na chamada"]);
  }
  await registrarLog(req.usuario, "chamada_registrada", `${req.usuario.sala}: ${registros.length} alunos`);
  await sincronizarBuscaAtiva();
  res.json({ ok: true });
});

// ---------- Portal dos Pais (admin vê qualquer um; pai só o próprio filho) ----------
// Histórico de presença de um aluno (últimos N dias) com totais e a situação de hoje
const verPresencas = rota(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 120);
  const [registros] = await db.query(`SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, status AS status, observacao AS observacao
    FROM tb_presencas WHERE id_aluno = ? AND data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND data <= CURDATE() ORDER BY data DESC`, [req.params.alunoId, dias]);
  const presencas = registros.filter((r) => r.status === "Presente").length;
  const faltas = registros.filter((r) => r.status === "Ausente").length;
  const [linhasHoje] = await db.query("SELECT status AS status, observacao AS observacao FROM tb_presencas WHERE id_aluno = ? AND data = CURDATE()", [req.params.alunoId]);
  res.json({ dias, registros, presencas, faltas, percentual: percentual(presencas, faltas), hoje: linhasHoje[0] || null });
});

module.exports = { verFrequencia, listarBuscaAtiva, registrarAcompanhamento, encerrarBuscaAtiva, listarAcessos, registrarEntrada, verSaida, registrarSaida, verMinhaTurma, salvarChamada, verPresencas };
