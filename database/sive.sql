-- Banco de dados do S.I.V.E. (MySQL)
-- 
-- ARQUITETURA REFATORADA E OTIMIZADA PARA O TCC
-- Padrões aplicados:
-- - Chaves Primárias e Estrangeiras: id_<entidade> (ligações por IDs numéricos).
-- - Atributos limpos: sem prefixos redundantes de tabela.
-- - Tipos de dados e tamanhos validados contra estouros (User-Agent, telefones, JSON).
--

SET NAMES utf8mb4;
DROP DATABASE IF EXISTS db_sive;
CREATE DATABASE db_sive CHARACTER SET utf8mb4;
USE db_sive;

-- 1. TURMAS
CREATE TABLE tb_turmas (
  id_turma INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(40) NOT NULL UNIQUE,
  ano_letivo SMALLINT NOT NULL,
  turno ENUM('Manhã','Tarde','Integral','Noite') NULL,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. ALUNOS (Ligado a tb_turmas via id_turma)
CREATE TABLE tb_alunos (
  id_aluno INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  id_turma INT NOT NULL,
  matricula VARCHAR(20) UNIQUE,
  situacao ENUM('Ativo','Transferido','Concluiu','Desistente') NOT NULL DEFAULT 'Ativo',
  situacao_em DATE NULL,
  situacao_motivo VARCHAR(200) NULL,
  INDEX idx_aluno_turma_situacao (id_turma, situacao),
  INDEX idx_aluno_nome (nome),
  CONSTRAINT fk_aluno_turma FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma) ON UPDATE CASCADE
);

-- 3. RESPONSÁVEIS
CREATE TABLE tb_resp (
  id_responsavel INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  telefone VARCHAR(20),
  foto VARCHAR(200),
  telefone2 VARCHAR(20) NULL,
  email VARCHAR(120) NULL,
  contato_preferido ENUM('WhatsApp','Ligação','E-mail') NOT NULL DEFAULT 'WhatsApp',
  atualizado_em DATETIME NULL
);

-- 4. ALUNO x RESPONSÁVEL (N:N)
CREATE TABLE tb_aluno_resp (
  id_aluno INT, 
  id_responsavel INT, 
  parentesco VARCHAR(20),
  PRIMARY KEY (id_aluno, id_responsavel),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_responsavel) REFERENCES tb_resp(id_responsavel)
);

-- 5. CÂMERAS
CREATE TABLE tb_cameras (
  id_camera INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(60) NOT NULL,
  local VARCHAR(60) NOT NULL,
  tipo ENUM('Entrada','Saída','Área comum') NOT NULL,
  reconhecimento BOOLEAN NOT NULL DEFAULT FALSE,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. ACESSOS
CREATE TABLE tb_acessos (
  id_acesso INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT, 
  id_turma INT NOT NULL, 
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_camera INT NULL,
  metodo ENUM('Facial','Manual') NOT NULL DEFAULT 'Manual',
  INDEX idx_acesso_aluno_hora (id_aluno, data_hora),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma),
  FOREIGN KEY (id_camera) REFERENCES tb_cameras(id_camera)
);

-- 7. SAÍDAS
CREATE TABLE tb_saidas (
  id_saida INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT, 
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_camera INT NULL,
  metodo ENUM('Liberação','Facial','Manual') NOT NULL DEFAULT 'Liberação',
  liberado_por_nome VARCHAR(100) NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_camera) REFERENCES tb_cameras(id_camera)
);

-- 8. AUTORIZAÇÕES
CREATE TABLE tb_autorizacoes (
  id_autorizacao INT AUTO_INCREMENT PRIMARY KEY,
  grupo VARCHAR(20) NOT NULL,
  id_aluno INT NOT NULL,
  titulo VARCHAR(100) NOT NULL,
  validade VARCHAR(100),
  valida_ate DATE NULL,
  detalhe VARCHAR(250),
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  criada_por_nome VARCHAR(100),
  id_usuario_assinatura INT NULL,
  assinada_nome VARCHAR(100) NULL,
  assinada_em DATETIME NULL,
  codigo CHAR(16) NULL,
  assinada BOOLEAN AS (assinada_em IS NOT NULL) STORED,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- 9. PRESENÇAS
CREATE TABLE tb_presencas (
  id_presenca INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL, 
  data DATE NOT NULL, 
  status ENUM('Presente','Ausente') NOT NULL, 
  observacao VARCHAR(100),
  UNIQUE KEY uq_presenca_aluno_dia (id_aluno, data),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- 10. BUSCA ATIVA
CREATE TABLE tb_busca_ativa (
  id_busca_ativa INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  faltas_ao_abrir INT NOT NULL,
  status ENUM('Em acompanhamento','Resolvido') NOT NULL DEFAULT 'Em acompanhamento',
  aberta_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  encerrada_em DATETIME NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- 11. REGISTROS DE BUSCA ATIVA
CREATE TABLE tb_busca_ativa_registros (
  id_busca_ativa_registro INT AUTO_INCREMENT PRIMARY KEY,
  id_busca_ativa INT NOT NULL,
  id_usuario INT NULL,
  nome_usuario VARCHAR(100) NOT NULL,
  texto VARCHAR(500) NOT NULL,
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_busca_ativa) REFERENCES tb_busca_ativa(id_busca_ativa)
);

-- 12. USUÁRIOS (Ligado a tb_turmas via id_turma)
CREATE TABLE tb_usuarios (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(50) UNIQUE NOT NULL,
  senha VARCHAR(255) NOT NULL,
  papel ENUM('admin','pai','professor') NOT NULL,
  nome VARCHAR(100) NOT NULL,
  id_aluno INT NULL,
  id_turma INT NULL,
  senha_temporaria BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_acesso DATETIME NULL,
  aceite_em DATETIME NULL,
  aceite_versao VARCHAR(10) NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  inativado_motivo ENUM('inatividade','manual') NULL,
  inativado_em DATETIME NULL,
  reativado_em DATETIME NULL,
  reativacao_pedida_em DATETIME NULL,
  senha_pedida_em DATETIME NULL,
  email VARCHAR(120) NULL,
  recuperacao_hash CHAR(64) NULL,
  recuperacao_expira DATETIME NULL,
  id_responsavel INT NULL,
  sessao_versao INT NOT NULL DEFAULT 0,
  segredo_2fa VARCHAR(200) NULL,
  ativo_2fa BOOLEAN NOT NULL DEFAULT FALSE,
  metodo_2fa ENUM('app','email','sms','whatsapp') NOT NULL DEFAULT 'app',
  destino_2fa VARCHAR(120) NULL,
  codigo_hash_2fa CHAR(64) NULL,
  codigo_expira_2fa DATETIME NULL,
  avisos_vistos_em DATETIME NULL,
  tutorial_visto_em DATETIME NULL,
  acessibilidade VARCHAR(500) NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_responsavel) REFERENCES tb_resp(id_responsavel),
  CONSTRAINT fk_usuario_turma FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma) ON UPDATE CASCADE
);

-- 13. PROFESSOR x TURMA (N:N)
CREATE TABLE tb_professor_turma (
  id_usuario INT NOT NULL,
  id_turma INT NOT NULL,
  PRIMARY KEY (id_usuario, id_turma),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma) ON DELETE CASCADE
);

-- 14. LOGS
CREATE TABLE tb_logs (
  id_log INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NULL,
  nome_usuario VARCHAR(100) NOT NULL,
  papel VARCHAR(20) NOT NULL,
  acao VARCHAR(60) NOT NULL,
  detalhe VARCHAR(255),
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  hash CHAR(64) NULL,
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- 15. COMUNICADOS
CREATE TABLE tb_comunicados (
  id_comunicado INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(120) NOT NULL,
  texto VARCHAR(1500) NOT NULL,
  id_turma INT NULL,
  criado_por_nome VARCHAR(100) NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comunicado_turma FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma) ON UPDATE CASCADE
);

-- 16. COMUNICADO LEITURAS
CREATE TABLE tb_comunicado_leituras (
  id_comunicado INT NOT NULL,
  id_aluno INT NOT NULL,
  id_usuario INT NULL,
  lido_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_comunicado, id_aluno),
  FOREIGN KEY (id_comunicado) REFERENCES tb_comunicados(id_comunicado),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- 17. PENDÊNCIAS
CREATE TABLE tb_pendencias (
  id_pendencia INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  tipo ENUM('Documento','Cadastro','Outro') NOT NULL,
  descricao VARCHAR(200) NOT NULL,
  status ENUM('Aberta','Resolvida') NOT NULL DEFAULT 'Aberta',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  criada_por_nome VARCHAR(100) NOT NULL,
  resolvida_em DATETIME NULL,
  resolvida_por_nome VARCHAR(100) NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- 18. DOCUMENTOS
CREATE TABLE tb_documentos (
  id_documento INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  categoria VARCHAR(30) NOT NULL,
  titulo VARCHAR(120) NOT NULL,
  nome_original VARCHAR(200) NOT NULL,
  arquivo VARCHAR(80) NOT NULL,
  tipo_mime VARCHAR(100) NOT NULL,
  tamanho INT NOT NULL,
  enviado_por_nome VARCHAR(100) NOT NULL,
  enviado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_usuario INT NULL,
  id_pendencia INT NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_pendencia) REFERENCES tb_pendencias(id_pendencia)
);

-- 19. ADVERTÊNCIAS
CREATE TABLE tb_advertencias (
  id_advertencia INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  tipo ENUM('Advertencia','Acao') NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  data DATE NOT NULL,
  registrada_por_nome VARCHAR(100) NOT NULL,
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- 20. OCORRÊNCIAS ESCOLARES (Corrigido com FK para id_turma)
CREATE TABLE tb_ocorrencias_escolares (
  id_ocorrencia INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  id_turma INT NOT NULL,
  data DATE NOT NULL,
  horario TIME NOT NULL,
  notificado_em DATETIME NOT NULL,
  descricao VARCHAR(1000) NOT NULL,
  buscado_por VARCHAR(100) NOT NULL,
  id_usuario INT NOT NULL,
  professor_nome VARCHAR(100) NOT NULL,
  codigo CHAR(16) NOT NULL,
  assinada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_usuario_resp INT NULL,
  resp_nome VARCHAR(100) NULL,
  resp_assinada_em DATETIME NULL,
  resp_codigo CHAR(16) NULL,
  id_usuario_gestao INT NULL,
  ges_nome VARCHAR(100) NULL,
  ges_assinada_em DATETIME NULL,
  ges_codigo CHAR(16) NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_usuario_resp) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_usuario_gestao) REFERENCES tb_usuarios(id_usuario)
);

-- 21. CONSENTIMENTOS LGPD
CREATE TABLE tb_consentimentos (
  id_consentimento INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  id_usuario INT NOT NULL,
  versao VARCHAR(10) NOT NULL,
  informacoes BOOLEAN NOT NULL,
  imagem BOOLEAN NOT NULL,
  monitoramento BOOLEAN NOT NULL,
  assinado_nome VARCHAR(100) NOT NULL,
  codigo CHAR(16) NOT NULL,
  assinado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- 22. COMUNICAÇÕES CONSELHO TUTELAR
CREATE TABLE tb_comunicacoes_conselho (
  id_comunicacao_conselho INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  id_usuario INT NOT NULL,
  id_busca_ativa INT NULL,
  motivo ENUM('Maus-tratos','Faltas','Outro') NOT NULL,
  descricao VARCHAR(1500) NOT NULL,
  medidas VARCHAR(1500) NULL,
  registrada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  registrada_por_nome VARCHAR(100) NOT NULL,
  comunicado_em DATE NULL,
  comunicado_por_nome VARCHAR(100) NULL,
  protocolo VARCHAR(60) NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_busca_ativa) REFERENCES tb_busca_ativa(id_busca_ativa)
);

-- 23. EVENTOS (Ligado a tb_turmas via id_turma)
CREATE TABLE tb_eventos (
  id_evento INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(100) NOT NULL,
  descricao VARCHAR(500) NULL,
  tipo ENUM('Evento','Reunião','Passeio','Feriado','Prazo') NOT NULL DEFAULT 'Evento',
  data DATE NOT NULL,
  data_fim DATE NULL,
  hora TIME NULL,
  local VARCHAR(100) NULL,
  id_turma INT NULL,
  destaque BOOLEAN NOT NULL DEFAULT FALSE,
  banner_arquivo VARCHAR(80) NULL,
  banner_mime VARCHAR(30) NULL,
  id_usuario INT NULL,
  criado_por_nome VARCHAR(100) NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  CONSTRAINT fk_evento_turma FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma) ON UPDATE CASCADE,
  CONSTRAINT chk_evento_periodo CHECK (data_fim IS NULL OR data_fim >= data)
);

-- 24. RECONHECIMENTOS
CREATE TABLE tb_reconhecimentos (
  id_reconhecimento INT AUTO_INCREMENT PRIMARY KEY,
  id_camera INT NOT NULL,
  id_aluno INT NULL,
  sentido ENUM('Entrada','Saída') NOT NULL,
  resultado ENUM('Reconhecido','Sem cadastro facial') NOT NULL,
  motivo VARCHAR(60) NULL,
  confianca DECIMAL(4,1) NULL,
  data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_camera) REFERENCES tb_cameras(id_camera),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- 25. CONFIGURAÇÕES
CREATE TABLE tb_configuracoes (
  chave VARCHAR(40) PRIMARY KEY,
  valor VARCHAR(100) NOT NULL,
  atualizado_por_nome VARCHAR(100) NULL,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 26. ASSINATURAS DIGITAIS (Ampliado navegador para 500)
CREATE TABLE tb_assinaturas (
  id_assinatura INT AUTO_INCREMENT PRIMARY KEY,
  codigo CHAR(16) NOT NULL UNIQUE,
  documento ENUM('ocorrencia','autorizacao','consentimento') NOT NULL,
  documento_id INT NOT NULL,
  papel ENUM('professor','resp','gestao') NOT NULL,
  id_usuario INT NOT NULL,
  nome VARCHAR(100) NOT NULL,
  conteudo_hash CHAR(64) NOT NULL,
  ip VARCHAR(45) NULL,
  navegador VARCHAR(500) NULL,
  assinada_em DATETIME NOT NULL,
  selo VARCHAR(100) NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- 27. ESCOLAS INTERESSADAS (Ajustado telefone para 20 e adicionado protocolo)
CREATE TABLE tb_escolas_interessadas (
  id_escola_interessada INT AUTO_INCREMENT PRIMARY KEY,
  protocolo VARCHAR(20) NULL UNIQUE,
  nome VARCHAR(150) NOT NULL,
  cnpj CHAR(14) NULL,
  rede ENUM('municipal','estadual','federal','privada') NULL,
  etapas VARCHAR(120) NULL,
  alunos INT NOT NULL,
  cep CHAR(8) NULL,
  logradouro VARCHAR(150) NULL,
  numero VARCHAR(10) NULL,
  complemento VARCHAR(60) NULL,
  bairro VARCHAR(80) NULL,
  cidade VARCHAR(80) NOT NULL,
  uf CHAR(2) NOT NULL,
  contato_nome VARCHAR(100) NOT NULL,
  contato_cargo VARCHAR(60) NULL,
  email VARCHAR(120) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  horario ENUM('manha','tarde','qualquer') NOT NULL DEFAULT 'qualquer',
  mensagem VARCHAR(600) NULL,
  status ENUM('novo','em_contato','contratou','desistiu') NOT NULL DEFAULT 'novo',
  aceite_em DATETIME NOT NULL,
  ip VARCHAR(45) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_escola_cnpj (cnpj),
  INDEX idx_escola_status (status, criado_em)
);

-- 28. ALTER TABLES PARA CHAVES ESTRANGEIRAS DE USUÁRIOS RETARDATÁRIAS
ALTER TABLE tb_autorizacoes ADD CONSTRAINT fk_autorizacao_assinada_por FOREIGN KEY (id_usuario_assinatura) REFERENCES tb_usuarios(id_usuario);
ALTER TABLE tb_busca_ativa_registros ADD CONSTRAINT fk_busca_ativa_reg_usuario FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario);

-- =========================================================================
-- INSERTS DE EXEMPLO (Atualizados com IDs numéricos de turmas)
-- =========================================================================

INSERT INTO tb_turmas (nome, ano_letivo, turno) VALUES
('Maternal II', YEAR(CURDATE()), 'Integral'), ('1º Ano C', YEAR(CURDATE()), 'Manhã'), ('2º Ano B', YEAR(CURDATE()), 'Manhã'),
('3º Ano A', YEAR(CURDATE()), 'Manhã'), ('4º Ano A', YEAR(CURDATE()), 'Tarde'), ('5º Ano B', YEAR(CURDATE()), 'Tarde');

INSERT INTO tb_alunos (nome, id_turma, matricula) VALUES
('Ana Clara Souza', 4, '2026-0101'), -- 3º Ano A (id_turma = 4)
('João Pedro Silva', 3, '2026-0184'), -- 2º Ano B (id_turma = 3)
('Marina Costa', 5, '2026-0233'),    -- 4º Ano A (id_turma = 5)
('Lucas Almeida', 2, '2026-0310'),     -- 1º Ano C (id_turma = 2)
('Beatriz Lima', 6, '2026-0355'),     -- 5º Ano B (id_turma = 6)
('Theo Martins', 1, '2026-0402');     -- Maternal II (id_turma = 1)

INSERT INTO tb_resp (nome, telefone, foto, email) VALUES
('Ana Paula Silva','(11) 98765-4321','assets/responsavel-ana.jpg','anapaula.silva@email.com'),
('Carlos Henrique Silva','(11) 97654-1234','assets/responsavel-carlos.jpg',NULL),
('Cláudia Souza','(11) 95555-7788',NULL,NULL),
('Marcos Lima','(11) 94444-2211',NULL,'marcos.lima@email.com'),
('Rosana Almeida','(11) 93333-5566',NULL,NULL),
('Paulo Costa','(11) 92222-8899',NULL,'paulo.costa@email.com');

INSERT INTO tb_aluno_resp VALUES (2,1,'Mãe'),(2,2,'Pai'),(1,3,'Mãe'),(5,4,'Pai'),(4,5,'Mãe'),(3,6,'Pai');

INSERT INTO tb_cameras (nome, local, tipo, reconhecimento, ativa) VALUES
('Portão principal','Entrada da escola','Entrada',TRUE,TRUE),
('Portão de saída','Saída pela rua lateral','Saída',TRUE,TRUE),
('Pátio','Pátio central','Área comum',FALSE,TRUE),
('Refeitório','Refeitório','Área comum',FALSE,FALSE);

INSERT INTO tb_configuracoes (chave, valor, atualizado_por_nome) VALUES ('reconhecimento_facial','ligado','Mariana Santos');

INSERT INTO tb_acessos (id_aluno, id_turma, data_hora, id_camera, metodo) VALUES
(4, 2, TIMESTAMP(CURDATE(),'07:22:51'), 1, 'Manual'),
(1, 4, TIMESTAMP(CURDATE(),'07:26:05'), 1, 'Facial'),
(2, 3, TIMESTAMP(CURDATE(),'07:31:42'), 1, 'Manual');

INSERT INTO tb_reconhecimentos (id_camera, id_aluno, sentido, resultado, motivo, confianca, data_hora) VALUES
(1,1,'Entrada','Reconhecido',NULL,97.8,TIMESTAMP(CURDATE(),'07:26:05')),
(1,NULL,'Entrada','Sem cadastro facial','Rosto sem cadastro: imagem descartada',NULL,TIMESTAMP(CURDATE(),'07:31:40'));

INSERT INTO tb_usuarios (login, senha, papel, nome, id_aluno, id_turma, senha_temporaria, id_responsavel, ultimo_acesso, criado_em) VALUES
('mariana', 'scrypt$06e82e26a74ff7b0fe6a8602ad9bf8a7$8364bdd2a45dfca289f6f63a292ed4d0e869831679b87fbf002009e7b0fccac3', 'admin', 'Mariana Santos', NULL, NULL, FALSE, NULL, NULL, NOW()),
('anapaula', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Ana Paula Silva', 2, NULL, FALSE, 1, NULL, NOW()),
('patricia', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Patrícia Gomes', NULL, 3, FALSE, NULL, NULL, NOW()), -- 2º Ano B (id_turma = 3)
('claudia', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Cláudia Souza', 1, NULL, FALSE, 3, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 90 DAY)),
('roberto', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Roberto Lima', NULL, 5, FALSE, NULL, DATE_SUB(NOW(), INTERVAL 75 DAY), DATE_SUB(NOW(), INTERVAL 200 DAY)), -- 4º Ano A (id_turma = 5)
('fernanda', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Fernanda Rocha', NULL, 2, FALSE, NULL, DATE_SUB(NOW(), INTERVAL 53 DAY), DATE_SUB(NOW(), INTERVAL 200 DAY)), -- 1º Ano C (id_turma = 2)
('marcos', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Marcos Lima', 5, NULL, FALSE, 4, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 90 DAY));

INSERT INTO tb_professor_turma (id_usuario, id_turma) 
SELECT u.id_usuario, u.id_turma FROM tb_usuarios u WHERE u.papel = 'professor' AND u.id_turma IS NOT NULL;

INSERT INTO tb_consentimentos (id_aluno, id_usuario, versao, informacoes, imagem, monitoramento, assinado_nome, codigo, assinado_em) VALUES
(1, 4, '1.0', TRUE, TRUE, TRUE, 'Cláudia Souza', '7F3A9C21B4E05D68', DATE_SUB(NOW(), INTERVAL 20 DAY)),
(5, 7, '1.0', TRUE, TRUE, TRUE, 'Marcos Lima', '2C8D1E5B9A07F643', DATE_SUB(NOW(), INTERVAL 15 DAY));

INSERT INTO tb_eventos (titulo, descricao, tipo, data, data_fim, hora, local, id_turma, destaque, id_usuario, criado_por_nome) VALUES
('Reunião de pais e mestres', 'Apresentação do desempenho do bimestre e conversa com os professores de cada turma.', 'Reunião', DATE_ADD(CURDATE(), INTERVAL 5 DAY), NULL, '09:00', 'Auditório', NULL, TRUE, 1, 'Mariana Santos'),
('Feira Cultural', 'Os alunos pesquisam sobre a cultura das famílias. Toda a comunidade está convidada.', 'Evento', DATE_ADD(CURDATE(), INTERVAL 12 DAY), DATE_ADD(CURDATE(), INTERVAL 13 DAY), '08:00', 'Pátio central', NULL, TRUE, 1, 'Mariana Santos'),
('Passeio ao Museu Catavento', 'Saída às 8h e retorno às 15h. Levar a autorização assinada.', 'Passeio', DATE_ADD(CURDATE(), INTERVAL 8 DAY), NULL, '08:00', 'Museu Catavento', 3, TRUE, 3, 'Patrícia Gomes'), -- 2º Ano B (id_turma = 3)
('Entrega do comprovante de residência', 'Último dia para atualizar o cadastro na secretaria.', 'Prazo', DATE_ADD(CURDATE(), INTERVAL 3 DAY), NULL, NULL, 'Secretaria', NULL, FALSE, 1, 'Mariana Santos'),
('Recesso escolar', 'Não haverá aula.', 'Feriado', DATE_ADD(CURDATE(), INTERVAL 18 DAY), DATE_ADD(CURDATE(), INTERVAL 19 DAY), NULL, NULL, NULL, FALSE, 1, 'Mariana Santos'),
('Semana da leitura', 'Cada turma visitou a biblioteca e escolheu um livro.', 'Evento', DATE_SUB(CURDATE(), INTERVAL 6 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), NULL, 'Biblioteca', NULL, FALSE, 1, 'Mariana Santos');

SET lc_time_names = 'pt_BR';

INSERT INTO tb_autorizacoes (grupo, id_aluno, titulo, validade, valida_ate, detalhe, criada_por_nome) VALUES
('seedpasseio', 2, 'Passeio ao Museu Catavento', CONCAT('Passeio em ', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 8 DAY), '%e de %M')), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Transporte e lanche inclusos', 'Mariana Santos'),
('seedpasseio', 1, 'Passeio ao Museu Catavento', CONCAT('Passeio em ', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 8 DAY), '%e de %M')), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Transporte e lanche inclusos', 'Mariana Santos'),
('seedzoo', 2, 'Visita ao zoológico', CONCAT('Visita em ', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '%e de %M')), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Saída às 8h, retorno às 15h', 'Mariana Santos');

INSERT INTO tb_autorizacoes (grupo, id_aluno, titulo, validade, detalhe, criada_por_nome, id_usuario_assinatura, assinada_nome, assinada_em, codigo) VALUES
('seedimagem', 2, 'Uso de imagem — Feira Cultural', 'Válida até dezembro', 'Fotos do evento no portal escolar', 'Mariana Santos', 2, 'Ana Paula Silva', DATE_SUB(NOW(), INTERVAL 3 DAY), 'A1B2C3D4E5F60718');

INSERT INTO tb_comunicados (titulo, texto, id_turma, criado_por_nome, criado_em) VALUES
('Reunião de pais e mestres', 'A reunião será no sábado, às 9h, no auditório da escola. A presença de todos é importante.', NULL, 'Mariana Santos', DATE_SUB(NOW(), INTERVAL 6 DAY)),
('Feira Cultural — o que levar', 'Os alunos do 2º Ano B devem levar uma pesquisa sobre a cultura da sua família.', 3, 'Patrícia Gomes', DATE_SUB(NOW(), INTERVAL 4 DAY)), -- 2º Ano B (id_turma = 3)
('Uniforme e material', 'Lembramos que o uniforme completo é obrigatório a partir da próxima semana.', NULL, 'Mariana Santos', DATE_SUB(NOW(), INTERVAL 1 DAY));

INSERT INTO tb_comunicado_leituras (id_comunicado, id_aluno, id_usuario) VALUES
(1, 1, NULL), (1, 2, 2), (1, 4, NULL), (3, 1, NULL);

INSERT INTO tb_pendencias (id_aluno, tipo, descricao, criada_por_nome) VALUES
(3, 'Documento', 'Entregar comprovante de residência atualizado', 'Mariana Santos');

INSERT INTO tb_advertencias (id_aluno, tipo, descricao, data, registrada_por_nome) VALUES
(3, 'Acao', 'Conversa com a família sobre as faltas seguidas', DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Mariana Santos'),
(4, 'Advertencia', 'Saiu da sala sem autorização durante a aula', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Mariana Santos');

INSERT INTO tb_presencas (id_aluno, data, status, observacao)
SELECT a.id_aluno, DATE_SUB(CURDATE(), INTERVAL d.n DAY),
  CASE
    WHEN a.id_aluno = 3 AND d.n BETWEEN 0 AND 12 THEN 'Ausente'
    WHEN a.id_aluno = 4 AND d.n % 3 = 1 THEN 'Ausente'
    WHEN a.id_aluno = 2 AND d.n = 8 THEN 'Ausente'
    WHEN a.id_aluno = 1 AND d.n IN (6, 20) THEN 'Ausente'
    ELSE 'Presente'
  END,
  CASE
    WHEN a.id_aluno = 2 AND d.n = 8 THEN 'Justificada pela família'
    WHEN (a.id_aluno = 3 AND d.n BETWEEN 0 AND 12) OR (a.id_aluno = 4 AND d.n % 3 = 1) OR (a.id_aluno = 1 AND d.n IN (6, 20)) THEN 'Falta sem justificativa'
    ELSE CONCAT('Entrada 07:', LPAD(10 + (a.id_aluno * 7 + d.n * 3) % 25, 2, '0'))
  END
FROM tb_alunos a
JOIN (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29 UNION ALL SELECT 30 UNION ALL SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34) d
WHERE DAYOFWEEK(DATE_SUB(CURDATE(), INTERVAL d.n DAY)) NOT IN (1, 7)
  AND NOT (d.n = 0 AND a.id_aluno IN (5, 6));