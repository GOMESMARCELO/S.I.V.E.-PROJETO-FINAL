// Model: casos da Proteção (Conselho Tutelar): permissões, anexos e contagens da criança.
const db = require("./db");

// ---------- Proteção da criança: comunicações ao Conselho Tutelar (ECA arts. 13 e 56; LDB art. 12, VIII) ----------
// Registros CONFIDENCIAIS: só a gestão vê todos; o professor vê apenas os que ele mesmo registrou; responsável NUNCA vê
// (a suspeita pode envolver a própria família). Nada é apagado, e toda consulta e registro vai para os logs.
const MOTIVOS_PROTECAO = ["Maus-tratos", "Faltas", "Outro"];
// LDB, art. 12, VIII: notificar quando as faltas passam de 30% do percentual permitido em lei. Faltas permitidas = 25% (frequência mínima de 75%),
// então 30% de 25% = 7,5% das aulas. Confira a regra da sua rede de ensino.
const LIMITE_FALTAS_CT = 7.5;

// ---------- Proteção: anexos (documentos assinados pelos pais, provas de notificação), edição e "tudo da criança" ----------
// Os anexos ficam em tb_documentos com categoria "CT:<id do caso>". Essa marca os deixa fora da ficha, do portal da família
// e da exportação LGPD do responsável: só quem pode ver o caso (gestão, ou o docente que registrou) abre esses arquivos.
const categoriaCaso = (id) => `CT:${id}`;
async function casoPermitido(usuario, id) {
  const [[c]] = await db.query("SELECT id_comunicacao_conselho AS id, id_aluno AS aluno_id, id_usuario AS autor, comunicado_em AS comunicado FROM tb_comunicacoes_conselho WHERE id_comunicacao_conselho = ?", [id]);
  if (!c) return null;
  if (usuario.papel === "admin" || (usuario.papel === "professor" && c.autor === usuario.id)) return c;
  return null;
}
async function completarProtecao(lista, usuario) {
  if (!lista.length) return;
  const ids = lista.map((i) => i.id), alunos = [...new Set(lista.map((i) => i.aluno_id))];
  const [anexos] = await db.query(`SELECT id_documento AS id, CAST(SUBSTRING(categoria, 4) AS UNSIGNED) AS caso, titulo AS titulo, nome_original AS nome_original, tamanho AS tamanho,
    enviado_por_nome AS enviado_por, DATE_FORMAT(enviado_em, '%d/%m/%Y %H:%i') AS enviado_em FROM tb_documentos WHERE categoria IN (?) ORDER BY id_documento`, [ids.map(categoriaCaso)]);
  const [casos] = await db.query(`SELECT id_aluno AS aluno_id, COUNT(*) AS n FROM tb_comunicacoes_conselho WHERE id_aluno IN (?) ${usuario.papel === "admin" ? "" : "AND id_usuario = ?"} GROUP BY id_aluno`, usuario.papel === "admin" ? [alunos] : [alunos, usuario.id]);
  const [ocorr] = await db.query("SELECT id_aluno AS aluno_id, COUNT(*) AS n FROM tb_ocorrencias_escolares WHERE id_aluno IN (?) GROUP BY id_aluno", [alunos]);
  const [adv] = await db.query("SELECT id_aluno AS aluno_id, COUNT(*) AS n FROM tb_advertencias WHERE id_aluno IN (?) GROUP BY id_aluno", [alunos]);
  const conta = (linhas) => Object.fromEntries(linhas.map((l) => [l.aluno_id, Number(l.n)]));
  const nc = conta(casos), no = conta(ocorr), na = conta(adv);
  for (const i of lista) {
    i.anexos = anexos.filter((a) => Number(a.caso) === i.id).map(({ caso, ...a }) => a);
    i.total_casos = nc[i.aluno_id] || 0; i.total_ocorrencias = no[i.aluno_id] || 0; i.total_advertencias = na[i.aluno_id] || 0;
    i.pode_editar = usuario.papel === "admin" || i.pendente; // o docente edita só enquanto o caso não foi comunicado
  }
}

module.exports = { MOTIVOS_PROTECAO, LIMITE_FALTAS_CT, categoriaCaso, casoPermitido, completarProtecao };
