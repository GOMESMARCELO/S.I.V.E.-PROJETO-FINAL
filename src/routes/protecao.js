// Rotas: endereços da API e quem pode acessar — Proteção (Conselho Tutelar).
const express = require("express");
const { adminOuProfessor, apenasAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/protecao");

const router = express.Router();

router.get("/api/protecao", autenticar, adminOuProfessor, controller.listarCasos);
router.post("/api/protecao", autenticar, adminOuProfessor, controller.registrarCaso);
router.put("/api/protecao/:id/comunicado", autenticar, apenasAdmin, controller.marcarComunicado);
router.put("/api/protecao/:id", autenticar, adminOuProfessor, controller.editarCaso);
router.post("/api/protecao/:id/anexos", autenticar, adminOuProfessor, controller.anexarDocumento);
router.put("/api/protecao/:id/anexos/:doc", autenticar, adminOuProfessor, controller.editarAnexo);
router.delete("/api/protecao/:id/anexos/:doc", autenticar, adminOuProfessor, controller.removerAnexo);
router.get("/api/protecao/:id/anexos/:doc/arquivo", autenticar, adminOuProfessor, controller.baixarAnexo);
router.get("/api/protecao/aluno/:alunoId", autenticar, adminOuProfessor, controller.verTudoDaCrianca);
router.get("/api/protecao/faltas-limite", autenticar, apenasAdmin, controller.listarFaltasNoLimite);

module.exports = router;
