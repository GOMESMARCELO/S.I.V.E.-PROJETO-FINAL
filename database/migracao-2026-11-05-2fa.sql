-- Atualização de 05/11/2026 (três opções na verificação em duas etapas)
-- Rode DEPOIS de migracao-2026-11-05-email.sql e ANTES de reiniciar o servidor. NÃO apaga dados.
-- Quem já usa o aplicativo autenticador continua igual: o método padrão é 'app'.
USE sive;

-- usu_2fa_metodo: como a pessoa recebe o código. usu_2fa_destino: e-mail ou celular (vazio no aplicativo).
-- usu_2fa_codigo_hash / usu_2fa_codigo_expira: código enviado por e-mail, SMS ou WhatsApp (o código em si não é guardado).
ALTER TABLE usuarios
  ADD COLUMN usu_2fa_metodo ENUM('app','email','sms','whatsapp') NOT NULL DEFAULT 'app',
  ADD COLUMN usu_2fa_destino VARCHAR(120) NULL,
  ADD COLUMN usu_2fa_codigo_hash CHAR(64) NULL,
  ADD COLUMN usu_2fa_codigo_expira DATETIME NULL;
