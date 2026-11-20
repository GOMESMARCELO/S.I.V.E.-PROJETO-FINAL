// Rotas: endereços da API e quem pode acessar — turmas.
const express = require("express");
const { apenasAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/turmas");

const router = express.Router();

router.get("/api/turmas", autenticar, apenasAdmin, controller.listarTurmas);
router.post("/api/turmas", autenticar, apenasAdmin, controller.criarTurma);
router.put("/api/turmas/:id", autenticar, apenasAdmin, controller.atualizarTurma);

module.exports = router;
