-- Atualização de 02/11/2026 (melhorias de experiência do usuário)
-- Para quem JÁ TEM o banco "sive" atualizado até 31/10/2026. NÃO apaga dados. Rode uma vez e reinicie o servidor.
-- Antes, faça backup: npm run backup  (ou: mysqldump -u sive -p sive > backup-sive.sql)
USE sive;

-- Último dia para assinar a autorização. Depois dele, ela aparece como "Vencida" e não pode mais ser assinada.
-- As autorizações que já existem ficam sem data (continuam podendo ser assinadas, como antes).
ALTER TABLE autorizacoes ADD COLUMN aut_valida_ate DATE NULL AFTER aut_validade;

-- Quando a pessoa abriu os avisos (sino no topo) pela última vez: o que aconteceu depois conta como "novo".
ALTER TABLE usuarios ADD COLUMN usu_avisos_vistos_em DATETIME NULL;
