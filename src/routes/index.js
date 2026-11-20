// Rotas: junta os endereços da API de todos os assuntos (cada arquivo desta pasta cuida de um assunto).
const express = require("express");

const router = express.Router();
router.use(require("./auth"));          // login, senha, duas etapas, política de privacidade
router.use(require("./usuarios"));      // usuários, perfil, reativação, acessibilidade
router.use(require("./painel"));        // Central do Dia, logs, avisos, relatório mensal
router.use(require("./alunos"));        // cadastro, ficha e exportação LGPD dos alunos
router.use(require("./turmas"));        // turmas
router.use(require("./frequencia"));    // chamada, frequência, Busca Ativa, entradas e saídas
router.use(require("./comunicacao"));   // comunicados, autorizações, documentos, pendências, assinaturas
router.use(require("./escolas"));       // "Quero o S.I.V.E. na minha escola" (página inicial)
router.use(require("./ocorrencias"));   // ocorrências escolares
router.use(require("./consentimento")); // termo de consentimento dos responsáveis
router.use(require("./protecao"));      // Proteção (Conselho Tutelar)
router.use(require("./eventos"));       // calendário e banners
router.use(require("./monitoramento")); // câmeras e reconhecimento facial (simulados)

module.exports = router;
