-- Atualização de 05/11/2026 (recuperação de senha por e-mail)
-- Rode DEPOIS de migracao-2026-11-05.sql e ANTES de reiniciar o servidor. NÃO apaga dados.
USE sive;

-- usu_email: e-mail da conta, para recuperar a senha. Em responsáveis sem este campo, vale o e-mail do cadastro (res_email).
-- usu_recuperacao_hash: hash do código do link enviado por e-mail (o código em si não é guardado).
-- usu_recuperacao_expira: até quando o link vale.
ALTER TABLE usuarios
  ADD COLUMN usu_email VARCHAR(120) NULL,
  ADD COLUMN usu_recuperacao_hash CHAR(64) NULL,
  ADD COLUMN usu_recuperacao_expira DATETIME NULL,
  ADD INDEX idx_usu_recuperacao (usu_recuperacao_hash);
