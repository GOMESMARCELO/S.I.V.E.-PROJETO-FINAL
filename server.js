// Servidor do S.I.V.E. — Node.js + Express + MySQL
const express = require("express");
const mysql = require("mysql2/promise");
const config = require("./config.json");

const app = express();
const db = mysql.createPool(config.banco);

app.use(express.json());
app.use(express.static(__dirname)); // entrega index.html, css, js e assets

// Envolve as rotas para tratar erros em um só lugar
const rota = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (erro) { console.error(erro.message); res.status(500).json({ erro: "Erro no servidor: " + erro.message }); }
};

// ---------- Login ----------
// O token aqui é só um JSON codificado em base64: simples de explicar num TCC,
// mas não deve ser usado assim em um sistema de verdade (o ideal seria JWT + senha com hash).
const gerarToken = (usuario) => Buffer.from(JSON.stringify({
  id: usuario.id, papel: usuario.papel, aluno_id: usuario.aluno_id, nome: usuario.nome,
})).toString("base64");

app.post("/api/login", rota(async (req, res) => {
  const { usuario, senha } = req.body;
  const [linhas] = await db.query("SELECT * FROM usuarios WHERE usuario = ? AND senha = ?", [usuario, senha]);
  if (!linhas.length) return res.status(401).json({ erro: "Usuário ou senha inválidos" });
  const u = linhas[0];
  res.json({ token: gerarToken(u), papel: u.papel, nome: u.nome, aluno_id: u.aluno_id });
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
// Só deixa passar administradores
function apenasAdmin(req, res, next) {
  if (req.usuario.papel !== "admin") return res.status(403).json({ erro: "Somente a administração pode acessar isso" });
  next();
}
// Deixa passar administradores, ou o pai/mãe consultando o próprio filho
function proprioAlunoOuAdmin(req, res, next) {
  const alunoId = Number(req.params.alunoId);
  if (req.usuario.papel === "admin" || req.usuario.aluno_id === alunoId) return next();
  res.status(403).json({ erro: "Você só pode consultar os dados do seu próprio filho" });
}

// ---------- Secretaria (só administração) ----------
app.get("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT nome, sala, comunicados, autorizacao, pendencia,
    CASE pendencia WHEN 'Nenhuma' THEN 'ok' WHEN 'Autorização' THEN 'warning' ELSE 'danger' END AS tom
    FROM alunos ORDER BY id`);
  res.json(linhas);
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
  res.status(201).json({ ok: true });
}));

// ---------- Portal dos Pais (admin vê qualquer um; pai só o próprio filho) ----------
app.get("/api/autorizacoes/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [linhas] = await db.query("SELECT id, titulo, validade AS data, detalhe, aprovada FROM autorizacoes WHERE aluno_id = ?", [req.params.alunoId]);
  res.json(linhas);
}));

// Aprova / desfaz a aprovação — confere de quem é a autorização antes de mexer
app.put("/api/autorizacoes/:id/alternar", autenticar, rota(async (req, res) => {
  const [[autorizacao]] = await db.query("SELECT aluno_id FROM autorizacoes WHERE id = ?", [req.params.id]);
  if (!autorizacao) return res.status(404).json({ erro: "Autorização não encontrada" });
  if (req.usuario.papel !== "admin" && req.usuario.aluno_id !== autorizacao.aluno_id) {
    return res.status(403).json({ erro: "Você só pode alterar autorizações do seu próprio filho" });
  }
  await db.query("UPDATE autorizacoes SET aprovada = NOT aprovada WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/presencas/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, observacao, status
    FROM presencas WHERE aluno_id = ? ORDER BY data DESC LIMIT 5`, [req.params.alunoId]);
  res.json(linhas);
}));

// Nome e sala do próprio filho (usado no Portal dos Pais)
app.get("/api/alunos/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT nome, sala FROM alunos WHERE id = ?", [req.params.alunoId]);
  res.json(aluno || null);
}));

app.listen(config.porta, () => console.log(`S.I.V.E. rodando em http://localhost:${config.porta}`));
