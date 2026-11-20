// Controller: o que cada endereço da API faz — cadastro, ficha e exportação LGPD dos alunos.
const importador = require("../../importar-alunos");
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { alunoPermitido } = require("../model/alunos");
const { RETENCAO_RECONHECIMENTOS_DIAS } = require("../model/rotina");
const { turmaExiste } = require("../model/turmas");
const { DOCUMENTO_CATEGORIAS } = require("../model/arquivos");
const { consentimentoDoAluno } = require("../model/consentimento");
const { statusAoVivo } = require("../model/monitoramento");
const { rota } = require("../middlewares/rota");
const { semPermissao } = require("../middlewares/permissoes");
const { nomeTurma, ID_TURMA } = require("../model/utilitarios");

// ---------- Secretaria (só administração) ----------
const listarAlunos = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT id_aluno AS id, nome AS nome, ${nomeTurma("tb_alunos")} AS sala, matricula AS matricula, situacao AS situacao, DATE_FORMAT(situacao_em, '%d/%m/%Y') AS situacao_em FROM tb_alunos ORDER BY id_aluno`);
  res.json(linhas);
});

// Cadastro completo de um aluno: dados da criança + responsáveis (pai/mãe/etc.)
const criarAluno = rota(async (req, res) => {
  const { nome, sala, matricula, responsaveis } = req.body;
  if (!nome || !sala) return res.status(400).json({ erro: "Informe o nome do aluno e a turma." });
  if (!(await turmaExiste(sala))) return res.status(400).json({ erro: "Escolha uma turma cadastrada. Se ela ainda não existe, cadastre em Alunos e turmas." });
  let resultado;
  try { [resultado] = await db.query(`INSERT INTO tb_alunos (nome, id_turma, matricula) VALUES (?, ${ID_TURMA}, ?)`, [nome, sala, matricula || null]); }
  catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe um aluno com essa matrícula." });
    throw erro;
  }
  const alunoId = resultado.insertId;
  for (const r of responsaveis || []) {
    if (!r.nome) continue;
    const [[existe]] = await db.query("SELECT id_responsavel AS id FROM tb_resp WHERE nome = ? AND telefone <=> ?", [r.nome, r.telefone || null]);
    const responsavelId = existe ? existe.id : (await db.query("INSERT INTO tb_resp (nome, telefone) VALUES (?, ?)", [r.nome, r.telefone || null]))[0].insertId;
    await db.query("INSERT INTO tb_aluno_resp (id_aluno, id_responsavel, parentesco) VALUES (?, ?, ?)", [alunoId, responsavelId, r.parentesco || "Responsável"]);
  }
  await registrarLog(req.usuario, "cadastro_aluno", `${nome} (${sala})`);
  res.status(201).json({ ok: true, id: alunoId });
});

// ---------- Importar vários alunos de uma planilha (CSV ou Excel) — só administração ----------
// Dois passos na mesma rota: confirmar = false só CONFERE a planilha e devolve a pré-visualização; confirmar = true grava.
// Só entram as linhas "ok". Erros e duplicados ficam de fora. A gravação é tudo ou nada (transação).
const importarAlunos = rota(async (req, res) => {
  const { nome_arquivo, conteudo, turma_padrao, confirmar } = req.body;
  if (typeof conteudo !== "string") return res.status(400).json({ erro: "Escolha um arquivo para importar." });
  const buffer = Buffer.from(conteudo, "base64");
  if (buffer.length > importador.TAMANHO_MAXIMO) return res.status(400).json({ erro: "O arquivo tem mais de 2 MB. Divida a planilha em partes." });
  let analise;
  try { analise = importador.analisar(await importador.lerPlanilha(buffer), { turmaPadrao: typeof turma_padrao === "string" ? turma_padrao : "" }); }
  catch (erro) { if (erro instanceof importador.ErroPlanilha) return res.status(400).json({ erro: erro.message }); throw erro; }
  const [existentes] = await db.query(`SELECT nome AS nome, ${nomeTurma("tb_alunos")} AS sala, matricula AS matricula FROM tb_alunos`);
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
      await conexao.query("INSERT IGNORE INTO tb_turmas (nome, ano_letivo) VALUES (?, YEAR(CURDATE()))", [l.sala]);
      const [r] = await conexao.query(`INSERT INTO tb_alunos (nome, id_turma, matricula) VALUES (?, ${ID_TURMA}, ?)`, [l.nome, l.sala, l.matricula || null]);
      for (const resp of l.responsaveis) { // mesmo responsável (nome + telefone) de irmãos é reaproveitado, como no cadastro individual
        const [[existe]] = await conexao.query("SELECT id_responsavel AS id FROM tb_resp WHERE nome = ? AND telefone <=> ?", [resp.nome, resp.telefone || null]);
        const respId = existe ? existe.id : (await conexao.query("INSERT INTO tb_resp (nome, telefone) VALUES (?, ?)", [resp.nome, resp.telefone || null]))[0].insertId;
        await conexao.query("INSERT INTO tb_aluno_resp (id_aluno, id_responsavel, parentesco) VALUES (?, ?, ?)", [r.insertId, respId, resp.parentesco]);
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
});

// ---------- Situação do aluno (só administração): quem sai da escola não é apagado, só sai das listas do dia a dia ----------
const SITUACOES = ["Ativo", "Transferido", "Concluiu", "Desistente"];
const atualizarSituacao = rota(async (req, res) => {
  const situacao = String(req.body.situacao || ""), motivo = String(req.body.motivo || "").trim().slice(0, 200);
  if (!SITUACOES.includes(situacao)) return res.status(400).json({ erro: "Situação inválida." });
  const [[a]] = await db.query("SELECT nome AS nome FROM tb_alunos WHERE id_aluno = ?", [req.params.alunoId]);
  if (!a) return res.status(404).json({ erro: "Aluno não encontrado." });
  await db.query("UPDATE tb_alunos SET situacao = ?, situacao_em = IF(? = 'Ativo', NULL, CURDATE()), situacao_motivo = ? WHERE id_aluno = ?",
    [situacao, situacao, situacao === "Ativo" ? null : motivo || null, req.params.alunoId]);
  await registrarLog(req.usuario, "aluno_situacao", `${a.nome}: ${situacao}`);
  res.json({ ok: true });
});

// Nome e sala do próprio filho (usado no Portal dos Pais)
const verAluno = rota(async (req, res) => {
  const [[aluno]] = await db.query(`SELECT nome AS nome, ${nomeTurma("tb_alunos")} AS sala FROM tb_alunos WHERE id_aluno = ?`, [req.params.alunoId]);
  res.json(aluno || null);
});

// ---------- Tabela interativa de gestão de alunos (só administração) ----------
const listarGestaoDeAlunos = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala,
    (SELECT COUNT(*) FROM tb_comunicados c WHERE ${nomeTurma("c")} IS NULL OR ${nomeTurma("c")} = ${nomeTurma("a")}) AS com_total,
    (SELECT COUNT(*) FROM tb_comunicado_leituras l JOIN tb_comunicados c ON c.id_comunicado = l.id_comunicado
       WHERE l.id_aluno = a.id_aluno AND (${nomeTurma("c")} IS NULL OR ${nomeTurma("c")} = ${nomeTurma("a")})) AS com_lidos,
    (SELECT COUNT(*) FROM tb_autorizacoes z WHERE z.id_aluno = a.id_aluno AND z.assinada = TRUE) AS aut_assinadas,
    (SELECT COUNT(*) FROM tb_autorizacoes z WHERE z.id_aluno = a.id_aluno AND z.assinada = FALSE AND (z.valida_ate IS NULL OR z.valida_ate >= CURDATE())) AS aut_pendentes,
    (SELECT COUNT(*) FROM tb_pendencias p WHERE p.id_aluno = a.id_aluno AND p.status = 'Aberta') AS pend_abertas,
    (SELECT GROUP_CONCAT(DISTINCT p.tipo SEPARATOR ',') FROM tb_pendencias p WHERE p.id_aluno = a.id_aluno AND p.status = 'Aberta') AS pend_tipos,
    (SELECT COUNT(*) FROM tb_advertencias o WHERE o.id_aluno = a.id_aluno AND o.tipo = 'Advertencia') AS advertencias,
    (SELECT COUNT(*) FROM tb_advertencias o WHERE o.id_aluno = a.id_aluno AND o.tipo = 'Acao') AS acoes
    FROM tb_alunos a WHERE a.situacao = 'Ativo' ORDER BY a.nome`);
  res.json(linhas);
});

// ---------- Ficha do aluno: tudo do aluno em uma resposta ----------
const verFicha = rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  const [responsaveis] = await db.query(`SELECT r.nome AS nome, ar.parentesco AS parentesco, r.telefone AS telefone, r.telefone2 AS telefone2, r.email AS email, r.contato_preferido AS contato_preferido
    FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?`, [aluno.id]);
  const [comunicados] = await db.query(`SELECT c.id_comunicado AS id, c.titulo AS titulo, c.texto AS texto, ${nomeTurma("c")} AS sala, c.criado_por_nome AS criado_por_nome, DATE_FORMAT(c.criado_em, '%d/%m/%Y') AS data,
    (l.lido_em IS NOT NULL) AS lido, DATE_FORMAT(l.lido_em, '%d/%m/%Y %H:%i') AS lido_em
    FROM tb_comunicados c LEFT JOIN tb_comunicado_leituras l ON l.id_comunicado = c.id_comunicado AND l.id_aluno = ?
    WHERE ${nomeTurma("c")} IS NULL OR ${nomeTurma("c")} = ? ORDER BY c.id_comunicado DESC`, [aluno.id, aluno.sala]);
  const [autorizacoes] = await db.query(`SELECT id_autorizacao AS id, titulo AS titulo, validade AS validade, detalhe AS detalhe, assinada AS assinada, assinada_nome AS assinada_nome,
    DATE_FORMAT(assinada_em, '%d/%m/%Y %H:%i') AS assinada_em, codigo AS codigo, DATE_FORMAT(valida_ate, '%d/%m/%Y') AS valida_ate,
    (assinada = FALSE AND valida_ate IS NOT NULL AND valida_ate < CURDATE()) AS vencida
    FROM tb_autorizacoes WHERE id_aluno = ? ORDER BY vencida, assinada, id_autorizacao DESC`, [aluno.id]);
  const [documentos] = await db.query(`SELECT id_documento AS id, categoria AS categoria, titulo AS titulo, nome_original AS nome_original, tamanho AS tamanho, enviado_por_nome AS enviado_por_nome,
    DATE_FORMAT(enviado_em, '%d/%m/%Y') AS enviado_em FROM tb_documentos WHERE id_aluno = ? AND categoria NOT LIKE 'CT:%' ORDER BY id_documento DESC`, [aluno.id]);
  const [pendencias] = await db.query(`SELECT id_pendencia AS id, tipo AS tipo, descricao AS descricao, status AS status, criada_por_nome AS criada_por_nome, DATE_FORMAT(criada_em, '%d/%m/%Y') AS criada_em,
    DATE_FORMAT(resolvida_em, '%d/%m/%Y') AS resolvida_em, resolvida_por_nome AS resolvida_por_nome FROM tb_pendencias WHERE id_aluno = ?
    ORDER BY (status = 'Aberta') DESC, id_pendencia DESC`, [aluno.id]);
  const [ocorrencias] = await db.query(`SELECT id_advertencia AS id, tipo AS tipo, descricao AS descricao, DATE_FORMAT(data, '%d/%m/%Y') AS data, registrada_por_nome AS registrada_por_nome
    FROM tb_advertencias WHERE id_aluno = ? ORDER BY data DESC, id_advertencia DESC`, [aluno.id]);
  res.json({
    aluno, responsaveis, categorias: DOCUMENTO_CATEGORIAS,
    comunicados: comunicados.map((c) => ({ ...c, lido: !!c.lido })),
    autorizacoes: autorizacoes.map((a) => ({ ...a, assinada: !!a.assinada, vencida: !!a.vencida })),
    documentos, pendencias, ocorrencias,
    consentimento: await consentimentoDoAluno(aluno.id, req.usuario.papel !== "professor"),
    agora: (await statusAoVivo({ alunoId: aluno.id }))[0] || null,
  });
});

// Direito de acesso (LGPD, art. 18): entrega todos os dados do aluno em um arquivo. Admin, ou o responsável do próprio aluno.
const exportarDadosDoAluno = rota(async (req, res) => {
  const id = Number(req.params.alunoId);
  const [[aluno]] = await db.query(`SELECT id_aluno AS id, nome AS nome, ${nomeTurma("tb_alunos")} AS sala, matricula AS matricula FROM tb_alunos WHERE id_aluno = ?`, [id]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [responsaveis] = await db.query("SELECT r.nome AS nome, ar.parentesco AS parentesco, r.telefone AS telefone FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?", [id]);
  const [presencas] = await db.query("SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, status AS status, observacao AS observacao FROM tb_presencas WHERE id_aluno = ? ORDER BY data", [id]);
  const [advertencias] = await db.query("SELECT tipo AS tipo, descricao AS descricao, DATE_FORMAT(data, '%Y-%m-%d') AS data, registrada_por_nome AS registrada_por FROM tb_advertencias WHERE id_aluno = ? ORDER BY data", [id]);
  const [ocorrenciasEscolares] = await db.query("SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, TIME_FORMAT(horario, '%H:%i') AS horario, descricao AS descricao, buscado_por AS buscado_por, professor_nome AS professor, resp_nome AS ciencia_responsavel, DATE_FORMAT(resp_assinada_em, '%Y-%m-%d %H:%i') AS ciencia_em FROM tb_ocorrencias_escolares WHERE id_aluno = ? ORDER BY data", [id]);
  const [pendencias] = await db.query("SELECT tipo AS tipo, descricao AS descricao, status AS status, DATE_FORMAT(criada_em, '%Y-%m-%d %H:%i') AS criada_em FROM tb_pendencias WHERE id_aluno = ? ORDER BY id_pendencia", [id]);
  const [autorizacoes] = await db.query("SELECT titulo AS titulo, validade AS validade, DATE_FORMAT(valida_ate, '%Y-%m-%d') AS valida_ate, assinada AS assinada, assinada_nome AS assinada_por, DATE_FORMAT(assinada_em, '%Y-%m-%d %H:%i') AS assinada_em, codigo AS codigo FROM tb_autorizacoes WHERE id_aluno = ? ORDER BY id_autorizacao", [id]);
  const [comunicadosLidos] = await db.query("SELECT c.titulo AS titulo, DATE_FORMAT(l.lido_em, '%Y-%m-%d %H:%i') AS lido_em FROM tb_comunicado_leituras l JOIN tb_comunicados c ON c.id_comunicado = l.id_comunicado WHERE l.id_aluno = ? ORDER BY l.lido_em", [id]);
  const [documentos] = await db.query("SELECT categoria AS categoria, titulo AS titulo, nome_original AS nome_original, tamanho AS tamanho_bytes, enviado_por_nome AS enviado_por, DATE_FORMAT(enviado_em, '%Y-%m-%d') AS enviado_em FROM tb_documentos WHERE id_aluno = ? AND categoria NOT LIKE 'CT:%' ORDER BY id_documento", [id]);
  const [entradas] = await db.query("SELECT DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS quando, COALESCE((SELECT cg.nome FROM tb_cameras cg WHERE cg.id_camera = tb_acessos.id_camera), 'Portaria') AS local, metodo AS metodo FROM tb_acessos WHERE id_aluno = ? ORDER BY data_hora", [id]);
  const [saidas] = await db.query("SELECT DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS quando, metodo AS metodo, liberado_por_nome AS liberado_por FROM tb_saidas WHERE id_aluno = ? ORDER BY data_hora", [id]);
  const [reconhecimentos] = await db.query("SELECT DATE_FORMAT(r.data_hora, '%Y-%m-%d %H:%i:%s') AS quando, c.nome AS camera, r.sentido AS sentido, r.confianca AS confianca FROM tb_reconhecimentos r JOIN tb_cameras c ON c.id_camera = r.id_camera WHERE r.id_aluno = ? ORDER BY r.data_hora", [id]);
  await registrarLog(req.usuario, "exportacao_dados_aluno", `${aluno.nome} — aluno id ${id}`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="dados-aluno-${id}.json"`);
  res.send(JSON.stringify({ gerado_em: new Date().toISOString(), base: "LGPD, art. 18 — direito de acesso aos dados",
    aluno, responsaveis, presencas, advertencias, ocorrencias_do_professor: ocorrenciasEscolares, pendencias, autorizacoes, comunicados_lidos: comunicadosLidos,
    documentos_anexados: documentos, consentimentos: (await consentimentoDoAluno(id, true)).historico,
    entradas, saidas, reconhecimento_facial: { passagens: reconhecimentos, observacao: "O sistema não guarda fotos nem dados biométricos: só o horário, a câmera e o grau de confiança de cada reconhecimento. Os registros são apagados depois de " + RETENCAO_RECONHECIMENTOS_DIAS + " dias." },
    observacao: "Os arquivos dos documentos não vão neste arquivo; peça à gestão da escola se precisar deles. Registros sigilosos de proteção da criança (comunicações ao Conselho Tutelar, ECA arts. 13 e 56) não fazem parte deste arquivo." }, null, 2));
});

module.exports = { listarAlunos, criarAluno, importarAlunos, SITUACOES, atualizarSituacao, verAluno, listarGestaoDeAlunos, verFicha, exportarDadosDoAluno };
