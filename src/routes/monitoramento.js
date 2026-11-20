// Rotas: endereços da API e quem pode acessar — câmeras e reconhecimento facial (simulados).
const express = require("express");
const { apenasAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/monitoramento");

const router = express.Router();

router.get("/api/alunos/:alunoId/agora", autenticar, controller.verSituacaoAgora);
router.get("/api/monitoramento", autenticar, apenasAdmin, controller.verMonitoramento);
router.put("/api/configuracoes/reconhecimento-facial", autenticar, apenasAdmin, controller.ligarReconhecimentoFacial);
router.post("/api/cameras", autenticar, apenasAdmin, controller.criarCamera);
router.put("/api/cameras/:id/ativa", autenticar, apenasAdmin, controller.ativarCamera);
router.delete("/api/cameras/:id", autenticar, apenasAdmin, controller.removerCamera);
router.post("/api/reconhecimento/simular", autenticar, apenasAdmin, controller.simularReconhecimento);
router.post("/api/saidas/manual", autenticar, apenasAdmin, controller.liberarSaida);

module.exports = router;
