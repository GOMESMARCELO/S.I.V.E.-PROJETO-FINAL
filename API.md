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

## Sobre o token

O token usado aqui é só um JSON com o id/papel do usuário, codificado
em base64 — simples de explicar num TCC, mas não é criptografado.
Num sistema de verdade, o certo é usar JWT assinado e guardar a senha
com hash (bcrypt), não em texto puro como está em `usuarios.senha`.
