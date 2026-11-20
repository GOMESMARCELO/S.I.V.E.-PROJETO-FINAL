// Rotas: endereços da API e quem pode acessar — termo de consentimento dos responsáveis.
const express = require("express");
const { apenasAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/consentimento");

const router = express.Router();

router.get("/api/consentimento-termo", controller.verTermo);
router.get("/api/alunos/:alunoId/consentimento", autenticar, controller.verConsentimento);
router.post("/api/alunos/:alunoId/consentimento", autenticar, controller.assinarConsentimento);
router.get("/api/consentimentos", autenticar, apenasAdmin, controller.listarConsentimentos);

module.exports = router;
