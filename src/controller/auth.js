// Controller: o que cada endereço da API faz — login, senha, duas etapas e política de privacidade.
const QRCode = require("qrcode");
const crypto = require("crypto");
const { enviarEmail, simulado: emailSimulado, telefoneSimulado, enviarMensagemTelefone } = require("../../email");
const { config, protocolo } = require("../../config");
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { INATIVIDADE, contextoDoUsuario, lerAcessibilidade, verificarInatividade } = require("../model/usuarios");
const { HASH_FALSO, SEG, conferirSenha, gerarToken, guardarSegredo2fa, hashSenha, lerSegredo2fa, minutosBloqueado, paraBase32, problemaNaSenha, registrarFalha, tentativas, totpConfere } = require("../model/seguranca");
const { emailValido, nomeTurma, soNumeros } = require("../model/utilitarios");
const { mascararDestino } = require("../view/formatos");
const { POLITICA } = require("../view/politica");
const { rota } = require("../middlewares/rota");

const verPrivacidade = (req, res) => res.json(POLITICA); // pública: a política pode ser lida antes do login

const entrar = rota(async (req, res) => {
  const { usuario, senha, codigo } = req.body;
  const login = String(usuario || "").toLowerCase();
  const chave = `par|${req.ip}|${login}`, chaveConta = `conta|${login}`, chaveIp = `ip|${req.ip}`;
  const minutos = Math.max(minutosBloqueado(chave), minutosBloqueado(chaveConta), minutosBloqueado(chaveIp));
  if (minutos) {
    await registrarLog(null, "login_bloqueado", `Usuário "${usuario}" bloqueado por tentativas erradas`);
    return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  }
  await verificarInatividade(); // confere os 60 dias antes de deixar entrar
  const [linhas] = await db.query(`SELECT id_usuario AS id, papel AS papel, id_aluno AS aluno_id, ${nomeTurma("tb_usuarios")} AS sala, nome AS nome, senha_temporaria AS senha_temporaria, senha AS senha, aceite_versao AS aceite_versao, ativo AS ativo, inativado_motivo AS motivo, id_responsavel AS id_responsavel, sessao_versao AS sessao, ativo_2fa AS dois_ativo, segredo_2fa AS dois_segredo, metodo_2fa AS dois_metodo, destino_2fa AS dois_destino, codigo_hash_2fa AS codigo_hash, codigo_expira_2fa > NOW() AS codigo_valido, codigo_expira_2fa > NOW() + INTERVAL 9 MINUTE AS codigo_recente, tutorial_visto_em AS tutorial_visto, acessibilidade AS acessibilidade FROM tb_usuarios WHERE login = ?`, [String(usuario || "")]);
  const u = linhas[0];
  const senhaOk = await conferirSenha(senha, u ? u.senha : HASH_FALSO);
  if (u && senhaOk && !u.ativo && u.motivo === "inatividade") { // senha certa, mas o acesso foi suspenso por 60 dias sem uso
    tentativas.delete(chave);
    const [r] = await db.query("UPDATE tb_usuarios SET reativacao_pedida_em = NOW() WHERE id_usuario = ? AND reativacao_pedida_em IS NULL", [u.id]);
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
    if (!noAplicativo) await db.query("UPDATE tb_usuarios SET codigo_hash_2fa = NULL, codigo_expira_2fa = NULL WHERE id_usuario = ?", [u.id]); // cada código vale uma vez
  }
  tentativas.delete(chave); tentativas.delete(chaveConta);
  // Senha que não segue as regras (ex.: 123456): entra, mas é obrigado a trocar antes de usar o sistema
  const senhaFraca = !u.senha_temporaria && !!problemaNaSenha(senha, login);
  if (senhaFraca) await db.query("UPDATE tb_usuarios SET senha_temporaria = TRUE WHERE id_usuario = ?", [u.id]);
  if (!u.senha.startsWith("scrypt$")) await db.query("UPDATE tb_usuarios SET senha = ? WHERE id_usuario = ?", [await hashSenha(senha), u.id]);
  await db.query("UPDATE tb_usuarios SET ultimo_acesso = NOW() WHERE id_usuario = ?", [u.id]);
  await registrarLog(u, "login_sucesso", null);
  const ctx = await contextoDoUsuario(u);
  res.json({ token: gerarToken(u), id: u.id, usuario: login, papel: u.papel, nome: u.nome, aluno_id: ctx.alunoPadrao, sala: ctx.salaPadrao, filhos: ctx.filhos, turmas: ctx.turmas,
    senha_temporaria: !!u.senha_temporaria || senhaFraca, senha_fraca: senhaFraca, aceite_ok: u.aceite_versao === POLITICA.versao,
    configurar_2fa: SEG.doisFatoresGestao && u.papel === "admin" && !u.dois_ativo, tutorial_visto: !!u.tutorial_visto, acessibilidade: lerAcessibilidade(u.acessibilidade) });
});

// Esqueci minha senha: manda um link de uso único para o e-mail da pessoa. Sem e-mail (ou se o envio falhar), o pedido vai para a gestão.
// A resposta é sempre a mesma e não espera o envio, exista ou não o usuário: esta rota não serve para descobrir quem tem conta.
// No banco fica só o hash do código: quem ler a tabela não consegue usar o link. A senha só muda em /api/redefinir-senha.
const RECUPERACAO_MINUTOS = 30;
const hashDoCodigo = (codigo) => crypto.createHash("sha256").update(codigo).digest("hex");
async function pedirSenhaAGestao(login) {
  const [r] = await db.query("UPDATE tb_usuarios SET senha_pedida_em = NOW() WHERE login = ? AND ativo = TRUE AND senha_pedida_em IS NULL", [login]);
  if (r.affectedRows) await registrarLog(null, "recuperacao_senha_pedida", `Usuário "${login}"`);
}
async function iniciarRecuperacao(login) {
  const [[u]] = await db.query(`SELECT COALESCE(u.email, r.email) AS email, u.recuperacao_expira > NOW() + INTERVAL ? MINUTE AS recente
    FROM tb_usuarios u LEFT JOIN tb_resp r ON r.id_responsavel = u.id_responsavel WHERE u.login = ? AND u.ativo = TRUE`, [RECUPERACAO_MINUTOS - 2, login]);
  if (!u) return;
  if (!u.email) return pedirSenhaAGestao(login);
  if (u.recente) return; // já mandou há menos de 2 minutos: não enche a caixa de entrada da pessoa
  const codigo = crypto.randomBytes(32).toString("hex");
  await db.query("UPDATE tb_usuarios SET recuperacao_hash = ?, recuperacao_expira = NOW() + INTERVAL ? MINUTE WHERE login = ?", [hashDoCodigo(codigo), RECUPERACAO_MINUTOS, login]);
  // O endereço vem do .env (EMAIL_URL_BASE), nunca do pedido: assim ninguém forja um link que aponte para outro site
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
const recuperarSenha = rota(async (req, res) => {
  const login = String((req.body || {}).usuario || "").trim().toLowerCase().slice(0, 60);
  if (login) iniciarRecuperacao(login).catch((erro) => console.error("Recuperação de senha:", erro.message));
  res.json({ ok: true });
});
const redefinirSenha = rota(async (req, res) => {
  const { codigo, senha } = req.body || {};
  const [[u]] = /^[0-9a-f]{64}$/.test(String(codigo)) ? await db.query(`SELECT id_usuario AS id, nome AS nome, papel AS papel, login AS login FROM tb_usuarios
    WHERE recuperacao_hash = ? AND recuperacao_expira > NOW() AND ativo = TRUE`, [hashDoCodigo(codigo)]) : [[]];
  if (!u) return res.status(400).json({ erro: "Este link é inválido ou já venceu. Peça um novo em Esqueci minha senha." });
  const problema = problemaNaSenha(senha, u.login);
  if (problema) return res.status(400).json({ erro: problema });
  await db.query(`UPDATE tb_usuarios SET senha = ?, senha_temporaria = FALSE, senha_pedida_em = NULL, recuperacao_hash = NULL, recuperacao_expira = NULL,
    sessao_versao = sessao_versao + 1 WHERE id_usuario = ?`, [await hashSenha(senha), u.id]);
  tentativas.delete(`conta|${u.login}`);
  await registrarLog(u, "senha_redefinida_email", "outras sessões encerradas");
  res.json({ ok: true });
});

// ---------- Trocar a própria senha (qualquer papel) ----------
const trocarMinhaSenha = rota(async (req, res) => {
  const { senha_atual, senha_nova } = req.body;
  const [[u]] = await db.query("SELECT senha AS senha, login AS login FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const problema = problemaNaSenha(senha_nova, u && u.login);
  if (problema) return res.status(400).json({ erro: problema });
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  if (!u || !(await conferirSenha(senha_atual, u.senha))) { registrarFalha(chave); return res.status(400).json({ erro: "Senha atual incorreta." }); }
  if (senha_atual === senha_nova) return res.status(400).json({ erro: "A nova senha precisa ser diferente da atual." });
  await db.query("UPDATE tb_usuarios SET senha = ?, senha_temporaria = FALSE, senha_pedida_em = NULL, recuperacao_hash = NULL, recuperacao_expira = NULL, sessao_versao = sessao_versao + 1 WHERE id_usuario = ?", [await hashSenha(senha_nova), req.usuario.id]);
  await registrarLog(req.usuario, "troca_senha", "outras sessões encerradas");
  const [[novo]] = await db.query("SELECT id_usuario AS id, sessao_versao AS sessao FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  res.json({ ok: true, token: gerarToken(novo) }); // este navegador continua logado; os outros saem
});

// "Sair": encerra o login em todos os aparelhos (o token antigo deixa de valer na hora)
const sair = rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET sessao_versao = sessao_versao + 1 WHERE id_usuario = ?", [req.usuario.id]);
  await registrarLog(req.usuario, "logout", null);
  res.json({ ok: true });
});

// Duas etapas por e-mail, SMS ou WhatsApp: código de 6 números que vale 10 minutos e uma vez só.
// No banco fica só um HMAC com a chave do servidor: com tão poucos números, um hash simples seria descoberto por tentativa.
const hashCodigo2fa = (usuId, codigo) => crypto.createHmac("sha256", config.seguranca.segredo_token).update(`2fa|${usuId}|${codigo}`).digest("hex");
const envioSimulado = (metodo) => (metodo === "email" ? emailSimulado : telefoneSimulado);
async function enviarCodigo2fa(usuId, metodo, destino) {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await db.query("UPDATE tb_usuarios SET codigo_hash_2fa = ?, codigo_expira_2fa = NOW() + INTERVAL 10 MINUTE WHERE id_usuario = ?", [hashCodigo2fa(usuId, codigo), usuId]);
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
const novoDoisFatores = rota(async (req, res) => {
  const [[u]] = await db.query("SELECT login AS login, ativo_2fa AS ativo FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  if (u.ativo) return res.status(400).json({ erro: "A verificação em duas etapas já está ligada." });
  const metodo = (req.body || {}).metodo || "app";
  if (metodo === "app") {
    const segredo = paraBase32(crypto.randomBytes(20));
    await db.query("UPDATE tb_usuarios SET segredo_2fa = ?, metodo_2fa = 'app', destino_2fa = NULL, codigo_hash_2fa = NULL, codigo_expira_2fa = NULL WHERE id_usuario = ?", [guardarSegredo2fa(req.usuario.id, segredo), req.usuario.id]);
    const url = `otpauth://totp/${encodeURIComponent("SIVE:" + u.login)}?secret=${segredo}&issuer=SIVE&digits=6&period=30`;
    return res.json({ segredo, qr: await QRCode.toString(url, { type: "svg", margin: 1 }) });
  }
  if (!["email", "sms", "whatsapp"].includes(metodo)) return res.status(400).json({ erro: "Escolha uma das opções." });
  const destino = metodo === "email" ? String(req.body.destino || "").trim().toLowerCase() : soNumeros(req.body.destino);
  if (metodo === "email" && !emailValido(destino)) return res.status(400).json({ erro: "Informe um e-mail válido." });
  if (metodo !== "email" && !/^[1-9]{2}9?\d{8}$/.test(destino)) return res.status(400).json({ erro: "Informe o celular com DDD (ex.: 11 98765-4321)." });
  await db.query("UPDATE tb_usuarios SET segredo_2fa = NULL, metodo_2fa = ?, destino_2fa = ? WHERE id_usuario = ?", [metodo, destino, req.usuario.id]);
  try { await enviarCodigo2fa(req.usuario.id, metodo, destino); }
  catch (erro) { console.error("Código de verificação:", erro.message); return res.status(502).json({ erro: "Não foi possível enviar o código agora. Confira os dados ou escolha outra opção." }); }
  res.json({ ok: true, destino: mascararDestino(metodo, destino), simulado: envioSimulado(metodo) });
});
// Liga as duas etapas depois que a pessoa digita um código certo (prova que recebe o código)
const ativarDoisFatores = rota(async (req, res) => {
  const [[u]] = await db.query(`SELECT segredo_2fa AS segredo, ativo_2fa AS ativo, metodo_2fa AS metodo, codigo_hash_2fa AS codigo_hash,
    codigo_expira_2fa > NOW() AS codigo_valido FROM tb_usuarios WHERE id_usuario = ?`, [req.usuario.id]);
  if (u.ativo) return res.status(400).json({ erro: "A verificação em duas etapas já está ligada." });
  const chave = `2fa-ativar|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  const noAplicativo = (u.metodo || "app") === "app";
  if (noAplicativo && !u.segredo) return res.status(400).json({ erro: "Gere o QR code antes de digitar o código." });
  if (!(noAplicativo ? totpConfere(lerSegredo2fa(req.usuario.id, u.segredo), req.body.codigo) : codigo2faConfere(req.usuario.id, u, req.body.codigo))) {
    registrarFalha(chave);
    return res.status(400).json({ erro: noAplicativo ? "Código inválido. Confira o horário do celular e digite o código que aparece agora." : "Código inválido ou vencido. Confira e tente de novo." });
  }
  await db.query("UPDATE tb_usuarios SET ativo_2fa = TRUE, codigo_hash_2fa = NULL, codigo_expira_2fa = NULL WHERE id_usuario = ?", [req.usuario.id]);
  await registrarLog(req.usuario, "2fa_ativada", noAplicativo ? "aplicativo" : u.metodo);
  res.json({ ok: true });
});

const aceitarPrivacidade = rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET aceite_em = NOW(), aceite_versao = ? WHERE id_usuario = ?", [POLITICA.versao, req.usuario.id]);
  await registrarLog(req.usuario, "aceite_privacidade", `Política de privacidade versão ${POLITICA.versao}`);
  res.json({ ok: true });
});

module.exports = { verPrivacidade, entrar, RECUPERACAO_MINUTOS, hashDoCodigo, pedirSenhaAGestao, iniciarRecuperacao, recuperarSenha, redefinirSenha, trocarMinhaSenha, sair, hashCodigo2fa, envioSimulado, enviarCodigo2fa, codigo2faConfere, novoDoisFatores, ativarDoisFatores, aceitarPrivacidade };
