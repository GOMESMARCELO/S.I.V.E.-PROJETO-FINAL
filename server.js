// Servidor do S.I.V.E. — Node.js + Express + MySQL
const express = require("express");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const util = require("util");
const importador = require("./importar-alunos");
const config = require("./config.json");

// ---------- Chaves de segurança, geradas sozinhas na primeira execução ----------
// chave_arquivos: criptografa os documentos no disco. segredo_token: assina o login, para ninguém conseguir forjá-lo.
// As duas ficam no config.json (que não vai para o Git). FAÇA BACKUP desse arquivo: sem a chave, os documentos não abrem mais.
config.seguranca = config.seguranca || {};
let gerouChaves = false;
for (const nome of ["chave_arquivos", "segredo_token"]) {
  if (!/^[0-9a-f]{64}$/.test(config.seguranca[nome] || "")) { config.seguranca[nome] = crypto.randomBytes(32).toString("hex"); gerouChaves = true; }
}
if (gerouChaves) {
  fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(config, null, 2) + "\n");
  console.log("🔐 Chaves de segurança criadas no config.json. Faça backup desse arquivo junto com a pasta uploads/.");
}

const app = express();
const db = mysql.createPool(config.banco);

// Cabeçalhos de segurança em todas as respostas (a API nunca fica em cache do navegador)
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json({ limit: "9mb" })); // 9 MB: cabe um arquivo de 5 MB enviado em base64

// Só estas pastas são públicas. config.json (senha do banco), server.js, database/ e uploads/ NÃO são entregues.
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

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
  catch (erro) { console.error(erro.message); res.status(500).json({ erro: "Erro no servidor: " + erro.message }); }
};

// Grava uma linha no log de atividades (quem fez o quê, e quando)
async function registrarLog(usuario, acao, detalhe) {
  await db.query("INSERT INTO logs (usu_id, log_nome_usuario, log_papel, log_acao, log_detalhe) VALUES (?, ?, ?, ?, ?)",
    [usuario ? usuario.id : null, usuario ? usuario.nome : "Desconhecido", usuario ? usuario.papel : "-", acao, detalhe || null]);
}
// Gera uma senha genérica simples, de 6 dígitos, para o admin entregar ao usuário novo
const gerarSenhaGenerica = () => String(Math.floor(100000 + Math.random() * 900000));
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
  const corpo = Buffer.from(JSON.stringify({ id: usuario.id, exp: Date.now() + TOKEN_HORAS * 3600 * 1000 })).toString("base64url");
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

// Bloqueio temporário: 5 erros seguidos de senha bloqueiam aquele usuário (naquele computador) por 5 minutos
const tentativas = new Map(), MAX_TENTATIVAS = 5, BLOQUEIO_MS = 5 * 60 * 1000;
function minutosBloqueado(chave) {
  const t = tentativas.get(chave);
  if (!t || !t.ate) return 0;
  if (t.ate <= Date.now()) { tentativas.delete(chave); return 0; }
  return Math.ceil((t.ate - Date.now()) / 60000);
}
function registrarFalha(chave) {
  const t = tentativas.get(chave) || { n: 0 };
  t.n++;
  if (t.n >= MAX_TENTATIVAS) { t.ate = Date.now() + BLOQUEIO_MS; t.n = 0; }
  tentativas.set(chave, t);
}

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
  versao: "1.1", atualizada_em: "15/10/2026",
  secoes: [
    { titulo: "1. Quem cuida dos seus dados", paragrafos: [`O controlador dos dados é ${escola.nome}.`,
      `Encarregado pelo tratamento de dados pessoais (art. 41 da LGPD): ${escola.encarregado_nome} — ${escola.encarregado_email}.`] },
    { titulo: "2. Quais dados são tratados", itens: [
      "Do aluno: nome, turma, matrícula, frequência, ocorrências, pendências e documentos anexados (que podem incluir dados de saúde e de identificação).",
      "Do responsável: nome, telefone, foto, usuário de acesso e senha (guardada de forma protegida).",
      "De quem usa o sistema: registros de acesso e das ações realizadas (quem fez o quê e quando)."] },
    { titulo: "3. Para que usamos", paragrafos: ["Gestão escolar, acompanhamento da frequência (incluindo a Busca Ativa de alunos com muitas faltas), comunicação com as famílias, autorizações e segurança dos alunos. Os dados não são usados para publicidade e este sistema não os compartilha com terceiros."] },
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
      "Os documentos são guardados criptografados (AES-256-GCM) e fora das pastas públicas do site.",
      "Cada perfil acessa só o que precisa: a gestão vê todos os alunos, o professor vê a sua turma e o responsável vê apenas o seu filho.",
      "Envios, downloads e exclusões de documentos ficam registrados (quem, o quê e quando), inclusive as tentativas de acesso negadas.",
      "As senhas são guardadas com hash, o login é assinado e expira, e há bloqueio temporário após várias tentativas erradas.",
      "O sistema confere o formato e o tamanho dos arquivos enviados (PDF, PNG, JPG, DOC e DOCX, até 5 MB)."] },
    { titulo: "7. Por quanto tempo guardamos", paragrafos: [`Os dados ficam guardados enquanto o aluno estiver matriculado e, depois, pelo prazo exigido pela legislação ou definido pela escola: ${escola.prazo_retencao}. A gestão pode excluir documentos que não forem mais necessários.`] },
    { titulo: "8. Seus direitos (art. 18 da LGPD)", paragrafos: [
      "Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento e revogação do consentimento.",
      "Para acessar os dados do aluno, use o botão \"Baixar os dados do aluno\" na ficha dele. Os demais pedidos devem ser feitos ao encarregado, pelo contato do item 1."] },
    { titulo: "9. Incidentes de segurança", paragrafos: ["Se houver um incidente de segurança que possa causar risco ou dano relevante, a escola comunica a ANPD e as pessoas afetadas (art. 48 da LGPD)."] },
    { titulo: "10. Para quem trabalha na escola", paragrafos: ["Os dados a que você tem acesso são confidenciais: use-os somente para a sua função, não compartilhe sua senha e lembre que os acessos ficam registrados."] },
  ],
};

app.get("/api/privacidade", (req, res) => res.json(POLITICA)); // pública: a política pode ser lida antes do login

app.post("/api/login", rota(async (req, res) => {
  const { usuario, senha } = req.body;
  const chave = `${req.ip}|${String(usuario || "").toLowerCase()}`;
  const minutos = minutosBloqueado(chave);
  if (minutos) {
    await registrarLog(null, "login_bloqueado", `Usuário "${usuario}" bloqueado por tentativas erradas`);
    return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} minuto(s).` });
  }
  const [linhas] = await db.query("SELECT usu_id AS id, usu_papel AS papel, alu_id AS aluno_id, usu_sala AS sala, usu_nome AS nome, usu_senha_temporaria AS senha_temporaria, usu_senha AS senha, usu_aceite_versao AS aceite_versao FROM usuarios WHERE usu_usuario = ? AND usu_ativo = TRUE", [String(usuario || "")]);
  const u = linhas[0];
  const senhaOk = await conferirSenha(senha, u ? u.senha : HASH_FALSO);
  if (!u || !senhaOk) {
    registrarFalha(chave);
    await registrarLog(null, "login_falha", `Tentativa com usuário "${usuario}"`);
    return res.status(401).json({ erro: "Usuário ou senha inválidos, ou cadastro inativo" });
  }
  tentativas.delete(chave);
  if (!u.senha.startsWith("scrypt$")) await db.query("UPDATE usuarios SET usu_senha = ? WHERE usu_id = ?", [await hashSenha(senha), u.id]);
  await db.query("UPDATE usuarios SET usu_ultimo_acesso = NOW() WHERE usu_id = ?", [u.id]);
  await registrarLog(u, "login_sucesso", null);
  res.json({ token: gerarToken(u), papel: u.papel, nome: u.nome, aluno_id: u.aluno_id, sala: u.sala,
    senha_temporaria: !!u.senha_temporaria, aceite_ok: u.aceite_versao === POLITICA.versao });
}));

// Lê o token, confere no banco se o usuário continua ativo e diz quem está fazendo a requisição.
// Quem ainda não aceitou a política de privacidade só consegue trocar a senha e aceitar o termo.
const ROTAS_SEM_ACEITE = new Set(["PUT /api/minha-senha", "POST /api/aceite-privacidade"]);
async function autenticar(req, res, next) {
  let dados;
  try { dados = lerToken((req.headers.authorization || "").replace("Bearer ", "")); }
  catch { return res.status(401).json({ erro: "Não autenticado" }); }
  try {
    const [[u]] = await db.query("SELECT usu_id AS id, usu_papel AS papel, alu_id AS aluno_id, usu_sala AS sala, usu_nome AS nome, usu_aceite_versao AS aceite_versao FROM usuarios WHERE usu_id = ? AND usu_ativo = TRUE", [dados.id]);
    if (!u) return res.status(401).json({ erro: "Não autenticado" });
    req.usuario = { id: u.id, papel: u.papel, aluno_id: u.aluno_id, sala: u.sala, nome: u.nome };
    if (u.aceite_versao !== POLITICA.versao && !ROTAS_SEM_ACEITE.has(`${req.method} ${req.path}`))
      return res.status(403).json({ erro: "Leia e aceite a política de privacidade para continuar", codigo: "ACEITE_PENDENTE" });
    next();
  } catch (erro) { console.error(erro); res.status(500).json({ erro: "Erro interno do servidor" }); }
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
  if (typeof senha_nova !== "string" || senha_nova.length < 4) return res.status(400).json({ erro: "A nova senha precisa ter pelo menos 4 caracteres" });
  const [[u]] = await db.query("SELECT usu_senha AS senha FROM usuarios WHERE usu_id = ?", [req.usuario.id]);
  if (!u || !(await conferirSenha(senha_atual, u.senha))) return res.status(400).json({ erro: "Senha atual incorreta" });
  await db.query("UPDATE usuarios SET usu_senha = ?, usu_senha_temporaria = FALSE WHERE usu_id = ?", [await hashSenha(senha_nova), req.usuario.id]);
  await registrarLog(req.usuario, "troca_senha", null);
  res.json({ ok: true });
}));

// ---------- Busca Ativa: o sistema conta as faltas e abre os casos sozinho ----------
async function executarSincronizacao() {
  const [novos] = await db.query(`SELECT p.alu_id AS aluno_id, COUNT(*) AS faltas FROM presencas p
    WHERE p.pre_status = 'Ausente' AND p.pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND p.pre_data <= CURDATE()
      AND p.pre_data > COALESCE((SELECT DATE(MAX(b.bua_encerrada_em)) FROM busca_ativa b WHERE b.alu_id = p.alu_id), '1900-01-01')
      AND p.alu_id NOT IN (SELECT alu_id FROM busca_ativa WHERE bua_status = 'Em acompanhamento')
    GROUP BY p.alu_id HAVING COUNT(*) >= ?`, [BUSCA_ATIVA.dias, BUSCA_ATIVA.faltas]);
  for (const n of novos) {
    const [r] = await db.query("INSERT INTO busca_ativa (alu_id, bua_faltas_ao_abrir) VALUES (?, ?)", [n.aluno_id, n.faltas]);
    await db.query("INSERT INTO busca_ativa_registros (bua_id, bar_usuario_id, bar_nome_usuario, bar_texto) VALUES (?, NULL, 'Sistema', ?)",
      [r.insertId, `Caso aberto automaticamente: ${n.faltas} faltas nos últimos ${BUSCA_ATIVA.dias} dias.`]);
    const [[a]] = await db.query("SELECT alu_nome AS nome FROM alunos WHERE alu_id = ?", [n.aluno_id]);
    await registrarLog(SISTEMA, "busca_ativa_aberta", `${a.nome} (${n.faltas} faltas)`);
  }
}
// Fila simples: evita que duas telas abram o mesmo caso duas vezes ao mesmo tempo
let filaSync = Promise.resolve();
const sincronizarBuscaAtiva = () => (filaSync = filaSync.catch(() => {}).then(executarSincronizacao));

// Último dia que tem chamada registrada (ou hoje) — usado nos quadros quando hoje é fim de semana
async function dataReferencia() {
  const [[r]] = await db.query(`SELECT DATE_FORMAT(MAX(pre_data), '%Y-%m-%d') AS ultimo, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje
    FROM presencas WHERE pre_data <= CURDATE()`);
  return { data: r.ultimo || r.hoje, hoje: r.hoje };
}
const percentual = (presentes, ausentes) => (presentes + ausentes) ? Math.round(presentes * 1000 / (presentes + ausentes)) / 10 : null;

// ---------- Quadros indicadores da Secretaria (só administração) ----------
app.get("/api/resumo", autenticar, apenasAdmin, rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  const ref = await dataReferencia();
  const [[total]] = await db.query("SELECT COUNT(*) AS n FROM alunos");
  const [[dia]] = await db.query(`SELECT COUNT(CASE WHEN pre_status = 'Presente' THEN 1 END) AS presentes,
    COUNT(CASE WHEN pre_status = 'Ausente' THEN 1 END) AS ausentes FROM presencas WHERE pre_data = ?`, [ref.data]);
  const [[busca]] = await db.query("SELECT COUNT(*) AS n FROM busca_ativa WHERE bua_status = 'Em acompanhamento'");
  const [[aut]] = await db.query("SELECT COUNT(*) AS n FROM autorizacoes WHERE aut_assinada = FALSE");
  const [[docs]] = await db.query("SELECT COUNT(*) AS n FROM pendencias WHERE pen_status = 'Aberta' AND pen_tipo = 'Documento'");
  const [[ctp]] = await db.query("SELECT COUNT(*) AS n FROM comunicacoes_conselho WHERE cct_comunicado_em IS NULL");
  res.json({
    data: ref.data, eh_hoje: ref.data === ref.hoje, total_alunos: total.n,
    presentes: dia.presentes, ausentes: dia.ausentes, sem_registro: Math.max(0, total.n - dia.presentes - dia.ausentes),
    percentual: percentual(dia.presentes, dia.ausentes), busca_ativa: busca.n, autorizacoes_pendentes: aut.n, documentos_aguardando: docs.n, comunicacoes_pendentes: ctp.n,
  });
}));

// ---------- Secretaria (só administração) ----------
app.get("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query("SELECT alu_id AS id, alu_nome AS nome, alu_sala AS sala FROM alunos ORDER BY alu_id");
  res.json(linhas);
}));

// Cadastro completo de um aluno: dados da criança + responsáveis (pai/mãe/etc.)
app.post("/api/alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const { nome, sala, matricula, responsaveis } = req.body;
  if (!nome || !sala) return res.status(400).json({ erro: "Nome e sala são obrigatórios" });
  let resultado;
  try { [resultado] = await db.query("INSERT INTO alunos (alu_nome, alu_sala, alu_matricula) VALUES (?, ?, ?)", [nome, sala, matricula || null]); }
  catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe um aluno com essa matrícula" });
    throw erro;
  }
  const alunoId = resultado.insertId;
  for (const r of responsaveis || []) {
    if (!r.nome) continue;
    const [[existe]] = await db.query("SELECT res_id AS id FROM responsaveis WHERE res_nome = ? AND res_telefone <=> ?", [r.nome, r.telefone || null]);
    const responsavelId = existe ? existe.id : (await db.query("INSERT INTO responsaveis (res_nome, res_telefone) VALUES (?, ?)", [r.nome, r.telefone || null]))[0].insertId;
    await db.query("INSERT INTO aluno_responsavel (alu_id, res_id, alr_parentesco) VALUES (?, ?, ?)", [alunoId, responsavelId, r.parentesco || "Responsável"]);
  }
  await registrarLog(req.usuario, "cadastro_aluno", `${nome} (${sala})`);
  res.status(201).json({ ok: true, id: alunoId });
}));

// ---------- Importar vários alunos de uma planilha (CSV ou Excel) — só administração ----------
// Dois passos na mesma rota: confirmar = false só CONFERE a planilha e devolve a pré-visualização; confirmar = true grava.
// Só entram as linhas "ok". Erros e duplicados ficam de fora. A gravação é tudo ou nada (transação).
app.post("/api/alunos/importar", autenticar, apenasAdmin, rota(async (req, res) => {
  const { nome_arquivo, conteudo, turma_padrao, confirmar } = req.body;
  if (typeof conteudo !== "string") return res.status(400).json({ erro: "Escolha um arquivo para importar" });
  const buffer = Buffer.from(conteudo, "base64");
  if (buffer.length > importador.TAMANHO_MAXIMO) return res.status(400).json({ erro: "O arquivo tem mais de 2 MB. Divida a planilha em partes." });
  let analise;
  try { analise = importador.analisar(await importador.lerPlanilha(buffer), { turmaPadrao: typeof turma_padrao === "string" ? turma_padrao : "" }); }
  catch (erro) { if (erro instanceof importador.ErroPlanilha) return res.status(400).json({ erro: erro.message }); throw erro; }
  const [existentes] = await db.query("SELECT alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM alunos");
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
      const [r] = await conexao.query("INSERT INTO alunos (alu_nome, alu_sala, alu_matricula) VALUES (?, ?, ?)", [l.nome, l.sala, l.matricula || null]);
      for (const resp of l.responsaveis) { // mesmo responsável (nome + telefone) de irmãos é reaproveitado, como no cadastro individual
        const [[existe]] = await conexao.query("SELECT res_id AS id FROM responsaveis WHERE res_nome = ? AND res_telefone <=> ?", [resp.nome, resp.telefone || null]);
        const respId = existe ? existe.id : (await conexao.query("INSERT INTO responsaveis (res_nome, res_telefone) VALUES (?, ?)", [resp.nome, resp.telefone || null]))[0].insertId;
        await conexao.query("INSERT INTO aluno_responsavel (alu_id, res_id, alr_parentesco) VALUES (?, ?, ?)", [r.insertId, respId, resp.parentesco]);
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
  const [linhas] = await db.query(`SELECT u.usu_id AS id, u.usu_usuario AS usuario, u.usu_nome AS nome, u.usu_papel AS papel, u.usu_sala AS sala, u.usu_ativo AS ativo, u.usu_senha_temporaria AS senha_temporaria, u.usu_ultimo_acesso AS ultimo_acesso,
    a.alu_nome AS aluno_nome FROM usuarios u LEFT JOIN alunos a ON a.alu_id = u.alu_id ORDER BY u.usu_id DESC`);
  res.json(linhas);
}));

app.post("/api/usuarios", autenticar, apenasAdmin, rota(async (req, res) => {
  const { usuario, nome, papel, aluno_id, sala } = req.body;
  if (!usuario || !nome || !papel) return res.status(400).json({ erro: "Usuário, nome e papel são obrigatórios" });
  if (papel === "pai" && !aluno_id) return res.status(400).json({ erro: "Selecione a qual aluno este responsável pertence" });
  if (papel === "professor" && !sala) return res.status(400).json({ erro: "Informe a turma (sala) do professor" });
  const senhaGerada = gerarSenhaGenerica();
  try {
    await db.query("INSERT INTO usuarios (usu_usuario, usu_senha, usu_papel, usu_nome, alu_id, usu_sala, usu_senha_temporaria) VALUES (?, ?, ?, ?, ?, ?, TRUE)",
      [usuario, await hashSenha(senhaGerada), papel, nome, papel === "pai" ? aluno_id : null, papel === "professor" ? sala : null]);
  } catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe um usuário com esse nome de login" });
    throw erro;
  }
  await registrarLog(req.usuario, "cadastro_usuario", `${usuario} (${papel})`);
  res.status(201).json({ ok: true, senha_genercada: senhaGerada }); // devolve a senha gerada só nesta resposta, para o admin entregar ao usuário
}));

app.put("/api/usuarios/:id/ativo", autenticar, apenasAdmin, rota(async (req, res) => {
  await db.query("UPDATE usuarios SET usu_ativo = ? WHERE usu_id = ?", [!!req.body.ativo, req.params.id]);
  await registrarLog(req.usuario, req.body.ativo ? "reativar_usuario" : "desativar_usuario", `usuário id ${req.params.id}`);
  res.json({ ok: true });
}));

// ---------- Logs de atividade (só administração) ----------
app.get("/api/logs", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT log_nome_usuario AS nome_usuario, log_papel AS papel, log_acao AS acao, log_detalhe AS detalhe, DATE_FORMAT(log_data_hora, '%d/%m/%Y %H:%i:%s') AS quando
    FROM logs ORDER BY log_id DESC LIMIT 50`);
  res.json(linhas);
}));

// ---------- Controle de frequência (só administração): todos os alunos em um dia ----------
app.get("/api/frequencia", autenticar, apenasAdmin, rota(async (req, res) => {
  const ref = await dataReferencia();
  const data = dataValida(req.query.data) ? req.query.data : ref.data;
  const [alunos] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, a.alu_sala AS sala, p.pre_status AS status, p.pre_observacao AS observacao,
    (SELECT COUNT(*) FROM presencas f WHERE f.alu_id = a.alu_id AND f.pre_status = 'Ausente'
       AND f.pre_data > DATE_SUB(?, INTERVAL ? DAY) AND f.pre_data <= ?) AS faltas
    FROM alunos a LEFT JOIN presencas p ON p.alu_id = a.alu_id AND p.pre_data = ? ORDER BY a.alu_nome`,
    [data, BUSCA_ATIVA.dias, data, data]);
  const presentes = alunos.filter((a) => a.status === "Presente").length;
  const ausentes = alunos.filter((a) => a.status === "Ausente").length;
  res.json({ data, eh_hoje: data === ref.hoje, hoje: ref.hoje, dias_faltas: BUSCA_ATIVA.dias, limite_faltas: BUSCA_ATIVA.faltas,
    total: alunos.length, presentes, ausentes, sem_registro: alunos.length - presentes - ausentes, alunos });
}));

// ---------- Busca Ativa (só administração) ----------
app.get("/api/busca-ativa", autenticar, apenasAdmin, rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  const [casos] = await db.query(`SELECT b.bua_id AS id, b.alu_id AS aluno_id, a.alu_nome AS nome, a.alu_sala AS sala, b.bua_faltas_ao_abrir AS faltas_ao_abrir, b.bua_status AS status,
    DATE_FORMAT(b.bua_aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.bua_encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (SELECT COUNT(*) FROM presencas f WHERE f.alu_id = b.alu_id AND f.pre_status = 'Ausente'
       AND f.pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.pre_data <= CURDATE()) AS faltas_atuais,
    (SELECT c.cct_id FROM comunicacoes_conselho c WHERE c.bua_id = b.bua_id ORDER BY c.cct_id DESC LIMIT 1) AS comunicacao_id,
    (SELECT c.cct_comunicado_em IS NOT NULL FROM comunicacoes_conselho c WHERE c.bua_id = b.bua_id ORDER BY c.cct_id DESC LIMIT 1) AS comunicacao_feita
    FROM busca_ativa b JOIN alunos a ON a.alu_id = b.alu_id
    ORDER BY (b.bua_status = 'Em acompanhamento') DESC, b.bua_id DESC LIMIT 50`, [BUSCA_ATIVA.dias]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT bua_id AS busca_id, bar_nome_usuario AS nome_usuario, bar_texto AS texto, DATE_FORMAT(bar_data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM busca_ativa_registros WHERE bua_id IN (?) ORDER BY bar_id`, [ids]))[0] : [];
  res.json({ criterio: BUSCA_ATIVA, casos: casos.map((c) => ({ ...c, registros: registros.filter((r) => r.busca_id === c.id) })) });
}));

app.post("/api/busca-ativa/:id/acompanhamento", autenticar, apenasAdmin, rota(async (req, res) => {
  const texto = (req.body.texto || "").trim();
  if (!texto || texto.length > 500) return res.status(400).json({ erro: "Escreva o acompanhamento (até 500 caracteres)" });
  const [[caso]] = await db.query("SELECT b.bua_status AS status, a.alu_nome AS nome FROM busca_ativa b JOIN alunos a ON a.alu_id = b.alu_id WHERE b.bua_id = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado" });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado" });
  await db.query("INSERT INTO busca_ativa_registros (bua_id, bar_usuario_id, bar_nome_usuario, bar_texto) VALUES (?, ?, ?, ?)", [req.params.id, req.usuario.id, req.usuario.nome, texto]);
  await registrarLog(req.usuario, "busca_ativa_acompanhamento", caso.nome);
  res.status(201).json({ ok: true });
}));

app.put("/api/busca-ativa/:id/encerrar", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[caso]] = await db.query("SELECT b.bua_status AS status, a.alu_nome AS nome FROM busca_ativa b JOIN alunos a ON a.alu_id = b.alu_id WHERE b.bua_id = ?", [req.params.id]);
  if (!caso) return res.status(404).json({ erro: "Caso não encontrado" });
  if (caso.status !== "Em acompanhamento") return res.status(400).json({ erro: "Este caso já foi encerrado" });
  const texto = (req.body.texto || "").trim().slice(0, 450);
  await db.query("UPDATE busca_ativa SET bua_status = 'Resolvido', bua_encerrada_em = NOW() WHERE bua_id = ?", [req.params.id]);
  await db.query("INSERT INTO busca_ativa_registros (bua_id, bar_usuario_id, bar_nome_usuario, bar_texto) VALUES (?, ?, ?, ?)",
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
    FROM presencas WHERE pre_data >= ? AND pre_data < DATE_ADD(?, INTERVAL 1 MONTH)`, [inicio, inicio]);
  const [alunos] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, a.alu_sala AS sala,
    COUNT(CASE WHEN p.pre_status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) AS faltas
    FROM alunos a LEFT JOIN presencas p ON p.alu_id = a.alu_id AND p.pre_data >= ? AND p.pre_data < DATE_ADD(?, INTERVAL 1 MONTH)
    GROUP BY a.alu_id, a.alu_nome, a.alu_sala ORDER BY faltas DESC, a.alu_nome`, [inicio, inicio]);
  const [casos] = await db.query(`SELECT b.bua_id AS id, a.alu_nome AS nome, a.alu_sala AS sala, b.bua_status AS status, b.bua_faltas_ao_abrir AS faltas_ao_abrir,
    DATE_FORMAT(b.bua_aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.bua_encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (b.bua_aberta_em >= ? AND b.bua_aberta_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS aberto_no_mes,
    (b.bua_encerrada_em >= ? AND b.bua_encerrada_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS encerrado_no_mes
    FROM busca_ativa b JOIN alunos a ON a.alu_id = b.alu_id
    WHERE b.bua_aberta_em < DATE_ADD(?, INTERVAL 1 MONTH) AND (b.bua_encerrada_em IS NULL OR b.bua_encerrada_em >= ?)
    ORDER BY b.bua_id`, [inicio, inicio, inicio, inicio, inicio, inicio]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT bua_id AS busca_id, bar_nome_usuario AS nome_usuario, bar_texto AS texto, DATE_FORMAT(bar_data_hora, '%d/%m/%Y %H:%i') AS quando
    FROM busca_ativa_registros WHERE bua_id IN (?) ORDER BY bar_id`, [ids]))[0] : [];
  await registrarLog(req.usuario, "relatorio_mensal", mes);
  res.json({
    mes, criterio: BUSCA_ATIVA,
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
  const [linhas] = await db.query(`SELECT a.alu_nome AS nome, ac.ace_sala AS sala, DATE_FORMAT(ac.ace_data_hora, '%H:%i:%s') AS hora
    FROM acessos ac JOIN alunos a ON a.alu_id = ac.alu_id
    ORDER BY ac.ace_id DESC LIMIT 4`);
  res.json(linhas);
}));

app.post("/api/acessos", autenticar, apenasAdmin, rota(async (req, res) => {
  const { aluno_id, sala } = req.body;
  await db.query("INSERT INTO acessos (alu_id, ace_sala) VALUES (?, ?)", [aluno_id, sala]);
  res.status(201).json({ ok: true });
}));

app.get("/api/saida", autenticar, apenasAdmin, rota(async (req, res) => {
  const [alunos] = await db.query("SELECT alu_id AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM alunos WHERE alu_nome LIKE ? LIMIT 1", [`%${req.query.nome || ""}%`]);
  if (!alunos.length) return res.json(null);
  const [responsaveis] = await db.query(`SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone, r.res_foto AS foto
    FROM aluno_responsavel ar JOIN responsaveis r ON r.res_id = ar.res_id WHERE ar.alu_id = ?`, [alunos[0].id]);
  res.json({ aluno: alunos[0], responsaveis });
}));

app.post("/api/saidas", autenticar, apenasAdmin, rota(async (req, res) => {
  await db.query("INSERT INTO saidas (alu_id) VALUES (?)", [req.body.aluno_id]);
  await registrarLog(req.usuario, "liberacao_saida", `aluno id ${req.body.aluno_id}`);
  res.status(201).json({ ok: true });
}));

// ---------- Minha Turma e chamada (só professores) ----------
app.get("/api/minha-turma", autenticar, apenasProfessor, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, p.pre_status AS status_hoje,
    (SELECT COUNT(*) FROM pendencias q WHERE q.alu_id = a.alu_id AND q.pen_status = 'Aberta')
      + (SELECT COUNT(*) FROM autorizacoes z WHERE z.alu_id = a.alu_id AND z.aut_assinada = FALSE) AS pendencias,
    (SELECT COUNT(*) FROM presencas f WHERE f.alu_id = a.alu_id AND f.pre_status = 'Ausente'
       AND f.pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND f.pre_data <= CURDATE()) AS faltas,
    GROUP_CONCAT(DISTINCT CONCAT(r.res_nome, ' (', ar.alr_parentesco, ') ', IFNULL(r.res_telefone,'')) SEPARATOR ' • ') AS responsaveis
    FROM alunos a LEFT JOIN presencas p ON p.alu_id = a.alu_id AND p.pre_data = CURDATE()
    LEFT JOIN aluno_responsavel ar ON ar.alu_id = a.alu_id LEFT JOIN responsaveis r ON r.res_id = ar.res_id
    WHERE a.alu_sala = ? GROUP BY a.alu_id, a.alu_nome, p.pre_status ORDER BY a.alu_nome`, [BUSCA_ATIVA.dias, req.usuario.sala]);
  res.json({ dias_faltas: BUSCA_ATIVA.dias, alunos: linhas });
}));

// Chamada de hoje: o professor marca Presente/Ausente só para os alunos da própria turma
app.post("/api/chamada", autenticar, apenasProfessor, rota(async (req, res) => {
  const registros = req.body.registros;
  if (!Array.isArray(registros) || !registros.length) return res.status(400).json({ erro: "Nenhum aluno na chamada" });
  const [daTurma] = await db.query("SELECT alu_id AS id FROM alunos WHERE alu_sala = ?", [req.usuario.sala]);
  const permitidos = new Set(daTurma.map((a) => a.id));
  for (const r of registros) {
    if (!permitidos.has(Number(r.aluno_id))) return res.status(403).json({ erro: "Esse aluno não é da sua turma" });
    if (!["Presente", "Ausente"].includes(r.status)) return res.status(400).json({ erro: "Status inválido" });
  }
  for (const r of registros) {
    await db.query(`INSERT INTO presencas (alu_id, pre_data, pre_status, pre_observacao) VALUES (?, CURDATE(), ?, ?)
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
    FROM presencas WHERE alu_id = ? AND pre_data > DATE_SUB(CURDATE(), INTERVAL ? DAY) AND pre_data <= CURDATE() ORDER BY pre_data DESC`, [req.params.alunoId, dias]);
  const presencas = registros.filter((r) => r.status === "Presente").length;
  const faltas = registros.filter((r) => r.status === "Ausente").length;
  const [linhasHoje] = await db.query("SELECT pre_status AS status, pre_observacao AS observacao FROM presencas WHERE alu_id = ? AND pre_data = CURDATE()", [req.params.alunoId]);
  res.json({ dias, registros, presencas, faltas, percentual: percentual(presencas, faltas), hoje: linhasHoje[0] || null });
}));

// Nome e sala do próprio filho (usado no Portal dos Pais)
app.get("/api/alunos/:alunoId", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT alu_nome AS nome, alu_sala AS sala FROM alunos WHERE alu_id = ?", [req.params.alunoId]);
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

const adminOuProfessor = (req, res, next) => ["admin", "professor"].includes(req.usuario.papel) ? next() : res.status(403).json({ erro: "Acesso negado" });
const normalizar = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Quem pode mexer na ficha de um aluno: gestão (todos), professor (só a própria turma), responsável (só o próprio filho)
async function alunoPermitido(usuario, alunoId) {
  const [[aluno]] = await db.query("SELECT alu_id AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM alunos WHERE alu_id = ?", [alunoId]);
  if (!aluno) return null;
  if (usuario.papel === "admin") return aluno;
  if (usuario.papel === "professor" && usuario.sala === aluno.sala) return aluno;
  if (usuario.papel === "pai" && usuario.aluno_id === aluno.id) return aluno;
  return null;
}
const semPermissao = (res) => res.status(403).json({ erro: "Você não tem permissão para este aluno" });

// ---------- Tabela interativa de gestão de alunos (só administração) ----------
app.get("/api/gestao-alunos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, a.alu_sala AS sala,
    (SELECT COUNT(*) FROM comunicados c WHERE c.com_sala IS NULL OR c.com_sala = a.alu_sala) AS com_total,
    (SELECT COUNT(*) FROM comunicado_leituras l JOIN comunicados c ON c.com_id = l.com_id
       WHERE l.alu_id = a.alu_id AND (c.com_sala IS NULL OR c.com_sala = a.alu_sala)) AS com_lidos,
    (SELECT COUNT(*) FROM autorizacoes z WHERE z.alu_id = a.alu_id AND z.aut_assinada = TRUE) AS aut_assinadas,
    (SELECT COUNT(*) FROM autorizacoes z WHERE z.alu_id = a.alu_id AND z.aut_assinada = FALSE) AS aut_pendentes,
    (SELECT COUNT(*) FROM pendencias p WHERE p.alu_id = a.alu_id AND p.pen_status = 'Aberta') AS pend_abertas,
    (SELECT GROUP_CONCAT(DISTINCT p.pen_tipo SEPARATOR ',') FROM pendencias p WHERE p.alu_id = a.alu_id AND p.pen_status = 'Aberta') AS pend_tipos,
    (SELECT COUNT(*) FROM ocorrencias o WHERE o.alu_id = a.alu_id AND o.oco_tipo = 'Advertencia') AS advertencias,
    (SELECT COUNT(*) FROM ocorrencias o WHERE o.alu_id = a.alu_id AND o.oco_tipo = 'Acao') AS acoes
    FROM alunos a ORDER BY a.alu_nome`);
  res.json(linhas);
}));

// ---------- Ficha do aluno: tudo do aluno em uma resposta ----------
app.get("/api/alunos/:alunoId/ficha", autenticar, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  const [responsaveis] = await db.query(`SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone FROM aluno_responsavel ar
    JOIN responsaveis r ON r.res_id = ar.res_id WHERE ar.alu_id = ?`, [aluno.id]);
  const [comunicados] = await db.query(`SELECT c.com_id AS id, c.com_titulo AS titulo, c.com_texto AS texto, c.com_sala AS sala, c.com_criado_por_nome AS criado_por_nome, DATE_FORMAT(c.com_criado_em, '%d/%m/%Y') AS data,
    (l.col_lido_em IS NOT NULL) AS lido, DATE_FORMAT(l.col_lido_em, '%d/%m/%Y %H:%i') AS lido_em
    FROM comunicados c LEFT JOIN comunicado_leituras l ON l.com_id = c.com_id AND l.alu_id = ?
    WHERE c.com_sala IS NULL OR c.com_sala = ? ORDER BY c.com_id DESC`, [aluno.id, aluno.sala]);
  const [autorizacoes] = await db.query(`SELECT aut_id AS id, aut_titulo AS titulo, aut_validade AS validade, aut_detalhe AS detalhe, aut_assinada AS assinada, aut_assinada_nome AS assinada_nome,
    DATE_FORMAT(aut_assinada_em, '%d/%m/%Y %H:%i') AS assinada_em, aut_codigo AS codigo FROM autorizacoes WHERE alu_id = ? ORDER BY aut_id DESC`, [aluno.id]);
  const [documentos] = await db.query(`SELECT doc_id AS id, doc_categoria AS categoria, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_tamanho AS tamanho, doc_enviado_por_nome AS enviado_por_nome,
    DATE_FORMAT(doc_enviado_em, '%d/%m/%Y') AS enviado_em FROM documentos WHERE alu_id = ? ORDER BY doc_id DESC`, [aluno.id]);
  const [pendencias] = await db.query(`SELECT pen_id AS id, pen_tipo AS tipo, pen_descricao AS descricao, pen_status AS status, pen_criada_por_nome AS criada_por_nome, DATE_FORMAT(pen_criada_em, '%d/%m/%Y') AS criada_em,
    DATE_FORMAT(pen_resolvida_em, '%d/%m/%Y') AS resolvida_em, pen_resolvida_por_nome AS resolvida_por_nome FROM pendencias WHERE alu_id = ?
    ORDER BY (pen_status = 'Aberta') DESC, pen_id DESC`, [aluno.id]);
  const [ocorrencias] = await db.query(`SELECT oco_id AS id, oco_tipo AS tipo, oco_descricao AS descricao, DATE_FORMAT(oco_data_ocorrencia, '%d/%m/%Y') AS data, oco_registrada_por_nome AS registrada_por_nome
    FROM ocorrencias WHERE alu_id = ? ORDER BY oco_data_ocorrencia DESC, oco_id DESC`, [aluno.id]);
  res.json({
    aluno, responsaveis, categorias: DOCUMENTO_CATEGORIAS,
    comunicados: comunicados.map((c) => ({ ...c, lido: !!c.lido })),
    autorizacoes: autorizacoes.map((a) => ({ ...a, assinada: !!a.assinada })),
    documentos, pendencias, ocorrencias,
    consentimento: await consentimentoDoAluno(aluno.id, req.usuario.papel !== "professor"),
  });
}));

// ---------- Comunicados ----------
app.get("/api/comunicados", autenticar, adminOuProfessor, rota(async (req, res) => {
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : null;
  const [linhas] = await db.query(`SELECT c.com_id AS id, c.com_titulo AS titulo, c.com_texto AS texto, c.com_sala AS sala, c.com_criado_por_nome AS criado_por_nome, DATE_FORMAT(c.com_criado_em, '%d/%m/%Y %H:%i') AS criado_em,
    (SELECT COUNT(*) FROM alunos a WHERE (c.com_sala IS NULL OR a.alu_sala = c.com_sala) AND (? IS NULL OR a.alu_sala = ?)) AS destinatarios,
    (SELECT COUNT(*) FROM comunicado_leituras l JOIN alunos a ON a.alu_id = l.alu_id WHERE l.com_id = c.com_id AND (? IS NULL OR a.alu_sala = ?)) AS lidos
    FROM comunicados c WHERE (? IS NULL OR c.com_sala IS NULL OR c.com_sala = ?) ORDER BY c.com_id DESC LIMIT 50`, [sala, sala, sala, sala, sala, sala]);
  res.json(linhas);
}));

app.post("/api/comunicados", autenticar, adminOuProfessor, rota(async (req, res) => {
  const titulo = (req.body.titulo || "").trim(), texto = (req.body.texto || "").trim();
  if (!titulo || titulo.length > 120) return res.status(400).json({ erro: "Informe o título (até 120 caracteres)" });
  if (!texto || texto.length > 1500) return res.status(400).json({ erro: "Escreva o comunicado (até 1500 caracteres)" });
  // Comunicado vai para várias famílias: citar o nome completo de um aluno expõe a criança (ECA, arts. 17 e 18). Pede confirmação.
  const limpo = (x) => normalizar(x).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const textoLimpo = ` ${limpo(`${titulo} ${texto}`)} `;
  const [todosAlunos] = await db.query("SELECT alu_nome AS nome FROM alunos");
  const citados = todosAlunos.map((a) => a.nome).filter((n) => { const k = limpo(n); return k.includes(" ") && textoLimpo.includes(` ${k} `); });
  if (citados.length && req.body.confirmar_nomes !== true)
    return res.status(409).json({ erro: "Este comunicado cita o nome de aluno(s). Todas as famílias que recebem o aviso vão ler. Confirme só se for necessário e se as famílias autorizaram.", codigo: "NOME_DE_ALUNO", alunos: citados });
  // Professor só publica para a própria turma; a gestão escolhe uma turma ou a escola toda
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : ((req.body.sala || "").trim() || null);
  await db.query("INSERT INTO comunicados (com_titulo, com_texto, com_sala, com_criado_por_nome) VALUES (?, ?, ?, ?)", [titulo, texto, sala, req.usuario.nome]);
  await registrarLog(req.usuario, "comunicado_criado", `${titulo} (${sala || "escola toda"})`);
  if (citados.length) await registrarLog(req.usuario, "comunicado_com_nome_de_aluno", `${citados.length} aluno(s) citado(s) no comunicado "${titulo}"`);
  res.status(201).json({ ok: true });
}));

app.get("/api/comunicados/:id/leituras", autenticar, adminOuProfessor, rota(async (req, res) => {
  const [[c]] = await db.query("SELECT com_sala AS sala FROM comunicados WHERE com_id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ erro: "Comunicado não encontrado" });
  const salaProf = req.usuario.papel === "professor" ? req.usuario.sala : null;
  if (salaProf && c.sala && c.sala !== salaProf) return res.status(403).json({ erro: "Comunicado de outra turma" });
  const [linhas] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, a.alu_sala AS sala, (l.col_lido_em IS NOT NULL) AS lido, DATE_FORMAT(l.col_lido_em, '%d/%m/%Y %H:%i') AS lido_em
    FROM alunos a LEFT JOIN comunicado_leituras l ON l.alu_id = a.alu_id AND l.com_id = ?
    WHERE (? IS NULL OR a.alu_sala = ?) AND (? IS NULL OR a.alu_sala = ?) ORDER BY lido, a.alu_nome`, [req.params.id, c.sala, c.sala, salaProf, salaProf]);
  res.json(linhas.map((l) => ({ ...l, lido: !!l.lido })));
}));

// O responsável marca o comunicado como lido (vale para o filho dele)
app.post("/api/comunicados/:id/ler", autenticar, rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável marca como lido" });
  const [[aluno]] = await db.query("SELECT alu_sala AS sala FROM alunos WHERE alu_id = ?", [req.usuario.aluno_id]);
  const [[c]] = await db.query("SELECT com_id AS id, com_titulo AS titulo FROM comunicados WHERE com_id = ? AND (com_sala IS NULL OR com_sala = ?)", [req.params.id, aluno.sala]);
  if (!c) return res.status(404).json({ erro: "Comunicado não encontrado" });
  await db.query("INSERT IGNORE INTO comunicado_leituras (com_id, alu_id, col_usuario_id) VALUES (?, ?, ?)", [c.id, req.usuario.aluno_id, req.usuario.id]);
  await registrarLog(req.usuario, "comunicado_lido", c.titulo);
  res.json({ ok: true });
}));

// ---------- Autorizações digitais ----------
// A gestão cria a autorização para uma turma ou para a escola toda (uma linha por aluno)
app.post("/api/autorizacoes", autenticar, apenasAdmin, rota(async (req, res) => {
  const titulo = (req.body.titulo || "").trim(), detalhe = (req.body.detalhe || "").trim().slice(0, 250), validade = (req.body.validade || "").trim().slice(0, 50);
  const sala = (req.body.sala || "").trim() || null;
  if (!titulo || titulo.length > 100) return res.status(400).json({ erro: "Informe o título (até 100 caracteres)" });
  const grupo = crypto.randomBytes(6).toString("hex");
  const [r] = await db.query(`INSERT INTO autorizacoes (aut_grupo, alu_id, aut_titulo, aut_validade, aut_detalhe, aut_criada_por_nome)
    SELECT ?, alu_id, ?, ?, ?, ? FROM alunos WHERE (? IS NULL OR alu_sala = ?)`, [grupo, titulo, validade || null, detalhe || null, req.usuario.nome, sala, sala]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Nenhum aluno encontrado para esse destino" });
  await registrarLog(req.usuario, "autorizacao_criada", `${titulo} (${r.affectedRows} alunos)`);
  res.status(201).json({ ok: true, alunos: r.affectedRows });
}));

app.get("/api/autorizacoes-grupos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT aut_grupo AS grupo, MIN(aut_titulo) AS titulo, MIN(aut_detalhe) AS detalhe, MIN(aut_validade) AS validade,
    DATE_FORMAT(MIN(aut_criada_em), '%d/%m/%Y') AS criada_em, MIN(aut_criada_por_nome) AS criada_por_nome,
    COUNT(*) AS total, COUNT(CASE WHEN aut_assinada THEN 1 END) AS assinadas
    FROM autorizacoes GROUP BY aut_grupo ORDER BY MIN(aut_id) DESC LIMIT 50`);
  res.json(linhas);
}));

app.get("/api/autorizacoes-grupos/:grupo", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT z.aut_id AS id, a.alu_nome AS nome, a.alu_sala AS sala, z.aut_assinada AS assinada, z.aut_assinada_nome AS assinada_nome,
    DATE_FORMAT(z.aut_assinada_em, '%d/%m/%Y %H:%i') AS assinada_em, z.aut_codigo AS codigo
    FROM autorizacoes z JOIN alunos a ON a.alu_id = z.alu_id WHERE z.aut_grupo = ? ORDER BY z.aut_assinada, a.alu_nome`, [req.params.grupo]);
  res.json(linhas.map((l) => ({ ...l, assinada: !!l.assinada })));
}));

// Assinatura digital: o responsável confirma com nome completo + senha. O sistema grava quem, quando e um código de verificação.
app.post("/api/autorizacoes/:id/assinar", autenticar, rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável pode assinar" });
  const [[aut]] = await db.query("SELECT aut_id AS id, alu_id AS aluno_id, aut_titulo AS titulo, aut_assinada AS assinada FROM autorizacoes WHERE aut_id = ?", [req.params.id]);
  if (!aut) return res.status(404).json({ erro: "Autorização não encontrada" });
  if (aut.aluno_id !== req.usuario.aluno_id) return res.status(403).json({ erro: "Você só pode assinar autorizações do seu próprio filho" });
  if (aut.assinada) return res.status(400).json({ erro: "Esta autorização já foi assinada" });
  const [[u]] = await db.query("SELECT usu_nome AS nome, usu_senha AS senha FROM usuarios WHERE usu_id = ?", [req.usuario.id]);
  if (!(await conferirSenha(req.body.senha, u.senha))) return res.status(400).json({ erro: "Senha incorreta" });
  if (normalizar(req.body.nome) !== normalizar(u.nome)) return res.status(400).json({ erro: "Digite seu nome completo exatamente como está cadastrado" });
  const agora = new Date();
  const codigo = crypto.createHash("sha256").update(`${aut.id}|${aut.aluno_id}|${req.usuario.id}|${agora.toISOString()}|${u.nome}`).digest("hex").slice(0, 16).toUpperCase();
  await db.query("UPDATE autorizacoes SET aut_assinada = TRUE, aut_assinada_por = ?, aut_assinada_nome = ?, aut_assinada_em = NOW(), aut_codigo = ? WHERE aut_id = ?",
    [req.usuario.id, u.nome, codigo, aut.id]);
  await registrarLog(req.usuario, "autorizacao_assinada", `${aut.titulo} (código ${codigo})`);
  res.json({ ok: true, codigo });
}));

// ---------- Documentos do aluno ----------
app.post("/api/documentos", autenticar, rota(async (req, res) => {
  const { aluno_id, categoria, nome_arquivo, conteudo, pendencia_id } = req.body;
  const titulo = (req.body.titulo || "").trim();
  const aluno = await alunoPermitido(req.usuario, Number(aluno_id));
  if (!aluno) return semPermissao(res);
  if (!DOCUMENTO_CATEGORIAS.includes(categoria)) return res.status(400).json({ erro: "Categoria inválida" });
  if (!titulo || titulo.length > 120) return res.status(400).json({ erro: "Informe o título do documento (até 120 caracteres)" });
  const nomeOriginal = path.basename(String(nome_arquivo || "")).slice(0, 200);
  const ext = path.extname(nomeOriginal).slice(1).toLowerCase();
  if (!TIPOS_DOCUMENTO[ext]) return res.status(400).json({ erro: "Formato não permitido. Use PDF, PNG, JPG, DOC ou DOCX" });
  if (typeof conteudo !== "string" || !conteudo) return res.status(400).json({ erro: "Nenhum arquivo enviado" });
  const arquivo = Buffer.from(conteudo, "base64");
  if (!arquivo.length) return res.status(400).json({ erro: "Arquivo vazio" });
  if (arquivo.length > TAMANHO_MAXIMO) return res.status(400).json({ erro: "O arquivo passa de 5 MB" });
  if (!ASSINATURAS_ARQUIVO[ext].every((b, i) => arquivo[i] === b)) return res.status(400).json({ erro: "O conteúdo do arquivo não corresponde ao formato " + ext.toUpperCase() });
  const nomeGuardado = crypto.randomBytes(16).toString("hex") + ".enc"; // nome aleatório: ninguém adivinha o caminho
  fs.writeFileSync(path.join(PASTA_UPLOADS, nomeGuardado), cifrarArquivo(arquivo, nomeGuardado)); // vai para o disco criptografado
  await db.query(`INSERT INTO documentos (alu_id, doc_categoria, doc_titulo, doc_nome_original, doc_arquivo, doc_tipo_mime, doc_tamanho, doc_enviado_por_nome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [aluno.id, categoria, titulo, nomeOriginal, nomeGuardado, TIPOS_DOCUMENTO[ext], arquivo.length, req.usuario.nome]);
  let atendeu = false;
  if (pendencia_id) { // se o documento atende a uma pendência do tipo Documento, ela é resolvida junto
    const [r] = await db.query(`UPDATE pendencias SET pen_status = 'Resolvida', pen_resolvida_em = NOW(), pen_resolvida_por_nome = ?
      WHERE pen_id = ? AND alu_id = ? AND pen_tipo = 'Documento' AND pen_status = 'Aberta'`, [req.usuario.nome, pendencia_id, aluno.id]);
    atendeu = r.affectedRows > 0;
  }
  await registrarLog(req.usuario, "documento_enviado", `${titulo} — ${aluno.nome}`);
  res.status(201).json({ ok: true, pendencia_resolvida: atendeu });
}));

app.get("/api/documentos/:id/arquivo", autenticar, rota(async (req, res) => {
  const [[d]] = await db.query("SELECT doc_id AS id, alu_id AS aluno_id, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_arquivo AS arquivo, doc_tipo_mime AS tipo_mime FROM documentos WHERE doc_id = ?", [req.params.id]);
  if (!d) return res.status(404).json({ erro: "Documento não encontrado" });
  if (!(await alunoPermitido(req.usuario, d.aluno_id))) {
    await registrarLog(req.usuario, "documento_acesso_negado", `Documento id ${d.id} — aluno id ${d.aluno_id}`);
    return semPermissao(res);
  }
  const nomeNoDisco = path.basename(d.arquivo), caminho = path.join(PASTA_UPLOADS, nomeNoDisco);
  if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "Arquivo não encontrado no servidor" });
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
  const [[d]] = await db.query("SELECT doc_id AS id, alu_id AS aluno_id, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_arquivo AS arquivo, doc_tipo_mime AS tipo_mime FROM documentos WHERE doc_id = ?", [req.params.id]);
  if (!d) return res.status(404).json({ erro: "Documento não encontrado" });
  await db.query("DELETE FROM documentos WHERE doc_id = ?", [d.id]);
  fs.rmSync(path.join(PASTA_UPLOADS, path.basename(d.arquivo)), { force: true });
  await registrarLog(req.usuario, "documento_excluido", d.titulo);
  res.json({ ok: true });
}));

// ---------- Pendências (gestão e professor da turma criam; só a gestão resolve) ----------
app.post("/api/pendencias", autenticar, adminOuProfessor, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.body.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (req.body.descricao || "").trim();
  if (!["Documento", "Cadastro", "Outro"].includes(req.body.tipo)) return res.status(400).json({ erro: "Tipo de pendência inválido" });
  if (!descricao || descricao.length > 200) return res.status(400).json({ erro: "Descreva a pendência (até 200 caracteres)" });
  await db.query("INSERT INTO pendencias (alu_id, pen_tipo, pen_descricao, pen_criada_por_nome) VALUES (?, ?, ?, ?)", [aluno.id, req.body.tipo, descricao, req.usuario.nome]);
  await registrarLog(req.usuario, "pendencia_criada", `${aluno.nome}: ${descricao}`);
  res.status(201).json({ ok: true });
}));

app.put("/api/pendencias/:id/resolver", autenticar, apenasAdmin, rota(async (req, res) => {
  const [r] = await db.query("UPDATE pendencias SET pen_status = 'Resolvida', pen_resolvida_em = NOW(), pen_resolvida_por_nome = ? WHERE pen_id = ? AND pen_status = 'Aberta'", [req.usuario.nome, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Pendência não encontrada ou já resolvida" });
  await registrarLog(req.usuario, "pendencia_resolvida", `pendência id ${req.params.id}`);
  res.json({ ok: true });
}));

// ---------- Ações e advertências ----------
app.post("/api/ocorrencias", autenticar, adminOuProfessor, rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.body.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (req.body.descricao || "").trim();
  if (!["Advertencia", "Acao"].includes(req.body.tipo)) return res.status(400).json({ erro: "Tipo inválido" });
  if (!descricao || descricao.length > 500) return res.status(400).json({ erro: "Descreva o ocorrido (até 500 caracteres)" });
  await db.query("INSERT INTO ocorrencias (alu_id, oco_tipo, oco_descricao, oco_data_ocorrencia, oco_registrada_por_nome) VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?)",
    [aluno.id, req.body.tipo, descricao, dataValida(req.body.data) ? req.body.data : null, req.usuario.nome]);
  await registrarLog(req.usuario, "ocorrencia_registrada", `${req.body.tipo === "Acao" ? "Ação" : "Advertência"} — ${aluno.nome}`);
  res.status(201).json({ ok: true });
}));

// ---------- Termo de consentimento dos responsáveis: uso de imagem e informações do aluno (LGPD, art. 14, §1º) ----------
// O responsável escolhe cada item separadamente. Cada assinatura, alteração ou revogação grava uma NOVA linha (histórico preservado).
// Vale a mais recente da versão atual do texto. Se o texto mudar de versão, o consentimento volta a ficar pendente.
const CONSENTIMENTO = {
  versao: "1.0", atualizado_em: "15/10/2026",
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
      "Pelo Portal dos Pais, a qualquer momento, no cartão \"Consentimento\". É gratuito e fácil. A revogação vale daqui para a frente: o que já foi feito com a autorização anterior continua válido (LGPD, art. 8º, §5º).",
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
  const [linhas] = await db.query("SELECT con_id AS id, con_versao AS versao, con_informacoes AS informacoes, con_imagem AS imagem, con_monitoramento AS monitoramento, con_assinado_nome AS assinado_nome, DATE_FORMAT(con_assinado_em, '%d/%m/%Y %H:%i') AS assinado_em, con_codigo AS codigo FROM consentimentos WHERE alu_id = ? ORDER BY con_id DESC", [alunoId]);
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
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável pelo aluno pode assinar o termo" });
  const alunoId = Number(req.params.alunoId);
  if (req.usuario.aluno_id !== alunoId) return res.status(403).json({ erro: "Você só pode assinar o termo do seu próprio filho" });
  const escolhas = {};
  for (const id of OPCOES_CONSENTIMENTO) {
    if (typeof req.body[id] !== "boolean") return res.status(400).json({ erro: "Responda todas as opções (autorizo ou não autorizo)" });
    escolhas[id] = req.body[id];
  }
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} minuto(s).` });
  const [[u]] = await db.query("SELECT usu_nome AS nome, usu_senha AS senha FROM usuarios WHERE usu_id = ?", [req.usuario.id]);
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chave); return res.status(400).json({ erro: "Senha incorreta" }); }
  if (normalizar(req.body.nome) !== normalizar(u.nome)) return res.status(400).json({ erro: "Digite seu nome completo exatamente como está cadastrado" });
  tentativas.delete(chave);
  const agora = new Date();
  const codigo = crypto.createHash("sha256").update(`${alunoId}|${req.usuario.id}|${CONSENTIMENTO.versao}|${OPCOES_CONSENTIMENTO.map((id) => (escolhas[id] ? 1 : 0)).join("")}|${agora.toISOString()}|${u.nome}`).digest("hex").slice(0, 16).toUpperCase();
  await db.query("INSERT INTO consentimentos (alu_id, usu_id, con_versao, con_informacoes, con_imagem, con_monitoramento, con_assinado_nome, con_codigo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [alunoId, req.usuario.id, CONSENTIMENTO.versao, escolhas.informacoes, escolhas.imagem, escolhas.monitoramento, u.nome, codigo]);
  const sn = (v) => (v ? "sim" : "não");
  await registrarLog(req.usuario, "consentimento_registrado", `Aluno id ${alunoId} — informações: ${sn(escolhas.informacoes)}, imagem: ${sn(escolhas.imagem)}, câmeras: ${sn(escolhas.monitoramento)} (código ${codigo})`);
  res.status(201).json({ ok: true, codigo, status: statusConsentimento(escolhas) });
}));

// Visão da gestão: situação do consentimento de todos os alunos (versão atual do termo)
app.get("/api/consentimentos", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, a.alu_sala AS sala, c.con_informacoes AS informacoes, c.con_imagem AS imagem, c.con_monitoramento AS monitoramento,
    c.con_assinado_nome AS assinado_nome, DATE_FORMAT(c.con_assinado_em, '%d/%m/%Y %H:%i') AS assinado_em
    FROM alunos a LEFT JOIN consentimentos c ON c.alu_id = a.alu_id AND c.con_id = (SELECT MAX(x.con_id) FROM consentimentos x WHERE x.alu_id = a.alu_id AND x.con_versao = ?)
    ORDER BY a.alu_nome`, [CONSENTIMENTO.versao]);
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
  const [itens] = await db.query(`SELECT c.cct_id AS id, c.alu_id AS aluno_id, a.alu_nome AS aluno_nome, a.alu_sala AS aluno_sala, c.bua_id AS busca_id,
    c.cct_motivo AS motivo, c.cct_descricao AS descricao, c.cct_medidas AS medidas,
    DATE_FORMAT(c.cct_registrada_em, '%d/%m/%Y %H:%i') AS registrada_em, c.cct_registrada_por_nome AS registrada_por,
    DATE_FORMAT(c.cct_comunicado_em, '%d/%m/%Y') AS comunicado_em, c.cct_comunicado_por_nome AS comunicado_por, c.cct_protocolo AS protocolo,
    (c.cct_comunicado_em IS NULL) AS pendente, DATEDIFF(CURDATE(), DATE(c.cct_registrada_em)) AS dias_registro
    FROM comunicacoes_conselho c JOIN alunos a ON a.alu_id = c.alu_id ${ehAdmin ? "" : "WHERE c.usu_id = ?"}
    ORDER BY (c.cct_comunicado_em IS NULL) DESC, CASE WHEN c.cct_comunicado_em IS NULL THEN c.cct_registrada_em END ASC, c.cct_id DESC LIMIT 200`, ehAdmin ? [] : [req.usuario.id]);
  const lista = itens.map((i) => ({ ...i, pendente: !!i.pendente }));
  await registrarLog(req.usuario, "protecao_consultada", `${lista.length} registro(s)`);
  res.json({ pendentes: lista.filter((i) => i.pendente).length, itens: lista });
}));

app.post("/api/protecao", autenticar, adminOuProfessor, rota(async (req, res) => {
  const { aluno_id, motivo, bua_id } = req.body;
  const descricao = String(req.body.descricao || "").trim(), medidas = String(req.body.medidas || "").trim();
  if (!MOTIVOS_PROTECAO.includes(motivo)) return res.status(400).json({ erro: "Escolha o motivo da comunicação" });
  if (descricao.length < 10 || descricao.length > 1500) return res.status(400).json({ erro: "Descreva os fatos (de 10 a 1500 caracteres)" });
  if (medidas.length > 1500) return res.status(400).json({ erro: "As medidas adotadas passam de 1500 caracteres" });
  const aluno = await alunoPermitido(req.usuario, Number(aluno_id));
  if (!aluno) return semPermissao(res);
  let medidasFinal = medidas || null, buaId = null;
  if (motivo === "Faltas") { // ECA, art. 56, II: só depois de esgotados os recursos da escola, e quem decide é a gestão
    if (req.usuario.papel !== "admin") return res.status(403).json({ erro: "A comunicação por faltas é feita pela gestão da escola" });
    if (req.body.recursos_esgotados !== true) return res.status(400).json({ erro: "Confirme que os recursos da escola foram esgotados (ECA, art. 56, II)" });
    if (bua_id) {
      const [[caso]] = await db.query("SELECT bua_id FROM busca_ativa WHERE bua_id = ? AND alu_id = ?", [bua_id, aluno.id]);
      if (!caso) return res.status(400).json({ erro: "Caso de Busca Ativa não encontrado para este aluno" });
      const [[ja]] = await db.query("SELECT cct_id FROM comunicacoes_conselho WHERE bua_id = ?", [bua_id]);
      if (ja) return res.status(409).json({ erro: "Este caso de Busca Ativa já tem uma comunicação registrada" });
      const [humanos] = await db.query("SELECT bar_nome_usuario AS nome, bar_texto AS texto, DATE_FORMAT(bar_data_hora, '%d/%m/%Y') AS dia FROM busca_ativa_registros WHERE bua_id = ? AND bar_nome_usuario <> 'Sistema' ORDER BY bar_id", [bua_id]);
      if (!humanos.length) return res.status(400).json({ erro: "Registre ao menos uma ação de acompanhamento (ligação, visita, conversa com a família) antes de comunicar ao Conselho Tutelar: o ECA (art. 56, II) pede que os recursos da escola sejam esgotados" });
      if (!medidasFinal) medidasFinal = humanos.map((h) => `${h.dia} — ${h.nome}: ${h.texto}`).join("\n").slice(0, 1500); // o histórico do acompanhamento vira as "medidas adotadas"
      buaId = caso.bua_id;
    } else if (medidas.length < 10) return res.status(400).json({ erro: "Descreva as medidas que a escola já adotou" });
  }
  const [r] = await db.query("INSERT INTO comunicacoes_conselho (alu_id, usu_id, bua_id, cct_motivo, cct_descricao, cct_medidas, cct_registrada_por_nome) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [aluno.id, req.usuario.id, buaId, motivo, descricao, medidasFinal, req.usuario.nome]);
  await registrarLog(req.usuario, "protecao_registrada", `${motivo} — aluno id ${aluno.id}`); // o texto dos fatos nunca vai para os logs
  res.status(201).json({ ok: true, id: r.insertId });
}));

// A gestão registra que JÁ comunicou ao Conselho Tutelar (data e protocolo/ofício)
app.put("/api/protecao/:id/comunicado", autenticar, apenasAdmin, rota(async (req, res) => {
  const [[reg]] = await db.query("SELECT cct_id AS id, cct_comunicado_em AS feito, alu_id AS aluno_id FROM comunicacoes_conselho WHERE cct_id = ?", [req.params.id]);
  if (!reg) return res.status(404).json({ erro: "Registro não encontrado" });
  if (reg.feito) return res.status(409).json({ erro: "Este registro já consta como comunicado" });
  const data = String(req.body.data || ""), protocolo = String(req.body.protocolo || "").trim();
  const [[h]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(new Date(data + "T12:00:00").getTime())) return res.status(400).json({ erro: "Informe a data em que a comunicação foi feita" });
  if (data > h.hoje) return res.status(400).json({ erro: "A data da comunicação não pode ser no futuro" });
  if (protocolo && !/^[\p{L}\p{N} ./_-]{1,60}$/u.test(protocolo)) return res.status(400).json({ erro: "Protocolo inválido (até 60 caracteres: letras, números, espaço, ponto, barra e hífen)" });
  await db.query("UPDATE comunicacoes_conselho SET cct_comunicado_em = ?, cct_comunicado_por_nome = ?, cct_protocolo = ? WHERE cct_id = ?", [data, req.usuario.nome, protocolo || null, reg.id]);
  await registrarLog(req.usuario, "protecao_comunicada", `Registro ${reg.id} — aluno id ${reg.aluno_id}${protocolo ? " — protocolo " + protocolo : ""}`);
  res.json({ ok: true });
}));

// LDB, art. 12, VIII: relação dos alunos com faltas acima do limite (calculada sobre os dias com chamada registrada no sistema)
app.get("/api/protecao/faltas-limite", autenticar, apenasAdmin, rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.alu_id AS id, a.alu_nome AS nome, a.alu_sala AS sala, COUNT(p.pre_id) AS dias,
    COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) AS faltas,
    EXISTS(SELECT 1 FROM comunicacoes_conselho c WHERE c.alu_id = a.alu_id AND c.cct_motivo = 'Faltas') AS comunicado
    FROM alunos a JOIN presencas p ON p.alu_id = a.alu_id GROUP BY a.alu_id, a.alu_nome, a.alu_sala
    HAVING COUNT(p.pre_id) > 0 AND COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) * 100 > COUNT(p.pre_id) * ?
    ORDER BY COUNT(CASE WHEN p.pre_status = 'Ausente' THEN 1 END) / COUNT(p.pre_id) DESC, a.alu_nome`, [LIMITE_FALTAS_CT]);
  res.json({ percentual: LIMITE_FALTAS_CT, alunos: linhas.map((l) => ({ ...l, percentual: Math.round((l.faltas * 1000) / l.dias) / 10, comunicado: !!l.comunicado })) });
}));

app.post("/api/aceite-privacidade", autenticar, rota(async (req, res) => {
  await db.query("UPDATE usuarios SET usu_aceite_em = NOW(), usu_aceite_versao = ? WHERE usu_id = ?", [POLITICA.versao, req.usuario.id]);
  await registrarLog(req.usuario, "aceite_privacidade", `Política de privacidade versão ${POLITICA.versao}`);
  res.json({ ok: true });
}));

// Direito de acesso (LGPD, art. 18): entrega todos os dados do aluno em um arquivo. Admin, ou o responsável do próprio aluno.
app.get("/api/alunos/:alunoId/meus-dados", autenticar, proprioAlunoOuAdmin, rota(async (req, res) => {
  const id = Number(req.params.alunoId);
  const [[aluno]] = await db.query("SELECT alu_id AS id, alu_nome AS nome, alu_sala AS sala, alu_matricula AS matricula FROM alunos WHERE alu_id = ?", [id]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado" });
  const [responsaveis] = await db.query("SELECT r.res_nome AS nome, ar.alr_parentesco AS parentesco, r.res_telefone AS telefone FROM aluno_responsavel ar JOIN responsaveis r ON r.res_id = ar.res_id WHERE ar.alu_id = ?", [id]);
  const [presencas] = await db.query("SELECT DATE_FORMAT(pre_data, '%Y-%m-%d') AS data, pre_status AS status, pre_observacao AS observacao FROM presencas WHERE alu_id = ? ORDER BY pre_data", [id]);
  const [ocorrencias] = await db.query("SELECT oco_tipo AS tipo, oco_descricao AS descricao, DATE_FORMAT(oco_data_ocorrencia, '%Y-%m-%d') AS data, oco_registrada_por_nome AS registrada_por FROM ocorrencias WHERE alu_id = ? ORDER BY oco_data_ocorrencia", [id]);
  const [pendencias] = await db.query("SELECT pen_tipo AS tipo, pen_descricao AS descricao, pen_status AS status, DATE_FORMAT(pen_criada_em, '%Y-%m-%d %H:%i') AS criada_em FROM pendencias WHERE alu_id = ? ORDER BY pen_id", [id]);
  const [autorizacoes] = await db.query("SELECT aut_titulo AS titulo, aut_validade AS validade, aut_assinada AS assinada, aut_assinada_nome AS assinada_por, DATE_FORMAT(aut_assinada_em, '%Y-%m-%d %H:%i') AS assinada_em, aut_codigo AS codigo FROM autorizacoes WHERE alu_id = ? ORDER BY aut_id", [id]);
  const [comunicadosLidos] = await db.query("SELECT c.com_titulo AS titulo, DATE_FORMAT(l.col_lido_em, '%Y-%m-%d %H:%i') AS lido_em FROM comunicado_leituras l JOIN comunicados c ON c.com_id = l.com_id WHERE l.alu_id = ? ORDER BY l.col_lido_em", [id]);
  const [documentos] = await db.query("SELECT doc_categoria AS categoria, doc_titulo AS titulo, doc_nome_original AS nome_original, doc_tamanho AS tamanho_bytes, doc_enviado_por_nome AS enviado_por, DATE_FORMAT(doc_enviado_em, '%Y-%m-%d') AS enviado_em FROM documentos WHERE alu_id = ? ORDER BY doc_id", [id]);
  await registrarLog(req.usuario, "exportacao_dados_aluno", `${aluno.nome} — aluno id ${id}`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="dados-aluno-${id}.json"`);
  res.send(JSON.stringify({ gerado_em: new Date().toISOString(), base: "LGPD, art. 18 — direito de acesso aos dados",
    aluno, responsaveis, presencas, ocorrencias, pendencias, autorizacoes, comunicados_lidos: comunicadosLidos,
    documentos_anexados: documentos, consentimentos: (await consentimentoDoAluno(id, true)).historico, observacao: "Os arquivos dos documentos não vão neste arquivo; peça à gestão da escola se precisar deles. Registros sigilosos de proteção da criança (comunicações ao Conselho Tutelar, ECA arts. 13 e 56) não fazem parte deste arquivo." }, null, 2));
}));

app.listen(config.porta, async () => {
  console.log(`S.I.V.E. rodando em http://localhost:${config.porta}`);
  try { protegerArquivosAntigos(); } catch (erro) { console.log("⚠️  Não foi possível criptografar arquivos antigos: " + erro.message); }
  // Confere se o banco está na versão atual (evita erros de "Unknown column / table" nas telas)
  try {
    const [colunas] = await db.query("SHOW COLUMNS FROM usuarios LIKE 'usu_aceite_em'");
    const [tabelas] = await db.query("SHOW TABLES LIKE 'consentimentos'");
    if (!colunas.length || !tabelas.length) {
      console.log("\n⚠️  BANCO DESATUALIZADO: rode o arquivo database/sive.sql no MySQL de novo e reinicie o servidor.\n");
    }
  } catch (erro) {
    console.log("\n⚠️  Não foi possível ler o banco: " + erro.message + "\n   Confira o config.json e se o MySQL está ligado.\n");
  }
});
