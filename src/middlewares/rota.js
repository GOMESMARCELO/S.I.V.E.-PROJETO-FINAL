// Middleware: trata os erros de todas as rotas em um só lugar.
const crypto = require("crypto");

// Envolve as rotas para tratar erros em um só lugar
const rota = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (erro) {
    const id = crypto.randomBytes(4).toString("hex");
    console.error(`[erro ${id}] ${req.method} ${req.path}:`, erro.message); // detalhes só no terminal do servidor
    res.status(500).json({ erro: `Erro interno do servidor (código ${id}). Tente de novo; se continuar, anote o código e avise o responsável técnico pelo sistema.` });
  }
};

module.exports = { rota };
