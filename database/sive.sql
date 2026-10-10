-- Banco de dados do S.I.V.E. (MySQL)
SET NAMES utf8mb4;
DROP DATABASE IF EXISTS sive;
CREATE DATABASE sive CHARACTER SET utf8mb4;
USE sive;

CREATE TABLE alunos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  sala VARCHAR(20) NOT NULL,
  matricula VARCHAR(20) UNIQUE,
  comunicados VARCHAR(30) DEFAULT 'Em dia',
  autorizacao VARCHAR(30) DEFAULT 'Em dia',
  pendencia VARCHAR(50) DEFAULT 'Nenhuma'
);
CREATE TABLE responsaveis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  telefone VARCHAR(20),
  foto VARCHAR(200)
);
CREATE TABLE aluno_responsavel (
  aluno_id INT, responsavel_id INT, parentesco VARCHAR(20),
  PRIMARY KEY (aluno_id, responsavel_id),
  FOREIGN KEY (aluno_id) REFERENCES alunos(id),
  FOREIGN KEY (responsavel_id) REFERENCES responsaveis(id)
);
CREATE TABLE acessos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT, sala VARCHAR(20), data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
);
CREATE TABLE saidas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT, data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
);
CREATE TABLE autorizacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT, titulo VARCHAR(100), validade VARCHAR(50), detalhe VARCHAR(150), aprovada BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
);
-- Uma linha por aluno por dia (a chamada do professor grava aqui)
CREATE TABLE presencas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT NOT NULL, data DATE NOT NULL, status ENUM('Presente','Ausente') NOT NULL, observacao VARCHAR(100),
  UNIQUE KEY uq_presenca_aluno_dia (aluno_id, data),
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
);

-- Busca Ativa: casos abertos automaticamente quando o aluno acumula muitas faltas
CREATE TABLE busca_ativa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT NOT NULL,
  faltas_ao_abrir INT NOT NULL,
  status ENUM('Em acompanhamento','Resolvido') NOT NULL DEFAULT 'Em acompanhamento',
  aberta_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  encerrada_em DATETIME NULL,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
);
-- Anotações de acompanhamento de cada caso (quem anotou, quando e o quê)
CREATE TABLE busca_ativa_registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  busca_id INT NOT NULL,
  usuario_id INT NULL,
  nome_usuario VARCHAR(100) NOT NULL,
  texto VARCHAR(500) NOT NULL,
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (busca_id) REFERENCES busca_ativa(id)
);

-- papel: 'admin' (gestão), 'pai' (responsável) ou 'professor'
-- sala: só é usada por professores, indica a turma que ele leciona
-- senha_temporaria: true quando a senha foi gerada pelo administrador e ainda não foi trocada
-- ultimo_acesso: usado pelo sistema de reativação (60 dias sem acessar)
CREATE TABLE usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(50) UNIQUE NOT NULL,
  senha VARCHAR(100) NOT NULL,
  papel ENUM('admin','pai','professor') NOT NULL,
  nome VARCHAR(100) NOT NULL,
  aluno_id INT NULL,
  sala VARCHAR(20) NULL,
  senha_temporaria BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_acesso DATETIME NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
);

-- Registro de quem fez o quê no sistema (logs de atividade)
CREATE TABLE logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  nome_usuario VARCHAR(100) NOT NULL,
  papel VARCHAR(20) NOT NULL,
  acao VARCHAR(60) NOT NULL,
  detalhe VARCHAR(255),
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

INSERT INTO alunos (nome, sala, matricula, comunicados, autorizacao, pendencia) VALUES
('Ana Clara Souza','3º Ano A','2026-0101','2 lidos','Em dia','Nenhuma'),
('João Pedro Silva','2º Ano B','2026-0184','1 novo','1 pendente','Autorização'),
('Marina Costa','4º Ano A','2026-0233','Em dia','Em dia','Documento'),
('Lucas Almeida','1º Ano C','2026-0310','3 lidos','Em dia','Nenhuma'),
('Beatriz Lima','5º Ano B','2026-0355','Em dia','Em dia','Nenhuma');

INSERT INTO responsaveis (nome, telefone, foto) VALUES
('Ana Paula Silva','(11) 98765-4321','assets/responsavel-ana.jpg'),
('Carlos Henrique Silva','(11) 97654-1234','assets/responsavel-carlos.jpg');
INSERT INTO aluno_responsavel VALUES (2,1,'Mãe'),(2,2,'Pai');

INSERT INTO acessos (aluno_id, sala, data_hora) VALUES
(4,'Sala 2',TIMESTAMP(CURDATE(),'07:22:51')),
(1,'Sala 5',TIMESTAMP(CURDATE(),'07:26:05')),
(3,'Sala 8',TIMESTAMP(CURDATE(),'07:29:18')),
(2,'Sala 3',TIMESTAMP(CURDATE(),'07:31:42'));

INSERT INTO autorizacoes (aluno_id, titulo, validade, detalhe, aprovada) VALUES
(2,'Passeio ao Museu Catavento','12 de outubro','Transporte e lanche inclusos',FALSE),
(2,'Uso de imagem — Feira Cultural','Válida até dezembro','Fotos do evento no portal escolar',TRUE);

-- Login de teste: administradora vê tudo; a mãe do João só vê o filho dela;
-- a professora só vê a turma "2º Ano B", que é a turma do João Pedro
INSERT INTO usuarios (usuario, senha, papel, nome, aluno_id, sala, senha_temporaria) VALUES
('mariana', '123456', 'admin', 'Mariana Santos', NULL, NULL, FALSE),
('anapaula', '123456', 'pai', 'Ana Paula Silva', 2, NULL, FALSE),
('patricia', '123456', 'professor', 'Patrícia Gomes', NULL, '2º Ano B', FALSE);

-- Presença de exemplo dos últimos 35 dias (só dias úteis), sempre contando a partir de hoje.
-- Marina (id 3): faltas seguidas | Lucas (id 4): faltas intercaladas | os dois entram na Busca Ativa.
INSERT INTO presencas (aluno_id, data, status, observacao)
SELECT a.id, DATE_SUB(CURDATE(), INTERVAL d.n DAY),
  CASE
    WHEN a.id = 3 AND d.n BETWEEN 0 AND 12 THEN 'Ausente'
    WHEN a.id = 4 AND d.n % 3 = 1 THEN 'Ausente'
    WHEN a.id = 2 AND d.n = 8 THEN 'Ausente'
    WHEN a.id = 1 AND d.n IN (6, 20) THEN 'Ausente'
    ELSE 'Presente'
  END,
  CASE
    WHEN a.id = 2 AND d.n = 8 THEN 'Justificada pela família'
    WHEN (a.id = 3 AND d.n BETWEEN 0 AND 12) OR (a.id = 4 AND d.n % 3 = 1) OR (a.id = 1 AND d.n IN (6, 20)) THEN 'Falta sem justificativa'
    ELSE CONCAT('Entrada 07:', LPAD(10 + (a.id * 7 + d.n * 3) % 25, 2, '0'))
  END
FROM alunos a
JOIN (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29 UNION ALL SELECT 30 UNION ALL SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34) d
WHERE DAYOFWEEK(DATE_SUB(CURDATE(), INTERVAL d.n DAY)) NOT IN (1, 7);
