// View: rótulos e formatos de exibição (nomes abreviados, destinos mascarados).
const mascararDestino = (metodo, destino) => (metodo === "email" ? destino.replace(/^(.{1,2}).*?(@.*)$/, "$1***$2") : `(**) *****-${destino.slice(-4)}`);
// Verificação pública (sem login): mostra só o necessário para conferir. O nome de quem assinou aparece abreviado (LGPD).
const ROTULO_DOCUMENTO = { ocorrencia: "Ocorrência escolar", autorizacao: "Autorização", consentimento: "Termo de consentimento" };
const ROTULO_PAPEL = { professor: "Professor(a)", resp: "Responsável pelo aluno", gestao: "Gestão da escola" };
const nomeAbreviado = (nome) => { const p = String(nome).trim().split(/\s+/); return [p[0], ...p.slice(1).map((x) => x[0].toUpperCase() + ".")].join(" "); };

module.exports = { mascararDestino, ROTULO_DOCUMENTO, ROTULO_PAPEL, nomeAbreviado };
