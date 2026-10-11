# S.I.V.E. — Vigilância Escolar Inteligente

TCC do Senai. Sistema web com três painéis: Secretaria, Segurança e Portal dos Pais.

## Tecnologias
HTML, CSS, JavaScript, JSON, Node.js (Express), MySQL, Git.

## Como rodar
Veja o passo a passo completo em `LEIA-ME.txt`.

Resumo:
1. Rode `database/sive.sql` no MySQL
2. Copie `config.example.json` para `config.json` e ajuste usuário/senha
3. `npm install`
4. `npm start`
5. Abra `http://localhost:3000`

## Funcionalidades
Cadastro de alunos e usuários (3 papéis), senha provisória, logs de atividade, chamada do professor,
controle e histórico de frequência, Busca Ativa automática por faltas, relatório mensal, tabela de gestão,
ficha do aluno, comunicados, documentos anexados e autorizações digitais com assinatura.

## Login
Administração (vê tudo, cadastra alunos e usuários): `mariana` / `123456`
Responsável (vê só o próprio filho): `anapaula` / `123456`
Professor(a) (vê só a própria turma): `patricia` / `123456`

## Rotas da API
Veja `API.md`.
