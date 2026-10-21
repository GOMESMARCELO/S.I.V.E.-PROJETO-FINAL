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
| GET    | /api/logs                          | Lista as últimas 50 ações registradas              |

## Frequência, Busca Ativa e relatório (só administração)

| Método | Rota                                       | O que faz                                                   |
|--------|----------------------------------------------|----------------------------------------------------------------|
| GET    | /api/resumo                                | Quadros da Central do Dia (total, presentes, ausentes...)       |
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
| POST   | /api/ocorrencias                           | gestão, professor (da turma) | Registra ação/advertência `{ aluno_id, tipo, descricao, data? }` |

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

## Sobre o token e a segurança

- O token é assinado com HMAC-SHA256 (chave `segredo_token` do `config.json`) e expira em 8 horas
  (`seguranca.token_horas`). Se o conteúdo for alterado, ou a assinatura for falsa, a resposta é `401`.
- A cada requisição o servidor confere no banco se o usuário continua ativo e qual é o seu perfil.
- Senhas ficam no banco como hash `scrypt$sal$hash`. Senhas antigas em texto puro são convertidas no próximo login.
- Após 5 senhas erradas seguidas, aquele usuário (naquele computador) é bloqueado por 5 minutos (`429`).
- `GET /api/documentos/:id/arquivo` descriptografa o arquivo, entrega como anexo e registra o download nos logs.
  Tentativas negadas e arquivos adulterados também são registrados (`documento_acesso_negado`, `documento_integridade_falhou`).
