// Rotas: endereços da API e quem pode acessar — Central do Dia, logs, avisos e relatório mensal.
const express = require("express");
const { apenasAdmin, apenasPai } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/painel");

const router = express.Router();

router.get("/api/resumo", autenticar, apenasAdmin, controller.verResumo);
router.get("/api/documentos-recentes", autenticar, apenasAdmin, controller.listarDocumentosRecentes);
router.get("/api/logs", autenticar, apenasAdmin, controller.listarLogs);
router.get("/api/logs/integridade", autenticar, apenasAdmin, controller.verificarIntegridadeDosLogs);
router.get("/api/relatorio-mensal", autenticar, apenasAdmin, controller.verRelatorioMensal);
router.get("/api/avisos", autenticar, apenasPai, controller.listarAvisos);
router.post("/api/avisos/vistos", autenticar, apenasPai, controller.marcarAvisosVistos);

module.exports = router;
