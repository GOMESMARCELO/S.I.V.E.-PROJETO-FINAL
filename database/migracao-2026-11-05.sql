-- Atualização de 05/11/2026 (recuperação de senha e ficha de orçamento simplificada)
-- Para quem JÁ TEM o banco "sive" atualizado até migracao-2026-11-04-acessibilidade.sql. NÃO apaga dados.
-- Rode uma vez ANTES de reiniciar o servidor: o código novo já usa estas colunas.
USE sive;

-- usu_senha_pedida_em: a pessoa usou "Esqueci minha senha" (vira um pedido para a gestão). Vazio: nenhum pedido em aberto.
ALTER TABLE usuarios ADD COLUMN usu_senha_pedida_em DATETIME NULL;

-- A ficha "Solicitar orçamento" pede só escola, cidade, UF, alunos e contato. Os pedidos antigos continuam com os dados que têm.
ALTER TABLE escolas_interessadas
  MODIFY esi_cnpj CHAR(14) NULL,
  MODIFY esi_rede ENUM('municipal','estadual','federal','privada') NULL,
  MODIFY esi_etapas VARCHAR(120) NULL,
  MODIFY esi_cep CHAR(8) NULL,
  MODIFY esi_logradouro VARCHAR(150) NULL,
  MODIFY esi_numero VARCHAR(10) NULL,
  MODIFY esi_bairro VARCHAR(80) NULL,
  MODIFY esi_contato_cargo VARCHAR(60) NULL;
