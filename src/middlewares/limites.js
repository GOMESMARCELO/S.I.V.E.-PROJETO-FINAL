// Middleware: limite de pedidos por minuto nas rotas abertas (login, verificação de assinatura...).
// 11) Limite de pedidos por minuto por computador nas rotas abertas (login e verificação de assinatura)
const contagemMinuto = new Map();
const limitePorMinuto = (nome, max) => (req, res, next) => {
  const chave = `${nome}|${req.ip}`, agora = Date.now(), c = contagemMinuto.get(chave);
  if (!c || agora - c.inicio > 60000) { contagemMinuto.set(chave, { inicio: agora, n: 1 }); return next(); }
  if (++c.n > max) return res.status(429).json({ erro: "Muitos pedidos em pouco tempo. Aguarde um minuto e tente de novo." });
  next();
};
setInterval(() => { const agora = Date.now(); for (const [k, c] of contagemMinuto) if (agora - c.inicio > 60000) contagemMinuto.delete(k); }, 60 * 1000).unref();

module.exports = { contagemMinuto, limitePorMinuto };
