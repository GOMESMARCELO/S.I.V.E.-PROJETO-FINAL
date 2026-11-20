// Model: log de atividades (quem fez o quê, e quando), com corrente de hashes contra alteração.
const crypto = require("crypto");
const db = require("./db");

const SISTEMA = { id: null, nome: "Sistema", papel: "sistema" };

// Grava uma linha no log de atividades (quem fez o quê, e quando).
// Corrente de hashes: cada linha guarda SHA-256(hash da linha anterior + dados da linha). Apagar ou alterar um log no meio quebra a corrente.
// A fila garante a ordem quando várias ações chegam ao mesmo tempo.
const dataHoraLocal = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const hashLog = (anterior, l) => crypto.createHash("sha256").update([anterior || "", l.id_usuario ?? "", l.nome, l.papel, l.acao, l.detalhe ?? "", l.em].join("|")).digest("hex");
let filaLog = Promise.resolve();
function registrarLog(usuario, acao, detalhe) {
  const tarefa = filaLog.then(async () => {
    const [[ultimo]] = await db.query("SELECT hash AS h FROM tb_logs WHERE hash IS NOT NULL ORDER BY id_log DESC LIMIT 1");
    const l = { id_usuario: usuario ? usuario.id : null, nome: usuario ? usuario.nome : "Desconhecido", papel: usuario ? usuario.papel : "-", acao, detalhe: detalhe || null, em: dataHoraLocal() };
    await db.query("INSERT INTO tb_logs (id_usuario, nome_usuario, papel, acao, detalhe, data_hora, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [l.id_usuario, l.nome, l.papel, l.acao, l.detalhe, l.em, hashLog(ultimo && ultimo.h, l)]);
  });
  filaLog = tarefa.catch(() => {});
  return tarefa;
}

module.exports = { SISTEMA, dataHoraLocal, hashLog, filaLog, registrarLog };
