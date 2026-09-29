-- Cria um usuário só para o projeto S.I.V.E., com senha fixa e conhecida.
-- Rode isto no MySQL Workbench (com o Workbench já conectado ao servidor local)
-- ANTES de rodar o sive.sql, ou depois — a ordem não importa.
CREATE USER IF NOT EXISTS 'sive'@'localhost' IDENTIFIED BY 'sive123';
GRANT ALL PRIVILEGES ON sive.* TO 'sive'@'localhost';
FLUSH PRIVILEGES;
