// Servidor do S.I.V.E. — Node.js + Express + MySQL
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
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

// Lista de alunos (tela da Secretaria)
app.get("/api/alunos", rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT nome, sala, comunicados, autorizacao, pendencia,
    CASE pendencia WHEN 'Nenhuma' THEN 'ok' WHEN 'Autorização' THEN 'warning' ELSE 'danger' END AS tom
    FROM alunos ORDER BY id`);
  res.json(linhas);
}));

// Últimos acessos (tela de Segurança)
app.get("/api/acessos", rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.nome, ac.sala, DATE_FORMAT(ac.data_hora, '%H:%i:%s') AS hora
    FROM acessos ac JOIN alunos a ON a.id = ac.aluno_id
    ORDER BY ac.id DESC LIMIT 4`);
  res.json(linhas);
}));

// Registra um novo acesso
app.post("/api/acessos", rota(async (req, res) => {
  const { aluno_id, sala } = req.body;
  await db.query("INSERT INTO acessos (aluno_id, sala) VALUES (?, ?)", [aluno_id, sala]);
  res.status(201).json({ ok: true });
}));

// Busca aluno + responsáveis autorizados para a saída
app.get("/api/saida", rota(async (req, res) => {
  const [alunos] = await db.query("SELECT id, nome, sala, matricula FROM alunos WHERE nome LIKE ? LIMIT 1", [`%${req.query.nome || ""}%`]);
  if (!alunos.length) return res.json(null);
  const [responsaveis] = await db.query(`SELECT r.nome, ar.parentesco, r.telefone, r.foto
    FROM aluno_responsavel ar JOIN responsaveis r ON r.id = ar.responsavel_id WHERE ar.aluno_id = ?`, [alunos[0].id]);
  res.json({ aluno: alunos[0], responsaveis });
}));

// Confirma a liberação de saída
app.post("/api/saidas", rota(async (req, res) => {
  await db.query("INSERT INTO saidas (aluno_id) VALUES (?)", [req.body.aluno_id]);
  res.status(201).json({ ok: true });
}));

// Autorizações de um aluno (Portal dos Pais)
app.get("/api/autorizacoes/:alunoId", rota(async (req, res) => {
  const [linhas] = await db.query("SELECT id, titulo, validade AS data, detalhe, aprovada FROM autorizacoes WHERE aluno_id = ?", [req.params.alunoId]);
  res.json(linhas);
}));

// Aprova / desfaz a aprovação
app.put("/api/autorizacoes/:id/alternar", rota(async (req, res) => {
  await db.query("UPDATE autorizacoes SET aprovada = NOT aprovada WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// Histórico de presença de um aluno
app.get("/api/presencas/:alunoId", rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, observacao, status
    FROM presencas WHERE aluno_id = ? ORDER BY data DESC LIMIT 5`, [req.params.alunoId]);
  res.json(linhas);
}));

app.listen(config.porta, () => console.log(`S.I.V.E. rodando em http://localhost:${config.porta}`));
