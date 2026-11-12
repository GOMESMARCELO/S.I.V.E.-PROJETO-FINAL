// Pedidos das escolas interessadas (ficha "Quero o S.I.V.E. na minha escola", na página inicial).
// É a ferramenta da equipe comercial do S.I.V.E.: os pedidos não aparecem no painel da escola. Comandos:
//   npm run escolas                                  → lista os pedidos em aberto (novo e em contato)
//   npm run escolas -- --todos                       → lista todos, inclusive os encerrados
//   npm run escolas -- --csv                         → gera escolas-interessadas.csv (abre no Excel)
//   npm run escolas -- --status SIVE-2026-00001 em_contato    → muda a situação (novo, em_contato, contratou, desistiu)
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const config = require("./config.json");

const SITUACOES = { novo: "Novo", em_contato: "Em contato", contratou: "Contratou", desistiu: "Desistiu" };
const REDES = { municipal: "Pública municipal", estadual: "Pública estadual", federal: "Pública federal", privada: "Privada" };
const HORARIOS = { manha: "Manhã", tarde: "Tarde", qualquer: "Qualquer horário" };
const cnpjFormatado = (c) => String(c ?? "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const telefoneFormatado = (t) => t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
const cepFormatado = (c) => String(c ?? "").replace(/^(\d{5})(\d{3})$/, "$1-$2");

async function main() {
  const args = process.argv.slice(2);
  const db = await mysql.createConnection(config.banco);
  try {
    const i = args.indexOf("--status");
    if (i >= 0) {
      const [protocolo, situacao] = [args[i + 1], args[i + 2]];
      if (!SITUACOES[situacao]) throw new Error(`situação inválida. Use: ${Object.keys(SITUACOES).join(", ")}`);
      const [r] = await db.query("UPDATE tb_escolas_interessadas SET esi_status = ? WHERE esi_protocolo = ?", [situacao, protocolo]);
      console.log(r.affectedRows ? `✅ ${protocolo} agora está como "${SITUACOES[situacao]}".` : `Protocolo ${protocolo} não encontrado.`);
      return;
    }
    const [linhas] = await db.query(`SELECT *, DATE_FORMAT(esi_criado_em, '%d/%m/%Y %H:%i') AS em FROM tb_escolas_interessadas
      ${args.includes("--todos") || args.includes("--csv") ? "" : "WHERE esi_status IN ('novo','em_contato')"} ORDER BY id_escola_interessada DESC`);
    if (args.includes("--csv")) {
      const campo = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const cab = ["Protocolo", "Recebido em", "Situação", "Escola", "CNPJ", "Rede", "Etapas", "Alunos", "Endereço", "Bairro", "Cidade", "UF", "CEP",
        "Contato", "Cargo", "E-mail", "Telefone", "Melhor horário", "Mensagem"];
      const corpo = linhas.map((l) => [l.esi_protocolo, l.em, SITUACOES[l.esi_status], l.esi_nome, cnpjFormatado(l.esi_cnpj), REDES[l.esi_rede], l.esi_etapas,
        l.esi_alunos, l.esi_logradouro ? `${l.esi_logradouro}, ${l.esi_numero}${l.esi_complemento ? " - " + l.esi_complemento : ""}` : "", l.esi_bairro, l.esi_cidade, l.esi_uf,
        cepFormatado(l.esi_cep), l.esi_contato_nome, l.esi_contato_cargo, l.esi_email, telefoneFormatado(l.esi_telefone), HORARIOS[l.esi_horario], l.esi_mensagem]);
      const arquivo = path.join(__dirname, "escolas-interessadas.csv");
      // ; e o "BOM" no começo: o Excel em português abre com as colunas e os acentos certos
      fs.writeFileSync(arquivo, "﻿" + [cab, ...corpo].map((l) => l.map(campo).join(";")).join("\r\n"));
      console.log(`📄 ${linhas.length} pedido(s) salvos em ${arquivo}`);
      return;
    }
    if (!linhas.length) { console.log("Nenhum pedido em aberto. (Para ver todos: npm run escolas -- --todos)"); return; }
    console.log(`\n🏫 ${linhas.length} pedido(s)${args.includes("--todos") ? "" : " em aberto"}\n`);
    for (const l of linhas) {
      console.log(`${l.esi_protocolo}  •  ${l.em}  •  ${SITUACOES[l.esi_status]}`);
      // Pedidos antigos têm CNPJ, rede, etapas, endereço e cargo; os novos (ficha simplificada) não
      console.log(`  ${l.esi_nome}${l.esi_cnpj ? `  (CNPJ ${cnpjFormatado(l.esi_cnpj)})  •  ${REDES[l.esi_rede]}` : ""}  •  ${l.esi_alunos} alunos  •  ${l.esi_cidade}/${l.esi_uf}`);
      if (l.esi_etapas) console.log(`  ${l.esi_etapas}`);
      if (l.esi_logradouro) console.log(`  ${l.esi_logradouro}, ${l.esi_numero}${l.esi_complemento ? " - " + l.esi_complemento : ""} — ${l.esi_bairro}, CEP ${cepFormatado(l.esi_cep)}`);
      console.log(`  Falar com: ${l.esi_contato_nome}${l.esi_contato_cargo ? ` (${l.esi_contato_cargo})` : ""} • ${telefoneFormatado(l.esi_telefone)} • ${l.esi_email} • ${HORARIOS[l.esi_horario]}`);
      if (l.esi_mensagem) console.log(`  Mensagem: ${l.esi_mensagem}`);
      console.log("");
    }
  } finally { await db.end(); }
}
main().catch((e) => { console.error("Erro:", e.message); process.exit(1); });
