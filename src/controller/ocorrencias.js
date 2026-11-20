// Controller: o que cada endereço da API faz — ocorrências escolares.
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { alunoPermitido } = require("../model/alunos");
const { novoCodigo, registrarAssinatura, senhaParaAssinar } = require("../model/assinaturas");
const { CONSULTA_OCORRENCIAS, ORDEM_OCORRENCIAS } = require("../model/ocorrencias");
const { ID_TURMA, dataValida, idsOuZero, nomeTurma } = require("../model/utilitarios");
const { rota } = require("../middlewares/rota");
const { semPermissao } = require("../middlewares/permissoes");

const listarOcorrenciasDaTurma = rota(async (req, res) => {
  const [linhas] = await db.query(`${CONSULTA_OCORRENCIAS} WHERE ${nomeTurma("oce")} = ? ${ORDEM_OCORRENCIAS}`, [req.usuario.sala]);
  res.json(linhas);
});
const listarMinhasOcorrencias = rota(async (req, res) => {
  const [linhas] = await db.query(`${CONSULTA_OCORRENCIAS} WHERE oce.id_aluno IN (?) ${ORDEM_OCORRENCIAS}`, [idsOuZero(req.usuario.filhos)]);
  res.json(linhas);
});
// Quantas ocorrências o responsável ainda não assinou (número ao lado de "Ocorrências" no menu)
const contarOcorrenciasNovas = rota(async (req, res) => {
  const [[r]] = await db.query("SELECT COUNT(*) AS n FROM tb_ocorrencias_escolares WHERE id_aluno IN (?) AND resp_assinada_em IS NULL", [idsOuZero(req.usuario.filhos)]);
  res.json({ novas: r.n });
});
// Assinatura de ciência do responsável: o botão insere o nome de quem está logado e o servidor confere com o cadastro
const assinarComoResponsavel = rota(async (req, res) => {
  const [[o]] = await db.query("SELECT id_ocorrencia AS id, id_aluno AS aluno_id, resp_assinada_em AS assinada_em FROM tb_ocorrencias_escolares WHERE id_ocorrencia = ?", [req.params.id]);
  if (!o || !req.usuario.filhos.includes(o.aluno_id)) return res.status(404).json({ erro: "Ocorrência não encontrada." });
  if (o.assinada_em) return res.status(400).json({ erro: "Esta ocorrência já foi assinada." });
  const nome = await senhaParaAssinar(req, res);
  if (!nome) return;
  const u = { nome }, codigo = novoCodigo();
  const [r] = await db.query(`UPDATE tb_ocorrencias_escolares SET id_usuario_resp = ?, resp_nome = ?, resp_assinada_em = NOW(), resp_codigo = ?
    WHERE id_ocorrencia = ? AND resp_assinada_em IS NULL`, [req.usuario.id, u.nome, codigo, o.id]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Esta ocorrência já foi assinada." });
  await registrarAssinatura({ codigo, documento: "ocorrencia", documentoId: o.id, papel: "resp", usuario: req.usuario, nome, req });
  await registrarLog(req.usuario, "ocorrencia_escolar_assinada", `ocorrência id ${o.id} (código ${codigo})`);
  res.json({ ok: true, codigo });
});

// Pasta de ocorrências da gestão (Central do Dia): todas as ocorrências registradas pelos professores.
// Sem a assinatura da gestão, a ocorrência conta no quadro "Ocorrências"; depois de assinada vai para "Ocorrências registradas".
const listarOcorrenciasDaGestao = rota(async (req, res) => {
  const [linhas] = await db.query(`${CONSULTA_OCORRENCIAS} ${ORDEM_OCORRENCIAS}`);
  res.json(linhas);
});
const assinarComoGestao = rota(async (req, res) => {
  const [[o]] = await db.query("SELECT id_ocorrencia AS id, id_aluno AS aluno_id, ges_assinada_em AS assinada_em FROM tb_ocorrencias_escolares WHERE id_ocorrencia = ?", [req.params.id]);
  if (!o) return res.status(404).json({ erro: "Ocorrência não encontrada." });
  if (o.assinada_em) return res.status(400).json({ erro: "Esta ocorrência já foi assinada pela gestão." });
  const nome = await senhaParaAssinar(req, res);
  if (!nome) return;
  const u = { nome }, codigo = novoCodigo();
  const [r] = await db.query(`UPDATE tb_ocorrencias_escolares SET id_usuario_gestao = ?, ges_nome = ?, ges_assinada_em = NOW(), ges_codigo = ?
    WHERE id_ocorrencia = ? AND ges_assinada_em IS NULL`, [req.usuario.id, u.nome, codigo, o.id]);
  if (!r.affectedRows) return res.status(400).json({ erro: "Esta ocorrência já foi assinada pela gestão." });
  await registrarAssinatura({ codigo, documento: "ocorrencia", documentoId: o.id, papel: "gestao", usuario: req.usuario, nome, req });
  await registrarLog(req.usuario, "ocorrencia_escolar_gestao", `ocorrência id ${o.id} (código ${codigo})`);
  res.json({ ok: true, codigo });
});

const registrarOcorrencia = rota(async (req, res) => {
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
  const [novo] = await db.query(`INSERT INTO tb_ocorrencias_escolares (id_aluno, id_turma, data, horario, notificado_em, descricao, buscado_por, id_usuario, professor_nome, codigo)
    VALUES (?, ${ID_TURMA}, ?, ?, ?, ?, ?, ?, ?, ?)`, [aluno.id, aluno.sala, b.data, b.horario, b.notificado_em.replace("T", " ") + ":00", descricao, buscadoPor, req.usuario.id, u.nome, codigo]);
  await registrarAssinatura({ codigo, documento: "ocorrencia", documentoId: novo.insertId, papel: "professor", usuario: req.usuario, nome, req });
  await registrarLog(req.usuario, "ocorrencia_escolar_registrada", `${aluno.nome} (código ${codigo})`);
  res.status(201).json({ ok: true, codigo });
});

module.exports = { listarOcorrenciasDaTurma, listarMinhasOcorrencias, contarOcorrenciasNovas, assinarComoResponsavel, listarOcorrenciasDaGestao, assinarComoGestao, registrarOcorrencia };
