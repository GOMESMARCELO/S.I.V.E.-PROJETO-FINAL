// Rotas: endereços da API e quem pode acessar — cadastro, ficha e exportação LGPD dos alunos.
const express = require("express");
const { apenasAdmin, proprioAlunoOuAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/alunos");

const router = express.Router();

router.get("/api/alunos", autenticar, apenasAdmin, controller.listarAlunos);
router.post("/api/alunos", autenticar, apenasAdmin, controller.criarAluno);
router.post("/api/alunos/importar", autenticar, apenasAdmin, controller.importarAlunos);
router.put("/api/alunos/:alunoId/situacao", autenticar, apenasAdmin, controller.atualizarSituacao);
router.get("/api/alunos/:alunoId", autenticar, proprioAlunoOuAdmin, controller.verAluno);
router.get("/api/gestao-alunos", autenticar, apenasAdmin, controller.listarGestaoDeAlunos);
router.get("/api/alunos/:alunoId/ficha", autenticar, controller.verFicha);
router.get("/api/alunos/:alunoId/meus-dados", autenticar, proprioAlunoOuAdmin, controller.exportarDadosDoAluno);

module.exports = router;
