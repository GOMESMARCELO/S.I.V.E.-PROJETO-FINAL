// Servidor do S.I.V.E. — Node.js + Express + MySQL
const express = require("express");
const mysql = require("mysql2/promise");
const config = require("./config.json");

const app = express();
const db = mysql.createPool(config.banco);

app.use(express.json());
app.use(express.static(__dirname)); // entrega index.html, css, js e assets

// Critério da Busca Ativa: quantas faltas, em quantos dias, tornam o caso "significativo".
// Para mudar a regra, basta alterar estes dois números.
const BUSCA_ATIVA = { faltas: 5, dias: 30 };
const SISTEMA = { id: null, nome: "Sistema", papel: "sistema" };

// Envolve as rotas para tratar erros em um só lugar
const rota = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (erro) { console.error(erro.message); res.status(500).json({ erro: "Erro no servidor: " + erro.message }); }
};

// Grava uma linha no log de atividades (quem fez o quê, e quando)
async function registrarLog(usuario, acao, detalhe) {
  await db.query("INSERT INTO logs (usuario_id, nome_usuario, papel, acao, detalhe) VALUES (?, ?, ?, ?, ?)",
    [usuario ? usuario.id : null, usuario ? usuario.nome : "Desconhecido", usuario ? usuario.papel : "-", acao, detalhe || null]);
}
// Gera uma senha genérica simples, de 6 dígitos, para o admin entregar ao usuário novo
const gerarSenhaGenerica = () => String(Math.floor(100000 + Math.random() * 900000));
const dataValida = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || "");

// ---------- Login ----------
// O token aqui é só um JSON codificado em base64: simples de explicar num TCC,
// mas não deve ser usado assim em um sistema de verdade (o ideal seria JWT + senha com hash).
const gerarToken = (usuario) => Buffer.from(JSON.stringify({
  id: usuario.id, papel: usuario.papel, aluno_id: usuario.aluno_id, sala: usuario.sala, nome: usuario.nome,
})).toString("base64");

app.post("/api/login", rota(async (req, res) => {
  const { usuario, senha } = req.body;
  const [linhas] = await db.query("SELECT * FROM usuarios WHERE usuario = ? AND senha = ? AND ativo = TRUE", [usuario, senha]);
  if (!linhas.length) {
    await registrarLog(null, "login_falha", `Tentativa com usuário "${usuario}"`);
    return res.status(401).json({ erro: "Usuário ou senha inválidos, ou cadastro inativo" });
  }
  const u = linhas[0];
  await db.query("UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = ?", [u.id]);
  await registrarLog(u, "login_sucesso", null);
  res.json({ token: gerarToken(u), papel: u.papel, nome: u.nome, aluno_id: u.aluno_id, sala: u.sala, senha_temporaria: !!u.senha_temporaria });
}));

// Lê o token do cabeçalho e diz quem está fazendo a requisição
function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization || "";
  const token = cabecalho.replace("Bearer ", "");
  try {
    req.usuario = JSON.parse(Buffer.from(token, "base64").toString());
    if (!req.usuario.papel) throw new Error();
    next();
  } catch {
    res.status(401).json({ erro: "Não autenticado" });
  }
}
const apenasAdmin = (req, res, next) => req.usuario.papel === "admin" ? next() : res.status(403).json({ erro: "Somente a administração pode acessar isso" });
const apenasProfessor = (req, res, next) => req.usuario.papel === "professor" ? next() : res.status(403).json({ erro: "Somente professores podem acessar isso" });
// Deixa passar administradores, ou o pai/mãe consultando o próprio filho
function proprioAlunoOuAdmin(req, res, next) {
  const alunoId = Number(req.params.alunoId);
  if (req.usuario.papel === "admin" || req.usuario.aluno_id === alunoId) return next();
  res.status(403).json({ erro: "Você só pode consultar os dados do seu próprio filho" });
}

// ---------- Trocar a própria senha (qualquer papel) ----------
app.put("/api/minha-senha", autenticar, rota(async (req, res) => {
  const { senha_atual, senha_nova } = req.body;
  if (!senha_nova || senha_nova.length < 4) return res.status(400).json({ erro: "A nova senha precisa ter pelo menos 4 caracteres" });
  const [[u]] = await db.query("SELECT senha FROM usuarios WHERE id = ?", [req.usuario.id]);
  if (!u || u.senha !== senha_atual) return res.status(401).json({ erro: "Senha atual incorreta" });
  await db.query("UPDATE usuarios SET senha = ?, senha_temporaria = FALSE WHERE id = ?", [senha_nova, req.usuario.id]);
  await registrarLog(req.usuario, "troca_senha", null);
  res.json({ ok: true });
}));

// ---------- Busca Ativa: o sistema conta as faltas e abre os casos sozinho ----------
async function executarSincronizacao() {
  const [novos] = await db.query(`SELECT p.aluno_id, COUNT(*) AS faltas FROM presencas p
    WHERE p.status = 'Ausente' AND p.data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND p.data <= CURDATE()
      AND p.data > COALESCE((SELECT DATE(MAX(b.encerrada_em)) FROM busca_ativa b WHERE b.aluno_id = p.aluno_id), '1900-01-01')
      AND p.aluno_id NOT IN (SELECT aluno_id FROM busca_ativa WHERE status = 'Em acompanhamento')
    GROUP BY p.aluno_id HAVING COUNT(*) >= ?`, [BUSCA_ATIVA.dias, BUSCA_ATIVA.faltas]);
  for (const n of novos) {
    const [r] = await db.query("INSERT INTO busca_ativa (aluno_id, faltas_ao_abrir) VALUES (?, ?)", [n.aluno_id, n.faltas]);
    await db.query("INSERT INTO busca_ativa_registros (busca_id, usuario_id, nome_usuario, texto) VALUES (?, NULL, 'Sistema', ?)",
      [r.insertId, `Caso aberto automaticamente: ${n.faltas} faltas nos últimos ${BUSCA_ATIVA.dias} dias.`]);
    const [[a]] = await db.query("SELECT nome FROM alunos WHERE id = ?", [n.aluno_id]);
    await registrarLog(SISTEMA, "busca_ativa_aberta", `${a.nome} (${n.faltas} faltas)`);
  }
}
// Fila simples: evita que duas telas abram o mesmo caso duas vezes ao mesmo tempo
let filaSync = Promise.resolve();
const sincronizarBuscaAtiva = () => (filaSync = filaSync.catch(() => {}).then(executarSincronizacao));

// Último dia que tem chamada registrada (ou hoje) — usado nos quadros quando hoje é fim de semana
async function dataReferencia() {
  const [[r]] = await db.query(`SELECT DATE_FORMAT(MAX(data), '%Y-%m-%d') AS ultimo, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje
    FROM presencas WHERE data <= CURDATE()`);
  return { data: r.ultimo || r.hoje, hoje: r.hoje };
}
const percentual = (presentes, ausentes) => (presentes + ausentes) ? Math.round(presentes * 1000 / (presentes + ausentes)) / 10 : null;

// ---------- Quadros indicadores da Secretaria (só administração) ----------
app.get("/api/resumo", autenticar, apenasAdmin, rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  const ref = await dataReferencia();
  const [[total]] = await db.query("SELECT COUNT(*) AS n FROM alunos");
  const [[dia]] = await db.query(`SELECT COUNT(CASE WHEN status = 'Presente' THEN 1 END) AS presentes,
    COUNT(CASE WHEN status = 'Ausente' THEN 1 END) AS ausentes FROM presencas WHERE data = ?`, [ref.data]);
  const [[busca]] = await db.query("SELECT COUNT(*) AS n FROM busca_ativa WHERE status = 'Em acompanhamento'");
  const [[aut]] = await db.query("SELECT COUNT(*) AS n FROM autorizacoes WHERE aprovada = FALSE");
  res.json({
    data: ref.data, eh_hoje: ref.data === ref.hoje, total_alunos: total.n,
    presentes: dia.presentes, ausentes: dia.ausentes, sem_registro: Math.max(0, total.n - dia.presentes - dia.ausentes),
    percentual: percentual(dia.presentes, dia.ausentes), busca_ativa: busca.n, autorizacoes_pendentes: aut.n,
  });
}));

// ---------- Secretaria (só administração) ----------
app.get("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT id, nome, sala, comunicados, autorizacao, pendencia,
    CASE pendencia WHEN 'Nenhuma' THEN 'ok' WHEN 'Autorização' THEN 'warning' ELSE 'danger' END AS tom
    FROM alunos ORDER BY id`);
  res.json(linhas);
}));

// Cadastro completo de um aluno: dados da criança + responsáveis (pai/mãe/etc.)
app.post("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const { nome, sala, matricula, responsaveis } = req.body;
  if (!nome || !sala) return res.status(400).json({ erro: "Nome e sala são obrigatórios" });
  const [resultado] = await db.query("INSERT INTO alunos (nome, sala, matricula) VALUES (?, ?, ?)", [nome, sala, matricula || null]);
  const alunoId = resultado.insertId;
  for (const r of responsaveis || []) {
    if (!r.nome) continue;
    const [[existe]] = await db.query("SELECT id FROM responsaveis WHERE nome = ? AND telefone <=> ?", [r.nome, r.telefone || null]);
    const responsavelId = existe ? existe.id : (await db.query("INSERT INTO responsaveis (nome, telefone) VALUES (?, ?)", [r.nome, r.telefone || null]))[0].insertId;
    await db.query("INSERT INTO aluno_responsavel (aluno_id, responsavel_id, parentesco) VALUES (?, ?, ?)", [alunoId, responsavelId, r.parentesco || "Responsável"]);
  }
  await registrarLog(req.usuario, "cadastro_aluno", `${nome} (${sala})`);
  res.status(201).json({ ok: true, id: alunoId });
}));

// ---------- Cadastro de usuários (gestão, pais e professores) — só administração ----------
app.get("/api/usuarios", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT u.id, u.usuario, u.nome, u.papel, u.sala, u.ativo, u.senha_temporaria, u.ultimo_acesso,
    a.nome AS aluno_nome FROM usuarios u LEFT JOIN alunos a ON a.id = u.aluno_id ORDER BY u.id DESC`);
  res.json(linhas);
}));

app.post("/api/usuarios", autenticar, apenasAdmin, rota(async (req, res) => {
  const { usuario, nome, papel, aluno_id, sala } = req.body;
  if (!usuario || !nome || !papel) return res.status(400).json({ erro: "Usuário, nome e papel são obrigatórios" });
  if (papel === "pai" && !aluno_id) return res.status(400).json({ erro: "Selecione a qual aluno este responsável pertence" });
  if (papel === "professor" && !sala) return res.status(400).json({ erro: "Informe a turma (sala) do professor" });
  const senhaGerada = gerarSenhaGenerica();
  try {
    await db.query("INSERT INTO usuarios (usuario, senha, papel, nome, aluno_id, sala, senha_temporaria) VALUES (?, ?, ?, ?, ?, ?, TRUE)",
      [usuario, senhaGerada, papel, nome, papel === "pai" ? aluno_id : null, papel === "professor" ? sala : null]);
  } catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe um usuário com esse nome de login" });
    throw erro;
  }
  await registrarLog(req.usuario, "cadastro_usuario", `${usuario} (${papel})`);
  res.status(201).json({ ok: true, senha_genercada: senhaGerada }); // devolve a senha gerada só nesta resposta, para o admin entregar ao usuário
}));

app.put("/api/usuarios/:id/ativo", autenticar, apenasAdmin, rota(async (req, res) => {
  await db.query("UPDATE usuarios SET ativo = ? WHERE id = ?", [!!req.body.ativo, req.params.id]);
  await registrarLog(req.usuario, req.body.ativo ? "reativar_usuario" : "desativar_usuario", `usuário id ${req.params.id}`);
  res.json({ ok: true });
}));

// ---------- Logs de atividade (só administração) ----------
app.get("/api/logs", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT nome_usuario, papel, acao, detalhe, DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i:%s') AS quando
    FROM logs ORDER BY id DESC LIMIT 50`);
  res.json(linhas);
}));

// ---------- Controle de frequência (só administração): todos os alunos em um dia ----------
app.get("/api/frequencia", autenticar, apenasAdmin, rota(async (req, res) => {
  const ref = await dataReferencia();
  const data = dataValida(req.query.data) ? req.query.data : ref.data;
  const [alunos] = await db.query(`SELECT a.id, a.nome, a.sala, p.status, p.observacao,
    (SELECT COUNT(*) FROM presencas f WHERE f.aluno_id = a.id AND f.status = 'Ausente'
       AND f.data > DATE_SUB(?, INTERVAL ? DAY) AND f.data <= ?) AS faltas
    FROM alunos a LEFT JOIN presencas p ON p.aluno_id = a.id AND p.data = ? ORDER BY a.nome`,
    [data, BUSCA_ATIVA.dias, data, data]);
  const presentes = alunos.filter((a) => a.status === "Presente").length;
  const ausentes = alunos.filter((a) => a.status === "Ausente").length;
  res.json({ data, eh_hoje: data === ref.hoje, hoje: ref.hoje, dias_faltas: BUSCA_ATIVA.dias, limite_faltas: BUSCA_ATIVA.faltas,
    total: alunos.length, presentes, ausentes, sem_registro: alunos.length - presentes - ausentes, alunos });
}));

// ---------- Busca Ativa (só administração) ----------
app.get("/api/busca-ativa", autenticar, apenasAdmin, rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  const [casos] = await db.query(`SELECT b.id, b.aluno_id, a.nome, a.sala, b.faltas_ao_abrir, b.status,
    DATE_FORMAT(b.aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (SELECT COUNT(*) FROM presencas f WHERE f.aluno_id = b.aluno_id AND f.status = 'Ausente'
       AND f.data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.data <= CURDATE()) AS faltas_atuais
    FROM busca_ativa b JOIN alunos a ON a.id = b.aluno_id
    ORDER BY (b.status = 'Em acompanhamento') DESC, b.id DESC LIMIT 50`, [BUSCA_ATIVA.dias]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT busca_id, nome_usuario, texto, DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM busca_ativa_registros WHERE busca_id IN (?) ORDER BY id`, [ids]))[0] : [];
  res.json({ criterio: BUSCA_ATIVA, casos: casos.map((c) => ({ ...c, registros: registros.filter((r) => r.busca_id === c.id) })) });
}));

app.post("/api/busca-ativa/:id/acompanhamento", autenticar, apenasAdmin, rota(async (req, res) => {
  const texto = (req.body.texto || "").trim();
  if (!texto || texto.length > 500) return res.status(400).json({ erro: "Escreva o acompanhamento (até 500 caracteres)" });
  const [[caso]] = await db.query("SELECT b.status, a.nome FROM busca_ativa b JOIN alunos a ON a.id = b.aluno_id WHERE b.id = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado" });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado" });
  await db.query("INSERT INTO busca_ativa_registros (busca_id, usuario_id, nome_usuario, texto) VALUES (?, ?, ?, ?)", [req.params.id, req.usuario.id, req.usuario.nome, texto]);
  await registrarLog(req.usuario, "busca_ativa_acompanhamento", caso.nome);
  res.status(201).json({ ok: true });
}));

app.put("/api/busca-ativa/:id/encerrar", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[caso]] = await db.query("SELECT b.status, a.nome FROM busca_ativa b JOIN alunos a ON a.id = b.aluno_id WHERE b.id = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado" });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado" });
  const texto = (req.body.texto || "").trim().slice(0, 450);
  await db.query("UPDATE busca_ativa SET status = 'Resolvido', encerrada_em = NOW() WHERE id = ?", [req.params.id]);
  await db.query("INSERT INTO busca_ativa_registros (busca_id, usuario_id, nome_usuario, texto) VALUES (?, ?, ?, ?)",
    [req.params.id, req.usuario.id, req.usuario.nome, "Caso encerrado." + (texto ? " " + texto : "")]);
  await registrarLog(req.usuario, "busca_ativa_encerrada", caso.nome);
  res.json({ ok: true });
}));

// ---------- Relatório mensal (só administração) ----------
app.get("/api/relatorio-mensal", autenticar, apenasAdmin, rota(async (req, res) => {
  const hoje = (await dataReferencia()).hoje;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || "") ? req.query.mes : hoje.slice(0, 7);
  const inicio = `${mes}-01`;
  const [[resumo]] = await db.query(`SELECT COUNT(DISTINCT data) AS dias_com_registro,
    COUNT(CASE WHEN status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN status = 'Ausente' THEN 1 END) AS faltas
    FROM presencas WHERE data >= ? AND data < DATE_ADD(?, INTERVAL 1 MONTH)`, [inicio, inicio]);
  const [alunos] = await db.query(`SELECT a.id, a.nome, a.sala,
    COUNT(CASE WHEN p.status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN p.status = 'Ausente' THEN 1 END) AS faltas
    FROM alunos a LEFT JOIN presencas p ON p.aluno_id = a.id AND p.data >= ? AND p.data < DATE_ADD(?, INTERVAL 1 MONTH)
    GROUP BY a.id, a.nome, a.sala ORDER BY faltas DESC, a.nome`, [inicio, inicio]);
  const [casos] = await db.query(`SELECT b.id, a.nome, a.sala, b.status, b.faltas_ao_abrir,
    DATE_FORMAT(b.aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (b.aberta_em >= ? AND b.aberta_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS aberto_no_mes,
    (b.encerrada_em >= ? AND b.encerrada_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS encerrado_no_mes
    FROM busca_ativa b JOIN alunos a ON a.id = b.aluno_id
    WHERE b.aberta_em < DATE_ADD(?, INTERVAL 1 MONTH) AND (b.encerrada_em IS NULL OR b.encerrada_em >= ?)
    ORDER BY b.id`, [inicio, inicio, inicio, inicio, inicio, inicio]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT busca_id, nome_usuario, texto, DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM busca_ativa_registros WHERE busca_id IN (?) ORDER BY id`, [ids]))[0] : [];
  await registrarLog(req.usuario, "relatorio_mensal", mes);
  res.json({
    mes, criterio: BUSCA_ATIVA,
    resumo: { total_alunos: alunos.length, ...resumo, percentual: percentual(resumo.presencas, resumo.faltas) },
    alunos: alunos.map((a) => ({ ...a, percentual: percentual(a.presencas, a.faltas) })),
    busca_ativa: {
      abertos_no_mes: casos.filter((c) => c.aberto_no_mes).length,
      encerrados_no_mes: casos.filter((c) => c.encerrado_no_mes).length,
      em_acompanhamento: casos.filter((c) => c.status === "Em acompanhamento").length,
      casos: casos.map((c) => ({ ...c, registros: registros.filter((r) => r.busca_id === c.id) })),
    },
  });
}));

// ---------- Segurança (só administração) ----------
app.get("/api/acessos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.nome, ac.sala, DATE_FORMAT(ac.data_hora, '%H:%i:%s') AS hora
    FROM acessos ac JOIN alunos a ON a.id = ac.aluno_id
    ORDER BY ac.id DESC LIMIT 4`);
  res.json(linhas);
}));

app.post("/api/acessos", autenticar, apenasAdmin, rota(async (req, res) => {
  const { aluno_id, sala } = req.body;
  await db.query("INSERT INTO acessos (aluno_id, sala) VALUES (?, ?)", [aluno_id, sala]);
  res.status(201).json({ ok: true });
}));

app.get("/api/saida", autenticar, apenasAdmin, rota(async (req, res) => {
  const [alunos] = await db.query("SELECT id, nome, sala, matricula FROM alunos WHERE nome LIKE ? LIMIT 1", [`%${req.query.nome || ""}%`]);
  if (!alunos.length) return res.json(null);
  const [responsaveis] = await db.query(`SELECT r.nome, ar.parentesco, r.telefone, r.foto
    FROM aluno_responsavel ar JOIN responsaveis r ON r.id = ar.responsavel_id WHERE ar.aluno_id = ?`, [alunos[0].id]);
  res.json({ aluno: alunos[0], responsaveis });
}));

app.post("/api/saidas", autenticar, apenasAdmin, rota(async (req, res) => {
  await db.query("INSERT INTO saidas (aluno_id) VALUES (?)", [req.body.aluno_id]);
  await registrarLog(req.usuario, "liberacao_saida", `aluno id ${req.body.aluno_id}`);
  res.status(201).json({ ok: true });
}));

// ---------- Minha Turma e chamada (só professores) ----------
app.get("/api/minha-turma", autenticar, apenasProfessor, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id, a.nome, a.pendencia, p.status AS status_hoje,
    (SELECT COUNT(*) FROM presencas f WHERE f.aluno_id = a.id AND f.status = 'Ausente'
       AND f.data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.data <= CURDATE()) AS faltas,
    GROUP_CONCAT(DISTINCT CONCAT(r.nome, ' (', ar.parentesco, ') ', IFNULL(r.telefone,'')) SEPARATOR ' • ') AS responsaveis
    FROM alunos a LEFT JOIN presencas p ON p.aluno_id = a.id AND p.data = CURDATE()
    LEFT JOIN aluno_responsavel ar ON ar.aluno_id = a.id LEFT JOIN responsaveis r ON r.id = ar.responsavel_id
    WHERE a.sala = ? GROUP BY a.id, a.nome, a.pendencia, p.status ORDER BY a.nome`, [BUSCA_ATIVA.dias, req.usuario.sala]);
  res.json({ dias_faltas: BUSCA_ATIVA.dias, alunos: linhas });
}));

// Chamada de hoje: o professor marca Presente/Ausente só para os alunos da própria turma
app.post("/api/chamada", autenticar, apenasProfessor, rota(async (req, res) => {
  const registros = req.body.registros;
  if (!Array.isArray(registros) || !registros.length) return res.status(400).json({ erro: "Nenhum aluno na chamada" });
  const [daTurma] = await db.query("SELECT id FROM alunos WHERE sala = ?", [req.usuario.sala]);
  const permitidos = new Set(daTurma.map((a) => a.id));
  for (const r of registros) {
    if (!permitidos.has(Number(r.aluno_id))) return res.status(403).json({ erro: "Esse aluno não é da sua turma" });
    if (!["Presente", "Ausente"].includes(r.status)) return res.status(400).json({ erro: "Status inválido" });
  }
  for (const r of registros) {
    await db.query(`INSERT INTO presencas (aluno_id, data, status, observacao) VALUES (?, CURDATE(), ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), observacao = VALUES(observacao)`,
      [r.aluno_id, r.status, r.status === "Presente" ? "Presença registrada na chamada" : "Falta registrada na chamada"]);
  }
  await registrarLog(req.usuario, "chamada_registrada", `${req.usuario.sala}: ${registros.length} alunos`);
  await sincronizarBuscaAtiva();
  res.json({ ok: true });
}));

// ---------- Portal dos Pais (admin vê qualquer um; pai só o próprio filho) ----------
app.get("/api/autorizacoes/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [linhas] = await db.query("SELECT id, titulo, validade AS data, detalhe, aprovada FROM autorizacoes WHERE aluno_id = ?", [req.params.alunoId]);
  res.json(linhas);
}));

// Aprova / desfaz a aprovação — confere de quem é a autorização antes de mexer
app.put("/api/autorizacoes/:id/alternar", autenticar, rota(async (req, res) => {
  const [[autorizacao]] = await db.query("SELECT aluno_id, titulo FROM autorizacoes WHERE id = ?", [req.params.id]);
  if (!autorizacao) return res.status(404).json({ erro: "Autorização não encontrada" });
  if (req.usuario.papel !== "admin" && req.usuario.aluno_id !== autorizacao.aluno_id) {
    return res.status(403).json({ erro: "Você só pode alterar autorizações do seu próprio filho" });
  }
  await db.query("UPDATE autorizacoes SET aprovada = NOT aprovada WHERE id = ?", [req.params.id]);
  await registrarLog(req.usuario, "autorizacao_alternada", autorizacao.titulo);
  res.json({ ok: true });
}));

// Histórico de presença de um aluno (últimos N dias) com totais e a situação de hoje
app.get("/api/presencas/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 120);
  const [registros] = await db.query(`SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, status, observacao
    FROM presencas WHERE aluno_id = ? AND data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND data <= CURDATE() ORDER BY data DESC`, [req.params.alunoId, dias]);
  const presencas = registros.filter((r) => r.status === "Presente").length;
  const faltas = registros.filter((r) => r.status === "Ausente").length;
  const [linhasHoje] = await db.query("SELECT status, observacao FROM presencas WHERE aluno_id = ? AND data = CURDATE()", [req.params.alunoId]);
  res.json({ dias, registros, presencas, faltas, percentual: percentual(presencas, faltas), hoje: linhasHoje[0] || null });
}));

// Nome e sala do próprio filho (usado no Portal dos Pais)
app.get("/api/alunos/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT nome, sala FROM alunos WHERE id = ?", [req.params.alunoId]);
  res.json(aluno || null);
}));

app.listen(config.porta, async () => {
  console.log(`S.I.V.E. rodando em http://localhost:${config.porta}`);
  // Confere se o banco está na versão atual (evita erros de "Unknown column / table" nas telas)
  try {
    const [colunas] = await db.query("SHOW COLUMNS FROM usuarios LIKE 'ativo'");
    const [tabelas] = await db.query("SHOW TABLES LIKE 'busca_ativa'");
    if (!colunas.length || !tabelas.length) {
      console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql no MySQL de novo e reinicie o servidor.\n");
    }
  } catch (erro) {
    console.log("\n⚠️  Não foi possível ler o banco: " + erro.message + "\n   Confira o config.json e se o MySQL está ligado.\n");
  }
});
