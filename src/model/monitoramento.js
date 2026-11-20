// Model: câmeras e reconhecimento facial (simulados) e situação do aluno ao vivo.
const db = require("./db");
const { nomeTurma, normalizar } = require("./utilitarios");
const { consentimentoDoAluno } = require("./consentimento");

// Regras do reconhecimento facial (dado biométrico = dado pessoal sensível, LGPD art. 11):
//   1. só funciona se a gestão ligar o recurso;  2. só em câmeras de portão (entrada/saída);
//   3. só para turmas a partir do Pré (berçário e maternal ficam de fora);
//   4. só para alunos cujo responsável marcou "câmeras e reconhecimento facial" no Termo de Consentimento.
// Quem não cumpre as regras NÃO tem cadastro facial: a câmera não o identifica e a imagem é descartada.
// O sistema não guarda foto nem dado biométrico, só a passagem (horário, câmera e confiança).
const TURMAS_ANTES_DO_PRE = /bercario|maternal|creche/;
const LOCAIS_PROIBIDOS = /banheir|sanitari|vestiar|trocador|fraldari|chuveir|lavabo|\bwc\b/; // ECA, art. 17: nunca em espaços de intimidade

async function facialLigado() {
  const [[c]] = await db.query("SELECT valor AS valor FROM tb_configuracoes WHERE chave = 'reconhecimento_facial'");
  return !!c && c.valor === "ligado";
}
// Situação do cadastro facial de um aluno (calculada na hora: se o responsável revogar, deixa de valer no mesmo instante)
async function cadastroFacial(aluno, ligado) {
  if (!ligado) return { ok: false, motivo: "Reconhecimento facial desligado pela escola" };
  if (TURMAS_ANTES_DO_PRE.test(normalizar(aluno.sala))) return { ok: false, motivo: "Turma antes do Pré (sem reconhecimento facial)" };
  const c = await consentimentoDoAluno(aluno.id, false);
  if (c.status === "pendente") return { ok: false, motivo: "Termo de consentimento pendente" };
  if (!c.atual.monitoramento) return { ok: false, motivo: "Responsável não autorizou" };
  return { ok: true, motivo: "Autorizado pelo responsável" };
}
// Primeira entrada do dia também marca a presença (se o professor ainda não fez a chamada)
async function marcarPresencaPelaEntrada(alunoId, origem) {
  await db.query("INSERT IGNORE INTO tb_presencas (id_aluno, data, status, observacao) VALUES (?, CURDATE(), 'Presente', CONCAT('Entrada ', DATE_FORMAT(NOW(), '%H:%i'), ' — ', ?))", [alunoId, origem]);
}

// Situação AO VIVO de hoje: na escola, saiu, ainda não chegou ou ausente. filtro: { alunoId } ou { sala } ou {} (todos)
async function statusAoVivo(filtro = {}) {
  const cond = filtro.alunoId ? "a.id_aluno = ?" : filtro.sala ? `${nomeTurma("a")} = ? AND a.situacao = 'Ativo'` : "a.situacao = 'Ativo'";
  const param = filtro.alunoId ? [filtro.alunoId] : filtro.sala ? [filtro.sala] : [];
  const [alunos] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, p.status AS chamada FROM tb_alunos a
    LEFT JOIN tb_presencas p ON p.id_aluno = a.id_aluno AND p.data = CURDATE() WHERE ${cond} ORDER BY a.nome`, param);
  if (!alunos.length) return [];
  const ids = alunos.map((a) => a.id);
  const [movs] = await db.query(`SELECT * FROM (
      SELECT 'Entrada' AS sentido, ac.id_aluno AS aluno_id, ac.data_hora AS quando, ac.metodo AS metodo, COALESCE(c.nome, 'Portaria') AS local, NULL AS por
      FROM tb_acessos ac LEFT JOIN tb_cameras c ON c.id_camera = ac.id_camera WHERE ac.data_hora >= CURDATE() AND ac.id_aluno IN (?)
      UNION ALL
      SELECT 'Saída', s.id_aluno, s.data_hora AS sai_data_hora, s.metodo AS sai_metodo, COALESCE(c.nome, 'Secretaria'), s.liberado_por_nome AS sai_liberado_por_nome
      FROM tb_saidas s LEFT JOIN tb_cameras c ON c.id_camera = s.id_camera WHERE s.data_hora >= CURDATE() AND s.id_aluno IN (?)
    ) m ORDER BY quando`, [ids, ids]);
  const hora = (d) => new Date(d).toTimeString().slice(0, 5);
  const comoFoi = (m) => m.metodo === "Facial" ? "reconhecimento facial" : m.metodo === "Liberação" ? `liberação na secretaria${m.por ? " por " + m.por : ""}` : "registro da portaria";
  return alunos.map((a) => {
    const meus = movs.filter((m) => m.aluno_id === a.id), ultimo = meus[meus.length - 1];
    let situacao, texto, detalhe = "";
    if (ultimo && ultimo.sentido === "Entrada") { situacao = "na_escola"; texto = `Na escola desde ${hora(ultimo.quando)}`; detalhe = `Entrada pelo ${ultimo.local} (${comoFoi(ultimo)})`; }
    else if (ultimo) { situacao = "saiu"; texto = `Saiu às ${hora(ultimo.quando)}`; detalhe = `Saída: ${ultimo.local} (${comoFoi(ultimo)})`; }
    else if (a.chamada === "Presente") { situacao = "na_escola"; texto = "Presente na chamada"; detalhe = "Sem registro de entrada no portão"; }
    else if (a.chamada === "Ausente") { situacao = "ausente"; texto = "Ausente hoje"; detalhe = "Falta registrada na chamada"; }
    else { situacao = "nao_chegou"; texto = "Ainda não chegou"; detalhe = "Nenhuma entrada registrada hoje"; }
    return { id: a.id, nome: a.nome, sala: a.sala, situacao, texto, detalhe,
      movimentos: meus.map((m) => ({ sentido: m.sentido, hora: hora(m.quando), local: m.local, como: comoFoi(m) })) };
  });
}
function resumoAoVivo(lista) {
  const r = { total: lista.length, na_escola: 0, saiu: 0, nao_chegou: 0, ausente: 0 };
  lista.forEach((s) => r[s.situacao]++);
  return r;
}

module.exports = { TURMAS_ANTES_DO_PRE, LOCAIS_PROIBIDOS, facialLigado, cadastroFacial, marcarPresencaPelaEntrada, statusAoVivo, resumoAoVivo };
