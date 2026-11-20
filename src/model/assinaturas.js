// Model: assinatura digital (hash do conteúdo + selo Ed25519 do servidor).
const crypto = require("crypto");
const { config } = require("../../config");
const db = require("./db");
const { conferirSenha, minutosBloqueado, registrarFalha, tentativas } = require("./seguranca");
const { nomeTurma } = require("./utilitarios");

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
    const [[o]] = await db.query(`SELECT id_aluno AS aluno_id, ${nomeTurma("tb_ocorrencias_escolares")} AS turma, DATE_FORMAT(data, '%Y-%m-%d') AS data, TIME_FORMAT(horario, '%H:%i') AS horario,
      DATE_FORMAT(notificado_em, '%Y-%m-%d %H:%i') AS notificado_em, descricao AS descricao, buscado_por AS buscado_por, professor_nome AS professor
      FROM tb_ocorrencias_escolares WHERE id_ocorrencia = ?`, [id]);
    return o ? { documento, id: Number(id), ...o } : null;
  }
  if (documento === "autorizacao") {
    const [[a]] = await db.query("SELECT id_aluno AS aluno_id, grupo AS grupo, titulo AS titulo, validade AS validade, detalhe AS detalhe FROM tb_autorizacoes WHERE id_autorizacao = ?", [id]);
    return a ? { documento, id: Number(id), ...a } : null;
  }
  const [[c]] = await db.query("SELECT id_aluno AS aluno_id, versao AS versao, informacoes AS informacoes, imagem AS imagem, monitoramento AS monitoramento FROM tb_consentimentos WHERE id_consentimento = ?", [id]);
  return c ? { documento, id: Number(id), aluno_id: c.aluno_id, versao: c.versao, informacoes: !!c.informacoes, imagem: !!c.imagem, monitoramento: !!c.monitoramento } : null;
}
const cargaAssinatura = (r) => ["SIVE-ASSINATURA-1", r.codigo, r.documento, r.documento_id, r.papel, r.id_usuario, r.nome, r.hash, r.ip || "", r.navegador || "", r.em].join("|");
async function registrarAssinatura({ codigo, documento, documentoId, papel, usuario, nome, req }) {
  const r = { codigo, documento, documento_id: Number(documentoId), papel, id_usuario: usuario.id, nome, hash: hashConteudo(await conteudoAssinado(documento, documentoId)),
    ip: String(req.ip || "").slice(0, 45), navegador: String(req.headers["user-agent"] || "").slice(0, 255), em: agoraLocal() };
  const selo = crypto.sign(null, Buffer.from(cargaAssinatura(r)), CHAVE_ASSINATURA).toString("base64");
  await db.query(`INSERT INTO tb_assinaturas (codigo, documento, documento_id, papel, id_usuario, nome, conteudo_hash, ip, navegador, assinada_em, selo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [r.codigo, r.documento, r.documento_id, r.papel, r.id_usuario, r.nome, r.hash, r.ip, r.navegador, r.em, selo]);
  return r;
}
// Confere a senha de quem vai assinar (com o mesmo bloqueio do login). Devolve o nome cadastrado, ou null depois de já responder o erro.
async function senhaParaAssinar(req, res) {
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) { res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` }); return null; }
  const [[u]] = await db.query("SELECT nome AS nome, senha AS senha FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chave); res.status(400).json({ erro: "Senha incorreta. Para assinar, confirme com a sua senha do sistema." }); return null; }
  tentativas.delete(chave);
  return u.nome;
}

module.exports = { CHAVE_ASSINATURA, CHAVE_VERIFICACAO, novoCodigo, hashConteudo, agoraLocal, conteudoAssinado, cargaAssinatura, registrarAssinatura, senhaParaAssinar };
