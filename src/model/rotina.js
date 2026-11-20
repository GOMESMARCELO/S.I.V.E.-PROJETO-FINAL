// Model: rotina de 1 em 1 hora (inatividade, limpeza de registros antigos e backup diário).
const backup = require("../../backup");
const path = require("path");
const { config } = require("../../config");
const db = require("./db");
const { SISTEMA, registrarLog } = require("./log");
const { PASTA_UPLOADS } = require("./arquivos");
const { verificarInatividade } = require("./usuarios");
const { CHAVE_ARQUIVOS } = require("./seguranca");

const RETENCAO_RECONHECIMENTOS_DIAS = 90;
// Logs de atividade guardam dados pessoais (quem fez o quê): apagados depois deste prazo (RETENCAO_LOGS_ANOS no .env). Backups: quantos manter (BACKUP_MANTER no .env).
const RETENCAO_LOGS_ANOS = Number((config.retencao || {}).logs_anos) || 2;
const BACKUPS_MANTER = Number((config.backup || {}).manter) || 14;
const PASTA_BACKUPS = backup.pastaDosBackups(config);

// Rotina de 1 em 1 hora (e ao ligar o servidor): inativa professores parados há 60 dias e apaga passagens antigas das câmeras
async function rotinaPeriodica() {
  await verificarInatividade();
  const [r] = await db.query("DELETE FROM tb_reconhecimentos WHERE data_hora < DATE_SUB(NOW(), INTERVAL ? DAY)", [RETENCAO_RECONHECIMENTOS_DIAS]);
  if (r.affectedRows) await registrarLog(SISTEMA, "reconhecimentos_apagados", `${r.affectedRows} registro(s) com mais de ${RETENCAO_RECONHECIMENTOS_DIAS} dias`);
  const [l] = await db.query("DELETE FROM tb_logs WHERE data_hora < DATE_SUB(NOW(), INTERVAL ? YEAR)", [RETENCAO_LOGS_ANOS]);
  if (l.affectedRows) await registrarLog(SISTEMA, "logs_apagados", `${l.affectedRows} registro(s) com mais de ${RETENCAO_LOGS_ANOS} ano(s)`);
  // Um backup por dia (banco + uploads/), na primeira volta da rotina do dia
  if (!backup.temBackupDeHoje(PASTA_BACKUPS)) {
    try {
      const pasta = await backup.gerarBackup(db, { pastaUploads: PASTA_UPLOADS, manter: BACKUPS_MANTER, chave: CHAVE_ARQUIVOS, pasta: PASTA_BACKUPS });
      await registrarLog(SISTEMA, "backup_feito", path.basename(pasta));
    } catch (erro) {
      console.error("Falha no backup automático:", erro.message);
      await registrarLog(SISTEMA, "backup_falhou", erro.message.slice(0, 200));
    }
  }
}

module.exports = { RETENCAO_RECONHECIMENTOS_DIAS, RETENCAO_LOGS_ANOS, BACKUPS_MANTER, PASTA_BACKUPS, rotinaPeriodica };
