// View: texto da Política de Privacidade (LGPD) mostrado no sistema.
const { config } = require("../../config");

// ---------- Política de privacidade (LGPD) ----------
// Os dados da escola ficam no .env (ESCOLA_NOME, ESCOLA_ENCARREGADO_NOME, ESCOLA_ENCARREGADO_EMAIL e ESCOLA_PRAZO_RETENCAO). Enquanto não forem preenchidos, aparecem entre colchetes.
const escola = Object.assign({
  nome: "[Nome da escola — preencher ESCOLA_NOME no .env]", encarregado_nome: "[Nome do encarregado]",
  encarregado_email: "[e-mail do encarregado]", prazo_retencao: "[prazo definido pela escola]",
}, config.escola || {});
const POLITICA = {
  versao: "1.3", atualizada_em: "11/11/2026", // 1.3: texto mais claro e exceção da lei no compartilhamento (todos aceitam de novo no próximo login)
  secoes: [
    { titulo: "1. Quem cuida dos seus dados", paragrafos: [`O controlador dos dados é ${escola.nome}.`,
      `Encarregado pelo tratamento de dados pessoais (art. 41 da LGPD): ${escola.encarregado_nome} — ${escola.encarregado_email}.`] },
    { titulo: "2. Quais dados são tratados", itens: [
      "Do aluno: nome, turma, matrícula, frequência, ocorrências, pendências e documentos anexados (que podem incluir dados de saúde e de identificação).",
      "Do responsável: nome, telefones, e-mail, forma de contato preferida, foto, usuário de acesso e senha (guardada de forma protegida).",
      "De quem usa o sistema: registros de acesso e das ações realizadas (quem fez o quê e quando).",
      "Entradas e saídas do aluno na escola (horário, portão e se foi pela portaria ou pelo reconhecimento facial)."] },
    { titulo: "3. Para que usamos", paragrafos: ["Gestão escolar, acompanhamento da frequência (incluindo a Busca Ativa de alunos com muitas faltas), comunicação com as famílias, autorizações e segurança dos alunos. Os dados não são usados para publicidade e não são compartilhados com terceiros, exceto quando a lei obriga, como na comunicação ao Conselho Tutelar (item 5)."] },
    { titulo: "4. Dados de crianças e adolescentes", paragrafos: [
      "O tratamento é feito no melhor interesse da criança e do adolescente (art. 14 da LGPD).",
      "Para dados de crianças, a LGPD pede o consentimento específico e em destaque de pelo menos um dos pais ou do responsável legal (art. 14, §1º). Ao aceitar este termo, o responsável declara que é pai, mãe ou responsável legal do aluno e consente com o tratamento descrito aqui.",
      "Além deste termo, o responsável assina, para cada aluno, o Termo de Consentimento sobre o uso de imagem e informações, que pode ser alterado ou revogado a qualquer momento.",
      "Documentos de saúde são dados pessoais sensíveis (arts. 5º, II, e 11) e só são vistos por quem precisa deles para a sua função."] },
    { titulo: "5. Proteção da criança (ECA)", paragrafos: [
      "A escola tem o dever legal de proteger crianças e adolescentes (ECA, Lei 8.069/1990). Por isso, em alguns casos precisa comunicar o Conselho Tutelar, e essa comunicação não depende de consentimento."],
      itens: [
      "Suspeita ou confirmação de maus-tratos: a comunicação ao Conselho Tutelar é obrigatória (ECA, arts. 13 e 56, I).",
      "Faltas reiteradas e evasão escolar, depois de esgotados os recursos da escola (ECA, art. 56, II; LDB, art. 12, VIII).",
      "Esses registros são sigilosos: ficam restritos à gestão e a quem os registrou, não aparecem para os responsáveis nem para outros professores, e cada consulta é registrada.",
      "A escola respeita a imagem e a intimidade do aluno (ECA, art. 17): comunicados para várias famílias não devem citar nomes de alunos, e câmeras de segurança só podem ser usadas em áreas comuns, nunca em banheiros, vestiários ou outros espaços de intimidade."] },
    { titulo: "6. Como protegemos os dados e os arquivos", itens: [
      "Os documentos ficam guardados com criptografia e fora das áreas públicas do site.",
      "Cada perfil acessa só o que precisa: a gestão vê todos os alunos, o professor vê a sua turma e o responsável vê apenas o seu filho.",
      "Envios, downloads e exclusões de documentos ficam registrados (quem, o quê e quando), inclusive as tentativas de acesso negadas.",
      "As senhas ficam guardadas de forma protegida, o acesso expira depois de um tempo e há bloqueio temporário após várias tentativas erradas.",
      "O sistema confere o formato e o tamanho dos arquivos enviados (PDF, PNG, JPG, DOC e DOCX, até 5 MB).",
      "Reconhecimento facial: só funciona se a escola ativar, só para turmas a partir do Pré e só para alunos cujo responsável autorizou no Termo de Consentimento. Sem essa autorização, a câmera não identifica o aluno e a imagem é descartada. O sistema não guarda fotos nem dados biométricos, apenas o horário e o portão da passagem.",
      "Câmeras só ficam em áreas comuns. As imagens das câmeras não aparecem para os responsáveis."] },
    { titulo: "7. Por quanto tempo guardamos", paragrafos: [`Os dados ficam guardados enquanto o aluno estiver matriculado e, depois, pelo prazo exigido pela legislação ou definido pela escola: ${escola.prazo_retencao}. A gestão pode excluir documentos que não forem mais necessários. Os registros de passagem pelas câmeras são apagados automaticamente depois de 90 dias.`] },
    { titulo: "8. Seus direitos (art. 18 da LGPD)", paragrafos: [
      "Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento e revogação do consentimento.",
      "Para acessar os dados do aluno, use o botão \"Baixar os dados do aluno\" na ficha dele. Os demais pedidos devem ser feitos ao encarregado, pelo contato do item 1."] },
    { titulo: "9. Incidentes de segurança", paragrafos: ["Se houver um incidente de segurança que possa causar risco ou dano relevante, a escola comunica a ANPD e as pessoas afetadas (art. 48 da LGPD)."] },
    { titulo: "10. Para quem trabalha na escola", paragrafos: ["Os dados a que você tem acesso são confidenciais: use-os somente para a sua função, não compartilhe sua senha e lembre que os acessos ficam registrados."] },
  ],
};

module.exports = { escola, POLITICA };
