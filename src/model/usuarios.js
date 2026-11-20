// Model: dados dos usuários (vínculos com filhos e turmas, inatividade, responsável, acessibilidade).
const db = require("./db");
const { SISTEMA, registrarLog } = require("./log");
const { nomeTurma, normalizar } = require("./utilitarios");

// Quem está logado pode ter mais de um vínculo: o responsável, vários filhos (aluno_responsavel); o professor, várias turmas (professor_turma).
// alunoPadrao / salaPadrao: o que abre primeiro (o filho do cadastro do login / a turma principal do professor).
async function contextoDoUsuario(u) {
  if (u.papel === "pai") {
    const [filhos] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala FROM tb_alunos a
      WHERE a.id_aluno = ? OR a.id_aluno IN (SELECT ar.id_aluno FROM tb_aluno_resp ar WHERE ar.id_responsavel = ?)
      ORDER BY a.id_aluno = ? DESC, a.nome`, [u.aluno_id || 0, u.id_responsavel || 0, u.aluno_id || 0]);
    return { filhos, turmas: [], alunoPadrao: filhos.length ? filhos[0].id : null, salaPadrao: null };
  }
  if (u.papel === "professor") {
    const [linhas] = await db.query(`SELECT t.nome AS nome FROM tb_professor_turma pt JOIN tb_turmas t ON t.id_turma = pt.id_turma
      WHERE pt.id_usuario = ? AND t.ativa = TRUE ORDER BY t.nome = ? DESC, t.nome`, [u.id, u.sala || ""]);
    const turmas = linhas.map((l) => l.nome);
    if (!turmas.length && u.sala) turmas.push(u.sala);
    return { filhos: [], turmas, alunoPadrao: null, salaPadrao: turmas[0] || null };
  }
  return { filhos: [], turmas: [], alunoPadrao: null, salaPadrao: null };
}

// ---------- Reativação de professores: 60 dias sem acessar o sistema (AVA) ----------
// O prazo conta a partir do último acesso (ou do cadastro, se nunca entrou) e recomeça quando a gestão reativa.
// Para mudar a regra, altere estes números. "aviso" = a partir de quantos dias o professor aparece como "perto do limite".
const INATIVIDADE = { dias: 60, aviso: 50 };
const SQL_DIAS_SEM_ACESSO = "DATEDIFF(NOW(), GREATEST(COALESCE(u.ultimo_acesso, u.criado_em), COALESCE(u.reativado_em, u.criado_em)))";

async function verificarInatividade() {
  const [vencidos] = await db.query(`SELECT u.id_usuario AS id, u.nome AS nome, ${nomeTurma("u")} AS sala, ${SQL_DIAS_SEM_ACESSO} AS dias FROM tb_usuarios u
    WHERE u.papel = 'professor' AND u.ativo = TRUE AND ${SQL_DIAS_SEM_ACESSO} >= ?`, [INATIVIDADE.dias]);
  for (const v of vencidos) {
    const [r] = await db.query("UPDATE tb_usuarios SET ativo = FALSE, inativado_motivo = 'inatividade', inativado_em = NOW(), reativacao_pedida_em = NULL WHERE id_usuario = ? AND ativo = TRUE", [v.id]);
    if (r.affectedRows) await registrarLog(SISTEMA, "inativado_por_inatividade", `${v.nome} (${v.sala || "-"}): ${v.dias} dias sem acessar`);
  }
}

// ---------- Perfil do responsável ----------
// Liga o login do responsável ao cadastro dele em "responsaveis" (procura pelo nome entre os responsáveis do filho; se não achar, cria).
async function responsavelDoUsuario(usuario) {
  const [[u]] = await db.query("SELECT id_responsavel AS id_responsavel FROM tb_usuarios WHERE id_usuario = ?", [usuario.id]);
  if (u && u.id_responsavel) return u.id_responsavel;
  if (!usuario.aluno_id) return null;
  const [doFilho] = await db.query("SELECT r.id_responsavel AS id, r.nome AS nome FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel WHERE ar.id_aluno = ?", [usuario.aluno_id]);
  let resId = (doFilho.find((r) => normalizar(r.nome) === normalizar(usuario.nome)) || {}).id;
  if (!resId) {
    resId = (await db.query("INSERT INTO tb_resp (nome) VALUES (?)", [usuario.nome]))[0].insertId;
    await db.query("INSERT IGNORE INTO tb_aluno_resp (id_aluno, id_responsavel, parentesco) VALUES (?, ?, 'Responsável')", [usuario.aluno_id, resId]);
  }
  await db.query("UPDATE tb_usuarios SET id_responsavel = ? WHERE id_usuario = ?", [resId, usuario.id]);
  return resId;
}

// Painel de Acessibilidade: as escolhas da própria pessoa. Só ela lê e grava, e nada disso vai para os logs (pode revelar uma condição de saúde).
const OPCOES_ACESSIBILIDADE = { texto: ["normal", "grande", "muito-grande"], contraste: ["padrao", "alto", "escuro"] };
const LIGA_DESLIGA_ACESSIBILIDADE = ["daltonismo", "fonte", "espaco", "links", "semMovimento", "voz"];
function limparAcessibilidade(dados) {
  const p = {};
  for (const [campo, opcoes] of Object.entries(OPCOES_ACESSIBILIDADE)) if (opcoes.includes(dados[campo])) p[campo] = dados[campo];
  for (const campo of LIGA_DESLIGA_ACESSIBILIDADE) if (dados[campo] === true) p[campo] = true;
  return p;
}
function lerAcessibilidade(texto) { try { return texto ? limparAcessibilidade(JSON.parse(texto)) : null; } catch { return null; } }

module.exports = { contextoDoUsuario, INATIVIDADE, SQL_DIAS_SEM_ACESSO, verificarInatividade, responsavelDoUsuario, OPCOES_ACESSIBILIDADE, LIGA_DESLIGA_ACESSIBILIDADE, limparAcessibilidade, lerAcessibilidade };
