// Configurações do S.I.V.E., lidas do arquivo .env (na raiz do projeto).
// O .env guarda a senha do banco e as chaves de segurança: ele NÃO vai para o Git. Modelo em .env.example.
// Se o .env não existir mas o config.json antigo existir, o .env é criado a partir dele na primeira execução.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = __dirname;
const ARQUIVO_ENV = path.join(RAIZ, ".env");

// Nome no .env → onde o valor fica dentro de "config" (o resto do sistema lê config.banco.host, config.seguranca.token_horas...)
const CAMPOS = [
  ["PORTA", "porta", "numero"],
  ["DB_HOST", "banco.host"], ["DB_PORT", "banco.port", "numero"], ["DB_USER", "banco.user"], ["DB_PASSWORD", "banco.password"],
  ["DB_NAME", "banco.database"], ["DB_CHARSET", "banco.charset"],
  ["ESCOLA_NOME", "escola.nome"], ["ESCOLA_ENCARREGADO_NOME", "escola.encarregado_nome"],
  ["ESCOLA_ENCARREGADO_EMAIL", "escola.encarregado_email"], ["ESCOLA_PRAZO_RETENCAO", "escola.prazo_retencao"],
  ["EXIGIR_SENHA_FORTE", "seguranca.exigir_senha_forte", "booleano"], ["EXIGIR_2FA_GESTAO", "seguranca.exigir_2fa_gestao", "booleano"],
  ["ATRAS_DE_PROXY", "seguranca.atras_de_proxy", "booleano"], ["TOKEN_HORAS", "seguranca.token_horas", "numero"],
  ["CHAVE_ARQUIVOS", "seguranca.chave_arquivos"], ["SEGREDO_TOKEN", "seguranca.segredo_token"],
  ["ASSINATURA_PRIVADA", "seguranca.assinatura_privada"], ["ASSINATURA_PUBLICA", "seguranca.assinatura_publica"],
  ["BACKUP_PASTA", "backup.pasta"], ["BACKUP_MANTER", "backup.manter", "numero"], ["RETENCAO_LOGS_ANOS", "retencao.logs_anos", "numero"],
  ["EMAIL_MODO", "email.modo"], ["EMAIL_URL_BASE", "email.url_base"], ["EMAIL_REMETENTE", "email.remetente"],
  ["SMTP_HOST", "email.smtp.host"], ["SMTP_PORTA", "email.smtp.porta", "numero"], ["SMTP_USUARIO", "email.smtp.usuario"], ["SMTP_SENHA", "email.smtp.senha"],
  ["HTTPS_CERTIFICADO", "https.certificado"], ["HTTPS_CHAVE", "https.chave"],
];

// ---------- Ler e escrever o .env (formato NOME=valor, uma por linha; # começa um comentário) ----------
function lerEnv(texto) {
  const valores = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    valores[m[1]] = v;
  }
  return valores;
}
const escreverValor = (v) => (/^[\w.@:/+=-]*$/.test(String(v)) ? String(v) : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);
// Grava (ou troca) um valor no .env, sem mexer nas outras linhas nem nos comentários
function salvarNoEnv(nome, valor) {
  let texto = fs.existsSync(ARQUIVO_ENV) ? fs.readFileSync(ARQUIVO_ENV, "utf8") : "";
  const linha = `${nome}=${escreverValor(valor)}`, re = new RegExp(`^${nome}=.*$`, "m");
  texto = re.test(texto) ? texto.replace(re, linha) : texto.replace(/\s*$/, "") + (texto.trim() ? "\n" : "") + linha + "\n";
  fs.writeFileSync(ARQUIVO_ENV, texto);
}

// ---------- Primeira execução depois da mudança: cria o .env a partir do config.json antigo ----------
const ARQUIVO_JSON = path.join(RAIZ, "config.json");
if (!fs.existsSync(ARQUIVO_ENV) && fs.existsSync(ARQUIVO_JSON)) {
  const antigo = JSON.parse(fs.readFileSync(ARQUIVO_JSON, "utf8"));
  const pegar = (caminho) => caminho.split(".").reduce((o, k) => (o == null ? undefined : o[k]), antigo);
  const linhas = ["# Configurações do S.I.V.E. (criado a partir do config.json). NÃO envie este arquivo para o Git."];
  for (const [nome, caminho] of CAMPOS) { const v = pegar(caminho); if (v !== undefined && v !== null && v !== "") linhas.push(`${nome}=${escreverValor(v)}`); }
  fs.writeFileSync(ARQUIVO_ENV, linhas.join("\n") + "\n");
  console.log("📄 O arquivo .env foi criado a partir do config.json. Confira e, depois, pode apagar o config.json.");
}

// ---------- Monta o objeto "config" (variáveis do sistema operacional têm prioridade sobre o .env) ----------
const doArquivo = fs.existsSync(ARQUIVO_ENV) ? lerEnv(fs.readFileSync(ARQUIVO_ENV, "utf8")) : {};
const config = {};
for (const [nome, caminho, tipo] of CAMPOS) {
  let v = process.env[nome] !== undefined ? process.env[nome] : doArquivo[nome];
  if (v === undefined || v === "") continue;
  if (tipo === "numero") v = Number(v);
  if (tipo === "booleano") v = /^(true|sim|1)$/i.test(v);
  const partes = caminho.split("."), ultimo = partes.pop();
  let alvo = config;
  for (const p of partes) alvo = alvo[p] = alvo[p] || {};
  alvo[ultimo] = v;
}
config.porta = config.porta || 3000;
config.banco = Object.assign({ host: "localhost", port: 3306, charset: "utf8mb4" }, config.banco);

// ---------- Chaves de segurança, geradas sozinhas na primeira execução ----------
// chave_arquivos: criptografa os documentos no disco. segredo_token: assina o login, para ninguém conseguir forjá-lo.
// Elas ficam no .env (que não vai para o Git). FAÇA BACKUP desse arquivo: sem a chave, os documentos não abrem mais.
config.seguranca = config.seguranca || {};
let gerouChaves = false;
for (const [campo, nome] of [["chave_arquivos", "CHAVE_ARQUIVOS"], ["segredo_token", "SEGREDO_TOKEN"]]) {
  if (!/^[0-9a-f]{64}$/.test(config.seguranca[campo] || "")) { config.seguranca[campo] = crypto.randomBytes(32).toString("hex"); salvarNoEnv(nome, config.seguranca[campo]); gerouChaves = true; }
}
// Par de chaves da assinatura digital (Ed25519). A privada assina; a pública confere. Trocar a chave invalida as assinaturas antigas.
if (!config.seguranca.assinatura_privada || !config.seguranca.assinatura_publica) {
  const par = crypto.generateKeyPairSync("ed25519");
  config.seguranca.assinatura_privada = par.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  config.seguranca.assinatura_publica = par.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  salvarNoEnv("ASSINATURA_PRIVADA", config.seguranca.assinatura_privada);
  salvarNoEnv("ASSINATURA_PUBLICA", config.seguranca.assinatura_publica);
  gerouChaves = true;
}
if (gerouChaves) console.log("🔐 Chaves de segurança criadas no .env. Faça backup desse arquivo junto com a pasta uploads/.");

// HTTPS: com HTTPS_CERTIFICADO e HTTPS_CHAVE no .env, o sistema já sobe em HTTPS.
// Na publicação, o mais comum é o HTTPS ficar no Nginx, na frente do sistema; aí use ATRAS_DE_PROXY=true.
const httpsCfg = config.https || {};
const protocolo = httpsCfg.certificado && httpsCfg.chave ? "https" : "http";

module.exports = { config, RAIZ, protocolo, httpsCfg };
