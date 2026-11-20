// Controller: o que cada endereço da API faz — termo de consentimento dos responsáveis.
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { alunoPermitido } = require("../model/alunos");
const { conferirSenha, minutosBloqueado, registrarFalha, tentativas } = require("../model/seguranca");
const { novoCodigo, registrarAssinatura } = require("../model/assinaturas");
const { OPCOES_CONSENTIMENTO, consentimentoDoAluno, statusConsentimento } = require("../model/consentimento");
const { CONSENTIMENTO } = require("../view/consentimento");
const { rota } = require("../middlewares/rota");
const { semPermissao } = require("../middlewares/permissoes");
const { nomeTurma } = require("../model/utilitarios");

const verTermo = (req, res) => res.json(CONSENTIMENTO); // público, como a política de privacidade

const verConsentimento = rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  res.json(await consentimentoDoAluno(aluno.id, req.usuario.papel !== "professor"));
});

// Só o responsável do próprio aluno assina. Confirma com nome completo + senha (mesmo padrão das autorizações digitais).
const assinarConsentimento = rota(async (req, res) => {
  if (req.usuario.papel !== "pai") return res.status(403).json({ erro: "Somente o responsável pelo aluno pode assinar o termo." });
  const alunoId = Number(req.params.alunoId);
  if (!req.usuario.filhos.includes(alunoId)) return res.status(403).json({ erro: "Você só pode assinar o termo do seu próprio filho." });
  const escolhas = {};
  for (const id of OPCOES_CONSENTIMENTO) {
    if (typeof req.body[id] !== "boolean") return res.status(400).json({ erro: "Responda todas as opções (autorizo ou não autorizo)." });
    escolhas[id] = req.body[id];
  }
  const chave = `assinatura|${req.usuario.id}`, minutos = minutosBloqueado(chave);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` });
  const [[u]] = await db.query("SELECT nome AS nome, senha AS senha FROM tb_usuarios WHERE id_usuario = ?", [req.usuario.id]);
  if (req.body.confirmo !== true && !req.body.nome) return res.status(400).json({ erro: "Marque “Li o termo e confirmo minhas escolhas” para assinar." });
  if (!(await conferirSenha(req.body.senha, u.senha))) { registrarFalha(chave); return res.status(400).json({ erro: "Senha incorreta." }); }
  tentativas.delete(chave);
  const codigo = novoCodigo();
  const [novoCon] = await db.query("INSERT INTO tb_consentimentos (id_aluno, id_usuario, versao, informacoes, imagem, monitoramento, assinado_nome, codigo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [alunoId, req.usuario.id, CONSENTIMENTO.versao, escolhas.informacoes, escolhas.imagem, escolhas.monitoramento, u.nome, codigo]);
  await registrarAssinatura({ codigo, documento: "consentimento", documentoId: novoCon.insertId, papel: "resp", usuario: req.usuario, nome: u.nome, req });
  const sn = (v) => (v ? "sim" : "não");
  await registrarLog(req.usuario, "consentimento_registrado", `Aluno id ${alunoId} — informações: ${sn(escolhas.informacoes)}, imagem: ${sn(escolhas.imagem)}, câmeras: ${sn(escolhas.monitoramento)} (código ${codigo})`);
  res.status(201).json({ ok: true, codigo, status: statusConsentimento(escolhas) });
});

// Visão da gestão: situação do consentimento de todos os alunos (versão atual do termo)
const listarConsentimentos = rota(async (req, res) => {
  const [linhas] = await db.query(`SELECT a.id_aluno AS id, a.nome AS nome, ${nomeTurma("a")} AS sala, c.informacoes AS informacoes, c.imagem AS imagem, c.monitoramento AS monitoramento,
    c.assinado_nome AS assinado_nome, DATE_FORMAT(c.assinado_em, '%d/%m/%Y %H:%i') AS assinado_em
    FROM tb_alunos a LEFT JOIN tb_consentimentos c ON c.id_aluno = a.id_aluno AND c.id_consentimento = (SELECT MAX(x.id_consentimento) FROM tb_consentimentos x WHERE x.id_aluno = a.id_aluno AND x.versao = ?)
    WHERE a.situacao = 'Ativo' ORDER BY a.nome`, [CONSENTIMENTO.versao]);
  const alunos = linhas.map((l) => {
    const assinado = l.assinado_nome !== null;
    const c = assinado ? { informacoes: !!l.informacoes, imagem: !!l.imagem, monitoramento: !!l.monitoramento } : null;
    return { id: l.id, nome: l.nome, sala: l.sala, status: statusConsentimento(c), ...(c || {}), assinado_nome: l.assinado_nome, assinado_em: l.assinado_em };
  });
  const resumo = { total: alunos.length, autorizado: 0, parcial: 0, nao_autorizado: 0, pendente: 0 };
  alunos.forEach((a) => resumo[a.status]++);
  res.json({ versao: CONSENTIMENTO.versao, resumo, alunos });
});

module.exports = { verTermo, verConsentimento, assinarConsentimento, listarConsentimentos };
