// Servidor do S.I.V.E. — Node.js + Express + MySQL
const express = require("express");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const util = require("util");
const importador = require("./importar-alunos");
const backup = require("./backup");
const { enviarEmail, simulado: emailSimulado, enviarMensagemTelefone, telefoneSimulado } = require("./email");
const QRCode = require("qrcode");
const config = require("./config.json");

// ---------- Chaves de segurança, geradas sozinhas na primeira execução ----------
// chave_arquivos: criptografa os documentos no disco. segredo_token: assina o login, para ninguém conseguir forjá-lo.
// As duas ficam no config.json (que não vai para o Git). FAÇA BACKUP desse arquivo: sem a chave, os documentos não abrem mais.
config.seguranca = config.seguranca || {};
let gerouChaves = false;
for (const nome of ["chave_arquivos", "segredo_token"]) {
  if (!/^[0-9a-f]{64}$/.test(config.seguranca[nome] || "")) { config.seguranca[nome] = crypto.randomBytes(32).toString("hex"); gerouChaves = true; }
}
// Par de chaves da assinatura digital (Ed25519). A privada assina; a pública confere. Trocar a chave invalida as assinaturas antigas.
if (!config.seguranca.assinatura_privada || !config.seguranca.assinatura_publica) {
  const par = crypto.generateKeyPairSync("ed25519");
  config.seguranca.assinatura_privada = par.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  config.seguranca.assinatura_publica = par.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  gerouChaves = true;
}
if (gerouChaves) {
  fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(config, null, 2) + "\n");
  console.log("🔐 Chaves de segurança criadas no config.json. Faça backup desse arquivo junto com a pasta uploads/.");
}

const app = express();
const db = mysql.createPool(config.banco);

// Opções de segurança (config.json → "seguranca"). Padrão: senha forte e duas etapas para a gestão ligadas.
//   exigir_senha_forte: false  → volta a aceitar senhas curtas (só para demonstração)
//   exigir_2fa_gestao: false   → a gestão não precisa da verificação em duas etapas
//   atras_de_proxy: true       → publicado atrás de Nginx/servidor intermediário: usa o IP real de quem acessa
const SEG = { senhaForte: config.seguranca.exigir_senha_forte !== false, doisFatoresGestao: config.seguranca.exigir_2fa_gestao !== false };
if (config.seguranca.atras_de_proxy === true) app.set("trust proxy", 1);

// Cabeçalhos de segurança em todas as respostas (a API nunca fica em cache do navegador)
app.disable("x-powered-by");
// VLibras (tradução para Libras, do governo federal): o endereço oficial redireciona para o jsDelivr, então a liberação vale só para a pasta oficial do projeto
const VLIBRAS = "https://vlibras.gov.br https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/";
const CSP = `default-src 'self'; script-src 'self' ${VLIBRAS}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${VLIBRAS}; font-src 'self' ${VLIBRAS}; connect-src 'self' ${VLIBRAS} https://traducao2.vlibras.gov.br; frame-src ${VLIBRAS}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000"); // só com HTTPS: o navegador passa a recusar HTTP
  res.setHeader("Content-Security-Policy", CSP);
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json({ limit: "9mb" })); // 9 MB: cabe um arquivo de 5 MB enviado em base64

// Só estas pastas são públicas. config.json (senha do banco), server.js, database/ e uploads/ NÃO são entregues.
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
// sw.js: só desliga e limpa o service worker de versões antigas (o sistema não é instalável). Sem cache, para chegar logo.
app.get("/sw.js", (req, res) => { res.setHeader("Cache-Control", "no-cache"); res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.sendFile(path.join(__dirname, "sw.js")); });

// Pasta onde ficam os documentos anexados (fora das pastas públicas)
const PASTA_UPLOADS = path.join(__dirname, "uploads");
fs.mkdirSync(PASTA_UPLOADS, { recursive: true });

// Critério da Busca Ativa: quantas faltas, em quantos dias, tornam o caso "significativo".
// Para mudar a regra, basta alterar estes dois números.
const BUSCA_ATIVA = { faltas: 5, dias: 30 };
const SISTEMA = { id: null, nome: "Sistema", papel: "sistema" };

// Envolve as rotas para tratar erros em um só lugar
const rota = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (erro) {
    const id = crypto.randomBytes(4).toString("hex");
    console.error(`[erro ${id}] ${req.method} ${req.path}:`, erro.message); // detalhes só no terminal do servidor
    res.status(500).json({ erro: `Erro interno do servidor (código ${id}). Tente de novo; se continuar, anote o código e avise o responsável técnico pelo sistema.` });
  }
};

// Grava uma linha no log de atividades (quem fez o quê, e quando).
// Corrente de hashes: cada linha guarda SHA-256(hash da linha anterior + dados da linha). Apagar ou alterar um log no meio quebra a corrente.
// A fila garante a ordem quando várias ações chegam ao mesmo tempo.
const dataHoraLocal = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const hashLog = (anterior, l) => crypto.createHash("sha256").update([anterior || "", l.id_usuario ?? "", l.nome, l.papel, l.acao, l.detalhe ?? "", l.em].join("|")).digest("hex");
let filaLog = Promise.resolve();
function registrarLog(usuario, acao, detalhe) {
  const tarefa = filaLog.then(async () => {
    const [[ultimo]] = await db.query("SELECT log_hash AS h FROM tb_logs WHERE log_hash IS NOT NULL ORDER BY id_log DESC LIMIT 1");
    const l = { id_usuario: usuario ? usuario.id : null, nome: usuario ? usuario.nome : "Desconhecido", papel: usuario ? usuario.papel : "-", acao, detalhe: detalhe || null, em: dataHoraLocal() };
    await db.query("INSERT INTO tb_logs (id_usuario, log_nome_usuario, log_papel, log_acao, log_detalhe, log_data_hora, log_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [l.id_usuario, l.nome, l.papel, l.acao, l.detalhe, l.em, hashLog(ultimo && ultimo.h, l)]);
  });
  filaLog = tarefa.catch(() => {});
  return tarefa;
}
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
const dataValida = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || "");

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
// 11) Limite de pedidos por minuto por computador nas rotas abertas (login e verificação de assinatura)
const contagemMinuto = new Map();
const limitePorMinuto = (nome, max) => (req, res, next) => {
  const chave = `${nome}|${req.ip}`, agora = Date.now(), c = contagemMinuto.get(chave);
  if (!c || agora - c.inicio > 60000) { contagemMinuto.set(chave, { inicio: agora, n: 1 }); return next(); }
  if (++c.n > max) return res.status(429).json({ erro: "Muitos pedidos em pouco tempo. Aguarde um minuto e tente de novo." });
  next();
};
setInterval(() => { const agora = Date.now(); for (const [k, c] of contagemMinuto) if (agora - c.inicio > 60000) contagemMinuto.delete(k); }, 60 * 1000).unref();

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
function protegerArquivosAntigos() { // arquivos enviados antes desta versão são criptografados na primeira execução
  let total = 0;
  for (const nome of fs.readdirSync(PASTA_UPLOADS)) {
    const caminho = path.join(PASTA_UPLOADS, nome);
    if (!fs.statSync(caminho).isFile()) continue;
    const bytes = fs.readFileSync(caminho);
    if (bytes.subarray(0, MAGIA.length).equals(MAGIA)) continue;
    fs.writeFileSync(caminho, cifrarArquivo(bytes, nome)); total++;
  }
  if (total) console.log(`🔐 ${total} arquivo(s) antigo(s) foram criptografados.`);
}

// ---------- Política de privacidade (LGPD) ----------
// Os dados da escola ficam no config.json, em "escola". Enquanto não forem preenchidos, aparecem entre colchetes.
const escola = Object.assign({
  nome: "[Nome da escola — preencher em config.json]", encarregado_nome: "[Nome do encarregado]",
  encarregado_email: "[e-mail do encarregado]", prazo_retencao: "[prazo definido pela escola]",
}, config.escola || {});
const POLITICA = {
  versao: "1.3", atualizada_em: "11/11/2026", // 1.3: texto mais claro e exceção da lei no compartilhamento (todos aceitam de novo no próximo login)
  secoes: [
    { titulo: "1. Quem cuida dos seus dados", paragrafos: [`O controlador dos dados é ${escola.nome}.`,
      `Encarregado pelo tratamento de dados pessoais (art. 41 da LGPD): ${escola.encarregado_nome} — ${escola.encarregado_email}.`] },
    { titulo: "2. Quais dados são tratados", itens: [
      "Do aluno: nome, turma, matrícula, frequência, ocorrências, pendências e documentos anexados (que podem incluir dados de saúde e de identificação).",
      "Do responsável: nome, telefones, e-mail, forma de contato preferida, foto, usuário de acesso e senha (guardada de forma protegida).",
      "De quem usa o sistema: registros de acesso e das ações realizadas (quem fez o quê e quando).",
      "Entradas e saídas do aluno na escola (horário, portão e se foi pela portaria ou pelo reconhecimento facial)."] },
    { titulo: "3. Para que usamos", paragrafos: ["Gestão escolar, acompanhamento da frequência (incluindo a Busca Ativa de alunos com muitas faltas), comunicação com as famílias, autorizações e segurança dos alunos. Os dados não são usados para publicidade e não são compartilhados com terceiros, exceto quando a lei obriga, como na comunicação ao Conselho Tutelar (item 5)."] },
    { titulo: "4. Dados de crianças e adolescentes", paragrafos: [
      "O tratamento é feito no melhor interesse da criança e do adolescente (art. 14 da LGPD).",
      "Para dados de crianças, a LGPD pede o consentimento específico e em destaque de pelo menos um dos pais ou do responsável legal (art. 14, §1º). Ao aceitar este termo, o responsável declara que é pai, mãe ou responsável legal do aluno e consente com o tratamento descrito aqui.",
      "Além deste termo, o responsável assina, para cada aluno, o Termo de Consentimento sobre o uso de imagem e informações, que pode ser alterado ou revogado a qualquer momento.",
      "Documentos de saúde são dados pessoais sensíveis (arts. 5º, II, e 11) e só são vistos por quem precisa deles para a sua função."] },
    { titulo: "5. Proteção da criança (ECA)", paragrafos: [
      "A escola tem o dever legal de proteger crianças e adolescentes (ECA, Lei 8.069/1990). Por isso, em alguns casos precisa comunicar o Conselho Tutelar, e essa comunicação não depende de consentimento."],
      itens: [
      "Suspeita ou confirmação de maus-tratos: a comunicação ao Conselho Tutelar é obrigatória (ECA, arts. 13 e 56, I).",
      "Faltas reiteradas e evasão escolar, depois de esgotados os recursos da escola (ECA, art. 56, II; LDB, art. 12, VIII).",
      "Esses registros são sigilosos: ficam restritos à gestão e a quem os registrou, não aparecem para os responsáveis nem para outros professores, e cada consulta é registrada.",
      "A escola respeita a imagem e a intimidade do aluno (ECA, art. 17): comunicados para várias famílias não devem citar nomes de alunos, e câmeras de segurança só podem ser usadas em áreas comuns, nunca em banheiros, vestiários ou outros espaços de intimidade."] },
    { titulo: "6. Como protegemos os dados e os arquivos", itens: [
      "Os documentos ficam guardados com criptografia e fora das áreas públicas do site.",
      "Cada perfil acessa só o que precisa: a gestão vê todos os alunos, o professor vê a sua turma e o responsável vê apenas o seu filho.",
      "Envios, downloads e exclusões de documentos ficam registrados (quem, o quê e quando), inclusive as tentativas de acesso negadas.",
      "As senhas ficam guardadas de forma protegida, o acesso expira depois de um tempo e há bloqueio temporário após várias tentativas erradas.",
      "O sistema confere o formato e o tamanho dos arquivos enviados (PDF, PNG, JPG, DOC e DOCX, até 5 MB).",
      "Reconhecimento facial: só funciona se a escola ativar, só para turmas a partir do Pré e só para alunos cujo responsável autorizou no Termo de Consentimento. Sem essa autorização, a câmera não identifica o aluno e a imagem é descartada. O sistema não guarda fotos nem dados biométricos, apenas o horário e o portão da passagem.",
      "Câmeras só ficam em áreas comuns. As imagens das câmeras não aparecem para os responsáveis."] },
    { titulo: "7. Por quanto tempo guardamos", paragrafos: [`Os dados ficam guardados enquanto o aluno estiver matriculado e, depois, pelo prazo exigido pela legislação ou definido pela escola: ${escola.prazo_retencao}. A gestão pode excluir documentos que não forem mais necessários. Os registros de passagem pelas câmeras são apagados automaticamente depois de 90 dias.`] },
    { titulo: "8. Seus direitos (art. 18 da LGPD)", paragrafos: [
      "Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento e revogação do consentimento.",
      "Para acessar os dados do aluno, use o botão \"Baixar os dados do aluno\" na ficha dele. Os demais pedidos devem ser feitos ao encarregado, pelo contato do item 1."] },
    { titulo: "9. Incidentes de segurança", paragrafos: ["Se houver um incidente de segurança que possa causar risco ou dano relevante, a escola comunica a ANPD e as pessoas afetadas (art. 48 da LGPD)."] },
    { titulo: "10. Para quem trabalha na escola", paragrafos: ["Os dados a que você tem acesso são confidenciais: use-os somente para a sua função, não compartilhe sua senha e lembre que os acessos ficam registrados."] },
  ],
};

app.get("/api/privacidade", (req, res) => res.json(POLITICA)); // pública: a política pode ser lida antes do login

app.post("/api/login", limitePorMinuto("login", 30), rota(async (req, res) => {
  const { usuario, senha, codigo } = req.body;
  const login = String(usuario || "").toLowerCase();
  const chave = `par|${req.ip}|${login}`, chaveConta = `conta|${login}`, chaveIp = `ip|${req.ip}`;
  const minutos = Math.max(minutosBloqueado(chave), minutosBloqueado(chaveConta), minutosBloqueado(chaveIp));
  if (minutos) {
    await registrarLog(null, "login_bloqueado", `Usuário "${usuario}" bloqueado por tentativas erradas`);
    return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  }
  await verificarInatividade(); // confere os 60 dias antes de deixar entrar
  const [linhas] = await db.query("SELECT id_usuario AS id, usu_papel AS papel, id_aluno AS aluno_id, usu_sala AS sala, usu_nome AS nome, usu_senha_temporaria AS senha_temporaria, usu_senha AS senha, usu_aceite_versao AS aceite_versao, usu_ativo AS ativo, usu_inativado_motivo AS motivo, id_responsavel AS id_responsavel, usu_sessao_versao AS sessao, usu_2fa_ativo AS dois_ativo, usu_2fa_segredo AS dois_segredo, usu_2fa_metodo AS dois_metodo, usu_2fa_destino AS dois_destino, usu_2fa_codigo_hash AS codigo_hash, usu_2fa_codigo_expira > NOW() AS codigo_valido, usu_2fa_codigo_expira > NOW() + INTERVAL 9 MINUTE AS codigo_recente, usu_tutorial_visto_em AS tutorial_visto, usu_acessibilidade AS acessibilidade FROM tb_usuarios WHERE usu_usuario = ?", [String(usuario || "")]);
  const u = linhas[0];
  const senhaOk = await conferirSenha(senha, u ? u.senha : HASH_FALSO);
  if (u && senhaOk && !u.ativo && u.motivo === "inatividade") { // senha certa, mas o acesso foi suspenso por 60 dias sem uso
    tentativas.delete(chave);
    const [r] = await db.query("UPDATE tb_usuarios SET usu_reativacao_pedida_em = NOW() WHERE id_usuario = ? AND usu_reativacao_pedida_em IS NULL", [u.id]);
    if (r.affectedRows) await registrarLog(u, "reativacao_solicitada", `${u.nome} (${u.sala || "-"})`);
    return res.status(403).json({ codigo: "INATIVO_POR_INATIVIDADE", erro: `Seu acesso foi suspenso porque ficou mais de ${INATIVIDADE.dias} dias sem entrar no sistema. Já avisamos a gestão da escola: assim que ela reativar, você recebe uma senha provisória nova.` });
  }
  if (!u || !senhaOk || !u.ativo) {
    registrarFalha(chave, "par"); registrarFalha(chaveConta, "conta"); registrarFalha(chaveIp, "ip");
    await registrarLog(null, "login_falha", `Tentativa com usuário "${usuario}"`);
    return res.status(401).json({ erro: "Usuário ou senha incorretos, ou acesso desativado. Confira e tente de novo." });
  }
  // Duas etapas: com a senha certa, pede o código do aplicativo, do e-mail ou do celular (a senha é enviada de novo junto com o código)
  if (u.dois_ativo) {
    const metodo = u.dois_metodo || "app", noAplicativo = metodo === "app";
    if (!codigo) {
      if (noAplicativo) return res.json({ precisa_codigo: true, metodo });
      if (!u.codigo_recente) { // não reenvia em menos de 1 minuto
        try { await enviarCodigo2fa(u.id, metodo, u.dois_destino); }
        catch (erro) { console.error("Código de verificação:", erro.message); return res.status(502).json({ erro: "Não foi possível enviar o código agora. Tente de novo em instantes." }); }
      }
      return res.json({ precisa_codigo: true, metodo, destino: mascararDestino(metodo, u.dois_destino), simulado: envioSimulado(metodo) });
    }
    if (!(noAplicativo ? totpConfere(lerSegredo2fa(u.id, u.dois_segredo), codigo) : codigo2faConfere(u.id, u, codigo))) {
      registrarFalha(chave, "par"); registrarFalha(chaveConta, "conta");
      await registrarLog(u, "login_codigo_errado", null);
      return res.status(401).json({ erro: `Código ${noAplicativo ? "do aplicativo " : ""}inválido ou vencido. Confira e tente de novo.` });
    }
    if (!noAplicativo) await db.query("UPDATE tb_usuarios SET usu_2fa_codigo_hash = NULL, usu_2fa_codigo_expira = NULL WHERE id_usuario = ?", [u.id]); // cada código vale uma vez
  }
  tentativas.delete(chave); tentativas.delete(chaveConta);
  // Senha que não segue as regras (ex.: 123456): entra, mas é obrigado a trocar antes de usar o sistema
  const senhaFraca = !u.senha_temporaria && !!problemaNaSenha(senha, login);
  if (senhaFraca) await db.query("UPDATE tb_usuarios SET usu_senha_temporaria = TRUE WHERE id_usuario = ?", [u.id]);
  if (!u.senha.startsWith("scrypt$")) await db.query("UPDATE tb_usuarios SET usu_senha = ? WHERE id_usuario = ?", [await hashSenha(senha), u.id]);
  await db.query("UPDATE tb_usuarios SET usu_ultimo_acesso = NOW() WHERE id_usuario = ?", [u.id]);
  await registrarLog(u, "login_sucesso", null);
  const ctx = await contextoDoUsuario(u);
  res.json({ token: gerarToken(u), id: u.id, usuario: login, papel: u.papel, nome: u.nome, aluno_id: ctx.alunoPadrao, sala: ctx.salaPadrao, filhos: ctx.filhos, turmas: ctx.turmas,
    senha_temporaria: !!u.senha_temporaria || senhaFraca, senha_fraca: senhaFraca, aceite_ok: u.aceite_versao === POLITICA.versao,
    configurar_2fa: SEG.doisFatoresGestao && u.papel === "admin" && !u.dois_ativo, tutorial_visto: !!u.tutorial_visto, acessibilidade: lerAcessibilidade(u.acessibilidade) });
}));

// Esqueci minha senha: manda um link de uso único para o e-mail da pessoa. Sem e-mail (ou se o envio falhar), o pedido vai para a gestão.
// A resposta é sempre a mesma e não espera o envio, exista ou não o usuário: esta rota não serve para descobrir quem tem conta.
// No banco fica só o hash do código: quem ler a tabela não consegue usar o link. A senha só muda em /api/redefinir-senha.
const RECUPERACAO_MINUTOS = 30;
const hashDoCodigo = (codigo) => crypto.createHash("sha256").update(codigo).digest("hex");
async function pedirSenhaAGestao(login) {
  const [r] = await db.query("UPDATE tb_usuarios SET usu_senha_pedida_em = NOW() WHERE usu_usuario = ? AND usu_ativo = TRUE AND usu_senha_pedida_em IS NULL", [login]);
  if (r.affectedRows) await registrarLog(null, "recuperacao_senha_pedida", `Usuário "${login}"`);
}
async function iniciarRecuperacao(login) {
  const [[u]] = await db.query(`SELECT COALESCE(u.usu_email, r.res_email) AS email, u.usu_recuperacao_expira > NOW() + INTERVAL ? MINUTE AS recente
    FROM tb_usuarios u LEFT JOIN tb_resp r ON r.id_responsavel = u.id_responsavel WHERE u.usu_usuario = ? AND u.usu_ativo = TRUE`, [RECUPERACAO_MINUTOS - 2, login]);
  if (!u) return;
  if (!u.email) return pedirSenhaAGestao(login);
  if (u.recente) return; // já mandou há menos de 2 minutos: não enche a caixa de entrada da pessoa
  const codigo = crypto.randomBytes(32).toString("hex");
  await db.query("UPDATE tb_usuarios SET usu_recuperacao_hash = ?, usu_recuperacao_expira = NOW() + INTERVAL ? MINUTE WHERE usu_usuario = ?", [hashDoCodigo(codigo), RECUPERACAO_MINUTOS, login]);
  // O endereço vem do config.json, nunca do pedido: assim ninguém forja um link que aponte para outro site
  const base = String((config.email || {}).url_base || `${protocolo}://localhost:${config.porta}`).replace(/\/+$/, "");
  try {
    await enviarEmail({ para: u.email, assunto: "S.I.V.E.: redefinição de senha",
      texto: `Recebemos um pedido para redefinir a sua senha do S.I.V.E.\n\nPara criar uma senha nova, abra o link abaixo. Ele vale por ${RECUPERACAO_MINUTOS} minutos e só funciona uma vez:\n${base}/#redefinir=${codigo}\n\nSe não foi você, ignore este e-mail: a sua senha continua a mesma.` });
    await registrarLog(null, "recuperacao_senha_email", `Usuário "${login}"`);
  } catch (erro) {
    console.error("Não foi possível enviar o e-mail de recuperação:", erro.message);
    await pedirSenhaAGestao(login);
  }
}
app.post("/api/recuperar-senha", limitePorMinuto("recuperar", 5), rota(async (req, res) => {
  const login = String((req.body || {}).usuario || "").trim().toLowerCase().slice(0, 60);
  if (login) iniciarRecuperacao(login).catch((erro) => console.error("Recuperação de senha:", erro.message));
  res.json({ ok: true });
}));
app.post("/api/redefinir-senha", limitePorMinuto("redefinir", 10), rota(async (req, res) => {
  const { codigo, senha } = req.body || {};
  const [[u]] = /^[0-9a-f]{64}$/.test(String(codigo)) ? await db.query(`SELECT id_usuario AS id, usu_nome AS nome, usu_papel AS papel, usu_usuario AS login FROM tb_usuarios
    WHERE usu_recuperacao_hash = ? AND usu_recuperacao_expira > NOW() AND usu_ativo = TRUE`, [hashDoCodigo(codigo)]) : [[]];
  if (!u) return res.status(400).json({ erro: "Este link é inválido ou já venceu. Peça um novo em Esqueci minha senha." });
  const problema = problemaNaSenha(senha, u.login);
  if (problema) return res.status(400).json({ erro: problema });
  await db.query(`UPDATE tb_usuarios SET usu_senha = ?, usu_senha_temporaria = FALSE, usu_senha_pedida_em = NULL, usu_recuperacao_hash = NULL, usu_recuperacao_expira = NULL,
    usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?`, [await hashSenha(senha), u.id]);
  tentativas.delete(`conta|${u.login}`);
  await registrarLog(u, "senha_redefinida_email", "outras sessões encerradas");
  res.json({ ok: true });
}));

// Lê o token, confere no banco se o usuário continua ativo e diz quem está fazendo a requisição.
// Quem ainda não aceitou a política de privacidade só consegue trocar a senha e aceitar o termo.
const ROTAS_SEM_ACEITE = new Set(["PUT /api/minha-senha", "POST /api/aceite-privacidade", "POST /api/sair", "PUT /api/acessibilidade"]);
// Gestão sem as duas etapas configuradas só consegue configurar (e trocar a senha / aceitar o termo / sair)
const ROTAS_SEM_2FA = new Set([...ROTAS_SEM_ACEITE, "POST /api/2fa/novo", "POST /api/2fa/ativar"]);
async function autenticar(req, res, next) {
  let dados;
  try { dados = lerToken((req.headers.authorization || "").replace("Bearer ", "")); }
  catch { return res.status(401).json({ erro: "Não autenticado." }); }
  try {
    const [[u]] = await db.query("SELECT id_usuario AS id, usu_papel AS papel, id_aluno AS aluno_id, usu_sala AS sala, usu_nome AS nome, usu_aceite_versao AS aceite_versao, id_responsavel AS id_responsavel, usu_sessao_versao AS sessao, usu_2fa_ativo AS dois_ativo FROM tb_usuarios WHERE id_usuario = ? AND usu_ativo = TRUE", [dados.id]);
    if (!u || (dados.v || 0) !== u.sessao) return res.status(401).json({ erro: "Não autenticado." }); // sessão encerrada (Sair, troca de senha...)
    const ctx = await contextoDoUsuario(u);
    const filhos = ctx.filhos.map((f) => f.id), pedido = Number(req.headers["x-aluno"]);
    let turmaPedida = ""; try { turmaPedida = decodeURIComponent(req.headers["x-turma"] || ""); } catch { /* cabeçalho malformado: usa a turma principal */ }
    req.usuario = { id: u.id, papel: u.papel, nome: u.nome, id_responsavel: u.id_responsavel, filhos, turmas: ctx.turmas,
      aluno_id: filhos.includes(pedido) ? pedido : ctx.alunoPadrao, sala: ctx.turmas.includes(turmaPedida) ? turmaPedida : ctx.salaPadrao };
    if (u.aceite_versao !== POLITICA.versao && !ROTAS_SEM_ACEITE.has(`${req.method} ${req.path}`))
      return res.status(403).json({ erro: "Leia e aceite a política de privacidade para continuar.", codigo: "ACEITE_PENDENTE" });
    if (SEG.doisFatoresGestao && u.papel === "admin" && !u.dois_ativo && !ROTAS_SEM_2FA.has(`${req.method} ${req.path}`))
      return res.status(403).json({ erro: "Configure a verificação em duas etapas para continuar.", codigo: "2FA_PENDENTE" });
    next();
  } catch (erro) { console.error(erro); res.status(500).json({ erro: "Erro interno do servidor. Tente de novo." }); }
}
// Quem está logado pode ter mais de um vínculo: o responsável, vários filhos (aluno_responsavel); o professor, várias turmas (professor_turma).
// alunoPadrao / salaPadrao: o que abre primeiro (o filho do cadastro do login / a turma principal do professor).
async function contextoDoUsuario(u) {
  if (u.papel === "pai") {
    const [filhos] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala FROM tb_alunos a
      WHERE a.id_aluno = ? OR a.id_aluno IN (SELECT ar.id_aluno FROM tb_aluno_resp ar WHERE ar.id_responsavel = ?)
      ORDER BY a.id_aluno = ? DESC, a.alu_nome`, [u.aluno_id || 0, u.id_responsavel || 0, u.aluno_id || 0]);
    return { filhos, turmas: [], alunoPadrao: filhos.length ? filhos[0].id : null, salaPadrao: null };
  }
  if (u.papel === "professor") {
    const [linhas] = await db.query(`SELECT t.tur_nome AS nome FROM tb_professor_turma pt JOIN tb_turmas t ON t.id_turma = pt.id_turma
      WHERE pt.id_usuario = ? AND t.tur_ativa = TRUE ORDER BY t.tur_nome = ? DESC, t.tur_nome`, [u.id, u.sala || ""]);
    const turmas = linhas.map((l) => l.nome);
    if (!turmas.length && u.sala) turmas.push(u.sala);
    return { filhos: [], turmas, alunoPadrao: null, salaPadrao: turmas[0] || null };
  }
  return { filhos: [], turmas: [], alunoPadrao: null, salaPadrao: null };
}
const idsOuZero = (lista) => (lista.length ? lista : [0]); // "IN ()" vazio é erro no MySQL
// A turma existe? (o banco também recusa, mas assim a mensagem é clara)
async function turmaExiste(nome) {
  const [[t]] = await db.query("SELECT tur_nome AS nome FROM tb_turmas WHERE tur_nome = ?", [String(nome || "").trim()]);
  return t ? t.nome : null;
}
const apenasAdmin = (req, res, next) => req.usuario.papel === "admin" ? next() : res.status(403).json({ erro: "Somente a administração pode acessar isso." });
const apenasProfessor = (req, res, next) => req.usuario.papel === "professor" ? next() : res.status(403).json({ erro: "Esta área é só para docentes." });
// Deixa passar administradores, ou o pai/mãe consultando o próprio filho
function proprioAlunoOuAdmin(req, res, next) {
  const alunoId = Number(req.params.alunoId);
  if (req.usuario.papel === "admin" || req.usuario.filhos.includes(alunoId)) return next();
  res.status(403).json({ erro: "Você só pode consultar os dados do seu próprio filho." });
}

// ---------- Trocar a própria senha (qualquer papel) ----------
app.put("/api/minha-senha", autenticar, rota(async (req, res) => {
  const { senha_atual, senha_nova } = req.body;
  const [[u]] = await db.query("SELECT usu_senha AS senha, usu_usuario AS login FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const problema = problemaNaSenha(senha_nova, u && u.login);
  if (problema) return res.status(400).json({ erro: problema });
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  if (!u || !(await conferirSenha(senha_atual, u.senha))) { registrarFalha(chave); return res.status(400).json({ erro: "Senha atual incorreta." }); }
  if (senha_atual === senha_nova) return res.status(400).json({ erro: "A nova senha precisa ser diferente da atual." });
  await db.query("UPDATE tb_usuarios SET usu_senha = ?, usu_senha_temporaria = FALSE, usu_senha_pedida_em = NULL, usu_recuperacao_hash = NULL, usu_recuperacao_expira = NULL, usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?", [await hashSenha(senha_nova), req.usuario.id]);
  await registrarLog(req.usuario, "troca_senha", "outras sessões encerradas");
  const [[novo]] = await db.query("SELECT id_usuario AS id, usu_sessao_versao AS sessao FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  res.json({ ok: true, token: gerarToken(novo) }); // este navegador continua logado; os outros saem
}));

// "Sair": encerra o login em todos os aparelhos (o token antigo deixa de valer na hora)
app.post("/api/sair", autenticar, rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?", [req.usuario.id]);
  await registrarLog(req.usuario, "logout", null);
  res.json({ ok: true });
}));

// Duas etapas por e-mail, SMS ou WhatsApp: código de 6 números que vale 10 minutos e uma vez só.
// No banco fica só um HMAC com a chave do servidor: com tão poucos números, um hash simples seria descoberto por tentativa.
const hashCodigo2fa = (usuId, codigo) => crypto.createHmac("sha256", config.seguranca.segredo_token).update(`2fa|${usuId}|${codigo}`).digest("hex");
const envioSimulado = (metodo) => (metodo === "email" ? emailSimulado : telefoneSimulado);
const mascararDestino = (metodo, destino) => (metodo === "email" ? destino.replace(/^(.{1,2}).*?(@.*)$/, "$1***$2") : `(**) *****-${destino.slice(-4)}`);
async function enviarCodigo2fa(usuId, metodo, destino) {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await db.query("UPDATE tb_usuarios SET usu_2fa_codigo_hash = ?, usu_2fa_codigo_expira = NOW() + INTERVAL 10 MINUTE WHERE id_usuario = ?", [hashCodigo2fa(usuId, codigo), usuId]);
  const texto = `Seu código de verificação do S.I.V.E. é ${codigo}. Ele vale por 10 minutos. Não passe este código para ninguém.`;
  if (metodo === "email") await enviarEmail({ para: destino, assunto: "S.I.V.E.: código de verificação", texto });
  else await enviarMensagemTelefone({ para: destino, canal: metodo, texto });
}
function codigo2faConfere(usuId, guardado, codigo) {
  const c = String(codigo || "").replace(/\D/g, "");
  if (c.length !== 6 || !guardado.codigo_hash || !guardado.codigo_valido) return false;
  return crypto.timingSafeEqual(Buffer.from(hashCodigo2fa(usuId, c)), Buffer.from(guardado.codigo_hash));
}
// Duas etapas: prepara o método escolhido (ainda desligado). Aplicativo: gera o segredo e o QR code. E-mail ou celular: manda um código.
app.post("/api/2fa/novo", limitePorMinuto("2fa-novo", 10), autenticar, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT usu_usuario AS login, usu_2fa_ativo AS ativo FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  if (u.ativo) return res.status(400).json({ erro: "A verificação em duas etapas já está ligada." });
  const metodo = (req.body || {}).metodo || "app";
  if (metodo === "app") {
    const segredo = paraBase32(crypto.randomBytes(20));
    await db.query("UPDATE tb_usuarios SET usu_2fa_segredo = ?, usu_2fa_metodo = 'app', usu_2fa_destino = NULL, usu_2fa_codigo_hash = NULL, usu_2fa_codigo_expira = NULL WHERE id_usuario = ?", [guardarSegredo2fa(req.usuario.id, segredo), req.usuario.id]);
    const url = `otpauth://totp/${encodeURIComponent("SIVE:" + u.login)}?secret=${segredo}&issuer=SIVE&digits=6&period=30`;
    return res.json({ segredo, qr: await QRCode.toString(url, { type: "svg", margin: 1 }) });
  }
  if (!["email", "sms", "whatsapp"].includes(metodo)) return res.status(400).json({ erro: "Escolha uma das opções." });
  const destino = metodo === "email" ? String(req.body.destino || "").trim().toLowerCase() : soNumeros(req.body.destino);
  if (metodo === "email" && !emailValido(destino)) return res.status(400).json({ erro: "Informe um e-mail válido." });
  if (metodo !== "email" && !/^[1-9]{2}9?\d{8}$/.test(destino)) return res.status(400).json({ erro: "Informe o celular com DDD (ex.: 11 98765-4321)." });
  await db.query("UPDATE tb_usuarios SET usu_2fa_segredo = NULL, usu_2fa_metodo = ?, usu_2fa_destino = ? WHERE id_usuario = ?", [metodo, destino, req.usuario.id]);
  try { await enviarCodigo2fa(req.usuario.id, metodo, destino); }
  catch (erro) { console.error("Código de verificação:", erro.message); return res.status(502).json({ erro: "Não foi possível enviar o código agora. Confira os dados ou escolha outra opção." }); }
  res.json({ ok: true, destino: mascararDestino(metodo, destino), simulado: envioSimulado(metodo) });
}));
// Liga as duas etapas depois que a pessoa digita um código certo (prova que recebe o código)
app.post("/api/2fa/ativar", autenticar, rota(async (req, res) => {
  const [[u]] = await db.query(`SELECT usu_2fa_segredo AS segredo, usu_2fa_ativo AS ativo, usu_2fa_metodo AS metodo, usu_2fa_codigo_hash AS codigo_hash,
    usu_2fa_codigo_expira > NOW() AS codigo_valido FROM tb_usuarios WHERE id_usuario = ?`, [req.usuario.id]);
  if (u.ativo) return res.status(400).json({ erro: "A verificação em duas etapas já está ligada." });
  const chave = `2fa-ativar|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  const noAplicativo = (u.metodo || "app") === "app";
  if (noAplicativo && !u.segredo) return res.status(400).json({ erro: "Gere o QR code antes de digitar o código." });
  if (!(noAplicativo ? totpConfere(lerSegredo2fa(req.usuario.id, u.segredo), req.body.codigo) : codigo2faConfere(req.usuario.id, u, req.body.codigo))) {
    registrarFalha(chave);
    return res.status(400).json({ erro: noAplicativo ? "Código inválido. Confira o horário do celular e digite o código que aparece agora." : "Código inválido ou vencido. Confira e tente de novo." });
  }
  await db.query("UPDATE tb_usuarios SET usu_2fa_ativo = TRUE, usu_2fa_codigo_hash = NULL, usu_2fa_codigo_expira = NULL WHERE id_usuario = ?", [req.usuario.id]);
  await registrarLog(req.usuario, "2fa_ativada", noAplicativo ? "aplicativo" : u.metodo);
  res.json({ ok: true });
}));
// A gestão desliga as duas etapas de alguém que perdeu o celular (a pessoa configura de novo no próximo login)
app.put("/api/usuarios/:id/2fa/zerar", autenticar, apenasAdmin, rota(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) return res.status(400).json({ erro: "Peça a outra pessoa da gestão para redefinir a sua verificação em duas etapas." });
  const [[u]] = await db.query("SELECT usu_nome AS nome FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  await db.query("UPDATE tb_usuarios SET usu_2fa_ativo = FALSE, usu_2fa_segredo = NULL, usu_2fa_metodo = 'app', usu_2fa_destino = NULL, usu_2fa_codigo_hash = NULL, usu_2fa_codigo_expira = NULL, usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?", [req.params.id]);
  await registrarLog(req.usuario, "2fa_zerada", u.nome);
  res.json({ ok: true });
}));

// ---------- Busca Ativa: o sistema conta as faltas e abre os casos sozinho ----------
async function executarSincronizacao() {
  const [novos] = await db.query(`SELECT p.id_aluno AS aluno_id, COUNT(*) AS faltas FROM tb_presencas p
    WHERE p.pre_status = 'Ausente' AND p.pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND p.pre_data <= CURDATE()
      AND p.pre_data > COALESCE((SELECT DATE(MAX(b.bua_encerrada_em)) FROM tb_busca_ativa b WHERE b.id_aluno = p.id_aluno), '1900-01-01')
      AND p.id_aluno NOT IN (SELECT id_aluno FROM tb_busca_ativa WHERE bua_status = 'Em acompanhamento')
    GROUP BY p.id_aluno HAVING COUNT(*) >= ?`, [BUSCA_ATIVA.dias, BUSCA_ATIVA.faltas]);
  for (const n of novos) {
    const [r] = await db.query("INSERT INTO tb_busca_ativa (id_aluno, bua_faltas_ao_abrir) VALUES (?, ?)", [n.aluno_id, n.faltas]);
    await db.query("INSERT INTO tb_busca_ativa_registros (id_busca_ativa, bar_usuario_id, bar_nome_usuario, bar_texto) VALUES (?, NULL, 'Sistema', ?)",
      [r.insertId, `Caso aberto automaticamente: ${n.faltas} faltas nos últimos ${BUSCA_ATIVA.dias} dias.`]);
    const [[a]] = await db.query("SELECT alu_nome AS nome FROM tb_alunos WHERE id_aluno = ?", [n.aluno_id]);
    await registrarLog(SISTEMA, "busca_ativa_aberta", `${a.nome} (${n.faltas} faltas)`);
  }
}
// Fila simples: evita que duas telas abram o mesmo caso duas vezes ao mesmo tempo
let filaSync = Promise.resolve();
const sincronizarBuscaAtiva = () => (filaSync = filaSync.catch(() => {}).then(executarSincronizacao));

// Dia que os quadros mostram: hoje, se for dia de aula; no fim de semana, o último dia de aula com chamada registrada.
// (Antes, um registro no sábado — ex.: passagem pelo portão — fazia o sistema abrir "hoje" com quase todos "sem registro".)
async function dataReferencia() {
  const [[r]] = await db.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje, DAYOFWEEK(CURDATE()) IN (1, 7) AS fim_de_semana,
    (SELECT DATE_FORMAT(MAX(pre_data), '%Y-%m-%d') FROM tb_presencas WHERE pre_data <= CURDATE() AND DAYOFWEEK(pre_data) NOT IN (1, 7)) AS ultimo_dia_letivo`);
  return { data: r.fim_de_semana ? r.ultimo_dia_letivo || r.hoje : r.hoje, hoje: r.hoje, fim_de_semana: !!r.fim_de_semana };
}
const percentual = (presentes, ausentes) => (presentes + ausentes) ? Math.round(presentes * 1000 / (presentes + ausentes)) / 10 : null;

// ---------- Quadros indicadores da Secretaria (só administração) ----------
app.get("/api/resumo", autenticar, apenasAdmin, rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  await verificarInatividade();
  const ref = await dataReferencia();
  const [[total]] = await db.query("SELECT COUNT(*) AS n FROM tb_alunos WHERE alu_situacao = 'Ativo'");
  const [[reat]] = await db.query("SELECT COUNT(*) AS inativos, COUNT(usu_reativacao_pedida_em) AS pedidos FROM tb_usuarios WHERE usu_papel = 'professor' AND usu_ativo = FALSE AND usu_inativado_motivo = 'inatividade'");
  const [[pedidosSenha]] = await db.query("SELECT COUNT(*) AS n FROM tb_usuarios WHERE usu_ativo = TRUE AND usu_senha_pedida_em IS NOT NULL");
  const [[dia]] = await db.query(`SELECT COUNT(CASE WHEN pre_status = 'Presente' THEN 1 END) AS presentes,
    COUNT(CASE WHEN pre_status = 'Ausente' THEN 1 END) AS ausentes FROM tb_presencas WHERE pre_data = ?`, [ref.data]);
  const [[ocor]] = await db.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN adv_tipo = 'Advertencia' THEN 1 END) AS advertencias,
    COUNT(CASE WHEN adv_tipo = 'Acao' THEN 1 END) AS acoes FROM tb_advertencias WHERE adv_data = ?`, [ref.data]);
  const [[busca]] = await db.query("SELECT COUNT(*) AS n FROM tb_busca_ativa WHERE bua_status = 'Em acompanhamento'");
  const [[aut]] = await db.query("SELECT COUNT(*) AS n FROM tb_autorizacoes WHERE aut_assinada = TRUE AND aut_assinada_em >= NOW() - INTERVAL 24 HOUR");
  const [[docs]] = await db.query(`SELECT COUNT(*) AS n FROM tb_documentos d ${DOCS_RECENTES}`);
  const [[ctp]] = await db.query("SELECT COUNT(*) AS n FROM tb_comunicacoes_conselho WHERE cct_comunicado_em IS NULL");
  const [[oce]] = await db.query(`SELECT COUNT(*) AS n, COUNT(CASE WHEN oce_resp_assinada_em IS NULL THEN 1 END) AS sem_resp
    FROM tb_ocorrencias_escolares WHERE oce_ges_assinada_em IS NULL`);
  res.json({
    data: ref.data, eh_hoje: ref.data === ref.hoje, fim_de_semana: ref.fim_de_semana, total_alunos: total.n,
    presentes: dia.presentes, ausentes: dia.ausentes, sem_registro: Math.max(0, total.n - dia.presentes - dia.ausentes),
    ocorrencias_dia: ocor.total, advertencias_dia: ocor.advertencias, acoes_dia: ocor.acoes,
    ocorrencias_gestao: oce.n, ocorrencias_sem_resp: oce.sem_resp,
    percentual: percentual(dia.presentes, dia.ausentes), busca_ativa: busca.n, autorizacoes_recentes: aut.n, documentos_recentes: docs.n, comunicacoes_pendentes: ctp.n,
    professores_inativos: reat.inativos, reativacoes_pedidas: reat.pedidos, senhas_pedidas: pedidosSenha.n, inatividade_dias: INATIVIDADE.dias,
  });
}));

// Pasta "Documentos recebidos recentemente": documentos que atenderam a uma pendência, enviados por responsáveis, nas últimas 24 horas.
// Depois de 24 horas o documento sai da pasta, mas continua guardado na ficha do aluno.
const DOCS_RECENTES_JOIN = "JOIN tb_usuarios u ON u.id_usuario = d.id_usuario AND u.usu_papel = 'pai'";
const DOCS_RECENTES_FILTRO = "WHERE d.pen_id IS NOT NULL AND d.doc_enviado_em >= NOW() - INTERVAL 24 HOUR";
const DOCS_RECENTES = `${DOCS_RECENTES_JOIN} ${DOCS_RECENTES_FILTRO}`;
app.get("/api/documentos-recentes", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT d.doc_id AS id, d.doc_titulo AS titulo, d.doc_categoria AS categoria, d.doc_nome_original AS nome_original, d.doc_tamanho AS tamanho,
    d.doc_enviado_por_nome AS enviado_por, ar.alr_parentesco AS parentesco, DATE_FORMAT(d.doc_enviado_em, '%d/%m/%Y %H:%i') AS enviado_em,
    GREATEST(1, CEIL(TIMESTAMPDIFF(MINUTE, NOW(), d.doc_enviado_em + INTERVAL 24 HOUR) / 60)) AS horas_restantes,
    p.pen_descricao AS pendencia, a.id_aluno AS aluno_id, a.alu_nome AS aluno_nome, a.alu_sala AS sala, a.alu_matricula AS matricula
    FROM tb_documentos d ${DOCS_RECENTES_JOIN} JOIN tb_alunos a ON a.id_aluno = d.id_aluno JOIN tb_pendencias p ON p.pen_id = d.pen_id
    LEFT JOIN tb_aluno_resp ar ON ar.id_aluno = d.id_aluno AND ar.id_responsavel = u.id_responsavel
    ${DOCS_RECENTES_FILTRO} ORDER BY d.doc_enviado_em DESC`);
  res.json(linhas);
}));

// ---------- Secretaria (só administração) ----------
app.get("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query("SELECT id_aluno AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula, alu_situacao AS situacao, DATE_FORMAT(alu_situacao_em, '%d/%m/%Y') AS situacao_em FROM tb_alunos ORDER BY id_aluno");
  res.json(linhas);
}));

// Cadastro completo de um aluno: dados da criança + responsáveis (pai/mãe/etc.)
app.post("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const { nome, sala, matricula, responsaveis } = req.body;
  if (!nome || !sala) return res.status(400).json({ erro: "Informe o nome do aluno e a turma." });
  if (!(await turmaExiste(sala))) return res.status(400).json({ erro: "Escolha uma turma cadastrada. Se ela ainda não existe, cadastre em Alunos e turmas." });
  let resultado;
  try { [resultado] = await db.query("INSERT INTO tb_alunos (alu_nome, alu_sala, alu_matricula) VALUES (?, ?, ?)", [nome, sala, matricula || null]); }
  catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe um aluno com essa matrícula." });
    throw erro;
  }
  const alunoId = resultado.insertId;
  for (const r of responsaveis || []) {
    if (!r.nome) continue;
    const [[existe]] = await db.query("SELECT id_responsavel AS id FROM tb_resp WHERE res_nome = ? AND res_telefone <=> ?", [r.nome, r.telefone || null]);
    const responsavelId = existe ? existe.id : (await db.query("INSERT INTO tb_resp (res_nome, res_telefone) VALUES (?, ?)", [r.nome, r.telefone || null]))[0].insertId;
    await db.query("INSERT INTO tb_aluno_resp (id_aluno, id_responsavel, alr_parentesco) VALUES (?, ?, ?)", [alunoId, responsavelId, r.parentesco || "Responsável"]);
  }
  await registrarLog(req.usuario, "cadastro_aluno", `${nome} (${sala})`);
  res.status(201).json({ ok: true, id: alunoId });
}));

// ---------- Importar vários alunos de uma planilha (CSV ou Excel) — só administração ----------
// Dois passos na mesma rota: confirmar = false só CONFERE a planilha e devolve a pré-visualização; confirmar = true grava.
// Só entram as linhas "ok". Erros e duplicados ficam de fora. A gravação é tudo ou nada (transação).
app.post("/api/alunos/importar", autenticar, apenasAdmin, rota(async (req, res) => {
  const { nome_arquivo, conteudo, turma_padrao, confirmar } = req.body;
  if (typeof conteudo !== "string") return res.status(400).json({ erro: "Escolha um arquivo para importar." });
  const buffer = Buffer.from(conteudo, "base64");
  if (buffer.length > importador.TAMANHO_MAXIMO) return res.status(400).json({ erro: "O arquivo tem mais de 2 MB. Divida a planilha em partes." });
  let analise;
  try { analise = importador.analisar(await importador.lerPlanilha(buffer), { turmaPadrao: typeof turma_padrao === "string" ? turma_padrao : "" }); }
  catch (erro) { if (erro instanceof importador.ErroPlanilha) return res.status(400).json({ erro: erro.message }); throw erro; }
  const [existentes] = await db.query("SELECT alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM tb_alunos");
  importador.marcarDuplicados(analise.linhas, existentes);
  const prontas = analise.linhas.filter((l) => l.status === "ok");
  const resumo = { total: analise.linhas.length, prontos: prontas.length, duplicados: analise.linhas.filter((l) => l.status === "duplicado").length, com_erro: analise.linhas.filter((l) => l.status === "erro").length };
  const colunas = { reconhecidas: analise.reconhecidas, ignoradas: analise.ignoradas };
  if (confirmar !== true) return res.json({ ...resumo, ...colunas, linhas: analise.linhas });

  if (!prontas.length) return res.status(400).json({ erro: "Nenhum aluno pronto para importar. Corrija a planilha e envie de novo." });
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    for (const l of prontas) {
      await conexao.query("INSERT IGNORE INTO tb_turmas (tur_nome, tur_ano_letivo) VALUES (?, YEAR(CURDATE()))", [l.sala]);
      const [r] = await conexao.query("INSERT INTO tb_alunos (alu_nome, alu_sala, alu_matricula) VALUES (?, ?, ?)", [l.nome, l.sala, l.matricula || null]);
      for (const resp of l.responsaveis) { // mesmo responsável (nome + telefone) de irmãos é reaproveitado, como no cadastro individual
        const [[existe]] = await conexao.query("SELECT id_responsavel AS id FROM tb_resp WHERE res_nome = ? AND res_telefone <=> ?", [resp.nome, resp.telefone || null]);
        const respId = existe ? existe.id : (await conexao.query("INSERT INTO tb_resp (res_nome, res_telefone) VALUES (?, ?)", [resp.nome, resp.telefone || null]))[0].insertId;
        await conexao.query("INSERT INTO tb_aluno_resp (id_aluno, id_responsavel, alr_parentesco) VALUES (?, ?, ?)", [r.insertId, respId, resp.parentesco]);
      }
    }
    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Outro cadastro com a mesma matrícula entrou durante a importação. Nada foi importado: confira a planilha de novo." });
    throw erro;
  } finally { conexao.release(); }
  prontas.forEach((l) => { l.status = "importado"; });
  const arquivo = String(nome_arquivo || "planilha").replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 60);
  await registrarLog(req.usuario, "importacao_alunos", `${arquivo}: ${prontas.length} aluno(s) importado(s), ${resumo.total - prontas.length} ignorado(s)`);
  res.json({ ...resumo, importados: prontas.length, ignorados: resumo.total - prontas.length, ...colunas, linhas: analise.linhas });
}));

// ---------- Cadastro de usuários (gestão, pais e professores) — só administração ----------
app.get("/api/usuarios", autenticar, apenasAdmin, rota(async (req, res) => {
  await verificarInatividade();
  const [linhas] = await db.query(`SELECT u.id_usuario AS id, u.usu_usuario AS usuario, u.usu_nome AS nome, u.usu_papel AS papel, u.usu_sala AS sala, u.usu_ativo AS ativo, u.usu_senha_temporaria AS senha_temporaria,
    DATE_FORMAT(u.usu_ultimo_acesso, '%d/%m/%Y %H:%i') AS ultimo_acesso, u.usu_inativado_motivo AS inativado_motivo, DATE_FORMAT(u.usu_inativado_em, '%d/%m/%Y') AS inativado_em,
    DATE_FORMAT(u.usu_reativacao_pedida_em, '%d/%m/%Y %H:%i') AS reativacao_pedida_em, DATE_FORMAT(u.usu_senha_pedida_em, '%d/%m/%Y %H:%i') AS senha_pedida_em, ${SQL_DIAS_SEM_ACESSO} AS dias_sem_acesso,
    u.usu_email AS email_conta, COALESCE(u.usu_email, (SELECT r2.res_email FROM tb_resp r2 WHERE r2.id_responsavel = u.id_responsavel)) AS email,
    a.alu_nome AS aluno_nome, u.id_aluno AS aluno_id, u.usu_2fa_ativo AS dois_fatores,
    (SELECT GROUP_CONCAT(CONCAT(a2.id_aluno, ':', a2.alu_nome) ORDER BY a2.alu_nome SEPARATOR '|') FROM tb_aluno_resp ar2 JOIN tb_alunos a2 ON a2.id_aluno = ar2.id_aluno WHERE ar2.id_responsavel = u.id_responsavel) AS filhos_txt,
    (SELECT GROUP_CONCAT(t.tur_nome ORDER BY t.tur_nome SEPARATOR '|') FROM tb_professor_turma pt JOIN tb_turmas t ON t.id_turma = pt.id_turma WHERE pt.id_usuario = u.id_usuario) AS turmas_txt
    FROM tb_usuarios u LEFT JOIN tb_alunos a ON a.id_aluno = u.id_aluno ORDER BY u.id_usuario DESC`);
  // filhos (responsável) e turmas (professor) vêm do banco como texto "id:nome|id:nome" e "turma|turma"
  res.json(linhas.map(({ filhos_txt, turmas_txt, ...l }) => ({ ...l,
    filhos: (filhos_txt || "").split("|").filter(Boolean).map((x) => ({ id: Number(x.split(":")[0]), nome: x.slice(x.indexOf(":") + 1) })),
    turmas: (turmas_txt || "").split("|").filter(Boolean) })));
}));

const emailValido = (e) => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
app.post("/api/usuarios", autenticar, apenasAdmin, rota(async (req, res) => {
  const { usuario, nome, papel, aluno_id, sala } = req.body;
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!usuario || !nome || !papel) return res.status(400).json({ erro: "Preencha o nome, o usuário e o perfil." });
  if (email && !emailValido(email)) return res.status(400).json({ erro: "O e-mail não parece válido." });
  if (papel === "pai" && !aluno_id) return res.status(400).json({ erro: "Selecione a qual aluno este responsável pertence." });
  if (papel === "professor" && !sala) return res.status(400).json({ erro: "Informe a turma do docente." });
  if (papel === "professor" && !(await turmaExiste(sala))) return res.status(400).json({ erro: "Escolha uma turma cadastrada." });
  const senhaGerada = gerarSenhaGenerica();
  let novo;
  try {
    [novo] = await db.query("INSERT INTO tb_usuarios (usu_usuario, usu_senha, usu_papel, usu_nome, id_aluno, usu_sala, usu_email, usu_senha_temporaria) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)",
      [usuario, await hashSenha(senhaGerada), papel, nome, papel === "pai" ? aluno_id : null, papel === "professor" ? sala : null, email || null]);
  } catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe alguém com esse usuário. Escolha outro." });
    throw erro;
  }
  if (papel === "pai") await responsavelDoUsuario({ id: novo.insertId, nome, aluno_id: Number(aluno_id) }); // liga o login ao cadastro do responsável (perfil)
  if (papel === "professor") await db.query("INSERT IGNORE INTO tb_professor_turma (id_usuario, id_turma) SELECT ?, id_turma FROM tb_turmas WHERE tur_nome = ?", [novo.insertId, sala]);
  await registrarLog(req.usuario, "cadastro_usuario", `${usuario} (${papel})`);
  res.status(201).json({ ok: true, senha_genercada: senhaGerada }); // devolve a senha gerada só nesta resposta, para o admin entregar ao usuário
}));

// E-mail usado na recuperação de senha. Mudar o e-mail cancela qualquer link de recuperação que ainda esteja valendo.
app.put("/api/usuarios/:id/email", autenticar, apenasAdmin, rota(async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (email && !emailValido(email)) return res.status(400).json({ erro: "O e-mail não parece válido." });
  const [r] = await db.query("UPDATE tb_usuarios SET usu_email = ?, usu_recuperacao_hash = NULL, usu_recuperacao_expira = NULL WHERE id_usuario = ?", [email || null, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Usuário não encontrado." });
  await registrarLog(req.usuario, "email_usuario_alterado", `usuário id ${req.params.id}`);
  res.json({ ok: true });
}));

app.put("/api/usuarios/:id/ativo", autenticar, apenasAdmin, rota(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id && !req.body.ativo) return res.status(400).json({ erro: "Você não pode desativar o seu próprio acesso." });
  if (req.body.ativo) await db.query("UPDATE tb_usuarios SET usu_ativo = TRUE, usu_inativado_motivo = NULL, usu_inativado_em = NULL, usu_reativado_em = NOW(), usu_reativacao_pedida_em = NULL WHERE id_usuario = ?", [req.params.id]);
  else await db.query("UPDATE tb_usuarios SET usu_ativo = FALSE, usu_inativado_motivo = 'manual', usu_inativado_em = NOW(), usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?", [req.params.id]);
  await registrarLog(req.usuario, req.body.ativo ? "reativar_usuario" : "desativar_usuario", `usuário id ${req.params.id}`);
  res.json({ ok: true });
}));

// Responsável com mais de um filho: a gestão liga o login a outro aluno (pelo cadastro do responsável, em aluno_responsavel)
app.post("/api/usuarios/:id/filhos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, usu_nome AS nome, usu_papel AS papel, id_aluno AS aluno_id FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u || u.papel !== "pai") return res.status(404).json({ erro: "Responsável não encontrado." });
  const [[aluno]] = await db.query("SELECT id_aluno AS id, alu_nome AS nome FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(400).json({ erro: "Escolha o aluno." });
  const parentesco = String(req.body.parentesco || "Responsável").trim().slice(0, 20) || "Responsável";
  const resId = await responsavelDoUsuario(u);
  if (!resId) return res.status(400).json({ erro: "Este usuário ainda não tem cadastro de responsável." });
  const [r] = await db.query("INSERT IGNORE INTO tb_aluno_resp (id_aluno, id_responsavel, alr_parentesco) VALUES (?, ?, ?)", [aluno.id, resId, parentesco]);
  if (!r.affectedRows) return res.status(409).json({ erro: "Este aluno já está ligado a este responsável." });
  await registrarLog(req.usuario, "responsavel_vinculado", `${u.nome} → ${aluno.nome} (${parentesco})`);
  res.status(201).json({ ok: true });
}));
app.delete("/api/usuarios/:id/filhos/:alunoId", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT usu_nome AS nome, id_aluno AS aluno_id, id_responsavel AS id_responsavel FROM tb_usuarios WHERE id_usuario = ? AND usu_papel = 'pai'", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Responsável não encontrado." });
  if (u.aluno_id === Number(req.params.alunoId)) return res.status(400).json({ erro: "Este é o aluno principal deste usuário e não pode ser removido." });
  const [r] = await db.query("DELETE FROM tb_aluno_resp WHERE id_aluno = ? AND id_responsavel = ?", [req.params.alunoId, u.id_responsavel || 0]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Vínculo não encontrado." });
  await registrarLog(req.usuario, "responsavel_desvinculado", `${u.nome} — aluno id ${req.params.alunoId}`);
  res.json({ ok: true });
}));
// Professor com mais de uma turma: a gestão marca as turmas. A primeira da lista vira a turma principal (a que abre primeiro).
app.put("/api/usuarios/:id/turmas", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, usu_nome AS nome, usu_sala AS sala FROM tb_usuarios WHERE id_usuario = ? AND usu_papel = 'professor'", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Docente não encontrado." });
  const nomes = [...new Set((Array.isArray(req.body.turmas) ? req.body.turmas : []).map((n) => String(n).trim()).filter(Boolean))];
  if (!nomes.length) return res.status(400).json({ erro: "Marque pelo menos uma turma." });
  const [turmas] = await db.query("SELECT id_turma AS id, tur_nome AS nome FROM tb_turmas WHERE tur_nome IN (?)", [nomes]);
  if (turmas.length !== nomes.length) return res.status(400).json({ erro: "Alguma turma não foi encontrada." });
  const principal = nomes.includes(u.sala) ? u.sala : nomes[0];
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    await conexao.query("DELETE FROM tb_professor_turma WHERE id_usuario = ?", [u.id]);
    await conexao.query("INSERT INTO tb_professor_turma (id_usuario, id_turma) VALUES ?", [turmas.map((t) => [u.id, t.id])]);
    await conexao.query("UPDATE tb_usuarios SET usu_sala = ? WHERE id_usuario = ?", [principal, u.id]);
    await conexao.commit();
  } catch (erro) { await conexao.rollback(); throw erro; } finally { conexao.release(); }
  await registrarLog(req.usuario, "professor_turmas", `${u.nome}: ${nomes.join(", ")}`);
  res.json({ ok: true });
}));

// O que abre para quem está logado: os filhos (responsável) ou as turmas (professor). Usado no seletor do topo da tela.
app.get("/api/meu-contexto", autenticar, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, usu_papel AS papel, id_aluno AS aluno_id, usu_sala AS sala, id_responsavel AS id_responsavel FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const ctx = await contextoDoUsuario(u);
  res.json({ filhos: ctx.filhos, turmas: ctx.turmas, aluno_id: req.usuario.aluno_id, sala: req.usuario.sala });
}));

// ---------- Turmas (só administração) ----------
// Renomear uma turma atualiza alunos, professores, comunicados e eventos (ON UPDATE CASCADE no banco).
const TURNOS = ["Manhã", "Tarde", "Integral", "Noite"];
function lerTurma(b) {
  const nome = String(b.nome || "").trim().replace(/\s+/g, " "), ano = Number(b.ano_letivo), turno = b.turno ? String(b.turno) : null;
  if (!nome || nome.length > 40) return { erro: "Informe o nome da turma (até 40 caracteres)." };
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return { erro: "Informe o ano letivo (ex.: 2026)." };
  if (turno && !TURNOS.includes(turno)) return { erro: "Turno inválido." };
  return { nome, ano, turno };
}
app.get("/api/turmas", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT t.id_turma AS id, t.tur_nome AS nome, t.tur_ano_letivo AS ano_letivo, t.tur_turno AS turno, t.tur_ativa AS ativa,
    (SELECT COUNT(*) FROM tb_alunos a WHERE a.alu_sala = t.tur_nome AND a.alu_situacao = 'Ativo') AS alunos,
    (SELECT GROUP_CONCAT(u.usu_nome ORDER BY u.usu_nome SEPARATOR ', ') FROM tb_professor_turma pt JOIN tb_usuarios u ON u.id_usuario = pt.id_usuario WHERE pt.id_turma = t.id_turma) AS professores
    FROM tb_turmas t ORDER BY t.tur_ativa DESC, t.tur_ano_letivo DESC, t.tur_nome`);
  res.json(linhas.map((l) => ({ ...l, ativa: !!l.ativa })));
}));
app.post("/api/turmas", autenticar, apenasAdmin, rota(async (req, res) => {
  const t = lerTurma(req.body);
  if (t.erro) return res.status(400).json({ erro: t.erro });
  try { await db.query("INSERT INTO tb_turmas (tur_nome, tur_ano_letivo, tur_turno) VALUES (?, ?, ?)", [t.nome, t.ano, t.turno]); }
  catch (erro) { if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe uma turma com esse nome." }); throw erro; }
  await registrarLog(req.usuario, "turma_criada", `${t.nome} (${t.ano})`);
  res.status(201).json({ ok: true });
}));
app.put("/api/turmas/:id", autenticar, apenasAdmin, rota(async (req, res) => {
  const t = lerTurma(req.body);
  if (t.erro) return res.status(400).json({ erro: t.erro });
  const [[antes]] = await db.query("SELECT tur_nome AS nome FROM tb_turmas WHERE id_turma = ?", [req.params.id]);
  if (!antes) return res.status(404).json({ erro: "Turma não encontrada." });
  try { await db.query("UPDATE tb_turmas SET tur_nome = ?, tur_ano_letivo = ?, tur_turno = ?, tur_ativa = ? WHERE id_turma = ?", [t.nome, t.ano, t.turno, req.body.ativa !== false, req.params.id]); }
  catch (erro) { if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe uma turma com esse nome." }); throw erro; }
  await registrarLog(req.usuario, "turma_alterada", antes.nome === t.nome ? t.nome : `${antes.nome} → ${t.nome}`);
  res.json({ ok: true });
}));

// ---------- Situação do aluno (só administração): quem sai da escola não é apagado, só sai das listas do dia a dia ----------
const SITUACOES = ["Ativo", "Transferido", "Concluiu", "Desistente"];
app.put("/api/alunos/:alunoId/situacao", autenticar, apenasAdmin, rota(async (req, res) => {
  const situacao = String(req.body.situacao || ""), motivo = String(req.body.motivo || "").trim().slice(0, 200);
  if (!SITUACOES.includes(situacao)) return res.status(400).json({ erro: "Situação inválida." });
  const [[a]] = await db.query("SELECT alu_nome AS nome FROM tb_alunos WHERE id_aluno = ?", [req.params.alunoId]);
  if (!a) return res.status(404).json({ erro: "Aluno não encontrado." });
  await db.query("UPDATE tb_alunos SET alu_situacao = ?, alu_situacao_em = IF(? = 'Ativo', NULL, CURDATE()), alu_situacao_motivo = ? WHERE id_aluno = ?",
    [situacao, situacao, situacao === "Ativo" ? null : motivo || null, req.params.alunoId]);
  await registrarLog(req.usuario, "aluno_situacao", `${a.nome}: ${situacao}`);
  res.json({ ok: true });
}));

// ---------- Logs de atividade (só administração) ----------
app.get("/api/logs", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT log_nome_usuario AS nome_usuario, log_papel AS papel, log_acao AS acao, log_detalhe AS detalhe, DATE_FORMAT(log_data_hora, '%d/%m/%Y %H:%i:%s') AS quando
    FROM tb_logs ORDER BY id_log DESC LIMIT 200`);
  // Troca "aluno id 5" / "usuário id 3" pelo nome, só para mostrar na tela. O texto gravado não muda (a conferência de integridade continua valendo).
  const ids = (re) => [...new Set(linhas.flatMap((l) => [...String(l.detalhe || "").matchAll(re)].map((m) => Number(m[1]))))];
  const idsAlunos = ids(/aluno id (\d+)/g), idsUsuarios = ids(/usuário id (\d+)/g);
  const alunos = new Map(idsAlunos.length ? (await db.query("SELECT id_aluno, alu_nome FROM tb_alunos WHERE id_aluno IN (?)", [idsAlunos]))[0].map((a) => [a.id_aluno, a.alu_nome]) : []);
  const usuarios = new Map(idsUsuarios.length ? (await db.query("SELECT id_usuario, usu_nome FROM tb_usuarios WHERE id_usuario IN (?)", [idsUsuarios]))[0].map((u) => [u.id_usuario, u.usu_nome]) : []);
  const legivel = (t) => String(t || "").replace(/aluno id (\d+)/g, (m, id) => alunos.get(Number(id)) || "aluno removido")
    .replace(/usuário id (\d+)/g, (m, id) => usuarios.get(Number(id)) || "usuário removido").replace(/ocorrência id (\d+)/g, "ocorrência nº $1");
  res.json(linhas.map((l) => ({ ...l, detalhe: l.detalhe ? legivel(l.detalhe) : l.detalhe })));
}));

// Confere a corrente de hashes dos logs: aponta o primeiro registro apagado ou alterado
app.get("/api/logs/integridade", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT id_log AS id, id_usuario, log_nome_usuario AS nome, log_papel AS papel, log_acao AS acao, log_detalhe AS detalhe,
    DATE_FORMAT(log_data_hora, '%Y-%m-%d %H:%i:%s') AS em, log_hash AS hash FROM tb_logs WHERE log_hash IS NOT NULL ORDER BY id_log`);
  // O primeiro da corrente não tem como conferir o anterior (os mais antigos saem pelo prazo de guarda): confere-se do segundo em diante
  for (let i = 1; i < linhas.length; i++) {
    if (hashLog(linhas[i - 1].hash, linhas[i]) !== linhas[i].hash)
      return res.json({ ok: false, conferidos: i, problema_em: { id: linhas[i].id, quando: linhas[i].em, acao: linhas[i].acao } });
  }
  res.json({ ok: true, conferidos: linhas.length });
}));

// ---------- Controle de frequência (só administração): todos os alunos em um dia ----------
app.get("/api/frequencia", autenticar, apenasAdmin, rota(async (req, res) => {
  const ref = await dataReferencia();
  const data = dataValida(req.query.data) ? req.query.data : ref.data;
  const [alunos] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala, p.pre_status AS status, p.pre_observacao AS observacao,
    (SELECT COUNT(*) FROM tb_presencas f WHERE f.id_aluno = a.id_aluno AND f.pre_status = 'Ausente'
       AND f.pre_data > DATE_SUB(?, INTERVAL ? DAY) AND f.pre_data <= ?) AS faltas
    FROM tb_alunos a LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.pre_data = ? WHERE a.alu_situacao = 'Ativo' ORDER BY a.alu_nome`,
    [data, BUSCA_ATIVA.dias, data, data]);
  const presentes = alunos.filter((a) => a.status === "Presente").length;
  const ausentes = alunos.filter((a) => a.status === "Ausente").length;
  res.json({ data, eh_hoje: data === ref.hoje, hoje: ref.hoje, fim_de_semana: ref.fim_de_semana && data === ref.data, dias_faltas: BUSCA_ATIVA.dias, limite_faltas: BUSCA_ATIVA.faltas,
    total: alunos.length, presentes, ausentes, sem_registro: alunos.length - presentes - ausentes, alunos });
}));

// ---------- Busca Ativa (só administração) ----------
app.get("/api/busca-ativa", autenticar, apenasAdmin, rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  const [casos] = await db.query(`SELECT b.id_busca_ativa AS id, b.id_aluno AS aluno_id, a.alu_nome AS nome, a.alu_sala AS sala, b.bua_faltas_ao_abrir AS faltas_ao_abrir, b.bua_status AS status,
    DATE_FORMAT(b.bua_aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.bua_encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (SELECT COUNT(*) FROM tb_presencas f WHERE f.id_aluno = b.id_aluno AND f.pre_status = 'Ausente'
       AND f.pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.pre_data <= CURDATE()) AS faltas_atuais,
    (SELECT c.id_comunicacao_conselho FROM tb_comunicacoes_conselho c WHERE c.id_busca_ativa = b.id_busca_ativa ORDER BY c.id_comunicacao_conselho DESC LIMIT 1) AS comunicacao_id,
    (SELECT c.cct_comunicado_em IS NOT NULL FROM tb_comunicacoes_conselho c WHERE c.id_busca_ativa = b.id_busca_ativa ORDER BY c.id_comunicacao_conselho DESC LIMIT 1) AS comunicacao_feita
    FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno
    ORDER BY (b.bua_status = 'Em acompanhamento') DESC, b.id_busca_ativa DESC LIMIT 50`, [BUSCA_ATIVA.dias]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT id_busca_ativa AS busca_id, bar_nome_usuario AS nome_usuario, bar_texto AS texto, DATE_FORMAT(bar_data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM tb_busca_ativa_registros WHERE id_busca_ativa IN (?) ORDER BY id_busca_ativa_registro`, [ids]))[0] : [];
  const alunosIds = [...new Set(casos.map((c) => c.aluno_id))];
  const contatos = alunosIds.length ? (await db.query(`SELECT ar.id_aluno AS aluno_id, r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone, r.res_telefone2 AS telefone2,
    r.res_email AS email, r.res_contato_preferido AS contato_preferido FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno IN (?) ORDER BY r.res_nome`, [alunosIds]))[0] : [];
  res.json({ criterio: BUSCA_ATIVA, casos: casos.map((c) => ({ ...c, registros: registros.filter((r) => r.busca_id === c.id), contatos: contatos.filter((x) => x.aluno_id === c.aluno_id) })) });
}));

app.post("/api/busca-ativa/:id/acompanhamento", autenticar, apenasAdmin, rota(async (req, res) => {
  const texto = (req.body.texto || "").trim();
  if (!texto || texto.length > 500) return res.status(400).json({ erro: "Escreva o acompanhamento (até 500 caracteres)." });
  const [[caso]] = await db.query("SELECT b.bua_status AS status, a.alu_nome AS nome FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno WHERE b.id_busca_ativa = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado." });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado." });
  await db.query("INSERT INTO tb_busca_ativa_registros (id_busca_ativa, bar_usuario_id, bar_nome_usuario, bar_texto) VALUES (?, ?, ?, ?)", [req.params.id, req.usuario.id, req.usuario.nome, texto]);
  await registrarLog(req.usuario, "busca_ativa_acompanhamento", caso.nome);
  res.status(201).json({ ok: true });
}));

app.put("/api/busca-ativa/:id/encerrar", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[caso]] = await db.query("SELECT b.bua_status AS status, a.alu_nome AS nome FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno WHERE b.id_busca_ativa = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado." });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado." });
  const texto = (req.body.texto || "").trim().slice(0, 450);
  await db.query("UPDATE tb_busca_ativa SET bua_status = 'Resolvido', bua_encerrada_em = NOW() WHERE id_busca_ativa = ?", [req.params.id]);
  await db.query("INSERT INTO tb_busca_ativa_registros (id_busca_ativa, bar_usuario_id, bar_nome_usuario, bar_texto) VALUES (?, ?, ?, ?)",
    [req.params.id, req.usuario.id, req.usuario.nome, "Caso encerrado." + (texto ? " " + texto : "")]);
  await registrarLog(req.usuario, "busca_ativa_encerrada", caso.nome);
  res.json({ ok: true });
}));

// ---------- Relatório mensal (só administração) ----------
app.get("/api/relatorio-mensal", autenticar, apenasAdmin, rota(async (req, res) => {
  const hoje = (await dataReferencia()).hoje;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || "") ? req.query.mes : hoje.slice(0, 7);
  const inicio = `${mes}-01`;
  const [[resumo]] = await db.query(`SELECT COUNT(DISTINCT pre_data) AS dias_com_registro,
    COUNT(CASE WHEN pre_status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN pre_status = 'Ausente' THEN 1 END) AS faltas
    FROM tb_presencas WHERE pre_data >= ? AND pre_data < DATE_ADD(?, INTERVAL 1 MONTH)`, [inicio, inicio]);
  const [alunos] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala,
    COUNT(CASE WHEN p.pre_status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) AS faltas
    FROM tb_alunos a LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.pre_data >= ? AND p.pre_data < DATE_ADD(?, INTERVAL 1 MONTH)
    WHERE a.alu_situacao = 'Ativo' OR p.id_presenca IS NOT NULL
    GROUP BY a.id_aluno, a.alu_nome, a.alu_sala ORDER BY faltas DESC, a.alu_nome`, [inicio, inicio]);
  const [casos] = await db.query(`SELECT b.id_busca_ativa AS id, a.alu_nome AS nome, a.alu_sala AS sala, b.bua_status AS status, b.bua_faltas_ao_abrir AS faltas_ao_abrir,
    DATE_FORMAT(b.bua_aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.bua_encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (b.bua_aberta_em >= ? AND b.bua_aberta_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS aberto_no_mes,
    (b.bua_encerrada_em >= ? AND b.bua_encerrada_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS encerrado_no_mes
    FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno
    WHERE b.bua_aberta_em < DATE_ADD(?, INTERVAL 1 MONTH) AND (b.bua_encerrada_em IS NULL OR b.bua_encerrada_em >= ?)
    ORDER BY b.id_busca_ativa`, [inicio, inicio, inicio, inicio, inicio, inicio]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT id_busca_ativa AS busca_id, bar_nome_usuario AS nome_usuario, bar_texto AS texto, DATE_FORMAT(bar_data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM tb_busca_ativa_registros WHERE id_busca_ativa IN (?) ORDER BY id_busca_ativa_registro`, [ids]))[0] : [];
  await registrarLog(req.usuario, "relatorio_mensal", mes);
  res.json({
    mes, criterio: BUSCA_ATIVA, escola: escola.nome, // nome da escola vai no cabeçalho da versão impressa
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
  const [linhas] = await db.query(`SELECT a.alu_nome AS nome, ac.ace_sala AS sala, ac.ace_metodo AS metodo, DATE_FORMAT(ac.ace_data_hora, '%H:%i:%s') AS hora
    FROM tb_acessos ac JOIN tb_alunos a ON a.id_aluno = ac.id_aluno
    ORDER BY ac.id_acesso DESC LIMIT 4`);
  res.json(linhas);
}));

// Entrada registrada à mão pela portaria (aluno sem cadastro facial, câmera desligada etc.)
app.post("/api/acessos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT id_aluno AS id, alu_nome AS nome FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [[cam]] = await db.query("SELECT id_camera AS id, cam_nome AS nome FROM tb_cameras WHERE id_camera = ? AND cam_tipo = 'Entrada'", [Number(req.body.cam_id) || 0]);
  await db.query("INSERT INTO tb_acessos (id_aluno, ace_sala, id_camera, ace_metodo) VALUES (?, ?, ?, 'Manual')", [aluno.id, cam ? cam.nome : "Portaria", cam ? cam.id : null]);
  await marcarPresencaPelaEntrada(aluno.id, "registro da portaria");
  await registrarLog(req.usuario, "entrada_manual", `aluno id ${aluno.id}${cam ? " — " + cam.nome : ""}`);
  res.status(201).json({ ok: true });
}));

app.get("/api/saida", autenticar, apenasAdmin, rota(async (req, res) => {
  // escolhido na lista (turma -> aluno) vem pelo id; digitado vem pelo nome
  const porId = /^\d+$/.test(String(req.query.id || ""));
  const [alunos] = await db.query(`SELECT id_aluno AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM tb_alunos WHERE alu_situacao = 'Ativo' AND ${porId ? "id_aluno = ?" : "alu_nome LIKE ?"} LIMIT 1`, [porId ? Number(req.query.id) : `%${req.query.nome || ""}%`]);
  if (!alunos.length) return res.json(null);
  const [responsaveis] = await db.query(`SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone, r.res_foto AS foto
    FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?`, [alunos[0].id]);
  const [status] = await statusAoVivo({ alunoId: alunos[0].id });
  res.json({ aluno: alunos[0], responsaveis, status });
}));

app.post("/api/saidas", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT id_aluno AS id FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  await db.query("INSERT INTO tb_saidas (id_aluno, sai_metodo, sai_liberado_por_nome) VALUES (?, 'Liberação', ?)", [aluno.id, req.usuario.nome]);
  await registrarLog(req.usuario, "liberacao_saida", `aluno id ${req.body.aluno_id}`);
  res.status(201).json({ ok: true });
}));

// ---------- Minha Turma e chamada (só professores) ----------
app.get("/api/minha-turma", autenticar, apenasProfessor, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, p.pre_status AS status_hoje, p.pre_observacao AS obs_hoje,
    (SELECT COUNT(*) FROM tb_pendencias q WHERE q.id_aluno = a.id_aluno AND q.pen_status = 'Aberta')
      + (SELECT COUNT(*) FROM tb_autorizacoes z WHERE z.id_aluno = a.id_aluno AND z.aut_assinada = FALSE AND (z.aut_valida_ate IS NULL OR z.aut_valida_ate >= CURDATE())) AS pendencias,
    (SELECT COUNT(*) FROM tb_presencas f WHERE f.id_aluno = a.id_aluno AND f.pre_status = 'Ausente'
       AND f.pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.pre_data <= CURDATE()) AS faltas,
    GROUP_CONCAT(DISTINCT CONCAT(r.res_nome, ' (', ar.alr_parentesco, ') ', IFNULL(r.res_telefone,'')) SEPARATOR ' • ') AS responsaveis
    FROM tb_alunos a LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.pre_data = CURDATE()
    LEFT JOIN tb_aluno_resp ar ON ar.id_aluno = a.id_aluno LEFT JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel
    WHERE a.alu_sala = ? AND a.alu_situacao = 'Ativo' GROUP BY a.id_aluno, a.alu_nome, p.pre_status, p.pre_observacao ORDER BY a.alu_nome`, [BUSCA_ATIVA.dias, req.usuario.sala]);
  const aoVivo = new Map((await statusAoVivo({ sala: req.usuario.sala })).map((s) => [s.id, s]));
  // origem_hoje: "portao" quando a presença foi marcada pela entrada (câmera ou portaria) e o professor ainda não confirmou na chamada
  res.json({ dias_faltas: BUSCA_ATIVA.dias, alunos: linhas.map((l) => ({ ...l, agora: aoVivo.get(l.id) || null,
    origem_hoje: l.status_hoje ? (/^Entrada/.test(l.obs_hoje || "") ? "portao" : "chamada") : null })) });
}));

// Chamada de hoje: o professor marca Presente/Ausente só para os alunos da própria turma
app.post("/api/chamada", autenticar, apenasProfessor, rota(async (req, res) => {
  const registros = req.body.registros;
  if (!Array.isArray(registros) || !registros.length) return res.status(400).json({ erro: "Marque a presença dos alunos antes de salvar." });
  const [daTurma] = await db.query("SELECT id_aluno AS id FROM tb_alunos WHERE alu_sala = ? AND alu_situacao = 'Ativo'", [req.usuario.sala]);
  const permitidos = new Set(daTurma.map((a) => a.id));
  for (const r of registros) {
    if (!permitidos.has(Number(r.aluno_id))) return res.status(403).json({ erro: "Esse aluno não é da sua turma." });
    if (!["Presente", "Ausente"].includes(r.status)) return res.status(400).json({ erro: "Status inválido." });
  }
  for (const r of registros) {
    await db.query(`INSERT INTO tb_presencas (id_aluno, pre_data, pre_status, pre_observacao) VALUES (?, CURDATE(), ?, ?)
      ON DUPLICATE KEY UPDATE pre_status = VALUES(pre_status), pre_observacao = VALUES(pre_observacao)`,
      [r.aluno_id, r.status, r.status === "Presente" ? "Presença registrada na chamada" : "Falta registrada na chamada"]);
  }
  await registrarLog(req.usuario, "chamada_registrada", `${req.usuario.sala}: ${registros.length} alunos`);
  await sincronizarBuscaAtiva();
  res.json({ ok: true });
}));

// ---------- Portal dos Pais (admin vê qualquer um; pai só o próprio filho) ----------
// Histórico de presença de um aluno (últimos N dias) com totais e a situação de hoje
app.get("/api/presencas/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 120);
  const [registros] = await db.query(`SELECT DATE_FORMAT(pre_data, '%Y-%m-%d') AS data, pre_status AS status, pre_observacao AS observacao
    FROM tb_presencas WHERE id_aluno = ? AND pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND pre_data <= CURDATE() ORDER BY pre_data DESC`, [req.params.alunoId, dias]);
  const presencas = registros.filter((r) => r.status === "Presente").length;
  const faltas = registros.filter((r) => r.status === "Ausente").length;
  const [linhasHoje] = await db.query("SELECT pre_status AS status, pre_observacao AS observacao FROM tb_presencas WHERE id_aluno = ? AND pre_data = CURDATE()", [req.params.alunoId]);
  res.json({ dias, registros, presencas, faltas, percentual: percentual(presencas, faltas), hoje: linhasHoje[0] || null });
}));

// Nome e sala do próprio filho (usado no Portal dos Pais)
app.get("/api/alunos/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT alu_nome AS nome, alu_sala AS sala FROM tb_alunos WHERE id_aluno = ?", [req.params.alunoId]);
  res.json(aluno || null);
}));

// =====================================================================
// FASE 3 — gestão de alunos, ficha, comunicados, autorizações digitais, documentos, pendências e ocorrências
// =====================================================================
const DOCUMENTO_CATEGORIAS = ["Desenvolvimento", "Saúde", "Identificação", "Outros"];
const TIPOS_DOCUMENTO = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// Primeiros bytes de cada formato: confere se o conteúdo bate com a extensão (não basta confiar no nome)
const ASSINATURAS_ARQUIVO = {
  pdf: [0x25, 0x50, 0x44, 0x46], png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff],
  docx: [0x50, 0x4b], doc: [0xd0, 0xcf, 0x11, 0xe0],
};
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

const adminOuProfessor = (req, res, next) => ["admin", "professor"].includes(req.usuario.papel) ? next() : res.status(403).json({ erro: "Acesso negado." });
const normalizar = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Quem pode mexer na ficha de um aluno: gestão (todos), professor (só a própria turma), responsável (só o próprio filho)
async function alunoPermitido(usuario, alunoId) {
  const [[aluno]] = await db.query("SELECT id_aluno AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula, alu_situacao AS situacao, DATE_FORMAT(alu_situacao_em, '%d/%m/%Y') AS situacao_em, alu_situacao_motivo AS situacao_motivo FROM tb_alunos WHERE id_aluno = ?", [alunoId]);
  if (!aluno) return null;
  if (usuario.papel === "admin") return aluno;
  if (usuario.papel === "professor" && usuario.turmas.includes(aluno.sala)) return aluno;
  if (usuario.papel === "pai" && usuario.filhos.includes(aluno.id)) return aluno;
  return null;
}
const semPermissao = (res) => res.status(403).json({ erro: "Você não tem permissão para este aluno." });

// ---------- Tabela interativa de gestão de alunos (só administração) ----------
app.get("/api/gestao-alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala,
    (SELECT COUNT(*) FROM tb_comunicados c WHERE c.com_sala IS NULL OR c.com_sala = a.alu_sala) AS com_total,
    (SELECT COUNT(*) FROM tb_comunicado_leituras l JOIN tb_comunicados c ON c.id_comunicado = l.id_comunicado
       WHERE l.id_aluno = a.id_aluno AND (c.com_sala IS NULL OR c.com_sala = a.alu_sala)) AS com_lidos,
    (SELECT COUNT(*) FROM tb_autorizacoes z WHERE z.id_aluno = a.id_aluno AND z.aut_assinada = TRUE) AS aut_assinadas,
    (SELECT COUNT(*) FROM tb_autorizacoes z WHERE z.id_aluno = a.id_aluno AND z.aut_assinada = FALSE AND (z.aut_valida_ate IS NULL OR z.aut_valida_ate >= CURDATE())) AS aut_pendentes,
    (SELECT COUNT(*) FROM tb_pendencias p WHERE p.id_aluno = a.id_aluno AND p.pen_status = 'Aberta') AS pend_abertas,
    (SELECT GROUP_CONCAT(DISTINCT p.pen_tipo SEPARATOR ',') FROM tb_pendencias p WHERE p.id_aluno = a.id_aluno AND p.pen_status = 'Aberta') AS pend_tipos,
    (SELECT COUNT(*) FROM tb_advertencias o WHERE o.id_aluno = a.id_aluno AND o.adv_tipo = 'Advertencia') AS advertencias,
    (SELECT COUNT(*) FROM tb_advertencias o WHERE o.id_aluno = a.id_aluno AND o.adv_tipo = 'Acao') AS acoes
    FROM tb_alunos a WHERE a.alu_situacao = 'Ativo' ORDER BY a.alu_nome`);
  res.json(linhas);
}));

// ---------- Ficha do aluno: tudo do aluno em uma resposta ----------
app.get("/api/alunos/:alunoId/ficha", autenticar, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  const [responsaveis] = await db.query(`SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone, r.res_telefone2 AS telefone2, r.res_email AS email, r.res_contato_preferido AS contato_preferido
    FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?`, [aluno.id]);
  const [comunicados] = await db.query(`SELECT c.id_comunicado AS id, c.com_titulo AS titulo, c.com_texto AS texto, c.com_sala AS sala, c.com_criado_por_nome AS criado_por_nome, DATE_FORMAT(c.com_criado_em, '%d/%m/%Y') AS data,
    (l.col_lido_em IS NOT NULL) AS lido, DATE_FORMAT(l.col_lido_em, '%d/%m/%Y %H:%i') AS lido_em
    FROM tb_comunicados c LEFT JOIN tb_comunicado_leituras l ON l.id_comunicado = c.id_comunicado AND l.id_aluno = ?
    WHERE c.com_sala IS NULL OR c.com_sala = ? ORDER BY c.id_comunicado DESC`, [aluno.id, aluno.sala]);
  const [autorizacoes] = await db.query(`SELECT id_autorizacao AS id, aut_titulo AS titulo, aut_validade AS validade, aut_detalhe AS detalhe, aut_assinada AS assinada, aut_assinada_nome AS assinada_nome,
    DATE_FORMAT(aut_assinada_em, '%d/%m/%Y %H:%i') AS assinada_em, aut_codigo AS codigo, DATE_FORMAT(aut_valida_ate, '%d/%m/%Y') AS valida_ate,
    (aut_assinada = FALSE AND aut_valida_ate IS NOT NULL AND aut_valida_ate < CURDATE()) AS vencida
    FROM tb_autorizacoes WHERE id_aluno = ? ORDER BY vencida, aut_assinada, id_autorizacao DESC`, [aluno.id]);
  const [documentos] = await db.query(`SELECT doc_id AS id, doc_categoria AS categoria, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_tamanho AS tamanho, doc_enviado_por_nome AS enviado_por_nome,
    DATE_FORMAT(doc_enviado_em, '%d/%m/%Y') AS enviado_em FROM tb_documentos WHERE id_aluno = ? ORDER BY doc_id DESC`, [aluno.id]);
  const [pendencias] = await db.query(`SELECT pen_id AS id, pen_tipo AS tipo, pen_descricao AS descricao, pen_status AS status, pen_criada_por_nome AS criada_por_nome, DATE_FORMAT(pen_criada_em, '%d/%m/%Y') AS criada_em,
    DATE_FORMAT(pen_resolvida_em, '%d/%m/%Y') AS resolvida_em, pen_resolvida_por_nome AS resolvida_por_nome FROM tb_pendencias WHERE id_aluno = ?
    ORDER BY (pen_status = 'Aberta') DESC, pen_id DESC`, [aluno.id]);
  const [ocorrencias] = await db.query(`SELECT adv_id AS id, adv_tipo AS tipo, adv_descricao AS descricao, DATE_FORMAT(adv_data, '%d/%m/%Y') AS data, adv_registrada_por_nome AS registrada_por_nome
    FROM tb_advertencias WHERE id_aluno = ? ORDER BY adv_data DESC, adv_id DESC`, [aluno.id]);
  res.json({
    aluno, responsaveis, categorias: DOCUMENTO_CATEGORIAS,
    comunicados: comunicados.map((c) => ({ ...c, lido: !!c.lido })),
    autorizacoes: autorizacoes.map((a) => ({ ...a, assinada: !!a.assinada, vencida: !!a.vencida })),
    documentos, pendencias, ocorrencias,
    consentimento: await consentimentoDoAluno(aluno.id, req.usuario.papel !== "professor"),
    agora: (await statusAoVivo({ alunoId: aluno.id }))[0] || null,
  });
}));

// ---------- Comunicados ----------
app.get("/api/comunicados", autenticar, adminOuProfessor, rota(async (req, res) => {
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : null;
  const [linhas] = await db.query(`SELECT c.id_comunicado AS id, c.com_titulo AS titulo, c.com_texto AS texto, c.com_sala AS sala, c.com_criado_por_nome AS criado_por_nome, DATE_FORMAT(c.com_criado_em, '%d/%m/%Y %H:%i') AS criado_em,
    (SELECT COUNT(*) FROM tb_alunos a WHERE a.alu_situacao = 'Ativo' AND (c.com_sala IS NULL OR a.alu_sala = c.com_sala) AND (? IS NULL OR a.alu_sala = ?)) AS destinatarios,
    (SELECT COUNT(*) FROM tb_comunicado_leituras l JOIN tb_alunos a ON a.id_aluno = l.id_aluno WHERE l.id_comunicado = c.id_comunicado AND (? IS NULL OR a.alu_sala = ?)) AS lidos
    FROM tb_comunicados c WHERE (? IS NULL OR c.com_sala IS NULL OR c.com_sala = ?) ORDER BY c.id_comunicado DESC LIMIT 50`, [sala, sala, sala, sala, sala, sala]);
  res.json(linhas);
}));

app.post("/api/comunicados", autenticar, adminOuProfessor, rota(async (req, res) => {
  const titulo = (req.body.titulo || "").trim(), texto = (req.body.texto || "").trim();
  if (!titulo || titulo.length > 120) return res.status(400).json({ erro: "Informe o título (até 120 caracteres)." });
  if (!texto || texto.length > 1500) return res.status(400).json({ erro: "Escreva o comunicado (até 1500 caracteres)." });
  // Comunicado vai para várias famílias: citar o nome completo de um aluno expõe a criança (ECA, arts. 17 e 18). Pede confirmação.
  const limpo = (x) => normalizar(x).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const textoLimpo = ` ${limpo(`${titulo} ${texto}`)} `;
  const [todosAlunos] = await db.query("SELECT alu_nome AS nome FROM tb_alunos");
  const citados = todosAlunos.map((a) => a.nome).filter((n) => { const k = limpo(n); return k.includes(" ") && textoLimpo.includes(` ${k} `); });
  if (citados.length && req.body.confirmar_nomes !== true)
    return res.status(409).json({ erro: "Este comunicado cita o nome de aluno(s). Todas as famílias que recebem o aviso vão ler. Confirme só se for necessário e se as famílias autorizaram.", codigo: "NOME_DE_ALUNO", alunos: citados });
  // Professor só publica para a própria turma; a gestão escolhe uma turma ou a escola toda
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : ((req.body.sala || "").trim() || null);
  if (sala && !(await turmaExiste(sala))) return res.status(400).json({ erro: "Turma não encontrada." });
  await db.query("INSERT INTO tb_comunicados (com_titulo, com_texto, com_sala, com_criado_por_nome) VALUES (?, ?, ?, ?)", [titulo, texto, sala, req.usuario.nome]);
  await registrarLog(req.usuario, "comunicado_criado", `${titulo} (${sala || "escola toda"})`);
  if (citados.length) await registrarLog(req.usuario, "comunicado_com_nome_de_aluno", `${citados.length} aluno(s) citado(s) no comunicado "${titulo}"`);
  res.status(201).json({ ok: true });
}));

app.get("/api/comunicados/:id/leituras", autenticar, adminOuProfessor, rota(async (req, res) => {
  const [[c]] = await db.query("SELECT com_sala AS sala FROM tb_comunicados WHERE id_comunicado = ?", [req.params.id]);
  if (!c) return res.status(404).json({ erro: "Comunicado não encontrado." });
  const salaProf = req.usuario.papel === "professor" ? req.usuario.sala : null;
  if (salaProf && c.sala && c.sala !== salaProf) return res.status(403).json({ erro: "Comunicado de outra turma." });
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala, (l.col_lido_em IS NOT NULL) AS lido, DATE_FORMAT(l.col_lido_em, '%d/%m/%Y %H:%i') AS lido_em
    FROM tb_alunos a LEFT JOIN tb_comunicado_leituras l ON l.id_aluno = a.id_aluno AND l.id_comunicado = ?
    WHERE a.alu_situacao = 'Ativo' AND (? IS NULL OR a.alu_sala = ?) AND (? IS NULL OR a.alu_sala = ?) ORDER BY lido, a.alu_nome`, [req.params.id, c.sala, c.sala, salaProf, salaProf]);
  res.json(linhas.map((l) => ({ ...l, lido: !!l.lido })));
}));

// O responsável marca o comunicado como lido (vale para o filho dele)
app.post("/api/comunicados/:id/ler", autenticar, rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável marca como lido." });
  const [[aluno]] = await db.query("SELECT alu_sala AS sala FROM tb_alunos WHERE id_aluno = ?", [req.usuario.aluno_id]);
  const [[c]] = await db.query("SELECT id_comunicado AS id, com_titulo AS titulo FROM tb_comunicados WHERE id_comunicado = ? AND (com_sala IS NULL OR com_sala = ?)", [req.params.id, aluno.sala]);
  if (!c) return res.status(404).json({ erro: "Comunicado não encontrado." });
  await db.query("INSERT IGNORE INTO tb_comunicado_leituras (id_comunicado, id_aluno, col_usuario_id) VALUES (?, ?, ?)", [c.id, req.usuario.aluno_id, req.usuario.id]);
  await registrarLog(req.usuario, "comunicado_lido", c.titulo);
  res.json({ ok: true });
}));

// ---------- Autorizações digitais ----------
// A gestão cria a autorização para uma turma ou para a escola toda (uma linha por aluno)
app.post("/api/autorizacoes", autenticar, apenasAdmin, rota(async (req, res) => {
  const titulo = (req.body.titulo || "").trim(), detalhe = (req.body.detalhe || "").trim().slice(0, 250);
  const sala = (req.body.sala || "").trim() || null;
  // Último dia para assinar (data de verdade, para o sistema saber quando venceu). O texto "Validade" continua existindo para descrever o evento.
  const validaAte = req.body.valida_ate ? String(req.body.valida_ate) : null;
  const [[h]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje");
  if (validaAte && (!dataValida(validaAte) || validaAte < h.hoje)) return res.status(400).json({ erro: "O prazo para assinar precisa ser hoje ou uma data futura." });
  const validade = ((req.body.validade || "").trim() || (validaAte ? `Assinar até ${validaAte.split("-").reverse().join("/")}` : "")).slice(0, 50);
  if (sala && !(await turmaExiste(sala))) return res.status(400).json({ erro: "Turma não encontrada." });
  if (!titulo || titulo.length > 100) return res.status(400).json({ erro: "Informe o título (até 100 caracteres)." });
  const grupo = crypto.randomBytes(6).toString("hex");
  const [r] = await db.query(`INSERT INTO tb_autorizacoes (aut_grupo, id_aluno, aut_titulo, aut_validade, aut_valida_ate, aut_detalhe, aut_criada_por_nome)
    SELECT ?, id_aluno, ?, ?, ?, ?, ? FROM tb_alunos WHERE alu_situacao = 'Ativo' AND (? IS NULL OR alu_sala = ?)`, [grupo, titulo, validade || null, validaAte, detalhe || null, req.usuario.nome, sala, sala]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Nenhum aluno encontrado para esse destino." });
  await registrarLog(req.usuario, "autorizacao_criada", `${titulo} (${r.affectedRows} alunos)`);
  res.status(201).json({ ok: true, alunos: r.affectedRows });
}));

app.get("/api/autorizacoes-grupos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT aut_grupo AS grupo, MIN(aut_titulo) AS titulo, MIN(aut_detalhe) AS detalhe, MIN(aut_validade) AS validade,
    DATE_FORMAT(MIN(aut_valida_ate), '%d/%m/%Y') AS valida_ate, (MIN(aut_valida_ate) < CURDATE()) AS vencida,
    DATE_FORMAT(MIN(aut_criada_em), '%d/%m/%Y') AS criada_em, MIN(aut_criada_por_nome) AS criada_por_nome,
    COUNT(*) AS total, COUNT(CASE WHEN aut_assinada THEN 1 END) AS assinadas
    FROM tb_autorizacoes GROUP BY aut_grupo ORDER BY MIN(id_autorizacao) DESC LIMIT 50`);
  res.json(linhas);
}));

app.get("/api/autorizacoes-grupos/:grupo", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT z.id_autorizacao AS id, a.alu_nome AS nome, a.alu_sala AS sala, z.aut_assinada AS assinada, z.aut_assinada_nome AS assinada_nome,
    DATE_FORMAT(z.aut_assinada_em, '%d/%m/%Y %H:%i') AS assinada_em, z.aut_codigo AS codigo
    FROM tb_autorizacoes z JOIN tb_alunos a ON a.id_aluno = z.id_aluno WHERE z.aut_grupo = ? ORDER BY z.aut_assinada, a.alu_nome`, [req.params.grupo]);
  res.json(linhas.map((l) => ({ ...l, assinada: !!l.assinada })));
}));

// Assinatura digital: o responsável confirma com nome completo + senha. O sistema grava quem, quando e um código de verificação.
app.post("/api/autorizacoes/:id/assinar", autenticar, rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável pode assinar." });
  const [[aut]] = await db.query("SELECT id_autorizacao AS id, id_aluno AS aluno_id, aut_titulo AS titulo, aut_assinada AS assinada, (aut_valida_ate IS NOT NULL AND aut_valida_ate < CURDATE()) AS vencida FROM tb_autorizacoes WHERE id_autorizacao = ?", [req.params.id]);
  if (!aut) return res.status(404).json({ erro: "Autorização não encontrada." });
  if (!req.usuario.filhos.includes(aut.aluno_id)) return res.status(403).json({ erro: "Você só pode assinar autorizações do seu próprio filho." });
  if (aut.assinada) return res.status(400).json({ erro: "Esta autorização já foi assinada." });
  if (aut.vencida) return res.status(400).json({ erro: "O prazo para assinar esta autorização já terminou. Fale com a escola." });
  // Assinar: a pessoa marca "Li e autorizo" e confirma com a senha (o nome vem do cadastro de quem está logado; digitar o nome completo não é mais exigido)
  if (req.body.confirmo !== true && !req.body.nome) return res.status(400).json({ erro: "Marque “Li e autorizo” para assinar." });
  const [[u]] = await db.query("SELECT usu_nome AS nome, usu_senha AS senha FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const chaveAss = `assinatura|${req.usuario.id}`, minutosAss = minutosBloqueado(chaveAss);
  if (minutosAss) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutosAss} minuto(s).` });
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chaveAss); return res.status(400).json({ erro: "Senha incorreta." }); }
  tentativas.delete(chaveAss);
  const codigo = novoCodigo();
  await db.query("UPDATE tb_autorizacoes SET aut_assinada_por = ?, aut_assinada_nome = ?, aut_assinada_em = NOW(), aut_codigo = ? WHERE id_autorizacao = ?",
    [req.usuario.id, u.nome, codigo, aut.id]);
  await registrarAssinatura({ codigo, documento: "autorizacao", documentoId: aut.id, papel: "resp", usuario: req.usuario, nome: u.nome, req });
  await registrarLog(req.usuario, "autorizacao_assinada", `${aut.titulo} (código ${codigo})`);
  res.json({ ok: true, codigo });
}));

// ---------- Documentos do aluno ----------
app.post("/api/documentos", autenticar, rota(async (req, res) => {
  const { aluno_id, categoria, nome_arquivo, conteudo, pendencia_id } = req.body;
  const titulo = (req.body.titulo || "").trim();
  const aluno = await alunoPermitido(req.usuario, Number(aluno_id));
  if (!aluno) return semPermissao(res);
  if (!DOCUMENTO_CATEGORIAS.includes(categoria)) return res.status(400).json({ erro: "Categoria inválida." });
  if (!titulo || titulo.length > 120) return res.status(400).json({ erro: "Informe o título do documento (até 120 caracteres)." });
  const nomeOriginal = path.basename(String(nome_arquivo || "")).slice(0, 200);
  const ext = path.extname(nomeOriginal).slice(1).toLowerCase();
  if (!TIPOS_DOCUMENTO[ext]) return res.status(400).json({ erro: "Formato não permitido. Use PDF, PNG, JPG, DOC ou DOCX." });
  if (typeof conteudo !== "string" || !conteudo) return res.status(400).json({ erro: "Nenhum arquivo enviado." });
  const arquivo = Buffer.from(conteudo, "base64");
  if (!arquivo.length) return res.status(400).json({ erro: "Arquivo vazio." });
  if (arquivo.length > TAMANHO_MAXIMO) return res.status(400).json({ erro: "O arquivo passa de 5 MB." });
  if (!ASSINATURAS_ARQUIVO[ext].every((b, i) => arquivo[i] === b)) return res.status(400).json({ erro: `Este arquivo não é um ${ext.toUpperCase()} válido. Confira o arquivo e envie de novo.` });
  const nomeGuardado = crypto.randomBytes(16).toString("hex") + ".enc"; // nome aleatório: ninguém adivinha o caminho
  fs.writeFileSync(path.join(PASTA_UPLOADS, nomeGuardado), cifrarArquivo(arquivo, nomeGuardado)); // vai para o disco criptografado
  const [novo] = await db.query(`INSERT INTO tb_documentos (id_aluno, doc_categoria, doc_titulo, doc_nome_original, doc_arquivo, doc_tipo_mime, doc_tamanho, doc_enviado_por_nome, id_usuario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [aluno.id, categoria, titulo, nomeOriginal, nomeGuardado, TIPOS_DOCUMENTO[ext], arquivo.length, req.usuario.nome, req.usuario.id]);
  let atendeu = false;
  if (pendencia_id) { // se o documento atende a uma pendência do tipo Documento, ela é resolvida junto
    const [r] = await db.query(`UPDATE tb_pendencias SET pen_status = 'Resolvida', pen_resolvida_em = NOW(), pen_resolvida_por_nome = ?
      WHERE pen_id = ? AND id_aluno = ? AND pen_tipo = 'Documento' AND pen_status = 'Aberta'`, [req.usuario.nome, pendencia_id, aluno.id]);
    atendeu = r.affectedRows > 0;
    if (atendeu) await db.query("UPDATE tb_documentos SET pen_id = ? WHERE doc_id = ?", [pendencia_id, novo.insertId]);
  }
  await registrarLog(req.usuario, "documento_enviado", `${titulo} — ${aluno.nome}`);
  res.status(201).json({ ok: true, pendencia_resolvida: atendeu });
}));

app.get("/api/documentos/:id/arquivo", autenticar, rota(async (req, res) => {
  const [[d]] = await db.query("SELECT doc_id AS id, id_aluno AS aluno_id, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_arquivo AS arquivo, doc_tipo_mime AS tipo_mime FROM tb_documentos WHERE doc_id = ?", [req.params.id]);
  if (!d) return res.status(404).json({ erro: "Documento não encontrado." });
  if (!(await alunoPermitido(req.usuario, d.aluno_id))) {
    await registrarLog(req.usuario, "documento_acesso_negado", `Documento id ${d.id} — aluno id ${d.aluno_id}`);
    return semPermissao(res);
  }
  const nomeNoDisco = path.basename(d.arquivo), caminho = path.join(PASTA_UPLOADS, nomeNoDisco);
  if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "Arquivo não encontrado no servidor." });
  let conteudo;
  try { conteudo = decifrarArquivo(fs.readFileSync(caminho), nomeNoDisco); }
  catch {
    await registrarLog(req.usuario, "documento_integridade_falhou", `Documento id ${d.id} — ${d.titulo}`);
    return res.status(500).json({ erro: "Não foi possível abrir o arquivo: ele foi alterado ou a chave de segurança é outra." });
  }
  await registrarLog(req.usuario, "documento_baixado", `${d.titulo} — aluno id ${d.aluno_id}`);
  const nomeSeguro = encodeURIComponent(d.nome_original).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  res.setHeader("Content-Type", d.tipo_mime);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${nomeSeguro}`);
  res.send(conteudo);
}));

app.delete("/api/documentos/:id", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[d]] = await db.query("SELECT doc_id AS id, id_aluno AS aluno_id, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_arquivo AS arquivo, doc_tipo_mime AS tipo_mime FROM tb_documentos WHERE doc_id = ?", [req.params.id]);
  if (!d) return res.status(404).json({ erro: "Documento não encontrado." });
  await db.query("DELETE FROM tb_documentos WHERE doc_id = ?", [d.id]);
  fs.rmSync(path.join(PASTA_UPLOADS, path.basename(d.arquivo)), { force: true });
  await registrarLog(req.usuario, "documento_excluido", d.titulo);
  res.json({ ok: true });
}));

// ---------- Pendências (gestão e professor da turma criam; só a gestão resolve) ----------
app.post("/api/pendencias", autenticar, adminOuProfessor, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.body.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (req.body.descricao || "").trim();
  if (!["Documento", "Cadastro", "Outro"].includes(req.body.tipo)) return res.status(400).json({ erro: "Tipo de pendência inválido." });
  if (!descricao || descricao.length > 200) return res.status(400).json({ erro: "Descreva a pendência (até 200 caracteres)." });
  await db.query("INSERT INTO tb_pendencias (id_aluno, pen_tipo, pen_descricao, pen_criada_por_nome) VALUES (?, ?, ?, ?)", [aluno.id, req.body.tipo, descricao, req.usuario.nome]);
  await registrarLog(req.usuario, "pendencia_criada", `${aluno.nome}: ${descricao}`);
  res.status(201).json({ ok: true });
}));

app.put("/api/pendencias/:id/resolver", autenticar, apenasAdmin, rota(async (req, res) => {
  const [r] = await db.query("UPDATE tb_pendencias SET pen_status = 'Resolvida', pen_resolvida_em = NOW(), pen_resolvida_por_nome = ? WHERE pen_id = ? AND pen_status = 'Aberta'", [req.usuario.nome, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Pendência não encontrada ou já resolvida." });
  await registrarLog(req.usuario, "pendencia_resolvida", `pendência id ${req.params.id}`);
  res.json({ ok: true });
}));

// ---------- Ações e advertências ----------
app.post("/api/advertencias", autenticar, adminOuProfessor, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.body.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (req.body.descricao || "").trim();
  if (!["Advertencia", "Acao"].includes(req.body.tipo)) return res.status(400).json({ erro: "Tipo inválido." });
  if (!descricao || descricao.length > 500) return res.status(400).json({ erro: "Descreva o ocorrido (até 500 caracteres)." });
  await db.query("INSERT INTO tb_advertencias (id_aluno, adv_tipo, adv_descricao, adv_data, adv_registrada_por_nome) VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?)",
    [aluno.id, req.body.tipo, descricao, dataValida(req.body.data) ? req.body.data : null, req.usuario.nome]);
  await registrarLog(req.usuario, "ocorrencia_registrada", `${req.body.tipo === "Acao" ? "Ação" : "Advertência"} — ${aluno.nome}`);
  res.status(201).json({ ok: true });
}));

// ---------- Assinatura digital do sistema ----------
// Quem assina confirma com a própria senha. O servidor grava em "assinaturas":
//  - o hash SHA-256 do conteúdo exato assinado (se o documento mudar depois, a verificação acusa);
//  - um selo Ed25519 do servidor sobre todos os dados da assinatura (se alguém mexer na linha do banco, a verificação acusa);
//  - data e hora, IP e navegador. O código é público: qualquer pessoa confere em "Verificar assinatura" (ou pelo QR code).
// Base legal: assinatura eletrônica entre a escola e a família (Lei 14.063/2020, art. 4º; MP 2.200-2/2001, art. 10, §2º).
const CHAVE_ASSINATURA = crypto.createPrivateKey({ key: Buffer.from(config.seguranca.assinatura_privada, "base64"), format: "der", type: "pkcs8" });
const CHAVE_VERIFICACAO = crypto.createPublicKey({ key: Buffer.from(config.seguranca.assinatura_publica, "base64"), format: "der", type: "spki" });
const novoCodigo = () => crypto.randomBytes(8).toString("hex").toUpperCase();
const hashConteudo = (obj) => crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
const agoraLocal = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
// O que é assinado em cada documento: só os campos do próprio documento (corrigir o nome do aluno no cadastro não invalida a assinatura)
async function conteudoAssinado(documento, id) {
  if (documento === "ocorrencia") {
    const [[o]] = await db.query(`SELECT id_aluno AS aluno_id, oce_turma AS turma, DATE_FORMAT(oce_data, '%Y-%m-%d') AS data, TIME_FORMAT(oce_horario, '%H:%i') AS horario,
      DATE_FORMAT(oce_notificado_em, '%Y-%m-%d %H:%i') AS notificado_em, oce_descricao AS descricao, oce_buscado_por AS buscado_por, oce_professor_nome AS professor
      FROM tb_ocorrencias_escolares WHERE id_ocorrencia = ?`, [id]);
    return o ? { documento, id: Number(id), ...o } : null;
  }
  if (documento === "autorizacao") {
    const [[a]] = await db.query("SELECT id_aluno AS aluno_id, aut_grupo AS grupo, aut_titulo AS titulo, aut_validade AS validade, aut_detalhe AS detalhe FROM tb_autorizacoes WHERE id_autorizacao = ?", [id]);
    return a ? { documento, id: Number(id), ...a } : null;
  }
  const [[c]] = await db.query("SELECT id_aluno AS aluno_id, con_versao AS versao, con_informacoes AS informacoes, con_imagem AS imagem, con_monitoramento AS monitoramento FROM tb_consentimentos WHERE con_id = ?", [id]);
  return c ? { documento, id: Number(id), aluno_id: c.aluno_id, versao: c.versao, informacoes: !!c.informacoes, imagem: !!c.imagem, monitoramento: !!c.monitoramento } : null;
}
const cargaAssinatura = (r) => ["SIVE-ASSINATURA-1", r.codigo, r.documento, r.documento_id, r.papel, r.id_usuario, r.nome, r.hash, r.ip || "", r.navegador || "", r.em].join("|");
async function registrarAssinatura({ codigo, documento, documentoId, papel, usuario, nome, req }) {
  const r = { codigo, documento, documento_id: Number(documentoId), papel, id_usuario: usuario.id, nome, hash: hashConteudo(await conteudoAssinado(documento, documentoId)),
    ip: String(req.ip || "").slice(0, 45), navegador: String(req.headers["user-agent"] || "").slice(0, 255), em: agoraLocal() };
  const selo = crypto.sign(null, Buffer.from(cargaAssinatura(r)), CHAVE_ASSINATURA).toString("base64");
  await db.query(`INSERT INTO tb_assinaturas (ass_codigo, ass_documento, ass_documento_id, ass_papel, id_usuario, ass_nome, ass_conteudo_hash, ass_ip, ass_navegador, ass_assinada_em, ass_selo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [r.codigo, r.documento, r.documento_id, r.papel, r.id_usuario, r.nome, r.hash, r.ip, r.navegador, r.em, selo]);
  return r;
}
// Confere a senha de quem vai assinar (com o mesmo bloqueio do login). Devolve o nome cadastrado, ou null depois de já responder o erro.
async function senhaParaAssinar(req, res) {
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) { res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` }); return null; }
  const [[u]] = await db.query("SELECT usu_nome AS nome, usu_senha AS senha FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chave); res.status(400).json({ erro: "Senha incorreta. Para assinar, confirme com a sua senha do sistema." }); return null; }
  tentativas.delete(chave);
  return u.nome;
}
// Verificação pública (sem login): mostra só o necessário para conferir. O nome de quem assinou aparece abreviado (LGPD).
const ROTULO_DOCUMENTO = { ocorrencia: "Ocorrência escolar", autorizacao: "Autorização", consentimento: "Termo de consentimento" };
const ROTULO_PAPEL = { professor: "Professor(a)", resp: "Responsável pelo aluno", gestao: "Gestão da escola" };
const nomeAbreviado = (nome) => { const p = String(nome).trim().split(/\s+/); return [p[0], ...p.slice(1).map((x) => x[0].toUpperCase() + ".")].join(" "); };
const limparCodigo = (c) => String(c || "").toUpperCase().replace(/[^0-9A-F]/g, "");
app.get("/api/verificar/:codigo", limitePorMinuto("verificar", 60), rota(async (req, res) => {
  const codigo = limparCodigo(req.params.codigo);
  if (codigo.length !== 16) return res.status(400).json({ erro: "O código tem 16 letras e números (ex.: 3F9A0C7E12B45D68)." });
  const [[a]] = await db.query(`SELECT ass_codigo AS codigo, ass_documento AS documento, ass_documento_id AS documento_id, ass_papel AS papel, id_usuario, ass_nome AS nome,
    ass_conteudo_hash AS hash, ass_ip AS ip, ass_navegador AS navegador, DATE_FORMAT(ass_assinada_em, '%Y-%m-%d %H:%i:%s') AS em, ass_selo AS selo FROM tb_assinaturas WHERE ass_codigo = ?`, [codigo]);
  if (!a) {
    // Assinaturas feitas antes da assinatura digital: o código existe, mas não há selo criptográfico para conferir
    const [[antiga]] = await db.query(`SELECT 1 AS ok FROM tb_ocorrencias_escolares WHERE ? IN (oce_codigo, oce_resp_codigo, oce_ges_codigo)
      UNION SELECT 1 FROM tb_autorizacoes WHERE aut_codigo = ? UNION SELECT 1 FROM tb_consentimentos WHERE con_codigo = ? LIMIT 1`, [codigo, codigo, codigo]);
    return res.json({ status: antiga ? "anterior" : "nao_encontrada", codigo });
  }
  let seloOk = false;
  try { seloOk = crypto.verify(null, Buffer.from(cargaAssinatura(a)), CHAVE_VERIFICACAO, Buffer.from(a.selo, "base64")); } catch { seloOk = false; }
  const atual = await conteudoAssinado(a.documento, a.documento_id);
  const conteudoOk = !!atual && hashConteudo(atual) === a.hash;
  const [d, h] = a.em.split(" ");
  res.json({ status: seloOk && conteudoOk ? "valida" : "alterada", selo_ok: seloOk, conteudo_ok: conteudoOk, codigo: a.codigo,
    documento: ROTULO_DOCUMENTO[a.documento], papel: ROTULO_PAPEL[a.papel], assinante: nomeAbreviado(a.nome),
    assinada_em: `${d.split("-").reverse().join("/")} às ${h}`, hash: a.hash, metodo: "Login e senha do sistema + selo Ed25519 do servidor" });
}));
// QR code que abre a verificação (vai nos comprovantes)
app.get("/api/verificar/:codigo/qr.svg", limitePorMinuto("qr", 60), rota(async (req, res) => {
  const codigo = limparCodigo(req.params.codigo);
  if (codigo.length !== 16) return res.status(400).end();
  const svg = await QRCode.toString(`${req.protocol}://${req.get("host")}/?verificar=${codigo}`, { type: "svg", margin: 1, color: { dark: "#140040", light: "#FFFFFF" } });
  res.type("image/svg+xml").send(svg);
}));
// ---------- Página inicial: ficha "Quero o S.I.V.E. na minha escola" (pública, sem login) ----------
// A escola interessada preenche os dados e recebe um protocolo. A equipe S.I.V.E. consulta os pedidos com: npm run escolas
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const soNumeros = (v) => String(v || "").replace(/\D/g, "");
app.post("/api/escolas-interessadas", limitePorMinuto("escola", 5), rota(async (req, res) => {
  const b = req.body || {};
  // Campo escondido (só robôs preenchem): finge que deu certo e não grava nada
  if (b.site) return res.json({ protocolo: `SIVE-${new Date().getFullYear()}-${String(crypto.randomInt(10000, 99999))}` });
  const texto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const d = {
    nome: texto(b.nome, 150), cidade: texto(b.cidade, 80), uf: String(b.uf || "").toUpperCase(), alunos: Number(b.alunos),
    contato_nome: texto(b.contato_nome, 100), email: texto(b.email, 120).toLowerCase(), telefone: soNumeros(b.telefone),
  };
  // Cada erro diz qual campo está errado, para a tela levar a pessoa direto até ele
  const erro = (campo, msg) => res.status(400).json({ erro: msg, campo });
  if (d.nome.length < 3) return erro("nome", "Informe o nome da escola.");
  if (d.cidade.length < 2) return erro("cidade", "Informe a cidade.");
  if (!UFS.includes(d.uf)) return erro("uf", "Escolha o estado (UF).");
  if (!Number.isInteger(d.alunos) || d.alunos < 1 || d.alunos > 100000) return erro("alunos", "Informe quantos alunos a escola tem (aproximadamente).");
  if (d.contato_nome.length < 2) return erro("contato_nome", "Informe o seu nome.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return erro("email", "E-mail inválido.");
  if (!/^[1-9]{2}9?\d{8}$/.test(d.telefone)) return erro("telefone", "Telefone inválido. Use DDD + número (ex.: 11 98765-4321).");
  if (b.aceite !== true) return erro("aceite", "Para entrarmos em contato, marque que concorda com o uso dos dados.");
  // A mesma pessoa pediu há pouco tempo para a mesma escola e o pedido ainda está aberto: devolve o protocolo que ela já tem
  const [[antes]] = await db.query(`SELECT esi_protocolo AS protocolo, DATE_FORMAT(esi_criado_em, '%d/%m/%Y') AS em FROM tb_escolas_interessadas
    WHERE esi_email = ? AND esi_nome = ? AND esi_status IN ('novo','em_contato') AND esi_criado_em >= NOW() - INTERVAL 30 DAY ORDER BY id_escola_interessada DESC LIMIT 1`, [d.email, d.nome]);
  if (antes) return res.json({ protocolo: antes.protocolo, repetido: true, em: antes.em });
  const [r] = await db.query(`INSERT INTO tb_escolas_interessadas (esi_nome, esi_alunos, esi_cidade, esi_uf, esi_contato_nome, esi_email, esi_telefone, esi_aceite_em, esi_ip)
    VALUES (?,?,?,?,?,?,?,NOW(),?)`, [d.nome, d.alunos, d.cidade, d.uf, d.contato_nome, d.email, d.telefone, req.ip]);
  const protocolo = `SIVE-${new Date().getFullYear()}-${String(r.insertId).padStart(5, "0")}`;
  await db.query("UPDATE tb_escolas_interessadas SET esi_protocolo = ? WHERE id_escola_interessada = ?", [protocolo, r.insertId]);
  console.log(`🏫 Nova escola interessada: ${d.nome} (${d.cidade}/${d.uf}) — protocolo ${protocolo}`);
  res.status(201).json({ protocolo });
}));
// ---------- Ocorrências do professor (registro do dia, com assinatura digital do professor) ----------
// O professor registra e consulta só a própria turma. A turma gravada é a do aluno no dia do registro.
// O responsável vê as ocorrências do filho e assina que tomou ciência; enquanto não assina, a ocorrência conta como "nova".
const CONSULTA_OCORRENCIAS = `SELECT oce.id_ocorrencia AS id, oce.id_aluno AS aluno_id, a.alu_nome AS aluno_nome, oce.oce_turma AS turma,
    DATE_FORMAT(oce.oce_data, '%Y-%m-%d') AS data, TIME_FORMAT(oce.oce_horario, '%H:%i') AS horario,
    DATE_FORMAT(oce.oce_notificado_em, '%d/%m/%Y %H:%i') AS notificado_em, oce.oce_descricao AS descricao,
    oce.oce_buscado_por AS buscado_por, oce.oce_professor_nome AS professor_nome, oce.oce_codigo AS codigo,
    DATE_FORMAT(oce.oce_assinada_em, '%d/%m/%Y %H:%i') AS assinada_em,
    oce.oce_resp_nome AS resp_nome, DATE_FORMAT(oce.oce_resp_assinada_em, '%d/%m/%Y %H:%i') AS resp_assinada_em, oce.oce_resp_codigo AS resp_codigo,
    oce.oce_ges_nome AS ges_nome, DATE_FORMAT(oce.oce_ges_assinada_em, '%d/%m/%Y %H:%i') AS ges_assinada_em, oce.oce_ges_codigo AS ges_codigo
    FROM tb_ocorrencias_escolares oce JOIN tb_alunos a ON a.id_aluno = oce.id_aluno`;
const ORDEM_OCORRENCIAS = "ORDER BY oce.oce_data DESC, oce.oce_horario DESC, oce.id_ocorrencia DESC";
app.get("/api/ocorrencias-escolares", autenticar, apenasProfessor, rota(async (req, res) => {
  const [linhas] = await db.query(`${CONSULTA_OCORRENCIAS} WHERE oce.oce_turma = ? ${ORDEM_OCORRENCIAS}`, [req.usuario.sala]);
  res.json(linhas);
}));

const apenasPai = (req, res, next) => req.usuario.papel === "pai" ? next() : res.status(403).json({ erro: "Somente o responsável pelo aluno pode acessar isso." });
app.get("/api/minhas-ocorrencias", autenticar, apenasPai, rota(async (req, res) => {
  const [linhas] = await db.query(`${CONSULTA_OCORRENCIAS} WHERE oce.id_aluno IN (?) ${ORDEM_OCORRENCIAS}`, [idsOuZero(req.usuario.filhos)]);
  res.json(linhas);
}));
// Quantas ocorrências o responsável ainda não assinou (número ao lado de "Ocorrências" no menu)
app.get("/api/minhas-ocorrencias/novas", autenticar, apenasPai, rota(async (req, res) => {
  const [[r]] = await db.query("SELECT COUNT(*) AS n FROM tb_ocorrencias_escolares WHERE id_aluno IN (?) AND oce_resp_assinada_em IS NULL", [idsOuZero(req.usuario.filhos)]);
  res.json({ novas: r.n });
}));
// Assinatura de ciência do responsável: o botão insere o nome de quem está logado e o servidor confere com o cadastro
app.post("/api/minhas-ocorrencias/:id/assinar", autenticar, apenasPai, rota(async (req, res) => {
  const [[o]] = await db.query("SELECT id_ocorrencia AS id, id_aluno AS aluno_id, oce_resp_assinada_em AS assinada_em FROM tb_ocorrencias_escolares WHERE id_ocorrencia = ?", [req.params.id]);
  if (!o || !req.usuario.filhos.includes(o.aluno_id)) return res.status(404).json({ erro: "Ocorrência não encontrada." });
  if (o.assinada_em) return res.status(400).json({ erro: "Esta ocorrência já foi assinada." });
  const nome = await senhaParaAssinar(req, res);
  if (!nome) return;
  const u = { nome }, codigo = novoCodigo();
  const [r] = await db.query(`UPDATE tb_ocorrencias_escolares SET oce_resp_usu_id = ?, oce_resp_nome = ?, oce_resp_assinada_em = NOW(), oce_resp_codigo = ?
    WHERE id_ocorrencia = ? AND oce_resp_assinada_em IS NULL`, [req.usuario.id, u.nome, codigo, o.id]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Esta ocorrência já foi assinada." });
  await registrarAssinatura({ codigo, documento: "ocorrencia", documentoId: o.id, papel: "resp", usuario: req.usuario, nome, req });
  await registrarLog(req.usuario, "ocorrencia_escolar_assinada", `ocorrência id ${o.id} (código ${codigo})`);
  res.json({ ok: true, codigo });
}));

// Pasta de ocorrências da gestão (Central do Dia): todas as ocorrências registradas pelos professores.
// Sem a assinatura da gestão, a ocorrência conta no quadro "Ocorrências"; depois de assinada vai para "Ocorrências registradas".
app.get("/api/ocorrencias-gestao", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`${CONSULTA_OCORRENCIAS} ${ORDEM_OCORRENCIAS}`);
  res.json(linhas);
}));
app.post("/api/ocorrencias-gestao/:id/assinar", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[o]] = await db.query("SELECT id_ocorrencia AS id, id_aluno AS aluno_id, oce_ges_assinada_em AS assinada_em FROM tb_ocorrencias_escolares WHERE id_ocorrencia = ?", [req.params.id]);
  if (!o) return res.status(404).json({ erro: "Ocorrência não encontrada." });
  if (o.assinada_em) return res.status(400).json({ erro: "Esta ocorrência já foi assinada pela gestão." });
  const nome = await senhaParaAssinar(req, res);
  if (!nome) return;
  const u = { nome }, codigo = novoCodigo();
  const [r] = await db.query(`UPDATE tb_ocorrencias_escolares SET oce_ges_usu_id = ?, oce_ges_nome = ?, oce_ges_assinada_em = NOW(), oce_ges_codigo = ?
    WHERE id_ocorrencia = ? AND oce_ges_assinada_em IS NULL`, [req.usuario.id, u.nome, codigo, o.id]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Esta ocorrência já foi assinada pela gestão." });
  await registrarAssinatura({ codigo, documento: "ocorrencia", documentoId: o.id, papel: "gestao", usuario: req.usuario, nome, req });
  await registrarLog(req.usuario, "ocorrencia_escolar_gestao", `ocorrência id ${o.id} (código ${codigo})`);
  res.json({ ok: true, codigo });
}));

app.post("/api/ocorrencias-escolares", autenticar, apenasProfessor, rota(async (req, res) => {
  const b = req.body;
  const aluno = await alunoPermitido(req.usuario, Number(b.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (b.descricao || "").trim(), buscadoPor = (b.buscado_por || "").trim();
  if (!dataValida(b.data)) return res.status(400).json({ erro: "Informe a data da ocorrência." });
  if (!/^\d{2}:\d{2}$/.test(b.horario || "")) return res.status(400).json({ erro: "Informe o horário da ocorrência." });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.notificado_em || "")) return res.status(400).json({ erro: "Informe quando o responsável foi notificado." });
  if (!descricao || descricao.length > 1000) return res.status(400).json({ erro: "Descreva a ocorrência (até 1000 caracteres)." });
  if (!buscadoPor || buscadoPor.length > 100) return res.status(400).json({ erro: "Informe quem foi buscar o aluno (até 100 caracteres)." });
  // Assinatura digital: o professor confirma com a própria senha
  const nome = await senhaParaAssinar(req, res);
  if (!nome) return;
  const u = { nome }, codigo = novoCodigo();
  const [novo] = await db.query(`INSERT INTO tb_ocorrencias_escolares (id_aluno, oce_turma, oce_data, oce_horario, oce_notificado_em, oce_descricao, oce_buscado_por, id_usuario, oce_professor_nome, oce_codigo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [aluno.id, aluno.sala, b.data, b.horario, b.notificado_em.replace("T", " ") + ":00", descricao, buscadoPor, req.usuario.id, u.nome, codigo]);
  await registrarAssinatura({ codigo, documento: "ocorrencia", documentoId: novo.insertId, papel: "professor", usuario: req.usuario, nome, req });
  await registrarLog(req.usuario, "ocorrencia_escolar_registrada", `${aluno.nome} (código ${codigo})`);
  res.status(201).json({ ok: true, codigo });
}));

// ---------- Termo de consentimento dos responsáveis: uso de imagem e informações do aluno (LGPD, art. 14, §1º) ----------
// O responsável escolhe cada item separadamente. Cada assinatura, alteração ou revogação grava uma NOVA linha (histórico preservado).
// Vale a mais recente da versão atual do texto. Se o texto mudar de versão, o consentimento volta a ficar pendente.
const CONSENTIMENTO = {
  versao: "1.0", atualizado_em: "15/10/2026", // 11/11/2026: só ajuste de redação (nome do Portal da Família), sem mudar o que é autorizado; por isso a versão continua 1.0
  titulo: "Termo de Consentimento dos Responsáveis — uso de imagem e informações do aluno",
  secoes: [
    { titulo: "1. O que é este termo", paragrafos: [
      `${escola.nome} pede a sua autorização, como pai, mãe ou responsável legal, para usar as informações e as imagens do aluno no sistema S.I.V.E. (LGPD, art. 14, §1º).`,
      "Você decide cada item separadamente, não precisa autorizar tudo e pode mudar de ideia quando quiser."] },
    { titulo: "2. Informações do aluno", itens: [
      "Quais: nome, turma, matrícula, frequência, ocorrências, pendências, comunicados, autorizações e documentos anexados.",
      "Para quê: gestão escolar, acompanhamento da frequência (Busca Ativa), comunicação com a família e segurança do aluno.",
      "Quem acessa: a gestão da escola, o professor da turma e os responsáveis do aluno."] },
    { titulo: "3. Imagens do aluno no sistema", paragrafos: ["Fotos do aluno anexadas ao sistema, como fotos de identificação e documentos com foto. Só quem tem acesso à ficha do aluno pode vê-las."] },
    { titulo: "4. Câmeras de segurança e reconhecimento facial", paragrafos: [
      "Captação de imagens do aluno por câmeras da escola, para controle de entrada e saída e para segurança. Este recurso só funciona se a escola o ativar.",
      "O reconhecimento facial usa dados biométricos, que são dados pessoais sensíveis (LGPD, art. 11). Ele só pode ser usado com a autorização deste item."] },
    { titulo: "5. O que o sistema não faz", itens: [
      "Não vende nem compartilha as informações e as imagens com terceiros.",
      "Não usa as informações e as imagens para publicidade.",
      "Não divulga imagens do aluno em redes sociais ou sites."] },
    { titulo: "6. Por quanto tempo vale", paragrafos: ["A autorização vale enquanto o aluno estiver matriculado, ou até você alterá-la ou revogá-la."] },
    { titulo: "7. Como alterar ou revogar", paragrafos: [
      "Pelo Portal da Família, a qualquer momento, no cartão \"Consentimento\". A revogação vale daqui para a frente: o que já foi feito com a autorização anterior continua válido (LGPD, art. 8º, §5º).",
      "O histórico das suas decisões continua guardado, para comprovar o que foi autorizado em cada época."] },
    { titulo: "8. Seus direitos", paragrafos: ["Veja a Política de Privacidade para conhecer os seus direitos (LGPD, art. 18) e o contato do encarregado de dados."] },
  ],
  opcoes: [
    { id: "informacoes", curto: "Informações do aluno no sistema", rotulo: "Autorizo o tratamento das informações do aluno no sistema S.I.V.E.", detalhe: "Nome, turma, matrícula, frequência, ocorrências, pendências, comunicados, autorizações e documentos." },
    { id: "imagem", curto: "Imagens (fotos) do aluno no sistema", rotulo: "Autorizo o uso de imagens (fotos) do aluno no sistema S.I.V.E.", detalhe: "Fotos de identificação e documentos com foto anexados à ficha." },
    { id: "monitoramento", curto: "Câmeras de segurança e reconhecimento facial", rotulo: "Autorizo a captação de imagens do aluno por câmeras de segurança e, se a escola ativar, o reconhecimento facial.", detalhe: "Dado biométrico é dado pessoal sensível (LGPD, art. 11). Este recurso só funciona se a escola o ativar.", sensivel: true },
  ],
};
const OPCOES_CONSENTIMENTO = CONSENTIMENTO.opcoes.map((o) => o.id);
// pendente (nunca assinou esta versão) | autorizado (todos os itens) | parcial (alguns) | nao_autorizado (nenhum, inclui revogação)
function statusConsentimento(c) {
  if (!c) return "pendente";
  const n = OPCOES_CONSENTIMENTO.filter((id) => c[id]).length;
  return n === OPCOES_CONSENTIMENTO.length ? "autorizado" : n === 0 ? "nao_autorizado" : "parcial";
}
// completo = false (professor): só vê o estado e as escolhas, sem o nome de quem assinou, o código e o histórico
async function consentimentoDoAluno(alunoId, completo) {
  const [linhas] = await db.query("SELECT con_id AS id, con_versao AS versao, con_informacoes AS informacoes, con_imagem AS imagem, con_monitoramento AS monitoramento, con_assinado_nome AS assinado_nome, DATE_FORMAT(con_assinado_em, '%d/%m/%Y %H:%i') AS assinado_em, con_codigo AS codigo FROM tb_consentimentos WHERE id_aluno = ? ORDER BY con_id DESC", [alunoId]);
  const historico = linhas.map((c) => ({ ...c, informacoes: !!c.informacoes, imagem: !!c.imagem, monitoramento: !!c.monitoramento }));
  const atual = historico.find((c) => c.versao === CONSENTIMENTO.versao) || null;
  const resposta = { versao_atual: CONSENTIMENTO.versao, status: statusConsentimento(atual), atual: null };
  if (atual) resposta.atual = completo ? atual : { informacoes: atual.informacoes, imagem: atual.imagem, monitoramento: atual.monitoramento, assinado_em: atual.assinado_em };
  if (completo) resposta.historico = historico;
  return resposta;
}

app.get("/api/consentimento-termo", (req, res) => res.json(CONSENTIMENTO)); // público, como a política de privacidade

app.get("/api/alunos/:alunoId/consentimento", autenticar, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  res.json(await consentimentoDoAluno(aluno.id, req.usuario.papel !== "professor"));
}));

// Só o responsável do próprio aluno assina. Confirma com nome completo + senha (mesmo padrão das autorizações digitais).
app.post("/api/alunos/:alunoId/consentimento", autenticar, rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável pelo aluno pode assinar o termo." });
  const alunoId = Number(req.params.alunoId);
  if (!req.usuario.filhos.includes(alunoId)) return res.status(403).json({ erro: "Você só pode assinar o termo do seu próprio filho." });
  const escolhas = {};
  for (const id of OPCOES_CONSENTIMENTO) {
    if (typeof req.body[id] !== "boolean") return res.status(400).json({ erro: "Responda todas as opções (autorizo ou não autorizo)." });
    escolhas[id] = req.body[id];
  }
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  const [[u]] = await db.query("SELECT usu_nome AS nome, usu_senha AS senha FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  if (req.body.confirmo !== true && !req.body.nome) return res.status(400).json({ erro: "Marque “Li o termo e confirmo minhas escolhas” para assinar." });
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chave); return res.status(400).json({ erro: "Senha incorreta." }); }
  tentativas.delete(chave);
  const codigo = novoCodigo();
  const [novoCon] = await db.query("INSERT INTO tb_consentimentos (id_aluno, id_usuario, con_versao, con_informacoes, con_imagem, con_monitoramento, con_assinado_nome, con_codigo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [alunoId, req.usuario.id, CONSENTIMENTO.versao, escolhas.informacoes, escolhas.imagem, escolhas.monitoramento, u.nome, codigo]);
  await registrarAssinatura({ codigo, documento: "consentimento", documentoId: novoCon.insertId, papel: "resp", usuario: req.usuario, nome: u.nome, req });
  const sn = (v) => (v ? "sim" : "não");
  await registrarLog(req.usuario, "consentimento_registrado", `Aluno id ${alunoId} — informações: ${sn(escolhas.informacoes)}, imagem: ${sn(escolhas.imagem)}, câmeras: ${sn(escolhas.monitoramento)} (código ${codigo})`);
  res.status(201).json({ ok: true, codigo, status: statusConsentimento(escolhas) });
}));

// Visão da gestão: situação do consentimento de todos os alunos (versão atual do termo)
app.get("/api/consentimentos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala, c.con_informacoes AS informacoes, c.con_imagem AS imagem, c.con_monitoramento AS monitoramento,
    c.con_assinado_nome AS assinado_nome, DATE_FORMAT(c.con_assinado_em, '%d/%m/%Y %H:%i') AS assinado_em
    FROM tb_alunos a LEFT JOIN tb_consentimentos c ON c.id_aluno = a.id_aluno AND c.con_id = (SELECT MAX(x.con_id) FROM tb_consentimentos x WHERE x.id_aluno = a.id_aluno AND x.con_versao = ?)
    WHERE a.alu_situacao = 'Ativo' ORDER BY a.alu_nome`, [CONSENTIMENTO.versao]);
  const alunos = linhas.map((l) => {
    const assinado = l.assinado_nome !== null;
    const c = assinado ? { informacoes: !!l.informacoes, imagem: !!l.imagem, monitoramento: !!l.monitoramento } : null;
    return { id: l.id, nome: l.nome, sala: l.sala, status: statusConsentimento(c), ...(c || {}), assinado_nome: l.assinado_nome, assinado_em: l.assinado_em };
  });
  const resumo = { total: alunos.length, autorizado: 0, parcial: 0, nao_autorizado: 0, pendente: 0 };
  alunos.forEach((a) => resumo[a.status]++);
  res.json({ versao: CONSENTIMENTO.versao, resumo, alunos });
}));

// ---------- Proteção da criança: comunicações ao Conselho Tutelar (ECA arts. 13 e 56; LDB art. 12, VIII) ----------
// Registros CONFIDENCIAIS: só a gestão vê todos; o professor vê apenas os que ele mesmo registrou; responsável NUNCA vê
// (a suspeita pode envolver a própria família). Nada é apagado, e toda consulta e registro vai para os logs.
const MOTIVOS_PROTECAO = ["Maus-tratos", "Faltas", "Outro"];
// LDB, art. 12, VIII: notificar quando as faltas passam de 30% do percentual permitido em lei. Faltas permitidas = 25% (frequência mínima de 75%),
// então 30% de 25% = 7,5% das aulas. Confira a regra da sua rede de ensino.
const LIMITE_FALTAS_CT = 7.5;

app.get("/api/protecao", autenticar, adminOuProfessor, rota(async (req, res) => {
  const ehAdmin = req.usuario.papel === "admin";
  const [itens] = await db.query(`SELECT c.id_comunicacao_conselho AS id, c.id_aluno AS aluno_id, a.alu_nome AS aluno_nome, a.alu_sala AS aluno_sala, c.id_busca_ativa AS busca_id,
    c.cct_motivo AS motivo, c.cct_descricao AS descricao, c.cct_medidas AS medidas,
    DATE_FORMAT(c.cct_registrada_em, '%d/%m/%Y %H:%i') AS registrada_em, c.cct_registrada_por_nome AS registrada_por,
    DATE_FORMAT(c.cct_comunicado_em, '%d/%m/%Y') AS comunicado_em, c.cct_comunicado_por_nome AS comunicado_por, c.cct_protocolo AS protocolo,
    (c.cct_comunicado_em IS NULL) AS pendente, DATEDIFF(CURDATE(), DATE(c.cct_registrada_em)) AS dias_registro
    FROM tb_comunicacoes_conselho c JOIN tb_alunos a ON a.id_aluno = c.id_aluno ${ehAdmin ? "" : "WHERE c.id_usuario = ?"}
    ORDER BY (c.cct_comunicado_em IS NULL) DESC, CASE WHEN c.cct_comunicado_em IS NULL THEN c.cct_registrada_em END ASC, c.id_comunicacao_conselho DESC LIMIT 200`, ehAdmin ? [] : [req.usuario.id]);
  const lista = itens.map((i) => ({ ...i, pendente: !!i.pendente }));
  await registrarLog(req.usuario, "protecao_consultada", `${lista.length} registro(s)`);
  res.json({ pendentes: lista.filter((i) => i.pendente).length, itens: lista });
}));

app.post("/api/protecao", autenticar, adminOuProfessor, rota(async (req, res) => {
  const { aluno_id, motivo, bua_id } = req.body;
  const descricao = String(req.body.descricao || "").trim(), medidas = String(req.body.medidas || "").trim();
  if (!MOTIVOS_PROTECAO.includes(motivo)) return res.status(400).json({ erro: "Escolha o motivo da comunicação." });
  if (descricao.length < 10 || descricao.length > 1500) return res.status(400).json({ erro: "Descreva os fatos (de 10 a 1500 caracteres)." });
  if (medidas.length > 1500) return res.status(400).json({ erro: "As medidas adotadas passam de 1500 caracteres." });
  const aluno = await alunoPermitido(req.usuario, Number(aluno_id));
  if (!aluno) return semPermissao(res);
  let medidasFinal = medidas || null, buaId = null;
  if (motivo === "Faltas") { // ECA, art. 56, II: só depois de esgotados os recursos da escola, e quem decide é a gestão
    if (req.usuario.papel !== "admin") return res.status(403).json({ erro: "A comunicação por faltas é feita pela gestão da escola." });
    if (req.body.recursos_esgotados !== true) return res.status(400).json({ erro: "Confirme que os recursos da escola foram esgotados (ECA, art. 56, II)." });
    if (bua_id) {
      const [[caso]] = await db.query("SELECT id_busca_ativa FROM tb_busca_ativa WHERE id_busca_ativa = ? AND id_aluno = ?", [bua_id, aluno.id]);
      if (!caso) return res.status(400).json({ erro: "Caso de Busca Ativa não encontrado para este aluno." });
      const [[ja]] = await db.query("SELECT id_comunicacao_conselho FROM tb_comunicacoes_conselho WHERE id_busca_ativa = ?", [bua_id]);
      if (ja) return res.status(409).json({ erro: "Este caso de Busca Ativa já tem uma comunicação registrada." });
      const [humanos] = await db.query("SELECT bar_nome_usuario AS nome, bar_texto AS texto, DATE_FORMAT(bar_data_hora, '%d/%m/%Y') AS dia FROM tb_busca_ativa_registros WHERE id_busca_ativa = ? AND bar_nome_usuario <> 'Sistema' ORDER BY id_busca_ativa_registro", [bua_id]);
      if (!humanos.length) return res.status(400).json({ erro: "Registre ao menos uma ação de acompanhamento (ligação, visita, conversa com a família) antes de comunicar ao Conselho Tutelar: o ECA (art. 56, II) pede que os recursos da escola sejam esgotados." });
      if (!medidasFinal) medidasFinal = humanos.map((h) => `${h.dia} — ${h.nome}: ${h.texto}`).join("\n").slice(0, 1500); // o histórico do acompanhamento vira as "medidas adotadas"
      buaId = caso.id_busca_ativa;
    } else if (medidas.length < 10) return res.status(400).json({ erro: "Descreva as medidas que a escola já adotou." });
  }
  const [r] = await db.query("INSERT INTO tb_comunicacoes_conselho (id_aluno, id_usuario, id_busca_ativa, cct_motivo, cct_descricao, cct_medidas, cct_registrada_por_nome) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [aluno.id, req.usuario.id, buaId, motivo, descricao, medidasFinal, req.usuario.nome]);
  await registrarLog(req.usuario, "protecao_registrada", `${motivo} — aluno id ${aluno.id}`); // o texto dos fatos nunca vai para os logs
  res.status(201).json({ ok: true, id: r.insertId });
}));

// A gestão registra que JÁ comunicou ao Conselho Tutelar (data e protocolo/ofício)
app.put("/api/protecao/:id/comunicado", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[reg]] = await db.query("SELECT id_comunicacao_conselho AS id, cct_comunicado_em AS feito, id_aluno AS aluno_id FROM tb_comunicacoes_conselho WHERE id_comunicacao_conselho = ?", [req.params.id]);
  if (!reg) return res.status(404).json({ erro: "Registro não encontrado." });
  if (reg.feito) return res.status(409).json({ erro: "Este registro já consta como comunicado." });
  const data = String(req.body.data || ""), protocolo = String(req.body.protocolo || "").trim();
  const [[h]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(new Date(data + "T12:00:00").getTime())) return res.status(400).json({ erro: "Informe a data em que a comunicação foi feita." });
  if (data > h.hoje) return res.status(400).json({ erro: "A data da comunicação não pode ser no futuro." });
  if (protocolo && !/^[\p{L}\p{N} ./_-]{1,60}$/u.test(protocolo)) return res.status(400).json({ erro: "Protocolo inválido (até 60 caracteres: letras, números, espaço, ponto, barra e hífen)." });
  await db.query("UPDATE tb_comunicacoes_conselho SET cct_comunicado_em = ?, cct_comunicado_por_nome = ?, cct_protocolo = ? WHERE id_comunicacao_conselho = ?", [data, req.usuario.nome, protocolo || null, reg.id]);
  await registrarLog(req.usuario, "protecao_comunicada", `Registro ${reg.id} — aluno id ${reg.aluno_id}${protocolo ? " — protocolo " + protocolo : ""}`);
  res.json({ ok: true });
}));

// LDB, art. 12, VIII: relação dos alunos com faltas acima do limite (calculada sobre os dias com chamada registrada no sistema)
app.get("/api/protecao/faltas-limite", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala, COUNT(p.id_presenca) AS dias,
    COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) AS faltas,
    EXISTS(SELECT 1 FROM tb_comunicacoes_conselho c WHERE c.id_aluno = a.id_aluno AND c.cct_motivo = 'Faltas') AS comunicado
    FROM tb_alunos a JOIN tb_presencas p ON p.id_aluno = a.id_aluno WHERE a.alu_situacao = 'Ativo' GROUP BY a.id_aluno, a.alu_nome, a.alu_sala
    HAVING COUNT(p.id_presenca) > 0 AND COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) * 100 > COUNT(p.id_presenca) * ?
    ORDER BY COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) / COUNT(p.id_presenca) DESC, a.alu_nome`, [LIMITE_FALTAS_CT]);
  res.json({ percentual: LIMITE_FALTAS_CT, alunos: linhas.map((l) => ({ ...l, percentual: Math.round((l.faltas * 1000) / l.dias) / 10, comunicado: !!l.comunicado })) });
}));

// =====================================================================
// FASE 4 — calendário de eventos com banners, perfil do responsável e reativação de professores
// =====================================================================

// ---------- Reativação de professores: 60 dias sem acessar o sistema (AVA) ----------
// O prazo conta a partir do último acesso (ou do cadastro, se nunca entrou) e recomeça quando a gestão reativa.
// Para mudar a regra, altere estes números. "aviso" = a partir de quantos dias o professor aparece como "perto do limite".
const INATIVIDADE = { dias: 60, aviso: 50 };
const SQL_DIAS_SEM_ACESSO = "DATEDIFF(NOW(), GREATEST(COALESCE(u.usu_ultimo_acesso, u.usu_criado_em), COALESCE(u.usu_reativado_em, u.usu_criado_em)))";

async function verificarInatividade() {
  const [vencidos] = await db.query(`SELECT u.id_usuario AS id, u.usu_nome AS nome, u.usu_sala AS sala, ${SQL_DIAS_SEM_ACESSO} AS dias FROM tb_usuarios u
    WHERE u.usu_papel = 'professor' AND u.usu_ativo = TRUE AND ${SQL_DIAS_SEM_ACESSO} >= ?`, [INATIVIDADE.dias]);
  for (const v of vencidos) {
    const [r] = await db.query("UPDATE tb_usuarios SET usu_ativo = FALSE, usu_inativado_motivo = 'inatividade', usu_inativado_em = NOW(), usu_reativacao_pedida_em = NULL WHERE id_usuario = ? AND usu_ativo = TRUE", [v.id]);
    if (r.affectedRows) await registrarLog(SISTEMA, "inativado_por_inatividade", `${v.nome} (${v.sala || "-"}): ${v.dias} dias sem acessar`);
  }
}

app.get("/api/reativacao", autenticar, apenasAdmin, rota(async (req, res) => {
  await verificarInatividade();
  const [linhas] = await db.query(`SELECT u.id_usuario AS id, u.usu_nome AS nome, u.usu_usuario AS usuario, u.usu_sala AS sala, u.usu_ativo AS ativo,
    DATE_FORMAT(u.usu_ultimo_acesso, '%d/%m/%Y') AS ultimo_acesso, DATE_FORMAT(u.usu_inativado_em, '%d/%m/%Y') AS inativado_em,
    DATE_FORMAT(u.usu_reativacao_pedida_em, '%d/%m/%Y %H:%i') AS pedido_em, ${SQL_DIAS_SEM_ACESSO} AS dias_sem_acesso
    FROM tb_usuarios u WHERE u.usu_papel = 'professor' AND ((u.usu_ativo = FALSE AND u.usu_inativado_motivo = 'inatividade') OR (u.usu_ativo = TRUE AND ${SQL_DIAS_SEM_ACESSO} >= ?))
    ORDER BY u.usu_ativo, u.usu_reativacao_pedida_em IS NULL, dias_sem_acesso DESC`, [INATIVIDADE.aviso]);
  res.json({ ...INATIVIDADE, inativos: linhas.filter((l) => !l.ativo), perto: linhas.filter((l) => l.ativo).map((l) => ({ ...l, faltam: INATIVIDADE.dias - l.dias_sem_acesso })) });
}));

// Pedido de "Esqueci minha senha": a gestão confirma quem é e gera uma senha provisória (troca obrigatória no próximo login).
// A verificação em duas etapas continua valendo; se a pessoa também perdeu o celular, a gestão zera à parte.
app.put("/api/usuarios/:id/nova-senha", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, usu_nome AS nome, usu_ativo AS ativo FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (!u.ativo) return res.status(400).json({ erro: "Este usuário está inativo. Reative o acesso primeiro." });
  if (u.id === req.usuario.id) return res.status(400).json({ erro: "Para mudar a sua própria senha, use Trocar senha." });
  const senha = gerarSenhaGenerica();
  await db.query("UPDATE tb_usuarios SET usu_senha = ?, usu_senha_temporaria = TRUE, usu_senha_pedida_em = NULL, usu_recuperacao_hash = NULL, usu_recuperacao_expira = NULL, usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?", [await hashSenha(senha), u.id]);
  await registrarLog(req.usuario, "nova_senha_usuario", `${u.nome} (nova senha provisória gerada)`);
  res.json({ ok: true, senha_provisoria: senha });
}));
// A gestão reativa: o acesso volta, o prazo recomeça e uma senha provisória nova é gerada (troca obrigatória no próximo login)
app.put("/api/usuarios/:id/reativar", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, usu_nome AS nome, usu_ativo AS ativo FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (u.ativo) return res.status(400).json({ erro: "Este usuário já está ativo." });
  const senha = gerarSenhaGenerica();
  await db.query(`UPDATE tb_usuarios SET usu_ativo = TRUE, usu_inativado_motivo = NULL, usu_inativado_em = NULL, usu_reativado_em = NOW(), usu_reativacao_pedida_em = NULL,
    usu_senha = ?, usu_senha_temporaria = TRUE, usu_sessao_versao = usu_sessao_versao + 1 WHERE id_usuario = ?`, [await hashSenha(senha), u.id]);
  await registrarLog(req.usuario, "reativar_usuario", `${u.nome} (nova senha provisória gerada)`);
  res.json({ ok: true, senha_provisoria: senha });
}));

// ---------- Perfil do responsável ----------
// Liga o login do responsável ao cadastro dele em "responsaveis" (procura pelo nome entre os responsáveis do filho; se não achar, cria).
async function responsavelDoUsuario(usuario) {
  const [[u]] = await db.query("SELECT id_responsavel AS id_responsavel FROM tb_usuarios WHERE id_usuario = ?", [usuario.id]);
  if (u && u.id_responsavel) return u.id_responsavel;
  if (!usuario.aluno_id) return null;
  const [doFilho] = await db.query("SELECT r.id_responsavel AS id, r.res_nome AS nome FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?", [usuario.aluno_id]);
  let resId = (doFilho.find((r) => normalizar(r.nome) === normalizar(usuario.nome)) || {}).id;
  if (!resId) {
    resId = (await db.query("INSERT INTO tb_resp (res_nome) VALUES (?)", [usuario.nome]))[0].insertId;
    await db.query("INSERT IGNORE INTO tb_aluno_resp (id_aluno, id_responsavel, alr_parentesco) VALUES (?, ?, 'Responsável')", [usuario.aluno_id, resId]);
  }
  await db.query("UPDATE tb_usuarios SET id_responsavel = ? WHERE id_usuario = ?", [resId, usuario.id]);
  return resId;
}
const CONTATOS = ["WhatsApp", "Ligação", "E-mail"];
const apenasResponsavel = (req, res, next) => req.usuario.papel === "pai" ? next() : res.status(403).json({ erro: "Somente o responsável tem perfil." });

app.get("/api/meu-perfil", autenticar, apenasResponsavel, rota(async (req, res) => {
  const resId = await responsavelDoUsuario(req.usuario);
  const [[conta]] = await db.query(`SELECT usu_usuario AS login, usu_nome AS nome, DATE_FORMAT(usu_ultimo_acesso, '%d/%m/%Y %H:%i') AS ultimo_acesso,
    DATE_FORMAT(usu_criado_em, '%d/%m/%Y') AS criado_em, DATE_FORMAT(usu_aceite_em, '%d/%m/%Y %H:%i') AS aceite_em, usu_aceite_versao AS aceite_versao FROM tb_usuarios WHERE id_usuario = ?`, [req.usuario.id]);
  const [[resp]] = await db.query(`SELECT id_responsavel AS id, res_nome AS nome, res_telefone AS telefone, res_telefone2 AS telefone2, res_email AS email, res_contato_preferido AS contato_preferido,
    DATE_FORMAT(res_atualizado_em, '%d/%m/%Y %H:%i') AS atualizado_em FROM tb_resp WHERE id_responsavel = ?`, [resId]);
  const [[filho]] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala, a.alu_matricula AS matricula, ar.alr_parentesco AS parentesco
    FROM tb_alunos a LEFT JOIN tb_aluno_resp ar ON ar.id_aluno = a.id_aluno AND ar.id_responsavel = ? WHERE a.id_aluno = ?`, [resId, req.usuario.aluno_id]);
  const [outros] = await db.query(`SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel
    WHERE ar.id_aluno = ? AND ar.id_responsavel <> ?`, [req.usuario.aluno_id, resId]);
  const [acessos] = await db.query(`SELECT DATE_FORMAT(log_data_hora, '%d/%m/%Y %H:%i') AS quando FROM tb_logs WHERE id_usuario = ? AND log_acao = 'login_sucesso' ORDER BY id_log DESC LIMIT 5`, [req.usuario.id]);
  const consentimento = await consentimentoDoAluno(req.usuario.aluno_id, true);
  res.json({ conta, responsavel: resp, filho, outros_responsaveis: outros, ultimos_acessos: acessos, contatos: CONTATOS,
    consentimento: { status: consentimento.status, assinado_em: consentimento.atual ? consentimento.atual.assinado_em : null } });
}));

app.put("/api/meu-perfil", autenticar, apenasResponsavel, rota(async (req, res) => {
  const limpa = (v) => String(v ?? "").trim();
  const telefone = limpa(req.body.telefone), telefone2 = limpa(req.body.telefone2), email = limpa(req.body.email).toLowerCase(), contato = limpa(req.body.contato_preferido);
  const telOk = (t) => /^[\d\s()+-]{8,20}$/.test(t) && t.replace(/\D/g, "").length >= 8;
  if (!telOk(telefone)) return res.status(400).json({ erro: "Informe um telefone principal válido, com DDD. Ex.: (11) 98765-4321." });
  if (telefone2 && !telOk(telefone2)) return res.status(400).json({ erro: "O telefone para recados não parece válido." });
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) return res.status(400).json({ erro: "O e-mail não parece válido." });
  if (!CONTATOS.includes(contato)) return res.status(400).json({ erro: "Escolha como prefere ser contatado." });
  if (contato === "E-mail" && !email) return res.status(400).json({ erro: "Para receber contato por e-mail, informe o seu e-mail." });
  const resId = await responsavelDoUsuario(req.usuario);
  await db.query("UPDATE tb_resp SET res_telefone = ?, res_telefone2 = ?, res_email = ?, res_contato_preferido = ?, res_atualizado_em = NOW() WHERE id_responsavel = ?",
    [telefone, telefone2 || null, email || null, contato, resId]);
  await registrarLog(req.usuario, "perfil_atualizado", "Contatos do responsável"); // os dados em si não vão para o log
  res.json({ ok: true });
}));

// ---------- Calendário de eventos e banners ----------
const TIPOS_EVENTO = ["Evento", "Reunião", "Passeio", "Feriado", "Prazo"];
const TIPOS_BANNER = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const BANNER_MAXIMO = 2 * 1024 * 1024;
// Quem vê o quê: gestão vê tudo; professor vê os da escola toda e da própria turma; responsável, os da escola toda e da turma do filho.
async function filtroEventos(usuario) {
  if (usuario.papel === "admin") return { sql: "1 = 1", params: [] };
  let sala = usuario.sala;
  if (usuario.papel === "pai") sala = ((await db.query("SELECT alu_sala AS sala FROM tb_alunos WHERE id_aluno = ?", [usuario.aluno_id]))[0][0] || {}).sala;
  return { sql: "(e.eve_sala IS NULL OR e.eve_sala = ?)", params: [sala || ""] };
}
const CAMPOS_EVENTO = `e.id_evento AS id, e.eve_titulo AS titulo, e.eve_descricao AS descricao, e.eve_tipo AS tipo, DATE_FORMAT(e.eve_data, '%Y-%m-%d') AS data,
  DATE_FORMAT(e.eve_data_fim, '%Y-%m-%d') AS data_fim, TIME_FORMAT(e.eve_hora, '%H:%i') AS hora, e.eve_local AS local, e.eve_sala AS sala, e.eve_destaque AS destaque,
  (e.eve_banner_arquivo IS NOT NULL) AS tem_banner, e.eve_criado_por_nome AS criado_por_nome, e.id_usuario AS criado_por_id`;
const formatarEvento = (usuario) => (e) => ({ ...e, destaque: !!e.destaque, tem_banner: !!e.tem_banner, pode_gerenciar: usuario.papel === "admin", criado_por_id: undefined });

app.get("/api/eventos", autenticar, rota(async (req, res) => {
  const hoje = (await dataReferencia()).hoje;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || "") ? req.query.mes : hoje.slice(0, 7);
  const inicio = `${mes}-01`, f = await filtroEventos(req.usuario);
  const [doMes] = await db.query(`SELECT ${CAMPOS_EVENTO} FROM tb_eventos e WHERE e.eve_data < DATE_ADD(?, INTERVAL 1 MONTH) AND COALESCE(e.eve_data_fim, e.eve_data) >= ? AND ${f.sql}
    ORDER BY e.eve_data, e.eve_hora`, [inicio, inicio, ...f.params]);
  const [proximos] = await db.query(`SELECT ${CAMPOS_EVENTO} FROM tb_eventos e WHERE COALESCE(e.eve_data_fim, e.eve_data) >= CURDATE() AND ${f.sql}
    ORDER BY e.eve_data, e.eve_hora LIMIT 8`, f.params);
  res.json({ mes, hoje, tipos: TIPOS_EVENTO, eventos: doMes.map(formatarEvento(req.usuario)), proximos: proximos.map(formatarEvento(req.usuario)) });
}));

// Banners: eventos marcados como destaque que ainda não passaram (até 5)
app.get("/api/eventos/banners", autenticar, rota(async (req, res) => {
  const f = await filtroEventos(req.usuario);
  const [linhas] = await db.query(`SELECT ${CAMPOS_EVENTO} FROM tb_eventos e WHERE e.eve_destaque = TRUE AND COALESCE(e.eve_data_fim, e.eve_data) >= CURDATE() AND ${f.sql}
    ORDER BY e.eve_data, e.eve_hora LIMIT 5`, f.params);
  res.json(linhas.map(formatarEvento(req.usuario)));
}));

// Lê e confere os campos do evento (criar e editar usam as mesmas regras). Em "atual" vem o evento que está sendo editado:
// manter a data que ele já tinha é permitido, mas mudar para um dia que já passou, não.
async function lerEvento(req, atual = null) {
  const b = req.body, texto = (v, max) => String(v ?? "").trim().slice(0, max);
  const titulo = texto(b.titulo, 200), descricao = texto(b.descricao, 600), local = texto(b.local, 200);
  if (titulo.length < 3 || titulo.length > 100) return { erro: "Informe o título do evento (de 3 a 100 caracteres)." };
  if (!TIPOS_EVENTO.includes(b.tipo)) return { erro: "Escolha o tipo do evento." };
  if (!dataValida(b.data) || Number.isNaN(new Date(b.data + "T12:00:00").getTime())) return { erro: "Informe a data do evento." };
  // Eventos só a partir de hoje: não dá para marcar nada em um dia que já passou
  if (b.data < (await dataReferencia()).hoje && !(atual && atual.data === b.data)) return { erro: "Não é possível marcar evento em uma data que já passou. Escolha hoje ou um dia futuro." };
  const dataFim = b.data_fim ? String(b.data_fim) : null;
  if (dataFim && (!dataValida(dataFim) || dataFim < b.data)) return { erro: "A data de término precisa ser igual ou depois da data de início." };
  const hora = b.hora ? String(b.hora).slice(0, 5) : null;
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { erro: "Hora inválida." };
  if (descricao.length > 500) return { erro: "A descrição passa de 500 caracteres." };
  if (local.length > 100) return { erro: "O local passa de 100 caracteres." };
  // professor só cria evento para a própria turma; a gestão escolhe uma turma ou a escola toda
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : (texto(b.sala, 40) || null);
  if (sala && !(await turmaExiste(sala))) return { erro: "Turma não encontrada." };
  let arquivo = null, mime = null, bytes = null;
  if (b.banner && b.banner.conteudo) {
    const ext = path.extname(path.basename(String(b.banner.nome_arquivo || ""))).slice(1).toLowerCase();
    if (!TIPOS_BANNER[ext]) return { erro: "A imagem do banner precisa ser PNG ou JPG." };
    bytes = Buffer.from(String(b.banner.conteudo), "base64");
    if (!bytes.length || bytes.length > BANNER_MAXIMO) return { erro: "A imagem do banner precisa ter até 2 MB." };
    if (!ASSINATURAS_ARQUIVO[ext].every((x, i) => bytes[i] === x)) return { erro: "Este arquivo não é uma imagem PNG ou JPG válida." };
    // ECA, arts. 17 e 100, V, e LGPD, art. 14: o banner é visto por várias famílias
    if (b.imagem_sem_alunos !== true) return { erro: "Confirme que a imagem não mostra alunos, ou que todos os alunos que aparecem têm autorização de uso de imagem." };
    arquivo = "ban-" + crypto.randomBytes(16).toString("hex") + ".enc"; mime = TIPOS_BANNER[ext];
  }
  return { titulo, descricao, local, dataFim, hora, sala, arquivo, mime, bytes };
}
app.post("/api/eventos", autenticar, adminOuProfessor, rota(async (req, res) => {
  const ev = await lerEvento(req);
  if (ev.erro) return res.status(400).json({ erro: ev.erro });
  const b = req.body, { titulo, descricao, local, dataFim, hora, sala, arquivo, mime, bytes } = ev;
  if (arquivo) fs.writeFileSync(path.join(PASTA_UPLOADS, arquivo), cifrarArquivo(bytes, arquivo));
  const [r] = await db.query(`INSERT INTO tb_eventos (eve_titulo, eve_descricao, eve_tipo, eve_data, eve_data_fim, eve_hora, eve_local, eve_sala, eve_destaque, eve_banner_arquivo, eve_banner_mime, id_usuario, eve_criado_por_nome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [titulo, descricao || null, b.tipo, b.data, dataFim, hora, local || null, sala, b.destaque === true, arquivo, mime, req.usuario.id, req.usuario.nome]);
  await registrarLog(req.usuario, "evento_criado", `${titulo} (${b.data}, ${sala || "escola toda"})${arquivo ? " com banner" : ""}`);
  res.status(201).json({ ok: true, id: r.insertId });
}));

// Editar evento: só a gestão. Uma imagem nova troca o banner; "remover_banner" tira o banner atual.
app.put("/api/eventos/:id", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[atual]] = await db.query("SELECT id_evento AS id, DATE_FORMAT(eve_data, '%Y-%m-%d') AS data, eve_banner_arquivo AS arquivo, eve_banner_mime AS mime FROM tb_eventos WHERE id_evento = ?", [req.params.id]);
  if (!atual) return res.status(404).json({ erro: "Evento não encontrado." });
  const ev = await lerEvento(req, atual);
  if (ev.erro) return res.status(400).json({ erro: ev.erro });
  const b = req.body, { titulo, descricao, local, dataFim, hora, sala } = ev;
  let arquivo = atual.arquivo, mime = atual.mime;
  if (ev.arquivo || b.remover_banner === true) { arquivo = ev.arquivo; mime = ev.mime; }
  if (ev.arquivo) fs.writeFileSync(path.join(PASTA_UPLOADS, ev.arquivo), cifrarArquivo(ev.bytes, ev.arquivo));
  await db.query(`UPDATE tb_eventos SET eve_titulo = ?, eve_descricao = ?, eve_tipo = ?, eve_data = ?, eve_data_fim = ?, eve_hora = ?, eve_local = ?, eve_sala = ?, eve_destaque = ?,
    eve_banner_arquivo = ?, eve_banner_mime = ? WHERE id_evento = ?`, [titulo, descricao || null, b.tipo, b.data, dataFim, hora, local || null, sala, b.destaque === true, arquivo, mime, atual.id]);
  if (atual.arquivo && atual.arquivo !== arquivo) fs.rmSync(path.join(PASTA_UPLOADS, path.basename(atual.arquivo)), { force: true });
  await registrarLog(req.usuario, "evento_editado", `${titulo} (${b.data}, ${sala || "escola toda"})`);
  res.json({ ok: true });
}));

app.delete("/api/eventos/:id", autenticar, apenasAdmin, rota(async (req, res) => { // excluir: só a gestão
  const [[e]] = await db.query("SELECT id_evento AS id, eve_titulo AS titulo, eve_banner_arquivo AS arquivo, id_usuario AS criador FROM tb_eventos WHERE id_evento = ?", [req.params.id]);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  await db.query("DELETE FROM tb_eventos WHERE id_evento = ?", [e.id]);
  if (e.arquivo) fs.rmSync(path.join(PASTA_UPLOADS, path.basename(e.arquivo)), { force: true });
  await registrarLog(req.usuario, "evento_excluido", e.titulo);
  res.json({ ok: true });
}));

// A imagem do banner (criptografada no disco). Só para quem pode ver o evento.
app.get("/api/eventos/:id/banner", autenticar, rota(async (req, res) => {
  const f = await filtroEventos(req.usuario);
  const [[e]] = await db.query(`SELECT e.eve_banner_arquivo AS arquivo, e.eve_banner_mime AS mime FROM tb_eventos e WHERE e.id_evento = ? AND ${f.sql}`, [req.params.id, ...f.params]);
  if (!e || !e.arquivo) return res.status(404).json({ erro: "Banner não encontrado." });
  const nome = path.basename(e.arquivo), caminho = path.join(PASTA_UPLOADS, nome);
  if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "Arquivo do banner não encontrado." });
  let conteudo;
  try { conteudo = decifrarArquivo(fs.readFileSync(caminho), nome); }
  catch { return res.status(500).json({ erro: "Não foi possível abrir a imagem do banner. Envie a imagem de novo." }); }
  res.setHeader("Content-Type", e.mime);
  res.send(conteudo);
}));

// =====================================================================
// FASE 5 — câmeras e reconhecimento facial (SIMULADOS) e situação do aluno ao vivo
// =====================================================================
// Regras do reconhecimento facial (dado biométrico = dado pessoal sensível, LGPD art. 11):
//   1. só funciona se a gestão ligar o recurso;  2. só em câmeras de portão (entrada/saída);
//   3. só para turmas a partir do Pré (berçário e maternal ficam de fora);
//   4. só para alunos cujo responsável marcou "câmeras e reconhecimento facial" no Termo de Consentimento.
// Quem não cumpre as regras NÃO tem cadastro facial: a câmera não o identifica e a imagem é descartada.
// O sistema não guarda foto nem dado biométrico, só a passagem (horário, câmera e confiança).
const TURMAS_ANTES_DO_PRE = /bercario|maternal|creche/;
const RETENCAO_RECONHECIMENTOS_DIAS = 90;
// Logs de atividade guardam dados pessoais (quem fez o quê): apagados depois deste prazo (config.json → logs_anos). Backups: quantos manter (config.json → backup.manter).
const RETENCAO_LOGS_ANOS = Number((config.retencao || {}).logs_anos) || 2;
const BACKUPS_MANTER = Number((config.backup || {}).manter) || 14;
const PASTA_BACKUPS = backup.pastaDosBackups(config);
const LOCAIS_PROIBIDOS = /banheir|sanitari|vestiar|trocador|fraldari|chuveir|lavabo|\bwc\b/; // ECA, art. 17: nunca em espaços de intimidade

async function facialLigado() {
  const [[c]] = await db.query("SELECT cfg_valor AS valor FROM tb_configuracoes WHERE cfg_chave = 'reconhecimento_facial'");
  return !!c && c.valor === "ligado";
}
// Situação do cadastro facial de um aluno (calculada na hora: se o responsável revogar, deixa de valer no mesmo instante)
async function cadastroFacial(aluno, ligado) {
  if (!ligado) return { ok: false, motivo: "Reconhecimento facial desligado pela escola" };
  if (TURMAS_ANTES_DO_PRE.test(normalizar(aluno.sala))) return { ok: false, motivo: "Turma antes do Pré (sem reconhecimento facial)" };
  const c = await consentimentoDoAluno(aluno.id, false);
  if (c.status === "pendente") return { ok: false, motivo: "Termo de consentimento pendente" };
  if (!c.atual.monitoramento) return { ok: false, motivo: "Responsável não autorizou" };
  return { ok: true, motivo: "Autorizado pelo responsável" };
}
// Primeira entrada do dia também marca a presença (se o professor ainda não fez a chamada)
async function marcarPresencaPelaEntrada(alunoId, origem) {
  await db.query("INSERT IGNORE INTO tb_presencas (id_aluno, pre_data, pre_status, pre_observacao) VALUES (?, CURDATE(), 'Presente', CONCAT('Entrada ', DATE_FORMAT(NOW(), '%H:%i'), ' — ', ?))", [alunoId, origem]);
}

// Situação AO VIVO de hoje: na escola, saiu, ainda não chegou ou ausente. filtro: { alunoId } ou { sala } ou {} (todos)
async function statusAoVivo(filtro = {}) {
  const cond = filtro.alunoId ? "a.id_aluno = ?" : filtro.sala ? "a.alu_sala = ? AND a.alu_situacao = 'Ativo'" : "a.alu_situacao = 'Ativo'";
  const param = filtro.alunoId ? [filtro.alunoId] : filtro.sala ? [filtro.sala] : [];
  const [alunos] = await db.query(`SELECT a.id_aluno AS id, a.alu_nome AS nome, a.alu_sala AS sala, p.pre_status AS chamada FROM tb_alunos a
    LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.pre_data = CURDATE() WHERE ${cond} ORDER BY a.alu_nome`, param);
  if (!alunos.length) return [];
  const ids = alunos.map((a) => a.id);
  const [movs] = await db.query(`SELECT * FROM (
      SELECT 'Entrada' AS sentido, ac.id_aluno AS aluno_id, ac.ace_data_hora AS quando, ac.ace_metodo AS metodo, COALESCE(c.cam_nome, ac.ace_sala, 'Portaria') AS local, NULL AS por
      FROM tb_acessos ac LEFT JOIN tb_cameras c ON c.id_camera = ac.id_camera WHERE ac.ace_data_hora >= CURDATE() AND ac.id_aluno IN (?)
      UNION ALL
      SELECT 'Saída', s.id_aluno, s.sai_data_hora, s.sai_metodo, COALESCE(c.cam_nome, 'Secretaria'), s.sai_liberado_por_nome
      FROM tb_saidas s LEFT JOIN tb_cameras c ON c.id_camera = s.id_camera WHERE s.sai_data_hora >= CURDATE() AND s.id_aluno IN (?)
    ) m ORDER BY quando`, [ids, ids]);
  const hora = (d) => new Date(d).toTimeString().slice(0, 5);
  const comoFoi = (m) => m.metodo === "Facial" ? "reconhecimento facial" : m.metodo === "Liberação" ? `liberação na secretaria${m.por ? " por " + m.por : ""}` : "registro da portaria";
  return alunos.map((a) => {
    const meus = movs.filter((m) => m.aluno_id === a.id), ultimo = meus[meus.length - 1];
    let situacao, texto, detalhe = "";
    if (ultimo && ultimo.sentido === "Entrada") { situacao = "na_escola"; texto = `Na escola desde ${hora(ultimo.quando)}`; detalhe = `Entrada pelo ${ultimo.local} (${comoFoi(ultimo)})`; }
    else if (ultimo) { situacao = "saiu"; texto = `Saiu às ${hora(ultimo.quando)}`; detalhe = `Saída: ${ultimo.local} (${comoFoi(ultimo)})`; }
    else if (a.chamada === "Presente") { situacao = "na_escola"; texto = "Presente na chamada"; detalhe = "Sem registro de entrada no portão"; }
    else if (a.chamada === "Ausente") { situacao = "ausente"; texto = "Ausente hoje"; detalhe = "Falta registrada na chamada"; }
    else { situacao = "nao_chegou"; texto = "Ainda não chegou"; detalhe = "Nenhuma entrada registrada hoje"; }
    return { id: a.id, nome: a.nome, sala: a.sala, situacao, texto, detalhe,
      movimentos: meus.map((m) => ({ sentido: m.sentido, hora: hora(m.quando), local: m.local, como: comoFoi(m) })) };
  });
}
function resumoAoVivo(lista) {
  const r = { total: lista.length, na_escola: 0, saiu: 0, nao_chegou: 0, ausente: 0 };
  lista.forEach((s) => r[s.situacao]++);
  return r;
}

app.get("/api/alunos/:alunoId/agora", autenticar, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  res.json((await statusAoVivo({ alunoId: aluno.id }))[0]);
}));

// Painel de monitoramento (só gestão): câmeras, regra do reconhecimento facial, situação ao vivo e últimas passagens
app.get("/api/monitoramento", autenticar, apenasAdmin, rota(async (req, res) => {
  const ligado = await facialLigado();
  const [[cfg]] = await db.query("SELECT cfg_atualizado_por_nome AS por, DATE_FORMAT(cfg_atualizado_em, '%d/%m/%Y %H:%i') AS em FROM tb_configuracoes WHERE cfg_chave = 'reconhecimento_facial'");
  const [cameras] = await db.query(`SELECT c.id_camera AS id, c.cam_nome AS nome, c.cam_local AS local, c.cam_tipo AS tipo, c.cam_reconhecimento AS reconhecimento, c.cam_ativa AS ativa,
    (SELECT COUNT(*) FROM tb_reconhecimentos r WHERE r.id_camera = c.id_camera AND r.rec_data_hora >= CURDATE()) AS passagens_hoje FROM tb_cameras c ORDER BY c.id_camera`);
  const [eventos] = await db.query(`SELECT r.id_reconhecimento AS id, DATE_FORMAT(r.rec_data_hora, '%H:%i:%s') AS hora, r.rec_sentido AS sentido, r.rec_resultado AS resultado, r.rec_motivo AS motivo, r.rec_confianca AS confianca,
    c.cam_nome AS camera, a.alu_nome AS aluno, a.alu_sala AS sala FROM tb_reconhecimentos r JOIN tb_cameras c ON c.id_camera = r.id_camera LEFT JOIN tb_alunos a ON a.id_aluno = r.id_aluno
    WHERE r.rec_data_hora >= CURDATE() ORDER BY r.id_reconhecimento DESC LIMIT 20`);
  const aoVivo = await statusAoVivo();
  const alunos = [];
  for (const s of aoVivo) alunos.push({ ...s, facial: await cadastroFacial(s, ligado) });
  const [[hoje]] = await db.query("SELECT COUNT(CASE WHEN rec_resultado = 'Reconhecido' THEN 1 END) AS reconhecidos, COUNT(CASE WHEN rec_resultado <> 'Reconhecido' THEN 1 END) AS sem_cadastro FROM tb_reconhecimentos WHERE rec_data_hora >= CURDATE()");
  res.json({ facial: { ligado, alterado_por: cfg ? cfg.por : null, alterado_em: cfg ? cfg.em : null, retencao_dias: RETENCAO_RECONHECIMENTOS_DIAS },
    cameras: cameras.map((c) => ({ ...c, reconhecimento: !!c.reconhecimento, ativa: !!c.ativa })), eventos: eventos.map((e) => ({ ...e, confianca: e.confianca == null ? null : Number(e.confianca) })),
    resumo: { ...resumoAoVivo(aoVivo), reconhecidos_hoje: hoje.reconhecidos, sem_cadastro_hoje: hoje.sem_cadastro, com_cadastro_facial: alunos.filter((a) => a.facial.ok).length }, alunos });
}));

app.put("/api/configuracoes/reconhecimento-facial", autenticar, apenasAdmin, rota(async (req, res) => {
  const ligado = req.body.ligado === true;
  await db.query(`INSERT INTO tb_configuracoes (cfg_chave, cfg_valor, cfg_atualizado_por_nome, cfg_atualizado_em) VALUES ('reconhecimento_facial', ?, ?, NOW())
    ON DUPLICATE KEY UPDATE cfg_valor = VALUES(cfg_valor), cfg_atualizado_por_nome = VALUES(cfg_atualizado_por_nome), cfg_atualizado_em = NOW()`, [ligado ? "ligado" : "desligado", req.usuario.nome]);
  await registrarLog(req.usuario, ligado ? "facial_ligado" : "facial_desligado", null);
  res.json({ ok: true, ligado });
}));

app.post("/api/cameras", autenticar, apenasAdmin, rota(async (req, res) => {
  const nome = String(req.body.nome || "").trim(), local = String(req.body.local || "").trim(), tipo = req.body.tipo;
  if (nome.length < 2 || nome.length > 60) return res.status(400).json({ erro: "Dê um nome à câmera (até 60 caracteres)." });
  if (local.length < 2 || local.length > 60) return res.status(400).json({ erro: "Informe onde a câmera fica (até 60 caracteres)." });
  if (!["Entrada", "Saída", "Área comum"].includes(tipo)) return res.status(400).json({ erro: "Escolha o tipo da câmera." });
  if (LOCAIS_PROIBIDOS.test(normalizar(`${nome} ${local}`))) return res.status(400).json({ erro: "Câmeras não podem ficar em banheiros, vestiários, trocadores ou outros espaços de intimidade (ECA, art. 17, e política de privacidade da escola)." });
  const reconhecimento = req.body.reconhecimento === true;
  if (reconhecimento && tipo === "Área comum") return res.status(400).json({ erro: "O reconhecimento facial só é usado nos portões de entrada e de saída. Câmeras de área comum só gravam." });
  await db.query("INSERT INTO tb_cameras (cam_nome, cam_local, cam_tipo, cam_reconhecimento) VALUES (?, ?, ?, ?)", [nome, local, tipo, reconhecimento]);
  await registrarLog(req.usuario, "camera_cadastrada", `${nome} — ${local} (${tipo}${reconhecimento ? ", reconhecimento facial" : ""})`);
  res.status(201).json({ ok: true });
}));

app.put("/api/cameras/:id/ativa", autenticar, apenasAdmin, rota(async (req, res) => {
  const [r] = await db.query("UPDATE tb_cameras SET cam_ativa = ? WHERE id_camera = ?", [req.body.ativa === true, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Câmera não encontrada." });
  await registrarLog(req.usuario, req.body.ativa === true ? "camera_ligada" : "camera_desligada", `câmera id ${req.params.id}`);
  res.json({ ok: true });
}));

// SIMULAÇÃO de uma passagem diante de uma câmera com reconhecimento facial.
// aluno_id: quem "passou" (vazio = o sistema escolhe). desconhecido: true = um rosto que não é de aluno (visitante).
app.post("/api/reconhecimento/simular", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[cam]] = await db.query("SELECT id_camera AS id, cam_nome AS nome, cam_tipo AS tipo, cam_reconhecimento AS reconhecimento, cam_ativa AS ativa FROM tb_cameras WHERE id_camera = ?", [Number(req.body.cam_id)]);
  if (!cam) return res.status(404).json({ erro: "Câmera não encontrada." });
  if (!cam.ativa) return res.status(400).json({ erro: "Esta câmera está desligada." });
  if (!cam.reconhecimento) return res.status(400).json({ erro: "Esta câmera é de área comum: ela só grava, não faz reconhecimento facial." });
  const ligado = await facialLigado();
  if (!ligado) return res.status(409).json({ erro: "O reconhecimento facial está desligado. Ligue o recurso no topo da tela para simular." });
  const sentido = cam.tipo === "Saída" ? "Saída" : "Entrada";
  const registrar = (alunoId, resultado, motivo, confianca) => db.query("INSERT INTO tb_reconhecimentos (id_camera, id_aluno, rec_sentido, rec_resultado, rec_motivo, rec_confianca) VALUES (?, ?, ?, ?, ?, ?)",
    [cam.id, alunoId, sentido, resultado, motivo, confianca]);

  if (req.body.desconhecido === true) {
    await registrar(null, "Sem cadastro facial", "Rosto sem cadastro: imagem descartada", null);
    await registrarLog(req.usuario, "reconhecimento_simulado", `${cam.nome}: rosto sem cadastro`);
    return res.json({ resultado: "Sem cadastro facial", camera: cam.nome, sentido, mensagem: "Rosto sem cadastro facial (pode ser um visitante). A imagem foi descartada e nada foi identificado." });
  }
  let aluno;
  if (req.body.aluno_id) aluno = (await statusAoVivo({ alunoId: Number(req.body.aluno_id) }))[0];
  else { // escolhe alguém que faça sentido: na entrada, quem ainda não chegou; na saída, quem está na escola
    const candidatos = (await statusAoVivo()).filter((s) => sentido === "Entrada" ? s.situacao === "nao_chegou" : s.situacao === "na_escola");
    aluno = candidatos[Math.floor(Math.random() * candidatos.length)];
    if (!aluno) return res.status(400).json({ erro: sentido === "Entrada" ? "Todos os alunos já chegaram ou estão ausentes hoje" : "Nenhum aluno na escola para sair" });
  }
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const cad = await cadastroFacial(aluno, ligado);
  if (!cad.ok) { // sem cadastro facial: a câmera não reconhece ninguém, a imagem é descartada e o aluno NÃO é identificado no registro
    await registrar(null, "Sem cadastro facial", "Rosto sem cadastro: imagem descartada", null);
    await registrarLog(req.usuario, "reconhecimento_simulado", `${cam.nome}: rosto sem cadastro`);
    return res.json({ resultado: "Sem cadastro facial", camera: cam.nome, sentido, aluno: { id: aluno.id, nome: aluno.nome, sala: aluno.sala }, motivo: cad.motivo,
      mensagem: `Simulação: ${aluno.nome} passou pela câmera, mas não tem cadastro facial (${cad.motivo.charAt(0).toLowerCase() + cad.motivo.slice(1)}). A câmera não o identificou e a imagem foi descartada. Registre a ${sentido === "Entrada" ? "entrada" : "saída"} pela portaria.` });
  }
  const confianca = Math.round((92 + Math.random() * 7.6) * 10) / 10;
  await registrar(aluno.id, "Reconhecido", null, confianca);
  if (sentido === "Entrada") {
    await db.query("INSERT INTO tb_acessos (id_aluno, ace_sala, id_camera, ace_metodo) VALUES (?, ?, ?, 'Facial')", [aluno.id, cam.nome, cam.id]);
    await marcarPresencaPelaEntrada(aluno.id, "reconhecimento facial");
  } else await db.query("INSERT INTO tb_saidas (id_aluno, id_camera, sai_metodo) VALUES (?, ?, 'Facial')", [aluno.id, cam.id]);
  await registrarLog(req.usuario, "reconhecimento_simulado", `${cam.nome}: aluno id ${aluno.id} reconhecido (${String(confianca).replace(".", ",")}%)`);
  res.json({ resultado: "Reconhecido", camera: cam.nome, sentido, aluno: { id: aluno.id, nome: aluno.nome, sala: aluno.sala }, confianca,
    mensagem: `${aluno.nome} reconhecido(a) no ${cam.nome} com ${String(confianca).replace(".", ",")}% de confiança. ${sentido} registrada.` });
}));

// Saída registrada à mão pela portaria (aluno sem cadastro facial no portão de saída)
app.post("/api/saidas/manual", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT id_aluno AS id FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [[cam]] = await db.query("SELECT id_camera AS id, cam_nome AS nome FROM tb_cameras WHERE id_camera = ? AND cam_tipo = 'Saída'", [Number(req.body.cam_id) || 0]);
  await db.query("INSERT INTO tb_saidas (id_aluno, id_camera, sai_metodo, sai_liberado_por_nome) VALUES (?, ?, 'Manual', ?)", [aluno.id, cam ? cam.id : null, req.usuario.nome]);
  await registrarLog(req.usuario, "saida_manual", `aluno id ${aluno.id}${cam ? " — " + cam.nome : ""}`);
  res.status(201).json({ ok: true });
}));

// Rotina de 1 em 1 hora (e ao ligar o servidor): inativa professores parados há 60 dias e apaga passagens antigas das câmeras
async function rotinaPeriodica() {
  await verificarInatividade();
  const [r] = await db.query("DELETE FROM tb_reconhecimentos WHERE rec_data_hora < DATE_SUB(NOW(), INTERVAL ? DAY)", [RETENCAO_RECONHECIMENTOS_DIAS]);
  if (r.affectedRows) await registrarLog(SISTEMA, "reconhecimentos_apagados", `${r.affectedRows} registro(s) com mais de ${RETENCAO_RECONHECIMENTOS_DIAS} dias`);
  const [l] = await db.query("DELETE FROM tb_logs WHERE log_data_hora < DATE_SUB(NOW(), INTERVAL ? YEAR)", [RETENCAO_LOGS_ANOS]);
  if (l.affectedRows) await registrarLog(SISTEMA, "logs_apagados", `${l.affectedRows} registro(s) com mais de ${RETENCAO_LOGS_ANOS} ano(s)`);
  // Um backup por dia (banco + uploads/), na primeira volta da rotina do dia
  if (!backup.temBackupDeHoje(PASTA_BACKUPS)) {
    try {
      const pasta = await backup.gerarBackup(db, { pastaUploads: PASTA_UPLOADS, manter: BACKUPS_MANTER, chave: CHAVE_ARQUIVOS, pasta: PASTA_BACKUPS });
      await registrarLog(SISTEMA, "backup_feito", path.basename(pasta));
    } catch (erro) {
      console.error("Falha no backup automático:", erro.message);
      await registrarLog(SISTEMA, "backup_falhou", erro.message.slice(0, 200));
    }
  }
}

// =====================================================================
// AVISOS (sino no topo) — melhorias de experiência do usuário, 02/11/2026
// =====================================================================
// O responsável não precisa "procurar" novidades: o sino mostra o que aconteceu com o filho e o que espera por ele.
// Nada novo é guardado: os avisos são montados na hora a partir do que já existe (entradas, saídas, autorizações, comunicados,
// ocorrências, pendências e eventos). Só se guarda QUANDO a pessoa abriu o sino pela última vez (usu_avisos_vistos_em), para contar os novos.
const AVISOS_DIAS = 14; // até quantos dias para trás os avisos informativos aparecem
app.get("/api/avisos", autenticar, apenasPai, rota(async (req, res) => {
  const filhos = req.usuario.filhos;
  if (!filhos.length) return res.json({ novos: 0, itens: [] });
  const [[u]] = await db.query("SELECT usu_avisos_vistos_em AS vistos FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const [alunos] = await db.query("SELECT id_aluno AS id, alu_nome AS nome, alu_sala AS sala FROM tb_alunos WHERE id_aluno IN (?)", [filhos]);
  const primeiro = new Map(alunos.map((a) => [a.id, a.nome.split(" ")[0]]));
  const salas = [...new Set(alunos.map((a) => a.sala))];
  const itens = [];
  const add = (x) => itens.push({ ...x, quando: x.quando instanceof Date ? x.quando.toISOString() : x.quando });
  // Entradas e saídas (últimos 3 dias)
  const [movs] = await db.query(`SELECT * FROM (
      SELECT 'Entrada' AS sentido, ac.id_aluno AS aluno_id, ac.ace_data_hora AS quando, ac.ace_metodo AS metodo, COALESCE(c.cam_nome, ac.ace_sala, 'Portaria') AS local
      FROM tb_acessos ac LEFT JOIN tb_cameras c ON c.id_camera = ac.id_camera WHERE ac.id_aluno IN (?) AND ac.ace_data_hora >= CURDATE() - INTERVAL 2 DAY
      UNION ALL
      SELECT 'Saída', s.id_aluno, s.sai_data_hora, s.sai_metodo, COALESCE(c.cam_nome, 'Secretaria')
      FROM tb_saidas s LEFT JOIN tb_cameras c ON c.id_camera = s.id_camera WHERE s.id_aluno IN (?) AND s.sai_data_hora >= CURDATE() - INTERVAL 2 DAY) m
    ORDER BY quando DESC LIMIT 20`, [filhos, filhos]);
  for (const m of movs) {
    const hora = new Date(m.quando).toTimeString().slice(0, 5);
    add({ tipo: m.sentido === "Entrada" ? "entrada" : "saida", aluno_id: m.aluno_id, quando: m.quando,
      titulo: `${primeiro.get(m.aluno_id)} ${m.sentido === "Entrada" ? "entrou na escola" : "saiu da escola"} às ${hora}`,
      texto: `${m.local}${m.metodo === "Facial" ? " • reconhecimento facial" : m.metodo === "Liberação" ? " • liberação na secretaria" : " • portaria"}`, destino: { tela: "pais" } });
  }
  // Autorizações esperando a assinatura (dentro do prazo)
  const [auts] = await db.query(`SELECT id_autorizacao AS id, id_aluno AS aluno_id, aut_titulo AS titulo, aut_criada_em AS quando, DATE_FORMAT(aut_valida_ate, '%d/%m') AS ate,
    DATEDIFF(aut_valida_ate, CURDATE()) AS dias FROM tb_autorizacoes WHERE id_aluno IN (?) AND aut_assinada = FALSE AND (aut_valida_ate IS NULL OR aut_valida_ate >= CURDATE())`, [filhos]);
  for (const a of auts) add({ tipo: "autorizacao", acao: true, aluno_id: a.aluno_id, quando: a.quando, titulo: `Autorização para assinar: ${a.titulo}`,
    texto: `${primeiro.get(a.aluno_id)}${a.ate ? ` • assine até ${a.ate}${a.dias === 0 ? " (hoje!)" : a.dias === 1 ? " (amanhã)" : ""}` : ""}`, destino: { tela: "pais", aba: "autorizacoes" } });
  // Comunicados não lidos
  const [coms] = await db.query(`SELECT c.id_comunicado AS id, c.com_titulo AS titulo, c.com_criado_em AS quando, a.id_aluno AS aluno_id
    FROM tb_comunicados c JOIN tb_alunos a ON a.id_aluno IN (?) AND (c.com_sala IS NULL OR c.com_sala = a.alu_sala)
    LEFT JOIN tb_comunicado_leituras l ON l.id_comunicado = c.id_comunicado AND l.id_aluno = a.id_aluno
    WHERE l.id_comunicado IS NULL AND c.com_criado_em >= NOW() - INTERVAL ? DAY ORDER BY c.id_comunicado DESC`, [filhos, AVISOS_DIAS]);
  const vistosCom = new Set();
  for (const c of coms) { if (vistosCom.has(c.id)) continue; vistosCom.add(c.id);
    add({ tipo: "comunicado", acao: true, aluno_id: c.aluno_id, quando: c.quando, titulo: `Novo comunicado: ${c.titulo}`, texto: "Abra para ler", destino: { tela: "pais", aba: "comunicados" } }); }
  // Ocorrências esperando a ciência do responsável
  const [ocs] = await db.query(`SELECT id_ocorrencia AS id, id_aluno AS aluno_id, oce_assinada_em AS quando, oce_professor_nome AS professor FROM tb_ocorrencias_escolares
    WHERE id_aluno IN (?) AND oce_resp_assinada_em IS NULL ORDER BY id_ocorrencia DESC`, [filhos]);
  for (const o of ocs) add({ tipo: "ocorrencia", acao: true, aluno_id: o.aluno_id, quando: o.quando, titulo: `Ocorrência registrada com ${primeiro.get(o.aluno_id)}`,
    texto: `Docente: ${o.professor} • leia e assine que tomou ciência`, destino: { tela: "ocorrencias" } });
  // Documentos que a escola pediu
  const [pens] = await db.query(`SELECT pen_id AS id, id_aluno AS aluno_id, pen_descricao AS descricao, pen_criada_em AS quando FROM tb_pendencias
    WHERE id_aluno IN (?) AND pen_status = 'Aberta' AND pen_tipo = 'Documento'`, [filhos]);
  for (const p of pens) add({ tipo: "pendencia", acao: true, aluno_id: p.aluno_id, quando: p.quando, titulo: `A escola pediu um documento`, texto: `${p.descricao} • ${primeiro.get(p.aluno_id)}`, destino: { tela: "pais", aba: "documentos" } });
  // Eventos nos próximos 3 dias
  const [evs] = await db.query(`SELECT id_evento AS id, eve_titulo AS titulo, DATE_FORMAT(eve_data, '%d/%m') AS dia, TIME_FORMAT(eve_hora, '%H:%i') AS hora, eve_criado_em AS quando, DATEDIFF(eve_data, CURDATE()) AS dias
    FROM tb_eventos WHERE eve_data BETWEEN CURDATE() AND CURDATE() + INTERVAL 3 DAY AND (eve_sala IS NULL OR eve_sala IN (?)) ORDER BY eve_data`, [salas]);
  for (const e of evs) add({ tipo: "evento", aluno_id: null, quando: e.quando, titulo: `${e.dias === 0 ? "Hoje" : e.dias === 1 ? "Amanhã" : "Em " + e.dias + " dias"}: ${e.titulo}`,
    texto: `${e.dia}${e.hora ? " às " + e.hora : ""}`, destino: { tela: "calendario" } });
  const vistos = u.vistos ? new Date(u.vistos).getTime() : 0;
  itens.forEach((i) => { i.novo = new Date(i.quando).getTime() > vistos; });
  // Primeiro o que pede uma ação; depois do mais recente para o mais antigo
  itens.sort((a, b) => (b.acao ? 1 : 0) - (a.acao ? 1 : 0) || new Date(b.quando) - new Date(a.quando));
  res.json({ novos: itens.filter((i) => i.novo).length, itens: itens.slice(0, 30) });
}));
app.post("/api/avisos/vistos", autenticar, apenasPai, rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET usu_avisos_vistos_em = NOW() WHERE id_usuario = ?", [req.usuario.id]);
  res.json({ ok: true });
}));

// Painel de Acessibilidade: as escolhas da própria pessoa. Só ela lê e grava, e nada disso vai para os logs (pode revelar uma condição de saúde).
const OPCOES_ACESSIBILIDADE = { texto: ["normal", "grande", "muito-grande"], contraste: ["padrao", "alto", "escuro"] };
const LIGA_DESLIGA_ACESSIBILIDADE = ["daltonismo", "fonte", "espaco", "links", "semMovimento", "voz"];
function limparAcessibilidade(dados) {
  const p = {};
  for (const [campo, opcoes] of Object.entries(OPCOES_ACESSIBILIDADE)) if (opcoes.includes(dados[campo])) p[campo] = dados[campo];
  for (const campo of LIGA_DESLIGA_ACESSIBILIDADE) if (dados[campo] === true) p[campo] = true;
  return p;
}
function lerAcessibilidade(texto) { try { return texto ? limparAcessibilidade(JSON.parse(texto)) : null; } catch { return null; } }
app.put("/api/acessibilidade", autenticar, rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET usu_acessibilidade = ? WHERE id_usuario = ?", [JSON.stringify(limparAcessibilidade(req.body || {})), req.usuario.id]);
  res.json({ ok: true });
}));

// Tutorial do primeiro acesso: a pessoa concluiu ou pulou, e ele não aparece mais sozinho (em nenhum aparelho)
app.post("/api/tutorial/visto", autenticar, rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET usu_tutorial_visto_em = NOW() WHERE id_usuario = ?", [req.usuario.id]);
  res.json({ ok: true });
}));

app.post("/api/aceite-privacidade", autenticar, rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET usu_aceite_em = NOW(), usu_aceite_versao = ? WHERE id_usuario = ?", [POLITICA.versao, req.usuario.id]);
  await registrarLog(req.usuario, "aceite_privacidade", `Política de privacidade versão ${POLITICA.versao}`);
  res.json({ ok: true });
}));

// Direito de acesso (LGPD, art. 18): entrega todos os dados do aluno em um arquivo. Admin, ou o responsável do próprio aluno.
app.get("/api/alunos/:alunoId/meus-dados", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const id = Number(req.params.alunoId);
  const [[aluno]] = await db.query("SELECT id_aluno AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM tb_alunos WHERE id_aluno = ?", [id]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [responsaveis] = await db.query("SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?", [id]);
  const [presencas] = await db.query("SELECT DATE_FORMAT(pre_data, '%Y-%m-%d') AS data, pre_status AS status, pre_observacao AS observacao FROM tb_presencas WHERE id_aluno = ? ORDER BY pre_data", [id]);
  const [advertencias] = await db.query("SELECT adv_tipo AS tipo, adv_descricao AS descricao, DATE_FORMAT(adv_data, '%Y-%m-%d') AS data, adv_registrada_por_nome AS registrada_por FROM tb_advertencias WHERE id_aluno = ? ORDER BY adv_data", [id]);
  const [ocorrenciasEscolares] = await db.query("SELECT DATE_FORMAT(oce_data, '%Y-%m-%d') AS data, TIME_FORMAT(oce_horario, '%H:%i') AS horario, oce_descricao AS descricao, oce_buscado_por AS buscado_por, oce_professor_nome AS professor, oce_resp_nome AS ciencia_responsavel, DATE_FORMAT(oce_resp_assinada_em, '%Y-%m-%d %H:%i') AS ciencia_em FROM tb_ocorrencias_escolares WHERE id_aluno = ? ORDER BY oce_data", [id]);
  const [pendencias] = await db.query("SELECT pen_tipo AS tipo, pen_descricao AS descricao, pen_status AS status, DATE_FORMAT(pen_criada_em, '%Y-%m-%d %H:%i') AS criada_em FROM tb_pendencias WHERE id_aluno = ? ORDER BY pen_id", [id]);
  const [autorizacoes] = await db.query("SELECT aut_titulo AS titulo, aut_validade AS validade, DATE_FORMAT(aut_valida_ate, '%Y-%m-%d') AS valida_ate, aut_assinada AS assinada, aut_assinada_nome AS assinada_por, DATE_FORMAT(aut_assinada_em, '%Y-%m-%d %H:%i') AS assinada_em, aut_codigo AS codigo FROM tb_autorizacoes WHERE id_aluno = ? ORDER BY id_autorizacao", [id]);
  const [comunicadosLidos] = await db.query("SELECT c.com_titulo AS titulo, DATE_FORMAT(l.col_lido_em, '%Y-%m-%d %H:%i') AS lido_em FROM tb_comunicado_leituras l JOIN tb_comunicados c ON c.id_comunicado = l.id_comunicado WHERE l.id_aluno = ? ORDER BY l.col_lido_em", [id]);
  const [documentos] = await db.query("SELECT doc_categoria AS categoria, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_tamanho AS tamanho_bytes, doc_enviado_por_nome AS enviado_por, DATE_FORMAT(doc_enviado_em, '%Y-%m-%d') AS enviado_em FROM tb_documentos WHERE id_aluno = ? ORDER BY doc_id", [id]);
  const [entradas] = await db.query("SELECT DATE_FORMAT(ace_data_hora, '%Y-%m-%d %H:%i:%s') AS quando, ace_sala AS local, ace_metodo AS metodo FROM tb_acessos WHERE id_aluno = ? ORDER BY ace_data_hora", [id]);
  const [saidas] = await db.query("SELECT DATE_FORMAT(sai_data_hora, '%Y-%m-%d %H:%i:%s') AS quando, sai_metodo AS metodo, sai_liberado_por_nome AS liberado_por FROM tb_saidas WHERE id_aluno = ? ORDER BY sai_data_hora", [id]);
  const [reconhecimentos] = await db.query("SELECT DATE_FORMAT(r.rec_data_hora, '%Y-%m-%d %H:%i:%s') AS quando, c.cam_nome AS camera, r.rec_sentido AS sentido, r.rec_confianca AS confianca FROM tb_reconhecimentos r JOIN tb_cameras c ON c.id_camera = r.id_camera WHERE r.id_aluno = ? ORDER BY r.rec_data_hora", [id]);
  await registrarLog(req.usuario, "exportacao_dados_aluno", `${aluno.nome} — aluno id ${id}`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="dados-aluno-${id}.json"`);
  res.send(JSON.stringify({ gerado_em: new Date().toISOString(), base: "LGPD, art. 18 — direito de acesso aos dados",
    aluno, responsaveis, presencas, advertencias, ocorrencias_do_professor: ocorrenciasEscolares, pendencias, autorizacoes, comunicados_lidos: comunicadosLidos,
    documentos_anexados: documentos, consentimentos: (await consentimentoDoAluno(id, true)).historico,
    entradas, saidas, reconhecimento_facial: { passagens: reconhecimentos, observacao: "O sistema não guarda fotos nem dados biométricos: só o horário, a câmera e o grau de confiança de cada reconhecimento. Os registros são apagados depois de " + RETENCAO_RECONHECIMENTOS_DIAS + " dias." },
    observacao: "Os arquivos dos documentos não vão neste arquivo; peça à gestão da escola se precisar deles. Registros sigilosos de proteção da criança (comunicações ao Conselho Tutelar, ECA arts. 13 e 56) não fazem parte deste arquivo." }, null, 2));
}));

// HTTPS: com "https": { "certificado": "caminho/cert.pem", "chave": "caminho/chave.pem" } no config.json, o sistema já sobe em HTTPS.
// Na publicação, o mais comum é o HTTPS ficar no Nginx, na frente do sistema; aí use "seguranca": { "atras_de_proxy": true }.
const httpsCfg = config.https || {};
const protocolo = httpsCfg.certificado && httpsCfg.chave ? "https" : "http";
const servidor = protocolo === "https"
  ? require("https").createServer({ cert: fs.readFileSync(httpsCfg.certificado), key: fs.readFileSync(httpsCfg.chave) }, app)
  : app;
servidor.listen(config.porta, async () => {
  console.log(`S.I.V.E. rodando em ${protocolo}://localhost:${config.porta}`);
  if (emailSimulado) console.log("✉️  E-mail em modo SIMULADO: os links de recuperação de senha e os códigos de verificação aparecem só aqui no terminal.");
  if (telefoneSimulado) console.log("📱 SMS e WhatsApp em modo SIMULADO: os códigos de verificação aparecem só aqui no terminal.");
  else if (!(config.email || {}).url_base) console.log('⚠️  Preencha "url_base" em "email" no config.json: sem ele, os links de recuperação apontam para localhost.');
  // Dados pessoais e chaves em pasta sincronizada com a nuvem (OneDrive, Google Drive, Dropbox): avisa
  if (/onedrive|google drive|dropbox|icloud/i.test(__dirname + "|" + PASTA_BACKUPS)) {
    console.log("\n⚠️  ATENÇÃO: o sistema ou a pasta de backups está numa pasta sincronizada com a nuvem (ex.: OneDrive).");
    console.log("   O config.json (chaves), os documentos e os backups vão para a nuvem juntos. Mova o projeto para fora dela");
    console.log('   (ex.: C:\\SIVE) ou, pelo menos, aponte os backups para outra pasta no config.json: "backup": { "pasta": "D:\\\\backups-sive" }\n');
  }
  try { protegerArquivosAntigos(); } catch (erro) { console.log("⚠️  Não foi possível criptografar arquivos antigos: " + erro.message); }
  // Confere se o banco está na versão atual (evita erros de "Unknown column / table" nas telas)
  try {
    const [colunas] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'usu_inativado_motivo'");
    const [tabelas] = await db.query("SHOW TABLES LIKE 'tb_reconhecimentos'");
    const [pedidoSenha] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'usu_senha_pedida_em'");
    if (!pedidoSenha.length) console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql (banco db_sive) no MySQL e reinicie o servidor.\n");
    const [emailConta] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'usu_email'");
    if (!emailConta.length) console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql (banco db_sive) no MySQL e reinicie o servidor.\n");
    const [metodo2fa] = await db.query("SHOW COLUMNS FROM tb_usuarios LIKE 'usu_2fa_metodo'");
    if (!metodo2fa.length) console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql (banco db_sive) no MySQL e reinicie o servidor.\n");
    if (!colunas.length || !tabelas.length) {
      console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql no MySQL de novo e reinicie o servidor.\n");
    } else {
      await rotinaPeriodica();
      setInterval(() => rotinaPeriodica().catch((e) => console.error(e.message)), 60 * 60 * 1000); // a cada 1 hora
    }
  } catch (erro) {
    console.log("\n⚠️  Não foi possível ler o banco: " + erro.message + "\n   Confira o config.json e se o MySQL está ligado.\n");
  }
});
