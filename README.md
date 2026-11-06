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
| eventos | EVE | cameras | CAM |
| reconhecimentos | REC | configuracoes | CFG |
| assinaturas | ASS | escolas_interessadas | ESI |

Exemplo: `alunos` tem `alu_id`, `alu_nome`, `alu_sala`, `alu_matricula`. A API continua devolvendo os mesmos campos de antes (`id`, `nome`, `sala`...): o servidor traduz os nomes ao consultar o banco.

## Segurança e LGPD

O que o sistema faz hoje:

- **Documentos criptografados** no disco (AES-256-GCM), com nome aleatório, fora das pastas públicas. Se alguém alterar ou trocar um arquivo, ele deixa de abrir.
- **Controle de acesso por perfil** (gestão, professor da turma, responsável do próprio aluno) e **registro** de cada envio, download, exclusão e tentativa negada.
- **Login assinado** (não dá para forjar), com validade de 8 horas; o servidor confere no banco se o usuário continua ativo.
- **Senhas com hash** (scrypt), **regras de senha forte** (8+ caracteres, letras e números) e **bloqueio temporário** em três níveis (computador + usuário, conta e computador).
- **Verificação em duas etapas** (aplicativo autenticador, TOTP) obrigatória para a gestão; segredo guardado criptografado.
- **Sair encerra a sessão em todos os aparelhos**; trocar a senha encerra os outros aparelhos.
- **Logs encadeados por hash**: apagar ou alterar um registro aparece em Logs → Conferir integridade.
- **Backups diários criptografados** (AES-256-GCM) e erros internos que não expõem detalhes do banco.
- **Política de privacidade** e **aceite registrado** (quem, quando, qual versão) no primeiro acesso; o responsável declara ser pai, mãe ou responsável legal (LGPD, art. 14, §1º).
- **Direito de acesso** (art. 18): botão "Baixar os dados do aluno" na ficha (gestão e responsável).
- **Termo de consentimento dos pais** (uso de imagem e informações do aluno, art. 14, §1º): o responsável escolhe item a item (informações, imagens no sistema, câmeras e reconhecimento facial), assina com nome completo e senha e recebe um comprovante com código. Pode alterar ou revogar quando quiser; cada decisão vira uma nova linha na tabela `consentimentos` (histórico preservado). A gestão acompanha quem já respondeu na tela **Consentimentos**, e a ficha do aluno mostra a situação. Se o texto do termo mudar de versão, o consentimento volta a ficar pendente.
- Cabeçalhos de segurança (CSP, nosniff, sem cache na API).

**Antes de usar de verdade:**

1. Preencha a seção `escola` do `config.json` (nome da escola, encarregado de dados, e-mail e prazo de guarda). Enquanto estiver entre colchetes, a política mostra os colchetes.
2. As chaves de segurança são criadas sozinhas no `config.json` na primeira vez. **Faça backup do `config.json` e da pasta `uploads/`**: sem a chave, os documentos não abrem. O servidor já faz um backup por dia em `backups/` (banco + `uploads/`; `npm run backup` faz um na hora), mas **copie a pasta `backups/` e o `config.json` para outro lugar**: backup no mesmo computador não protege contra defeito no disco.
3. Use HTTPS (por exemplo, atrás de um proxy como Nginx). O sistema em si roda em HTTP.

**O que ainda não está coberto** (fica como melhoria): o consentimento já bloqueia sozinho o reconhecimento facial (Fase 5), mas o uso de fotos fora do sistema continua sendo decisão da escola; excluir todos os dados de um aluno, apagar documentos automaticamente após o prazo de guarda, procedimento de incidente, HTTPS embutido, e guardar a chave dos arquivos separada dos arquivos (aqui ficam na mesma máquina). Este projeto aplica medidas técnicas; a validação jurídica (base legal, prazos, encarregado) é da escola.

## Importar alunos por planilha

Em **Cadastro de Aluno**, o cartão "Importar vários alunos de uma planilha" cadastra uma turma inteira de uma vez:

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

## Fase 4 — calendário, perfil do responsável e reativação de professores

**Calendário de eventos com banners** (menu "Calendário", para os três perfis)
- Visão do mês, com os eventos de cada dia coloridos por tipo (Evento, Reunião, Passeio, Feriado e Prazo), além da lista de próximos eventos.
- A gestão cria eventos para a escola toda ou para uma turma. O professor cria só para a própria turma. O responsável vê os eventos da escola e da turma do filho.
- Com a opção **"Mostrar como banner"**, o evento vira um carrossel no topo da Central do Dia, da Minha Turma e do Portal dos Pais até a data dele. A imagem do banner é opcional (PNG/JPG, até 2 MB) e fica **criptografada** como os documentos. Quem envia uma imagem precisa confirmar que ela não mostra alunos sem autorização (ECA, art. 17). Sem imagem, o banner usa as cores da paleta.

**Perfil do responsável** (menu "Meu perfil", só para responsáveis)
- O responsável atualiza o telefone principal, o telefone para recados, o e-mail e a forma de contato preferida (WhatsApp, ligação ou e-mail). A gestão e o professor veem os contatos atualizados na ficha do aluno.
- Também mostra o filho e os outros responsáveis, a situação do termo de consentimento, os últimos acessos à conta, a troca de senha e o botão "Baixar os dados" (LGPD).
- O nome não pode ser alterado por ali, porque é usado nas assinaturas digitais. A correção é feita na secretaria.

**Reativação de professores (60 dias sem acessar o AVA)**
- O professor que passa **60 dias** sem entrar no sistema tem o acesso **suspenso automaticamente**. A conferência roda ao ligar o servidor, de hora em hora e a cada tentativa de login.
- Se ele tentar entrar com a senha certa, vê o aviso e o **pedido de reativação chega à gestão** (alerta na Central do Dia e na tela Usuários).
- A gestão reativa com um clique. O sistema gera uma **senha provisória nova**, com troca obrigatória, e o prazo volta a contar.
- A partir de 50 dias sem acesso, o professor aparece em "perto do limite". Para mudar os números, edite `INATIVIDADE` no `server.js`.

## Fase 5 — câmeras, reconhecimento facial (simulados) e status ao vivo

> **Simulação:** nenhuma câmera de verdade está ligada ao sistema. A tela Monitoramento mostra "câmeras" animadas e botões que simulam a passagem de um aluno, para demonstrar as regras e os registros.
>
> **Vídeos das câmeras (04/11/2026):** cada câmera ligada mostra um vídeo de 10 s em loop (`assets/cameras/`): portão de entrada, portão de saída, pátio e refeitório. As cenas são **desenhadas por um script** (`ferramentas/gerar-videos-cameras.py`), não são filmagens: as pessoas aparecem de longe e sem rosto, com aparência de câmera de segurança. Uma câmera nova usa a cena do seu tipo (Entrada, Saída ou Área comum). Quem configurou o computador para "reduzir movimento" vê só a imagem parada.

**Monitoramento** (gestão)
- Painel com: alunos na escola agora, câmeras online, reconhecidos hoje e imagens descartadas.
- Liga e desliga o reconhecimento facial, liga e desliga cada câmera e cadastra câmeras novas. O sistema **recusa banheiro, vestiário, trocador** e outros espaços de intimidade.
- Botões **"Simular passagem"** (por câmera: aluno escolhido, sorteado ou visitante desconhecido) e **"Simular chegada de quem falta"** para a apresentação.
- "Passagens de hoje" ao vivo e "Situação dos alunos agora" (na escola, saiu, não chegou, ausente), atualizadas a cada 5 segundos, com entrada e saída manuais pela portaria.
- A liberação de saída agora mostra se o aluno está na escola e registra quem liberou.

**Regras do reconhecimento facial** (dado biométrico é dado sensível: LGPD, art. 11)
1. Só funciona se a gestão **ligar** o recurso.
2. Só nos **portões** de entrada e saída. Câmeras de área comum só gravam.
3. Só para turmas **a partir do Pré**. Berçário, maternal e creche ficam de fora (regra `TURMAS_ANTES_DO_PRE` no `server.js`).
4. Só para alunos cujo responsável marcou **"câmeras e reconhecimento facial"** no Termo de Consentimento. Se ele revogar, o reconhecimento para **na hora**.
5. Quem não cumpre as regras **não tem cadastro facial**. A câmera não identifica a pessoa, a imagem é descartada e o registro fica sem nome de aluno.
6. O sistema **não guarda fotos nem biometria**, só o horário, a câmera e a confiança. As passagens são **apagadas depois de 90 dias** (`RETENCAO_RECONHECIMENTOS_DIAS`).
7. A primeira entrada do dia marca a presença, se o professor ainda não fez a chamada.

**Status ao vivo**
- Portal dos Pais: o cartão "Status agora" mostra se o filho está na escola, desde que horas, por qual portão e como entrou (reconhecimento ou portaria). Atualiza sozinho a cada 30 segundos. O responsável **nunca vê as câmeras**.
- Minha Turma (professor) ganhou a coluna "Agora". A ficha do aluno também mostra a situação.
- O arquivo "Baixar os dados do aluno" (LGPD) passou a incluir as entradas, as saídas e as passagens pelas câmeras.

**Roteiro sugerido para a apresentação**
1. Entre como `mariana`, abra **Monitoramento** e clique em **"Simular chegada de quem falta"**. A Beatriz é reconhecida (o pai autorizou) e o Theo é barrado, porque o Maternal fica fora da regra do Pré.
2. Tente simular o João no Portão de saída. Ele não tem cadastro facial (termo pendente).
3. Entre como `anapaula` e autorize "câmeras e reconhecimento facial" no termo.
4. Volte como `mariana` e simule o João de novo: agora ele é reconhecido. No Portal dos Pais, a mãe vê "Saiu às ...".
5. Tente entrar como `roberto` (60 dias sem acesso). Em seguida, como `mariana`, reative-o em **Usuários**.

## Melhorias de experiência do usuário (02/11/2026)

Avaliação de UX feita tela por tela, nos três perfis, e aplicada no sistema. O que mudou para cada pessoa:

**Responsável (Portal dos Pais)**
- O topo mostra primeiro o **Status agora** do filho e o bloco **"Precisa da sua atenção"**: autorizações para assinar, ocorrências esperando a ciência, documentos pedidos pela escola, comunicados não lidos e o termo de consentimento. Cada item tem o botão que leva direto até lá. O banner fica logo abaixo e é mais baixo.
- **Sino de avisos** no topo: entradas e saídas do filho, autorizações, comunicados, ocorrências, documentos pedidos e eventos dos próximos 3 dias. Mostra quantos avisos são novos desde a última vez que o sino foi aberto e confere sozinho a cada minuto. Com permissão, o navegador avisa quando chega algo novo e o sistema está aberto em outra aba.
- **Assinar ficou mais simples**: em autorizações e no termo de consentimento, basta marcar "Li e autorizo" e confirmar com a senha. O nome vem do cadastro de quem está logado e não precisa mais ser digitado.
- **Autorização com prazo**: a gestão define o último dia para assinar. Depois dele, a autorização aparece como "Prazo encerrado" e não pode mais ser assinada.

**Professor (Minha Turma)**
- A **chamada vem primeiro**. No celular, cada aluno é um cartão com botões grandes de Presente e Ausente, e o botão Salvar fica fixo no fim da tela.
- **Ninguém vem marcado por padrão**: só quem passou pelo portão hoje já vem como Presente, com a origem à vista ("entrou 07:31 • câmera"). Um contador mostra presentes, ausentes e quantos faltam marcar, e o botão "Marcar os restantes como presentes" agiliza. O sistema não salva enquanto faltar alguém.

**Gestão**
- **Menu em grupos**: Dia a dia, Acompanhamento, Comunicação e Administração. "Cadastro de Aluno" virou **"Alunos e turmas"** e "Logs" virou **"Registro de atividades"**.
- **Números honestos**: a presença é calculada só sobre quem já tem registro, e o sistema mostra quantos alunos estão "sem registro". No fim de semana, os quadros mostram o último dia letivo.
- **Alunos e turmas**: uma lista só, com filtro por turma e busca pelo nome (antes, uma tabela inteira para cada turma).
- **Ações sensíveis** (desativar acesso, zerar duas etapas, mudar a situação do aluno, encerrar caso, excluir) ficam num menu "⋯" ou com a cor de perigo, e pedem confirmação explicando a consequência. A própria pessoa não vê "Desativar" na sua linha.
- **Busca Ativa**: o caso mostra o **contato da família**, com botões de ligar, WhatsApp e e-mail.
- **Registro de atividades** com nomes no lugar de "aluno id 5" e filtro por pessoa e texto. A troca acontece só na tela, então o texto gravado e a conferência de integridade não mudam.

**Para todos**
- **Busca rápida de aluno** no topo (gestão: todos os alunos; professor: a turma aberta). Atalho: tecla `/`.
- **Avisos na própria tela** no lugar das caixas do navegador (`alert`/`confirm`/`prompt`), e janela de confirmação com a identidade visual.
- **Indicador de conexão real** ("Conectado" / "Sem conexão") no lugar do selo "Sistema operacional", que ficava sempre verde.
- **Fontes DM Sans e Manrope** guardadas no próprio projeto (`assets/fonts/`, licença SIL OFL 1.1). Antes, o sistema aparecia em Arial.
- **Letras maiores**: os textos de apoio passaram de 12 px para 13 px. Também há foco visível para quem usa o teclado.

**Banco de dados:** duas colunas novas, sem apagar nada. `autorizacoes.aut_valida_ate` guarda o último dia para assinar, e `usuarios.usu_avisos_vistos_em` guarda quando a pessoa abriu o sino pela última vez. Quem já tem o banco atualizado até 31/10/2026 roda só `database/migracao-2026-11-02.sql`. A coluna calculada `aut_assinada` deixou de usar `STORED NOT NULL` (ficou só `STORED`), e com isso o `sive.sql` passou a rodar também no MariaDB do XAMPP.

## Ficha de cadastro para escolas interessadas (03/11/2026)

A página inicial ganhou o botão **"Quero o S.I.V.E. na minha escola"** (no destaque, no topo como "Para escolas", na chamada final e no rodapé). Ele abre uma janela com a ficha de cadastro, sem login. O endereço `/#contratar` abre a ficha direto, então dá para mandar esse link para outra escola.

**O que a ficha pede (simplificada em 05/11/2026):** nome da escola, cidade, UF, número aproximado de alunos, nome de quem pede, e-mail, telefone/WhatsApp e a caixa de concordância com o uso dos dados só para contato (LGPD). O botão de envio é **"Solicitar orçamento"**. CNPJ, endereço, rede, etapas e cargo são combinados depois, na conversa com a equipe; os pedidos antigos continuam com esses dados.

**O que acontece ao enviar**
- A escola recebe um protocolo na hora (ex.: `SIVE-2026-00001`).
- Se a mesma pessoa (mesmo e-mail) pedir de novo para a mesma escola em até 30 dias, recebe o mesmo protocolo e não cria um pedido repetido.

**Proteções contra abuso:** limite de 5 envios por minuto por computador e um campo escondido que só robôs preenchem.

**Onde ficam os pedidos:** na tabela nova `escolas_interessadas` (sigla ESI). Ela não aparece no painel da escola, porque é o cadastro comercial da empresa S.I.V.E. A equipe consulta pelo terminal:

```
npm run escolas                                   # pedidos em aberto
npm run escolas -- --todos                        # todos
npm run escolas -- --csv                          # gera escolas-interessadas.csv (abre no Excel)
npm run escolas -- --status SIVE-2026-00001 em_contato   # novo, em_contato, contratou ou desistiu
```

Banco já existente: rode `database/migracao-2026-11-03.sql` (só cria a tabela nova, não mexe em nada).

## Tutorial do primeiro acesso (04/11/2026)

Na primeira vez que a pessoa entra, depois da troca de senha e dos termos, um tour guiado apresenta o sistema. Cada passo escurece a tela e destaca um elemento real, com um texto curto ao lado.

- **Um tour para cada perfil:** a gestão conhece as telas principais, o professor aprende a fazer a chamada e o responsável vê o Status agora, o "Precisa da sua atenção" e o sino. Os passos ficam em `PASSOS_TUTORIAL`, no `js/app.js`.
- **Pular:** o botão "Pular tutorial" aparece em todos os passos, menos no último. A tecla Esc faz o mesmo.
- **Aparece uma vez por pessoa:** quem conclui ou pula não vê de novo, em nenhum aparelho (`usuarios.usu_tutorial_visto_em`). Quem fecha o navegador no meio vê de novo no próximo acesso.
- **Rever:** o botão de ajuda (?), no fim do menu, abre o tour quando a pessoa quiser.
- **Celular:** o menu abre sozinho nos passos que apontam para ele. Passos de algo que a pessoa não tem (por exemplo, trocar de filho com um filho só) saem do tour.

**Banco de dados:** uma coluna nova, sem apagar nada. Quem já tem o banco atualizado até 03/11/2026 roda só `database/migracao-2026-11-04.sql`. Sem ela, o login não funciona. Quem já usa o sistema também vê o tutorial uma vez.

## Acessibilidade e Libras (04/11/2026)

**VLibras** (tradutor de Libras do governo federal, [vlibras.gov.br](https://vlibras.gov.br))
- O botão aparece em todas as páginas, menos na tela Proteção. O avatar traduz o texto em que a pessoa clica.
- Basta o script `vlibras-plugin.js`, carregado no fim do `index.html`. Ele só desenha o botão: o avatar é baixado quando a pessoa clica. Se o serviço do governo cair, o sistema continua funcionando, só sem o botão.
- A CSP do `server.js` libera apenas os endereços usados: `vlibras.gov.br`, a pasta oficial do projeto no jsDelivr e `traducao2.vlibras.gov.br`.
- **Privacidade:** o texto clicado é enviado ao servidor de tradução do governo. Nada é enviado antes de a pessoa ativar o avatar e clicar. Na tela **Proteção**, que é sigilosa, o botão some, o avatar fecha e o pedido de tradução é barrado (`ajustarVLibras`, no `js/app.js`).

**HTML5 semântico**
- Marcos da página (`header`, `nav`, `main`, `footer`), um `main` por tela e hierarquia de títulos `h1` > `h2` > `h3`.
- Link "Pular para o conteúdo" (primeira tecla Tab) e botão "Pausar animações" na página inicial.
- Campos com rótulo de verdade (`label`), erros anunciados pelo leitor de tela (`role="alert"`), título da aba muda a cada tela e o foco vai para o conteúdo ao trocar de tela.
- Conferido com axe-core (WCAG 2.2 A e AA) nas páginas públicas e nas telas internas dos três perfis, e com o validador do W3C. O único aviso restante do axe vem do botão do próprio VLibras.

## Recuperação de senha e login (05/11/2026)

**Banco de dados:** rode, nesta ordem, `database/migracao-2026-11-05.sql`, `database/migracao-2026-11-05-email.sql` e `database/migracao-2026-11-05-2fa.sql`, **antes** de reiniciar o servidor.

- **Esqueci minha senha:** a pessoa informa o usuário e recebe no e-mail um link de uso único, válido por 30 minutos, para criar a senha nova. Ao salvar, os logins abertos são encerrados.
- **Quem não tem e-mail** (ou se o envio falhar): o pedido aparece para a gestão na Central do Dia e em **Usuários**. A gestão confirma quem pediu e usa **Gerar senha nova**.
- **De onde vem o e-mail:** o campo E-mail da conta, em **Usuários** (cadastro ou menu "⋯"). Para responsáveis, vale também o e-mail do perfil.
- A resposta da tela é sempre a mesma, exista ou não o usuário. Limite de 5 pedidos por minuto por computador e um link a cada 2 minutos por conta. O banco guarda só o hash do código.
- A verificação em duas etapas continua valendo depois da senha nova.
- **Envio de verdade:** sem configuração, o envio é **simulado** e o link aparece só no terminal do servidor. Para ligar, rode `npm install`, preencha `email` no `config.json` (modelo em `config.example.json`): `modo: "smtp"`, `url_base` (endereço público do sistema, com https), `remetente` e os dados de `smtp` do serviço escolhido. Reinicie o servidor.
- **Olhinho:** os campos de senha do login e da troca de senha têm um botão para mostrar o que foi digitado; a senha volta a ficar escondida ao enviar.
- **Validando senha:** ao entrar, o botão mostra uma animação (parada para quem desliga o movimento) e o leitor de tela anuncia "Validando senha".

## Verificação em duas etapas: três opções (05/11/2026)

Ao configurar a verificação, a gestão escolhe entre **Google Authenticator** (recomendado), **e-mail** ou **SMS/WhatsApp**. Nas duas últimas, o código tem 6 números, vale 10 minutos e funciona uma vez; o banco guarda só um HMAC dele.

- O e-mail usa a mesma configuração da recuperação de senha.
- **SMS e WhatsApp estão simulados:** o código aparece só no terminal do servidor, e a tela avisa isso. Para ligar de verdade, é preciso contratar um fornecedor e colocar a chamada em `enviarMensagemTelefone`, no `email.js`.
- Para mudar de método, outra pessoa da gestão usa **Zerar duas etapas** em Usuários.

## Página Quem Somos (05/11/2026)

O bloco "O que é o S.I.V.E." saiu da home e virou a página `#quem-somos`, com as dores e os objetivos do projeto, baseados no documento de planejamento (Entrega Parcial 1).

## Leitura em voz alta no jeito do NVDA (05/11/2026)

A leitura do Painel de Acessibilidade lê na hora o que está sob o mouse ou com o foco (tecla Tab), interrompe a fala anterior e diz o tipo do elemento ("botão", "link", "caixa de seleção, marcada"). A tecla **Ctrl** interrompe. O texto vai em trechos curtos, em velocidade 1,4.

O que foi digitado nos campos nunca é lido. A voz continua sendo só a instalada no aparelho, e a tela Proteção continua sem leitura. Isso não substitui o NVDA de verdade: quem usa leitor de tela continua usando o próprio programa.

## Depoimentos da home (05/11/2026)

A seção **Depoimentos** traz exemplos ilustrativos, com pessoas e retratos fictícios (`assets/depoimentos/`), e um aviso visível dizendo isso. Para usar depoimentos reais: peça autorização de cada pessoa, troque nome, texto e foto no `index.html` e retire o aviso `.lp-depoimentos-aviso`. Não retire o aviso enquanto os textos forem fictícios.

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
ficha do aluno, comunicados, documentos anexados, autorizações digitais com assinatura (Fases 1 a 3),
calendário com banners, perfil do responsável, reativação de professores (Fase 4), câmeras e reconhecimento
facial simulados e status do aluno ao vivo (Fase 5).

## Login
Administração (vê tudo, cadastra alunos e usuários): `mariana` / `123456`
Responsável (vê só o próprio filho): `anapaula` / `123456`
Professor(a) (vê só a própria turma): `patricia` / `123456`

Outros usuários de demonstração (senha `123456`):
- `claudia`: mãe da Ana Clara (já autorizou o reconhecimento facial)
- `marcos`: pai da Beatriz (já autorizou o reconhecimento facial)
- `roberto`: professor há 75 dias sem acessar (é suspenso automaticamente; reative em Usuários)
- `fernanda`: professora há 53 dias sem acessar (aparece em "perto do limite")

Os dados de exemplo também trazem uma autorização no prazo (passeio) e uma vencida (zoológico), além dos responsáveis de Lucas e Marina, para o contato da família aparecer na Busca Ativa.

## Rotas da API
Veja `API.md`.
