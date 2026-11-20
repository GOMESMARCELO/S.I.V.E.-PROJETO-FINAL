// Rotas: endereços da API e quem pode acessar — ocorrências escolares.
const express = require("express");
const { apenasAdmin, apenasPai, apenasProfessor } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/ocorrencias");

const router = express.Router();

router.get("/api/ocorrencias-escolares", autenticar, apenasProfessor, controller.listarOcorrenciasDaTurma);
router.get("/api/minhas-ocorrencias", autenticar, apenasPai, controller.listarMinhasOcorrencias);
router.get("/api/minhas-ocorrencias/novas", autenticar, apenasPai, controller.contarOcorrenciasNovas);
router.post("/api/minhas-ocorrencias/:id/assinar", autenticar, apenasPai, controller.assinarComoResponsavel);
router.get("/api/ocorrencias-gestao", autenticar, apenasAdmin, controller.listarOcorrenciasDaGestao);
router.post("/api/ocorrencias-gestao/:id/assinar", autenticar, apenasAdmin, controller.assinarComoGestao);
router.post("/api/ocorrencias-escolares", autenticar, apenasProfessor, controller.registrarOcorrencia);

module.exports = router;
