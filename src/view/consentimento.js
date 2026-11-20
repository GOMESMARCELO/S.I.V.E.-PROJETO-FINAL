// View: texto do Termo de Consentimento dos responsáveis.
const { escola } = require("./politica");

// ---------- Termo de consentimento dos responsáveis: uso de imagem e informações do aluno (LGPD, art. 14, §1º) ----------
// O responsável escolhe cada item separadamente. Cada assinatura, alteração ou revogação grava uma NOVA linha (histórico preservado).
// Vale a mais recente da versão atual do texto. Se o texto mudar de versão, o consentimento volta a ficar pendente.
const CONSENTIMENTO = {
  versao: "1.0", atualizado_em: "15/10/2026", // ajuste só de redação não muda a versão (a versão nova faz todos assinarem de novo)
  titulo: "Termo de Consentimento dos Responsáveis — uso de imagem e informações do aluno",
  secoes: [
    { titulo: "1. O que é este termo", paragrafos: [
      `${escola.nome} pede a sua autorização, como pai, mãe ou responsável legal, para usar as informações e as imagens do aluno no sistema S.I.V.E. (LGPD, art. 14, §1º).`,
      "Você decide cada item separadamente, não precisa autorizar tudo e pode mudar de ideia quando quiser."] },
    { titulo: "2. Informações do aluno", itens: [
      "Quais: nome, turma, matrícula, frequência, ocorrências, pendências, comunicados, autorizações e documentos anexados.",
      "Para quê: gestão escolar, acompanhamento da frequência (Busca Ativa), comunicação com a família e segurança do aluno.",
      "Quem acessa: a gestão da escola, o professor da turma e os responsáveis do aluno."] },
    { titulo: "3. Imagens do aluno no sistema", paragrafos: ["Fotos do aluno anexadas ao sistema, como fotos de identificação e documentos com foto. Só quem tem acesso à ficha do aluno pode vê-las."] },
    { titulo: "4. Câmeras de segurança e reconhecimento facial", paragrafos: [
      "Captação de imagens do aluno por câmeras da escola, para controle de entrada e saída e para segurança. Este recurso só funciona se a escola o ativar.",
      "O reconhecimento facial usa dados biométricos, que são dados pessoais sensíveis (LGPD, art. 11). Ele só pode ser usado com a autorização deste item."] },
    { titulo: "5. O que o sistema não faz", itens: [
      "Não vende nem compartilha as informações e as imagens com terceiros.",
      "Não usa as informações e as imagens para publicidade.",
      "Não divulga imagens do aluno em redes sociais ou sites."] },
    { titulo: "6. Por quanto tempo vale", paragrafos: ["A autorização vale enquanto o aluno estiver matriculado, ou até você alterá-la ou revogá-la."] },
    { titulo: "7. Como alterar ou revogar", paragrafos: [
      "Pelo Portal da Família, a qualquer momento, no cartão \"Consentimento\". A revogação vale daqui para a frente: o que já foi feito com a autorização anterior continua válido (LGPD, art. 8º, §5º).",
      "O histórico das suas decisões continua guardado, para comprovar o que foi autorizado em cada época."] },
    { titulo: "8. Seus direitos", paragrafos: ["Veja a Política de Privacidade para conhecer os seus direitos (LGPD, art. 18) e o contato do encarregado de dados."] },
  ],
  opcoes: [
    { id: "informacoes", curto: "Informações do aluno no sistema", rotulo: "Autorizo o tratamento das informações do aluno no sistema S.I.V.E.", detalhe: "Nome, turma, matrícula, frequência, ocorrências, pendências, comunicados, autorizações e documentos." },
    { id: "imagem", curto: "Imagens (fotos) do aluno no sistema", rotulo: "Autorizo o uso de imagens (fotos) do aluno no sistema S.I.V.E.", detalhe: "Fotos de identificação e documentos com foto anexados à ficha." },
    { id: "monitoramento", curto: "Câmeras de segurança e reconhecimento facial", rotulo: "Autorizo a captação de imagens do aluno por câmeras de segurança e, se a escola ativar, o reconhecimento facial.", detalhe: "Dado biométrico é dado pessoal sensível (LGPD, art. 11). Este recurso só funciona se a escola o ativar.", sensivel: true },
  ],
};

module.exports = { CONSENTIMENTO };
