-- Banco de dados do S.I.V.E. (MySQL)
--
-- PADRÃO DE NOMES (MNEMÔNICOS)
-- Cada tabela tem uma sigla de 3 letras, e toda coluna começa com a sigla da sua tabela: <sigla>_<campo>.
-- Chave estrangeira mantém o nome da chave primária da tabela de origem (ex.: id_aluno em tb_presencas aponta para tb_alunos.id_aluno).
--
--   tb_alunos ALU            tb_resp RES          aluno_resp ALR     tb_usuarios USU
--   tb_logs LOG              tb_presencas PRE             tb_busca_ativa BUA           tb_busca_ativa_registros BAR
--   tb_acessos ACE           tb_saidas SAI                tb_autorizacoes AUT          tb_comunicados COM
--   tb_comunicado_leituras COL                         tb_documentos DOC            tb_pendencias PEN
--   tb_advertencias ADV      tb_consentimentos CON        tb_comunicacoes_conselho CCT
--   tb_turmas TUR            tb_professor_turma (só chaves: id_usuario + id_turma)   tb_assinaturas ASS
--   tb_ocorrencias_escolares OCE
--   tb_eventos EVE           tb_cameras tb_cameras               tb_reconhecimentos REC       tb_configuracoes CFG
--   tb_escolas_interessadas ESI (escolas que pediram o S.I.V.E. pela página inicial)
--
SET NAMES utf8mb4;
DROP DATABASE IF EXISTS db_sive;
CREATE DATABASE db_sive CHARACTER SET utf8mb4;
USE db_sive;

-- tb_turmas: aluno, professor, comunicado e evento só usam tb_turmas desta tabela (chave estrangeira pelo nome).
-- Renomear a turma atualiza tudo (ON UPDATE CASCADE). tur_ativa = FALSE: turma encerrada (some das listas de escolha).
CREATE TABLE tb_turmas (
  id_turma INT AUTO_INCREMENT PRIMARY KEY,
  tur_nome VARCHAR(40) NOT NULL UNIQUE,
  tur_ano_letivo SMALLINT NOT NULL,
  tur_turno ENUM('Manhã','Tarde','Integral','Noite') NULL,
  tur_ativa BOOLEAN NOT NULL DEFAULT TRUE,
  tur_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- alu_situacao: quem sai da escola (transferido, concluiu, desistente) não é apagado: o histórico continua e ele só sai das listas do dia a dia
CREATE TABLE tb_alunos (
  id_aluno INT AUTO_INCREMENT PRIMARY KEY,
  alu_nome VARCHAR(100) NOT NULL,
  alu_sala VARCHAR(40) NOT NULL,
  alu_matricula VARCHAR(20) UNIQUE,
  alu_situacao ENUM('Ativo','Transferido','Concluiu','Desistente') NOT NULL DEFAULT 'Ativo',
  alu_situacao_em DATE NULL,
  alu_situacao_motivo VARCHAR(200) NULL,
  INDEX idx_alu_turma_situacao (alu_sala, alu_situacao),
  INDEX idx_alu_nome (alu_nome),
  CONSTRAINT fk_alu_turma FOREIGN KEY (alu_sala) REFERENCES tb_turmas(tur_nome) ON UPDATE CASCADE
);
CREATE TABLE tb_resp (
  id_responsavel INT AUTO_INCREMENT PRIMARY KEY,
  res_nome VARCHAR(100) NOT NULL,
  res_telefone VARCHAR(20),
  res_foto VARCHAR(200),
  -- Fase 4 (perfil do responsável): o próprio responsável atualiza estes contatos no menu "Meu perfil"
  res_telefone2 VARCHAR(20) NULL,
  res_email VARCHAR(120) NULL,
  res_contato_preferido ENUM('WhatsApp','Ligação','E-mail') NOT NULL DEFAULT 'WhatsApp',
  res_atualizado_em DATETIME NULL
);
CREATE TABLE tb_aluno_resp (
  id_aluno INT, id_responsavel INT, alr_parentesco VARCHAR(20),
  PRIMARY KEY (id_aluno, id_responsavel),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_responsavel) REFERENCES tb_resp(id_responsavel)
);
-- Fase 5: câmeras (SIMULADAS). Só em áreas comuns: o servidor recusa banheiro, vestiário e outros espaços de intimidade (ECA, art. 17).
-- cam_reconhecimento: a câmera faz reconhecimento facial (só portões de entrada e saída). Câmeras de área comum só "gravam".
CREATE TABLE tb_cameras (
  id_camera INT AUTO_INCREMENT PRIMARY KEY,
  cam_nome VARCHAR(60) NOT NULL,
  cam_local VARCHAR(60) NOT NULL,
  cam_tipo ENUM('Entrada','Saída','Área comum') NOT NULL,
  cam_reconhecimento BOOLEAN NOT NULL DEFAULT FALSE,
  cam_ativa BOOLEAN NOT NULL DEFAULT TRUE,
  cam_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Entradas na escola. ace_metodo: 'Facial' (câmera reconheceu) ou 'Manual' (portaria registrou). id_camera = câmera/portão.
CREATE TABLE tb_acessos (
  id_acesso INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT, ace_sala VARCHAR(60), ace_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_camera INT NULL,
  ace_metodo ENUM('Facial','Manual') NOT NULL DEFAULT 'Manual',
  INDEX idx_ace_alu_hora (id_aluno, ace_data_hora),
  INDEX idx_ace_hora (ace_data_hora),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_camera) REFERENCES tb_cameras(id_camera)
);
-- Saídas da escola. sai_metodo: 'Liberação' (secretaria conferiu o responsável), 'Facial' (portão de saída) ou 'Manual'.
CREATE TABLE tb_saidas (
  sai_id INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT, sai_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_camera INT NULL,
  sai_metodo ENUM('Liberação','Facial','Manual') NOT NULL DEFAULT 'Liberação',
  sai_liberado_por_nome VARCHAR(100) NULL,
  INDEX idx_sai_alu_hora (id_aluno, sai_data_hora),
  INDEX idx_sai_hora (sai_data_hora),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_camera) REFERENCES tb_cameras(id_camera)
);
-- Autorização digital: uma linha por alu. "aut_grupo" liga as linhas criadas juntas (ex.: passeio da turma toda).
-- Ao assinar, o sistema grava quem assinou, o nome digitado, quando e um código de verificação.
CREATE TABLE tb_autorizacoes (
  id_autorizacao INT AUTO_INCREMENT PRIMARY KEY,
  aut_grupo VARCHAR(20) NOT NULL,
  id_aluno INT NOT NULL,
  aut_titulo VARCHAR(100) NOT NULL,
  aut_validade VARCHAR(50),
  aut_valida_ate DATE NULL, -- último dia para assinar (UX 02/11/2026): depois dele a autorização aparece como "Vencida" e não pode mais ser assinada
  aut_detalhe VARCHAR(250),
  aut_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  aut_criada_por_nome VARCHAR(100),
  aut_assinada_por INT NULL,
  aut_assinada_nome VARCHAR(100) NULL,
  aut_assinada_em DATETIME NULL,
  aut_codigo VARCHAR(20) NULL,
  aut_assinada BOOLEAN AS (aut_assinada_em IS NOT NULL) STORED, -- calculada pelo banco: nunca fica diferente da data da assinatura
  INDEX idx_aut_grupo (aut_grupo),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);
-- Uma linha por alu por dia (a chamada do professor grava aqui)
CREATE TABLE tb_presencas (
  id_presenca INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL, pre_data DATE NOT NULL, pre_status ENUM('Presente','Ausente') NOT NULL, pre_observacao VARCHAR(100),
  UNIQUE KEY uq_presenca_alu_dia (id_aluno, pre_data),
  INDEX idx_pre_data (pre_data, pre_status),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- Busca Ativa: casos abertos automaticamente quando o aluno acumula muitas faltas
CREATE TABLE tb_busca_ativa (
  id_busca_ativa INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  bua_faltas_ao_abrir INT NOT NULL,
  bua_status ENUM('Em acompanhamento','Resolvido') NOT NULL DEFAULT 'Em acompanhamento',
  bua_aberta_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  bua_encerrada_em DATETIME NULL,
  INDEX idx_bua_status (bua_status),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);
-- Anotações de acompanhamento de cada caso (quem anotou, quando e o quê)
CREATE TABLE tb_busca_ativa_registros (
  id_busca_ativa_registro INT AUTO_INCREMENT PRIMARY KEY,
  id_busca_ativa INT NOT NULL,
  bar_usuario_id INT NULL,
  bar_nome_usuario VARCHAR(100) NOT NULL,
  bar_texto VARCHAR(500) NOT NULL,
  bar_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_busca_ativa) REFERENCES tb_busca_ativa(id_busca_ativa)
);

-- usu_papel: 'admin' (gestão), 'pai' (responsável) ou 'professor'
-- usu_sala: só é usada por professores, indica a turma que ele leciona
-- usu_senha_temporaria: true quando a senha foi gerada pelo administrador e ainda não foi trocada
-- usu_ultimo_acesso: usado pelo sistema de reativação (60 dias sem acessar)
-- usu_senha: guarda o HASH da senha (scrypt), nunca a senha em texto. As senhas de demonstração abaixo são '123456'.
-- usu_aceite_em / usu_aceite_versao: quando a pessoa aceitou a política de privacidade (LGPD) e qual versão. Vazio = ainda não aceitou.
-- Fase 4 — reativação de professores: depois de 60 dias sem acessar, o professor é inativado sozinho
--   usu_inativado_motivo: 'inatividade' (automático) ou 'manual' (a gestão desativou) | usu_inativado_em: quando
--   usu_reativado_em: quando a gestão reativou (o prazo de 60 dias volta a contar daqui)
--   usu_reativacao_pedida_em: o professor tentou entrar depois de inativado (vira um pedido para a gestão)
-- id_responsavel: o cadastro de responsável ligado a este login (perfil do responsável)
CREATE TABLE tb_usuarios (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  usu_usuario VARCHAR(50) UNIQUE NOT NULL,
  usu_senha VARCHAR(255) NOT NULL,
  usu_papel ENUM('admin','pai','professor') NOT NULL,
  usu_nome VARCHAR(100) NOT NULL,
  id_aluno INT NULL,
  usu_sala VARCHAR(40) NULL,
  usu_senha_temporaria BOOLEAN NOT NULL DEFAULT FALSE,
  usu_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  usu_ultimo_acesso DATETIME NULL,
  usu_aceite_em DATETIME NULL,
  usu_aceite_versao VARCHAR(10) NULL,
  usu_criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  usu_inativado_motivo ENUM('inatividade','manual') NULL,
  usu_inativado_em DATETIME NULL,
  usu_reativado_em DATETIME NULL,
  usu_reativacao_pedida_em DATETIME NULL,
  usu_senha_pedida_em DATETIME NULL,        -- "Esqueci minha senha" sem e-mail cadastrado: vira um pedido para a gestão
  usu_email VARCHAR(120) NULL,              -- e-mail da conta, para recuperar a senha (responsáveis: vale também res_email)
  usu_recuperacao_hash CHAR(64) NULL,       -- hash do código do link de recuperação (o código em si não é guardado)
  usu_recuperacao_expira DATETIME NULL,     -- até quando o link de recuperação vale
  id_responsavel INT NULL,
  usu_sessao_versao INT NOT NULL DEFAULT 0, -- sobe a cada Sair/troca de senha: logins antigos param de valer
  usu_2fa_segredo VARCHAR(200) NULL,        -- verificação em duas etapas (segredo criptografado)
  usu_2fa_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  usu_2fa_metodo ENUM('app','email','sms','whatsapp') NOT NULL DEFAULT 'app', -- como a pessoa recebe o código
  usu_2fa_destino VARCHAR(120) NULL,        -- e-mail ou celular (vazio no aplicativo)
  usu_2fa_codigo_hash CHAR(64) NULL,        -- código enviado por e-mail, SMS ou WhatsApp (o código em si não é guardado)
  usu_2fa_codigo_expira DATETIME NULL,
  usu_avisos_vistos_em DATETIME NULL,       -- quando a pessoa abriu os avisos (sino) pela última vez: o que veio depois conta como novo
  usu_tutorial_visto_em DATETIME NULL,      -- quando a pessoa concluiu ou pulou o tutorial do primeiro acesso (vazio: ele aparece ao entrar)
  usu_acessibilidade VARCHAR(200) NULL,     -- ajustes do Painel de Acessibilidade, em JSON (texto, contraste, daltonismo...). Vazio: nada escolhido
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  INDEX idx_usu_recuperacao (usu_recuperacao_hash),
  FOREIGN KEY (id_responsavel) REFERENCES tb_resp(id_responsavel),
  CONSTRAINT fk_usu_turma FOREIGN KEY (usu_sala) REFERENCES tb_turmas(tur_nome) ON UPDATE CASCADE
);
-- Professor com mais de uma turma. tb_usuarios.usu_sala é a turma principal (a que abre primeiro).
CREATE TABLE tb_professor_turma (
  id_usuario INT NOT NULL,
  id_turma INT NOT NULL,
  PRIMARY KEY (id_usuario, id_turma),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_turma) REFERENCES tb_turmas(id_turma) ON DELETE CASCADE
);

-- Registro de quem fez o quê no sistema (tb_logs de atividade)
CREATE TABLE tb_logs (
  id_log INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NULL,
  log_nome_usuario VARCHAR(100) NOT NULL,
  log_papel VARCHAR(20) NOT NULL,
  log_acao VARCHAR(60) NOT NULL,
  log_detalhe VARCHAR(255),
  log_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  log_hash CHAR(64) NULL, -- corrente de hashes: apagar ou alterar um log fica visível
  INDEX idx_log_hora (log_data_hora),
  INDEX idx_log_usuario_acao (id_usuario, log_acao),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- tb_comunicados: com_sala vazia = vai para a escola toda
CREATE TABLE tb_comunicados (
  id_comunicado INT AUTO_INCREMENT PRIMARY KEY,
  com_titulo VARCHAR(120) NOT NULL,
  com_texto VARCHAR(1500) NOT NULL,
  com_sala VARCHAR(40) NULL,
  com_criado_por_nome VARCHAR(100) NOT NULL,
  com_criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_com_turma FOREIGN KEY (com_sala) REFERENCES tb_turmas(tur_nome) ON UPDATE CASCADE
);
-- Quem leu: um registro por comunicado e por aluno (o responsável marca como lido)
CREATE TABLE tb_comunicado_leituras (
  id_comunicado INT NOT NULL,
  id_aluno INT NOT NULL,
  col_usuario_id INT NULL,
  col_lido_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_comunicado, id_aluno),
  FOREIGN KEY (id_comunicado) REFERENCES tb_comunicados(id_comunicado),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  CONSTRAINT fk_col_usuario FOREIGN KEY (col_usuario_id) REFERENCES tb_usuarios(id_usuario)
);
-- Pendências abertas pela escola (ex.: entregar um documento)
CREATE TABLE tb_pendencias (
  pen_id INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  pen_tipo ENUM('Documento','Cadastro','Outro') NOT NULL,
  pen_descricao VARCHAR(200) NOT NULL,
  pen_status ENUM('Aberta','Resolvida') NOT NULL DEFAULT 'Aberta',
  pen_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  pen_criada_por_nome VARCHAR(100) NOT NULL,
  pen_resolvida_em DATETIME NULL,
  pen_resolvida_por_nome VARCHAR(100) NULL,
  INDEX idx_pen_aluno_status (id_aluno, pen_status),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);
-- tb_documentos anexados à ficha do aluno (o arquivo fica na pasta uploads/, com nome aleatório)
-- id_usuario = quem enviou. pen_id = pendência de documento que este envio atendeu (vazio se foi um envio avulso).
-- A Central do Dia mostra na pasta "documentos recebidos recentemente" os que atenderam a uma pendência, enviados por responsáveis, nas últimas 24 horas.
CREATE TABLE tb_documentos (
  doc_id INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  doc_categoria VARCHAR(30) NOT NULL,
  doc_titulo VARCHAR(120) NOT NULL,
  doc_nome_original VARCHAR(200) NOT NULL,
  doc_arquivo VARCHAR(80) NOT NULL,
  doc_tipo_mime VARCHAR(100) NOT NULL,
  doc_tamanho INT NOT NULL,
  doc_enviado_por_nome VARCHAR(100) NOT NULL,
  doc_enviado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  id_usuario INT NULL,
  pen_id INT NULL,
  INDEX idx_doc_enviado (doc_enviado_em),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (pen_id) REFERENCES tb_pendencias(pen_id)
);
-- Ações e advertências registradas na ficha do aluno (não confundir com tb_ocorrencias_escolares, as ocorrências do professor com assinatura)
CREATE TABLE tb_advertencias (
  adv_id INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  adv_tipo ENUM('Advertencia','Acao') NOT NULL,
  adv_descricao VARCHAR(500) NOT NULL,
  adv_data DATE NOT NULL,
  adv_registrada_por_nome VARCHAR(100) NOT NULL,
  adv_criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- Ocorrências do professor: registro do que aconteceu com o aluno, com assinatura digital do professor.
-- Só o professor da turma registra. oce_turma = turma do aluno no dia do registro. oce_codigo = código de verificação da assinatura.
-- O responsável do aluno vê a ocorrência no Portal e assina que tomou ciência: oce_resp_* (vazio = ainda não assinou, conta como "nova").
-- A gestão recebe a ocorrência na pasta da Central do Dia e assina: oce_ges_* (vazio = ainda não assinou; depois de assinada vai para "Ocorrências registradas").
CREATE TABLE tb_ocorrencias_escolares (
  id_ocorrencia INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  oce_turma VARCHAR(40) NOT NULL,
  oce_data DATE NOT NULL,
  oce_horario TIME NOT NULL,
  oce_notificado_em DATETIME NOT NULL,
  oce_descricao VARCHAR(1000) NOT NULL,
  oce_buscado_por VARCHAR(100) NOT NULL,
  id_usuario INT NOT NULL,
  oce_professor_nome VARCHAR(100) NOT NULL,
  oce_codigo VARCHAR(16) NOT NULL,
  oce_assinada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  oce_resp_usu_id INT NULL,
  oce_resp_nome VARCHAR(100) NULL,
  oce_resp_assinada_em DATETIME NULL,
  oce_resp_codigo VARCHAR(16) NULL,
  oce_ges_usu_id INT NULL,
  oce_ges_nome VARCHAR(100) NULL,
  oce_ges_assinada_em DATETIME NULL,
  oce_ges_codigo VARCHAR(16) NULL,
  INDEX idx_oce_gestao (oce_ges_assinada_em),
  INDEX idx_oce_turma_data (oce_turma, oce_data),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (oce_resp_usu_id) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (oce_ges_usu_id) REFERENCES tb_usuarios(id_usuario)
);

-- Termo de consentimento dos responsáveis (LGPD, art. 14, §1º): uso de imagem e informações do aluno.
-- Cada assinatura, alteração ou revogação vira uma NOVA linha (o histórico nunca é apagado); vale a mais recente da versão atual do termo.
-- id_usuario = quem assinou. con_codigo = código de verificação do comprovante.
-- Sem nenhuma linha para o aluno = consentimento pendente. Todas as opções falsas = não autorizado (ou revogado).
CREATE TABLE tb_consentimentos (
  con_id INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  id_usuario INT NOT NULL,
  con_versao VARCHAR(10) NOT NULL,
  con_informacoes BOOLEAN NOT NULL,
  con_imagem BOOLEAN NOT NULL,
  con_monitoramento BOOLEAN NOT NULL,
  con_assinado_nome VARCHAR(100) NOT NULL,
  con_codigo VARCHAR(20) NOT NULL,
  con_assinado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- Comunicações ao Conselho Tutelar (ECA, arts. 13 e 56; LDB, art. 12, VIII).
-- REGISTRO CONFIDENCIAL: não aparece para os responsáveis (a suspeita pode envolver a própria família) e nunca é apagado.
-- id_usuario = quem registrou. id_busca_ativa = caso de Busca Ativa de origem (só quando o motivo é faltas).
-- cct_comunicado_em vazio = ainda PENDENTE de comunicação; preenchido = a escola já comunicou (cct_protocolo = ofício/protocolo).
CREATE TABLE tb_comunicacoes_conselho (
  id_comunicacao_conselho INT AUTO_INCREMENT PRIMARY KEY,
  id_aluno INT NOT NULL,
  id_usuario INT NOT NULL,
  id_busca_ativa INT NULL,
  cct_motivo ENUM('Maus-tratos','Faltas','Outro') NOT NULL,
  cct_descricao VARCHAR(1500) NOT NULL,
  cct_medidas VARCHAR(1500) NULL,
  cct_registrada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  cct_registrada_por_nome VARCHAR(100) NOT NULL,
  cct_comunicado_em DATE NULL,
  cct_comunicado_por_nome VARCHAR(100) NULL,
  cct_protocolo VARCHAR(60) NULL,
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  FOREIGN KEY (id_busca_ativa) REFERENCES tb_busca_ativa(id_busca_ativa)
);

-- Fase 4: calendário de eventos. eve_sala vazia = escola toda. eve_destaque = aparece como banner nos painéis.
-- O banner (imagem opcional) fica criptografado na pasta uploads/, como os documentos. id_usuario = quem criou.
CREATE TABLE tb_eventos (
  id_evento INT AUTO_INCREMENT PRIMARY KEY,
  eve_titulo VARCHAR(100) NOT NULL,
  eve_descricao VARCHAR(500) NULL,
  eve_tipo ENUM('Evento','Reunião','Passeio','Feriado','Prazo') NOT NULL DEFAULT 'Evento',
  eve_data DATE NOT NULL,
  eve_data_fim DATE NULL,
  eve_hora TIME NULL,
  eve_local VARCHAR(100) NULL,
  eve_sala VARCHAR(40) NULL,
  eve_destaque BOOLEAN NOT NULL DEFAULT FALSE,
  eve_banner_arquivo VARCHAR(80) NULL,
  eve_banner_mime VARCHAR(30) NULL,
  id_usuario INT NULL,
  eve_criado_por_nome VARCHAR(100) NOT NULL,
  eve_criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario),
  CONSTRAINT fk_eve_turma FOREIGN KEY (eve_sala) REFERENCES tb_turmas(tur_nome) ON UPDATE CASCADE,
  CONSTRAINT chk_eve_periodo CHECK (eve_data_fim IS NULL OR eve_data_fim >= eve_data)
);

-- Fase 5: cada passagem diante de uma câmera com reconhecimento facial (SIMULADO).
-- O sistema NÃO guarda foto nem dado biométrico: só o resultado. Sem cadastro facial (sem consentimento ou turma antes do Pré),
-- a imagem é descartada e o aluno NÃO é identificado (id_aluno fica vazio). Os registros são apagados depois de 90 dias.
CREATE TABLE tb_reconhecimentos (
  id_reconhecimento INT AUTO_INCREMENT PRIMARY KEY,
  id_camera INT NOT NULL,
  id_aluno INT NULL,
  rec_sentido ENUM('Entrada','Saída') NOT NULL,
  rec_resultado ENUM('Reconhecido','Sem cadastro facial') NOT NULL,
  rec_motivo VARCHAR(60) NULL,
  rec_confianca DECIMAL(4,1) NULL,
  rec_data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rec_hora (rec_data_hora),
  FOREIGN KEY (id_camera) REFERENCES tb_cameras(id_camera),
  FOREIGN KEY (id_aluno) REFERENCES tb_alunos(id_aluno)
);

-- Fase 5: chaves de configuração que a gestão liga e desliga pela tela (ex.: reconhecimento facial)
CREATE TABLE tb_configuracoes (
  cfg_chave VARCHAR(40) PRIMARY KEY,
  cfg_valor VARCHAR(100) NOT NULL,
  cfg_atualizado_por_nome VARCHAR(100) NULL,
  cfg_atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- tb_assinaturas digitais (uma linha por assinatura, de qualquer documento). É a PROVA da assinatura:
--   ass_conteudo_hash: SHA-256 do texto exato que foi assinado (se o documento mudar depois, a verificação acusa).
--   ass_selo: assinatura Ed25519 do servidor sobre todos os campos da linha (se alguém alterar a linha no banco, a verificação acusa).
--   Quem assina confirma com a própria senha. ass_ip / ass_navegador: de onde assinou. ass_codigo: código público de verificação.
CREATE TABLE tb_assinaturas (
  id_assinatura INT AUTO_INCREMENT PRIMARY KEY,
  ass_codigo CHAR(16) NOT NULL UNIQUE,
  ass_documento ENUM('ocorrencia','autorizacao','consentimento') NOT NULL,
  ass_documento_id INT NOT NULL,
  ass_papel ENUM('professor','resp','gestao') NOT NULL,
  id_usuario INT NOT NULL,
  ass_nome VARCHAR(100) NOT NULL,
  ass_conteudo_hash CHAR(64) NOT NULL,
  ass_ip VARCHAR(45) NULL,
  ass_navegador VARCHAR(255) NULL,
  ass_assinada_em DATETIME NOT NULL,
  ass_selo VARCHAR(100) NOT NULL,
  INDEX idx_ass_documento (ass_documento, ass_documento_id),
  FOREIGN KEY (id_usuario) REFERENCES tb_usuarios(id_usuario)
);

-- Escolas interessadas em contratar o S.I.V.E. (ficha "Quero o S.I.V.E. na minha escola", na página inicial, sem login).
-- Não tem ligação com as outras tabelas: é o cadastro comercial da empresa S.I.V.E. A equipe consulta com: npm run escolas
--   esi_protocolo: número que a escola recebe na tela (db_sive-AAAA-NNNNN). esi_etapas: lista separada por vírgula.
--   esi_aceite_em: quando a pessoa concordou com o uso dos dados para contato (LGPD, art. 7º, I). esi_ip: contra envios automáticos.
CREATE TABLE tb_escolas_interessadas (
  id_escola_interessada INT AUTO_INCREMENT PRIMARY KEY,
  esi_protocolo VARCHAR(20) NULL UNIQUE,
  esi_nome VARCHAR(150) NOT NULL,
  esi_cnpj CHAR(14) NULL,
  esi_rede ENUM('municipal','estadual','federal','privada') NULL,
  esi_etapas VARCHAR(120) NULL,
  esi_alunos INT NOT NULL,
  esi_cep CHAR(8) NULL,
  esi_logradouro VARCHAR(150) NULL,
  esi_numero VARCHAR(10) NULL,
  esi_complemento VARCHAR(60) NULL,
  esi_bairro VARCHAR(80) NULL,
  esi_cidade VARCHAR(80) NOT NULL,
  esi_uf CHAR(2) NOT NULL,
  esi_contato_nome VARCHAR(100) NOT NULL,
  esi_contato_cargo VARCHAR(60) NULL,
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

-- Chaves para tb_usuarios em tabelas criadas antes dela
ALTER TABLE tb_autorizacoes ADD CONSTRAINT fk_aut_assinada_por FOREIGN KEY (aut_assinada_por) REFERENCES tb_usuarios(id_usuario);
ALTER TABLE tb_busca_ativa_registros ADD CONSTRAINT fk_bar_usuario FOREIGN KEY (bar_usuario_id) REFERENCES tb_usuarios(id_usuario);

INSERT INTO tb_turmas (tur_nome, tur_ano_letivo, tur_turno) VALUES
('Maternal II', YEAR(CURDATE()), 'Integral'), ('1º Ano C', YEAR(CURDATE()), 'Manhã'), ('2º Ano B', YEAR(CURDATE()), 'Manhã'),
('3º Ano A', YEAR(CURDATE()), 'Manhã'), ('4º Ano A', YEAR(CURDATE()), 'Tarde'), ('5º Ano B', YEAR(CURDATE()), 'Tarde');

INSERT INTO tb_alunos (alu_nome, alu_sala, alu_matricula) VALUES
('Ana Clara Souza','3º Ano A','2026-0101'),
('João Pedro Silva','2º Ano B','2026-0184'),
('Marina Costa','4º Ano A','2026-0233'),
('Lucas Almeida','1º Ano C','2026-0310'),
('Beatriz Lima','5º Ano B','2026-0355'),
('Theo Martins','Maternal II','2026-0402');

INSERT INTO tb_resp (res_nome, res_telefone, res_foto, res_email) VALUES
('Ana Paula Silva','(11) 98765-4321','assets/responsavel-ana.jpg','anapaula.silva@email.com'),
('Carlos Henrique Silva','(11) 97654-1234','assets/responsavel-carlos.jpg',NULL),
('Cláudia Souza','(11) 95555-7788',NULL,NULL),
('Marcos Lima','(11) 94444-2211',NULL,'marcos.lima@email.com'),
('Rosana Almeida','(11) 93333-5566',NULL,NULL),
('Paulo Costa','(11) 92222-8899',NULL,'paulo.costa@email.com');
-- Lucas (4) e Marina (3) estão na Busca Ativa: com os responsáveis cadastrados, o contato da família aparece no próprio caso
INSERT INTO tb_aluno_resp VALUES (2,1,'Mãe'),(2,2,'Pai'),(1,3,'Mãe'),(5,4,'Pai'),(4,5,'Mãe'),(3,6,'Pai');

-- Câmeras simuladas: dois portões com reconhecimento facial e duas câmeras de área comum (o refeitório está desligado)
INSERT INTO tb_cameras (cam_nome, cam_local, cam_tipo, cam_reconhecimento, cam_ativa) VALUES
('Portão principal','Entrada da escola','Entrada',TRUE,TRUE),
('Portão de saída','Saída pela rua lateral','Saída',TRUE,TRUE),
('Pátio','Pátio central','Área comum',FALSE,TRUE),
('Refeitório','Refeitório','Área comum',FALSE,FALSE);
INSERT INTO tb_configuracoes (cfg_chave, cfg_valor, cfg_atualizado_por_nome) VALUES ('reconhecimento_facial','ligado','Mariana Santos');

-- Entradas de hoje: a Ana Clara entrou pelo reconhecimento facial (a mãe autorizou).
-- O João Pedro passou pela câmera, mas não tem cadastro facial (o termo ainda está pendente): a portaria registrou a entrada à mão.
INSERT INTO tb_acessos (id_aluno, ace_sala, ace_data_hora, id_camera, ace_metodo) VALUES
(4,'Portão principal',TIMESTAMP(CURDATE(),'07:22:51'),1,'Manual'),
(1,'Portão principal',TIMESTAMP(CURDATE(),'07:26:05'),1,'Facial'),
(2,'Portão principal',TIMESTAMP(CURDATE(),'07:31:42'),1,'Manual');
INSERT INTO tb_reconhecimentos (id_camera, id_aluno, rec_sentido, rec_resultado, rec_motivo, rec_confianca, rec_data_hora) VALUES
(1,1,'Entrada','Reconhecido',NULL,97.8,TIMESTAMP(CURDATE(),'07:26:05')),
(1,NULL,'Entrada','Sem cadastro facial','Rosto sem cadastro: imagem descartada',NULL,TIMESTAMP(CURDATE(),'07:31:40'));


-- Login de teste: administradora vê tudo; a mãe do João só vê o filho dela;
-- a professora só vê a turma "2º Ano B", que é a turma do João Pedro
-- Fase 4: "claudia" é a mãe da Ana Clara e "marcos" é o pai da Beatriz (os dois já autorizaram o reconhecimento facial). "roberto" está há 75 dias sem acessar: o sistema o inativa sozinho ao ligar.
-- "fernanda" está há 53 dias sem acessar: aparece no aviso "perto do limite". Todas as senhas de demonstração são 123456.
INSERT INTO tb_usuarios (usu_usuario, usu_senha, usu_papel, usu_nome, id_aluno, usu_sala, usu_senha_temporaria, id_responsavel, usu_ultimo_acesso, usu_criado_em) VALUES
('mariana', 'scrypt$06e82e26a74ff7b0fe6a8602ad9bf8a7$8364bdd2a45dfca289f6f63a292ed4d0e869831679b87fbf002009e7b0fccac3', 'admin', 'Mariana Santos', NULL, NULL, FALSE, NULL, NULL, NOW()),
('anapaula', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Ana Paula Silva', 2, NULL, FALSE, 1, NULL, NOW()),
('patricia', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Patrícia Gomes', NULL, '2º Ano B', FALSE, NULL, NULL, NOW()),
('claudia', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Cláudia Souza', 1, NULL, FALSE, 3, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 90 DAY)),
('roberto', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Roberto Lima', NULL, '4º Ano A', FALSE, NULL, DATE_SUB(NOW(), INTERVAL 75 DAY), DATE_SUB(NOW(), INTERVAL 200 DAY)),
('fernanda', 'scrypt$b55dbcc12852619d6e20644a1707604c$454c77287af43190c0d2f79575b2c9c210c81d5efea35ce6e3892c1759852512', 'professor', 'Fernanda Rocha', NULL, '1º Ano C', FALSE, NULL, DATE_SUB(NOW(), INTERVAL 53 DAY), DATE_SUB(NOW(), INTERVAL 200 DAY)),
('marcos', 'scrypt$a66cb601d4fad63263a65613eee1c143$fb8a5b27d0b9f2dbeb0c0f115fd46c1d1d1ece3dd84382b6b5420021ad091806', 'pai', 'Marcos Lima', 5, NULL, FALSE, 4, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 90 DAY));
INSERT INTO tb_professor_turma (id_usuario, id_turma) SELECT u.id_usuario, t.id_turma FROM tb_usuarios u JOIN tb_turmas t ON t.tur_nome = u.usu_sala WHERE u.usu_papel = 'professor';

-- Termo de consentimento já assinado pela mãe da Ana Clara (autorizou tudo, inclusive câmeras e reconhecimento facial)
INSERT INTO tb_consentimentos (id_aluno, id_usuario, con_versao, con_informacoes, con_imagem, con_monitoramento, con_assinado_nome, con_codigo, con_assinado_em) VALUES
(1, 4, '1.0', TRUE, TRUE, TRUE, 'Cláudia Souza', '7F3A9C21B4E05D68', DATE_SUB(NOW(), INTERVAL 20 DAY)),
(5, 7, '1.0', TRUE, TRUE, TRUE, 'Marcos Lima', '2C8D1E5B9A07F643', DATE_SUB(NOW(), INTERVAL 15 DAY));

-- tb_eventos de exemplo (datas contadas a partir de hoje). Os de destaque aparecem como banner nos painéis.
INSERT INTO tb_eventos (eve_titulo, eve_descricao, eve_tipo, eve_data, eve_data_fim, eve_hora, eve_local, eve_sala, eve_destaque, id_usuario, eve_criado_por_nome) VALUES
('Reunião de pais e mestres', 'Apresentação do desempenho do bimestre e conversa com os professores de cada turma.', 'Reunião', DATE_ADD(CURDATE(), INTERVAL 5 DAY), NULL, '09:00', 'Auditório', NULL, TRUE, 1, 'Mariana Santos'),
('Feira Cultural', 'Os tb_alunos apresentam pesquisas sobre a cultura das famílias. Toda a comunidade está convidada.', 'Evento', DATE_ADD(CURDATE(), INTERVAL 12 DAY), DATE_ADD(CURDATE(), INTERVAL 13 DAY), '08:00', 'Pátio central', NULL, TRUE, 1, 'Mariana Santos'),
('Passeio ao Museu Catavento', 'Saída às 8h e retorno às 15h. Levar a autorização assinada.', 'Passeio', DATE_ADD(CURDATE(), INTERVAL 8 DAY), NULL, '08:00', 'Museu Catavento', '2º Ano B', TRUE, 3, 'Patrícia Gomes'),
('Entrega do comprovante de residência', 'Último dia para atualizar o cadastro na secretaria.', 'Prazo', DATE_ADD(CURDATE(), INTERVAL 3 DAY), NULL, NULL, 'Secretaria', NULL, FALSE, 1, 'Mariana Santos'),
('Recesso escolar', 'Não haverá aula.', 'Feriado', DATE_ADD(CURDATE(), INTERVAL 18 DAY), DATE_ADD(CURDATE(), INTERVAL 19 DAY), NULL, NULL, NULL, FALSE, 1, 'Mariana Santos'),
('Semana da leitura', 'Cada turma visitou a biblioteca e escolheu um livro.', 'Evento', DATE_SUB(CURDATE(), INTERVAL 6 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), NULL, 'Biblioteca', NULL, FALSE, 1, 'Mariana Santos');

-- Autorizações de exemplo: passeio (João e Ana Clara, pendente) e uso de imagem (João, já assinada pela mãe)
-- Datas por extenso em português ("8 de novembro") nos textos de exemplo
SET lc_time_names = 'pt_BR';
-- Passeio: assinar até a véspera (dentro do prazo). Zoológico: o prazo já passou, então aparece como "Vencida".
INSERT INTO tb_autorizacoes (aut_grupo, id_aluno, aut_titulo, aut_validade, aut_valida_ate, aut_detalhe, aut_criada_por_nome) VALUES
('seedpasseio', 2, 'Passeio ao Museu Catavento', CONCAT('Passeio em ', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 8 DAY), '%e de %M')), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Transporte e lanche inclusos', 'Mariana Santos'),
('seedpasseio', 1, 'Passeio ao Museu Catavento', CONCAT('Passeio em ', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 8 DAY), '%e de %M')), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Transporte e lanche inclusos', 'Mariana Santos'),
('seedzoo', 2, 'Visita ao zoológico', CONCAT('Visita em ', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '%e de %M')), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Saída às 8h, retorno às 15h', 'Mariana Santos');
INSERT INTO tb_autorizacoes (aut_grupo, id_aluno, aut_titulo, aut_validade, aut_detalhe, aut_criada_por_nome, aut_assinada_por, aut_assinada_nome, aut_assinada_em, aut_codigo) VALUES
('seedimagem', 2, 'Uso de imagem — Feira Cultural', 'Válida até dezembro', 'Fotos do evento no portal escolar', 'Mariana Santos', 2, 'Ana Paula Silva', DATE_SUB(NOW(), INTERVAL 3 DAY), 'A1B2C3D4E5F60718');

-- tb_comunicados de exemplo
INSERT INTO tb_comunicados (com_titulo, com_texto, com_sala, com_criado_por_nome, com_criado_em) VALUES
('Reunião de pais e mestres', 'A reunião será no sábado, às 9h, no auditório da escola. A presença de todos é importante.', NULL, 'Mariana Santos', DATE_SUB(NOW(), INTERVAL 6 DAY)),
('Feira Cultural — o que levar', 'Os alunos do 2º Ano B devem levar uma pesquisa sobre a cultura da sua família.', '2º Ano B', 'Patrícia Gomes', DATE_SUB(NOW(), INTERVAL 4 DAY)),
('Uniforme e material', 'Lembramos que o uniforme completo é obrigatório a partir da próxima semana.', NULL, 'Mariana Santos', DATE_SUB(NOW(), INTERVAL 1 DAY));
INSERT INTO tb_comunicado_leituras (id_comunicado, id_aluno, col_usuario_id) VALUES
(1, 1, NULL), (1, 2, 2), (1, 4, NULL), (3, 1, NULL);

-- Pendência, ação e advertência de exemplo
INSERT INTO tb_pendencias (id_aluno, pen_tipo, pen_descricao, pen_criada_por_nome) VALUES
(3, 'Documento', 'Entregar comprovante de residência atualizado', 'Mariana Santos');
INSERT INTO tb_advertencias (id_aluno, adv_tipo, adv_descricao, adv_data, adv_registrada_por_nome) VALUES
(3, 'Acao', 'Conversa com a família sobre as faltas seguidas', DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Mariana Santos'),
(4, 'Advertencia', 'Saiu da sala sem autorização durante a aula', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Mariana Santos');

-- Presença de exemplo dos últimos 35 dias (só dias úteis), sempre contando a partir de hoje.
-- Marina (id 3): faltas seguidas | Lucas (id 4): faltas intercaladas | os dois entram na Busca Ativa.
INSERT INTO tb_presencas (id_aluno, pre_data, pre_status, pre_observacao)
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
  AND NOT (d.n = 0 AND a.id_aluno IN (5, 6)); -- Beatriz e Theo ainda não chegaram hoje: use "Simular chegada" no Monitoramento
