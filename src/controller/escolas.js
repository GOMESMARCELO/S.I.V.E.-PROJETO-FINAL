// Controller: o que cada endereço da API faz — pedidos de escolas interessadas (página inicial).
const crypto = require("crypto");
const { protocolo } = require("../../config");
const db = require("../model/db");
const { soNumeros } = require("../model/utilitarios");
const { rota } = require("../middlewares/rota");

// ---------- Página inicial: ficha "Quero o S.I.V.E. na minha escola" (pública, sem login) ----------
// A escola interessada preenche os dados e recebe um protocolo. A equipe S.I.V.E. consulta os pedidos com: npm run escolas
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const registrarEscolaInteressada = rota(async (req, res) => {
  const b = req.body || {};
  // Campo escondido (só robôs preenchem): finge que deu certo e não grava nada
  if (b.site) return res.json({ protocolo: `SIVE-${new Date().getFullYear()}-${String(crypto.randomInt(10000, 99999))}` });
  const texto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const d = {
    nome: texto(b.nome, 150), cidade: texto(b.cidade, 80), uf: String(b.uf || "").toUpperCase(), alunos: Number(b.alunos),
    contato_nome: texto(b.contato_nome, 100), email: texto(b.email, 120).toLowerCase(), telefone: soNumeros(b.telefone),
  };
  // Cada erro diz qual campo está errado, para a tela levar a pessoa direto até ele
  const erro = (campo, msg) => res.status(400).json({ erro: msg, campo });
  if (d.nome.length < 3) return erro("nome", "Informe o nome da escola.");
  if (d.cidade.length < 2) return erro("cidade", "Informe a cidade.");
  if (!UFS.includes(d.uf)) return erro("uf", "Escolha o estado (UF).");
  if (!Number.isInteger(d.alunos) || d.alunos < 1 || d.alunos > 100000) return erro("alunos", "Informe quantos alunos a escola tem (aproximadamente).");
  if (d.contato_nome.length < 2) return erro("contato_nome", "Informe o seu nome.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return erro("email", "E-mail inválido.");
  if (!/^[1-9]{2}9?\d{8}$/.test(d.telefone)) return erro("telefone", "Telefone inválido. Use DDD + número (ex.: 11 98765-4321).");
  if (b.aceite !== true) return erro("aceite", "Para entrarmos em contato, marque que concorda com o uso dos dados.");
  // A mesma pessoa pediu há pouco tempo para a mesma escola e o pedido ainda está aberto: devolve o protocolo que ela já tem
  const [[antes]] = await db.query(`SELECT protocolo AS protocolo, DATE_FORMAT(criado_em, '%d/%m/%Y') AS em FROM tb_escolas_interessadas
    WHERE email = ? AND nome = ? AND status IN ('novo','em_contato') AND criado_em >= NOW() - INTERVAL 30 DAY ORDER BY id_escola_interessada DESC LIMIT 1`, [d.email, d.nome]);
  if (antes) return res.json({ protocolo: antes.protocolo, repetido: true, em: antes.em });
  const [r] = await db.query(`INSERT INTO tb_escolas_interessadas (nome, alunos, cidade, uf, contato_nome, email, telefone, aceite_em, ip)
    VALUES (?,?,?,?,?,?,?,NOW(),?)`, [d.nome, d.alunos, d.cidade, d.uf, d.contato_nome, d.email, d.telefone, req.ip]);
  const protocolo = `SIVE-${new Date().getFullYear()}-${String(r.insertId).padStart(5, "0")}`;
  await db.query("UPDATE tb_escolas_interessadas SET protocolo = ? WHERE id_escola_interessada = ?", [protocolo, r.insertId]);
  console.log(`🏫 Nova escola interessada: ${d.nome} (${d.cidade}/${d.uf}) — protocolo ${protocolo}`);
  res.status(201).json({ protocolo });
});

module.exports = { UFS, registrarEscolaInteressada };
