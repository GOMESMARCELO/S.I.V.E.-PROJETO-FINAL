// Rotas: endereços da API e quem pode acessar — chamada, frequência, Busca Ativa, entradas e saídas.
const express = require("express");
const { apenasAdmin, apenasProfessor, proprioAlunoOuAdmin } = require("../middlewares/permissoes");
const { autenticar } = require("../middlewares/autenticacao");
const controller = require("../controller/frequencia");

const router = express.Router();

router.get("/api/frequencia", autenticar, apenasAdmin, controller.verFrequencia);
router.get("/api/busca-ativa", autenticar, apenasAdmin, controller.listarBuscaAtiva);
router.post("/api/busca-ativa/:id/acompanhamento", autenticar, apenasAdmin, controller.registrarAcompanhamento);
router.put("/api/busca-ativa/:id/encerrar", autenticar, apenasAdmin, controller.encerrarBuscaAtiva);
router.get("/api/acessos", autenticar, apenasAdmin, controller.listarAcessos);
router.post("/api/acessos", autenticar, apenasAdmin, controller.registrarEntrada);
router.get("/api/saida", autenticar, apenasAdmin, controller.verSaida);
router.post("/api/saidas", autenticar, apenasAdmin, controller.registrarSaida);
router.get("/api/minha-turma", autenticar, apenasProfessor, controller.verMinhaTurma);
router.post("/api/chamada", autenticar, apenasProfessor, controller.salvarChamada);
router.get("/api/presencas/:alunoId", autenticar, proprioAlunoOuAdmin, controller.verPresencas);

module.exports = router;
