// Controller: o que cada endereço da API faz — usuários, perfil, reativação e acessibilidade.
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { turmaExiste } = require("../model/turmas");
const { INATIVIDADE, SQL_DIAS_SEM_ACESSO, contextoDoUsuario, limparAcessibilidade, responsavelDoUsuario, verificarInatividade } = require("../model/usuarios");
const { gerarSenhaGenerica, hashSenha } = require("../model/seguranca");
const { ID_TURMA, emailValido, nomeTurma } = require("../model/utilitarios");
const { consentimentoDoAluno } = require("../model/consentimento");
const { rota } = require("../middlewares/rota");

// A gestão desliga as duas etapas de alguém que perdeu o celular (a pessoa configura de novo no próximo login)
const zerarDoisFatores = rota(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) return res.status(400).json({ erro: "Peça a outra pessoa da gestão para redefinir a sua verificação em duas etapas." });
  const [[u]] = await db.query("SELECT nome AS nome FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  await db.query("UPDATE tb_usuarios SET ativo_2fa = FALSE, segredo_2fa = NULL, metodo_2fa = 'app', destino_2fa = NULL, codigo_hash_2fa = NULL, codigo_expira_2fa = NULL, sessao_versao = sessao_versao + 1 WHERE id_usuario = ?", [req.params.id]);
  await registrarLog(req.usuario, "2fa_zerada", u.nome);
  res.json({ ok: true });
});

// ---------- Cadastro de usuários (gestão, pais e professores) — só administração ----------
const listarUsuarios = rota(async (req, res) => {
  await verificarInatividade();
  const [linhas] = await db.query(`SELECT u.id_usuario AS id, u.login AS usuario, u.nome AS nome, u.papel AS papel, ${nomeTurma("u")} AS sala, u.ativo AS ativo, u.senha_temporaria AS senha_temporaria,
    DATE_FORMAT(u.ultimo_acesso, '%d/%m/%Y %H:%i') AS ultimo_acesso, u.inativado_motivo AS inativado_motivo, DATE_FORMAT(u.inativado_em, '%d/%m/%Y') AS inativado_em,
    DATE_FORMAT(u.reativacao_pedida_em, '%d/%m/%Y %H:%i') AS reativacao_pedida_em, DATE_FORMAT(u.senha_pedida_em, '%d/%m/%Y %H:%i') AS senha_pedida_em, ${SQL_DIAS_SEM_ACESSO} AS dias_sem_acesso,
    u.email AS email_conta, COALESCE(u.email, (SELECT r2.email AS res_email FROM tb_resp r2 WHERE r2.id_responsavel = u.id_responsavel)) AS email,
    a.nome AS aluno_nome, u.id_aluno AS aluno_id, u.ativo_2fa AS dois_fatores,
    (SELECT GROUP_CONCAT(CONCAT(a2.id_aluno, ':', a2.nome) ORDER BY a2.nome SEPARATOR '|') FROM tb_aluno_resp ar2 JOIN tb_alunos a2 ON a2.id_aluno = ar2.id_aluno WHERE ar2.id_responsavel = u.id_responsavel) AS filhos_txt,
    (SELECT GROUP_CONCAT(t.nome ORDER BY t.nome SEPARATOR '|') FROM tb_professor_turma pt JOIN tb_turmas t ON t.id_turma = pt.id_turma WHERE pt.id_usuario = u.id_usuario) AS turmas_txt
    FROM tb_usuarios u LEFT JOIN tb_alunos a ON a.id_aluno = u.id_aluno ORDER BY u.id_usuario DESC`);
  // filhos (responsável) e turmas (professor) vêm do banco como texto "id:nome|id:nome" e "turma|turma"
  res.json(linhas.map(({ filhos_txt, turmas_txt, ...l }) => ({ ...l,
    filhos: (filhos_txt || "").split("|").filter(Boolean).map((x) => ({ id: Number(x.split(":")[0]), nome: x.slice(x.indexOf(":") + 1) })),
    turmas: (turmas_txt || "").split("|").filter(Boolean) })));
});
const criarUsuario = rota(async (req, res) => {
  const { usuario, nome, papel, aluno_id, sala } = req.body;
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!usuario || !nome || !papel) return res.status(400).json({ erro: "Preencha o nome, o usuário e o perfil." });
  if (email && !emailValido(email)) return res.status(400).json({ erro: "O e-mail não parece válido." });
  if (papel === "pai" && !aluno_id) return res.status(400).json({ erro: "Selecione a qual aluno este responsável pertence." });
  if (papel === "professor" && !sala) return res.status(400).json({ erro: "Informe a turma do docente." });
  if (papel === "professor" && !(await turmaExiste(sala))) return res.status(400).json({ erro: "Escolha uma turma cadastrada." });
  const senhaGerada = gerarSenhaGenerica();
  let novo;
  try {
    [novo] = await db.query(`INSERT INTO tb_usuarios (login, senha, papel, nome, id_aluno, id_turma, email, senha_temporaria) VALUES (?, ?, ?, ?, ?, ${ID_TURMA}, ?, TRUE)`,
      [usuario, await hashSenha(senhaGerada), papel, nome, papel === "pai" ? aluno_id : null, papel === "professor" ? sala : null, email || null]);
  } catch (erro) {
    if (erro.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe alguém com esse usuário. Escolha outro." });
    throw erro;
  }
  if (papel === "pai") await responsavelDoUsuario({ id: novo.insertId, nome, aluno_id: Number(aluno_id) }); // liga o login ao cadastro do responsável (perfil)
  if (papel === "professor") await db.query("INSERT IGNORE INTO tb_professor_turma (id_usuario, id_turma) SELECT ?, id_turma FROM tb_turmas WHERE tb_turmas.nome = ?", [novo.insertId, sala]);
  await registrarLog(req.usuario, "cadastro_usuario", `${usuario} (${papel})`);
  res.status(201).json({ ok: true, senha_genercada: senhaGerada }); // devolve a senha gerada só nesta resposta, para o admin entregar ao usuário
});

// E-mail usado na recuperação de senha. Mudar o e-mail cancela qualquer link de recuperação que ainda esteja valendo.
const atualizarEmail = rota(async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (email && !emailValido(email)) return res.status(400).json({ erro: "O e-mail não parece válido." });
  const [r] = await db.query("UPDATE tb_usuarios SET email = ?, recuperacao_hash = NULL, recuperacao_expira = NULL WHERE id_usuario = ?", [email || null, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Usuário não encontrado." });
  await registrarLog(req.usuario, "email_usuario_alterado", `usuário id ${req.params.id}`);
  res.json({ ok: true });
});

const ativarOuDesativar = rota(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id && !req.body.ativo) return res.status(400).json({ erro: "Você não pode desativar o seu próprio acesso." });
  if (req.body.ativo) await db.query("UPDATE tb_usuarios SET ativo = TRUE, inativado_motivo = NULL, inativado_em = NULL, reativado_em = NOW(), reativacao_pedida_em = NULL WHERE id_usuario = ?", [req.params.id]);
  else await db.query("UPDATE tb_usuarios SET ativo = FALSE, inativado_motivo = 'manual', inativado_em = NOW(), sessao_versao = sessao_versao + 1 WHERE id_usuario = ?", [req.params.id]);
  await registrarLog(req.usuario, req.body.ativo ? "reativar_usuario" : "desativar_usuario", `usuário id ${req.params.id}`);
  res.json({ ok: true });
});

// Responsável com mais de um filho: a gestão liga o login a outro aluno (pelo cadastro do responsável, em aluno_responsavel)
const vincularFilho = rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, nome AS nome, papel AS papel, id_aluno AS aluno_id FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u || u.papel !== "pai") return res.status(404).json({ erro: "Responsável não encontrado." });
  const [[aluno]] = await db.query("SELECT id_aluno AS id, nome AS nome FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(400).json({ erro: "Escolha o aluno." });
  const parentesco = String(req.body.parentesco || "Responsável").trim().slice(0, 20) || "Responsável";
  const resId = await responsavelDoUsuario(u);
  if (!resId) return res.status(400).json({ erro: "Este usuário ainda não tem cadastro de responsável." });
  const [r] = await db.query("INSERT IGNORE INTO tb_aluno_resp (id_aluno, id_responsavel, parentesco) VALUES (?, ?, ?)", [aluno.id, resId, parentesco]);
  if (!r.affectedRows) return res.status(409).json({ erro: "Este aluno já está ligado a este responsável." });
  await registrarLog(req.usuario, "responsavel_vinculado", `${u.nome} → ${aluno.nome} (${parentesco})`);
  res.status(201).json({ ok: true });
});
const desvincularFilho = rota(async (req, res) => {
  const [[u]] = await db.query("SELECT nome AS nome, id_aluno AS aluno_id, id_responsavel AS id_responsavel FROM tb_usuarios WHERE id_usuario = ? AND papel = 'pai'", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Responsável não encontrado." });
  if (u.aluno_id === Number(req.params.alunoId)) return res.status(400).json({ erro: "Este é o aluno principal deste usuário e não pode ser removido." });
  const [r] = await db.query("DELETE FROM tb_aluno_resp WHERE id_aluno = ? AND id_responsavel = ?", [req.params.alunoId, u.id_responsavel || 0]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Vínculo não encontrado." });
  await registrarLog(req.usuario, "responsavel_desvinculado", `${u.nome} — aluno id ${req.params.alunoId}`);
  res.json({ ok: true });
});
// Professor com mais de uma turma: a gestão marca as turmas. A primeira da lista vira a turma principal (a que abre primeiro).
const atualizarTurmasDoDocente = rota(async (req, res) => {
  const [[u]] = await db.query(`SELECT id_usuario AS id, nome AS nome, ${nomeTurma("tb_usuarios")} AS sala FROM tb_usuarios WHERE id_usuario = ? AND papel = 'professor'`, [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Docente não encontrado." });
  const nomes = [...new Set((Array.isArray(req.body.turmas) ? req.body.turmas : []).map((n) => String(n).trim()).filter(Boolean))];
  if (!nomes.length) return res.status(400).json({ erro: "Marque pelo menos uma turma." });
  const [turmas] = await db.query("SELECT id_turma AS id, nome AS nome FROM tb_turmas WHERE nome IN (?)", [nomes]);
  if (turmas.length !== nomes.length) return res.status(400).json({ erro: "Alguma turma não foi encontrada." });
  const principal = nomes.includes(u.sala) ? u.sala : nomes[0];
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    await conexao.query("DELETE FROM tb_professor_turma WHERE id_usuario = ?", [u.id]);
    await conexao.query("INSERT INTO tb_professor_turma (id_usuario, id_turma) VALUES ?", [turmas.map((t) => [u.id, t.id])]);
    await conexao.query(`UPDATE tb_usuarios SET id_turma = ${ID_TURMA} WHERE id_usuario = ?`, [principal, u.id]);
    await conexao.commit();
  } catch (erro) { await conexao.rollback(); throw erro; } finally { conexao.release(); }
  await registrarLog(req.usuario, "professor_turmas", `${u.nome}: ${nomes.join(", ")}`);
  res.json({ ok: true });
});

// O que abre para quem está logado: os filhos (responsável) ou as turmas (professor). Usado no seletor do topo da tela.
const verMeuContexto = rota(async (req, res) => {
  const [[u]] = await db.query(`SELECT id_usuario AS id, papel AS papel, id_aluno AS aluno_id, ${nomeTurma("tb_usuarios")} AS sala, id_responsavel AS id_responsavel FROM tb_usuarios WHERE id_usuario = ?`, [req.usuario.id]);
  const ctx = await contextoDoUsuario(u);
  res.json({ filhos: ctx.filhos, turmas: ctx.turmas, aluno_id: req.usuario.aluno_id, sala: req.usuario.sala });
});

const listarReativacao = rota(async (req, res) => {
  await verificarInatividade();
  const [linhas] = await db.query(`SELECT u.id_usuario AS id, u.nome AS nome, u.login AS usuario, ${nomeTurma("u")} AS sala, u.ativo AS ativo,
    DATE_FORMAT(u.ultimo_acesso, '%d/%m/%Y') AS ultimo_acesso, DATE_FORMAT(u.inativado_em, '%d/%m/%Y') AS inativado_em,
    DATE_FORMAT(u.reativacao_pedida_em, '%d/%m/%Y %H:%i') AS pedido_em, ${SQL_DIAS_SEM_ACESSO} AS dias_sem_acesso
    FROM tb_usuarios u WHERE u.papel = 'professor' AND ((u.ativo = FALSE AND u.inativado_motivo = 'inatividade') OR (u.ativo = TRUE AND ${SQL_DIAS_SEM_ACESSO} >= ?))
    ORDER BY u.ativo, u.reativacao_pedida_em IS NULL, dias_sem_acesso DESC`, [INATIVIDADE.aviso]);
  res.json({ ...INATIVIDADE, inativos: linhas.filter((l) => !l.ativo), perto: linhas.filter((l) => l.ativo).map((l) => ({ ...l, faltam: INATIVIDADE.dias - l.dias_sem_acesso })) });
});

// Pedido de "Esqueci minha senha": a gestão confirma quem é e gera uma senha provisória (troca obrigatória no próximo login).
// A verificação em duas etapas continua valendo; se a pessoa também perdeu o celular, a gestão zera à parte.
const gerarNovaSenha = rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, nome AS nome, ativo AS ativo FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (!u.ativo) return res.status(400).json({ erro: "Este usuário está inativo. Reative o acesso primeiro." });
  if (u.id === req.usuario.id) return res.status(400).json({ erro: "Para mudar a sua própria senha, use Trocar senha." });
  const senha = gerarSenhaGenerica();
  await db.query("UPDATE tb_usuarios SET senha = ?, senha_temporaria = TRUE, senha_pedida_em = NULL, recuperacao_hash = NULL, recuperacao_expira = NULL, sessao_versao = sessao_versao + 1 WHERE id_usuario = ?", [await hashSenha(senha), u.id]);
  await registrarLog(req.usuario, "nova_senha_usuario", `${u.nome} (nova senha provisória gerada)`);
  res.json({ ok: true, senha_provisoria: senha });
});
// A gestão reativa: o acesso volta, o prazo recomeça e uma senha provisória nova é gerada (troca obrigatória no próximo login)
const reativarUsuario = rota(async (req, res) => {
  const [[u]] = await db.query("SELECT id_usuario AS id, nome AS nome, ativo AS ativo FROM tb_usuarios WHERE id_usuario = ?", [req.params.id]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (u.ativo) return res.status(400).json({ erro: "Este usuário já está ativo." });
  const senha = gerarSenhaGenerica();
  await db.query(`UPDATE tb_usuarios SET ativo = TRUE, inativado_motivo = NULL, inativado_em = NULL, reativado_em = NOW(), reativacao_pedida_em = NULL,
    senha = ?, senha_temporaria = TRUE, sessao_versao = sessao_versao + 1 WHERE id_usuario = ?`, [await hashSenha(senha), u.id]);
  await registrarLog(req.usuario, "reativar_usuario", `${u.nome} (nova senha provisória gerada)`);
  res.json({ ok: true, senha_provisoria: senha });
});
const CONTATOS = ["WhatsApp", "Ligação", "E-mail"];

const verMeuPerfil = rota(async (req, res) => {
  const resId = await responsavelDoUsuario(req.usuario);
  const [[conta]] = await db.query(`SELECT login AS login, nome AS nome, DATE_FORMAT(ultimo_acesso, '%d/%m/%Y %H:%i') AS ultimo_acesso,
    DATE_FORMAT(criado_em, '%d/%m/%Y') AS criado_em, DATE_FORMAT(aceite_em, '%d/%m/%Y %H:%i') AS aceite_em, aceite_versao AS aceite_versao FROM tb_usuarios WHERE id_usuario = ?`, [req.usuario.id]);
  const [[resp]] = await db.query(`SELECT id_responsavel AS id, nome AS nome, telefone AS telefone, telefone2 AS telefone2, email AS email, contato_preferido AS contato_preferido,
    DATE_FORMAT(atualizado_em, '%d/%m/%Y %H:%i') AS atualizado_em FROM tb_resp WHERE id_responsavel = ?`, [resId]);
  const [[filho]] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, a.matricula AS matricula, ar.parentesco AS parentesco
    FROM tb_alunos a LEFT JOIN tb_aluno_resp ar ON ar.id_aluno = a.id_aluno AND ar.id_responsavel = ? WHERE a.id_aluno = ?`, [resId, req.usuario.aluno_id]);
  const [outros] = await db.query(`SELECT r.nome AS nome, ar.parentesco AS parentesco FROM tb_aluno_resp ar JOIN tb_resp r ON r.id_responsavel = ar.id_responsavel
    WHERE ar.id_aluno = ? AND ar.id_responsavel <> ?`, [req.usuario.aluno_id, resId]);
  const [acessos] = await db.query(`SELECT DATE_FORMAT(data_hora, '%d/%m/%Y %H:%i') AS quando FROM tb_logs WHERE id_usuario = ? AND acao = 'login_sucesso' ORDER BY id_log DESC LIMIT 5`, [req.usuario.id]);
  const consentimento = await consentimentoDoAluno(req.usuario.aluno_id, true);
  res.json({ conta, responsavel: resp, filho, outros_responsaveis: outros, ultimos_acessos: acessos, contatos: CONTATOS,
    consentimento: { status: consentimento.status, assinado_em: consentimento.atual ? consentimento.atual.assinado_em : null } });
});

const atualizarMeuPerfil = rota(async (req, res) => {
  const limpa = (v) => String(v ?? "").trim();
  const telefone = limpa(req.body.telefone), telefone2 = limpa(req.body.telefone2), email = limpa(req.body.email).toLowerCase(), contato = limpa(req.body.contato_preferido);
  const telOk = (t) => /^[\d\s()+-]{8,20}$/.test(t) && t.replace(/\D/g, "").length >= 8;
  if (!telOk(telefone)) return res.status(400).json({ erro: "Informe um telefone principal válido, com DDD. Ex.: (11) 98765-4321." });
  if (telefone2 && !telOk(telefone2)) return res.status(400).json({ erro: "O telefone para recados não parece válido." });
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) return res.status(400).json({ erro: "O e-mail não parece válido." });
  if (!CONTATOS.includes(contato)) return res.status(400).json({ erro: "Escolha como prefere ser contatado." });
  if (contato === "E-mail" && !email) return res.status(400).json({ erro: "Para receber contato por e-mail, informe o seu e-mail." });
  const resId = await responsavelDoUsuario(req.usuario);
  await db.query("UPDATE tb_resp SET telefone = ?, telefone2 = ?, email = ?, contato_preferido = ?, atualizado_em = NOW() WHERE id_responsavel = ?",
    [telefone, telefone2 || null, email || null, contato, resId]);
  await registrarLog(req.usuario, "perfil_atualizado", "Contatos do responsável"); // os dados em si não vão para o log
  res.json({ ok: true });
});
const salvarAcessibilidade = rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET acessibilidade = ? WHERE id_usuario = ?", [JSON.stringify(limparAcessibilidade(req.body || {})), req.usuario.id]);
  res.json({ ok: true });
});

// Tutorial do primeiro acesso: a pessoa concluiu ou pulou, e ele não aparece mais sozinho (em nenhum aparelho)
const marcarTutorialVisto = rota(async (req, res) => {
  await db.query("UPDATE tb_usuarios SET tutorial_visto_em = NOW() WHERE id_usuario = ?", [req.usuario.id]);
  res.json({ ok: true });
});

module.exports = { zerarDoisFatores, listarUsuarios, criarUsuario, atualizarEmail, ativarOuDesativar, vincularFilho, desvincularFilho, atualizarTurmasDoDocente, verMeuContexto, listarReativacao, gerarNovaSenha, reativarUsuario, CONTATOS, verMeuPerfil, atualizarMeuPerfil, salvarAcessibilidade, marcarTutorialVisto };
