// Middleware: confere o login (token) antes das rotas protegidas.
const db = require("../model/db");
const { contextoDoUsuario } = require("../model/usuarios");
const { SEG, lerToken } = require("../model/seguranca");
const { POLITICA } = require("../view/politica");
const { nomeTurma } = require("../model/utilitarios");

// Lê o token, confere no banco se o usuário continua ativo e diz quem está fazendo a requisição.
// Quem ainda não aceitou a política de privacidade só consegue trocar a senha e aceitar o termo.
const ROTAS_SEM_ACEITE = new Set(["PUT /api/minha-senha", "POST /api/aceite-privacidade", "POST /api/sair", "PUT /api/acessibilidade"]);
// Gestão sem as duas etapas configuradas só consegue configurar (e trocar a senha / aceitar o termo / sair)
const ROTAS_SEM_2FA = new Set([...ROTAS_SEM_ACEITE, "POST /api/2fa/novo", "POST /api/2fa/ativar"]);
async function autenticar(req, res, next) {
  let dados;
  try { dados = lerToken((req.headers.authorization || "").replace("Bearer ", "")); }
  catch { return res.status(401).json({ erro: "Não autenticado." }); }
  try {
    const [[u]] = await db.query(`SELECT id_usuario AS id, papel AS papel, id_aluno AS aluno_id, ${nomeTurma("tb_usuarios")} AS sala, nome AS nome, aceite_versao AS aceite_versao, id_responsavel AS id_responsavel, sessao_versao AS sessao, ativo_2fa AS dois_ativo FROM tb_usuarios WHERE id_usuario = ? AND ativo = TRUE`, [dados.id]);
    if (!u || (dados.v || 0) !== u.sessao) return res.status(401).json({ erro: "Não autenticado." }); // sessão encerrada (Sair, troca de senha...)
    const ctx = await contextoDoUsuario(u);
    const filhos = ctx.filhos.map((f) => f.id), pedido = Number(req.headers["x-aluno"]);
    let turmaPedida = ""; try { turmaPedida = decodeURIComponent(req.headers["x-turma"] || ""); } catch { /* cabeçalho malformado: usa a turma principal */ }
    req.usuario = { id: u.id, papel: u.papel, nome: u.nome, id_responsavel: u.id_responsavel, filhos, turmas: ctx.turmas,
      aluno_id: filhos.includes(pedido) ? pedido : ctx.alunoPadrao, sala: ctx.turmas.includes(turmaPedida) ? turmaPedida : ctx.salaPadrao };
    if (u.aceite_versao !== POLITICA.versao && !ROTAS_SEM_ACEITE.has(`${req.method} ${req.path}`))
      return res.status(403).json({ erro: "Leia e aceite a política de privacidade para continuar.", codigo: "ACEITE_PENDENTE" });
    if (SEG.doisFatoresGestao && u.papel === "admin" && !u.dois_ativo && !ROTAS_SEM_2FA.has(`${req.method} ${req.path}`))
      return res.status(403).json({ erro: "Configure a verificação em duas etapas para continuar.", codigo: "2FA_PENDENTE" });
    next();
  } catch (erro) { console.error(erro); res.status(500).json({ erro: "Erro interno do servidor. Tente de novo." }); }
}

module.exports = { ROTAS_SEM_ACEITE, ROTAS_SEM_2FA, autenticar };
