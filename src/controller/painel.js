// Controller: o que cada endereço da API faz — Central do Dia, logs, avisos e relatório mensal.
const db = require("../model/db");
const { hashLog, registrarLog } = require("../model/log");
const { INATIVIDADE, verificarInatividade } = require("../model/usuarios");
const { BUSCA_ATIVA, dataReferencia, percentual, sincronizarBuscaAtiva } = require("../model/frequencia");
const { escola } = require("../view/politica");
const { rota } = require("../middlewares/rota");
const { nomeTurma } = require("../model/utilitarios");

// ---------- Quadros indicadores da Secretaria (só administração) ----------
const verResumo = rota(async (req, res) => {
  await sincronizarBuscaAtiva();
  await verificarInatividade();
  const ref = await dataReferencia();
  const [[total]] = await db.query("SELECT COUNT(*) AS n FROM tb_alunos WHERE situacao = 'Ativo'");
  const [[reat]] = await db.query("SELECT COUNT(*) AS inativos, COUNT(reativacao_pedida_em) AS pedidos FROM tb_usuarios WHERE papel = 'professor' AND ativo = FALSE AND inativado_motivo = 'inatividade'");
  const [[pedidosSenha]] = await db.query("SELECT COUNT(*) AS n FROM tb_usuarios WHERE ativo = TRUE AND senha_pedida_em IS NOT NULL");
  const [[dia]] = await db.query(`SELECT COUNT(CASE WHEN status = 'Presente' THEN 1 END) AS presentes,
    COUNT(CASE WHEN status = 'Ausente' THEN 1 END) AS ausentes FROM tb_presencas WHERE data = ?`, [ref.data]);
  const [[ocor]] = await db.query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN tipo = 'Advertencia' THEN 1 END) AS advertencias,
    COUNT(CASE WHEN tipo = 'Acao' THEN 1 END) AS acoes FROM tb_advertencias WHERE data = ?`, [ref.data]);
  const [[busca]] = await db.query("SELECT COUNT(*) AS n FROM tb_busca_ativa WHERE status = 'Em acompanhamento'");
  const [[aut]] = await db.query("SELECT COUNT(*) AS n FROM tb_autorizacoes WHERE assinada = TRUE AND assinada_em >= NOW() - INTERVAL 24 HOUR");
  const [[docs]] = await db.query(`SELECT COUNT(*) AS n FROM tb_documentos d ${DOCS_RECENTES}`);
  const [[ctp]] = await db.query("SELECT COUNT(*) AS n FROM tb_comunicacoes_conselho WHERE comunicado_em IS NULL");
  const [[oce]] = await db.query(`SELECT COUNT(*) AS n, COUNT(CASE WHEN resp_assinada_em IS NULL THEN 1 END) AS sem_resp
    FROM tb_ocorrencias_escolares WHERE ges_assinada_em IS NULL`);
  res.json({
    data: ref.data, eh_hoje: ref.data === ref.hoje, fim_de_semana: ref.fim_de_semana, total_alunos: total.n,
    presentes: dia.presentes, ausentes: dia.ausentes, sem_registro: Math.max(0, total.n - dia.presentes - dia.ausentes),
    ocorrencias_dia: ocor.total, advertencias_dia: ocor.advertencias, acoes_dia: ocor.acoes,
    ocorrencias_gestao: oce.n, ocorrencias_sem_resp: oce.sem_resp,
    percentual: percentual(dia.presentes, dia.ausentes), busca_ativa: busca.n, autorizacoes_recentes: aut.n, documentos_recentes: docs.n, comunicacoes_pendentes: ctp.n,
    professores_inativos: reat.inativos, reativacoes_pedidas: reat.pedidos, senhas_pedidas: pedidosSenha.n, inatividade_dias: INATIVIDADE.dias,
  });
});

// Pasta "Documentos recebidos recentemente": documentos que atenderam a uma pendência, enviados por responsáveis, nas últimas 24 horas.
// Depois de 24 horas o documento sai da pasta, mas continua guardado na ficha do aluno.
const DOCS_RECENTES_JOIN = "JOIN tb_usuarios u ON u.id_usuario = d.id_usuario AND u.papel = 'pai'";
const DOCS_RECENTES_FILTRO = "WHERE d.id_pendencia IS NOT NULL AND d.enviado_em >= NOW() - INTERVAL 24 HOUR";
const DOCS_RECENTES = `${DOCS_RECENTES_JOIN} ${DOCS_RECENTES_FILTRO}`;
const listarDocumentosRecentes = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT d.id_documento AS id, d.titulo AS titulo, d.categoria AS categoria, d.nome_original AS nome_original, d.tamanho AS tamanho,
    d.enviado_por_nome AS enviado_por, ar.parentesco AS parentesco, DATE_FORMAT(d.enviado_em, '%d/%m/%Y %H:%i') AS enviado_em,
    GREATEST(1, CEIL(TIMESTAMPDIFF(MINUTE, NOW(), d.enviado_em + INTERVAL 24 HOUR) / 60)) AS horas_restantes,
    p.descricao AS pendencia, a.id_aluno AS aluno_id, a.nome AS aluno_nome, ${nomeTurma("a")} AS sala, a.matricula AS matricula
    FROM tb_documentos d ${DOCS_RECENTES_JOIN} JOIN tb_alunos a ON a.id_aluno = d.id_aluno JOIN tb_pendencias p ON p.id_pendencia = d.id_pendencia
    LEFT JOIN tb_aluno_resp ar ON ar.id_aluno = d.id_aluno AND ar.id_responsavel = u.id_responsavel
    ${DOCS_RECENTES_FILTRO} ORDER BY d.enviado_em DESC`);
  res.json(linhas);
});

// ---------- Logs de atividade (só administração) ----------
const listarLogs = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT nome_usuario AS nome_usuario, papel AS papel, acao AS acao, detalhe AS detalhe, DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i:%s') AS quando
    FROM tb_logs ORDER BY id_log DESC LIMIT 200`);
  // Troca "aluno id 5" / "usuário id 3" pelo nome, só para mostrar na tela. O texto gravado não muda (a conferência de integridade continua valendo).
  const ids = (re) => [...new Set(linhas.flatMap((l) => [...String(l.detalhe || "").matchAll(re)].map((m) => Number(m[1]))))];
  const idsAlunos = ids(/aluno id (\d+)/g), idsUsuarios = ids(/usuário id (\d+)/g);
  const alunos = new Map(idsAlunos.length ? (await db.query("SELECT id_aluno, nome AS alu_nome FROM tb_alunos WHERE id_aluno IN (?)", [idsAlunos]))[0].map((a) => [a.id_aluno, a.alu_nome]) : []);
  const usuarios = new Map(idsUsuarios.length ? (await db.query("SELECT id_usuario, nome AS usu_nome FROM tb_usuarios WHERE id_usuario IN (?)", [idsUsuarios]))[0].map((u) => [u.id_usuario, u.usu_nome]) : []);
  const legivel = (t) => String(t || "").replace(/aluno id (\d+)/g, (m, id) => alunos.get(Number(id)) || "aluno removido")
    .replace(/usuário id (\d+)/g, (m, id) => usuarios.get(Number(id)) || "usuário removido").replace(/ocorrência id (\d+)/g, "ocorrência nº $1");
  res.json(linhas.map((l) => ({ ...l, detalhe: l.detalhe ? legivel(l.detalhe) : l.detalhe })));
});

// Confere a corrente de hashes dos logs: aponta o primeiro registro apagado ou alterado
const verificarIntegridadeDosLogs = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT id_log AS id, id_usuario, nome_usuario AS nome, papel AS papel, acao AS acao, detalhe AS detalhe,
    DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS em, hash AS hash FROM tb_logs WHERE hash IS NOT NULL ORDER BY id_log`);
  // O primeiro da corrente não tem como conferir o anterior (os mais antigos saem pelo prazo de guarda): confere-se do segundo em diante
  for (let i = 1; i < linhas.length; i++) {
    if (hashLog(linhas[i - 1].hash, linhas[i]) !== linhas[i].hash)
      return res.json({ ok: false, conferidos: i, problema_em: { id: linhas[i].id, quando: linhas[i].em, acao: linhas[i].acao } });
  }
  res.json({ ok: true, conferidos: linhas.length });
});

// ---------- Relatório mensal (só administração) ----------
const verRelatorioMensal = rota(async (req, res) => {
  const hoje = (await dataReferencia()).hoje;
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || "") ? req.query.mes : hoje.slice(0, 7);
  const inicio = `${mes}-01`;
  const [[resumo]] = await db.query(`SELECT COUNT(DISTINCT data) AS dias_com_registro,
    COUNT(CASE WHEN status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN status = 'Ausente' THEN 1 END) AS faltas
    FROM tb_presencas WHERE data >= ? AND data < DATE_ADD(?, INTERVAL 1 MONTH)`, [inicio, inicio]);
  const [alunos] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala,
    COUNT(CASE WHEN p.status = 'Presente' THEN 1 END) AS presencas, COUNT(CASE WHEN p.status = 'Ausente' THEN 1 END) AS faltas
    FROM tb_alunos a LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.data >= ? AND p.data < DATE_ADD(?, INTERVAL 1 MONTH)
    WHERE a.situacao = 'Ativo' OR p.id_presenca IS NOT NULL
    GROUP BY a.id_aluno, a.nome, ${nomeTurma("a")} ORDER BY faltas DESC, a.nome`, [inicio, inicio]);
  const [casos] = await db.query(`SELECT b.id_busca_ativa AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, b.status AS status, b.faltas_ao_abrir AS faltas_ao_abrir,
    DATE_FORMAT(b.aberta_em, '%d/%m/%Y') AS aberta_em, DATE_FORMAT(b.encerrada_em, '%d/%m/%Y') AS encerrada_em,
    (b.aberta_em >= ? AND b.aberta_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS aberto_no_mes,
    (b.encerrada_em >= ? AND b.encerrada_em < DATE_ADD(?, INTERVAL 1 MONTH)) AS encerrado_no_mes
    FROM tb_busca_ativa b JOIN tb_alunos a ON a.id_aluno = b.id_aluno
    WHERE b.aberta_em < DATE_ADD(?, INTERVAL 1 MONTH) AND (b.encerrada_em IS NULL OR b.encerrada_em >= ?)
    ORDER BY b.id_busca_ativa`, [inicio, inicio, inicio, inicio, inicio, inicio]);
  const ids = casos.map((c) => c.id);
  const registros = ids.length ? (await db.query(`SELECT id_busca_ativa AS busca_id, nome_usuario AS nome_usuario, texto AS texto, DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i') AS quando
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
});

// O responsável não precisa "procurar" novidades: o sino mostra o que aconteceu com o filho e o que espera por ele.
// Nada novo é guardado: os avisos são montados na hora a partir do que já existe (entradas, saídas, autorizações, comunicados,
// ocorrências, pendências e eventos). Só se guarda QUANDO a pessoa abriu o sino pela última vez (usu_avisos_vistos_em), para contar os novos.
const AVISOS_DIAS = 14; // até quantos dias para trás os avisos informativos aparecem
const listarAvisos = rota(async (req, res) => {
  const filhos = req.usuario.filhos;
  if (!filhos.length) return res.json({ novos: 0, itens: [] });
  const [[u]] = await db.query("SELECT avisos_vistos_em AS vistos FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  const [alunos] = await db.query(`SELECT id_aluno AS id, nome AS nome, ${nomeTurma("tb_alunos")} AS sala FROM tb_alunos WHERE id_aluno IN (?)`, [filhos]);
  const primeiro = new Map(alunos.map((a) => [a.id, a.nome.split(" ")[0]]));
  const salas = [...new Set(alunos.map((a) => a.sala))];
  const itens = [];
  const add = (x) => itens.push({ ...x, quando: x.quando instanceof Date ? x.quando.toISOString() : x.quando });
  // Entradas e saídas (últimos 3 dias)
  const [movs] = await db.query(`SELECT * FROM (
      SELECT 'Entrada' AS sentido, ac.id_aluno AS aluno_id, ac.data_hora AS quando, ac.metodo AS metodo, COALESCE(c.nome, 'Portaria') AS local
      FROM tb_acessos ac LEFT JOIN tb_cameras c ON c.id_camera = ac.id_camera WHERE ac.id_aluno IN (?) AND ac.data_hora >= CURDATE() - INTERVAL 2 DAY
      UNION ALL
      SELECT 'Saída', s.id_aluno, s.data_hora AS sai_data_hora, s.metodo AS sai_metodo, COALESCE(c.nome, 'Secretaria')
      FROM tb_saidas s LEFT JOIN tb_cameras c ON c.id_camera = s.id_camera WHERE s.id_aluno IN (?) AND s.data_hora >= CURDATE() - INTERVAL 2 DAY) m
    ORDER BY quando DESC LIMIT 20`, [filhos, filhos]);
  for (const m of movs) {
    const hora = new Date(m.quando).toTimeString().slice(0, 5);
    add({ tipo: m.sentido === "Entrada" ? "entrada" : "saida", aluno_id: m.aluno_id, quando: m.quando,
      titulo: `${primeiro.get(m.aluno_id)} ${m.sentido === "Entrada" ? "entrou na escola" : "saiu da escola"} às ${hora}`,
      texto: `${m.local}${m.metodo === "Facial" ? " • reconhecimento facial" : m.metodo === "Liberação" ? " • liberação na secretaria" : " • portaria"}`, destino: { tela: "pais" } });
  }
  // Autorizações esperando a assinatura (dentro do prazo)
  const [auts] = await db.query(`SELECT id_autorizacao AS id, id_aluno AS aluno_id, titulo AS titulo, criada_em AS quando, DATE_FORMAT(valida_ate, '%d/%m') AS ate,
    DATEDIFF(valida_ate, CURDATE()) AS dias FROM tb_autorizacoes WHERE id_aluno IN (?) AND assinada = FALSE AND (valida_ate IS NULL OR valida_ate >= CURDATE())`, [filhos]);
  for (const a of auts) add({ tipo: "autorizacao", acao: true, aluno_id: a.aluno_id, quando: a.quando, titulo: `Autorização para assinar: ${a.titulo}`,
    texto: `${primeiro.get(a.aluno_id)}${a.ate ? ` • assine até ${a.ate}${a.dias === 0 ? " (hoje!)" : a.dias === 1 ? " (amanhã)" : ""}` : ""}`, destino: { tela: "pais", aba: "autorizacoes" } });
  // Comunicados não lidos
  const [coms] = await db.query(`SELECT c.id_comunicado AS id, c.titulo AS titulo, c.criado_em AS quando, a.id_aluno AS aluno_id
    FROM tb_comunicados c JOIN tb_alunos a ON a.id_aluno IN (?) AND (${nomeTurma("c")} IS NULL OR ${nomeTurma("c")} = ${nomeTurma("a")})
    LEFT JOIN tb_comunicado_leituras l ON l.id_comunicado = c.id_comunicado AND l.id_aluno = a.id_aluno
    WHERE l.id_comunicado IS NULL AND c.criado_em >= NOW() - INTERVAL ? DAY ORDER BY c.id_comunicado DESC`, [filhos, AVISOS_DIAS]);
  const vistosCom = new Set();
  for (const c of coms) { if (vistosCom.has(c.id)) continue; vistosCom.add(c.id);
    add({ tipo: "comunicado", acao: true, aluno_id: c.aluno_id, quando: c.quando, titulo: `Novo comunicado: ${c.titulo}`, texto: "Abra para ler", destino: { tela: "pais", aba: "comunicados" } }); }
  // Ocorrências esperando a ciência do responsável
  const [ocs] = await db.query(`SELECT id_ocorrencia AS id, id_aluno AS aluno_id, assinada_em AS quando, professor_nome AS professor FROM tb_ocorrencias_escolares
    WHERE id_aluno IN (?) AND resp_assinada_em IS NULL ORDER BY id_ocorrencia DESC`, [filhos]);
  for (const o of ocs) add({ tipo: "ocorrencia", acao: true, aluno_id: o.aluno_id, quando: o.quando, titulo: `Ocorrência registrada com ${primeiro.get(o.aluno_id)}`,
    texto: `Docente: ${o.professor} • leia e assine que tomou ciência`, destino: { tela: "ocorrencias" } });
  // Documentos que a escola pediu
  const [pens] = await db.query(`SELECT id_pendencia AS id, id_aluno AS aluno_id, descricao AS descricao, criada_em AS quando FROM tb_pendencias
    WHERE id_aluno IN (?) AND status = 'Aberta' AND tipo = 'Documento'`, [filhos]);
  for (const p of pens) add({ tipo: "pendencia", acao: true, aluno_id: p.aluno_id, quando: p.quando, titulo: `A escola pediu um documento`, texto: `${p.descricao} • ${primeiro.get(p.aluno_id)}`, destino: { tela: "pais", aba: "documentos" } });
  // Eventos nos próximos 3 dias
  const [evs] = await db.query(`SELECT id_evento AS id, titulo AS titulo, DATE_FORMAT(data, '%d/%m') AS dia, TIME_FORMAT(hora, '%H:%i') AS hora, criado_em AS quando, DATEDIFF(data, CURDATE()) AS dias
    FROM tb_eventos WHERE data BETWEEN CURDATE() AND CURDATE() + INTERVAL 3 DAY AND (${nomeTurma("tb_eventos")} IS NULL OR ${nomeTurma("tb_eventos")} IN (?)) ORDER BY data`, [salas]);
  for (const e of evs) add({ tipo: "evento", aluno_id: null, quando: e.quando, titulo: `${e.dias === 0 ? "Hoje" : e.dias === 1 ? "Amanhã" : "Em " + e.dias + " dias"}: ${e.titulo}`,
    texto: `${e.dia}${e.hora ? " às " + e.hora : ""}`, destino: { tela: "calendario" } });
  const vistos = u.vistos ? new Date(u.vistos).getTime() : 0;
  itens.forEach((i) => { i.novo = new Date(i.quando).getTime() > vistos; });
  // Primeiro o que pede uma ação; depois do mais recente para o mais antigo
  itens.sort((a, b) => (b.acao ? 1 : 0) - (a.acao ? 1 : 0) || new Date(b.quando) - new Date(a.quando));
  res.json({ novos: itens.filter((i) => i.novo).length, itens: itens.slice(0, 30) });
});
const marcarAvisosVistos = rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET avisos_vistos_em = NOW() WHERE id_usuario = ?", [req.usuario.id]);
  res.json({ ok: true });
});

module.exports = { verResumo, DOCS_RECENTES_JOIN, DOCS_RECENTES_FILTRO, DOCS_RECENTES, listarDocumentosRecentes, listarLogs, verificarIntegridadeDosLogs, verRelatorioMensal, AVISOS_DIAS, listarAvisos, marcarAvisosVistos };
