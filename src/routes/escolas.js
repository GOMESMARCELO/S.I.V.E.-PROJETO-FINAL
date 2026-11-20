// Rotas: endereços da API e quem pode acessar — pedidos de escolas interessadas (página inicial).
const express = require("express");
const { limitePorMinuto } = require("../middlewares/limites");
const controller = require("../controller/escolas");

const router = express.Router();

router.post("/api/escolas-interessadas", limitePorMinuto("escola", 5), controller.registrarEscolaInteressada);

module.exports = router;
