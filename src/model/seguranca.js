// Model: senhas (hash scrypt), token de login, bloqueio por tentativas, verificação em duas etapas e criptografia dos arquivos.
const crypto = require("crypto");
const util = require("util");
const { config } = require("../../config");

// Opções de segurança (no .env). Padrão: senha forte e duas etapas para a gestão ligadas.
//   EXIGIR_SENHA_FORTE=false → volta a aceitar senhas curtas (só para demonstração)
//   EXIGIR_2FA_GESTAO=false  → a gestão não precisa da verificação em duas etapas
const SEG = { senhaForte: config.seguranca.exigir_senha_forte !== false, doisFatoresGestao: config.seguranca.exigir_2fa_gestao !== false };
// Gera uma senha genérica simples, de 6 dígitos, para o admin entregar ao usuário novo
// Senha provisória: 10 caracteres, gerador criptográfico, sem letras parecidas (0/O, 1/l/I). Sempre tem letra e número.
const ALFABETO_SENHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function gerarSenhaGenerica() {
  let s = "";
  while (!/\d/.test(s) || !/[A-Za-z]/.test(s)) s = Array.from({ length: 10 }, () => ALFABETO_SENHA[crypto.randomInt(ALFABETO_SENHA.length)]).join("");
  return s;
}
// 5) Regras de senha. Devolve o problema (texto) ou null se a senha serve.
const SENHAS_OBVIAS = new Set(["12345678", "123456789", "1234567890", "87654321", "senha123", "senha1234", "password1", "abc12345", "qwerty123", "escola123"]);
function problemaNaSenha(senha, login) {
  if (typeof senha !== "string") return "Informe a senha";
  if (!SEG.senhaForte) return senha.length >= 4 ? null : "A senha precisa ter pelo menos 4 caracteres";
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres";
  if (senha.length > 128) return "A senha pode ter no máximo 128 caracteres";
  if (!/\p{L}/u.test(senha) || !/\d/.test(senha)) return "Use letras e números na senha";
  if (login && senha.toLowerCase().includes(String(login).toLowerCase())) return "A senha não pode conter o seu usuário";
  if (SENHAS_OBVIAS.has(senha.toLowerCase()) || /^(.)\1+$/.test(senha)) return "Essa senha é fácil demais de adivinhar";
  return null;
}

// ---------- Senhas: guardadas com hash (scrypt), nunca em texto puro ----------
const scrypt = util.promisify(crypto.scrypt);
async function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString("hex");
  return `scrypt$${sal}$${(await scrypt(senha, sal, 32)).toString("hex")}`;
}
const HASH_FALSO = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(64); // usado quando o usuário não existe: a resposta demora o mesmo tempo
async function conferirSenha(senha, guardada) {
  if (typeof senha !== "string" || typeof guardada !== "string" || !guardada) return false;
  if (guardada.startsWith("scrypt$")) {
    const [, sal, hash] = guardada.split("$");
    const calculado = await scrypt(senha, sal, 32), esperado = Buffer.from(hash, "hex");
    return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
  }
  const a = Buffer.from(senha), b = Buffer.from(guardada); // senha antiga em texto puro: vira hash no próximo login
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Login: token assinado (HMAC-SHA256) que expira ----------
const SEGREDO_TOKEN = config.seguranca.segredo_token;
const TOKEN_HORAS = Number(config.seguranca.token_horas) || 8;
const assinar = (corpo) => crypto.createHmac("sha256", SEGREDO_TOKEN).update(corpo).digest("base64url");
const gerarToken = (usuario) => {
  // v = versão da sessão do usuário: "Sair", trocar a senha ou ser desativado sobe a versão e derruba todos os logins antigos
  const corpo = Buffer.from(JSON.stringify({ id: usuario.id, v: usuario.sessao || 0, exp: Date.now() + TOKEN_HORAS * 3600 * 1000 })).toString("base64url");
  return corpo + "." + assinar(corpo);
};
function lerToken(token) { // lança erro se a assinatura for falsa ou se a sessão expirou
  const [corpo, assinatura] = String(token).split(".");
  if (!corpo || !assinatura) throw new Error("token inválido");
  const a = Buffer.from(assinatura), b = Buffer.from(assinar(corpo));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("assinatura inválida");
  const dados = JSON.parse(Buffer.from(corpo, "base64url").toString());
  if (!dados.id || !dados.exp || dados.exp < Date.now()) throw new Error("sessão expirada");
  return dados;
}

// Bloqueio temporário por erros de senha, em três níveis:
//   par (computador + usuário): 5 erros → 5 min | conta (de qualquer lugar): 10 erros → 15 min | ip (vários usuários): 30 erros → 15 min
// Assim, quem testa senhas de muitos usuários a partir de um computador, ou de uma conta a partir de vários, também é barrado.
const tentativas = new Map();
const LIMITES_TENTATIVA = { par: { max: 5, ms: 5 * 60 * 1000 }, conta: { max: 10, ms: 15 * 60 * 1000 }, ip: { max: 30, ms: 15 * 60 * 1000 } };
function minutosBloqueado(chave) {
  const t = tentativas.get(chave);
  if (!t || !t.ate) return 0;
  if (t.ate <= Date.now()) { tentativas.delete(chave); return 0; }
  return Math.ceil((t.ate - Date.now()) / 60000);
}
function registrarFalha(chave, nivel = "par") {
  const lim = LIMITES_TENTATIVA[nivel], t = tentativas.get(chave) || { n: 0 };
  t.n++; t.ultima = Date.now();
  if (t.n >= lim.max) { t.ate = Date.now() + lim.ms; t.n = 0; }
  tentativas.set(chave, t);
}
// Limpa a lista a cada 10 minutos (não cresce sem fim, mesmo com milhares de tentativas com usuários inventados)
setInterval(() => {
  const agora = Date.now();
  for (const [k, t] of tentativas) if ((t.ate && t.ate <= agora) || (!t.ate && agora - (t.ultima || 0) > 60 * 60 * 1000)) tentativas.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- Verificação em duas etapas (aplicativo autenticador: Google Authenticator, Microsoft Authenticator...) ----------
// Padrão TOTP (RFC 6238): código de 6 números que muda a cada 30 segundos. O segredo fica no banco criptografado (AES-256-GCM).
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const paraBase32 = (buf) => { let bits = "", s = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) s += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return s; };
const deBase32 = (txt) => { let bits = ""; for (const c of txt.replace(/=+$/, "")) bits += BASE32.indexOf(c).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
function codigoTotp(segredo, passo) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac("sha1", segredo).update(msg).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
function totpConfere(segredoBase32, codigo) {
  const c = String(codigo || "").replace(/\D/g, "");
  if (c.length !== 6) return false;
  const segredo = deBase32(segredoBase32), passo = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(codigoTotp(segredo, passo + d)), Buffer.from(c))); // tolera 30 s de diferença no relógio
}
const guardarSegredo2fa = (usuId, base32) => cifrarArquivo(Buffer.from(base32), `2fa|${usuId}`).toString("base64");
const lerSegredo2fa = (usuId, guardado) => decifrarArquivo(Buffer.from(guardado, "base64"), `2fa|${usuId}`).toString();

// ---------- Arquivos: criptografia AES-256-GCM em repouso ----------
// Formato no disco: "SIVE1" + IV (12 bytes) + selo de autenticação (16 bytes) + conteúdo criptografado.
// O nome do arquivo entra na autenticação: trocar ou alterar um arquivo no disco faz a abertura falhar.
const CHAVE_ARQUIVOS = Buffer.from(config.seguranca.chave_arquivos, "hex");
const MAGIA = Buffer.from("SIVE1");
function cifrarArquivo(conteudo, nome) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", CHAVE_ARQUIVOS, iv);
  c.setAAD(Buffer.from(nome));
  const dados = Buffer.concat([c.update(conteudo), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), dados]);
}
function decifrarArquivo(bytes, nome) { // lança erro se o arquivo foi alterado ou se a chave for outra
  if (!bytes.subarray(0, MAGIA.length).equals(MAGIA)) throw new Error("formato inválido");
  const d = crypto.createDecipheriv("aes-256-gcm", CHAVE_ARQUIVOS, bytes.subarray(5, 17));
  d.setAAD(Buffer.from(nome));
  d.setAuthTag(bytes.subarray(17, 33));
  return Buffer.concat([d.update(bytes.subarray(33)), d.final()]);
}

module.exports = { SEG, ALFABETO_SENHA, gerarSenhaGenerica, SENHAS_OBVIAS, problemaNaSenha, scrypt, hashSenha, HASH_FALSO, conferirSenha, SEGREDO_TOKEN, TOKEN_HORAS, assinar, gerarToken, lerToken, tentativas, LIMITES_TENTATIVA, minutosBloqueado, registrarFalha, BASE32, paraBase32, deBase32, codigoTotp, totpConfere, guardarSegredo2fa, lerSegredo2fa, CHAVE_ARQUIVOS, MAGIA, cifrarArquivo, decifrarArquivo };
