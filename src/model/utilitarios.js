// Model: pequenas funções de apoio usadas em vários lugares (datas, listas, textos).
const dataValida = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || "");
const idsOuZero = (lista) => (lista.length ? lista : [0]); // "IN ()" vazio é erro no MySQL

const emailValido = (e) => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const normalizar = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const soNumeros = (v) => String(v || "").replace(/\D/g, "");
// SQL: as tabelas guardam só o número da turma (id_turma). Estes trechos trocam número por nome, e nome por número.
const nomeTurma = (tabela) => `(SELECT tt.nome FROM tb_turmas tt WHERE tt.id_turma = ${tabela}.id_turma)`;
const ID_TURMA = "(SELECT id_turma FROM tb_turmas WHERE nome = ?)";

module.exports = { dataValida, idsOuZero, emailValido, normalizar, soNumeros, nomeTurma, ID_TURMA };
