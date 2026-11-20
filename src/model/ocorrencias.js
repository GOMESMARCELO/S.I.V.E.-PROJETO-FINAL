const { nomeTurma } = require("./utilitarios");
// Model: consulta padrão das ocorrências escolares.
// ---------- Ocorrências do professor (registro do dia, com assinatura digital do professor) ----------
// O professor registra e consulta só a própria turma. A turma gravada é a do aluno no dia do registro.
// O responsável vê as ocorrências do filho e assina que tomou ciência; enquanto não assina, a ocorrência conta como "nova".
const CONSULTA_OCORRENCIAS = `SELECT oce.id_ocorrencia AS id, oce.id_aluno AS aluno_id, a.nome AS aluno_nome, ${nomeTurma("oce")} AS turma,
    DATE_FORMAT(oce.data, '%Y-%m-%d') AS data, TIME_FORMAT(oce.horario, '%H:%i') AS horario,
    DATE_FORMAT(oce.notificado_em, '%d/%m/%Y %H:%i') AS notificado_em, oce.descricao AS descricao,
    oce.buscado_por AS buscado_por, oce.professor_nome AS professor_nome, oce.codigo AS codigo,
    DATE_FORMAT(oce.assinada_em, '%d/%m/%Y %H:%i') AS assinada_em,
    oce.resp_nome AS resp_nome, DATE_FORMAT(oce.resp_assinada_em, '%d/%m/%Y %H:%i') AS resp_assinada_em, oce.resp_codigo AS resp_codigo,
    oce.ges_nome AS ges_nome, DATE_FORMAT(oce.ges_assinada_em, '%d/%m/%Y %H:%i') AS ges_assinada_em, oce.ges_codigo AS ges_codigo
    FROM tb_ocorrencias_escolares oce JOIN tb_alunos a ON a.id_aluno = oce.id_aluno`;
const ORDEM_OCORRENCIAS = "ORDER BY oce.data DESC, oce.horario DESC, oce.id_ocorrencia DESC";

module.exports = { CONSULTA_OCORRENCIAS, ORDEM_OCORRENCIAS };
