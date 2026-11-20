// Rotas: endereços da API e quem pode acessar — login, senha, duas etapas e política de privacidade.
const express = require("express");
const { limitePorMinuto } = require("../middlewares/limites");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/auth");

const router = express.Router();

router.get("/api/privacidade", controller.verPrivacidade);
router.post("/api/login", limitePorMinuto("login", 30), controller.entrar);
router.post("/api/recuperar-senha", limitePorMinuto("recuperar", 5), controller.recuperarSenha);
router.post("/api/redefinir-senha", limitePorMinuto("redefinir", 10), controller.redefinirSenha);
router.put("/api/minha-senha", autenticar, controller.trocarMinhaSenha);
router.post("/api/sair", autenticar, controller.sair);
router.post("/api/2fa/novo", limitePorMinuto("2fa-novo", 10), autenticar, controller.novoDoisFatores);
router.post("/api/2fa/ativar", autenticar, controller.ativarDoisFatores);
router.post("/api/aceite-privacidade", autenticar, controller.aceitarPrivacidade);

module.exports = router;
