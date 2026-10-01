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

## Só professores

| Método | Rota                | O que faz                                           |
|--------|----------------------|--------------------------------------------------------|
| GET    | /api/minha-turma     | Lista os alunos da turma do professor logado            |

## Qualquer usuário autenticado

| Método | Rota             | O que faz                                     |
|--------|-------------------|--------------------------------------------------|
| PUT    | /api/minha-senha | Troca a própria senha `{ senha_atual, senha_nova }` |

## Administração vê de todos; responsável só vê o próprio filho

| Método | Rota                              | O que faz                                   |
|--------|-------------------------------------|----------------------------------------------|
| GET    | /api/alunos/:alunoId               | Nome e sala de um aluno                       |
| GET    | /api/autorizacoes/:alunoId         | Autorizações de um aluno                      |
| PUT    | /api/autorizacoes/:id/alternar     | Aprova/desfaz uma autorização                 |
| GET    | /api/presencas/:alunoId            | Últimas 5 presenças/faltas de um aluno        |

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
