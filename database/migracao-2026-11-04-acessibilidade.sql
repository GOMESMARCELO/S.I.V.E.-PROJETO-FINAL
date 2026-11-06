-- Atualização de 04/11/2026 (Painel de Acessibilidade)
-- Para quem JÁ TEM o banco "sive" com a coluna do tutorial (migracao-2026-11-04.sql). NÃO apaga dados. Rode uma vez e reinicie o servidor.
USE sive;

-- Ajustes da própria pessoa, em JSON (texto, contraste, daltonismo...). Vazio: nada escolhido.
ALTER TABLE usuarios ADD COLUMN usu_acessibilidade VARCHAR(200) NULL;
