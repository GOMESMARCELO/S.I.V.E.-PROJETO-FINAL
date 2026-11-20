// Controller: o que cada endereço da API faz — calendário de eventos e banners.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { turmaExiste } = require("../model/turmas");
const { BANNER_MAXIMO, CAMPOS_EVENTO, TIPOS_BANNER, TIPOS_EVENTO, filtroEventos } = require("../model/eventos");
const { ASSINATURAS_ARQUIVO, PASTA_UPLOADS } = require("../model/arquivos");
const { cifrarArquivo, decifrarArquivo } = require("../model/seguranca");
const { dataReferencia } = require("../model/frequencia");
const { ID_TURMA, dataValida } = require("../model/utilitarios");
const { formatarEvento } = require("../view/eventos");
const { rota } = require("../middlewares/rota");

const listarEventos = rota(async (req, res) => {
  const hoje = (await dataReferencia()).hoje;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || "") ? req.query.mes : hoje.slice(0, 7);
  const inicio = `${mes}-01`, f = await filtroEventos(req.usuario);
  const [doMes] = await db.query(`SELECT ${CAMPOS_EVENTO} FROM tb_eventos e WHERE e.data < DATE_ADD(?, INTERVAL 1 MONTH) AND COALESCE(e.data_fim, e.data) >= ? AND ${f.sql}
    ORDER BY e.data, e.hora`, [inicio, inicio, ...f.params]);
  const [proximos] = await db.query(`SELECT ${CAMPOS_EVENTO} FROM tb_eventos e WHERE COALESCE(e.data_fim, e.data) >= CURDATE() AND ${f.sql}
    ORDER BY e.data, e.hora LIMIT 8`, f.params);
  res.json({ mes, hoje, tipos: TIPOS_EVENTO, eventos: doMes.map(formatarEvento(req.usuario)), proximos: proximos.map(formatarEvento(req.usuario)) });
});

// Banners: eventos marcados como destaque que ainda não passaram (até 5)
const listarBanners = rota(async (req, res) => {
  const f = await filtroEventos(req.usuario);
  const [linhas] = await db.query(`SELECT ${CAMPOS_EVENTO} FROM tb_eventos e WHERE e.destaque = TRUE AND COALESCE(e.data_fim, e.data) >= CURDATE() AND ${f.sql}
    ORDER BY e.data, e.hora LIMIT 5`, f.params);
  res.json(linhas.map(formatarEvento(req.usuario)));
});

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
const criarEvento = rota(async (req, res) => {
  const ev = await lerEvento(req);
  if (ev.erro) return res.status(400).json({ erro: ev.erro });
  const b = req.body, { titulo, descricao, local, dataFim, hora, sala, arquivo, mime, bytes } = ev;
  if (arquivo) fs.writeFileSync(path.join(PASTA_UPLOADS, arquivo), cifrarArquivo(bytes, arquivo));
  const [r] = await db.query(`INSERT INTO tb_eventos (titulo, descricao, tipo, data, data_fim, hora, local, id_turma, destaque, banner_arquivo, banner_mime, id_usuario, criado_por_nome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ${ID_TURMA}, ?, ?, ?, ?, ?)`, [titulo, descricao || null, b.tipo, b.data, dataFim, hora, local || null, sala, b.destaque === true, arquivo, mime, req.usuario.id, req.usuario.nome]);
  await registrarLog(req.usuario, "evento_criado", `${titulo} (${b.data}, ${sala || "escola toda"})${arquivo ? " com banner" : ""}`);
  res.status(201).json({ ok: true, id: r.insertId });
});

// Editar evento: só a gestão. Uma imagem nova troca o banner; "remover_banner" tira o banner atual.
const editarEvento = rota(async (req, res) => {
  const [[atual]] = await db.query("SELECT id_evento AS id, DATE_FORMAT(data, '%Y-%m-%d') AS data, banner_arquivo AS arquivo, banner_mime AS mime FROM tb_eventos WHERE id_evento = ?", [req.params.id]);
  if (!atual) return res.status(404).json({ erro: "Evento não encontrado." });
  const ev = await lerEvento(req, atual);
  if (ev.erro) return res.status(400).json({ erro: ev.erro });
  const b = req.body, { titulo, descricao, local, dataFim, hora, sala } = ev;
  let arquivo = atual.arquivo, mime = atual.mime;
  if (ev.arquivo || b.remover_banner === true) { arquivo = ev.arquivo; mime = ev.mime; }
  if (ev.arquivo) fs.writeFileSync(path.join(PASTA_UPLOADS, ev.arquivo), cifrarArquivo(ev.bytes, ev.arquivo));
  await db.query(`UPDATE tb_eventos SET titulo = ?, descricao = ?, tipo = ?, data = ?, data_fim = ?, hora = ?, local = ?, id_turma = ${ID_TURMA}, destaque = ?,
    banner_arquivo = ?, banner_mime = ? WHERE id_evento = ?`, [titulo, descricao || null, b.tipo, b.data, dataFim, hora, local || null, sala, b.destaque === true, arquivo, mime, atual.id]);
  if (atual.arquivo && atual.arquivo !== arquivo) fs.rmSync(path.join(PASTA_UPLOADS, path.basename(atual.arquivo)), { force: true });
  await registrarLog(req.usuario, "evento_editado", `${titulo} (${b.data}, ${sala || "escola toda"})`);
  res.json({ ok: true });
});

const removerEvento = rota(async (req, res) => { // excluir: só a gestão
  const [[e]] = await db.query("SELECT id_evento AS id, titulo AS titulo, banner_arquivo AS arquivo, id_usuario AS criador FROM tb_eventos WHERE id_evento = ?", [req.params.id]);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  await db.query("DELETE FROM tb_eventos WHERE id_evento = ?", [e.id]);
  if (e.arquivo) fs.rmSync(path.join(PASTA_UPLOADS, path.basename(e.arquivo)), { force: true });
  await registrarLog(req.usuario, "evento_excluido", e.titulo);
  res.json({ ok: true });
});

// A imagem do banner (criptografada no disco). Só para quem pode ver o evento.
const verBanner = rota(async (req, res) => {
  const f = await filtroEventos(req.usuario);
  const [[e]] = await db.query(`SELECT e.banner_arquivo AS arquivo, e.banner_mime AS mime FROM tb_eventos e WHERE e.id_evento = ? AND ${f.sql}`, [req.params.id, ...f.params]);
  if (!e || !e.arquivo) return res.status(404).json({ erro: "Banner não encontrado." });
  const nome = path.basename(e.arquivo), caminho = path.join(PASTA_UPLOADS, nome);
  if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "Arquivo do banner não encontrado." });
  let conteudo;
  try { conteudo = decifrarArquivo(fs.readFileSync(caminho), nome); }
  catch { return res.status(500).json({ erro: "Não foi possível abrir a imagem do banner. Envie a imagem de novo." }); }
  res.setHeader("Content-Type", e.mime);
  res.send(conteudo);
});

module.exports = { listarEventos, listarBanners, lerEvento, criarEvento, editarEvento, removerEvento, verBanner };
