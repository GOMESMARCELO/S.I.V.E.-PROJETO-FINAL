-- Atualização de 04/11/2026 (tutorial do primeiro acesso)
-- Para quem JÁ TEM o banco "sive" atualizado até 03/11/2026. NÃO apaga dados. Rode uma vez e reinicie o servidor.
USE sive;

-- Quando a pessoa concluiu ou pulou o tutorial. Vazio: ele aparece ao entrar (por isso, quem já usa o sistema também o vê uma vez).
ALTER TABLE usuarios ADD COLUMN usu_tutorial_visto_em DATETIME NULL;
