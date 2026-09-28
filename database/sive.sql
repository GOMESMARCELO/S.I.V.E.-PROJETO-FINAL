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
CREATE TABLE presencas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT, data DATE, status ENUM('Presente','Ausente'), observacao VARCHAR(100),
  FOREIGN KEY (aluno_id) REFERENCES alunos(id)
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

INSERT INTO presencas (aluno_id, data, status, observacao) VALUES
(2,'2026-09-28','Presente','Entrada 07:15'),
(2,'2026-09-25','Presente','Entrada 07:19'),
(2,'2026-09-24','Presente','Entrada 07:08'),
(2,'2026-09-23','Ausente','Justificada pela família'),
(2,'2026-09-22','Presente','Entrada 07:22');
