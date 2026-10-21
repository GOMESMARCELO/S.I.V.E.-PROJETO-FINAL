// Importação de alunos por planilha (CSV ou Excel .xlsx).
// Este arquivo só LÊ e CONFERE a planilha: não grava nada no banco. O server.js grava depois, quando a gestão confirma.
// A planilha nunca é guardada no servidor: é lida da memória e descartada.

class ErroPlanilha extends Error {}

const MAX_LINHAS = 500;                     // alunos por importação
const TAMANHO_MAXIMO = 2 * 1024 * 1024;     // 2 MB

const limpa = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const normaliza = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------- leitura do arquivo
function decodificarTexto(buf) {
  if (buf.includes(0)) throw new ErroPlanilha("Esse arquivo não parece uma planilha. Use CSV ou Excel (.xlsx).");
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") throw new ErroPlanilha("Esse arquivo é um PDF. Use uma planilha em CSV ou Excel (.xlsx).");
  let texto;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { texto = new TextDecoder("windows-1252").decode(buf); } // CSV salvo pelo Excel em português costuma ser Windows-1252
  return texto.replace(/^\uFEFF/, "");
}

// CSV com separador ; , ou tabulação (detecta sozinho), aspas e quebras de linha dentro de aspas
function lerCsv(texto) {
  const primeira = texto.split(/\r\n|\n|\r/).find((l) => l.trim() !== "") || "";
  const contar = (d) => { let n = 0, dentro = false; for (const c of primeira) { if (c === '"') dentro = !dentro; else if (c === d && !dentro) n++; } return n; };
  const ordenados = [";", ",", "\t"].map((d) => [d, contar(d)]).sort((a, b) => b[1] - a[1]);
  const delimitador = ordenados[0][1] > 0 ? ordenados[0][0] : ";";
  const linhas = []; let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === delimitador) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const celulaParaTexto = (c) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

async function lerXlsx(buf) {
  let biblioteca;
  try { biblioteca = require("read-excel-file/node"); }
  catch { throw new ErroPlanilha("Para ler arquivos do Excel (.xlsx), rode \"npm install\" na pasta do projeto e reinicie o servidor. Enquanto isso, salve a planilha como CSV e envie de novo."); }
  let linhas;
  try { linhas = await biblioteca.readSheet(buf); } // lê a primeira aba da planilha
  catch { throw new ErroPlanilha("Não consegui abrir esse arquivo. Confirme que é uma planilha do Excel (.xlsx) sem senha. Se continuar assim, salve como CSV."); }
  return linhas.map((l) => l.map(celulaParaTexto));
}

async function lerPlanilha(buf) {
  if (!buf.length) throw new ErroPlanilha("O arquivo está vazio.");
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return lerXlsx(buf);  // .xlsx é um arquivo zip
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw new ErroPlanilha("Esse é o formato antigo do Excel (.xls). Abra a planilha, use \"Salvar como\" e escolha .xlsx ou CSV.");
  return lerCsv(decodificarTexto(buf));
}

// ---------------------------------------------------------------- colunas e linhas
// Nomes aceitos para cada coluna (sem acento, sem espaço, tanto faz maiúscula ou minúscula)
const ALIASES = {
  nome: ["nome", "nomedoaluno", "nomealuno", "aluno", "estudante", "nomecompleto"],
  sala: ["turma", "sala", "serie", "classe", "anoturma", "turmasala"],
  matricula: ["matricula", "matr", "ra", "registro", "nmatricula", "nmatr", "numerodematricula"],
  resp1: ["responsavel", "nomedoresponsavel", "responsavel1", "nomeresponsavel", "nomedoresponsavel1"],
  par1: ["parentesco", "parentesco1", "grau", "grauparentesco", "vinculo"],
  tel1: ["telefone", "telefone1", "celular", "fone", "whatsapp", "telefonedoresponsavel", "contato"],
  resp2: ["responsavel2", "nomedoresponsavel2", "nomeresponsavel2"],
  par2: ["parentesco2", "grau2", "vinculo2"],
  tel2: ["telefone2", "celular2", "fone2", "contato2", "telefonedoresponsavel2"],
};

function acharCabecalho(linhas) { // procura, nas 10 primeiras linhas, a que tem a coluna de nome (pode haver um título antes)
  const candidatas = linhas.slice(0, 10).map((l, i) => [i, l]).filter(([, l]) => l.some((c) => limpa(c) !== ""));
  const comNome = candidatas.find(([, l]) => l.some((c) => ALIASES.nome.includes(normaliza(c))));
  return comNome ? comNome[0] : candidatas.length ? candidatas[0][0] : -1;
}

const comecaPerigoso = (v) => /^[=+\-@]/.test(v);     // fórmulas do Excel (=, +, -, @) não são aceitas em textos
const temLetra = (v) => /\p{L}/u.test(v);
const telefoneValido = (t) => { const d = t.replace(/\D/g, ""); return /^[0-9+()\s./-]+$/.test(t) && t.length <= 20 && d.length >= 8 && d.length <= 13; };

function validarLinha(numero, l, col, turmaPadrao) {
  const pega = (campo) => (col[campo] === undefined ? "" : limpa(l[col[campo]]));
  const problemas = [];
  const texto = (rotulo, v, max, { letras = false } = {}) => {
    if (v.length > max) problemas.push(`${rotulo} passa de ${max} caracteres`);
    else if (comecaPerigoso(v)) problemas.push(`${rotulo} não pode começar com = + - ou @`);
    else if (letras && !temLetra(v)) problemas.push(`${rotulo} parece inválido`);
  };

  const nome = pega("nome");
  if (!nome) problemas.push("Nome do aluno em branco");
  else if (normaliza(nome).startsWith("exemplo")) problemas.push("Linha de exemplo do modelo: apague antes de importar");
  else texto("Nome", nome, 100, { letras: true });

  const sala = pega("sala") || turmaPadrao;
  if (!sala) problemas.push("Turma em branco");
  else texto("Turma", sala, 20);

  let matricula = pega("matricula");
  if (/^\d+\.0+$/.test(matricula)) matricula = matricula.replace(/\.0+$/, ""); // 2026001.0 vira 2026001
  if (matricula) {
    if (matricula.length > 20) problemas.push("Matrícula passa de 20 caracteres");
    else if (!/^[\p{L}\p{N}._/-]+$/u.test(matricula)) problemas.push("Matrícula com caracteres inválidos");
  }

  const responsaveis = [];
  for (const n of ["1", "2"]) {
    const rn = pega("resp" + n), rp = pega("par" + n), rt = pega("tel" + n);
    if (!rn && !rp && !rt) continue;
    const suf = n === "2" ? " 2" : "";
    if (!rn) { problemas.push(`Responsável${suf}: falta o nome (há parentesco ou telefone sem nome)`); continue; }
    texto(`Responsável${suf}`, rn, 100, { letras: true });
    if (rp) texto(`Parentesco${suf}`, rp, 20);
    if (rt && !telefoneValido(rt)) problemas.push(`Telefone${suf} inválido (use só números, com DDD)`);
    const chave = normaliza(rn) + "|" + rt.replace(/\D/g, "");
    if (!responsaveis.some((r) => r.chave === chave)) responsaveis.push({ nome: rn, parentesco: rp || "Responsável", telefone: rt, chave });
  }
  return { linha: numero, nome, sala, matricula, responsaveis: responsaveis.map(({ chave, ...r }) => r), problemas, status: problemas.length ? "erro" : "ok" };
}

// Lê as linhas cruas (listas de células) e devolve as linhas validadas
function analisar(linhasCruas, { turmaPadrao = "" } = {}) {
  const idxCab = acharCabecalho(linhasCruas);
  if (idxCab < 0) throw new ErroPlanilha("A planilha está vazia.");
  const originais = linhasCruas[idxCab].map(limpa), col = {}, reconhecidas = [], ignoradas = [];
  originais.forEach((titulo, i) => {
    const campo = Object.keys(ALIASES).find((k) => ALIASES[k].includes(normaliza(titulo)));
    if (campo && col[campo] === undefined) { col[campo] = i; reconhecidas.push(titulo); } else if (titulo) ignoradas.push(titulo);
  });
  if (col.nome === undefined) throw new ErroPlanilha(`Não encontrei a coluna "Nome" no cabeçalho da planilha. Colunas encontradas: ${originais.filter(Boolean).join(", ") || "nenhuma"}. Use o modelo para conferir os nomes das colunas.`);
  const turma = limpa(turmaPadrao);
  if (col.sala === undefined && !turma) throw new ErroPlanilha("Não encontrei a coluna \"Turma\". Inclua essa coluna na planilha ou preencha o campo \"Turma para todos os alunos\".");
  const dados = [];
  for (let i = idxCab + 1; i < linhasCruas.length; i++) if (linhasCruas[i].some((c) => limpa(c) !== "")) dados.push([i + 1, linhasCruas[i]]);
  if (!dados.length) throw new ErroPlanilha("A planilha tem só o cabeçalho, sem nenhum aluno.");
  if (dados.length > MAX_LINHAS) throw new ErroPlanilha(`A planilha tem ${dados.length} alunos. O limite é ${MAX_LINHAS} por importação: divida em partes.`);
  return { linhas: dados.map(([numero, l]) => validarLinha(numero, l, col, turma)), reconhecidas, ignoradas };
}

// Marca como "duplicado" quem já existe no banco ou aparece repetido na planilha (assim, enviar a mesma planilha duas vezes não cria alunos em dobro).
// Regra: mesma matrícula = duplicado. Sem matrícula (em um dos lados), mesmo nome na mesma turma = duplicado.
function marcarDuplicados(linhas, existentes) {
  const chaveMat = (m) => limpa(m).toLowerCase();
  const chaveNS = (n, s) => normaliza(n) + "|" + normaliza(s);
  const matriculas = new Map(); // matrícula -> "banco" ou número da linha
  const nomeSala = new Map();   // nome|turma -> [{ mat, origem }]
  for (const e of existentes) {
    if (e.matricula) matriculas.set(chaveMat(e.matricula), "banco");
    const k = chaveNS(e.nome, e.sala);
    nomeSala.set(k, [...(nomeSala.get(k) || []), { mat: e.matricula ? chaveMat(e.matricula) : null, origem: "banco" }]);
  }
  for (const l of linhas) {
    if (l.status !== "ok") continue;
    const mat = l.matricula ? chaveMat(l.matricula) : null, k = chaveNS(l.nome, l.sala);
    const onde = (o) => (o === "banco" ? "já cadastrado no sistema" : `repetido na linha ${o} da planilha`);
    if (mat && matriculas.has(mat)) { l.status = "duplicado"; l.problemas.push(`Matrícula ${l.matricula} ${onde(matriculas.get(mat))}`); continue; }
    const iguais = (nomeSala.get(k) || []).filter((x) => !mat || x.mat === null || x.mat === mat);
    if (iguais.length) { l.status = "duplicado"; l.problemas.push(`Aluno com esse nome e turma ${onde(iguais[0].origem)}`); continue; }
    if (mat) matriculas.set(mat, l.linha);
    nomeSala.set(k, [...(nomeSala.get(k) || []), { mat, origem: l.linha }]);
  }
}

module.exports = { lerPlanilha, analisar, marcarDuplicados, ErroPlanilha, MAX_LINHAS, TAMANHO_MAXIMO };
