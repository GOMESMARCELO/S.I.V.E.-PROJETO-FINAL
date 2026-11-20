// Middleware: cabeçalhos de segurança em todas as respostas (a API nunca fica em cache do navegador)
const VLIBRAS = "https://vlibras.gov.br https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/";
const CSP = `default-src 'self'; script-src 'self' ${VLIBRAS}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${VLIBRAS}; font-src 'self' ${VLIBRAS}; connect-src 'self' ${VLIBRAS} https://traducao2.vlibras.gov.br; frame-src ${VLIBRAS}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
function cabecalhos(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000"); // só com HTTPS: o navegador passa a recusar HTTP
  res.setHeader("Content-Security-Policy", CSP);
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
}

module.exports = { cabecalhos };
