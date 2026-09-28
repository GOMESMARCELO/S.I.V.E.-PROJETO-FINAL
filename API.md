# API do S.I.V.E.

Todas as rotas ficam em `server.js` e respondem em JSON. Base: http://localhost:3000

| Método | Rota                              | O que faz                                   |
|--------|------------------------------------|----------------------------------------------|
| GET    | /api/alunos                        | Lista os alunos (tela Secretaria)             |
| GET    | /api/acessos                       | Últimos 4 acessos registrados                 |
| POST   | /api/acessos                       | Registra um novo acesso `{ aluno_id, sala }`  |
| GET    | /api/saida?nome=texto              | Busca aluno + responsáveis para retirada      |
| POST   | /api/saidas                        | Confirma a liberação `{ aluno_id }`           |
| GET    | /api/autorizacoes/:alunoId         | Autorizações de um aluno                      |
| PUT    | /api/autorizacoes/:id/alternar     | Aprova/desfaz uma autorização                 |
| GET    | /api/presencas/:alunoId            | Últimas 5 presenças/faltas de um aluno        |

## Testando com curl

```bash
curl http://localhost:3000/api/alunos
curl -X POST http://localhost:3000/api/acessos -H "Content-Type: application/json" -d "{\"aluno_id\":1,\"sala\":\"Sala 1\"}"
curl -X PUT http://localhost:3000/api/autorizacoes/1/alternar
```

## Erros

Se algo der errado (banco fora do ar, id inexistente etc.), a resposta vem com o código HTTP 500 e o formato `{ "erro": "mensagem" }`.
