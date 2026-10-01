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

// Grava uma linha no log de atividades (quem fez o quê, e quando)
async function registrarLog(usuario, acao, detalhe) {
  await db.query("INSERT INTO logs (usuario_id, nome_usuario, papel, acao, detalhe) VALUES (?, ?, ?, ?, ?)",
    [usuario ? usuario.id : null, usuario ? usuario.nome : "Desconhecido", usuario ? usuario.papel : "-", acao, detalhe || null]);
}
// Gera uma senha genérica simples, de 6 dígitos, para o admin entregar ao usuário novo
const gerarSenhaGenerica = () => String(Math.floor(100000 + Math.random() * 900000));

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

// ---------- Minha Turma (só professores) ----------
app.get("/api/minha-turma", autenticar, apenasProfessor, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id, a.nome, a.pendencia,
    GROUP_CONCAT(DISTINCT CONCAT(r.nome, ' (', ar.parentesco, ') ', IFNULL(r.telefone,'')) SEPARATOR ' • ') AS responsaveis
    FROM alunos a LEFT JOIN aluno_responsavel ar ON ar.aluno_id = a.id LEFT JOIN responsaveis r ON r.id = ar.responsavel_id
    WHERE a.sala = ? GROUP BY a.id ORDER BY a.nome`, [req.usuario.sala]);
  res.json(linhas);
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
