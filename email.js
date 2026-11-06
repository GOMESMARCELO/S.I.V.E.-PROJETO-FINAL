// Envio de e-mail do S.I.V.E. Sem serviço configurado no config.json, o envio é SIMULADO: a mensagem aparece só no terminal do servidor.
// Para enviar de verdade, preencha "email" no config.json (modelo em config.example.json) e reinicie o servidor.
const config = require("./config.json");

const cfg = config.email || {};
const simulado = !(cfg.modo === "smtp" && cfg.smtp && cfg.smtp.host);
let transporte = null;
function conectar() {
  if (!transporte) {
    const { host, porta = 587, usuario, senha } = cfg.smtp;
    transporte = require("nodemailer").createTransport({ host, port: porta, secure: porta === 465, auth: usuario ? { user: usuario, pass: senha } : undefined });
  }
  return transporte;
}
async function enviarEmail({ para, assunto, texto }) {
  if (simulado) { console.log(`\n✉️  [E-MAIL SIMULADO] Para: ${para}\n   Assunto: ${assunto}\n${texto}\n`); return; }
  await conectar().sendMail({ from: cfg.remetente, to: para, subject: assunto, text: texto });
}
// SMS e WhatsApp dependem de um fornecedor pago, que ainda não foi escolhido: por enquanto o envio é sempre simulado.
// Ao contratar, a chamada ao fornecedor entra aqui e telefoneSimulado passa a ser false.
const telefoneSimulado = true;
async function enviarMensagemTelefone({ para, canal, texto }) {
  console.log(`\n📱 [${canal.toUpperCase()} SIMULADO] Para: ${para}\n${texto}\n`);
}
module.exports = { enviarEmail, simulado, enviarMensagemTelefone, telefoneSimulado };
