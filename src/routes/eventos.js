// Rotas: endereços da API e quem pode acessar — calendário de eventos e banners.
const express = require("express");
const { adminOuProfessor, apenasAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/eventos");

const router = express.Router();

router.get("/api/eventos", autenticar, controller.listarEventos);
router.get("/api/eventos/banners", autenticar, controller.listarBanners);
router.post("/api/eventos", autenticar, adminOuProfessor, controller.criarEvento);
router.put("/api/eventos/:id", autenticar, apenasAdmin, controller.editarEvento);
router.delete("/api/eventos/:id", autenticar, apenasAdmin, controller.removerEvento);
router.get("/api/eventos/:id/banner", autenticar, controller.verBanner);

module.exports = router;
