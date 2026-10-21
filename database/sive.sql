-- Banco de dados do S.I.V.E. (MySQL)
--
-- PADRÃO DE NOMES (MNEMÔNICOS)
-- Cada tabela tem uma sigla de 3 letras, e toda coluna começa com a sigla da sua tabela: <sigla>_<campo>.
-- Chave estrangeira mantém o nome da chave primária da tabela de origem (ex.: alu_id em presencas aponta para alunos.alu_id).
--
--   alunos ALU            responsaveis RES          aluno_responsavel ALR     usuarios USU
--   logs LOG              presencas PRE             busca_ativa BUA           busca_ativa_registros BAR
--   acessos ACE           saidas SAI                autorizacoes AUT          comunicados COM
--   comunicado_leituras COL                         documentos DOC            pendencias PEN
--   ocorrencias OCO       consentimentos CON    comunicacoes_conselho CCT
--
SET NAMES utf8mb4;
DROP DATABASE IF EXISTS sive;
CREATE DATABASE sive CHARACTER SET utf8mb4;
USE sive;

CREATE TABLE alunos (
  alu_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_nome VARCHAR(100) NOT NULL,
  alu_sala VARCHAR(20) NOT NULL,
  alu_matricula VARCHAR(20) UNIQUE
);
CREATE TABLE responsaveis (
  res_id INT AUTO_INCREMENT PRIMARY KEY,
  res_nome VARCHAR(100) NOT NULL,
  res_telefone VARCHAR(20),
  res_foto VARCHAR(200)
);
CREATE TABLE aluno_responsavel (
  alu_id INT, res_id INT, alr_parentesco VARCHAR(20),
  PRIMARY KEY (alu_id, res_id),
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id),
  FOREIGN KEY (res_id) REFERENCES responsaveis(res_id)
);
CREATE TABLE acessos (
  ace_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT, ace_sala VARCHAR(20), ace_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
CREATE TABLE saidas (
  sai_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT, sai_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
-- Autorização digital: uma linha por aluno. "aut_grupo" liga as linhas criadas juntas (ex.: passeio da turma toda).
-- Ao assinar, o sistema grava quem assinou, o nome digitado, quando e um código de verificação.
CREATE TABLE autorizacoes (
  aut_id INT AUTO_INCREMENT PRIMARY KEY,
  aut_grupo VARCHAR(20) NOT NULL,
  alu_id INT NOT NULL,
  aut_titulo VARCHAR(100) NOT NULL,
  aut_validade VARCHAR(50),
  aut_detalhe VARCHAR(250),
  aut_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  aut_criada_por_nome VARCHAR(100),
  aut_assinada BOOLEAN NOT NULL DEFAULT FALSE,
  aut_assinada_por INT NULL,
  aut_assinada_nome VARCHAR(100) NULL,
  aut_assinada_em DATETIME NULL,
  aut_codigo VARCHAR(20) NULL,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
-- Uma linha por aluno por dia (a chamada do professor grava aqui)
CREATE TABLE presencas (
  pre_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL, pre_data DATE NOT NULL, pre_status ENUM('Presente','Ausente') NOT NULL, pre_observacao VARCHAR(100),
  UNIQUE KEY uq_presenca_aluno_dia (alu_id, pre_data),
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);

-- Busca Ativa: casos abertos automaticamente quando o aluno acumula muitas faltas
CREATE TABLE busca_ativa (
  bua_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  bua_faltas_ao_abrir INT NOT NULL,
  bua_status ENUM('Em acompanhamento','Resolvido') NOT NULL DEFAULT 'Em acompanhamento',
  bua_aberta_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  bua_encerrada_em DATETIME NULL,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
-- Anotações de acompanhamento de cada caso (quem anotou, quando e o quê)
CREATE TABLE busca_ativa_registros (
  bar_id INT AUTO_INCREMENT PRIMARY KEY,
  bua_id INT NOT NULL,
  bar_usuario_id INT NULL,
  bar_nome_usuario VARCHAR(100) NOT NULL,
  bar_texto VARCHAR(500) NOT NULL,
  bar_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bua_id) REFERENCES busca_ativa(bua_id)
);

-- usu_papel: 'admin' (gestão), 'pai' (responsável) ou 'professor'
-- usu_sala: só é usada por professores, indica a turma que ele leciona
-- usu_senha_temporaria: true quando a senha foi gerada pelo administrador e ainda não foi trocada
-- usu_ultimo_acesso: usado pelo sistema de reativação (60 dias sem acessar)
-- usu_senha: guarda o HASH da senha (scrypt), nunca a senha em texto. As senhas de demonstração abaixo são '123456'.
-- usu_aceite_em / usu_aceite_versao: quando a pessoa aceitou a política de privacidade (LGPD) e qual versão. Vazio = ainda não aceitou.
CREATE TABLE usuarios (
  usu_id INT AUTO_INCREMENT PRIMARY KEY,
  usu_usuario VARCHAR(50) UNIQUE NOT NULL,
  usu_senha VARCHAR(255) NOT NULL,
  usu_papel ENUM('admin','pai','professor') NOT NULL,
  usu_nome VARCHAR(100) NOT NULL,
  alu_id INT NULL,
  usu_sala VARCHAR(20) NULL,
  usu_senha_temporaria BOOLEAN NOT NULL DEFAULT FALSE,
  usu_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  usu_ultimo_acesso DATETIME NULL,
  usu_aceite_em DATETIME NULL,
  usu_aceite_versao VARCHAR(10) NULL,
  usu_criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);

-- Registro de quem fez o quê no sistema (logs de atividade)
CREATE TABLE logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  usu_id INT NULL,
  log_nome_usuario VARCHAR(100) NOT NULL,
  log_papel VARCHAR(20) NOT NULL,
  log_acao VARCHAR(60) NOT NULL,
  log_detalhe VARCHAR(255),
  log_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id)
);

-- Comunicados: com_sala vazia = vai para a escola toda
CREATE TABLE comunicados (
  com_id INT AUTO_INCREMENT PRIMARY KEY,
  com_titulo VARCHAR(120) NOT NULL,
  com_texto VARCHAR(1500) NOT NULL,
  com_sala VARCHAR(20) NULL,
  com_criado_por_nome VARCHAR(100) NOT NULL,
  com_criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Quem leu: um registro por comunicado e por aluno (o responsável marca como lido)
CREATE TABLE comunicado_leituras (
  com_id INT NOT NULL,
  alu_id INT NOT NULL,
  col_usuario_id INT NULL,
  col_lido_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (com_id, alu_id),
  FOREIGN KEY (com_id) REFERENCES comunicados(com_id),
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
-- Documentos anexados à ficha do aluno (o arquivo fica na pasta uploads/, com nome aleatório)
CREATE TABLE documentos (
  doc_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  doc_categoria VARCHAR(30) NOT NULL,
  doc_titulo VARCHAR(120) NOT NULL,
  doc_nome_original VARCHAR(200) NOT NULL,
  doc_arquivo VARCHAR(80) NOT NULL,
  doc_tipo_mime VARCHAR(100) NOT NULL,
  doc_tamanho INT NOT NULL,
  doc_enviado_por_nome VARCHAR(100) NOT NULL,
  doc_enviado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
-- Pendências abertas pela escola (ex.: entregar um documento)
CREATE TABLE pendencias (
  pen_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  pen_tipo ENUM('Documento','Cadastro','Outro') NOT NULL,
  pen_descricao VARCHAR(200) NOT NULL,
  pen_status ENUM('Aberta','Resolvida') NOT NULL DEFAULT 'Aberta',
  pen_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  pen_criada_por_nome VARCHAR(100) NOT NULL,
  pen_resolvida_em DATETIME NULL,
  pen_resolvida_por_nome VARCHAR(100) NULL,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);
-- Ações e advertências registradas sobre o aluno
CREATE TABLE ocorrencias (
  oco_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  oco_tipo ENUM('Advertencia','Acao') NOT NULL,
  oco_descricao VARCHAR(500) NOT NULL,
  oco_data_ocorrencia DATE NOT NULL,
  oco_registrada_por_nome VARCHAR(100) NOT NULL,
  oco_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);

-- Termo de consentimento dos responsáveis (LGPD, art. 14, §1º): uso de imagem e informações do aluno.
-- Cada assinatura, alteração ou revogação vira uma NOVA linha (o histórico nunca é apagado); vale a mais recente da versão atual do termo.
-- usu_id = quem assinou. con_codigo = código de verificação do comprovante.
-- Sem nenhuma linha para o aluno = consentimento pendente. Todas as opções falsas = não autorizado (ou revogado).
CREATE TABLE consentimentos (
  con_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  usu_id INT NOT NULL,
  con_versao VARCHAR(10) NOT NULL,
  con_informacoes BOOLEAN NOT NULL,
  con_imagem BOOLEAN NOT NULL,
  con_monitoramento BOOLEAN NOT NULL,
  con_assinado_nome VARCHAR(100) NOT NULL,
  con_codigo VARCHAR(20) NOT NULL,
  con_assinado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id),
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id)
);

-- Comunicações ao Conselho Tutelar (ECA, arts. 13 e 56; LDB, art. 12, VIII).
-- REGISTRO CONFIDENCIAL: não aparece para os responsáveis (a suspeita pode envolver a própria família) e nunca é apagado.
-- usu_id = quem registrou. bua_id = caso de Busca Ativa de origem (só quando o motivo é faltas).
-- cct_comunicado_em vazio = ainda PENDENTE de comunicação; preenchido = a escola já comunicou (cct_protocolo = ofício/protocolo).
CREATE TABLE comunicacoes_conselho (
  cct_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  usu_id INT NOT NULL,
  bua_id INT NULL,
  cct_motivo ENUM('Maus-tratos','Faltas','Outro') NOT NULL,
  cct_descricao VARCHAR(1500) NOT NULL,
  cct_medidas VARCHAR(1500) NULL,
  cct_registrada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  cct_registrada_por_nome VARCHAR(100) NOT NULL,
  cct_comunicado_em DATE NULL,
  cct_comunicado_por_nome VARCHAR(100) NULL,
  cct_protocolo VARCHAR(60) NULL,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id),
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id),
  FOREIGN KEY (bua_id) REFERENCES busca_ativa(bua_id)
);

INSERT INTO alunos (alu_nome, alu_sala, alu_matricula) VALUES
('Ana Clara Souza','3º Ano A','2026-0101'),
('João Pedro Silva','2º Ano B','2026-0184'),
('Marina Costa','4º Ano A','2026-0233'),
('Lucas Almeida','1º Ano C','2026-0310'),
('Beatriz Lima','5º Ano B','2026-0355');

INSERT INTO responsaveis (res_nome, res_telefone, res_foto) VALUES
('Ana Paula Silva','(11) 98765-4321','assets/responsavel-ana.jpg'),
('Carlos Henrique Silva','(11) 97654-1234','assets/responsavel-carlos.jpg');
INSERT INTO aluno_responsavel VALUES (2,1,'Mãe'),(2,2,'Pai');

INSERT INTO acessos (alu_id, ace_sala, ace_data_hora) VALUES
(4,'Sala 2',TIMESTAMP(CURDATE(),'07:22:51')),
(1,'Sala 5',TIMESTAMP(CURDATE(),'07:26:05')),
(3,'Sala 8',TIMESTAMP(CURDATE(),'07:29:18')),
(2,'Sala 3',TIMESTAMP(CURDATE(),'07:31:42'));


-- Login de teste: administradora vê tudo; a mãe do João só vê o filho dela;
-- a professora só vê a turma "2º Ano B", que é a turma do João Pedro
INSERT INTO usuarios (usu_usuario, usu_senha, usu_papel, usu_nome, alu_id, usu_sala, usu_senha_temporaria) VALUES
('mariana', 'scrypt$06e82e26a74ff7b0fe6a8602ad9bf8a7$8364bdd2a45dfca289f6f63a292ed4d0e869831679b87fbf002009e7b0fccac3', 'admin', 'Mariana Santos', NULL, NULL, FALSE),
('anapaula', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Ana Paula Silva', 2, NULL, FALSE),
('patricia', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Patrícia Gomes', NULL, '2º Ano B', FALSE);

-- Autorizações de exemplo: passeio (João e Ana Clara, pendente) e uso de imagem (João, já assinada pela mãe)
INSERT INTO autorizacoes (aut_grupo, alu_id, aut_titulo, aut_validade, aut_detalhe, aut_criada_por_nome) VALUES
('seedpasseio', 2, 'Passeio ao Museu Catavento', '12 de outubro', 'Transporte e lanche inclusos', 'Mariana Santos'),
('seedpasseio', 1, 'Passeio ao Museu Catavento', '12 de outubro', 'Transporte e lanche inclusos', 'Mariana Santos');
INSERT INTO autorizacoes (aut_grupo, alu_id, aut_titulo, aut_validade, aut_detalhe, aut_criada_por_nome, aut_assinada, aut_assinada_por, aut_assinada_nome, aut_assinada_em, aut_codigo) VALUES
('seedimagem', 2, 'Uso de imagem — Feira Cultural', 'Válida até dezembro', 'Fotos do evento no portal escolar', 'Mariana Santos', TRUE, 2, 'Ana Paula Silva', DATE_SUB(NOW(), INTERVAL 3 DAY), 'A1B2C3D4E5F60718');

-- Comunicados de exemplo
INSERT INTO comunicados (com_titulo, com_texto, com_sala, com_criado_por_nome, com_criado_em) VALUES
('Reunião de pais e mestres', 'A reunião será no sábado, às 9h, no auditório da escola. A presença de todos é importante.', NULL, 'Mariana Santos', DATE_SUB(NOW(), INTERVAL 6 DAY)),
('Feira Cultural — o que levar', 'Os alunos do 2º Ano B devem levar uma pesquisa sobre a cultura da sua família.', '2º Ano B', 'Patrícia Gomes', DATE_SUB(NOW(), INTERVAL 4 DAY)),
('Uniforme e material', 'Lembramos que o uniforme completo é obrigatório a partir da próxima semana.', NULL, 'Mariana Santos', DATE_SUB(NOW(), INTERVAL 1 DAY));
INSERT INTO comunicado_leituras (com_id, alu_id, col_usuario_id) VALUES
(1, 1, NULL), (1, 2, 2), (1, 4, NULL), (3, 1, NULL);

-- Pendência, ação e advertência de exemplo
INSERT INTO pendencias (alu_id, pen_tipo, pen_descricao, pen_criada_por_nome) VALUES
(3, 'Documento', 'Entregar comprovante de residência atualizado', 'Mariana Santos');
INSERT INTO ocorrencias (alu_id, oco_tipo, oco_descricao, oco_data_ocorrencia, oco_registrada_por_nome) VALUES
(3, 'Acao', 'Conversa com a família sobre as faltas seguidas', DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Mariana Santos'),
(4, 'Advertencia', 'Saiu da sala sem autorização durante a aula', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Mariana Santos');

-- Presença de exemplo dos últimos 35 dias (só dias úteis), sempre contando a partir de hoje.
-- Marina (id 3): faltas seguidas | Lucas (id 4): faltas intercaladas | os dois entram na Busca Ativa.
INSERT INTO presencas (alu_id, pre_data, pre_status, pre_observacao)
SELECT a.alu_id, DATE_SUB(CURDATE(), INTERVAL d.n DAY),
  CASE
    WHEN a.alu_id = 3 AND d.n BETWEEN 0 AND 12 THEN 'Ausente'
    WHEN a.alu_id = 4 AND d.n % 3 = 1 THEN 'Ausente'
    WHEN a.alu_id = 2 AND d.n = 8 THEN 'Ausente'
    WHEN a.alu_id = 1 AND d.n IN (6, 20) THEN 'Ausente'
    ELSE 'Presente'
  END,
  CASE
    WHEN a.alu_id = 2 AND d.n = 8 THEN 'Justificada pela família'
    WHEN (a.alu_id = 3 AND d.n BETWEEN 0 AND 12) OR (a.alu_id = 4 AND d.n % 3 = 1) OR (a.alu_id = 1 AND d.n IN (6, 20)) THEN 'Falta sem justificativa'
    ELSE CONCAT('Entrada 07:', LPAD(10 + (a.alu_id * 7 + d.n * 3) % 25, 2, '0'))
  END
FROM alunos a
JOIN (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29 UNION ALL SELECT 30 UNION ALL SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34) d
WHERE DAYOFWEEK(DATE_SUB(CURDATE(), INTERVAL d.n DAY)) NOT IN (1, 7);
