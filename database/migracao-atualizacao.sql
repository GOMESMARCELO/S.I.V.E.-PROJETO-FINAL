-- Migração: leva um banco SIVE já existente para a versão atual do sive.sql
-- NÃO apaga dados. Rode uma vez, no banco "sive", e depois reinicie o servidor.
-- Antes de rodar, faça backup: mysqldump -u sive -p sive > backup-sive.sql

USE sive;

-- Fase 4: reativação de professores (colunas novas em usuarios)
ALTER TABLE usuarios
  ADD COLUMN usu_inativado_motivo ENUM('inatividade','manual') NULL,
  ADD COLUMN usu_inativado_em DATETIME NULL,
  ADD COLUMN usu_reativado_em DATETIME NULL,
  ADD COLUMN usu_reativacao_pedida_em DATETIME NULL,
  ADD COLUMN res_id INT NULL,
  ADD FOREIGN KEY (res_id) REFERENCES responsaveis(res_id);

-- Reconhecimento facial: câmeras
CREATE TABLE cameras (
  cam_id INT AUTO_INCREMENT PRIMARY KEY,
  cam_nome VARCHAR(60) NOT NULL,
  cam_local VARCHAR(60) NOT NULL,
  cam_tipo ENUM('Entrada','Saída','Área comum') NOT NULL,
  cam_reconhecimento BOOLEAN NOT NULL DEFAULT FALSE,
  cam_ativa BOOLEAN NOT NULL DEFAULT TRUE,
  cam_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cameras (cam_nome, cam_local, cam_tipo, cam_reconhecimento, cam_ativa) VALUES
('Portão principal','Entrada da escola','Entrada',TRUE,TRUE),
('Portão de saída','Saída pela rua lateral','Saída',TRUE,TRUE),
('Pátio','Pátio central','Área comum',FALSE,TRUE),
('Refeitório','Refeitório','Área comum',FALSE,FALSE);

-- Configurações gerais do sistema
CREATE TABLE configuracoes (
  cfg_chave VARCHAR(40) PRIMARY KEY,
  cfg_valor VARCHAR(100) NOT NULL,
  cfg_atualizado_por_nome VARCHAR(100) NULL,
  cfg_atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO configuracoes (cfg_chave, cfg_valor, cfg_atualizado_por_nome) VALUES ('reconhecimento_facial','ligado','Mariana Santos');

-- Reconhecimento facial: passagens registradas pelas câmeras
CREATE TABLE reconhecimentos (
  rec_id INT AUTO_INCREMENT PRIMARY KEY,
  cam_id INT NOT NULL,
  alu_id INT NULL,
  rec_sentido ENUM('Entrada','Saída') NOT NULL,
  rec_resultado ENUM('Reconhecido','Sem cadastro facial') NOT NULL,
  rec_motivo VARCHAR(60) NULL,
  rec_confianca DECIMAL(4,1) NULL,
  rec_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cam_id) REFERENCES cameras(cam_id),
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id)
);

-- Eventos e calendário escolar
CREATE TABLE eventos (
  eve_id INT AUTO_INCREMENT PRIMARY KEY,
  eve_titulo VARCHAR(100) NOT NULL,
  eve_descricao VARCHAR(500) NULL,
  eve_tipo ENUM('Evento','Reunião','Passeio','Feriado','Prazo') NOT NULL DEFAULT 'Evento',
  eve_data DATE NOT NULL,
  eve_data_fim DATE NULL,
  eve_hora VARCHAR(5) NULL,
  eve_local VARCHAR(100) NULL,
  eve_sala VARCHAR(20) NULL,
  eve_destaque BOOLEAN NOT NULL DEFAULT FALSE,
  eve_banner_arquivo VARCHAR(80) NULL,
  eve_banner_mime VARCHAR(30) NULL,
  usu_id INT NULL,
  eve_criado_por_nome VARCHAR(100) NOT NULL,
  eve_criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id)
);

-- Ocorrências do professor: registro do que aconteceu com o aluno, com assinatura digital do professor
CREATE TABLE ocorrencias_escolares (
  oce_id INT AUTO_INCREMENT PRIMARY KEY,
  alu_id INT NOT NULL,
  oce_turma VARCHAR(40) NOT NULL,
  oce_data DATE NOT NULL,
  oce_horario TIME NOT NULL,
  oce_notificado_em DATETIME NOT NULL,
  oce_descricao VARCHAR(1000) NOT NULL,
  oce_buscado_por VARCHAR(100) NOT NULL,
  usu_id INT NOT NULL,
  oce_professor_nome VARCHAR(100) NOT NULL,
  oce_codigo VARCHAR(16) NOT NULL,
  oce_assinada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alu_id) REFERENCES alunos(alu_id),
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id)
);

-- Documentos: quem enviou (usu_id) e qual pendência o envio atendeu (pen_id).
-- Usados na pasta "Documentos recebidos recentemente" da Central do Dia (últimas 24 horas).
ALTER TABLE documentos
  ADD COLUMN usu_id INT NULL,
  ADD COLUMN pen_id INT NULL,
  ADD FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id),
  ADD FOREIGN KEY (pen_id) REFERENCES pendencias(pen_id);

-- Ocorrências: assinatura de ciência do responsável (vazio = ainda não assinou)
ALTER TABLE ocorrencias_escolares
  ADD COLUMN oce_resp_usu_id INT NULL,
  ADD COLUMN oce_resp_nome VARCHAR(100) NULL,
  ADD COLUMN oce_resp_assinada_em DATETIME NULL,
  ADD COLUMN oce_resp_codigo VARCHAR(16) NULL,
  ADD FOREIGN KEY (oce_resp_usu_id) REFERENCES usuarios(usu_id);

-- Ocorrências: assinatura da gestão (vazio = aguardando a gestão; assinada = "Ocorrências registradas")
ALTER TABLE ocorrencias_escolares
  ADD COLUMN oce_ges_usu_id INT NULL,
  ADD COLUMN oce_ges_nome VARCHAR(100) NULL,
  ADD COLUMN oce_ges_assinada_em DATETIME NULL,
  ADD COLUMN oce_ges_codigo VARCHAR(16) NULL,
  ADD FOREIGN KEY (oce_ges_usu_id) REFERENCES usuarios(usu_id);

-- =====================================================================================================
-- Melhorias do banco (30/10/2026). Rode depois de um backup: npm run backup
-- =====================================================================================================

-- 1) Turmas em tabela própria. As colunas de turma passam a apontar para turmas.tur_nome:
--    não dá mais para gravar uma turma que não existe (erro de digitação), e renomear a turma atualiza tudo (ON UPDATE CASCADE).
--    oce_turma e ace_sala continuam como texto de propósito: guardam a turma do aluno NO DIA do registro (histórico).
CREATE TABLE turmas (
  tur_id INT AUTO_INCREMENT PRIMARY KEY,
  tur_nome VARCHAR(40) NOT NULL UNIQUE,
  tur_ano_letivo SMALLINT NOT NULL,
  tur_turno ENUM('Manhã','Tarde','Integral','Noite') NULL,
  tur_ativa BOOLEAN NOT NULL DEFAULT TRUE,
  tur_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO turmas (tur_nome, tur_ano_letivo)
  SELECT s, YEAR(CURDATE()) FROM (SELECT alu_sala AS s FROM alunos UNION SELECT usu_sala FROM usuarios UNION SELECT com_sala FROM comunicados UNION SELECT eve_sala FROM eventos) x
  WHERE s IS NOT NULL AND s <> '';
ALTER TABLE alunos MODIFY alu_sala VARCHAR(40) NOT NULL, ADD CONSTRAINT fk_alu_turma FOREIGN KEY (alu_sala) REFERENCES turmas(tur_nome) ON UPDATE CASCADE;
ALTER TABLE usuarios MODIFY usu_sala VARCHAR(40) NULL, ADD CONSTRAINT fk_usu_turma FOREIGN KEY (usu_sala) REFERENCES turmas(tur_nome) ON UPDATE CASCADE;
ALTER TABLE comunicados MODIFY com_sala VARCHAR(40) NULL, ADD CONSTRAINT fk_com_turma FOREIGN KEY (com_sala) REFERENCES turmas(tur_nome) ON UPDATE CASCADE;
ALTER TABLE eventos MODIFY eve_sala VARCHAR(40) NULL, ADD CONSTRAINT fk_eve_turma FOREIGN KEY (eve_sala) REFERENCES turmas(tur_nome) ON UPDATE CASCADE;

-- Professor com mais de uma turma. usuarios.usu_sala continua sendo a turma principal (a que abre primeiro).
CREATE TABLE professor_turma (
  usu_id INT NOT NULL,
  tur_id INT NOT NULL,
  PRIMARY KEY (usu_id, tur_id),
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id),
  FOREIGN KEY (tur_id) REFERENCES turmas(tur_id) ON DELETE CASCADE
);
INSERT IGNORE INTO professor_turma (usu_id, tur_id)
  SELECT u.usu_id, t.tur_id FROM usuarios u JOIN turmas t ON t.tur_nome = u.usu_sala WHERE u.usu_papel = 'professor';

-- 2) Situação do aluno: quem sai da escola não é apagado (o histórico continua), só deixa de aparecer nas listas do dia a dia.
ALTER TABLE alunos
  ADD COLUMN alu_situacao ENUM('Ativo','Transferido','Concluiu','Desistente') NOT NULL DEFAULT 'Ativo',
  ADD COLUMN alu_situacao_em DATE NULL,
  ADD COLUMN alu_situacao_motivo VARCHAR(200) NULL,
  ADD INDEX idx_alu_turma_situacao (alu_sala, alu_situacao),
  ADD INDEX idx_alu_nome (alu_nome);

-- 3) Índices para as buscas mais frequentes (a escola cresce e as tabelas de registros crescem todo dia)
ALTER TABLE presencas ADD INDEX idx_pre_data (pre_data, pre_status);
ALTER TABLE acessos ADD INDEX idx_ace_aluno_hora (alu_id, ace_data_hora), ADD INDEX idx_ace_hora (ace_data_hora);
ALTER TABLE saidas ADD INDEX idx_sai_aluno_hora (alu_id, sai_data_hora), ADD INDEX idx_sai_hora (sai_data_hora);
ALTER TABLE reconhecimentos ADD INDEX idx_rec_hora (rec_data_hora);
ALTER TABLE logs ADD INDEX idx_log_hora (log_data_hora), ADD INDEX idx_log_usuario_acao (usu_id, log_acao);
ALTER TABLE ocorrencias_escolares ADD INDEX idx_oce_gestao (oce_ges_assinada_em), ADD INDEX idx_oce_turma_data (oce_turma, oce_data);
ALTER TABLE documentos ADD INDEX idx_doc_enviado (doc_enviado_em);
ALTER TABLE autorizacoes ADD INDEX idx_aut_grupo (aut_grupo);
ALTER TABLE busca_ativa ADD INDEX idx_bua_status (bua_status);
ALTER TABLE pendencias ADD INDEX idx_pen_aluno_status (alu_id, pen_status);

-- 4) Integridade
ALTER TABLE autorizacoes ADD CONSTRAINT fk_aut_assinada_por FOREIGN KEY (aut_assinada_por) REFERENCES usuarios(usu_id);
ALTER TABLE busca_ativa_registros ADD CONSTRAINT fk_bar_usuario FOREIGN KEY (bar_usuario_id) REFERENCES usuarios(usu_id);
ALTER TABLE comunicado_leituras ADD CONSTRAINT fk_col_usuario FOREIGN KEY (col_usuario_id) REFERENCES usuarios(usu_id);
-- "Assinada" agora é calculada pelo próprio banco a partir da data da assinatura: as duas nunca ficam diferentes
ALTER TABLE autorizacoes MODIFY aut_assinada BOOLEAN AS (aut_assinada_em IS NOT NULL) STORED;
-- Horário do evento como hora de verdade, e evento não pode terminar antes de começar
UPDATE eventos SET eve_hora = NULL WHERE eve_hora = '';
ALTER TABLE eventos MODIFY eve_hora TIME NULL, ADD CONSTRAINT chk_eve_periodo CHECK (eve_data_fim IS NULL OR eve_data_fim >= eve_data);

-- 5) "ocorrencias" (advertências e ações da ficha) vira "advertencias", para não confundir com as ocorrências do professor
RENAME TABLE ocorrencias TO advertencias;
ALTER TABLE advertencias
  RENAME COLUMN oco_id TO adv_id, RENAME COLUMN oco_tipo TO adv_tipo, RENAME COLUMN oco_descricao TO adv_descricao,
  RENAME COLUMN oco_data_ocorrencia TO adv_data, RENAME COLUMN oco_registrada_por_nome TO adv_registrada_por_nome, RENAME COLUMN oco_criada_em TO adv_criada_em;

-- Assinatura digital própria do sistema (31/10/2026)
-- Assinaturas digitais (uma linha por assinatura, de qualquer documento). É a PROVA da assinatura:
--   ass_conteudo_hash: SHA-256 do texto exato que foi assinado (se o documento mudar depois, a verificação acusa).
--   ass_selo: assinatura Ed25519 do servidor sobre todos os campos da linha (se alguém alterar a linha no banco, a verificação acusa).
--   Quem assina confirma com a própria senha. ass_ip / ass_navegador: de onde assinou. ass_codigo: código público de verificação.
CREATE TABLE assinaturas (
  ass_id INT AUTO_INCREMENT PRIMARY KEY,
  ass_codigo CHAR(16) NOT NULL UNIQUE,
  ass_documento ENUM('ocorrencia','autorizacao','consentimento') NOT NULL,
  ass_documento_id INT NOT NULL,
  ass_papel ENUM('professor','responsavel','gestao') NOT NULL,
  usu_id INT NOT NULL,
  ass_nome VARCHAR(100) NOT NULL,
  ass_conteudo_hash CHAR(64) NOT NULL,
  ass_ip VARCHAR(45) NULL,
  ass_navegador VARCHAR(255) NULL,
  ass_assinada_em DATETIME NOT NULL,
  ass_selo VARCHAR(100) NOT NULL,
  INDEX idx_ass_documento (ass_documento, ass_documento_id),
  FOREIGN KEY (usu_id) REFERENCES usuarios(usu_id)
);

-- Segurança (31/10/2026)
-- usu_sessao_versao: sobe a cada "Sair", troca de senha, desativação ou reativação; logins antigos param de valer na hora.
-- usu_2fa_*: verificação em duas etapas (aplicativo autenticador). O segredo fica criptografado (AES-256-GCM).
ALTER TABLE usuarios
  ADD COLUMN usu_sessao_versao INT NOT NULL DEFAULT 0,
  ADD COLUMN usu_2fa_segredo VARCHAR(200) NULL,
  ADD COLUMN usu_2fa_ativo BOOLEAN NOT NULL DEFAULT FALSE;
-- log_hash: cada linha guarda o hash da linha anterior + os próprios dados. Apagar ou alterar um log quebra a corrente (Logs → Conferir integridade).
ALTER TABLE logs ADD COLUMN log_hash CHAR(64) NULL;

-- Melhorias de experiência do usuário (02/11/2026)
-- aut_valida_ate: último dia para assinar a autorização. Depois dele, ela aparece como "Vencida" e não pode mais ser assinada.
--   As autorizações antigas ficam sem data (continuam podendo ser assinadas, como antes).
ALTER TABLE autorizacoes ADD COLUMN aut_valida_ate DATE NULL AFTER aut_validade;
-- usu_avisos_vistos_em: quando a pessoa abriu os avisos (sino no topo) pela última vez. O que aconteceu depois conta como "novo".
ALTER TABLE usuarios ADD COLUMN usu_avisos_vistos_em DATETIME NULL;

-- Ficha de cadastro de escolas na página inicial (03/11/2026)
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


-- Tutorial do primeiro acesso (04/11/2026)
-- usu_tutorial_visto_em: quando a pessoa concluiu ou pulou o tutorial. Vazio: ele aparece ao entrar.
ALTER TABLE usuarios ADD COLUMN usu_tutorial_visto_em DATETIME NULL;

-- Painel de Acessibilidade (04/11/2026)
-- usu_acessibilidade: ajustes da própria pessoa, em JSON (texto, contraste, daltonismo...). Vazio: nada escolhido.
ALTER TABLE usuarios ADD COLUMN usu_acessibilidade VARCHAR(200) NULL;

-- Recuperação de senha e ficha de orçamento simplificada (05/11/2026)
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

-- Recuperação de senha por e-mail (05/11/2026)
-- usu_email: e-mail da conta, para recuperar a senha. Em responsáveis sem este campo, vale o e-mail do cadastro (res_email).
-- usu_recuperacao_hash: hash do código do link enviado por e-mail (o código em si não é guardado).
-- usu_recuperacao_expira: até quando o link vale.
ALTER TABLE usuarios
  ADD COLUMN usu_email VARCHAR(120) NULL,
  ADD COLUMN usu_recuperacao_hash CHAR(64) NULL,
  ADD COLUMN usu_recuperacao_expira DATETIME NULL,
  ADD INDEX idx_usu_recuperacao (usu_recuperacao_hash);

-- Três opções na verificação em duas etapas (05/11/2026)
-- usu_2fa_metodo: como a pessoa recebe o código. usu_2fa_destino: e-mail ou celular (vazio no aplicativo).
-- usu_2fa_codigo_hash / usu_2fa_codigo_expira: código enviado por e-mail, SMS ou WhatsApp (o código em si não é guardado).
ALTER TABLE usuarios
  ADD COLUMN usu_2fa_metodo ENUM('app','email','sms','whatsapp') NOT NULL DEFAULT 'app',
  ADD COLUMN usu_2fa_destino VARCHAR(120) NULL,
  ADD COLUMN usu_2fa_codigo_hash CHAR(64) NULL,
  ADD COLUMN usu_2fa_codigo_expira DATETIME NULL;
