// Rotas: endereços da API e quem pode acessar — comunicados, autorizações, documentos, pendências e verificação de assinaturas.
const express = require("express");
const { limitePorMinuto } = require("../middlewares/limites");
const { adminOuProfessor, apenasAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/comunicacao");

const router = express.Router();

router.get("/api/comunicados", autenticar, adminOuProfessor, controller.listarComunicados);
router.post("/api/comunicados", autenticar, adminOuProfessor, controller.criarComunicado);
router.get("/api/comunicados/:id/leituras", autenticar, adminOuProfessor, controller.verLeituras);
router.post("/api/comunicados/:id/ler", autenticar, controller.marcarComunicadoLido);
router.post("/api/autorizacoes", autenticar, apenasAdmin, controller.criarAutorizacao);
router.get("/api/autorizacoes-grupos", autenticar, apenasAdmin, controller.listarGruposDeAutorizacao);
router.get("/api/autorizacoes-grupos/:grupo", autenticar, apenasAdmin, controller.verGrupoDeAutorizacao);
router.post("/api/autorizacoes/:id/assinar", autenticar, controller.assinarAutorizacao);
router.post("/api/documentos", autenticar, controller.enviarDocumento);
router.get("/api/documentos/:id/arquivo", autenticar, controller.baixarDocumento);
router.delete("/api/documentos/:id", autenticar, apenasAdmin, controller.removerDocumento);
router.post("/api/pendencias", autenticar, adminOuProfessor, controller.criarPendencia);
router.put("/api/pendencias/:id/resolver", autenticar, apenasAdmin, controller.resolverPendencia);
router.post("/api/advertencias", autenticar, adminOuProfessor, controller.criarAdvertencia);
router.get("/api/verificar/:codigo", limitePorMinuto("verificar", 60), controller.verificarAssinatura);
router.get("/api/verificar/:codigo/qr.svg", limitePorMinuto("qr", 60), controller.verQrCodeDaAssinatura);

module.exports = router;
