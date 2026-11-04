-- Atualização de 03/11/2026 (ficha de cadastro de escolas na página inicial)
-- Para quem JÁ TEM o banco "sive". NÃO apaga nem altera dados: só cria uma tabela nova. Rode uma vez e reinicie o servidor.
USE sive;

-- Escolas interessadas em contratar o S.I.V.E. (ficha "Quero o S.I.V.E. na minha escola", na página inicial, sem login).
-- Não tem ligação com as outras tabelas: é o cadastro comercial da empresa S.I.V.E. A equipe consulta com: npm run escolas
--   esi_protocolo: número que a escola recebe na tela (SIVE-AAAA-NNNNN). esi_etapas: lista separada por vírgula.
--   esi_aceite_em: quando a pessoa concordou com o uso dos dados para contato (LGPD, art. 7º, I). esi_ip: contra envios automáticos.
CREATE TABLE IF NOT EXISTS escolas_interessadas (
  esi_id INT AUTO_INCREMENT PRIMARY KEY,
  esi_protocolo VARCHAR(20) NULL UNIQUE,
  esi_nome VARCHAR(150) NOT NULL,
  esi_cnpj CHAR(14) NOT NULL,
  esi_rede ENUM('municipal','estadual','federal','privada') NOT NULL,
  esi_etapas VARCHAR(120) NOT NULL,
  esi_alunos INT NOT NULL,
  esi_cep CHAR(8) NOT NULL,
  esi_logradouro VARCHAR(150) NOT NULL,
  esi_numero VARCHAR(10) NOT NULL,
  esi_complemento VARCHAR(60) NULL,
  esi_bairro VARCHAR(80) NOT NULL,
  esi_cidade VARCHAR(80) NOT NULL,
  esi_uf CHAR(2) NOT NULL,
  esi_contato_nome VARCHAR(100) NOT NULL,
  esi_contato_cargo VARCHAR(60) NOT NULL,
  esi_email VARCHAR(120) NOT NULL,
  esi_telefone VARCHAR(11) NOT NULL,
  esi_horario ENUM('manha','tarde','qualquer') NOT NULL DEFAULT 'qualquer',
  esi_mensagem VARCHAR(600) NULL,
  esi_status ENUM('novo','em_contato','contratou','desistiu') NOT NULL DEFAULT 'novo',
  esi_aceite_em DATETIME NOT NULL,
  esi_ip VARCHAR(45) NULL,
  esi_criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_esi_cnpj (esi_cnpj),
  INDEX idx_esi_status (esi_status, esi_criado_em)
);

