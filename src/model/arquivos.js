// Model: pasta dos documentos enviados (uploads/), tipos permitidos e criptografia dos arquivos antigos.
const fs = require("fs");
const path = require("path");
const { RAIZ } = require("../../config");
const { MAGIA, cifrarArquivo } = require("./seguranca");

// Pasta onde ficam os documentos anexados (fora das pastas públicas)
const PASTA_UPLOADS = path.join(RAIZ, "uploads");
fs.mkdirSync(PASTA_UPLOADS, { recursive: true });
function protegerArquivosAntigos() { // arquivos enviados antes desta versão são criptografados na primeira execução
  let total = 0;
  for (const nome of fs.readdirSync(PASTA_UPLOADS)) {
    const caminho = path.join(PASTA_UPLOADS, nome);
    if (!fs.statSync(caminho).isFile()) continue;
    const bytes = fs.readFileSync(caminho);
    if (bytes.subarray(0, MAGIA.length).equals(MAGIA)) continue;
    fs.writeFileSync(caminho, cifrarArquivo(bytes, nome)); total++;
  }
  if (total) console.log(`🔐 ${total} arquivo(s) antigo(s) foram criptografados.`);
}

const DOCUMENTO_CATEGORIAS = ["Desenvolvimento", "Saúde", "Identificação", "Outros"];
const TIPOS_DOCUMENTO = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// Primeiros bytes de cada formato: confere se o conteúdo bate com a extensão (não basta confiar no nome)
const ASSINATURAS_ARQUIVO = {
  pdf: [0x25, 0x50, 0x44, 0x46], png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff],
  docx: [0x50, 0x4b], doc: [0xd0, 0xcf, 0x11, 0xe0],
};
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

module.exports = { PASTA_UPLOADS, protegerArquivosAntigos, DOCUMENTO_CATEGORIAS, TIPOS_DOCUMENTO, ASSINATURAS_ARQUIVO, TAMANHO_MAXIMO };
