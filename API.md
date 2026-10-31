# API do S.I.V.E.

Base: http://localhost:3000. Todas as rotas (exceto o login) exigem o
cabeçalho `Authorization: Bearer <token>`, obtido em `/api/login`.

## Login

| Método | Rota        | O que faz                                                      |
|--------|-------------|------------------------------------------------------------------|
| POST   | /api/login  | Recebe `{ usuario, senha }` e devolve o token de acesso          |

Usuários de teste (cadastrados em `database/sive.sql`):
- **Administração:** `mariana` / `123456`
- **Responsável (mãe do João Pedro):** `anapaula` / `123456`
- **Professora (turma 2º Ano B):** `patricia` / `123456`

## Só a administração pode acessar

| Método | Rota                              | O que faz                                   |
|--------|-------------------------------------|----------------------------------------------|
| GET    | /api/alunos                        | Lista todos os alunos (tela Secretaria)       |
| GET    | /api/acessos                       | Últimos 4 acessos registrados                 |
| POST   | /api/acessos                       | Registra um novo acesso `{ aluno_id, sala }`  |
| GET    | /api/saida?nome=texto              | Busca aluno + responsáveis para retirada      |
| POST   | /api/saidas                        | Confirma a liberação `{ aluno_id }`           |

## Só administração (gestão de usuários e cadastro)

| Método | Rota                              | O que faz                                       |
|--------|-------------------------------------|---------------------------------------------------|
| POST   | /api/alunos                        | Cadastra um aluno novo, com responsáveis           |
| GET    | /api/usuarios                      | Lista os usuários do sistema                       |
| POST   | /api/usuarios                      | Cria um usuário (gera senha provisória automática) |
| PUT    | /api/usuarios/:id/ativo            | Ativa ou desativa um usuário                       |
| POST   | /api/usuarios/:id/filhos           | Liga o login de um responsável a outro aluno `{ aluno_id, parentesco }` (responsável com mais de um filho) |
| DELETE | /api/usuarios/:id/filhos/:alunoId  | Desliga um aluno do responsável (o aluno principal do login não pode ser desligado) |
| PUT    | /api/usuarios/:id/turmas           | Turmas do professor `{ turmas: ["2º Ano B", ...] }`. A turma principal continua a mesma se estiver na lista |
| GET    | /api/turmas                        | Turmas com ano letivo, turno, nº de alunos ativos e professores |
| POST   | /api/turmas                        | Cria turma `{ nome, ano_letivo, turno? }` |
| PUT    | /api/turmas/:id                    | Altera ou renomeia `{ nome, ano_letivo, turno?, ativa }`. Renomear atualiza alunos, professores, comunicados e eventos |
| PUT    | /api/alunos/:alunoId/situacao      | `{ situacao, motivo? }` (Ativo, Transferido, Concluiu ou Desistente). Quem sai não é apagado, só sai das listas do dia a dia |
| GET    | /api/logs                          | Lista as últimas 50 ações registradas              |

## Frequência, Busca Ativa e relatório (só administração)

| Método | Rota                                       | O que faz                                                   |
|--------|----------------------------------------------|----------------------------------------------------------------|
| GET    | /api/resumo                                | Quadros da Central do Dia (total, presentes, ausentes...). `documentos_recentes` e `autorizacoes_recentes` contam as últimas 24 horas. `ocorrencias_gestao` = ocorrências dos professores sem a assinatura da gestão (`ocorrencias_sem_resp` = destas, quantas o responsável ainda não assinou) |
| GET    | /api/documentos-recentes                   | Pasta "Documentos recebidos recentemente" (só gestão): documentos que atenderam a uma pendência, enviados por responsáveis nas últimas 24 horas, com nome, turma e matrícula do aluno |
| GET    | /api/frequencia?data=AAAA-MM-DD            | Situação de todos os alunos em um dia (sem `data`: último dia)  |
| GET    | /api/busca-ativa                           | Casos de Busca Ativa (abre os novos automaticamente)           |
| POST   | /api/busca-ativa/:id/acompanhamento        | Anota um acompanhamento `{ texto }`                             |
| PUT    | /api/busca-ativa/:id/encerrar              | Encerra o caso `{ texto }` (opcional)                           |
| GET    | /api/relatorio-mensal?mes=AAAA-MM          | Relatório do mês (sem `mes`: mês atual)                         |

## Gestão de alunos, ficha, documentos e autorizações digitais

| Método | Rota                                       | Quem             | O que faz                                                         |
|--------|----------------------------------------------|------------------|----------------------------------------------------------------------|
| GET    | /api/gestao-alunos                         | gestão           | Tabela de gestão: comunicados, autorizações, pendências e ocorrências por aluno |
| GET    | /api/alunos/:alunoId/ficha                 | gestão, professor (da turma), responsável (do filho) | Ficha completa em abas |
| GET    | /api/comunicados                           | gestão, professor | Comunicados com quantos já leram                                   |
| POST   | /api/comunicados                           | gestão, professor | Publica `{ titulo, texto, sala? }` (professor: sempre a própria turma) |
| GET    | /api/comunicados/:id/leituras              | gestão, professor | Quem leu e quem não leu                                            |
| POST   | /api/comunicados/:id/ler                   | responsável      | Marca como lido para o filho                                       |
| POST   | /api/autorizacoes                          | gestão           | Cria a autorização `{ titulo, detalhe, validade, sala? }` para a turma ou a escola toda |
| GET    | /api/autorizacoes-grupos                   | gestão           | Autorizações enviadas, com quantas foram assinadas                 |
| GET    | /api/autorizacoes-grupos/:grupo            | gestão           | Quem assinou, quando e o código de verificação                     |
| POST   | /api/autorizacoes/:id/assinar              | responsável      | Assinatura digital `{ nome, senha }`: grava quem, quando e um código |
| POST   | /api/documentos                            | gestão, professor (da turma), responsável (do filho) | Anexa documento `{ aluno_id, categoria, titulo, nome_arquivo, conteudo (base64), pendencia_id? }` |
| GET    | /api/documentos/:id/arquivo                | quem pode ver o aluno | Baixa o arquivo                                               |
| DELETE | /api/documentos/:id                        | gestão           | Exclui o documento e o arquivo                                     |
| POST   | /api/pendencias                            | gestão, professor (da turma) | Abre pendência `{ aluno_id, tipo, descricao }`        |
| PUT    | /api/pendencias/:id/resolver               | gestão           | Marca como resolvida                                               |
| POST   | /api/advertencias                          | gestão, professor (da turma) | Registra ação/advertência (tabela `advertencias`) `{ aluno_id, tipo, descricao, data? }` |
| GET    | /api/ocorrencias-escolares                 | professor        | Ocorrências da própria turma (arquivo), da mais recente para a mais antiga |
| POST   | /api/ocorrencias-escolares                 | professor (da turma) | Registra a ocorrência do dia `{ aluno_id, data, horario, notificado_em, descricao, buscado_por, senha }`; a senha de quem está logado assina digitalmente. Devolve o código de verificação |
| GET    | /api/minhas-ocorrencias                    | responsável      | Ocorrências do filho, com a assinatura do professor e a do responsável (`resp_*`, vazio = ainda não assinou) |
| GET    | /api/minhas-ocorrencias/novas              | responsável      | `{ novas }`: quantas ainda não foram assinadas (número ao lado de "Ocorrências" no menu) |
| POST   | /api/minhas-ocorrencias/:id/assinar        | responsável (do aluno) | Assinatura de ciência `{ senha }` (a senha de quem está logado). Devolve o código de verificação |
| GET    | /api/ocorrencias-gestao                    | administração | Pasta de ocorrências da Central do Dia: todas as ocorrências dos professores, com as assinaturas do responsável (`resp_*`) e da gestão (`ges_*`) |
| POST   | /api/ocorrencias-gestao/:id/assinar        | administração | Assinatura da gestão `{ senha }` (a senha de quem está logado). A ocorrência passa para "Ocorrências registradas". Devolve o código de verificação |

Regras dos documentos: PDF, PNG, JPG, DOC ou DOCX, até 5 MB. O servidor confere se o conteúdo bate com a extensão
e guarda o arquivo com nome aleatório na pasta `uploads/`, que não é pública.

## Só professores

| Método | Rota                | O que faz                                           |
|--------|----------------------|--------------------------------------------------------|
| GET    | /api/minha-turma     | Alunos da turma do professor, com a situação de hoje e as faltas |
| POST   | /api/chamada         | Grava a chamada de hoje `{ registros: [{ aluno_id, status }] }`  |

## Qualquer usuário autenticado

| Método | Rota             | O que faz                                     |
|--------|-------------------|--------------------------------------------------|
| PUT    | /api/minha-senha | Troca a própria senha `{ senha_atual, senha_nova }` |

## Administração vê de todos; responsável só vê o próprio filho

| Método | Rota                              | O que faz                                   |
|--------|-------------------------------------|----------------------------------------------|
| GET    | /api/alunos/:alunoId               | Nome e sala de um aluno                       |
| GET    | /api/presencas/:alunoId?dias=30    | Histórico de presença (padrão 30 dias, máx. 120) com totais e a situação de hoje |

Se um responsável tentar acessar o `:alunoId` de outra família, o
servidor responde `403 Forbidden`. Sem token válido, responde `401`.

## Testando com curl

```bash
# login
curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d "{\"usuario\":\"mariana\",\"senha\":\"123456\"}"

# use o "token" da resposta acima nas próximas chamadas
curl http://localhost:3000/api/alunos -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

## Privacidade e proteção de dados (LGPD)

| Método | Rota                                | Descrição                                                                                       |
|--------|-------------------------------------|-------------------------------------------------------------------------------------------------|
| GET    | /api/privacidade                    | Política de privacidade (pública, não precisa de login)                                         |
| POST   | /api/aceite-privacidade             | Registra que o usuário logado aceitou a política (grava data e versão)                          |
| GET    | /api/alunos/:alunoId/meus-dados     | Direito de acesso: baixa os dados do aluno em JSON (admin, ou o responsável do próprio aluno)   |

### Termo de consentimento dos responsáveis (imagem e informações do aluno)

| Método | Rota                                  | Descrição                                                                                           |
|--------|---------------------------------------|-----------------------------------------------------------------------------------------------------|
| GET    | /api/consentimento-termo              | Texto do termo (8 seções) e as 3 opções (informações, imagem, monitoramento). Pública               |
| GET    | /api/alunos/:alunoId/consentimento    | Situação atual: `pendente`, `autorizado`, `parcial` ou `nao_autorizado`. Responsável (só o filho), gestão e professor da turma (o professor não vê nome de quem assinou, código nem histórico) |
| POST   | /api/alunos/:alunoId/consentimento    | Só o responsável do próprio aluno. Recebe `{ informacoes, imagem, monitoramento, nome, senha }` (booleanos + confirmação) e devolve o código do comprovante. Alterar ou revogar = assinar de novo |
| GET    | /api/consentimentos                   | Só gestão: situação e resumo de todos os alunos                                                     |

Cada assinatura grava uma nova linha (histórico preservado); vale a mais recente da versão atual do termo. O histórico também sai em `meus-dados`.
Cinco senhas erradas seguidas ao assinar bloqueiam novas tentativas por 5 minutos (`429`).

Enquanto o usuário não aceitar a política, todas as rotas respondem `403` com `{ "codigo": "ACEITE_PENDENTE" }`,
exceto `PUT /api/minha-senha` e `POST /api/aceite-privacidade`. A resposta do login traz `aceite_ok` (true/false).

## Importação de alunos por planilha (só gestão)

| Método | Rota                    | Descrição                                                                                                                         |
|--------|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| POST   | /api/alunos/importar    | Recebe `{ nome_arquivo, conteudo (base64), turma_padrao?, confirmar }`. Com `confirmar: false` só confere e devolve as linhas (`ok`, `erro` ou `duplicado`, com os problemas); com `confirmar: true` grava as linhas prontas em uma transação |

Aceita CSV (`;`, `,` ou tabulação; UTF-8 ou Windows-1252) e Excel `.xlsx` (primeira aba), até 500 linhas e 2 MB. Erros de arquivo respondem `400` com a explicação.

## Proteção da criança: Conselho Tutelar (ECA arts. 13 e 56)

| Método | Rota                             | Descrição                                                                                                                      |
|--------|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| GET    | /api/protecao                    | Registros e quantidade de pendentes. Gestão vê todos; professor só os que registrou; responsável: `403`                          |
| POST   | /api/protecao                    | Registra um caso (`aluno_id`, `motivo`: Maus-tratos / Faltas / Outro, `descricao`, `medidas?`, `bua_id?`, `recursos_esgotados?`). Professor: só aluno da turma e sem o motivo Faltas. Faltas exige `recursos_esgotados: true` e ao menos um acompanhamento na Busca Ativa |
| PUT    | /api/protecao/:id/comunicado     | Só gestão: registra que a comunicação ao Conselho Tutelar foi feita (`data`, `protocolo?`)                                      |
| GET    | /api/protecao/faltas-limite      | Só gestão: alunos com faltas acima do limite da LDB, art. 12, VIII (7,5% das aulas com chamada)                                |

Os registros são sigilosos e nunca saem em `ficha`, `meus-dados` ou nos logs (os logs guardam só o motivo e o id do aluno). `/api/resumo` ganhou `comunicacoes_pendentes`, e os casos de `/api/busca-ativa` ganharam `comunicacao_id` e `comunicacao_feita`.
`POST /api/comunicados` responde `409` com `codigo: "NOME_DE_ALUNO"` quando o texto cita o nome completo de um aluno; reenviar com `confirmar_nomes: true` publica.

## Fase 4 — reativação de professores (só gestão)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | /api/reativacao                | Professores inativados por 60 dias sem acesso (com pedido de reativação) e os "perto do limite" (50+ dias) |
| PUT    | /api/usuarios/:id/reativar     | Reativa, gera uma senha provisória nova (devolvida só nesta resposta) e reinicia o prazo |

O login de um professor inativado por inatividade, com a senha certa, responde `403` com `codigo: "INATIVO_POR_INATIVIDADE"` e registra o pedido de reativação.

## Fase 4 — perfil do responsável (só responsável)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | /api/meu-perfil  | Conta, contatos, filho, outros responsáveis, últimos acessos e situação do consentimento |
| PUT    | /api/meu-perfil  | Atualiza `{ telefone, telefone2?, email?, contato_preferido }` (WhatsApp, Ligação ou E-mail) |

## Fase 4 — calendário e banners
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET    | /api/eventos?mes=AAAA-MM   | todos | Eventos do mês e próximos eventos (gestão: todos; professor: escola + turma; responsável: escola + turma do filho) |
| GET    | /api/eventos/banners       | todos | Até 5 eventos em destaque que ainda não passaram |
| POST   | /api/eventos               | gestão, professor | Cria `{ titulo, tipo, data, data_fim?, hora?, local?, sala?, descricao?, destaque, banner?: { nome_arquivo, conteudo (base64) }, imagem_sem_alunos }` |
| DELETE | /api/eventos/:id           | gestão ou quem criou | Exclui o evento e a imagem |
| GET    | /api/eventos/:id/banner    | quem pode ver o evento | Imagem do banner (guardada criptografada) |

## Fase 5 — monitoramento, câmeras e reconhecimento facial (SIMULADOS)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET    | /api/monitoramento                      | gestão | Câmeras, regra do facial, passagens de hoje, situação ao vivo e cadastro facial de cada aluno |
| PUT    | /api/configuracoes/reconhecimento-facial | gestão | Liga ou desliga `{ ligado: true/false }` |
| POST   | /api/cameras                            | gestão | Cadastra `{ nome, local, tipo: Entrada/Saída/Área comum, reconhecimento }` (recusa banheiros e vestiários) |
| PUT    | /api/cameras/:id/ativa                  | gestão | Liga ou desliga `{ ativa }` |
| POST   | /api/reconhecimento/simular             | gestão | Simula uma passagem `{ cam_id, aluno_id?, desconhecido? }`. Resultado: `Reconhecido` ou `Sem cadastro facial` |
| POST   | /api/acessos                            | gestão | Entrada pela portaria `{ aluno_id, cam_id? }` |
| POST   | /api/saidas/manual                      | gestão | Saída pela portaria `{ aluno_id, cam_id? }` |
| GET    | /api/alunos/:alunoId/agora              | gestão, professor (da turma), responsável (do filho) | Situação ao vivo: `na_escola`, `saiu`, `nao_chegou` ou `ausente`, com os movimentos de hoje |

## Responsável com vários filhos e professor com várias turmas

- `GET /api/meu-contexto` (responsável ou professor): `{ filhos: [{ id, nome, sala }], turmas: ["..."], aluno_id, sala }`. O login também devolve `filhos` e `turmas`.
- O navegador diz qual filho ou turma está aberto nos cabeçalhos `X-Aluno: <id>` ou `X-Turma: <nome codificado com encodeURIComponent>`.
  O servidor só aceita um filho ou turma que seja do usuário; se não for, usa o principal. As rotas do responsável e do professor passam a valer para o escolhido.
- `GET /api/minhas-ocorrencias` e `/novas` contam as ocorrências de **todos** os filhos.

## Assinatura digital (pública: verificar sem login)

Toda assinatura (ocorrência: professor, responsável e gestão; autorização; termo de consentimento) é confirmada com a senha de quem assina
e gera uma linha na tabela `assinaturas`: hash SHA-256 do conteúdo assinado + selo Ed25519 do servidor (chaves `assinatura_privada` / `assinatura_publica` no `config.json`).

| Método | Rota | O que faz |
|--------|------|-----------|
| GET | /api/verificar/:codigo | `status`: `valida`, `alterada` (conteúdo ou registro mudou depois da assinatura), `anterior` (assinada antes do selo digital) ou `nao_encontrada`. Mostra o documento, o papel, o nome abreviado de quem assinou, data e hora e o hash |
| GET | /api/verificar/:codigo/qr.svg | QR code que abre `/?verificar=CÓDIGO` (vai nos comprovantes) |

## Sobre o token e a segurança

- O token é assinado com HMAC-SHA256 (chave `segredo_token` do `config.json`) e expira em 8 horas
  (`seguranca.token_horas`). Se o conteúdo for alterado, ou a assinatura for falsa, a resposta é `401`.
- A cada requisição o servidor confere no banco se o usuário continua ativo e qual é o seu perfil.
- Senhas ficam no banco como hash `scrypt$sal$hash`. Senhas antigas em texto puro são convertidas no próximo login.
- Após 5 senhas erradas seguidas, aquele usuário (naquele computador) é bloqueado por 5 minutos (`429`).
- `GET /api/documentos/:id/arquivo` descriptografa o arquivo, entrega como anexo e registra o download nos logs.
  Tentativas negadas e arquivos adulterados também são registrados (`documento_acesso_negado`, `documento_integridade_falhou`).
