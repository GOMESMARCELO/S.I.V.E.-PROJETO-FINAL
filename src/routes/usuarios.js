// Rotas: endereços da API e quem pode acessar — usuários, perfil, reativação e acessibilidade.
const express = require("express");
const { apenasAdmin, apenasResponsavel } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/usuarios");

const router = express.Router();

router.put("/api/usuarios/:id/2fa/zerar", autenticar, apenasAdmin, controller.zerarDoisFatores);
router.get("/api/usuarios", autenticar, apenasAdmin, controller.listarUsuarios);
router.post("/api/usuarios", autenticar, apenasAdmin, controller.criarUsuario);
router.put("/api/usuarios/:id/email", autenticar, apenasAdmin, controller.atualizarEmail);
router.put("/api/usuarios/:id/ativo", autenticar, apenasAdmin, controller.ativarOuDesativar);
router.post("/api/usuarios/:id/filhos", autenticar, apenasAdmin, controller.vincularFilho);
router.delete("/api/usuarios/:id/filhos/:alunoId", autenticar, apenasAdmin, controller.desvincularFilho);
router.put("/api/usuarios/:id/turmas", autenticar, apenasAdmin, controller.atualizarTurmasDoDocente);
router.get("/api/meu-contexto", autenticar, controller.verMeuContexto);
router.get("/api/reativacao", autenticar, apenasAdmin, controller.listarReativacao);
router.put("/api/usuarios/:id/nova-senha", autenticar, apenasAdmin, controller.gerarNovaSenha);
router.put("/api/usuarios/:id/reativar", autenticar, apenasAdmin, controller.reativarUsuario);
router.get("/api/meu-perfil", autenticar, apenasResponsavel, controller.verMeuPerfil);
router.put("/api/meu-perfil", autenticar, apenasResponsavel, controller.atualizarMeuPerfil);
router.put("/api/acessibilidade", autenticar, controller.salvarAcessibilidade);
router.post("/api/tutorial/visto", autenticar, controller.marcarTutorialVisto);

module.exports = router;
