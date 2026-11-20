// Controller: o que cada endereço da API faz — Proteção (Conselho Tutelar).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { protocolo } = require("../../config");
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { alunoPermitido } = require("../model/alunos");
const { ASSINATURAS_ARQUIVO, PASTA_UPLOADS, TAMANHO_MAXIMO, TIPOS_DOCUMENTO } = require("../model/arquivos");
const { LIMITE_FALTAS_CT, MOTIVOS_PROTECAO, casoPermitido, categoriaCaso, completarProtecao } = require("../model/protecao");
const { cifrarArquivo, decifrarArquivo } = require("../model/seguranca");
const { rota } = require("../middlewares/rota");
const { semPermissao } = require("../middlewares/permissoes");
const { nomeTurma } = require("../model/utilitarios");

const listarCasos = rota(async (req, res) => {
  const ehAdmin = req.usuario.papel === "admin";
  const [itens] = await db.query(`SELECT c.id_comunicacao_conselho AS id, c.id_aluno AS aluno_id, a.nome AS aluno_nome, ${nomeTurma("a")} AS aluno_sala, c.id_busca_ativa AS busca_id,
    c.motivo AS motivo, c.descricao AS descricao, c.medidas AS medidas,
    DATE_FORMAT(c.registrada_em, '%d/%m/%Y %H:%i') AS registrada_em, c.registrada_por_nome AS registrada_por,
    DATE_FORMAT(c.comunicado_em, '%d/%m/%Y') AS comunicado_em, c.comunicado_por_nome AS comunicado_por, c.protocolo AS protocolo,
    (c.comunicado_em IS NULL) AS pendente, DATEDIFF(CURDATE(), DATE(c.registrada_em)) AS dias_registro
    FROM tb_comunicacoes_conselho c JOIN tb_alunos a ON a.id_aluno = c.id_aluno ${ehAdmin ? "" : "WHERE c.id_usuario = ?"}
    ORDER BY (c.comunicado_em IS NULL) DESC, CASE WHEN c.comunicado_em IS NULL THEN c.registrada_em END ASC, c.id_comunicacao_conselho DESC LIMIT 200`, ehAdmin ? [] : [req.usuario.id]);
  const lista = itens.map((i) => ({ ...i, pendente: !!i.pendente }));
  await completarProtecao(lista, req.usuario);
  await registrarLog(req.usuario, "protecao_consultada", `${lista.length} registro(s)`);
  res.json({ pendentes: lista.filter((i) => i.pendente).length, itens: lista });
});

const registrarCaso = rota(async (req, res) => {
  const { aluno_id, motivo, bua_id } = req.body;
  const descricao = String(req.body.descricao || "").trim(), medidas = String(req.body.medidas || "").trim();
  if (!MOTIVOS_PROTECAO.includes(motivo)) return res.status(400).json({ erro: "Escolha o motivo da comunicação." });
  if (descricao.length < 10 || descricao.length > 1500) return res.status(400).json({ erro: "Descreva os fatos (de 10 a 1500 caracteres)." });
  if (medidas.length > 1500) return res.status(400).json({ erro: "As medidas adotadas passam de 1500 caracteres." });
  if (!bua_id && medidas.length < 10) return res.status(400).json({ erro: "Descreva as medidas que a escola já adotou (pelo menos 10 caracteres). Todos os campos são obrigatórios." });
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
      const [humanos] = await db.query("SELECT nome_usuario AS nome, texto AS texto, DATE_FORMAT(data_hora, '%d/%m/%Y') AS dia FROM tb_busca_ativa_registros WHERE id_busca_ativa = ? AND nome_usuario <> 'Sistema' ORDER BY id_busca_ativa_registro", [bua_id]);
      if (!humanos.length) return res.status(400).json({ erro: "Registre ao menos uma ação de acompanhamento (ligação, visita, conversa com a família) antes de comunicar ao Conselho Tutelar: o ECA (art. 56, II) pede que os recursos da escola sejam esgotados." });
      if (!medidasFinal) medidasFinal = humanos.map((h) => `${h.dia} — ${h.nome}: ${h.texto}`).join("\n").slice(0, 1500); // o histórico do acompanhamento vira as "medidas adotadas"
      buaId = caso.id_busca_ativa;
    } else if (medidas.length < 10) return res.status(400).json({ erro: "Descreva as medidas que a escola já adotou." });
  }
  const [r] = await db.query("INSERT INTO tb_comunicacoes_conselho (id_aluno, id_usuario, id_busca_ativa, motivo, descricao, medidas, registrada_por_nome) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [aluno.id, req.usuario.id, buaId, motivo, descricao, medidasFinal, req.usuario.nome]);
  await registrarLog(req.usuario, "protecao_registrada", `${motivo} — aluno id ${aluno.id}`); // o texto dos fatos nunca vai para os logs
  res.status(201).json({ ok: true, id: r.insertId });
});

// A gestão registra que JÁ comunicou ao Conselho Tutelar (data e protocolo/ofício)
const marcarComunicado = rota(async (req, res) => {
  const [[reg]] = await db.query("SELECT id_comunicacao_conselho AS id, comunicado_em AS feito, id_aluno AS aluno_id FROM tb_comunicacoes_conselho WHERE id_comunicacao_conselho = ?", [req.params.id]);
  if (!reg) return res.status(404).json({ erro: "Registro não encontrado." });
  if (reg.feito) return res.status(409).json({ erro: "Este registro já consta como comunicado." });
  const data = String(req.body.data || ""), protocolo = String(req.body.protocolo || "").trim();
  const [[h]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(new Date(data + "T12:00:00").getTime())) return res.status(400).json({ erro: "Informe a data em que a comunicação foi feita." });
  if (data > h.hoje) return res.status(400).json({ erro: "A data da comunicação não pode ser no futuro." });
  if (!protocolo) return res.status(400).json({ erro: "Informe o protocolo ou o número do ofício da comunicação." });
  if (!/^[\p{L}\p{N} ./_-]{1,60}$/u.test(protocolo)) return res.status(400).json({ erro: "Protocolo inválido (até 60 caracteres: letras, números, espaço, ponto, barra e hífen)." });
  await db.query("UPDATE tb_comunicacoes_conselho SET comunicado_em = ?, comunicado_por_nome = ?, protocolo = ? WHERE id_comunicacao_conselho = ?", [data, req.usuario.nome, protocolo || null, reg.id]);
  await registrarLog(req.usuario, "protecao_comunicada", `Registro ${reg.id} — aluno id ${reg.aluno_id}${protocolo ? " — protocolo " + protocolo : ""}`);
  res.json({ ok: true });
});
function lerArquivoEnviado(body) {
  const nomeOriginal = path.basename(String(body.nome_arquivo || "")).slice(0, 200);
  const ext = path.extname(nomeOriginal).slice(1).toLowerCase();
  if (!TIPOS_DOCUMENTO[ext]) return { erro: "Formato não permitido. Use PDF, PNG, JPG, DOC ou DOCX." };
  if (typeof body.conteudo !== "string" || !body.conteudo) return { erro: "Escolha o arquivo do documento assinado." };
  const arquivo = Buffer.from(body.conteudo, "base64");
  if (!arquivo.length) return { erro: "Arquivo vazio." };
  if (arquivo.length > TAMANHO_MAXIMO) return { erro: "O arquivo passa de 5 MB." };
  if (!ASSINATURAS_ARQUIVO[ext].every((b, i) => arquivo[i] === b)) return { erro: `Este arquivo não é um ${ext.toUpperCase()} válido. Confira o arquivo e envie de novo.` };
  const nomeGuardado = crypto.randomBytes(16).toString("hex") + ".enc";
  fs.writeFileSync(path.join(PASTA_UPLOADS, nomeGuardado), cifrarArquivo(arquivo, nomeGuardado));
  return { nomeOriginal, nomeGuardado, mime: TIPOS_DOCUMENTO[ext], tamanho: arquivo.length };
}
function lerTituloAnexo(body) {
  const titulo = String(body.titulo || "").trim();
  return titulo.length >= 3 && titulo.length <= 120 ? titulo : null;
}
// editar o texto do caso (motivo, fatos, medidas): gestão sempre; o docente que registrou, enquanto não foi comunicado
const editarCaso = rota(async (req, res) => {
  const c = await casoPermitido(req.usuario, req.params.id);
  if (!c) return semPermissao(res);
  if (req.usuario.papel !== "admin" && c.comunicado) return res.status(403).json({ erro: "Este caso já foi comunicado ao Conselho Tutelar. Só a gestão pode alterá-lo." });
  const motivo = req.body.motivo, descricao = String(req.body.descricao || "").trim(), medidas = String(req.body.medidas || "").trim();
  if (!MOTIVOS_PROTECAO.includes(motivo)) return res.status(400).json({ erro: "Escolha o motivo." });
  if (motivo === "Faltas" && req.usuario.papel !== "admin") return res.status(403).json({ erro: "A comunicação por faltas é feita pela gestão da escola." });
  if (descricao.length < 10 || descricao.length > 1500) return res.status(400).json({ erro: "Descreva os fatos (de 10 a 1500 caracteres)." });
  if (medidas.length < 10 || medidas.length > 1500) return res.status(400).json({ erro: "Descreva as medidas adotadas (de 10 a 1500 caracteres)." });
  await db.query("UPDATE tb_comunicacoes_conselho SET motivo = ?, descricao = ?, medidas = ? WHERE id_comunicacao_conselho = ?", [motivo, descricao, medidas, c.id]);
  await registrarLog(req.usuario, "protecao_editada", `Registro ${c.id} — aluno id ${c.aluno_id}`); // o texto nunca vai para os logs
  res.json({ ok: true });
});
// anexar documento assinado pelos pais (prova de que foram notificados)
const anexarDocumento = rota(async (req, res) => {
  const c = await casoPermitido(req.usuario, req.params.id);
  if (!c) return semPermissao(res);
  const titulo = lerTituloAnexo(req.body);
  if (!titulo) return res.status(400).json({ erro: "Dê um nome ao documento (de 3 a 120 caracteres). Ex.: Notificação assinada pela mãe." });
  const arq = lerArquivoEnviado(req.body);
  if (arq.erro) return res.status(400).json({ erro: arq.erro });
  await db.query(`INSERT INTO tb_documentos (id_aluno, categoria, titulo, nome_original, arquivo, tipo_mime, tamanho, enviado_por_nome, id_usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.aluno_id, categoriaCaso(c.id), titulo, arq.nomeOriginal, arq.nomeGuardado, arq.mime, arq.tamanho, req.usuario.nome, req.usuario.id]);
  await registrarLog(req.usuario, "protecao_anexo_enviado", `Registro ${c.id} — ${titulo}`);
  res.status(201).json({ ok: true });
});
async function anexoDoCaso(req, res) {
  const c = await casoPermitido(req.usuario, req.params.id);
  if (!c) { semPermissao(res); return null; }
  const [[d]] = await db.query("SELECT id_documento AS id, titulo AS titulo, nome_original AS nome_original, arquivo AS arquivo, tipo_mime AS tipo_mime FROM tb_documentos WHERE id_documento = ? AND categoria = ?", [req.params.doc, categoriaCaso(c.id)]);
  if (!d) { res.status(404).json({ erro: "Documento não encontrado neste caso." }); return null; }
  return { c, d };
}
// editar um anexo: trocar o nome e, se vier arquivo novo, substituir o arquivo
const editarAnexo = rota(async (req, res) => {
  const achou = await anexoDoCaso(req, res); if (!achou) return;
  const titulo = lerTituloAnexo(req.body);
  if (!titulo) return res.status(400).json({ erro: "Dê um nome ao documento (de 3 a 120 caracteres)." });
  if (req.body.conteudo) {
    const arq = lerArquivoEnviado(req.body);
    if (arq.erro) return res.status(400).json({ erro: arq.erro });
    await db.query("UPDATE tb_documentos SET titulo = ?, nome_original = ?, arquivo = ?, tipo_mime = ?, tamanho = ?, enviado_por_nome = ?, enviado_em = NOW(), id_usuario = ? WHERE id_documento = ?",
      [titulo, arq.nomeOriginal, arq.nomeGuardado, arq.mime, arq.tamanho, req.usuario.nome, req.usuario.id, achou.d.id]);
    fs.rmSync(path.join(PASTA_UPLOADS, path.basename(achou.d.arquivo)), { force: true });
  } else await db.query("UPDATE tb_documentos SET titulo = ? WHERE id_documento = ?", [titulo, achou.d.id]);
  await registrarLog(req.usuario, "protecao_anexo_editado", `Registro ${achou.c.id} — ${titulo}`);
  res.json({ ok: true });
});
const removerAnexo = rota(async (req, res) => {
  const achou = await anexoDoCaso(req, res); if (!achou) return;
  await db.query("DELETE FROM tb_documentos WHERE id_documento = ?", [achou.d.id]);
  fs.rmSync(path.join(PASTA_UPLOADS, path.basename(achou.d.arquivo)), { force: true });
  await registrarLog(req.usuario, "protecao_anexo_excluido", `Registro ${achou.c.id} — ${achou.d.titulo}`);
  res.json({ ok: true });
});
const baixarAnexo = rota(async (req, res) => {
  const achou = await anexoDoCaso(req, res); if (!achou) return;
  const nome = path.basename(achou.d.arquivo), caminho = path.join(PASTA_UPLOADS, nome);
  if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "Arquivo não encontrado no servidor." });
  let conteudo;
  try { conteudo = decifrarArquivo(fs.readFileSync(caminho), nome); }
  catch { return res.status(500).json({ erro: "Não foi possível abrir o arquivo: ele foi alterado ou a chave de segurança é outra." }); }
  await registrarLog(req.usuario, "protecao_anexo_baixado", `Registro ${achou.c.id} — ${achou.d.titulo}`);
  const nomeSeguro = encodeURIComponent(achou.d.nome_original).replace(/['()*]/g, (x) => "%" + x.charCodeAt(0).toString(16).toUpperCase());
  res.setHeader("Content-Type", achou.d.tipo_mime);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${nomeSeguro}`);
  res.send(conteudo);
});
// "Tudo da criança": casos (com anexos), ocorrências escolares e advertências de um aluno, num lugar só
const verTudoDaCrianca = rota(async (req, res) => {
  const ehAdmin = req.usuario.papel === "admin", alunoId = Number(req.params.alunoId);
  const [[aluno]] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, a.matricula AS matricula, ${nomeTurma("a")} AS sala FROM tb_alunos a WHERE a.id_aluno = ?`, [alunoId]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [casos] = await db.query(`SELECT c.id_comunicacao_conselho AS id, c.id_aluno AS aluno_id, c.motivo AS motivo, c.descricao AS descricao, c.medidas AS medidas,
    DATE_FORMAT(c.registrada_em, '%d/%m/%Y %H:%i') AS registrada_em, c.registrada_por_nome AS registrada_por, DATE_FORMAT(c.comunicado_em, '%d/%m/%Y') AS comunicado_em,
    c.comunicado_por_nome AS comunicado_por, c.protocolo AS protocolo, (c.comunicado_em IS NULL) AS pendente
    FROM tb_comunicacoes_conselho c WHERE c.id_aluno = ? ${ehAdmin ? "" : "AND c.id_usuario = ?"} ORDER BY c.registrada_em DESC`, ehAdmin ? [alunoId] : [alunoId, req.usuario.id]);
  if (!ehAdmin && !casos.length) return semPermissao(res);
  const lista = casos.map((c) => ({ ...c, pendente: !!c.pendente }));
  await completarProtecao(lista, req.usuario);
  const [ocorrencias] = await db.query(`SELECT DATE_FORMAT(data, '%d/%m/%Y') AS data, TIME_FORMAT(horario, '%H:%i') AS horario, descricao AS descricao, professor_nome AS professor
    FROM tb_ocorrencias_escolares WHERE id_aluno = ? ORDER BY data DESC, horario DESC`, [alunoId]);
  const [advertencias] = await db.query(`SELECT DATE_FORMAT(data, '%d/%m/%Y') AS data, tipo AS tipo, descricao AS descricao, registrada_por_nome AS registrada_por
    FROM tb_advertencias WHERE id_aluno = ? ORDER BY data DESC, id_advertencia DESC`, [alunoId]);
  await registrarLog(req.usuario, "protecao_crianca_consultada", `aluno id ${alunoId}`);
  res.json({ aluno, casos: lista, ocorrencias, advertencias });
});

// LDB, art. 12, VIII: relação dos alunos com faltas acima do limite (calculada sobre os dias com chamada registrada no sistema)
const listarFaltasNoLimite = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, COUNT(p.id_presenca) AS dias,
    COUNT(CASE WHEN p.status = 'Ausente' THEN 1 END) AS faltas,
    EXISTS(SELECT 1 FROM tb_comunicacoes_conselho c WHERE c.id_aluno = a.id_aluno AND c.motivo = 'Faltas') AS comunicado
    FROM tb_alunos a JOIN tb_presencas p ON p.id_aluno = a.id_aluno WHERE a.situacao = 'Ativo' GROUP BY a.id_aluno, a.nome, ${nomeTurma("a")}
    HAVING COUNT(p.id_presenca) > 0 AND COUNT(CASE WHEN p.status = 'Ausente' THEN 1 END) * 100 > COUNT(p.id_presenca) * ?
    ORDER BY COUNT(CASE WHEN p.status = 'Ausente' THEN 1 END) / COUNT(p.id_presenca) DESC, a.nome`, [LIMITE_FALTAS_CT]);
  res.json({ percentual: LIMITE_FALTAS_CT, alunos: linhas.map((l) => ({ ...l, percentual: Math.round((l.faltas * 1000) / l.dias) / 10, comunicado: !!l.comunicado })) });
});

module.exports = { listarCasos, registrarCaso, marcarComunicado, lerArquivoEnviado, lerTituloAnexo, editarCaso, anexarDocumento, anexoDoCaso, editarAnexo, removerAnexo, baixarAnexo, verTudoDaCrianca, listarFaltasNoLimite };
