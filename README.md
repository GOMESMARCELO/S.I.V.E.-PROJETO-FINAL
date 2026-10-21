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

## Padrão de nomes do banco (mnemônicos)

Cada tabela tem uma sigla de 3 letras e **toda coluna começa com a sigla da sua tabela** (`<sigla>_<campo>`). Chave estrangeira mantém o nome da chave primária da tabela de origem (ex.: `alu_id` em `presencas` aponta para `alunos.alu_id`).

| Tabela | Sigla | Tabela | Sigla |
|---|---|---|---|
| alunos | ALU | busca_ativa_registros | BAR |
| responsaveis | RES | acessos | ACE |
| aluno_responsavel | ALR | saidas | SAI |
| usuarios | USU | autorizacoes | AUT |
| logs | LOG | comunicados | COM |
| presencas | PRE | comunicado_leituras | COL |
| busca_ativa | BUA | documentos | DOC |
| pendencias | PEN | ocorrencias | OCO |
| consentimentos | CON | comunicacoes_conselho | CCT |

Exemplo: `alunos` tem `alu_id`, `alu_nome`, `alu_sala`, `alu_matricula`. A API continua devolvendo os mesmos campos de antes (`id`, `nome`, `sala`...): o servidor traduz os nomes ao consultar o banco.

## Segurança e LGPD

O que o sistema faz hoje:

- **Documentos criptografados** no disco (AES-256-GCM), com nome aleatório, fora das pastas públicas. Se alguém alterar ou trocar um arquivo, ele deixa de abrir.
- **Controle de acesso por perfil** (gestão, professor da turma, responsável do próprio aluno) e **registro** de cada envio, download, exclusão e tentativa negada.
- **Login assinado** (não dá para forjar), com validade de 8 horas; o servidor confere no banco se o usuário continua ativo.
- **Senhas com hash** (scrypt) e **bloqueio temporário** após 5 tentativas erradas.
- **Política de privacidade** e **aceite registrado** (quem, quando, qual versão) no primeiro acesso; o responsável declara ser pai, mãe ou responsável legal (LGPD, art. 14, §1º).
- **Direito de acesso** (art. 18): botão "Baixar os dados do aluno" na ficha (gestão e responsável).
- **Termo de consentimento dos pais** (uso de imagem e informações do aluno, art. 14, §1º): o responsável escolhe item a item (informações, imagens no sistema, câmeras e reconhecimento facial), assina com nome completo e senha e recebe um comprovante com código. Pode alterar ou revogar quando quiser; cada decisão vira uma nova linha na tabela `consentimentos` (histórico preservado). A gestão acompanha quem já respondeu na tela **Consentimentos**, e a ficha do aluno mostra a situação. Se o texto do termo mudar de versão, o consentimento volta a ficar pendente.
- Cabeçalhos de segurança (CSP, nosniff, sem cache na API).

**Antes de usar de verdade:**

1. Preencha a seção `escola` do `config.json` (nome da escola, encarregado de dados, e-mail e prazo de guarda). Enquanto estiver entre colchetes, a política mostra os colchetes.
2. As chaves de segurança são criadas sozinhas no `config.json` na primeira vez. **Faça backup do `config.json` e da pasta `uploads/`**: sem a chave, os documentos não abrem.
3. Use HTTPS (por exemplo, atrás de um proxy como Nginx). O sistema em si roda em HTTP.

**O que ainda não está coberto** (fica como melhoria): o sistema registra e mostra o consentimento, mas não bloqueia funções sozinho (quem decide usar ou não imagens e câmeras é a escola, respeitando o que está registrado; o reconhecimento facial do projeto é só simulado); excluir todos os dados de um aluno, apagar documentos automaticamente após o prazo de guarda, procedimento de incidente, HTTPS embutido, e guardar a chave dos arquivos separada dos arquivos (aqui ficam na mesma máquina). Este projeto aplica medidas técnicas; a validação jurídica (base legal, prazos, encarregado) é da escola.

## Importar alunos por planilha

Em **Cadastrar Aluno**, o cartão "Importar vários alunos de uma planilha" cadastra uma turma inteira de uma vez:

1. Baixe o modelo (CSV) e preencha uma linha por aluno: Nome, Turma, Matrícula, Responsável, Parentesco, Telefone (e, se quiser, Responsável 2). Só **Nome** e **Turma** são obrigatórios; a turma pode vir do campo "Turma para todos os alunos".
2. Escolha o arquivo (**CSV** ou **Excel .xlsx**, até 500 alunos e 2 MB). O sistema **confere tudo antes de gravar** e mostra, linha por linha, o que está pronto, com erro ou já cadastrado.
3. Confirme. Só entram as linhas prontas, e a gravação é **tudo ou nada**.

Detalhes: aceita CSV com `;`, `,` ou tabulação e acentos em UTF-8 ou Windows-1252 (o "CSV" do Excel em português); lê a primeira aba do Excel; ignora colunas que não conhece; enviar a mesma planilha duas vezes não duplica alunos; irmãos com o mesmo responsável (nome e telefone) compartilham um único cadastro de responsável; textos que começam com `=`, `+`, `-` ou `@` são recusados (proteção contra fórmulas). A planilha não fica guardada no servidor. Excel antigo (`.xls`) não é lido: salve como `.xlsx` ou CSV. **Para ler Excel é preciso rodar `npm install`** (nova dependência: `read-excel-file`); o CSV funciona sem ela.

## Alinhamento com o ECA

O que o sistema faz para apoiar a escola nos deveres do Estatuto da Criança e do Adolescente (Lei 8.069/1990):

| Norma | O que pede | O que o S.I.V.E. faz |
|---|---|---|
| ECA, arts. 13 e 245 | Suspeita ou confirmação de maus-tratos deve ser comunicada ao Conselho Tutelar; deixar de comunicar é infração administrativa | Tela **Proteção**: professor ou gestão registra o caso, a Central do Dia alerta enquanto houver comunicação pendente, e a gestão registra a data e o protocolo da comunicação |
| ECA, art. 56, I e II | O dirigente comunica maus-tratos e faltas reiteradas ou evasão, **esgotados os recursos escolares** | Na Busca Ativa, o botão "Comunicar ao Conselho Tutelar" exige confirmar que os recursos foram esgotados e ao menos uma ação de acompanhamento registrada; o histórico do acompanhamento vira as "medidas adotadas" |
| LDB, art. 12, VIII (Lei 13.803/2019) | Notificar o Conselho Tutelar a relação dos alunos com faltas acima de 30% do percentual permitido | Tabela "Alunos acima do limite de faltas": 30% de 25% = 7,5% das aulas com chamada registrada (valor ajustável em `LIMITE_FALTAS_CT`, no `server.js`) |
| ECA, arts. 17 e 18 | Preservar imagem, identidade e intimidade; evitar exposição vexatória ou constrangedora | Comunicados para várias famílias **pedem confirmação ao citar o nome completo de um aluno**; termo de consentimento para imagem; lembretes de linguagem nas ocorrências; a política de privacidade fixa que câmeras só ficam em áreas comuns |
| ECA, art. 100, parágrafo único, V | Respeito à intimidade, à imagem e à reserva da vida privada | Acesso por perfil, documentos criptografados, registros de proteção **sigilosos** (nunca aparecem para responsáveis nem para outros professores) e todo acesso nos logs |

**Sigilo dos registros de proteção:** só a gestão vê todos; o professor vê apenas os que ele registrou; o responsável nunca vê (a suspeita pode envolver a própria família). Os fatos descritos nunca vão para os logs, para a ficha do aluno nem para a exportação de dados. Nada é apagado.

**ECA Digital (Lei 15.211/2025):** vale para produtos e serviços direcionados a crianças e adolescentes ou de "acesso provável" por eles. O S.I.V.E. é usado por adultos (gestão, professores e responsáveis), então a obrigação direta provavelmente não se aplica; o projeto segue os princípios de melhor interesse, privacidade e segurança por padrão. Vale confirmar com o jurídico da escola.

**O que depende da escola:** o sistema registra e lembra, mas **não envia nada ao Conselho Tutelar**: a gestão comunica pelo canal oficial (ofício, protocolo) e registra aqui. Também cabe à escola definir protocolos internos, treinar a equipe, adotar a regra de câmeras da política e validar a regra de faltas com a sua rede de ensino. Este material apoia o cumprimento da lei e não substitui parecer jurídico.

## Identidade visual

Todas as cores ficam como variáveis no início de `css/style.css` (`:root`). Para trocar uma cor, mude só ali.

| Cor | Código | Uso |
|---|---|---|
| Creme | `#FFF2EB` | Fundo das telas |
| Índigo | `#140040` | Menu lateral e textos |
| Azul | `#0B78B3` | A ação: botões e item ativo do menu |
| Tijolo | `#68150A` | Perigo, alertas e a tela Proteção |

Tons derivados (estados e bordas): azul-escuro `#085C8A` (texto azul e hover), azul-suave `#DCEEF8`, tijolo-suave `#F4DAD3`, borda `#EAD6CA`, fundo-suave `#F9E6DB`, texto secundário `#5B5278`, verde `#17624A` / `#D9F0E6` (sucesso) e âmbar `#7C4A03` / `#FBE7C4` (aviso).

Regras: creme para fundos, índigo para menu e textos, azul só para a ação, tijolo só para perigo e alertas. O azul puro como texto pequeno sobre o creme tem 4,4:1 de contraste (abaixo de 4,5), então o texto azul usa o azul-escuro. Tijolo e índigo são parecidos em luminosidade (1,5:1): nunca um sobre o outro.

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
