// Servidor do S.I.V.E. — Node.js + Express + MySQL, organizado no padrão MVC.
// Este arquivo só liga as peças. As regras ficam em src/:
//   src/model        → acesso ao banco e regras dos dados (consultas SQL, criptografia, logs)
//   src/view         → textos e formatos que o sistema mostra (política de privacidade, termo, rótulos)
//   src/controller   → o que cada endereço da API faz
//   src/routes       → os endereços da API (/api/...) e quem pode acessar cada um
//   src/middlewares  → o que roda antes das rotas (login, permissões, limites, cabeçalhos de segurança)
// O site (HTML, CSS e JS do navegador) fica em public/ e as imagens em img/.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { config, RAIZ, protocolo, httpsCfg } = require("./config");
const db = require("./src/model/db");
const { simulado: emailSimulado, telefoneSimulado } = require("./email");
const { cabecalhos } = require("./src/middlewares/cabecalhos");
const { protegerArquivosAntigos } = require("./src/model/arquivos");
const { rotinaPeriodica, PASTA_BACKUPS } = require("./src/model/rotina");
const rotas = require("./src/routes");

const app = express();
// ATRAS_DE_PROXY=true no .env → publicado atrás de Nginx/servidor intermediário: usa o IP real de quem acessa
if (config.seguranca.atras_de_proxy === true) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(cabecalhos);
app.use(express.json({ limit: "9mb" })); // 9 MB: cabe um arquivo de 5 MB enviado em base64

// Só public/ e img/ são entregues ao navegador. .env (senha do banco), server.js, src/, database/ e uploads/ NÃO são.
const PASTA_PUBLICA = path.join(RAIZ, "public");
// sw.js: só desliga e limpa o service worker de versões antigas (o sistema não é instalável). Sem cache, para chegar logo.
app.get("/sw.js", (req, res) => { res.setHeader("Cache-Control", "no-cache"); res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.sendFile(path.join(PASTA_PUBLICA, "sw.js")); });
app.use(express.static(PASTA_PUBLICA));
app.use("/img", express.static(path.join(RAIZ, "img")));

// Endereços da API (cada assunto num arquivo de src/routes)
app.use(rotas);

const servidor = protocolo === "https"
  ? require("https").createServer({ cert: fs.readFileSync(httpsCfg.certificado), key: fs.readFileSync(httpsCfg.chave) }, app)
  : app;
servidor.listen(config.porta, async () => {
  console.log(`S.I.V.E. rodando em ${protocolo}://localhost:${config.porta}`);
  if (emailSimulado) console.log("✉️  E-mail em modo SIMULADO: os links de recuperação de senha e os códigos de verificação aparecem só aqui no terminal.");
  if (telefoneSimulado) console.log("📱 SMS e WhatsApp em modo SIMULADO: os códigos de verificação aparecem só aqui no terminal.");
  else if (!(config.email || {}).url_base) console.log('⚠️  Preencha EMAIL_URL_BASE no .env: sem ele, os links de recuperação apontam para localhost.');
  // Dados pessoais e chaves em pasta sincronizada com a nuvem (OneDrive, Google Drive, Dropbox): avisa
  if (/onedrive|google drive|dropbox|icloud/i.test(RAIZ + "|" + PASTA_BACKUPS)) {
    console.log("\n⚠️  ATENÇÃO: o sistema ou a pasta de backups está numa pasta sincronizada com a nuvem (ex.: OneDrive).");
    console.log("   O .env (chaves), os documentos e os backups vão para a nuvem juntos. Mova o projeto para fora dela");
    console.log('   (ex.: C:\\SIVE) ou, pelo menos, aponte os backups para outra pasta no .env: BACKUP_PASTA=D:\\backups-sive\n');
  }
  try { protegerArquivosAntigos(); } catch (erro) { console.log("⚠️  Não foi possível criptografar arquivos antigos: " + erro.message); }
  // Confere se o banco está na versão atual (evita erros de "Unknown column / table" nas telas)
  try {
    const [colunas] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'inativado_motivo'");
    const [tabelas] = await db.query("SHOW TABLES LIKE 'tb_reconhecimentos'");
    const [pedidoSenha] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'senha_pedida_em'");
    if (!pedidoSenha.length) console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql (banco db_sive) no MySQL e reinicie o servidor.\n");
    const [emailConta] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'email'");
    if (!emailConta.length) console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql (banco db_sive) no MySQL e reinicie o servidor.\n");
    const [metodo2fa] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'metodo_2fa'");
    if (!metodo2fa.length) console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql (banco db_sive) no MySQL e reinicie o servidor.\n");
    if (!colunas.length || !tabelas.length) {
      console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql no MySQL de novo e reinicie o servidor.\n");
    } else {
      await rotinaPeriodica();
      setInterval(() => rotinaPeriodica().catch((e) => console.error(e.message)), 60 * 60 * 1000); // a cada 1 hora
    }
  } catch (erro) {
    console.log("\n⚠️  Não foi possível ler o banco: " + erro.message + "\n   Confira o .env e se o MySQL está ligado.\n");
  }
});
