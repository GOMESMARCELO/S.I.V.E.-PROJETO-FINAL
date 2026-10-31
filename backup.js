// Backup do S.I.V.E.: grava o banco inteiro em um arquivo CRIPTOGRAFADO (sive.sql.enc, AES-256-GCM) e copia a pasta uploads/
// (documentos e banners, que já ficam criptografados). Cada backup fica em <pasta>/AAAA-MM-DD_HHhMM/ e só os últimos `manter` ficam.
// A pasta padrão é backups/ dentro do projeto. Para guardar em outro lugar (recomendado: fora do OneDrive), use no config.json:
//   "backup": { "pasta": "D:\\backups-sive", "manter": 14 }
// O servidor faz um backup por dia sozinho. Comandos:
//   npm run backup                                     → faz um backup na hora
//   node backup.js --decifrar <pasta>/sive.sql.enc     → gera o sive.sql para restaurar (mysql -u root -p sive < sive.sql)
// IMPORTANTE: o backup só abre com a chave "chave_arquivos" do config.json. Guarde uma cópia do config.json em OUTRO lugar seguro
// (pendrive guardado na escola, cofre de senhas), separada dos backups: quem tiver os dois juntos lê tudo.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LOTE = 200; // linhas por INSERT
const MAGIA = Buffer.from("SIVEB1"), AAD = Buffer.from("backup-sive");
const pastaDosBackups = (config) => path.resolve(__dirname, ((config && config.backup) || {}).pasta || "backups");

function cifrar(texto, chave) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", chave, iv);
  c.setAAD(AAD);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), dados]);
}
function decifrar(bytes, chave) { // lança erro se o arquivo foi alterado ou se a chave for outra
  if (!bytes.subarray(0, MAGIA.length).equals(MAGIA)) throw new Error("este arquivo não é um backup criptografado do S.I.V.E.");
  const i = MAGIA.length, d = crypto.createDecipheriv("aes-256-gcm", chave, bytes.subarray(i, i + 12));
  d.setAAD(AAD);
  d.setAuthTag(bytes.subarray(i + 12, i + 28));
  return Buffer.concat([d.update(bytes.subarray(i + 28)), d.final()]).toString("utf8");
}

async function gerarBackup(db, { pastaUploads, manter = 14, chave, pasta }) {
  if (!chave) throw new Error("sem a chave de criptografia, o backup não é feito");
  const agora = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const nome = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}_${p2(agora.getHours())}h${p2(agora.getMinutes())}`;
  const destino = path.join(pasta, nome);
  fs.mkdirSync(destino, { recursive: true });

  const linhas = [`-- Backup do S.I.V.E. em ${agora.toLocaleString("pt-BR")}`, "SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;", ""];
  const [tabelas] = await db.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name");
  for (const { t } of tabelas) {
    const [[criacao]] = await db.query(`SHOW CREATE TABLE \`${t}\``);
    linhas.push(`DROP TABLE IF EXISTS \`${t}\`;`, criacao["Create Table"] + ";");
    // Colunas calculadas (GENERATED) não entram no INSERT: o próprio banco as recalcula
    const [colunas] = await db.query(`SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND extra NOT LIKE '%GENERATED%' ORDER BY ordinal_position`, [t]);
    const nomes = colunas.map(({ c }) => `\`${c}\``).join(", ");
    const [dados] = await db.query(`SELECT ${nomes} FROM \`${t}\``);
    for (let i = 0; i < dados.length; i += LOTE) {
      const valores = dados.slice(i, i + LOTE).map((d) => `(${colunas.map(({ c }) => db.escape(d[c])).join(", ")})`);
      linhas.push(`INSERT INTO \`${t}\` (${nomes}) VALUES\n${valores.join(",\n")};`);
    }
    linhas.push("");
  }
  linhas.push("SET FOREIGN_KEY_CHECKS = 1;");
  fs.writeFileSync(path.join(destino, "sive.sql.enc"), cifrar(linhas.join("\n"), chave)); // dados pessoais: nunca em texto aberto
  if (pastaUploads && fs.existsSync(pastaUploads)) fs.cpSync(pastaUploads, path.join(destino, "uploads"), { recursive: true });

  // Mantém só os últimos `manter` backups
  const antigos = fs.readdirSync(pasta).filter((n) => /^\d{4}-\d{2}-\d{2}_/.test(n)).sort().reverse().slice(manter);
  for (const n of antigos) fs.rmSync(path.join(pasta, n), { recursive: true, force: true });
  return destino;
}
// Já existe backup de hoje? (o servidor usa para fazer só um por dia)
function temBackupDeHoje(pasta) {
  const agora = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const hoje = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}_`;
  return fs.existsSync(pasta) && fs.readdirSync(pasta).some((n) => n.startsWith(hoje) && fs.existsSync(path.join(pasta, n, "sive.sql.enc")));
}

module.exports = { gerarBackup, temBackupDeHoje, pastaDosBackups };

if (require.main === module) {
  const config = require("./config.json");
  const chave = config.seguranca && /^[0-9a-f]{64}$/.test(config.seguranca.chave_arquivos || "") ? Buffer.from(config.seguranca.chave_arquivos, "hex") : null;
  if (!chave) { console.error("config.json sem a chave_arquivos: ligue o servidor uma vez (npm start) para ela ser criada."); process.exit(1); }
  const i = process.argv.indexOf("--decifrar");
  if (i > 0) {
    // node backup.js --decifrar backups/<pasta>/sive.sql.enc  → cria o sive.sql ao lado, para restaurar no MySQL
    const arquivo = process.argv[i + 1];
    if (!arquivo) { console.error("Uso: node backup.js --decifrar <caminho>/sive.sql.enc"); process.exit(1); }
    try {
      const saida = arquivo.replace(/\.enc$/, "");
      fs.writeFileSync(saida, decifrar(fs.readFileSync(arquivo), chave));
      console.log("Pronto:", saida, "\nRestaure com: mysql -u root -p sive <", saida, "\nDepois APAGUE esse arquivo: ele tem os dados em texto aberto.");
    } catch (e) { console.error("Não foi possível abrir o backup:", e.message, "(arquivo alterado ou chave diferente)"); process.exit(1); }
    return;
  }
  const mysql = require("mysql2/promise");
  (async () => {
    const db = mysql.createPool(config.banco);
    const pasta = await gerarBackup(db, { pastaUploads: path.join(__dirname, "uploads"), manter: (config.backup || {}).manter || 14, chave, pasta: pastaDosBackups(config) });
    console.log("Backup criptografado feito em", pasta);
    await db.end();
  })().catch((e) => { console.error("Falha no backup:", e.message); process.exit(1); });
}
