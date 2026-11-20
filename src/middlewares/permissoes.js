// Middleware: quem pode acessar cada rota (gestão, docente, responsável).
const apenasAdmin = (req, res, next) => req.usuario.papel === "admin" ? next() : res.status(403).json({ erro: "Somente a administração pode acessar isso." });
const apenasProfessor = (req, res, next) => req.usuario.papel === "professor" ? next() : res.status(403).json({ erro: "Esta área é só para docentes." });
// Deixa passar administradores, ou o pai/mãe consultando o próprio filho
function proprioAlunoOuAdmin(req, res, next) {
  const alunoId = Number(req.params.alunoId);
  if (req.usuario.papel === "admin" || req.usuario.filhos.includes(alunoId)) return next();
  res.status(403).json({ erro: "Você só pode consultar os dados do seu próprio filho." });
}

const adminOuProfessor = (req, res, next) => ["admin", "professor"].includes(req.usuario.papel) ? next() : res.status(403).json({ erro: "Acesso negado." });
const semPermissao = (res) => res.status(403).json({ erro: "Você não tem permissão para este aluno." });

const apenasPai = (req, res, next) => req.usuario.papel === "pai" ? next() : res.status(403).json({ erro: "Somente o responsável pelo aluno pode acessar isso." });
const apenasResponsavel = (req, res, next) => req.usuario.papel === "pai" ? next() : res.status(403).json({ erro: "Somente o responsável tem perfil." });

module.exports = { apenasAdmin, apenasProfessor, proprioAlunoOuAdmin, adminOuProfessor, semPermissao, apenasPai, apenasResponsavel };
