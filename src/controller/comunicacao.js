// Controller: o que cada endereço da API faz — comunicados, autorizações, documentos, pendências e verificação de assinaturas.
const QRCode = require("qrcode");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { alunoPermitido } = require("../model/alunos");
const { turmaExiste } = require("../model/turmas");
const { ASSINATURAS_ARQUIVO, DOCUMENTO_CATEGORIAS, PASTA_UPLOADS, TAMANHO_MAXIMO, TIPOS_DOCUMENTO } = require("../model/arquivos");
const { cifrarArquivo, conferirSenha, decifrarArquivo, minutosBloqueado, registrarFalha, tentativas } = require("../model/seguranca");
const { CHAVE_VERIFICACAO, cargaAssinatura, conteudoAssinado, hashConteudo, novoCodigo, registrarAssinatura } = require("../model/assinaturas");
const { ID_TURMA, dataValida, nomeTurma, normalizar } = require("../model/utilitarios");
const { ROTULO_DOCUMENTO, ROTULO_PAPEL, nomeAbreviado } = require("../view/formatos");
const { rota } = require("../middlewares/rota");
const { semPermissao } = require("../middlewares/permissoes");

// ---------- Comunicados ----------
const listarComunicados = rota(async (req, res) => {
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : null;
  const [linhas] = await db.query(`SELECT c.id_comunicado AS id, c.titulo AS titulo, c.texto AS texto, ${nomeTurma("c")} AS sala, c.criado_por_nome AS criado_por_nome, DATE_FORMAT(c.criado_em, '%d/%m/%Y %H:%i') AS criado_em,
    (SELECT COUNT(*) FROM tb_alunos a WHERE a.situacao = 'Ativo' AND (${nomeTurma("c")} IS NULL OR ${nomeTurma("a")} = ${nomeTurma("c")}) AND (? IS NULL OR ${nomeTurma("a")} = ?)) AS destinatarios,
    (SELECT COUNT(*) FROM tb_comunicado_leituras l JOIN tb_alunos a ON a.id_aluno = l.id_aluno WHERE l.id_comunicado = c.id_comunicado AND (? IS NULL OR ${nomeTurma("a")} = ?)) AS lidos
    FROM tb_comunicados c WHERE (? IS NULL OR ${nomeTurma("c")} IS NULL OR ${nomeTurma("c")} = ?) ORDER BY c.id_comunicado DESC LIMIT 50`, [sala, sala, sala, sala, sala, sala]);
  res.json(linhas);
});

const criarComunicado = rota(async (req, res) => {
  const titulo = (req.body.titulo || "").trim(), texto = (req.body.texto || "").trim();
  if (!titulo || titulo.length > 120) return res.status(400).json({ erro: "Informe o título (até 120 caracteres)." });
  if (!texto || texto.length > 1500) return res.status(400).json({ erro: "Escreva o comunicado (até 1500 caracteres)." });
  // Comunicado vai para várias famílias: citar o nome completo de um aluno expõe a criança (ECA, arts. 17 e 18). Pede confirmação.
  const limpo = (x) => normalizar(x).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const textoLimpo = ` ${limpo(`${titulo} ${texto}`)} `;
  const [todosAlunos] = await db.query("SELECT nome AS nome FROM tb_alunos");
  const citados = todosAlunos.map((a) => a.nome).filter((n) => { const k = limpo(n); return k.includes(" ") && textoLimpo.includes(` ${k} `); });
  if (citados.length && req.body.confirmar_nomes !== true)
    return res.status(409).json({ erro: "Este comunicado cita o nome de aluno(s). Todas as famílias que recebem o aviso vão ler. Confirme só se for necessário e se as famílias autorizaram.", codigo: "NOME_DE_ALUNO", alunos: citados });
  // Professor só publica para a própria turma; a gestão escolhe uma turma ou a escola toda
  const sala = req.usuario.papel === "professor" ? req.usuario.sala : ((req.body.sala || "").trim() || null);
  if (sala && !(await turmaExiste(sala))) return res.status(400).json({ erro: "Turma não encontrada." });
  await db.query(`INSERT INTO tb_comunicados (titulo, texto, id_turma, criado_por_nome) VALUES (?, ?, ${ID_TURMA}, ?)`, [titulo, texto, sala, req.usuario.nome]);
  await registrarLog(req.usuario, "comunicado_criado", `${titulo} (${sala || "escola toda"})`);
  if (citados.length) await registrarLog(req.usuario, "comunicado_com_nome_de_aluno", `${citados.length} aluno(s) citado(s) no comunicado "${titulo}"`);
  res.status(201).json({ ok: true });
});

const verLeituras = rota(async (req, res) => {
  const [[c]] = await db.query(`SELECT ${nomeTurma("tb_comunicados")} AS sala FROM tb_comunicados WHERE id_comunicado = ?`, [req.params.id]);
  if (!c) return res.status(404).json({ erro: "Comunicado não encontrado." });
  const salaProf = req.usuario.papel === "professor" ? req.usuario.sala : null;
  if (salaProf && c.sala && c.sala !== salaProf) return res.status(403).json({ erro: "Comunicado de outra turma." });
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, (l.lido_em IS NOT NULL) AS lido, DATE_FORMAT(l.lido_em, '%d/%m/%Y %H:%i') AS lido_em
    FROM tb_alunos a LEFT JOIN tb_comunicado_leituras l ON l.id_aluno = a.id_aluno AND l.id_comunicado = ?
    WHERE a.situacao = 'Ativo' AND (? IS NULL OR ${nomeTurma("a")} = ?) AND (? IS NULL OR ${nomeTurma("a")} = ?) ORDER BY lido, a.nome`, [req.params.id, c.sala, c.sala, salaProf, salaProf]);
  res.json(linhas.map((l) => ({ ...l, lido: !!l.lido })));
});

// O responsável marca o comunicado como lido (vale para o filho dele)
const marcarComunicadoLido = rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável marca como lido." });
  const [[aluno]] = await db.query(`SELECT ${nomeTurma("tb_alunos")} AS sala FROM tb_alunos WHERE id_aluno = ?`, [req.usuario.aluno_id]);
  const [[c]] = await db.query(`SELECT id_comunicado AS id, titulo AS titulo FROM tb_comunicados WHERE id_comunicado = ? AND (${nomeTurma("tb_comunicados")} IS NULL OR ${nomeTurma("tb_comunicados")} = ?)`, [req.params.id, aluno.sala]);
  if (!c) return res.status(404).json({ erro: "Comunicado não encontrado." });
  await db.query("INSERT IGNORE INTO tb_comunicado_leituras (id_comunicado, id_aluno, id_usuario) VALUES (?, ?, ?)", [c.id, req.usuario.aluno_id, req.usuario.id]);
  await registrarLog(req.usuario, "comunicado_lido", c.titulo);
  res.json({ ok: true });
});

// ---------- Autorizações digitais ----------
// A gestão cria a autorização para uma turma ou para a escola toda (uma linha por aluno)
const criarAutorizacao = rota(async (req, res) => {
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
  const [r] = await db.query(`INSERT INTO tb_autorizacoes (tb_autorizacoes.grupo, id_aluno, tb_autorizacoes.titulo, tb_autorizacoes.validade, tb_autorizacoes.valida_ate, tb_autorizacoes.detalhe, tb_autorizacoes.criada_por_nome)
    SELECT ?, id_aluno, ?, ?, ?, ?, ? FROM tb_alunos WHERE tb_alunos.situacao = 'Ativo' AND (? IS NULL OR ${nomeTurma("tb_alunos")} = ?)`, [grupo, titulo, validade || null, validaAte, detalhe || null, req.usuario.nome, sala, sala]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Nenhum aluno encontrado para esse destino." });
  await registrarLog(req.usuario, "autorizacao_criada", `${titulo} (${r.affectedRows} alunos)`);
  res.status(201).json({ ok: true, alunos: r.affectedRows });
});

const listarGruposDeAutorizacao = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT grupo AS grupo, MIN(titulo) AS titulo, MIN(detalhe) AS detalhe, MIN(validade) AS validade,
    DATE_FORMAT(MIN(valida_ate), '%d/%m/%Y') AS valida_ate, (MIN(valida_ate) < CURDATE()) AS vencida,
    DATE_FORMAT(MIN(criada_em), '%d/%m/%Y') AS criada_em, MIN(criada_por_nome) AS criada_por_nome,
    COUNT(*) AS total, COUNT(CASE WHEN assinada THEN 1 END) AS assinadas
    FROM tb_autorizacoes GROUP BY grupo ORDER BY MIN(id_autorizacao) DESC LIMIT 50`);
  res.json(linhas);
});

const verGrupoDeAutorizacao = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT z.id_autorizacao AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, z.assinada AS assinada, z.assinada_nome AS assinada_nome,
    DATE_FORMAT(z.assinada_em, '%d/%m/%Y %H:%i') AS assinada_em, z.codigo AS codigo
    FROM tb_autorizacoes z JOIN tb_alunos a ON a.id_aluno = z.id_aluno WHERE z.grupo = ? ORDER BY z.assinada, a.nome`, [req.params.grupo]);
  res.json(linhas.map((l) => ({ ...l, assinada: !!l.assinada })));
});

// Assinatura digital: o responsável confirma com nome completo + senha. O sistema grava quem, quando e um código de verificação.
const assinarAutorizacao = rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável pode assinar." });
  const [[aut]] = await db.query("SELECT id_autorizacao AS id, id_aluno AS aluno_id, titulo AS titulo, assinada AS assinada, (valida_ate IS NOT NULL AND valida_ate < CURDATE()) AS vencida FROM tb_autorizacoes WHERE id_autorizacao = ?", [req.params.id]);
  if (!aut) return res.status(404).json({ erro: "Autorização não encontrada." });
  if (!req.usuario.filhos.includes(aut.aluno_id)) return res.status(403).json({ erro: "Você só pode assinar autorizações do seu próprio filho." });
  if (aut.assinada) return res.status(400).json({ erro: "Esta autorização já foi assinada." });
  if (aut.vencida) return res.status(400).json({ erro: "O prazo para assinar esta autorização já terminou. Fale com a escola." });
  // Assinar: a pessoa marca "Li e autorizo" e confirma com a senha (o nome vem do cadastro de quem está logado; digitar o nome completo não é mais exigido)
  if (req.body.confirmo !== true && !req.body.nome) return res.status(400).json({ erro: "Marque “Li e autorizo” para assinar." });
  const [[u]] = await db.query("SELECT nome AS nome, senha AS senha FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const chaveAss = `assinatura|${req.usuario.id}`, minutosAss = minutosBloqueado(chaveAss);
  if (minutosAss) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutosAss} minuto(s).` });
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chaveAss); return res.status(400).json({ erro: "Senha incorreta." }); }
  tentativas.delete(chaveAss);
  const codigo = novoCodigo();
  await db.query("UPDATE tb_autorizacoes SET id_usuario_assinatura = ?, assinada_nome = ?, assinada_em = NOW(), codigo = ? WHERE id_autorizacao = ?",
    [req.usuario.id, u.nome, codigo, aut.id]);
  await registrarAssinatura({ codigo, documento: "autorizacao", documentoId: aut.id, papel: "resp", usuario: req.usuario, nome: u.nome, req });
  await registrarLog(req.usuario, "autorizacao_assinada", `${aut.titulo} (código ${codigo})`);
  res.json({ ok: true, codigo });
});

// ---------- Documentos do aluno ----------
const enviarDocumento = rota(async (req, res) => {
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
  const [novo] = await db.query(`INSERT INTO tb_documentos (id_aluno, categoria, titulo, nome_original, arquivo, tipo_mime, tamanho, enviado_por_nome, id_usuario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [aluno.id, categoria, titulo, nomeOriginal, nomeGuardado, TIPOS_DOCUMENTO[ext], arquivo.length, req.usuario.nome, req.usuario.id]);
  let atendeu = false;
  if (pendencia_id) { // se o documento atende a uma pendência do tipo Documento, ela é resolvida junto
    const [r] = await db.query(`UPDATE tb_pendencias SET status = 'Resolvida', resolvida_em = NOW(), resolvida_por_nome = ?
      WHERE id_pendencia = ? AND id_aluno = ? AND tipo = 'Documento' AND status = 'Aberta'`, [req.usuario.nome, pendencia_id, aluno.id]);
    atendeu = r.affectedRows > 0;
    if (atendeu) await db.query("UPDATE tb_documentos SET id_pendencia = ? WHERE id_documento = ?", [pendencia_id, novo.insertId]);
  }
  await registrarLog(req.usuario, "documento_enviado", `${titulo} — ${aluno.nome}`);
  res.status(201).json({ ok: true, pendencia_resolvida: atendeu });
});

const baixarDocumento = rota(async (req, res) => {
  const [[d]] = await db.query("SELECT id_documento AS id, id_aluno AS aluno_id, titulo AS titulo, nome_original AS nome_original, arquivo AS arquivo, tipo_mime AS tipo_mime FROM tb_documentos WHERE id_documento = ? AND categoria NOT LIKE 'CT:%'", [req.params.id]);
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
});

const removerDocumento = rota(async (req, res) => {
  const [[d]] = await db.query("SELECT id_documento AS id, id_aluno AS aluno_id, titulo AS titulo, nome_original AS nome_original, arquivo AS arquivo, tipo_mime AS tipo_mime FROM tb_documentos WHERE id_documento = ? AND categoria NOT LIKE 'CT:%'", [req.params.id]);
  if (!d) return res.status(404).json({ erro: "Documento não encontrado." });
  await db.query("DELETE FROM tb_documentos WHERE id_documento = ?", [d.id]);
  fs.rmSync(path.join(PASTA_UPLOADS, path.basename(d.arquivo)), { force: true });
  await registrarLog(req.usuario, "documento_excluido", d.titulo);
  res.json({ ok: true });
});

// ---------- Pendências (gestão e professor da turma criam; só a gestão resolve) ----------
const criarPendencia = rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.body.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (req.body.descricao || "").trim();
  if (!["Documento", "Cadastro", "Outro"].includes(req.body.tipo)) return res.status(400).json({ erro: "Tipo de pendência inválido." });
  if (!descricao || descricao.length > 200) return res.status(400).json({ erro: "Descreva a pendência (até 200 caracteres)." });
  await db.query("INSERT INTO tb_pendencias (id_aluno, tipo, descricao, criada_por_nome) VALUES (?, ?, ?, ?)", [aluno.id, req.body.tipo, descricao, req.usuario.nome]);
  await registrarLog(req.usuario, "pendencia_criada", `${aluno.nome}: ${descricao}`);
  res.status(201).json({ ok: true });
});

const resolverPendencia = rota(async (req, res) => {
  const [r] = await db.query("UPDATE tb_pendencias SET status = 'Resolvida', resolvida_em = NOW(), resolvida_por_nome = ? WHERE id_pendencia = ? AND status = 'Aberta'", [req.usuario.nome, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Pendência não encontrada ou já resolvida." });
  await registrarLog(req.usuario, "pendencia_resolvida", `pendência id ${req.params.id}`);
  res.json({ ok: true });
});

// ---------- Ações e advertências ----------
const criarAdvertencia = rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.body.aluno_id));
  if (!aluno) return semPermissao(res);
  const descricao = (req.body.descricao || "").trim();
  if (!["Advertencia", "Acao"].includes(req.body.tipo)) return res.status(400).json({ erro: "Tipo inválido." });
  if (!descricao || descricao.length > 500) return res.status(400).json({ erro: "Descreva o ocorrido (até 500 caracteres)." });
  await db.query("INSERT INTO tb_advertencias (id_aluno, tipo, descricao, data, registrada_por_nome) VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?)",
    [aluno.id, req.body.tipo, descricao, dataValida(req.body.data) ? req.body.data : null, req.usuario.nome]);
  await registrarLog(req.usuario, "ocorrencia_registrada", `${req.body.tipo === "Acao" ? "Ação" : "Advertência"} — ${aluno.nome}`);
  res.status(201).json({ ok: true });
});
const limparCodigo = (c) => String(c || "").toUpperCase().replace(/[^0-9A-F]/g, "");
const verificarAssinatura = rota(async (req, res) => {
  const codigo = limparCodigo(req.params.codigo);
  if (codigo.length !== 16) return res.status(400).json({ erro: "O código tem 16 letras e números (ex.: 3F9A0C7E12B45D68)." });
  const [[a]] = await db.query(`SELECT codigo AS codigo, documento AS documento, documento_id AS documento_id, papel AS papel, id_usuario, nome AS nome,
    conteudo_hash AS hash, ip AS ip, navegador AS navegador, DATE_FORMAT(assinada_em, '%Y-%m-%d %H:%i:%s') AS em, selo AS selo FROM tb_assinaturas WHERE codigo = ?`, [codigo]);
  if (!a) {
    // Assinaturas feitas antes da assinatura digital: o código existe, mas não há selo criptográfico para conferir
    const [[antiga]] = await db.query(`SELECT 1 AS ok FROM tb_ocorrencias_escolares WHERE ? IN (tb_ocorrencias_escolares.codigo, tb_ocorrencias_escolares.resp_codigo, tb_ocorrencias_escolares.ges_codigo)
      UNION SELECT 1 FROM tb_autorizacoes WHERE tb_autorizacoes.codigo = ? UNION SELECT 1 FROM tb_consentimentos WHERE tb_consentimentos.codigo = ? LIMIT 1`, [codigo, codigo, codigo]);
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
});
// QR code que abre a verificação (vai nos comprovantes)
const verQrCodeDaAssinatura = rota(async (req, res) => {
  const codigo = limparCodigo(req.params.codigo);
  if (codigo.length !== 16) return res.status(400).end();
  const svg = await QRCode.toString(`${req.protocol}://${req.get("host")}/?verificar=${codigo}`, { type: "svg", margin: 1, color: { dark: "#140040", light: "#FFFFFF" } });
  res.type("image/svg+xml").send(svg);
});

module.exports = { listarComunicados, criarComunicado, verLeituras, marcarComunicadoLido, criarAutorizacao, listarGruposDeAutorizacao, verGrupoDeAutorizacao, assinarAutorizacao, enviarDocumento, baixarDocumento, removerDocumento, criarPendencia, resolverPendencia, criarAdvertencia, limparCodigo, verificarAssinatura, verQrCodeDaAssinatura };
