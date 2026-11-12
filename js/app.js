// S.I.V.E. — versão em HTML, CSS e JavaScript puro
let dados = {};
let tela = "";
let liberada = false;
let timerTela = null;   // atualização automática da tela aberta (monitoramento, status ao vivo)
let timerBanner = null; // troca automática dos banners
let timerAvisos = null; // confere os avisos (sino) do responsável de tempos em tempos
let avisosConhecidos = -1; // quantos avisos novos havia na última conferência (para avisar no navegador só quando aumentar)
let buscaAlunos = null; // alunos da busca rápida do topo (carregados na primeira busca)
let usuarioLogado = null; // { token, papel, nome, aluno_id, sala, senha_temporaria }
let forcarTrocaSenha = false;
let origemTermo = "login"; // de onde a pessoa abriu a política, para o botão "Voltar"
let consentPuladoNaSessao = false; // o responsável escolheu "Responder depois" nesta sessão
// (declaradas aqui no topo porque o código que restaura o login ao recarregar a página roda antes do resto do arquivo)
const statusConsent = { autorizado: ["Autorizado", "success"], parcial: ["Autorizado em parte", "warning"], nao_autorizado: ["Não autorizado", "danger"], pendente: ["Pendente", "warning"] };
const sinal = (v) => (v ? ico("confere", "ok") : ico("proibido", "nao"));
const cacheBanner = new Map(); // imagens dos banners já baixadas (id do evento -> endereço na memória)

// Chama a API do servidor Node e devolve o JSON, já enviando o login (token)
// Responsável com vários filhos / professor com várias turmas: avisa o servidor qual está aberto (seletor no topo da tela)
function cabecalhoContexto() {
  if (usuarioLogado.papel === "pai" && usuarioLogado.aluno_id) return { "X-Aluno": String(usuarioLogado.aluno_id) };
  if (usuarioLogado.papel === "professor" && usuarioLogado.sala) return { "X-Turma": encodeURIComponent(usuarioLogado.sala) };
  return {};
}
async function api(url, opcoes = {}) {
  let resposta;
  try {
    resposta = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(usuarioLogado ? { Authorization: "Bearer " + usuarioLogado.token, ...cabecalhoContexto() } : {}) },
      ...opcoes,
    });
  } catch {
    marcarConexao(false); // o servidor não respondeu (sem internet ou servidor desligado)
    throw new Error("Sem conexão. Confira a internet e tente de novo.");
  }
  marcarConexao(true);
  if (resposta.status === 401 || resposta.status === 403) {
    const corpo = await resposta.json().catch(() => ({}));
    if (resposta.status === 401) { sair(); throw new Error("Sessão expirada"); }
    if (corpo.codigo === "ACEITE_PENDENTE") { usuarioLogado.aceite_ok = false; mostrarTermo("aceitar"); throw new Error("Aceite pendente"); }
    if (corpo.codigo === "2FA_PENDENTE") { usuarioLogado.configurar_2fa = true; mostrarTela2fa(); throw new Error("Aceite pendente"); }
    throw new Error(corpo.erro || "Acesso negado");
  }
  if (!resposta.ok) { const corpo = await resposta.json().catch(() => ({})); throw Object.assign(new Error(corpo.erro || "Não foi possível concluir agora. Tente de novo."), { codigo: corpo.codigo, alunos: corpo.alunos }); }
  return resposta.json();
}
// Usado nos botões: se a API der erro, avisa na tela em vez de falhar em silêncio
const seguro = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { if (e.message !== "Sessão expirada" && e.message !== "Aceite pendente") avisar(e.message, "danger"); }
};

// ---------- Avisos rápidos (no canto da tela) e janela de confirmação ----------
// Substituem as caixas do navegador (alert/confirm/prompt), que assustam, não seguem a identidade visual e não explicam a consequência.
function avisar(texto, tom = "success", ms = 5000) {
  const caixa = document.getElementById("toasts"), t = document.createElement("div");
  t.className = `toast ${tom}`; t.setAttribute("role", tom === "danger" ? "alert" : "status");
  const msg = document.createElement("span"); msg.textContent = texto;
  const fechar = document.createElement("button"); fechar.type = "button"; fechar.className = "toast-fechar"; fechar.setAttribute("aria-label", "Fechar aviso"); fechar.textContent = "✕";
  const some = () => { t.classList.add("saindo"); setTimeout(() => t.remove(), 250); };
  fechar.onclick = some; t.append(msg, fechar); caixa.append(t);
  setTimeout(some, tom === "danger" ? ms * 1.6 : ms);
}
// confirmar({ titulo, texto, botao, perigo, campo: { rotulo, tipo: "texto"|"select", opcoes, valor, placeholder } }) -> Promise<false | { valor }>
function confirmar({ titulo, texto = "", botao = "Confirmar", perigo = false, campo = null }) {
  const $ = (id) => document.getElementById(id), modal = $("dialogo"), ok = $("dialogo-ok"), cancelar = $("dialogo-cancelar");
  $("dialogo-titulo").textContent = titulo; $("dialogo-texto").textContent = texto;
  const campos = $("dialogo-campos"); campos.replaceChildren();
  let entrada = null;
  if (campo) {
    const rotulo = document.createElement("small"); rotulo.textContent = campo.rotulo; campos.append(rotulo);
    if (campo.tipo === "select") {
      entrada = document.createElement("select");
      for (const o of campo.opcoes) { const op = document.createElement("option"); op.textContent = o; op.selected = o === campo.valor; entrada.append(op); }
    } else { entrada = document.createElement("textarea"); entrada.rows = 2; entrada.maxLength = 200; entrada.placeholder = campo.placeholder || ""; entrada.value = campo.valor || ""; }
    campos.append(entrada);
  }
  ok.textContent = botao; ok.classList.toggle("perigo", perigo);
  const voltarFoco = document.activeElement;
  modal.classList.remove("oculto"); (entrada || (perigo ? cancelar : ok)).focus();
  return new Promise((resolver) => {
    const fim = (r) => { modal.classList.add("oculto"); ok.onclick = cancelar.onclick = modal.onclick = modal.onkeydown = null; if (voltarFoco && voltarFoco.focus) voltarFoco.focus(); resolver(r); };
    ok.onclick = () => fim({ valor: entrada ? entrada.value : true });
    cancelar.onclick = () => fim(false);
    modal.onclick = (e) => { if (e.target === modal) fim(false); };
    modal.onkeydown = (e) => { if (e.key === "Escape") fim(false); };
  });
}
// ---------- Menus "⋯" (ações sensíveis): a lista flutua por cima da tela, para a tabela (que rola de lado) não cortar ----------
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches || !d.matches("details.menu-acoes") || !d.open) return;
  document.querySelectorAll("details.menu-acoes[open]").forEach((outro) => { if (outro !== d) outro.open = false; }); // um aberto por vez
  const lista = d.querySelector(".menu-acoes-lista"), r = d.querySelector("summary").getBoundingClientRect();
  lista.style.position = "fixed"; lista.style.right = `${Math.max(8, innerWidth - r.right)}px`; lista.style.left = "auto";
  const altura = lista.offsetHeight, cabeEmbaixo = r.bottom + altura + 8 < innerHeight;
  lista.style.top = `${cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - altura - 4)}px`;
}, true);
const fecharMenusAcoes = () => document.querySelectorAll("details.menu-acoes[open]").forEach((d) => { d.open = false; });
document.addEventListener("click", (e) => { if (!e.target.closest("details.menu-acoes")) fecharMenusAcoes(); });
addEventListener("scroll", fecharMenusAcoes, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharMenusAcoes(); });

// ---------- Indicador de conexão (no lugar do antigo "Sistema operacional", que ficava sempre verde) ----------
function marcarConexao(ok) {
  const el = document.getElementById("status-conexao"); if (!el) return;
  el.className = `pill ${ok ? "success" : "danger"}`;
  el.textContent = ok ? "● Conectado" : "● Sem conexão";
  el.title = ok ? `O sistema respondeu às ${new Date().toLocaleTimeString("pt-BR").slice(0, 5)}` : "O sistema não está respondendo. Os dados da tela podem estar desatualizados.";
}
addEventListener("offline", () => marcarConexao(false));
addEventListener("online", () => marcarConexao(true));

const menusPorPapel = {
  // A gestão tem muitas telas: o menu é dividido em grupos (o título do grupo aparece antes do primeiro item)
  admin: [
    { grupo: "Dia a dia", id: "secretaria", nome: "Central do Dia", dica: "Visão geral da escola", icone: "casa" },
    { grupo: "Dia a dia", id: "frequencia", nome: "Frequência", dica: "Presença e faltas", icone: "presenca" },
    { grupo: "Dia a dia", id: "seguranca", nome: "Monitoramento", dica: "Portões e câmeras", icone: "olho" },
    { grupo: "Acompanhamento", id: "busca", nome: "Busca Ativa", dica: "Faltas e acompanhamento", icone: "lupa" },
    { grupo: "Acompanhamento", id: "protecao", nome: "Proteção", dica: "Conselho Tutelar", icone: "escudo" },
    { grupo: "Acompanhamento", id: "relatorio", nome: "Relatório Mensal", dica: "Frequência e casos", icone: "grafico" },
    { grupo: "Comunicação", id: "comunicados", nome: "Comunicados", dica: "Avisos e leituras", icone: "megafone" },
    { grupo: "Comunicação", id: "calendario", nome: "Calendário", dica: "Eventos e banners", icone: "calendario" },
    { grupo: "Comunicação", id: "autorizacoes", nome: "Autorizações", dica: "Assinatura digital", icone: "caneta" },
    { grupo: "Comunicação", id: "consentimentos", nome: "Consentimentos", dica: "Imagem e informações", icone: "termo" },
    { grupo: "Administração", id: "cadastro", nome: "Alunos e turmas", dica: "Cadastro e turmas", icone: "novoAluno" },
    { grupo: "Administração", id: "usuarios", nome: "Usuários", dica: "Acessos ao sistema", icone: "cadeado" },
    { grupo: "Administração", id: "logs", nome: "Registro de atividades", dica: "Quem fez o quê", icone: "atividade" },
  ],
  pai: [
    { id: "pais", nome: "Portal da Família", dica: "Meu filho", icone: "familia" },
    { id: "ocorrencias", nome: "Ocorrências", dica: "Registros do docente", icone: "prancheta" },
    { id: "calendario", nome: "Calendário", dica: "Eventos da escola", icone: "calendario" },
    { id: "perfil", nome: "Meu perfil", dica: "Dados e contatos", icone: "pessoa" },
  ],
  professor: [
    { id: "turma", nome: "Minha Turma", dica: "Chamada e contatos", icone: "livro" },
    { id: "comunicados", nome: "Comunicados", dica: "Avisos da turma", icone: "megafone" },
    { id: "ocorrencias", nome: "Ocorrências", dica: "Registro e arquivo", icone: "prancheta" },
    { id: "calendario", nome: "Calendário", dica: "Eventos da turma", icone: "calendario" },
    { id: "protecao", nome: "Proteção", dica: "Registrar um caso", icone: "escudo" },
  ],
};
// Ícones do sistema (desenhados em traço, herdam a cor do texto). anim = animação ao passar o mouse e ao aparecer.
const ICONES = {
  casa: { anim: "pula", svg: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>' },
  novoAluno: { anim: "pulsa", svg: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>' },
  presenca: { anim: "pula", svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>' },
  olho: { anim: "pisca", svg: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  olhoFechado: { anim: "pisca", svg: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="m4 4 16 16"/>' },
  lupa: { anim: "procura", svg: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>' },
  escudo: { anim: "pulsa", svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 15.5s-3-1.8-3-3.8a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 2-3 3.8-3 3.8z"/>' },
  grafico: { anim: "pula", svg: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-3"/>' },
  megafone: { anim: "balanca", svg: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/><path d="M19.5 6.5a8 8 0 0 1 0 11"/>' },
  calendario: { anim: "balanca", svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>' },
  caneta: { anim: "escreve", svg: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  termo: { anim: "pula", svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>' },
  cadeado: { anim: "balanca", svg: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/>' },
  atividade: { anim: "pulsa", svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  familia: { anim: "pulsa", svg: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4.5-6.5"/>' },
  prancheta: { anim: "balanca", svg: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>' },
  pessoa: { anim: "pulsa", svg: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>' },
  livro: { anim: "pula", svg: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>' },
  confere: { anim: "pulsa", svg: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>' },
  visto: { anim: "pulsa", svg: '<path d="M20 6 9 17l-5-5"/>' },
  proibido: { anim: "balanca", svg: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>' },
  aviso: { anim: "balanca", svg: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>' },
  pasta: { anim: "pula", svg: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>' },
  baixar: { anim: "desce", svg: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>' },
  setaBaixo: { anim: "desce", svg: '<path d="M12 5v14M19 12l-7 7-7-7"/>' },
  setaCima: { anim: "pula", svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
  documento: { anim: "pula", svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>' },
  escudoOk: { anim: "pulsa", svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
  chave: { anim: "balanca", svg: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>' },
  local: { anim: "pula", svg: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>' },
  lixeira: { anim: "balanca", svg: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>' },
  cadeadoAberto: { anim: "balanca", svg: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>' },
  telefone: { anim: "balanca", svg: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>' },
  email: { anim: "pula", svg: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>' },
  impressora: { anim: "desce", svg: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>' },
  estrela: { anim: "gira", svg: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>' },
  onibus: { anim: "anda", svg: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 18v3M16 18v3M8 14.5h.01M16 14.5h.01"/>' },
  sol: { anim: "gira", svg: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
  relogio: { anim: "balanca", svg: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>' },
  play: { anim: "anda", svg: '<path d="m6 3 14 9-14 9z"/>' },
  escola: { anim: "pula", svg: '<path d="M2 21h20M4 21V10l8-6 8 6v11"/><path d="M9 21v-5h6v5M12 10h.01"/>' },
  camera: { anim: "balanca", svg: '<path d="m22 8-6 4 6 4z"/><rect x="2" y="6" width="14" height="12" rx="2"/>' },
  rosto: { anim: "pulsa", svg: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>' },
  semSinal: { anim: "pisca", svg: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.7M12 20h.01"/>' },
  foto: { anim: "pisca", svg: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>' },
  menu: { anim: "pula", svg: '<path d="M4 6h16M4 12h16M4 18h16"/>' },
  setaEsq: { anim: "anda", svg: '<path d="m15 18-6-6 6-6"/>' },
  setaDir: { anim: "anda", svg: '<path d="m9 18 6-6-6-6"/>' },
  externo: { anim: "procura", svg: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>' },
  sair: { anim: "anda", svg: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>' },
  ajuda: { anim: "balanca", svg: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>' },
  acessibilidade: { anim: "pulsa", svg: '<circle cx="12" cy="4.5" r="2"/><path d="M4 8.5c5 1.5 11 1.5 16 0"/><path d="M12 10v5"/><path d="m8 21 4-6 4 6"/>' },
  sino: { anim: "balanca", svg: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>' },
  mais: { anim: "pulsa", svg: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>' },
  mensagem: { anim: "pula", svg: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>' },
};
// <svg> com os atributos de traço no próprio elemento: funciona também nos comprovantes abertos em outra janela (sem o CSS do sistema)
const ico = (nome, extra = "") => { const i = ICONES[nome];
  return `<svg class="ico${extra ? " " + extra : ""}" data-anim="${i.anim}" viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.svg}</svg>`; };
const iconeMenu = (nome) => `<span class="nav-icone">${ico(nome)}</span>`;
// Ícones escritos direto no index.html (<span data-ico="nome">) são desenhados aqui
document.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
// O HTML5 só permite um <main> sem "hidden". Quem mostra e esconde as telas é a classe .oculto; o "hidden" acompanha ela
const sincronizarMain = () => document.querySelectorAll("main").forEach((m) => { m.hidden = !!m.closest(".oculto"); });
const observadorDeTelas = new MutationObserver(sincronizarMain);
["tela-login", "lp-home", "conteudo", "lp-quem-somos", "lp-entrar", "lp-verificar", "tela-senha", "tela-2fa", "tela-termo", "tela-consent", "app"].forEach((id) => observadorDeTelas.observe(document.getElementById(id), { attributes: true, attributeFilter: ["class"] }));
sincronizarMain();
// "Pular para o conteúdo": leva o foco ao <main> da tela que estiver aberta
document.getElementById("pular-conteudo").onclick = (e) => {
  e.preventDefault();
  const alvo = [...document.querySelectorAll("main")].find((m) => m.getClientRects().length);
  if (alvo) { alvo.tabIndex = -1; alvo.focus(); }
};
// Os formulários das telas usam <small> como rótulo: aqui cada campo sem nome é ligado ao texto que vem antes dele, para o leitor de tela anunciar
let proximoRotulo = 0;
function ligarRotulos() {
  document.querySelectorAll("small + input, small + select, small + textarea").forEach((campo) => {
    if (campo.labels.length || campo.hasAttribute("aria-label") || campo.hasAttribute("aria-labelledby")) return;
    const rotulo = campo.previousElementSibling;
    if (!rotulo.id) rotulo.id = `rotulo-${++proximoRotulo}`;
    campo.setAttribute("aria-labelledby", rotulo.id);
  });
}
["tela", "dialogo-campos"].forEach((id) => new MutationObserver(ligarRotulos).observe(document.getElementById(id), { childList: true, subtree: true }));

// ---------- Filtro "Turma → Aluno" ----------
// Todo <select data-filtro-turma> de aluno ganha, antes dele, um seletor de turma: primeiro escolhe a turma, depois o aluno
// (em ordem alfabética). As opções de aluno precisam de data-sala. Opções sem data-sala (ex.: "Escolha o aluno...") ficam sempre no topo.
const ordemTurma = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
const ordemNome = (a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" });
const opcoesAlunos = (alunos, salaPadrao = "") => [...alunos].sort(ordemNome)
  .map((a) => `<option value="${a.id}" data-sala="${esc(a.sala || salaPadrao)}">${esc(a.nome)}</option>`).join("");
const turmasDe = (alunos, salaPadrao = "") => [...new Set(alunos.map((a) => a.sala || salaPadrao).filter(Boolean))].sort(ordemTurma);
const valorNativoSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
function ligarFiltrosTurma() {
  document.querySelectorAll("select[data-filtro-turma]").forEach((sel) => {
    if (sel._filtro && !sel.querySelector("option:not([data-f])")) return; // já pronto e ninguém trocou as opções
    const lidas = [...sel.options];
    const topo = lidas.filter((o) => !o.hasAttribute("data-sala")).map((o) => ({ value: o.value, text: o.textContent }));
    const itens = lidas.filter((o) => o.hasAttribute("data-sala")).map((o) => ({ value: o.value, text: o.textContent, sala: o.dataset.sala }))
      .sort((a, b) => a.text.localeCompare(b.text, "pt-BR", { sensitivity: "base" }));
    const escolhido = itens.find((i) => i.value === valorNativoSelect.get.call(sel) && lidas.find((o) => o.value === i.value && o.selected && o.hasAttribute("selected")));
    const turmas = [...new Set(itens.map((i) => i.sala).filter(Boolean))].sort(ordemTurma);
    let turmaSel = sel._filtro ? sel._filtro.turmaSel : null;
    if (!turmaSel) {
      if (!sel.hasAttribute("aria-label") && !sel.hasAttribute("aria-labelledby") && sel.previousElementSibling && sel.previousElementSibling.tagName === "SMALL") {
        const r = sel.previousElementSibling; if (!r.id) r.id = `rotulo-${++proximoRotulo}`; sel.setAttribute("aria-labelledby", r.id);
      }
      const par = document.createElement("div"); par.className = "par-turma-aluno";
      turmaSel = document.createElement("select"); turmaSel.className = "filtro-turma"; turmaSel.setAttribute("aria-label", "Turma (escolha primeiro)");
      sel.before(par); par.append(turmaSel, sel);
      Object.defineProperty(sel, "value", { configurable: true, get() { return valorNativoSelect.get.call(this); },
        set(v) { const it = this._filtro && this._filtro.itens.find((i) => i.value === String(v));
          if (it && this._filtro.turmaSel.value !== it.sala) { this._filtro.turmaSel.value = it.sala; this._filtro.desenhar(); }
          valorNativoSelect.set.call(this, v); } });
      turmaSel.addEventListener("change", () => { sel._filtro.desenhar(); valorNativoSelect.set.call(sel, ""); sel.dispatchEvent(new Event("change", { bubbles: true })); if (turmaSel.value) sel.focus(); });
    }
    const anterior = turmaSel.value;
    turmaSel.innerHTML = `<option value="" data-f>Turma...</option>` + turmas.map((t) => `<option data-f>${esc(t)}</option>`).join("");
    turmaSel.value = turmas.includes(anterior) ? anterior : escolhido ? escolhido.sala : turmas.length === 1 ? turmas[0] : "";
    const desenhar = () => {
      const atual = valorNativoSelect.get.call(sel), sala = turmaSel.value;
      sel.innerHTML = topo.map((o, i) => `<option value="${esc(o.value)}" data-f>${esc(i === 0 && o.value === "" && /^Escolha/.test(o.text) && !sala && itens.length ? "Escolha a turma primeiro" : o.text)}</option>`).join("")
        + itens.filter((i) => i.sala === sala).map((i) => `<option value="${esc(i.value)}" data-sala="${esc(i.sala)}" data-f>${esc(i.text)}</option>`).join("");
      valorNativoSelect.set.call(sel, [...sel.options].some((o) => o.value === atual) ? atual : (sel.options[0] ? sel.options[0].value : ""));
    };
    sel._filtro = { turmaSel, itens, desenhar };
    desenhar();
    if (escolhido) valorNativoSelect.set.call(sel, escolhido.value);
  });
}
new MutationObserver(ligarFiltrosTurma).observe(document.getElementById("tela"), { childList: true, subtree: true });

// ---------- Página de apresentação (antes do login) ----------
document.getElementById("lp-ano").textContent = new Date().getFullYear();
// WhatsApp flutuante: só aparece com um número válido em data-numero (DDD + número)
(() => {
  const botao = document.getElementById("lp-whatsapp"), numero = (botao.dataset.numero || "").replace(/\D/g, "");
  if (!/^[1-9]{2}9?\d{8}$/.test(numero)) return;
  botao.href = `https://wa.me/55${numero}?text=${encodeURIComponent("Olá! Quero saber mais sobre o S.I.V.E.")}`;
  botao.hidden = false;
})();
// Títulos, textos e cards aparecem quando entram na tela, vindos de direções diferentes. Sem suporte ao observador, aparecem de uma vez.
(() => {
  document.querySelectorAll(".lp-secao .lp-sobretitulo, .lp-secao .lp-titulo, .lp-depoimentos-aviso, .lp-texto, .lp-nota-centro, .lp-faq, .lp-selos > div, .lp-chamada .lp-faixa > *")
    .forEach((el) => el.classList.add("lp-revela"));
  document.querySelectorAll(".lp-texto").forEach((el, i) => el.classList.add(i % 2 ? "dir" : "esq"));
  document.querySelectorAll(".lp-faq").forEach((el, i) => el.classList.add(i % 2 ? "dir" : "esq"));
  document.querySelectorAll(".lp-selos > div").forEach((el) => el.classList.add("zoom"));
  const itens = document.querySelectorAll(".lp-revela");
  if (!("IntersectionObserver" in window)) { itens.forEach((c) => c.classList.add("visivel")); return; }
  const obs = new IntersectionObserver((entradas) => entradas.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("visivel"); obs.unobserve(e.target);
  }), { threshold: 0.15 });
  // Itens lado a lado (cards da mesma grade) entram um depois do outro
  itens.forEach((c) => { const irmaos = [...c.parentElement.children]; c.style.transitionDelay = `${(irmaos.indexOf(c) % 6) * 90}ms`; obs.observe(c); });
})();
// Faixa de recursos: o conteúdo é repetido 4 vezes para correr sem emenda e cobrir até telas bem largas
(() => { // as cópias ficam escondidas do leitor de tela, para a lista não ser lida mais de uma vez
  const t = document.querySelector(".lp-ticker-trilho");
  const itens = [...t.children];
  for (let i = 0; i < 3; i++) itens.forEach((item) => { const copia = item.cloneNode(true); copia.setAttribute("aria-hidden", "true"); t.append(copia); });
})();
// Pausar animações: o que se move sozinho precisa de um jeito de parar (WCAG 2.2.2)
document.getElementById("lp-pausar").onclick = (e) => {
  const pausado = document.body.classList.toggle("lp-pausado");
  e.currentTarget.setAttribute("aria-pressed", pausado);
  e.currentTarget.textContent = pausado ? "Retomar animações" : "Pausar animações";
};
// Palavra que se troca no título principal
(() => {
  const el = document.getElementById("lp-troca"), frases = ["segura e conectada", "organizada", "acompanhada de perto", "protegida"];
  let i = 0;
  setInterval(() => {
    if (!homeVisivel() || menosMovimento() || document.body.classList.contains("lp-pausado")) return; // só anima com o site à vista
    el.classList.add("saindo");
    setTimeout(() => { i = (i + 1) % frases.length; el.textContent = frases[i]; el.classList.remove("saindo"); }, 350);
  }, 2800);
})();
// Ao rolar: barra de progresso, cabeçalho compacto, link da seção atual e botão "voltar ao topo"
(() => {
  const barra = document.getElementById("lp-progresso"), topo = document.querySelector(".lp-topo"), botaoTopo = document.getElementById("lp-topo-btn");
  const links = [...document.querySelectorAll(".lp-nav a")];
  const aoRolar = () => {
    if (!homeVisivel()) return;
    const y = window.scrollY, max = document.documentElement.scrollHeight - innerHeight;
    barra.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    topo.classList.toggle("rolou", y > 20);
    botaoTopo.classList.toggle("visivel", y > 600);
    let atual = null;
    links.forEach((a) => { const s = document.querySelector(a.getAttribute("href")); if (s && s.getBoundingClientRect().top < 140) atual = a; });
    if (max > 0 && y >= max - 4) atual = links[links.length - 1]; // no fim da página, a última seção (Perguntas) não chega ao topo: marca o último link
    links.forEach((a) => a.classList.toggle("ativo", a === atual));
  };
  addEventListener("scroll", aoRolar, { passive: true });
  aoRolar();
})();
// Os links "Entrar" (#entrar) abrem a página de login, que tem só o usuário e a senha. Qualquer outro endereço mostra o site.
// Usa o endereço da página, então o botão "voltar" do navegador também volta para o site.
const TITULO_SITE = "S.I.V.E. — Gestão e segurança escolar";
const menosMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-sem-movimento");
function homeVisivel() { return document.getElementById("lp-home").offsetParent !== null; }
// Painel do topo "vivo": os números contam até o valor ao abrir e, de tempos em tempos, chega uma notificação (entrada no portão,
// comunicado lido...), como se o dia estivesse acontecendo. Tudo fictício. Para com "menos movimento", com o botão de pausar,
// com a aba escondida ou com o painel fora da tela.
(() => {
  const mock = document.querySelector(".lp-mock");
  if (!mock) return;
  const q = (s) => mock.querySelector(s), aviso = q(".lp-mock-aviso"), sinoNum = q(".lp-mock-sino-num");
  const presentes = q("[data-presentes]"), ausentes = q("[data-ausentes]"), docs = q("[data-documentos]"), auts = q("[data-autorizacoes]");
  const total = 312;
  let naTela = true;
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { naTela = e.isIntersecting; }).observe(mock);
  const parado = () => menosMovimento() || document.hidden || !naTela || !homeVisivel() || document.body.classList.contains("lp-pausado");
  // 1) Números contando (uma vez, ao abrir a página)
  const numeros = [...mock.querySelectorAll(".lp-mock-metricas b, .lp-mock-alerta > b")];
  if (!menosMovimento()) {
    const finais = numeros.map((b) => Number(b.textContent));
    numeros.forEach((b) => { b.textContent = "0"; });
    setTimeout(() => {
      const t0 = performance.now();
      const passo = (agora) => {
        const t = Math.min(1, (agora - t0) / 1300), suave = 1 - Math.pow(1 - t, 3);
        numeros.forEach((b, i) => { b.textContent = Math.round(finais[i] * suave); });
        if (t < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    }, 700);
  }
  // 2) Notificações chegando
  const avisos = [
    { ico: "olho", titulo: "Entrada: Lucas • 3º Ano A", texto: "Portão principal • agora", entrada: true },
    { ico: "megafone", titulo: "Comunicado lido", texto: "23 de 24 famílias" },
    { ico: "olho", titulo: "Entrada: Sofia • 1º Ano B", texto: "Portão principal • agora", entrada: true },
    { ico: "caneta", titulo: "Autorização assinada", texto: "Passeio ao museu • 2º Ano B", conta: auts },
    { ico: "olho", titulo: "Entrada: Davi • 5º Ano A", texto: "Portão lateral • agora", entrada: true },
    { ico: "pasta", titulo: "Documento recebido", texto: "Comprovante de residência", conta: docs },
  ];
  let i = 0, novos = 0;
  setInterval(() => {
    if (parado()) return;
    const a = avisos[i % avisos.length]; i++;
    const presentesAgora = Number(presentes.textContent);
    if (a.entrada && presentesAgora >= total) return; // todo mundo já chegou: pula as entradas
    aviso.classList.remove("mostrar");
    void aviso.offsetWidth; // reinicia a animação de entrada
    aviso.innerHTML = `<span class="lp-mock-aviso-ico">${ico(a.ico)}</span><span><b>${a.titulo}</b><small>${a.texto}</small></span>`;
    aviso.classList.add("mostrar");
    novos = Math.min(9, novos + 1); sinoNum.textContent = novos; sinoNum.hidden = false;
    sinoNum.classList.remove("pulou"); void sinoNum.offsetWidth; sinoNum.classList.add("pulou");
    const pular = (el) => { el.classList.remove("mudou"); void el.offsetWidth; el.classList.add("mudou"); };
    if (a.entrada) { presentes.textContent = presentesAgora + 1; ausentes.textContent = `${total - presentesAgora - 1} ausentes`; pular(presentes); }
    if (a.conta) { a.conta.textContent = Math.min(9, Number(a.conta.textContent) + 1); pular(a.conta); }
  }, 3400);
})();
// Carrosséis do celular (Recursos, Perfis e Situações): os cartões deslizam para o lado e os pontinhos mostram em qual você está.
// No computador o CSS mostra a grade normal e os pontinhos ficam escondidos.
(() => {
  document.querySelectorAll("[data-carrossel]").forEach((lista) => {
    const itens = [...lista.children];
    const pontos = document.createElement("div");
    pontos.className = "lp-carrossel-pontos";
    pontos.innerHTML = itens.map((_, i) => `<button type="button" aria-label="${lista.dataset.carrossel}: item ${i + 1} de ${itens.length}"></button>`).join("");
    lista.after(pontos);
    const botoes = [...pontos.children];
    const marcar = () => {
      const meio = lista.scrollLeft + lista.clientWidth / 2;
      let atual = 0;
      itens.forEach((it, i) => { if (it.offsetLeft <= meio) atual = i; });
      botoes.forEach((b, i) => b.setAttribute("aria-current", i === atual ? "true" : "false"));
    };
    botoes.forEach((b, i) => b.addEventListener("click", () => lista.scrollTo({ left: itens[i].offsetLeft - (lista.clientWidth - itens[i].offsetWidth) / 2, behavior: menosMovimento() ? "auto" : "smooth" })));
    lista.addEventListener("scroll", () => requestAnimationFrame(marcar), { passive: true });
    addEventListener("resize", marcar);
    marcar();
  });
})();
// Barra fixa do celular ("Entrar" e "Quero o S.I.V.E."): aparece depois que os botões do topo saem da tela e some perto da chamada final,
// que já tem os mesmos botões. Enquanto ela aparece, os botões flutuantes (WhatsApp, voltar ao topo) sobem para não ficarem por baixo.
(() => {
  const barra = document.querySelector(".lp-barra-movel"), acoesTopo = document.querySelector(".lp-hero .lp-acoes"), chamada = document.querySelector(".lp-chamada");
  if (!barra) return;
  let agendado = false;
  const atualizar = () => {
    agendado = false;
    const mostrar = homeVisivel() && innerWidth < 760 && acoesTopo.getBoundingClientRect().bottom < 0 && chamada.getBoundingClientRect().top > innerHeight * 0.6;
    document.documentElement.classList.toggle("lp-com-barra", mostrar);
  };
  const agendar = () => { if (!agendado) { agendado = true; requestAnimationFrame(atualizar); } };
  addEventListener("scroll", agendar, { passive: true });
  addEventListener("resize", agendar);
  addEventListener("hashchange", agendar);
  atualizar();
})();
// Transição do "Entrar": o botão clicado se transforma na caixa de login (View Transitions do navegador).
// Navegadores sem esse recurso, ou com "menos movimento", só trocam de tela como antes.
document.addEventListener("click", (e) => {
  const link = e.target.closest('a[href="#entrar"]');
  if (!link || !document.startViewTransition || menosMovimento()) return;
  document.querySelectorAll(".lp-vt-origem").forEach((el) => el.classList.remove("lp-vt-origem"));
  link.classList.add("lp-vt-origem");
}, true);
function trocarTela() {
  const origem = document.querySelector(".lp-vt-origem");
  if (!origem || !document.startViewTransition || menosMovimento()) { mostrarPaginaInicial(); return; }
  const transicao = document.startViewTransition(() => { origem.classList.remove("lp-vt-origem"); mostrarPaginaInicial(); });
  transicao.finished.finally(() => origem.classList.remove("lp-vt-origem"));
}
// O S.I.V.E. não é instalável: desfaz o service worker que versões anteriores registraram neste navegador.
if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
// Topo do site encaixado na primeira tela: o hero ocupa a altura que sobra entre o cabeçalho e a faixa de recursos,
// e a faixa termina exatamente no fim da tela. Se o conteúdo não couber, o hero fica mais compacto em até dois níveis.
// No celular, com letra ampliada ou fora da home, o hero volta à altura natural.
(() => {
  const hero = document.querySelector(".lp-hero"), topo = document.querySelector(".lp-topo"), faixa = document.querySelector(".lp-ticker");
  let alturaTopo = 0; // altura do cabeçalho no alto da página (rolando, ele fica mais baixo)
  const encaixar = () => {
    if (!homeVisivel()) return;
    hero.classList.remove("lp-hero-ajuste1", "lp-hero-ajuste2");
    hero.style.removeProperty("min-height");
    if (innerWidth < 960 || document.documentElement.hasAttribute("data-texto")) return;
    if (!topo.classList.contains("rolou") || !alturaTopo) alturaTopo = topo.offsetHeight + (topo.classList.contains("rolou") ? 12 : 0);
    const livre = innerHeight - alturaTopo - faixa.offsetHeight;
    // Altura do conteúdo (as bolhas decorativas do fundo ficam de fora da conta)
    const grade = hero.querySelector(".lp-hero-grade");
    const precisa = () => { const e = getComputedStyle(hero); return grade.offsetHeight + parseFloat(e.paddingTop) + parseFloat(e.paddingBottom); };
    for (const nivel of ["lp-hero-ajuste1", "lp-hero-ajuste2"]) { if (precisa() <= livre) break; hero.classList.add(nivel); }
    hero.style.minHeight = livre + "px";
  };
  addEventListener("resize", encaixar);
  addEventListener("hashchange", () => requestAnimationFrame(encaixar));
  new MutationObserver(encaixar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-texto", "data-fonte", "data-espaco"] });
  encaixar();
  if (document.fonts) document.fonts.ready.then(encaixar); // as fontes mudam a altura do texto
})();
// Efeitos guiados pela rolagem (hero, assinatura e chamada final): o app.js só escreve um número de 0 a 1 em uma variável CSS, e o CSS faz o resto.
// Com "menos movimento", tudo fica no estado final (1), sem animação.
(() => {
  const hero = document.querySelector(".lp-hero"), vitrine = document.querySelector(".lp-vitrine");
  const passos = document.querySelector(".lp-fluxo-passos"), itens = [...passos.children], chamada = document.querySelector(".lp-chamada");
  const limitar = (v) => Math.min(1, Math.max(0, v));
  // Quanto o elemento já andou entre "o topo dele está em `de` da altura da tela" (0) e "está em `ate`" (1)
  const entre = (el, de, ate) => limitar((de * innerHeight - el.getBoundingClientRect().top) / ((de - ate) * innerHeight));
  let agendado = false;
  const desenhar = () => {
    agendado = false;
    if (!homeVisivel()) return;
    const parado = menosMovimento();
    vitrine.style.setProperty("--h", parado ? 1 : limitar(scrollY / (hero.offsetHeight * 0.6)).toFixed(3));
    const f = parado ? 1 : entre(passos, 0.85, 0.35);
    passos.style.setProperty("--f", f.toFixed(3));
    passos.parentElement.parentElement.classList.toggle("lp-fluxo-vivo", !parado);
    itens.forEach((li, i) => li.classList.toggle("aceso", f >= i / (itens.length - 1) - 0.02));
    chamada.style.setProperty("--c", parado ? 1 : entre(chamada, 1, 0.55).toFixed(3));
    // "No dia a dia": o sol anda pelo trilho (7h30 → 17h40) e os cartões acendem na hora deles. Só em telas largas.
    const dia = document.querySelector(".lp-dia-trilho");
    if (dia) {
      const largo = innerWidth >= 760 && !parado, d = largo ? entre(dia, 0.85, 0.3) : 1;
      dia.style.setProperty("--d", d.toFixed(3));
      const cartoes = [...dia.nextElementSibling.children];
      dia.parentElement.classList.toggle("lp-dia-vivo", largo);
      cartoes.forEach((c, i) => c.classList.toggle("aceso", d >= i / (cartoes.length - 1) - 0.02));
    }
  };
  const agendar = () => { if (!agendado) { agendado = true; requestAnimationFrame(desenhar); } };
  addEventListener("scroll", agendar, { passive: true });
  addEventListener("resize", agendar);
  addEventListener("hashchange", agendar);
  new MutationObserver(agendar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-sem-movimento"] });
  agendar();
})();
// Seção "Para quem" presa na tela: enquanto a pessoa rola, a seção fica parada e o perfil em destaque muda (01, 02, 03), junto com a tela ao lado.
// Só liga em telas grandes, sem letra ampliada e sem "menos movimento". Nos outros casos (e sem JavaScript) os três perfis ficam um abaixo do outro.
(() => {
  const secao = document.getElementById("para-quem"), trilho = secao.querySelector(".lp-passos-trilho"), palco = secao.querySelector(".lp-passos-palco");
  const passos = [...secao.querySelectorAll(".lp-passo")], telas = passos.map((p) => p.querySelector(".lp-passo-tela"));
  const FOLGA = 0.08; // 8% da rolagem parada no primeiro perfil e 8% no último, para dar tempo de ler
  const limitar = (v) => Math.min(1, Math.max(0, v));
  const podePrender = () => innerWidth >= 1000 && innerHeight >= 640 && !menosMovimento() && !document.documentElement.hasAttribute("data-texto");
  let vivo = false, topo = 0, agendado = false;
  const desenhar = () => {
    agendado = false;
    if (!homeVisivel()) return;
    if (podePrender() !== vivo) { // entrou no modo preso ou saiu dele (ex.: a janela mudou de tamanho)
      vivo = !vivo;
      secao.classList.toggle("lp-passos-vivo", vivo);
      topo = vivo ? parseFloat(getComputedStyle(palco).top) || 0 : 0; // altura do cabeçalho fixo, definida no CSS (--passos-topo)
      if (!vivo) telas.forEach((t) => { t.style.removeProperty("--d"); t.style.removeProperty("--a"); });
    }
    if (!vivo) return;
    const sobra = trilho.offsetHeight - palco.offsetHeight; // quanto dá para rolar com a seção parada
    const p = limitar((topo - trilho.getBoundingClientRect().top) / sobra); // 0 = seção acabou de parar, 1 = vai soltar
    const bruta = limitar((p - FOLGA) / (1 - 2 * FOLGA)) * (passos.length - 1); // 0 a 2, com casas decimais: 0,5 é o meio do caminho entre o 1º e o 2º perfil
    // Cada perfil fica parado por um trecho e a troca acontece só no meio do caminho, começando e terminando devagar
    const inteiro = Math.min(Math.floor(bruta), passos.length - 2), t = limitar((bruta - inteiro - 0.25) / 0.5);
    const posicao = inteiro + t * t * (3 - 2 * t);
    const atual = Math.round(posicao);
    secao.style.setProperty("--p", p.toFixed(4));
    passos.forEach((passo, i) => {
      passo.classList.toggle("ativo", i === atual);
      const d = i - posicao; // negativo: a tela já passou (sobe); positivo: ainda vem (espera embaixo)
      telas[i].style.setProperty("--d", d.toFixed(4));
      telas[i].style.setProperty("--a", Math.abs(d).toFixed(4));
    });
  };
  const agendar = () => { if (!agendado) { agendado = true; requestAnimationFrame(desenhar); } }; // no máximo um desenho por quadro
  // Clicar em um perfil rola até o ponto em que ele fica em destaque
  passos.forEach((passo, i) => passo.querySelector(".lp-passo-texto").addEventListener("click", () => {
    if (!vivo) return;
    const sobra = trilho.offsetHeight - palco.offsetHeight, p = FOLGA + (i / (passos.length - 1)) * (1 - 2 * FOLGA);
    window.scrollTo({ top: scrollY + trilho.getBoundingClientRect().top - topo + p * sobra, behavior: "smooth" });
  }));
  addEventListener("scroll", agendar, { passive: true });
  addEventListener("resize", agendar);
  addEventListener("hashchange", agendar);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", agendar);
  new MutationObserver(agendar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-sem-movimento", "data-texto"] }); // painel de acessibilidade
  agendar();
})();
const codigoNaUrl = () => new URLSearchParams(location.search).get("verificar"); // ?verificar=CÓDIGO (link do QR code)
let codigoRedefinir = ""; // link do e-mail de recuperação (#redefinir=CÓDIGO): fica depois do #, então não vai para o servidor nem para logs de acesso
function mostrarPaginaInicial() {
  const verificar = location.hash === "#verificar" || codigoNaUrl() !== null;
  if (location.hash.startsWith("#redefinir=")) { // tira o código da barra de endereço e do histórico do navegador
    codigoRedefinir = location.hash.slice("#redefinir=".length);
    history.replaceState(null, "", location.pathname + "#entrar");
    document.getElementById("form-login").classList.add("oculto"); document.getElementById("form-redefinir").classList.remove("oculto");
  }
  const login = !verificar && location.hash === "#entrar";
  document.getElementById("lp-home").classList.toggle("oculto", login || verificar);
  document.getElementById("lp-entrar").classList.toggle("oculto", !login);
  document.getElementById("lp-verificar").classList.toggle("oculto", !verificar);
  const quemSomos = location.hash === "#quem-somos";
  document.getElementById("conteudo").classList.toggle("oculto", quemSomos);
  document.getElementById("lp-quem-somos").classList.toggle("oculto", !quemSomos);
  document.title = verificar ? "Verificar assinatura — S.I.V.E." : login ? "Entrar — S.I.V.E." : quemSomos ? "Quem somos — S.I.V.E." : TITULO_SITE;
  if (verificar) {
    window.scrollTo(0, 0);
    if (codigoNaUrl()) { document.getElementById("ver-codigo").value = codigoNaUrl(); conferirAssinatura(); }
    else document.getElementById("ver-codigo").focus();
    return;
  }
  if (login) { window.scrollTo(0, 0); document.getElementById("login-usuario").focus(); return; }
  if (quemSomos) { window.scrollTo(0, 0); return; }
  if (location.hash === "#contratar") { cadastroEscola.abrir(); return; }
  const secao = location.hash.length > 1 && document.querySelector(location.hash);
  if (secao) secao.scrollIntoView(); else window.scrollTo(0, 0);
}
// Verificação pública da assinatura: confere o selo criptográfico e se o documento continua igual ao que foi assinado
async function conferirAssinatura() {
  const caixa = document.getElementById("ver-resultado");
  const codigo = document.getElementById("ver-codigo").value.toUpperCase().replace(/[^0-9A-F]/g, "");
  caixa.innerHTML = `<small style="margin-top:14px">Conferindo...</small>`;
  let r;
  try {
    const resp = await fetch(`/api/verificar/${encodeURIComponent(codigo || "x")}`);
    r = await resp.json();
    if (!resp.ok) throw new Error(r.erro || "Não foi possível verificar agora");
  } catch (e) { caixa.innerHTML = `<p class="pill danger" style="margin-top:14px;white-space:normal">${esc(e.message)}</p>`; return; }
  history.replaceState(null, "", `/?verificar=${codigo}`);
  const linha = (rotulo, valor) => `<tr><td style="color:var(--muted-fg);width:40%">${rotulo}</td><td>${valor}</td></tr>`;
  const quadro = {
    valida: ["success", "confere", "Assinatura válida", "O selo criptográfico confere e o documento não foi alterado desde a assinatura."],
    alterada: ["danger", "aviso", "Atenção: assinatura não confere", r.conteudo_ok === false ? "O documento foi alterado depois de assinado." : "O registro da assinatura foi alterado depois de feito."],
    anterior: ["warning", "aviso", "Assinatura anterior ao selo digital", "O código existe, mas a assinatura foi feita antes da assinatura digital do sistema e não tem selo criptográfico para conferir. Peça à escola para confirmar."],
    nao_encontrada: ["danger", "proibido", "Código não encontrado", "Confira se o código foi digitado corretamente (16 letras e números)."],
  }[r.status];
  caixa.innerHTML = `<div class="card" style="margin-top:14px;border-left:5px solid var(--${quadro[0]})">
    <b style="display:flex;gap:8px;align-items:center;color:var(--${quadro[0]})">${ico(quadro[1])} ${quadro[2]}</b><small style="margin-top:4px">${quadro[3]}</small>
    ${r.assinante ? `<div class="tabela" style="margin-top:12px"><table style="min-width:0"><caption class="so-leitor">Dados da assinatura</caption>${linha("Documento", esc(r.documento))}${linha("Assinado por", `${esc(r.assinante)} <small style="display:inline">(${esc(r.papel)})</small>`)}
      ${linha("Data e hora", esc(r.assinada_em))}${linha("Como foi assinado", esc(r.metodo))}${linha("Código", `<b>${esc(r.codigo)}</b>`)}
      ${linha("Impressão digital do conteúdo (SHA-256)", `<small style="word-break:break-all;font-family:monospace">${esc(r.hash)}</small>`)}</table></div>` : ""}</div>`;
}
document.getElementById("form-verificar").onsubmit = (e) => { e.preventDefault(); conferirAssinatura(); };

// ---------- Ficha "Quero o S.I.V.E. na minha escola" (página inicial, sem login) ----------
// Abre por qualquer botão com data-cadastro-escola ou pelo endereço /#contratar (link que dá para mandar para outra escola).
const cadastroEscola = (() => {
  const $ = (id) => document.getElementById(id);
  const modal = $("cadastro-escola"), form = $("form-escola"), erro = $("ce-erro");
  let voltarFoco = null;
  const numeros = (v) => v.replace(/\D/g, "");
  // Máscaras: a pessoa digita só os números e os pontos e traços aparecem sozinhos
  const mascaras = {
    "ce-telefone": (v) => { const n = numeros(v).slice(0, 11); return n.length > 10 ? n.replace(/^(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3") : n.replace(/^(\d{2})(\d{0,4})(\d{0,4})/, (m, a, b, c) => `(${a}) ${b}${c ? "-" + c : ""}`).replace(/^\((\d{0,2})\) $/, "$1"); },
  };
  for (const [id, f] of Object.entries(mascaras)) $(id).addEventListener("input", (e) => { e.target.value = f(e.target.value); });
  const limparErro = () => { erro.classList.add("oculto"); form.querySelectorAll("[aria-invalid]").forEach((c) => c.removeAttribute("aria-invalid")); };
  const mostrarErro = (msg, campo) => {
    erro.textContent = msg; erro.classList.remove("oculto");
    const el = $(`ce-${campo}`);
    if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  };
  form.addEventListener("input", (e) => { if (e.target.hasAttribute("aria-invalid")) limparErro(); });

  function abrir() {
    voltarFoco = document.activeElement;
    $("ce-ficha").classList.remove("oculto"); $("ce-pronto").classList.add("oculto"); limparErro();
    modal.classList.remove("oculto"); document.body.classList.add("sem-rolagem");
    modal.scrollTop = 0; setTimeout(() => $("ce-nome").focus(), 50);
  }
  function fechar() {
    modal.classList.add("oculto"); document.body.classList.remove("sem-rolagem");
    if (location.hash === "#contratar") history.replaceState(null, "", location.pathname + location.search);
    if (voltarFoco && voltarFoco.focus) voltarFoco.focus();
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-cadastro-escola]"); if (b) { e.preventDefault(); abrir(); } });
  $("ce-fechar").onclick = $("ce-cancelar").onclick = $("ce-ok").onclick = fechar;
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) fechar(); });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return fechar();
    if (e.key !== "Tab") return; // o Tab fica dentro da janela
    const focaveis = [...modal.querySelectorAll("button, input:not([tabindex='-1']), select, textarea")].filter((el) => el.offsetParent !== null);
    const [primeiro, ultimo] = [focaveis[0], focaveis[focaveis.length - 1]];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault(); limparErro();
    const dados = Object.fromEntries(new FormData(form));
    dados.aceite = $("ce-aceite").checked;
    // Conferências rápidas aqui; o servidor confere tudo de novo
    const obrigatorios = [["nome", "Informe o nome da escola."], ["cidade", "Informe a cidade."], ["uf", "Escolha o estado (UF)."], ["alunos", "Informe quantos alunos a escola tem (aproximadamente)."],
      ["contato_nome", "Informe o seu nome."], ["email", "Informe o e-mail."], ["telefone", "Informe o telefone."]];
    for (const [campo, msg] of obrigatorios) if (!String(dados[campo] || "").trim()) return mostrarErro(msg, campo);
    if (!$("ce-email").checkValidity()) return mostrarErro("E-mail inválido.", "email");
    if (!dados.aceite) return mostrarErro("Para entrarmos em contato, marque que concorda com o uso dos dados.", "aceite");
    const botao = $("ce-enviar"); botao.disabled = true; botao.textContent = "Enviando...";
    try {
      const r = await fetch("/api/escolas-interessadas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) return mostrarErro(res.erro || "Não foi possível enviar agora. Tente de novo.", res.campo);
      $("ce-protocolo").textContent = res.protocolo;
      $("ce-pronto-titulo").textContent = res.repetido ? "Já recebemos o pedido desta escola" : "Pedido de orçamento recebido!";
      const nome = (dados.contato_nome || "").trim().split(/\s+/)[0];
      $("ce-pronto-texto").textContent = res.repetido
        ? `O pedido foi feito em ${res.em} e continua com a nossa equipe. Vamos falar com vocês em breve, ${nome}.`
        : `Obrigado, ${nome}! A equipe S.I.V.E. vai enviar o orçamento em até 2 dias úteis pelo telefone ou e-mail informado.`;
      $("ce-ficha").classList.add("oculto"); $("ce-pronto").classList.remove("oculto"); modal.scrollTop = 0; $("ce-ok").focus();
      if (!res.repetido) form.reset();
    } catch { mostrarErro("Sem conexão. Confira a internet e tente de novo."); }
    finally { botao.disabled = false; botao.textContent = "Solicitar orçamento"; }
  });
  return { abrir };
})();

addEventListener("hashchange", trocarTela);
mostrarPaginaInicial();
let ultimaAbaAtiva = null; // a animação de "abrir a aba" só toca quando a aba muda, não a cada redesenho do menu

// ---------- Listas longas: 10 itens por vez, com setas "10 anteriores" / "Próximos 10" ----------
// Vale para toda tabela (linhas do <tbody>) e toda lista de .item/.log/.hist com mais de 10 itens, em qualquer tela.
// Os itens só ficam escondidos na tela: continuam no HTML (a chamada salva todos) e saem todos na impressão.
const POR_PAGINA = 10;
const paginacoes = new WeakMap(); // lista -> { itens, pagina, barra }
function itensPaginaveis(lista) {
  return [...lista.children].filter((c) => (lista.tagName === "TBODY" ? c.tagName === "TR" : c.matches(".item, .log, .hist")));
}
function paginar(lista) {
  const itens = itensPaginaveis(lista), antes = paginacoes.get(lista);
  if (antes && antes.itens.length === itens.length && antes.itens.every((x, i) => x === itens[i])) return; // nada mudou
  if (antes) antes.barra.remove();
  if (itens.length <= POR_PAGINA) { itens.forEach((x) => x.classList.remove("pag-oculto")); paginacoes.delete(lista); return; }
  // Tabela: a barra vai logo abaixo dela. Lista: a barra vai no fim da própria lista.
  const ancora = lista.tagName === "TBODY" ? lista.closest(".tabela") || lista.closest("table") : null;
  const barra = document.createElement("div");
  barra.className = "paginacao no-print";
  if (ancora) { if (ancora.nextElementSibling?.classList.contains("paginacao")) ancora.nextElementSibling.remove(); ancora.after(barra); }
  else lista.append(barra);
  const total = Math.ceil(itens.length / POR_PAGINA);
  // A mesma lista redesenhada com o mesmo tamanho (ex.: Monitoramento, que atualiza sozinho) continua na página em que estava
  const estado = { itens, barra, pagina: antes && antes.itens.length === itens.length ? Math.min(antes.pagina, total - 1) : 0 };
  paginacoes.set(lista, estado);
  const desenhar = () => {
    const ini = estado.pagina * POR_PAGINA, fim = Math.min(ini + POR_PAGINA, itens.length), restam = itens.length - fim;
    itens.forEach((x, i) => x.classList.toggle("pag-oculto", i < ini || i >= fim));
    barra.innerHTML = `<button type="button" class="btn outline pequeno" data-pag="-1" ${estado.pagina === 0 ? "disabled" : ""}>${ico("setaEsq")} ${POR_PAGINA} anteriores</button>
      <span>${ini + 1}–${fim} de ${itens.length}</span>
      <button type="button" class="btn outline pequeno" data-pag="1" ${restam ? "" : "disabled"}>Próximos ${Math.min(POR_PAGINA, restam) || POR_PAGINA} ${ico("setaDir")}</button>`;
  };
  barra.onclick = (e) => {
    const b = e.target.closest("[data-pag]"); if (!b || b.disabled) return;
    estado.pagina += Number(b.dataset.pag); desenhar();
    const topo = ancora || lista; // se o começo da lista ficou para cima da tela, volta até ele
    if (topo.getBoundingClientRect().top < 80) topo.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  desenhar();
}
function paginarTudo() {
  const tela = document.getElementById("tela");
  tela.querySelectorAll("tbody").forEach(paginar);
  new Set([...tela.querySelectorAll(".item, .log, .hist")].map((x) => x.parentElement)).forEach(paginar);
}
// Toda vez que uma tela, filtro, busca ou ordenação redesenha uma lista, a paginação é refeita
let paginacaoAgendada = false;
new MutationObserver(() => {
  if (paginacaoAgendada) return;
  paginacaoAgendada = true;
  requestAnimationFrame(() => { paginacaoAgendada = false; paginarTudo(); });
}).observe(document.getElementById("tela"), { childList: true, subtree: true });
const titulos = {
  secretaria: "Central do Dia", seguranca: "Monitoramento", pais: "Portal da Família", calendario: "Calendário escolar", perfil: "Meu perfil",
  frequencia: "Controle de frequência", busca: "Busca Ativa", relatorio: "Relatório Mensal",
  cadastro: "Alunos e turmas", usuarios: "Usuários do sistema", logs: "Registro de atividades", turma: "Minha Turma",
  ficha: "Ficha do aluno", ocorrencias: "Ocorrências", comunicados: "Comunicados", autorizacoes: "Autorizações Digitais", consentimentos: "Consentimento dos responsáveis", protecao: "Proteção da criança",
};
const papelLabel = (p) => ({ admin: "Gestão", pai: "Responsável", professor: "Docente", sistema: "Sistema" }[p] || p);
const acaoLabel = (a) => ({
  login_sucesso: "Login", login_falha: "Tentativa de login falhou", logout: "Saiu do sistema", login_codigo_errado: "Errou o código das duas etapas",
  "2fa_ativada": "Ativou a verificação em duas etapas", "2fa_zerada": "Redefiniu a verificação em duas etapas de um usuário", backup_feito: "Backup automático feito", backup_falhou: "Backup automático falhou",
  logs_apagados: "Apagou logs antigos (prazo de guarda)", turma_criada: "Criou turma", turma_alterada: "Alterou turma", aluno_situacao: "Mudou a situação do aluno",
  responsavel_vinculado: "Vinculou aluno a um responsável", responsavel_desvinculado: "Desvinculou aluno de um responsável", professor_turmas: "Alterou as turmas do docente", cadastro_aluno: "Cadastrou aluno",
  cadastro_usuario: "Cadastrou usuário", troca_senha: "Trocou a senha", recuperacao_senha_pedida: "Pediu senha nova à gestão", recuperacao_senha_email: "Recebeu link de recuperação por e-mail", senha_redefinida_email: "Redefiniu a senha pelo link do e-mail", nova_senha_usuario: "Gerou senha nova para um usuário", email_usuario_alterado: "Alterou o e-mail de um usuário", autorizacao_alternada: "Alterou autorização",
  liberacao_saida: "Liberou saída", reativar_usuario: "Reativou usuário", desativar_usuario: "Desativou usuário",
  chamada_registrada: "Registrou a chamada", busca_ativa_aberta: "Abriu caso de Busca Ativa (automático)",
  busca_ativa_acompanhamento: "Anotou acompanhamento (Busca Ativa)", busca_ativa_encerrada: "Encerrou caso de Busca Ativa",
  relatorio_mensal: "Gerou relatório mensal", comunicado_criado: "Publicou comunicado", comunicado_lido: "Leu comunicado",
  autorizacao_criada: "Criou autorização", autorizacao_assinada: "Assinou autorização digitalmente", documento_enviado: "Anexou documento",
  documento_excluido: "Excluiu documento", pendencia_criada: "Abriu pendência", pendencia_resolvida: "Resolveu pendência",
  ocorrencia_registrada: "Registrou ação/advertência", ocorrencia_escolar_registrada: "Registrou ocorrência do dia (com assinatura)", ocorrencia_escolar_assinada: "Assinou a ciência de uma ocorrência", ocorrencia_escolar_gestao: "Gestão assinou uma ocorrência",aceite_privacidade: "Aceitou a política de privacidade",
  consentimento_registrado: "Assinou o termo de consentimento", exportacao_dados_aluno: "Baixou os dados do aluno (LGPD)",
  documento_baixado: "Baixou documento", documento_acesso_negado: "Tentou baixar documento sem permissão",
  documento_integridade_falhou: "Arquivo de documento alterado ou ilegível", login_bloqueado: "Login bloqueado (muitas tentativas)", importacao_alunos: "Importou alunos de planilha",
  protecao_registrada: "Registrou caso de proteção da criança", protecao_comunicada: "Registrou comunicação ao Conselho Tutelar",
  protecao_consultada: "Consultou registros de proteção", comunicado_com_nome_de_aluno: "Publicou comunicado citando nome de aluno",
  inativado_por_inatividade: "Inativou docente (60 dias sem acesso)", reativacao_solicitada: "Pediu reativação do acesso",
  perfil_atualizado: "Atualizou o perfil", evento_criado: "Criou evento no calendário", evento_excluido: "Excluiu evento do calendário",
  entrada_manual: "Registrou entrada pela portaria", saida_manual: "Registrou saída pela portaria", reconhecimento_simulado: "Simulou reconhecimento facial",
  facial_ligado: "Ligou o reconhecimento facial", facial_desligado: "Desligou o reconhecimento facial", camera_cadastrada: "Cadastrou câmera",
  camera_ligada: "Ligou câmera", camera_desligada: "Desligou câmera", reconhecimentos_apagados: "Apagou passagens antigas das câmeras (90 dias)",
}[a] || a);

const pill = (texto, tom) => `<span class="pill ${tom}">${texto}</span>`;
const iniciais = (nome) => nome.split(" ").slice(0, 2).map((n) => n[0]).join("");
// Plural certo em vez de "aluno(s)": pl(1, "aluno", "alunos") = "1 aluno"; pl(3, "aluno", "alunos") = "3 alunos"
const pl = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataCurta = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const pct = (v) => (v == null ? "—" : String(v).replace(".", ",") + "%");
const calcPct = (p, a) => ((p + a) ? Math.round(p * 1000 / (p + a)) / 10 : null);
const saudacao = () => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

// ---------- Login ----------
document.getElementById("form-login").onsubmit = async (e) => {
  e.preventDefault();
  const erroBox = document.getElementById("login-erro");
  erroBox.classList.add("oculto"); document.getElementById("login-aviso").classList.add("oculto");
  const botao = document.getElementById("login-entrar"), status = document.getElementById("login-status");
  botao.disabled = true; botao.classList.add("validando"); botao.textContent = status.textContent = "Validando senha...";
  try {
    const usuario = document.getElementById("login-usuario").value.trim();
    const senha = document.getElementById("login-senha").value;
    const caixaCodigo = document.getElementById("login-2fa"), codigo = document.getElementById("login-codigo").value.trim();
    const [r] = await Promise.all([fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha, codigo: caixaCodigo.classList.contains("oculto") ? undefined : codigo }),
    }), new Promise((pronto) => setTimeout(pronto, 900))]); // tempo mínimo para a animação ser vista
    const dadosLogin = await r.json();
    if (!r.ok) throw new Error(dadosLogin.erro || "Não foi possível entrar");
    if (dadosLogin.precisa_codigo) { // senha certa e conta com duas etapas: pede o código do aplicativo, do e-mail ou do celular
      const noAplicativo = (dadosLogin.metodo || "app") === "app";
      caixaCodigo.classList.remove("oculto");
      document.querySelector('label[for="login-codigo"]').textContent = noAplicativo ? "Código do aplicativo autenticador (6 números)" : `Código enviado para ${dadosLogin.destino} (6 números)`;
      document.getElementById("login-codigo").focus();
      throw new Error(noAplicativo ? "Digite o código de 6 números do aplicativo autenticador." : `Enviamos um código para ${dadosLogin.destino}. Ele vale por 10 minutos.${dadosLogin.simulado ? " Envio simulado: veja o terminal do servidor." : ""}`);
    }
    caixaCodigo.classList.add("oculto"); document.getElementById("login-codigo").value = "";
    usuarioLogado = dadosLogin;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    preferenciasAoEntrar();
    await telaCarregando();
    seguirLogin();
  } catch (erro) {
    erroBox.textContent = erro.message;
    erroBox.classList.remove("oculto");
  } finally {
    botao.disabled = false; botao.classList.remove("validando"); botao.textContent = "Entrar"; status.textContent = "";
  }
};
// Esqueci minha senha: o servidor manda um link para o e-mail da pessoa; sem e-mail, o pedido chega à gestão.
// A resposta é sempre a mesma, exista ou não o usuário: assim a tela não revela quem tem conta.
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("form-recuperar"), ok = $("rec-ok"), erro = $("rec-erro");
  const trocar = (recuperar) => {
    $("form-login").classList.toggle("oculto", recuperar); form.classList.toggle("oculto", !recuperar);
    ok.classList.add("oculto"); erro.classList.add("oculto");
    $(recuperar ? "rec-usuario" : "link-esqueci").focus();
  };
  $("link-esqueci").onclick = () => { $("rec-usuario").value = $("login-usuario").value.trim(); trocar(true); };
  $("rec-voltar").onclick = () => trocar(false);
  form.onsubmit = async (e) => {
    e.preventDefault(); ok.classList.add("oculto"); erro.classList.add("oculto");
    const botao = $("rec-enviar"); botao.disabled = true;
    try {
      const r = await fetch("/api/recuperar-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: $("rec-usuario").value.trim() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Não foi possível enviar agora. Tente de novo.");
      ok.classList.remove("oculto");
    } catch (err) { erro.textContent = err.message; erro.classList.remove("oculto"); }
    finally { botao.disabled = false; }
  };
  // Senha nova pelo link do e-mail
  const voltarAoLogin = () => { $("form-redefinir").classList.add("oculto"); $("form-login").classList.remove("oculto"); codigoRedefinir = ""; $("form-redefinir").reset(); };
  $("red-voltar").onclick = () => { voltarAoLogin(); $("login-usuario").focus(); };
  $("form-redefinir").onsubmit = async (e) => {
    e.preventDefault();
    const caixa = $("red-erro"), botao = $("red-enviar"), senha = $("red-senha").value;
    const mostrar = (msg) => { caixa.textContent = msg; caixa.classList.remove("oculto"); };
    caixa.classList.add("oculto");
    if (senha !== $("red-confirmar").value) return mostrar("As duas senhas não são iguais.");
    botao.disabled = true;
    try {
      const r = await fetch("/api/redefinir-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: codigoRedefinir, senha }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Não foi possível salvar agora. Tente de novo.");
      voltarAoLogin(); $("login-aviso").classList.remove("oculto"); $("login-usuario").focus();
    } catch (err) { mostrar(err.message); }
    finally { botao.disabled = false; }
  };
})();
// Olhinho dos campos de senha: mostra o que foi digitado e esconde de novo ao enviar
document.querySelectorAll('input[type="password"]').forEach((campo) => {
  const caixa = document.createElement("div"), botao = document.createElement("button");
  caixa.className = "campo-senha"; botao.type = "button"; botao.className = "olho-senha";
  const marcar = (ver) => { campo.type = ver ? "text" : "password"; botao.innerHTML = ico(ver ? "olhoFechado" : "olho"); botao.setAttribute("aria-label", ver ? "Ocultar senha" : "Mostrar senha"); botao.title = botao.getAttribute("aria-label"); };
  campo.replaceWith(caixa); caixa.append(campo, botao); marcar(false);
  botao.onclick = () => { marcar(campo.type === "password"); campo.focus(); };
  if (campo.form) campo.form.addEventListener("submit", () => marcar(false));
});
if (codigoRedefinir) document.getElementById("red-senha").focus();
// Animação de 3s entre o login e a próxima tela
function telaCarregando() {
  const tela = document.getElementById("tela-carregando");
  document.getElementById("carregando-texto").textContent = `${saudacao()}, ${usuarioLogado.nome.trim().split(/\s+/)[0]}!`;
  document.getElementById("tela-login").classList.add("oculto");
  window.scrollTo(0, 0); // a página de apresentação pode estar rolada; o sistema abre do topo
  tela.classList.remove("oculto");
  return new Promise((ok) => setTimeout(() => { tela.classList.add("oculto"); ok(); }, 3000));
}
function sair() {
  usuarioLogado = null;
  document.title = TITULO_SITE;
  ajustarVLibras(false);
  pararVoz(); aplicarPreferencias(lerPreferenciasLocais() || {}); // no computador compartilhado, o ajuste de uma conta não fica para a próxima pessoa
  fecharTutorial();
  clearInterval(timerTela); clearInterval(timerBanner); clearInterval(timerAvisos);
  buscaAlunos = null; document.getElementById("avisos-area").classList.add("oculto"); document.getElementById("busca-rapida").classList.add("oculto");
  cacheBanner.forEach((url) => URL.revokeObjectURL(url)); cacheBanner.clear();
  localStorage.removeItem("sive-usuario");
  document.getElementById("app").classList.add("oculto");
  document.getElementById("tela-senha").classList.add("oculto");
  document.getElementById("tela-termo").classList.add("oculto");
  document.getElementById("tela-consent").classList.add("oculto");
  document.getElementById("tela-2fa").classList.add("oculto");
  document.getElementById("login-2fa").classList.add("oculto");
  consentPuladoNaSessao = false;
  dados.ocorrenciasNovas = 0; ultimaAbaAtiva = null;
  document.getElementById("tela-login").classList.remove("oculto");
  document.getElementById("form-login").reset();
  window.scrollTo(0, 0);
}
// Sair: avisa o servidor (o login deixa de valer em todos os aparelhos) e limpa este navegador
async function sairDoSistema() {
  try { if (usuarioLogado) await api("/api/sair", { method: "POST", body: "{}" }); } catch { /* sai mesmo assim */ }
  sair();
}
document.getElementById("btn-sair").onclick = sairDoSistema;

function entrarNoApp() {
  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("tela-senha").classList.add("oculto");
  document.getElementById("app").classList.remove("oculto");
  document.getElementById("user-nome").textContent = usuarioLogado.nome.trim().split(/\s+/)[0];
  document.getElementById("user-papel").textContent = papelLabel(usuarioLogado.papel);
  document.getElementById("user-iniciais").textContent = iniciais(usuarioLogado.nome);
  iniciarAvisos(); iniciarBuscaRapida();
  atualizarContexto().finally(async () => {
    await mostrar(TELA_INICIAL[usuarioLogado.papel]);
    if (usuarioLogado && !usuarioLogado.tutorial_visto) iniciarTutorial();
  });
}

// ---------- Sino de avisos (responsável): o que aconteceu com o filho e o que espera por você ----------
function iniciarAvisos() {
  const area = document.getElementById("avisos-area");
  area.classList.toggle("oculto", usuarioLogado.papel !== "pai");
  clearInterval(timerAvisos);
  if (usuarioLogado.papel !== "pai") return;
  avisosConhecidos = -1;
  atualizarContadorAvisos();
  timerAvisos = setInterval(atualizarContadorAvisos, 60000); // a cada minuto
  const botao = document.getElementById("btn-avisos"), painel = document.getElementById("avisos-painel");
  const fechar = () => { painel.classList.add("oculto"); botao.setAttribute("aria-expanded", "false"); };
  botao.onclick = seguro(async () => {
    if (!painel.classList.contains("oculto")) return fechar();
    painel.innerHTML = `<small style="padding:14px">Carregando...</small>`; painel.classList.remove("oculto"); botao.setAttribute("aria-expanded", "true");
    const r = await api("/api/avisos");
    desenharAvisos(r);
    await api("/api/avisos/vistos", { method: "POST", body: "{}" }); // abriu o sino: os avisos deixam de ser "novos"
    marcarContador(0); avisosConhecidos = 0;
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#avisos-area")) fechar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !painel.classList.contains("oculto")) { fechar(); botao.focus(); } });
}
function marcarContador(n) {
  const c = document.getElementById("avisos-contador");
  c.textContent = n > 9 ? "9+" : n; c.classList.toggle("oculto", !n);
  document.getElementById("btn-avisos").setAttribute("aria-label", n ? `Avisos: ${pl(n, "novo", "novos")}` : "Avisos");
}
async function atualizarContadorAvisos() {
  if (!usuarioLogado || usuarioLogado.papel !== "pai") return;
  try {
    const r = await api("/api/avisos");
    marcarContador(r.novos);
    // Aviso do navegador (se a pessoa permitiu): só quando chegou algo novo e a aba não está à vista
    if (avisosConhecidos >= 0 && r.novos > avisosConhecidos && document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = r.itens.find((i) => i.novo);
      if (n) new Notification("S.I.V.E.", { body: n.titulo, icon: "assets/favicon.png" });
    }
    avisosConhecidos = r.novos;
  } catch { /* tenta de novo no próximo minuto */ }
}
const iconeAviso = { entrada: "setaBaixo", saida: "setaCima", autorizacao: "caneta", comunicado: "megafone", ocorrencia: "prancheta", pendencia: "documento", evento: "calendario" };
function quandoRelativo(iso) {
  const d = new Date(iso), min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return "agora"; if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `há ${h} h`;
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}
function desenharAvisos(r) {
  const painel = document.getElementById("avisos-painel");
  const podeNotificar = "Notification" in window && Notification.permission === "default";
  painel.innerHTML = `<div class="avisos-topo"><b>Avisos</b><small>${r.novos ? pl(r.novos, "novo", "novos") : "Nenhum aviso novo"}</small></div>
    ${r.itens.length ? `<div class="avisos-lista">${r.itens.map((i, k) => `<button type="button" class="aviso ${i.novo ? "novo" : ""} ${i.acao ? "acao" : ""}" data-aviso="${k}">
      <span class="icone ${i.acao ? "warning" : "info"}">${ico(iconeAviso[i.tipo] || "sino")}</span>
      <span class="aviso-texto"><b>${esc(i.titulo)}</b><small>${esc(i.texto)} • ${quandoRelativo(i.quando)}</small></span></button>`).join("")}</div>`
      : `<div class="vazio" style="margin:12px"><small>Nada por aqui ainda. Entradas, saídas, comunicados e autorizações do seu filho aparecem neste sino.</small></div>`}
    ${podeNotificar ? `<button type="button" class="btn outline pequeno avisos-permitir" id="avisos-permitir">${ico("sino")} Receber avisos do navegador</button>` : ""}`;
  painel.querySelectorAll("[data-aviso]").forEach((b) => b.onclick = () => {
    const i = r.itens[Number(b.dataset.aviso)];
    painel.classList.add("oculto"); document.getElementById("btn-avisos").setAttribute("aria-expanded", "false");
    if (i.aluno_id && usuarioLogado.aluno_id !== i.aluno_id && (usuarioLogado.filhos || []).some((f) => f.id === i.aluno_id)) { usuarioLogado.aluno_id = i.aluno_id; desenharSeletorContexto(); }
    dados.abaPedida = i.destino.aba || null;
    mostrar(i.destino.tela);
  });
  const permitir = document.getElementById("avisos-permitir");
  if (permitir) permitir.onclick = async () => {
    const r2 = await Notification.requestPermission();
    avisar(r2 === "granted" ? "Pronto! Quando chegar um aviso e o S.I.V.E. estiver aberto em outra aba, o navegador avisa você." : "Tudo bem. Os avisos continuam aparecendo no sino.", r2 === "granted" ? "success" : "info");
    permitir.remove();
  };
}

// ---------- Busca rápida de aluno no topo (gestão: todos; professor: a turma aberta). Tecla "/" para buscar. ----------
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function iniciarBuscaRapida() {
  const caixa = document.getElementById("busca-rapida"), campo = document.getElementById("busca-rapida-campo"), lista = document.getElementById("busca-rapida-lista");
  const pode = ["admin", "professor"].includes(usuarioLogado.papel);
  caixa.classList.toggle("oculto", !pode);
  if (!pode) return;
  campo.placeholder = usuarioLogado.papel === "admin" ? "Buscar aluno... (tecla /)" : "Buscar aluno da turma... (tecla /)";
  buscaAlunos = null; let marcado = 0, achados = [];
  const carregar = async () => {
    if (buscaAlunos) return;
    buscaAlunos = usuarioLogado.papel === "admin" ? (await api("/api/alunos")).filter((a) => a.situacao === "Ativo")
      : (await api("/api/minha-turma")).alunos.map((a) => ({ ...a, sala: usuarioLogado.sala }));
  };
  const fechar = () => { lista.classList.add("oculto"); campo.setAttribute("aria-expanded", "false"); };
  const abrir = (a) => { campo.value = ""; fechar(); campo.blur(); abrirFicha(a.id, tela === "ficha" ? dados.fichaOrigem || "secretaria" : tela); };
  const desenhar = () => {
    const termo = semAcento(campo.value.trim());
    if (!termo) return fechar();
    achados = buscaAlunos.filter((a) => semAcento(a.nome).includes(termo)).slice(0, 8);
    marcado = Math.min(marcado, Math.max(achados.length - 1, 0));
    lista.innerHTML = achados.length ? achados.map((a, i) => `<button type="button" role="option" aria-selected="${i === marcado}" class="${i === marcado ? "marcado" : ""}" data-busca="${i}">
      <span class="avatar">${iniciais(a.nome)}</span><span><b>${esc(a.nome)}</b><small>${esc(a.sala)}</small></span></button>`).join("")
      : `<small style="padding:12px;display:block">Nenhum aluno com esse nome.</small>`;
    lista.classList.remove("oculto"); campo.setAttribute("aria-expanded", "true");
    lista.querySelectorAll("[data-busca]").forEach((b) => b.onmousedown = (e) => { e.preventDefault(); abrir(achados[Number(b.dataset.busca)]); });
  };
  campo.onfocus = seguro(carregar);
  campo.oninput = seguro(async () => { await carregar(); marcado = 0; desenhar(); });
  campo.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); marcado = Math.min(marcado + 1, achados.length - 1); desenhar(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); marcado = Math.max(marcado - 1, 0); desenhar(); }
    else if (e.key === "Enter" && achados[marcado]) { e.preventDefault(); abrir(achados[marcado]); }
    else if (e.key === "Escape") { campo.value = ""; fechar(); campo.blur(); }
  };
  campo.onblur = () => setTimeout(fechar, 150);
}
document.addEventListener("keydown", (e) => { // "/" abre a busca (como em muitos sistemas), se a pessoa não estiver digitando em outro campo
  if (e.key !== "/" || !usuarioLogado || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const campo = document.getElementById("busca-rapida-campo");
  if (!document.getElementById("busca-rapida").classList.contains("oculto") && !document.getElementById("app").classList.contains("oculto")) { e.preventDefault(); campo.focus(); }
});
// Busca os filhos (responsável) ou as turmas (professor) e mostra o seletor no topo quando houver mais de um
async function atualizarContexto() {
  if (["pai", "professor"].includes(usuarioLogado.papel)) {
    try {
      const c = await api("/api/meu-contexto");
      Object.assign(usuarioLogado, { filhos: c.filhos, turmas: c.turmas, aluno_id: c.aluno_id, sala: c.sala });
      localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    } catch { /* segue com o que já estava salvo */ }
  }
  desenharSeletorContexto();
}
function desenharSeletorContexto() {
  const sel = document.getElementById("seletor-contexto"), u = usuarioLogado;
  const opcoes = u.papel === "pai" ? (u.filhos || []).map((f) => [String(f.id), `${f.nome.split(" ")[0]} — ${f.sala}`])
    : u.papel === "professor" ? (u.turmas || []).map((t) => [t, t]) : [];
  sel.classList.toggle("oculto", opcoes.length < 2);
  sel.innerHTML = opcoes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  sel.value = u.papel === "pai" ? String(u.aluno_id) : u.sala || "";
  sel.setAttribute("aria-label", u.papel === "pai" ? "Escolher o filho" : "Escolher a turma");
  sel.title = u.papel === "pai" ? "Trocar de filho" : "Trocar de turma";
  sel.onchange = () => {
    if (u.papel === "pai") u.aluno_id = Number(sel.value); else { u.sala = sel.value; buscaAlunos = null; }
    localStorage.setItem("sive-usuario", JSON.stringify(u));
    mostrar(tela === "ficha" ? (u.papel === "pai" ? "pais" : "turma") : tela);
  };
}
// Mantém o login se a página for recarregada
const salvo = localStorage.getItem("sive-usuario");
if (salvo) {
  usuarioLogado = JSON.parse(salvo);
  if (usuarioLogado.senha_temporaria === undefined || usuarioLogado.aceite_ok === undefined) { localStorage.removeItem("sive-usuario"); usuarioLogado = null; }
}
if (usuarioLogado && codigoNaUrl() === null) seguirLogin(); // o link do QR code abre a verificação, mesmo com alguém logado neste navegador

// ---------- Política de privacidade (LGPD) ----------
// Ordem do primeiro acesso: trocar a senha provisória -> aceitar a política de privacidade -> usar o sistema.
async function seguirLogin() {
  if (usuarioLogado.senha_temporaria) return mostrarTelaSenha(true);
  if (!usuarioLogado.aceite_ok) return mostrarTermo("aceitar");
  if (usuarioLogado.configurar_2fa) return mostrarTela2fa();
  if (usuarioLogado.papel === "pai" && !consentPuladoNaSessao) { // consentimento do filho ainda pendente: pergunta antes de entrar
    try {
      const c = await api(`/api/alunos/${usuarioLogado.aluno_id}/consentimento`);
      if (c.status === "pendente") return mostrarConsentimento("primeiro");
    } catch (e) { if (e.message === "Sessão expirada" || e.message === "Aceite pendente") return; }
  }
  entrarNoApp();
}
function montarTexto(caixa, secoes) { // monta com textContent: o texto nunca é interpretado como HTML
  caixa.replaceChildren();
  for (const sec of secoes) {
    const h = document.createElement("h3"); h.textContent = sec.titulo; caixa.append(h);
    (sec.paragrafos || []).forEach((txt) => { const el = document.createElement("p"); el.textContent = txt; caixa.append(el); });
    if (sec.itens) { const ul = document.createElement("ul"); sec.itens.forEach((txt) => { const li = document.createElement("li"); li.textContent = txt; ul.append(li); }); caixa.append(ul); }
  }
}
async function mostrarTermo(modo) {
  const $ = (id) => document.getElementById(id);
  const aceitar = modo === "aceitar";
  if (!aceitar) origemTermo = usuarioLogado ? "app" : "login";
  ["tela-login", "tela-senha", "app"].forEach((id) => $(id).classList.add("oculto"));
  $("tela-termo").classList.remove("oculto");
  $("form-termo").classList.toggle("oculto", !aceitar);
  $("termo-voltar").classList.toggle("oculto", aceitar);
  $("termo-aviso").classList.toggle("oculto", !aceitar);
  $("termo-aviso").textContent = "Para continuar, leia e aceite a política de privacidade.";
  $("termo-check").checked = false; $("termo-erro").classList.add("oculto");
  const caixa = $("termo-texto");
  try {
    const p = await (await fetch("/api/privacidade")).json();
    $("termo-versao").textContent = `Versão ${p.versao} • ${p.atualizada_em}`;
    caixa.replaceChildren();
    montarTexto(caixa, p.secoes);
  } catch { caixa.textContent = "Não foi possível carregar a política de privacidade."; }
}
document.getElementById("link-privacidade").onclick = () => mostrarTermo("ler");
document.getElementById("btn-privacidade").onclick = () => mostrarTermo("ler");
document.getElementById("termo-voltar").onclick = () => {
  document.getElementById("tela-termo").classList.add("oculto");
  document.getElementById(origemTermo === "app" ? "app" : "tela-login").classList.remove("oculto");
};
document.getElementById("termo-sair").onclick = () => { document.getElementById("tela-termo").classList.add("oculto"); sair(); };
document.getElementById("form-termo").onsubmit = async (e) => {
  e.preventDefault();
  const erro = document.getElementById("termo-erro");
  if (!document.getElementById("termo-check").checked) { erro.textContent = "Marque a caixa para confirmar que você leu e concorda."; erro.classList.remove("oculto"); return; }
  try {
    await api("/api/aceite-privacidade", { method: "POST", body: "{}" });
    usuarioLogado.aceite_ok = true;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    document.getElementById("tela-termo").classList.add("oculto");
    seguirLogin();
  } catch (err) { erro.textContent = err.message; erro.classList.remove("oculto"); }
};

// ---------- Termo de consentimento dos responsáveis (imagem e informações do aluno) ----------
async function mostrarConsentimento(modo) { // modo "primeiro" (logo após o login) ou "alterar" (pelo Portal da Família)
  const $ = (id) => document.getElementById(id);
  const alunoId = usuarioLogado.aluno_id;
  const [termo, estado, filho] = await Promise.all([fetch("/api/consentimento-termo").then((r) => r.json()), api(`/api/alunos/${alunoId}/consentimento`), api(`/api/alunos/${alunoId}`)]);
  ["tela-login", "tela-senha", "tela-termo", "app"].forEach((id) => $(id).classList.add("oculto"));
  $("tela-consent").classList.remove("oculto");
  $("cons-versao").textContent = `Versão ${termo.versao} • ${termo.atualizado_em}`;
  $("cons-aluno").textContent = filho.nome;
  $("cons-aviso").textContent = estado.status === "pendente"
    ? "A escola precisa saber o que você autoriza sobre o uso de imagem e informações do seu filho. Leia o termo e escolha."
    : "Você pode alterar ou revogar o que autorizou. Cada alteração fica registrada com data e código.";
  $("cons-depois").textContent = modo === "primeiro" ? "Responder depois" : "Cancelar";
  $("cons-depois").onclick = () => { if (modo === "primeiro") consentPuladoNaSessao = true; $("tela-consent").classList.add("oculto"); entrarNoApp(); };
  montarTexto($("cons-texto"), termo.secoes);
  const lista = $("cons-opcoes"); lista.replaceChildren();
  for (const o of termo.opcoes) {
    const rotulo = document.createElement("label"); rotulo.className = "termo-aceite";
    const caixa = document.createElement("input"); caixa.type = "checkbox"; caixa.dataset.opcao = o.id; caixa.checked = !!(estado.atual && estado.atual[o.id]);
    const texto = document.createElement("span"); texto.textContent = o.rotulo;
    const detalhe = document.createElement("small"); detalhe.style.display = "block"; detalhe.textContent = o.detalhe; texto.append(detalhe);
    rotulo.append(caixa, texto); lista.append(rotulo);
  }
  $("cons-confirmo").checked = false; $("cons-senha").value = ""; $("cons-erro").classList.add("oculto");
}
document.getElementById("form-consent").onsubmit = async (e) => {
  e.preventDefault();
  const $ = (id) => document.getElementById(id), erro = $("cons-erro");
  erro.classList.add("oculto");
  const escolhas = {};
  document.querySelectorAll("#cons-opcoes input").forEach((c) => { escolhas[c.dataset.opcao] = c.checked; });
  if (!$("cons-confirmo").checked) { erro.textContent = "Marque “Li o termo e confirmo minhas escolhas” para assinar."; erro.classList.remove("oculto"); return; }
  if (!Object.values(escolhas).some(Boolean) && !(await confirmar({ titulo: "Não autorizar nenhum item?", texto: "Você deixou todos os itens desmarcados. A escola não vai usar as informações nem as imagens do seu filho no sistema. Você pode mudar isso depois no Portal da Família.", botao: "Sim, não autorizo" }))) return;
  try {
    await api(`/api/alunos/${usuarioLogado.aluno_id}/consentimento`, { method: "POST", body: JSON.stringify({ ...escolhas, confirmo: true, senha: $("cons-senha").value }) });
    $("cons-confirmo").checked = false; $("cons-senha").value = "";
    avisar("Termo assinado. Você pode alterar ou revogar quando quiser.");
    $("tela-consent").classList.add("oculto");
    entrarNoApp();
  } catch (err) { if (err.message !== "Sessão expirada") { erro.textContent = err.message; erro.classList.remove("oculto"); } }
};
// cartão do Portal da Família
function cartaoConsentimento() {
  const c = dados.ficha.consentimento, [rotulo, tom] = statusConsent[c.status], a = c.atual;
  const itens = a ? `<small>${sinal(a.informacoes)} Informações do aluno no sistema</small><small>${sinal(a.imagem)} Imagens (fotos) do aluno no sistema</small><small>${sinal(a.monitoramento)} Câmeras de segurança e reconhecimento facial</small>` : "";
  return `<section class="card" style="margin-top:20px"><div class="linha" style="gap:8px;flex-wrap:wrap"><h2>Consentimento (imagem e informações)</h2>${pill(rotulo, tom)}</div>
    ${a ? `<small>Assinado por ${esc(a.assinado_nome)} em ${a.assinado_em}.${a.codigo ? ` <a class="selo-link" href="/?verificar=${encodeURIComponent(a.codigo)}" target="_blank" rel="noopener">Verificar assinatura</a>` : ""}</small>${itens}`
        : "<small>A escola precisa da sua autorização para usar as informações e as imagens do seu filho no sistema. Leia o termo e escolha o que você autoriza.</small>"}
    <div class="acoes" style="margin-top:10px"><button class="btn pequeno" data-consent="alterar">${a ? "Alterar ou revogar" : "Ler o termo e responder"}</button>${a ? '<button class="btn outline pequeno" data-consent="comprovante">Ver comprovante</button>' : ""}</div></section>`;
}
// situação do consentimento na ficha (gestão e professor)
function consentimentoNaFicha(f) {
  const c = f.consentimento; if (!c) return "";
  const [rotulo, tom] = statusConsent[c.status], a = c.atual;
  const detalhe = a ? ` <small>${sinal(a.informacoes)} informações • ${sinal(a.imagem)} imagens • ${sinal(a.monitoramento)} câmeras e reconhecimento facial</small>` : "";
  return `<small style="margin-top:10px;font-weight:700;text-transform:uppercase">Consentimento dos responsáveis</small><span>${pill(rotulo, tom)}${detalhe}</span>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-consent]"); if (!b) return;
  if (b.dataset.consent === "alterar") seguro(() => mostrarConsentimento("alterar"))();
  if (b.dataset.consent === "comprovante") seguro(() => abrirComprovanteConsentimento(dados.ficha.consentimento.atual, dados.ficha.aluno))();
});
// Quadro dos comprovantes: QR code e endereço para qualquer pessoa conferir a assinatura (página "Verificar assinatura")
function blocoVerificacao(codigo) {
  if (!codigo) return "";
  const endereco = `${location.origin}/?verificar=${encodeURIComponent(codigo)}`;
  return `<div style="display:flex;gap:16px;align-items:center;border:1px solid var(--border,#EAD6CA);border-radius:8px;padding:12px;margin:16px 0">
    <img src="${location.origin}/api/verificar/${encodeURIComponent(codigo)}/qr.svg" width="120" height="120" alt="QR code para verificar a assinatura">
    <div><b>Confira a autenticidade</b><br>Leia o QR code ou acesse:<br><span style="word-break:break-all">${esc(endereco)}</span><br>
    <small style="color:var(--muted-fg,#5B5278)">Assinatura eletrônica confirmada com senha e protegida por selo criptográfico (Ed25519) do sistema. Qualquer alteração no documento depois da assinatura é detectada na verificação.</small></div></div>`;
}
async function abrirComprovanteConsentimento(c, aluno) {
  const w = window.open("", "_blank");
  if (!w) { avisar("O navegador bloqueou a janela do comprovante. Permita pop-ups para este site e tente de novo.", "danger"); return; }
  const termo = await (await fetch("/api/consentimento-termo")).json();
  const linhas = termo.opcoes.map((o) => `<tr><td>${esc(o.curto)}</td><td><b>${c[o.id] ? ico("confere") + " Autorizo" : ico("proibido") + " Não autorizo"}</b></td></tr>`).join("");
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante ${esc(c.codigo)}</title>
    <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#140040}h1{font-size:1.375rem}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:10px;border-bottom:1px solid #EAD6CA}td:first-child{color:#5B5278;width:48%}.cod{font-size:1.25rem;letter-spacing:2px;font-weight:700}@media print{button{display:none}}</style></head><body>
    <h1>${ico("escudoOk")} S.I.V.E. — Comprovante de consentimento</h1>
    <table aria-label="Dados do consentimento"><tr><td>Termo</td><td>${esc(termo.titulo)} (versão ${esc(c.versao || termo.versao)})</td></tr>
    <tr><td>Aluno(a)</td><td>${esc(aluno.nome)} — ${esc(aluno.sala)}</td></tr><tr><td>Assinado por</td><td>${esc(c.assinado_nome)}</td></tr>
    <tr><td>Data e hora</td><td>${esc(c.assinado_em)}</td></tr><tr><td>Código de verificação</td><td class="cod">${esc(c.codigo)}</td></tr></table>
    <h3>Escolhas do responsável</h3><table aria-label="Escolhas do responsável">${linhas}</table>
    ${blocoVerificacao(c.codigo)}<p>Documento gerado pelo sistema S.I.V.E. O consentimento foi confirmado com a senha do responsável e pode ser alterado ou revogado a qualquer momento no Portal da Família.</p><button id="imprimir">Imprimir</button></body></html>`);
  w.document.close();
  w.document.getElementById("imprimir").addEventListener("click", () => w.print());
}
// tela da gestão: situação de todos os alunos
function telaConsentimentos() {
  const r = dados.consents.resumo;
  const resumo = [["Autorizados", r.autorizado, "success"], ["Em parte", r.parcial, "warning"], ["Não autorizados", r.nao_autorizado, "danger"], ["Pendentes", r.pendente, "warning"]].map(([n, v, tom]) => pill(`${n}: ${v}`, tom)).join(" ");
  const linhas = dados.consents.alunos.map((a) => {
    const [rotulo, tom] = statusConsent[a.status], marca = (v) => (a.status === "pendente" ? "—" : sinal(v));
    return `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${pill(rotulo, tom)}</td><td>${marca(a.informacoes)}</td><td>${marca(a.imagem)}</td><td>${marca(a.monitoramento)}</td><td>${a.assinado_nome ? `${esc(a.assinado_nome)}<small>${a.assinado_em}</small>` : "—"}</td></tr>`;
  }).join("");
  return `<div class="topo"><h2>Consentimento dos responsáveis</h2><small>Uso de imagem e informações dos alunos (termo versão ${esc(dados.consents.versao)}). Cada responsável assina pelo Portal da Família.</small></div>
  <section class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${resumo}</div>
  <div class="tabela"><table><caption class="so-leitor">Consentimento dos responsáveis por aluno</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Turma</th><th scope="col">Situação</th><th scope="col">Informações</th><th scope="col">Imagens</th><th scope="col">Câmeras</th><th scope="col">Assinado por</th></tr></thead><tbody>${linhas}</tbody></table></div></section>`;
}

// ---------- Proteção da criança: comunicações ao Conselho Tutelar (ECA arts. 13 e 56; LDB art. 12, VIII) ----------
const motivosProtecao = { "Maus-tratos": "Suspeita ou confirmação de maus-tratos", Faltas: "Faltas reiteradas / evasão escolar", Outro: "Outro motivo de proteção" };
const hojeLocalISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function telaProtecao() {
  const ehAdmin = usuarioLogado.papel === "admin", p = dados.protecao;
  const motivos = (ehAdmin ? ["Maus-tratos", "Faltas", "Outro"] : ["Maus-tratos", "Outro"]).map((m) => `<option value="${m}">${motivosProtecao[m]}</option>`).join("");
  const alunos = opcoesAlunos(dados.alunosProtecao, usuarioLogado.sala);
  const msg = dados.protecaoMsg || ""; dados.protecaoMsg = "";
  return `<div class="topo"><h2>Proteção da criança</h2><small>Comunicações ao Conselho Tutelar e registros sigilosos.</small></div>
  <section class="card" style="margin-bottom:16px"><b>Por que esta tela existe</b>
    <small>• <b>ECA, art. 13:</b> casos de suspeita ou confirmação de maus-tratos devem ser comunicados ao Conselho Tutelar. Deixar de comunicar é infração administrativa (art. 245).</small>
    <small>• <b>ECA, art. 56:</b> o dirigente da escola comunica ao Conselho Tutelar os maus-tratos e as faltas reiteradas ou a evasão, depois de esgotados os recursos da escola.</small>
    <small>• <b>Quer saber mais?</b> <a href="https://www.planalto.gov.br/ccivil_03/leis/l8069.htm" target="_blank" rel="noopener noreferrer" class="link-eca">Leia o ECA completo (Lei nº 8.069/1990) no site oficial do Planalto ${ico("externo")}</a><span class="so-leitor"> (abre em outra aba)</span></small>
    <small>• <b>Sigilo:</b> estes registros não aparecem para os responsáveis nem para outros docentes. Cada consulta e cada registro ficam registrados.</small></section>
  ${ehAdmin && p.pendentes ? `<p class="pill danger" style="white-space:normal;margin-bottom:14px">${ico("aviso")} ${pl(p.pendentes, "registro aguardando", "registros aguardando")} a comunicação ao Conselho Tutelar.</p>` : ""}
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  <form id="form-protecao" class="card" style="margin-bottom:16px">
    <b>Registrar um caso</b>
    <div class="grade dois" style="margin-top:10px"><label class="campo-bloco"><small>Turma e aluno</small><select id="pro-aluno" data-filtro-turma required><option value="">Escolha o aluno...</option>${alunos}</select></label>
      <label class="campo-bloco"><small>Motivo</small><select id="pro-motivo">${motivos}</select></label></div>
    <label class="campo-bloco" style="margin-top:10px"><small>Fatos observados (o que viu ou ouviu, quando e onde; sem julgamentos)</small><textarea id="pro-descricao" rows="4" maxlength="1500" required></textarea></label>
    <label class="campo-bloco" style="margin-top:10px"><small>Medidas já adotadas pela escola (opcional)</small><textarea id="pro-medidas" rows="2" maxlength="1500"></textarea></label>
    <label class="termo-aceite oculto" id="pro-esgotados-box"><input type="checkbox" id="pro-esgotados"> <span>Os recursos da escola foram esgotados (contatos e visitas com a família estão descritos acima).</span></label>
    <p id="pro-erro" class="pill danger oculto" style="margin-top:10px;white-space:normal"></p>
    <button class="btn" type="submit" style="margin-top:12px;max-width:240px">Registrar</button>
  </form>
  <div id="protecao-lista"></div><div id="protecao-limite"></div>`;
}
function ligarProtecao() {
  const $ = (id) => document.getElementById(id);
  const sincronizar = () => $("pro-esgotados-box").classList.toggle("oculto", $("pro-motivo").value !== "Faltas");
  $("pro-motivo").onchange = sincronizar; sincronizar();
  $("form-protecao").onsubmit = async (e) => {
    e.preventDefault(); $("pro-erro").classList.add("oculto");
    try {
      await api("/api/protecao", { method: "POST", body: JSON.stringify({ aluno_id: Number($("pro-aluno").value), motivo: $("pro-motivo").value,
        descricao: $("pro-descricao").value, medidas: $("pro-medidas").value, recursos_esgotados: $("pro-esgotados").checked }) });
      dados.protecaoMsg = "Registro salvo. Ele é sigiloso e fica pendente até a gestão comunicar ao Conselho Tutelar.";
      await mostrar("protecao");
    } catch (erro) { if (erro.message !== "Sessão expirada") { $("pro-erro").textContent = erro.message; $("pro-erro").classList.remove("oculto"); } }
  };
  desenharProtecao();
}
function desenharProtecao() {
  const ehAdmin = usuarioLogado.papel === "admin", itens = dados.protecao.itens;
  const cartao = (i) => `<article class="card" style="margin-bottom:12px;${i.pendente ? "border-left:4px solid var(--danger)" : ""}">
    <div class="linha" style="flex-wrap:wrap;gap:8px">
      <div class="aluno"><span class="avatar">${iniciais(i.aluno_nome)}</span><div><b>${esc(i.aluno_nome)}</b><small>${esc(i.aluno_sala)} • registrado em ${i.registrada_em} por ${esc(i.registrada_por)}</small></div></div>
      <div>${pill(motivosProtecao[i.motivo], i.motivo === "Maus-tratos" ? "danger" : "warning")} ${i.pendente ? pill(`Pendente de comunicação${i.dias_registro ? " há " + pl(i.dias_registro, "dia", "dias") : ""}`, "danger") : pill("Comunicado ao Conselho Tutelar", "success")}</div>
    </div>
    <div class="nota"><small><b>Fatos</b></small>${esc(i.descricao)}</div>
    ${i.medidas ? `<div class="nota"><small><b>Medidas adotadas pela escola</b></small><span style="white-space:pre-line">${esc(i.medidas)}</span></div>` : ""}
    ${i.pendente
      ? (ehAdmin ? `<div class="grade dois" style="margin-top:10px"><label class="campo-bloco"><small>Data em que comunicou ao Conselho Tutelar</small><input type="date" data-ct-data="${i.id}" value="${hojeLocalISO()}" max="${hojeLocalISO()}"></label>
          <label class="campo-bloco"><small>Protocolo ou nº do ofício (se houver)</small><input data-ct-protocolo="${i.id}" maxlength="60"></label></div>
          <div class="acoes"><button class="btn pequeno" data-ct-comunicar="${i.id}">Registrar que comunicou ao Conselho Tutelar</button></div>`
        : "<small>Aguardando a gestão comunicar ao Conselho Tutelar.</small>")
      : `<small style="margin-top:8px">Comunicado em ${i.comunicado_em} por ${esc(i.comunicado_por)}${i.protocolo ? " • protocolo " + esc(i.protocolo) : ""}</small>`}
  </article>`;
  document.getElementById("protecao-lista").innerHTML = `<div class="topo"><h2>${ehAdmin ? "Registros" : "Meus registros"} (${itens.length})</h2></div>` +
    (itens.length ? itens.map(cartao).join("") : `<div class="vazio"><b>Nenhum registro</b><small>Quando um caso for registrado, ele aparece aqui.</small></div>`);
  document.querySelectorAll("[data-ct-comunicar]").forEach((b) => b.onclick = seguro(async () => {
    const id = b.dataset.ctComunicar;
    await api(`/api/protecao/${id}/comunicado`, { method: "PUT", body: JSON.stringify({ data: document.querySelector(`[data-ct-data="${id}"]`).value, protocolo: document.querySelector(`[data-ct-protocolo="${id}"]`).value.trim() }) });
    dados.protecaoMsg = "Comunicação ao Conselho Tutelar registrada.";
    await mostrar("protecao");
  }));
  const l = dados.limiteFaltas;
  if (ehAdmin && l) {
    const virgula = (n) => String(n).replace(".", ",");
    document.getElementById("protecao-limite").innerHTML = `<section class="card" style="margin-top:24px"><h2>Alunos acima do limite de faltas</h2>
      <small>LDB, art. 12, VIII: a escola notifica ao Conselho Tutelar os alunos com faltas acima de 30% do percentual permitido em lei. Como a frequência mínima é 75% (faltas permitidas: 25%), o limite aqui é ${virgula(l.percentual)}% das aulas com chamada registrada no sistema. Confira a regra da sua rede de ensino.</small>
      ${l.alunos.length ? `<div class="tabela"><table><caption class="so-leitor">Alunos acima do limite de faltas</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Turma</th><th scope="col">Dias com chamada</th><th scope="col">Faltas</th><th scope="col">%</th><th scope="col">Conselho Tutelar</th></tr></thead><tbody>${l.alunos.map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${a.dias}</td><td>${a.faltas}</td><td>${pill(virgula(a.percentual) + "%", "danger")}</td><td>${a.comunicado ? pill("Comunicado", "success") : pill("Ainda não comunicado", "warning")}</td></tr>`).join("")}</tbody></table></div>`
        : '<div class="vazio"><b>Nenhum aluno acima do limite</b></div>'}</section>`;
  }
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-ir-protecao]")) seguro(() => mostrar("protecao"))(); });

// ---------- Troca de senha (forçada no primeiro acesso, ou voluntária pelo botão da chave) ----------
function mostrarTelaSenha(forcado) {
  forcarTrocaSenha = forcado;
  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("app").classList.add("oculto");
  document.getElementById("tela-senha").classList.remove("oculto");
  document.getElementById("senha-subtitulo").textContent = !forcado ? "Atualize sua senha quando quiser."
    : usuarioLogado.senha_fraca ? "Sua senha não segue as regras de segurança: crie uma nova para continuar."
    : "Sua senha é provisória: crie uma nova para continuar.";
  document.getElementById("senha-cancelar").classList.toggle("oculto", forcado);
  document.getElementById("senha-erro").classList.add("oculto");
}
document.getElementById("btn-trocar-senha").onclick = () => mostrarTelaSenha(false);
document.getElementById("senha-cancelar").onclick = () => {
  document.getElementById("tela-senha").classList.add("oculto");
  document.getElementById("app").classList.remove("oculto");
};
document.getElementById("form-senha").onsubmit = async (e) => {
  e.preventDefault();
  const erroBox = document.getElementById("senha-erro");
  erroBox.classList.add("oculto");
  const nova = document.getElementById("senha-nova").value;
  const confirmar = document.getElementById("senha-confirmar").value;
  if (nova !== confirmar) { erroBox.textContent = "As duas senhas não são iguais."; erroBox.classList.remove("oculto"); return; }
  try {
    const r = await api("/api/minha-senha", { method: "PUT", body: JSON.stringify({
      senha_atual: document.getElementById("senha-atual").value, senha_nova: nova,
    }) });
    usuarioLogado.token = r.token; // os outros aparelhos saem; este continua com o login novo
    usuarioLogado.senha_temporaria = false; usuarioLogado.senha_fraca = false;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    document.getElementById("form-senha").reset();
    document.getElementById("tela-senha").classList.add("oculto");
    if (forcarTrocaSenha) seguirLogin(); else document.getElementById("app").classList.remove("oculto");
  } catch (erro) {
    erroBox.textContent = erro.message;
    erroBox.classList.remove("oculto");
  }
};

// ---------- Verificação em duas etapas (gestão): aplicativo autenticador, e-mail ou SMS/WhatsApp ----------
async function trocarMetodo2fa() {
  const $ = (id) => document.getElementById(id), metodo = document.querySelector('[name="dois-metodo"]:checked').value, app = metodo === "app";
  $("dois-app").classList.toggle("oculto", !app);
  $("dois-email").classList.toggle("oculto", metodo !== "email");
  $("dois-telefone").classList.toggle("oculto", metodo !== "telefone");
  $("dois-enviar").classList.toggle("oculto", app);
  $("dois-codigo-caixa").classList.toggle("oculto", !app); // no e-mail e no celular, o campo só aparece depois de enviar
  ["dois-erro", "dois-aviso"].forEach((id) => $(id).classList.add("oculto"));
  $("dois-codigo").value = "";
  $("dois-codigo-rotulo").textContent = app ? "3. Digite o código de 6 números que aparece no aplicativo." : "Digite o código de 6 números que você recebeu.";
  if (!app) return;
  try {
    const r = await api("/api/2fa/novo", { method: "POST", body: JSON.stringify({ metodo: "app" }) });
    $("dois-qr").innerHTML = r.qr; // SVG gerado pelo próprio servidor
    $("dois-segredo").textContent = r.segredo.match(/.{1,4}/g).join(" ");
    $("dois-codigo").focus();
  } catch (e) { if (e.message !== "Sessão expirada") mostrarErro("dois-erro", e.message); }
}
async function mostrarTela2fa() {
  const $ = (id) => document.getElementById(id);
  ["tela-login", "tela-senha", "tela-termo", "app"].forEach((id) => $(id).classList.add("oculto"));
  $("tela-2fa").classList.remove("oculto");
  document.querySelector('[name="dois-metodo"][value="app"]').checked = true;
  await trocarMetodo2fa();
}
document.querySelectorAll('[name="dois-metodo"]').forEach((opcao) => { opcao.onchange = trocarMetodo2fa; });
document.getElementById("dois-enviar").onclick = async () => {
  const $ = (id) => document.getElementById(id), porEmail = document.querySelector('[name="dois-metodo"]:checked').value === "email";
  $("dois-erro").classList.add("oculto"); $("dois-aviso").classList.add("oculto");
  $("dois-enviar").disabled = true;
  try {
    const r = await api("/api/2fa/novo", { method: "POST", body: JSON.stringify({ metodo: porEmail ? "email" : $("dois-canal").value, destino: $(porEmail ? "dois-email-campo" : "dois-telefone-campo").value.trim() }) });
    $("dois-aviso").textContent = `Enviamos um código para ${r.destino}. Ele vale por 10 minutos.${r.simulado ? " Envio simulado: veja o terminal do servidor." : ""}`;
    $("dois-aviso").classList.remove("oculto"); $("dois-codigo-caixa").classList.remove("oculto"); $("dois-codigo").focus();
  } catch (e) { if (e.message !== "Sessão expirada") mostrarErro("dois-erro", e.message); }
  finally { $("dois-enviar").disabled = false; }
};
document.getElementById("dois-ativar").onclick = async () => {
  const $ = (id) => document.getElementById(id);
  $("dois-erro").classList.add("oculto");
  try {
    await api("/api/2fa/ativar", { method: "POST", body: JSON.stringify({ codigo: $("dois-codigo").value }) });
    usuarioLogado.configurar_2fa = false;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    $("tela-2fa").classList.add("oculto");
    seguirLogin();
  } catch (e) { if (e.message !== "Sessão expirada") mostrarErro("dois-erro", e.message); }
};
document.getElementById("dois-codigo").onkeydown = (e) => { if (e.key === "Enter") document.getElementById("dois-ativar").click(); };
document.getElementById("dois-sair").onclick = () => sairDoSistema();

// ---------- Histórico de presença (usado pelo Portal da Família e pela Frequência) ----------
function blocoHistorico(h) {
  const estat = (rotulo, valor) => `<div class="card" style="padding:12px;text-align:center"><small>${rotulo}</small><b style="font-size:1.375rem;display:block">${valor}</b></div>`;
  const lista = h.registros.length
    ? h.registros.map((r) => `<div class="hist ${r.status === "Ausente" ? "ausente" : ""}"><span class="ponto"></span><div><b style="font-size:0.875rem">${dataCurta(r.data)}</b><small>${esc(r.observacao)}</small></div>${pill(r.status, r.status === "Presente" ? "success" : "warning")}</div>`).join("")
    : `<div class="vazio"><small>Nenhum registro nos últimos ${h.dias} dias.</small></div>`;
  return `<div class="grade g3" style="margin:12px 0">${estat("Frequência", pct(h.percentual))}${estat("Presenças", h.presencas)}${estat("Faltas", h.faltas)}</div><div class="rolagem">${lista}</div>`;
}

// ---------- Tela da Secretaria ----------
function metrica(icone, rotulo, valor, nota, tom, tag) {
  return `<article class="card metrica"><div class="linha"><div class="icone ${tom}">${icone}</div><small>${tag}</small></div>
    <small>${rotulo}</small><div class="num">${valor}</div><small>${nota}</small></article>`;
}
function alerta(icone, n, titulo, texto, tom, ir) {
  return `<button class="card alerta" ${ir ? `data-ir="${ir}"` : ""}><span class="icone ${tom}">${icone}</span><span><b>${titulo}</b><small>${texto}</small></span><span class="num">${n}</span></button>`;
}
function telaSecretaria() {
  const r = dados.resumo;
  const tag = r.eh_hoje ? "Hoje" : dataCurta(r.data);
  const aviso = r.eh_hoje ? "" : r.fim_de_semana ? ` Hoje não tem aula: mostrando o último dia letivo (${dataCurta(r.data)}).` : ` Mostrando o último dia com chamada registrada (${dataCurta(r.data)}).`;
  const comRegistro = r.presentes + r.ausentes;
  return `<div class="topo"><p class="destaque">Visão geral</p><h2>${saudacao()}, ${esc(usuarioLogado.nome.split(" ")[0])}</h2><small>Acompanhe os indicadores e prioridades da escola.${aviso}</small></div>
  ${r.professores_inativos ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning)"><div class="linha" style="flex-wrap:wrap;gap:8px"><b>${ico("pessoa")} ${pl(r.professores_inativos, "docente inativado", "docentes inativados")} por ${r.inatividade_dias} dias sem acessar${r.reativacoes_pedidas ? ` • ${r.reativacoes_pedidas} ${r.reativacoes_pedidas === 1 ? "pediu" : "pediram"} reativação` : ""}</b><button class="btn pequeno" data-ir="usuarios" style="width:auto">Ver em Usuários</button></div><small>O acesso é suspenso sozinho depois de ${r.inatividade_dias} dias sem uso. A gestão reativa com uma senha provisória nova.</small></div>` : ""}
  ${r.senhas_pedidas ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning)"><div class="linha" style="flex-wrap:wrap;gap:8px"><b>${ico("chave")} ${pl(r.senhas_pedidas, "pedido", "pedidos")} de senha nova</b><button class="btn pequeno" data-ir="usuarios" style="width:auto">Ver em Usuários</button></div><small>Confirme quem pediu antes de gerar a senha provisória.</small></div>` : ""}
  ${r.comunicacoes_pendentes ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)"><div class="linha" style="flex-wrap:wrap;gap:8px"><b>${ico("aviso")} ${r.comunicacoes_pendentes === 1 ? "1 comunicação ao Conselho Tutelar pendente" : r.comunicacoes_pendentes + " comunicações ao Conselho Tutelar pendentes"}</b><button class="btn pequeno" data-ir-protecao style="width:auto">Abrir Proteção</button></div><small>O ECA (arts. 13 e 56) pede que casos de maus-tratos e de faltas reiteradas sejam comunicados ao Conselho Tutelar.</small></div>` : ""}
  <div class="grade g3">
    ${metrica(ico("familia"), "Total de alunos", r.total_alunos, "alunos cadastrados", "info", "Escola")}
    <article class="card metrica"><div class="linha"><div class="icone success">${ico("confere")}</div><small>${tag}</small></div>
      <small>Presentes e ausentes</small>
      <div class="linha" style="gap:24px;align-items:flex-end;justify-content:flex-start;flex-wrap:wrap">
        <div><div class="num">${r.presentes}</div><small>${ico("confere", "ok")} Presentes</small></div>
        <div><div class="num">${r.ausentes}</div><small>${ico("aviso")} Ausentes • ${r.busca_ativa} em Busca Ativa</small></div>
      </div>
      <small>${!comRegistro ? "Nenhuma chamada registrada ainda" : `${pct(r.percentual)} de presença entre ${pl(comRegistro, "aluno", "alunos")} com registro`}</small>
      ${r.sem_registro ? `<small class="nota-alerta">${ico("aviso")} ${pl(r.sem_registro, "aluno", "alunos")} ainda sem registro neste dia</small>` : ""}</article>
    <button type="button" class="card metrica clicavel" data-ir="ocorrencias-gestao" title="Abrir a pasta de ocorrências">
      <span class="linha"><span class="icone info">${ico("prancheta")}</span><small>${ico("pasta")} Abrir pasta</small></span>
      <small>Ocorrências</small><span class="num" id="oc-gestao-num">${r.ocorrencias_gestao}</span>
      <small id="oc-gestao-nota">${notaOcorrenciasGestao(r.ocorrencias_gestao, r.ocorrencias_sem_resp)}</small></button>
  </div>
  <div class="topo"><h2>Atenção necessária</h2><small>Pendências que precisam de acompanhamento.</small></div>
  <div class="grade g3">
    ${alerta(ico("aviso"), r.busca_ativa, "Crianças em busca ativa", "Por excesso de faltas", "danger", "busca")}
    ${alerta(ico("pasta"), r.documentos_recentes, "Documentos recebidos recentemente", "Enviados pelos responsáveis (24h)", "warning", "docs-recentes")}
    ${alerta(ico("caneta"), r.autorizacoes_recentes, "Autorizações recebidas recentemente", "Assinadas nas últimas 24h", "info", "autorizacoes")}
  </div>
  ${blocoBanners()}
  <section class="card"><div class="linha" style="flex-wrap:wrap;gap:12px"><div><h2>Gestão de alunos</h2><small>Clique nos títulos para ordenar e abra a ficha de cada aluno.</small></div>
    <div class="linha" style="gap:16px;flex-wrap:wrap;justify-content:flex-end">
      <select id="g-filtro" aria-label="Filtrar alunos" style="width:auto"><option value="todos">Todos os alunos</option><option value="pendencias">Com pendências</option><option value="aut">Autorização pendente</option><option value="comunicados">Comunicado não lido</option><option value="adv">Com advertências</option></select>
      <select id="g-turma" class="filtro-turma-tabela" aria-label="Filtrar por turma" style="width:auto"><option value="">Todas as turmas</option>${turmasDe(dados.gestao).map((s) => `<option${s === dados.turmaGestao ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <input id="busca" class="campo-busca" aria-label="Buscar aluno" placeholder="Buscar aluno..." style="width:240px;max-width:100%"></div></div>
    <div class="tabela"><table><caption class="so-leitor">Gestão de alunos</caption><thead><tr>
      <th scope="col" class="ord" data-ord="nome">Nome da criança <span class="seta"></span></th><th scope="col" class="ord" data-ord="novos">Comunicados <span class="seta"></span></th>
      <th scope="col" class="ord" data-ord="aut">Autorizações <span class="seta"></span></th><th scope="col" class="ord" data-ord="pend">Pendências <span class="seta"></span></th>
      <th scope="col" class="ord" data-ord="adv">Ações e advertências <span class="seta"></span></th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead>
    <tbody id="linhas"></tbody></table></div><small id="g-contagem" style="margin-top:8px"></small></section>
  <div id="modal-docs" class="modal oculto" role="dialog" aria-modal="true" aria-labelledby="modal-docs-titulo">
    <div class="modal-caixa pasta-modal">
      <div class="linha"><h2 id="modal-docs-titulo">${ico("pasta")} Documentos recebidos recentemente</h2>
        <button type="button" class="btn outline pequeno" id="docs-fechar" aria-label="Fechar" style="width:auto">✕</button></div>
      <small style="margin:4px 0 12px">Documentos de pendências enviados pelos responsáveis. Cada um fica nesta pasta por 24 horas e continua guardado na ficha do aluno.</small>
      <div id="docs-lista"></div>
    </div>
  </div>
  <div id="modal-oc" class="modal oculto" role="dialog" aria-modal="true" aria-labelledby="modal-oc-titulo">
    <div class="modal-caixa pasta-modal">
      <div class="linha"><h2 id="modal-oc-titulo">${ico("pasta")} Ocorrências</h2>
        <button type="button" class="btn outline pequeno" id="oc-fechar" aria-label="Fechar" style="width:auto">✕</button></div>
      <div id="oc-conteudo"></div>
    </div>
  </div>`;
}
// ---------- Pasta de ocorrências da gestão: recebe o que os professores registram; a gestão abre cada uma e assina ----------
function notaOcorrenciasGestao(n, semResp) {
  if (!n) return "Nenhuma aguardando a gestão";
  return `aguardando a assinatura da gestão${semResp ? ` • ${semResp} sem a do responsável` : ""}`;
}
// Informativo à direita: faltam responsável e gestão (plural) ou só a gestão (singular)
const pillAssinaturaGestao = (o) => o.ges_assinada_em
  ? (o.resp_assinada_em ? pill("Concluída", "success") : pill("Aguardando o responsável", "info"))
  : pill(o.resp_assinada_em ? "Assinatura pendente" : "Assinaturas pendentes", "warning");
async function abrirPastaOcorrencias() {
  const $ = (id) => document.getElementById(id);
  const modal = $("modal-oc"), conteudo = $("oc-conteudo");
  let lista = await api("/api/ocorrencias-gestao");
  const atualizarQuadro = () => { // número do quadro "Ocorrências" na Central do Dia
    const pendentes = lista.filter((o) => !o.ges_assinada_em);
    dados.resumo.ocorrencias_gestao = pendentes.length;
    dados.resumo.ocorrencias_sem_resp = pendentes.filter((o) => !o.resp_assinada_em).length;
    $("oc-gestao-num").textContent = pendentes.length;
    $("oc-gestao-nota").textContent = notaOcorrenciasGestao(pendentes.length, dados.resumo.ocorrencias_sem_resp);
  };
  const linha = (o) => `<button type="button" class="item item-botao" data-oc-abrir="${o.id}">
    <span class="linha" style="flex-wrap:wrap;gap:8px">
      <span class="aluno"><span class="avatar">${iniciais(o.aluno_nome)}</span><span><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario} • Docente: ${esc(o.professor_nome)}</small></span></span>
      ${pillAssinaturaGestao(o)}</span></button>`;
  const desenharLista = () => {
    $("modal-oc-titulo").innerHTML = `${ico("pasta")} Ocorrências`;
    const pendentes = lista.filter((o) => !o.ges_assinada_em), registradas = lista.filter((o) => o.ges_assinada_em);
    conteudo.innerHTML = `<small style="margin:4px 0 12px">Ocorrências registradas pelos docentes. Clique em uma para ler e assinar. Depois da assinatura da gestão, ela passa para “Ocorrências registradas”.</small>
      <b>Aguardando a assinatura da gestão (${pendentes.length})</b>
      ${pendentes.length ? pendentes.map(linha).join("") : vazio("Nenhuma ocorrência aguardando a gestão.")}
      <details class="pasta" style="margin-top:16px"><summary><b>${ico("pasta")} Ocorrências registradas</b> <small style="display:inline">(${registradas.length})</small></summary>
        ${registradas.length ? registradas.map(linha).join("") : vazio("Nenhuma ocorrência registrada ainda.")}</details>`;
    conteudo.querySelectorAll("[data-oc-abrir]").forEach((b) => b.onclick = () => desenharDetalhe(Number(b.dataset.ocAbrir)));
  };
  const desenharDetalhe = (id, msg = "") => {
    const o = lista.find((x) => x.id === id);
    $("modal-oc-titulo").innerHTML = `${ico("prancheta")} Ocorrência`;
    conteudo.innerHTML = `<button type="button" class="btn outline pequeno" id="oc-voltar" style="width:auto;margin:6px 0 12px">← Voltar à pasta</button>
      ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:12px">${esc(msg)}</p>` : ""}
      <div class="linha" style="flex-wrap:wrap;gap:8px">
        <div class="aluno"><span class="avatar">${iniciais(o.aluno_nome)}</span><div><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario}</small></div></div>
        ${pillAssinaturaGestao(o)}</div>
      <p style="margin-top:12px;white-space:pre-line">${esc(o.descricao)}</p>
      <small style="margin-top:6px">Responsável notificado em ${o.notificado_em} • Buscado por ${esc(o.buscado_por)}</small>
      ${seloAssinatura("Registrado e assinado pelo docente", o.professor_nome, o.assinada_em, o.codigo)}
      ${o.resp_assinada_em
        ? seloAssinatura("Ciência do responsável", o.resp_nome, o.resp_assinada_em, o.resp_codigo)
        : `<div style="margin-top:10px">${pill("Aguardando a assinatura do responsável", "warning")}</div>`}
      ${o.ges_assinada_em ? seloAssinatura("Assinatura da gestão", o.ges_nome, o.ges_assinada_em, o.ges_codigo) : caixaAssinar("Assinatura digital da gestão", 'id="oc-ges-caixa"')}`;
    $("oc-voltar").onclick = desenharLista;
    if (o.ges_assinada_em) return;
    ligarCaixaAssinar($("oc-ges-caixa"), `/api/ocorrencias-gestao/${o.id}/assinar`, async () => {
      lista = await api("/api/ocorrencias-gestao");
      atualizarQuadro();
      desenharDetalhe(o.id, "Assinatura registrada. A ocorrência foi para “Ocorrências registradas”.");
    });
  };
  const fechar = () => modal.classList.add("oculto");
  $("oc-fechar").onclick = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); }; // clicar fora da pasta fecha
  modal.onkeydown = (e) => { if (e.key === "Escape") fechar(); };
  atualizarQuadro();
  desenharLista();
  modal.classList.remove("oculto"); $("oc-fechar").focus();
}
// Pasta (pop-up) com os documentos que os responsáveis enviaram para atender a uma pendência, nas últimas 24 horas
async function abrirPastaDocumentos() {
  const $ = (id) => document.getElementById(id);
  const modal = $("modal-docs"), lista = $("docs-lista");
  const docs = await api("/api/documentos-recentes");
  lista.innerHTML = docs.length ? docs.map((d) => `<div class="item">
    <div class="aluno"><span class="avatar">${iniciais(d.aluno_nome)}</span><div><b>${esc(d.aluno_nome)}</b><small>${esc(d.sala)} • Matrícula ${esc(d.matricula || "—")}</small></div></div>
    <div style="margin-top:10px"><b>${ico("documento")} ${esc(d.titulo)}</b> ${pill(esc(d.categoria), "neutral")}
      <small>Pendência atendida: ${esc(d.pendencia)}</small>
      <small>Enviado por ${esc(d.enviado_por)}${d.parentesco ? ` (${esc(d.parentesco)})` : ""} em ${d.enviado_em} • ${esc(d.nome_original)} (${tamanhoLegivel(d.tamanho)})</small></div>
    <div class="linha" style="margin-top:10px;flex-wrap:wrap;gap:8px">
      <div class="acoes" style="margin:0"><button class="btn outline pequeno" data-doc-baixar="${d.id}" data-nome="${esc(d.nome_original)}">${ico("baixar")} Baixar</button>
        <button class="btn outline pequeno" data-doc-ficha="${d.aluno_id}">Abrir ficha</button></div>
      ${pill(`Sai da pasta em ${d.horas_restantes}h`, "warning")}</div>
  </div>`).join("") : vazio("Nenhum documento recebido nas últimas 24 horas.");
  lista.querySelectorAll("[data-doc-baixar]").forEach((b) => b.onclick = seguro(() => baixarDocumento(b.dataset.docBaixar, b.dataset.nome)));
  lista.querySelectorAll("[data-doc-ficha]").forEach((b) => b.onclick = () => abrirFicha(Number(b.dataset.docFicha), "secretaria"));
  const fechar = () => modal.classList.add("oculto");
  $("docs-fechar").onclick = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); }; // clicar fora da pasta fecha
  modal.onkeydown = (e) => { if (e.key === "Escape") fechar(); };
  modal.classList.remove("oculto"); $("docs-fechar").focus();
}
const chaveOrdem = {
  nome: (a) => a.nome.toLowerCase(), novos: (a) => a.com_total - a.com_lidos, aut: (a) => a.aut_pendentes,
  pend: (a) => a.pend_abertas + a.aut_pendentes, adv: (a) => a.advertencias * 100 + a.acoes,
};
const filtrosGestao = {
  todos: () => true, pendencias: (a) => a.pend_abertas + a.aut_pendentes > 0, aut: (a) => a.aut_pendentes > 0,
  comunicados: (a) => a.com_total - a.com_lidos > 0, adv: (a) => a.advertencias > 0,
};
function desenharAlunos() {
  const busca = document.getElementById("busca").value.toLowerCase();
  const { campo, dir } = dados.ordem;
  const turma = document.getElementById("g-turma").value;
  const lista = dados.gestao.filter((a) => (!turma || a.sala === turma) && a.nome.toLowerCase().includes(busca) && filtrosGestao[dados.filtroGestao](a))
    .sort((x, y) => { const a = chaveOrdem[campo](x), b = chaveOrdem[campo](y); return (a > b ? 1 : a < b ? -1 : x.nome.localeCompare(y.nome)) * dir; });
  document.querySelectorAll("th.ord").forEach((th) => { th.querySelector(".seta").textContent = th.dataset.ord === campo ? (dir === 1 ? "▲" : "▼") : ""; });
  document.getElementById("linhas").innerHTML = lista.length ? lista.map((a) => {
    const novos = a.com_total - a.com_lidos;
    const tipos = a.pend_tipos ? a.pend_tipos.split(",") : [];
    const pendencias = (a.aut_pendentes > 0 ? pill("Autorização", "info") + " " : "") + tipos.map((t) => pill(t, "danger")).join(" ");
    const ocorr = (a.advertencias ? pill(pl(a.advertencias, "advertência", "advertências"), "danger") + " " : "") + (a.acoes ? pill(pl(a.acoes, "ação", "ações"), "info") : "");
    return `<tr>
      <td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${esc(a.nome)}</b><small>${esc(a.sala)}</small></div></div></td>
      <td>${novos > 0 ? pill(pl(novos, "novo", "novos"), "warning") : pill("Em dia", "success")}<small>${pl(a.com_lidos, "lido", "lidos")}</small></td>
      <td>${a.aut_pendentes > 0 ? pill(pl(a.aut_pendentes, "pendente", "pendentes"), "warning") : a.aut_assinadas > 0 ? pill("Em dia", "success") : pill("Nenhuma", "neutral")}</td>
      <td>${pendencias || pill("Nenhuma", "neutral")}</td><td>${ocorr || "—"}</td>
      <td><button class="btn outline pequeno" data-ficha="${a.id}">Abrir ficha</button></td></tr>`;
  }).join("") : `<tr><td colspan="6"><div class="vazio"><small>Nenhum aluno encontrado com esse filtro.</small></div></td></tr>`;
  document.getElementById("g-contagem").textContent = `${lista.length} de ${dados.gestao.length} alunos`;
  document.querySelectorAll("[data-ficha]").forEach((b) => b.onclick = () => abrirFicha(Number(b.dataset.ficha), "secretaria"));
}
function ligarGestao() {
  const filtro = document.getElementById("g-filtro");
  document.querySelectorAll("[data-ir]").forEach((b) => b.onclick = () => {
    const destino = b.dataset.ir;
    if (destino === "docs-recentes") return seguro(abrirPastaDocumentos)();
    if (destino === "ocorrencias-gestao") return seguro(abrirPastaOcorrencias)();
    if (!destino.startsWith("filtro:")) return mostrar(destino);
    dados.filtroGestao = destino.slice(7); filtro.value = dados.filtroGestao; desenharAlunos();
    document.getElementById("linhas").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.getElementById("busca").oninput = desenharAlunos;
  document.getElementById("g-turma").onchange = (e) => { dados.turmaGestao = e.target.value; desenharAlunos(); };
  filtro.value = dados.filtroGestao;
  filtro.onchange = () => { dados.filtroGestao = filtro.value; desenharAlunos(); };
  document.querySelectorAll("th.ord").forEach((th) => th.onclick = () => {
    dados.ordem = dados.ordem.campo === th.dataset.ord ? { campo: th.dataset.ord, dir: -dados.ordem.dir } : { campo: th.dataset.ord, dir: 1 };
    desenharAlunos();
  });
  desenharAlunos();
}

// ---------- Controle de frequência (administração) ----------
function telaFrequencia() {
  return `<div class="topo"><h2>Controle de frequência</h2><small>Presença e faltas por dia. Clique em "Histórico" para ver o detalhe de cada aluno.</small></div>
  <div class="grade g4" id="freq-cards"></div><div id="freq-aviso"></div>
  <section class="card">
    <div class="linha" style="flex-wrap:wrap;align-items:flex-end;gap:12px">
      <label class="campo-bloco"><small>Data</small><input type="date" id="freq-data" style="max-width:200px"></label>
      <label class="campo-bloco"><small>Turma</small><select id="freq-turma" class="filtro-turma-tabela" aria-label="Filtrar por turma" style="width:auto"><option value="">Todas as turmas</option>${turmasDe(dados.freq.alunos).map((s) => `<option${s === dados.turmaFreq ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
      <input id="freq-busca" class="campo-busca" aria-label="Buscar aluno" placeholder="Buscar aluno..." style="max-width:280px">
    </div>
    <div class="tabela"><table><caption class="so-leitor">Controle de frequência</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Situação</th><th scope="col">Observação</th><th scope="col">Faltas (30 dias)</th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead>
    <tbody id="freq-linhas"></tbody></table></div>
  </section>
  <section class="card oculto" id="freq-hist" style="margin-top:20px"></section>`;
}
function desenharFrequencia() {
  const f = dados.freq;
  document.getElementById("freq-data").value = f.data;
  const tag = f.eh_hoje ? "Hoje" : dataCurta(f.data), comRegistro = f.presentes + f.ausentes;
  document.getElementById("freq-cards").innerHTML =
    metrica(ico("familia"), "Total de alunos", f.total, "alunos ativos", "info", tag) +
    metrica(ico("confere"), "Presentes", f.presentes, comRegistro ? `${pct(calcPct(f.presentes, f.ausentes))} dos ${comRegistro} com registro` : "Sem chamada neste dia", "success", tag) +
    metrica(ico("proibido"), "Ausentes", f.ausentes, "faltas no dia", "danger", tag) +
    metrica(ico("relogio"), "Sem registro", f.sem_registro, f.sem_registro ? "chamada ainda não feita" : "todos registrados", f.sem_registro ? "warning" : "neutral", tag);
  document.getElementById("freq-aviso").innerHTML = f.fim_de_semana
    ? `<p class="pill info aviso-largo">${ico("calendario")} Hoje não tem aula. Mostrando o último dia letivo: ${dataCurta(f.data)}.</p>`
    : f.sem_registro && comRegistro ? `<p class="pill warning aviso-largo">${ico("aviso")} ${pl(f.sem_registro, "aluno", "alunos")} ainda sem registro: o percentual de presença considera só os ${comRegistro} que já têm chamada ou entrada.</p>` : "";
  const filtro = document.getElementById("freq-busca").value.toLowerCase(), turmaFreq = document.getElementById("freq-turma").value;
  document.getElementById("freq-linhas").innerHTML = f.alunos.filter((a) => (!turmaFreq || a.sala === turmaFreq) && a.nome.toLowerCase().includes(filtro)).map((a) => `<tr>
    <td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${esc(a.nome)}</b><small>${esc(a.sala)}</small></div></div></td>
    <td>${pill(a.status || "Sem registro", a.status === "Presente" ? "success" : a.status === "Ausente" ? "danger" : "neutral")}</td>
    <td>${esc(a.observacao || "—")}</td>
    <td>${pill(a.faltas, a.faltas >= f.limite_faltas ? "danger" : a.faltas > 0 ? "warning" : "neutral")}</td>
    <td><button class="btn outline pequeno" data-hist="${a.id}" data-nome="${esc(a.nome)}">Histórico</button></td></tr>`).join("");
  document.querySelectorAll("[data-hist]").forEach((b) => b.onclick = seguro(async () => {
    const h = await api(`/api/presencas/${b.dataset.hist}?dias=60`);
    const box = document.getElementById("freq-hist");
    box.innerHTML = `<div class="linha"><h2>Histórico — ${esc(b.dataset.nome)}</h2><button class="btn outline pequeno" id="freq-fechar">Fechar</button></div><small>Últimos 60 dias</small>${blocoHistorico(h)}`;
    box.classList.remove("oculto");
    box.scrollIntoView({ behavior: "smooth" });
    document.getElementById("freq-fechar").onclick = () => box.classList.add("oculto");
  }));
}
function ligarFrequencia() {
  document.getElementById("freq-data").onchange = seguro(async (e) => {
    if (!e.target.value) return;
    dados.freq = await api("/api/frequencia?data=" + e.target.value);
    document.getElementById("freq-hist").classList.add("oculto");
    desenharFrequencia();
  });
  document.getElementById("freq-busca").oninput = desenharFrequencia;
  document.getElementById("freq-turma").onchange = (e) => { dados.turmaFreq = e.target.value; desenharFrequencia(); };
  desenharFrequencia();
}

// ---------- Busca Ativa (administração) ----------
function telaBusca() {
  const c = dados.busca.criterio;
  return `<div class="topo"><h2>Busca Ativa</h2><small>O sistema conta as faltas e abre o caso sozinho quando o aluno chega a ${c.faltas} faltas nos últimos ${c.dias} dias.</small></div><div id="busca-lista"></div>`;
}
function blocoConselho(c) { // ECA, art. 56, II: faltas reiteradas, esgotados os recursos da escola -> comunicar ao Conselho Tutelar
  if (c.comunicacao_id) return `<div style="margin-top:10px">${c.comunicacao_feita ? pill("Comunicado ao Conselho Tutelar", "success") : pill("Comunicação registrada: falta enviar ao Conselho Tutelar", "danger")} <button class="btn outline pequeno" data-ir-protecao style="width:auto">Ver em Proteção</button></div>`;
  if (usuarioLogado.papel !== "admin" || c.status !== "Em acompanhamento") return "";
  return `<div style="margin-top:10px"><button class="btn outline pequeno" data-ct-abrir="${c.id}" style="width:auto">Comunicar ao Conselho Tutelar</button></div>
    <div class="oculto" data-ct-painel="${c.id}" style="margin-top:10px;padding:12px;background:var(--muted);border-radius:8px">
      <small><b>Comunicação ao Conselho Tutelar</b> (ECA, art. 56, II). Antes, registre acima as ações da escola (ligação, visita, conversa com a família): elas seguem como "medidas adotadas".</small>
      <textarea rows="3" maxlength="1500" aria-label="Fatos para comunicar ao Conselho Tutelar" data-ct-fatos="${c.id}" style="margin-top:6px">Aluno com ${c.faltas_atuais} faltas nos últimos ${dados.busca.criterio.dias} dias, em acompanhamento pela Busca Ativa desde ${c.aberta_em}.</textarea>
      <label class="termo-aceite"><input type="checkbox" data-ct-esgotei="${c.id}"> <span>Os recursos da escola foram esgotados (as ações estão registradas acima).</span></label>
      <p class="pill danger oculto" data-ct-erro="${c.id}" style="white-space:normal;margin-top:8px"></p>
      <div class="acoes"><button class="btn pequeno" data-ct-enviar="${c.id}">Registrar comunicação</button><button class="btn outline pequeno" data-ct-cancelar="${c.id}">Cancelar</button></div>
    </div>`;
}
// Telefone em link: no celular, toca e liga. WhatsApp: abre a conversa (wa.me, com o 55 do Brasil).
const soDigitos = (t) => String(t || "").replace(/\D/g, "");
function contatosFamilia(lista) {
  if (!lista || !lista.length) return `<small class="contatos-vazio">${ico("aviso")} Nenhum responsável cadastrado. Complete o cadastro em Alunos e turmas.</small>`;
  return `<div class="contatos-familia"><small><b>Contato da família</b></small>${lista.map((r) => {
    const tel = soDigitos(r.telefone), tel2 = soDigitos(r.telefone2);
    return `<div class="contato"><span><b>${esc(r.nome)}</b> <small style="display:inline">(${esc(r.parentesco)}) • prefere ${esc(r.contato_preferido || "WhatsApp")}</small></span>
      <span class="acoes" style="margin:0">${tel ? `<a class="btn outline pequeno" href="tel:${tel}">${ico("telefone")} ${esc(r.telefone)}</a>
        <a class="btn outline pequeno" href="https://wa.me/55${tel}" target="_blank" rel="noopener">${ico("mensagem")} WhatsApp</a>` : ""}
        ${tel2 ? `<a class="btn outline pequeno" href="tel:${tel2}">${ico("telefone")} ${esc(r.telefone2)}</a>` : ""}
        ${r.email ? `<a class="btn outline pequeno" href="mailto:${esc(r.email)}">${ico("email")} E-mail</a>` : ""}
        ${!tel && !tel2 && !r.email ? "<small>Sem telefone cadastrado</small>" : ""}</span></div>`;
  }).join("")}</div>`;
}
function cartaoCaso(c) {
  const aberto = c.status === "Em acompanhamento";
  return `<article class="card" style="margin-bottom:16px">
    <div class="linha" style="flex-wrap:wrap;gap:8px">
      <div class="aluno"><span class="avatar">${iniciais(c.nome)}</span><div><b>${esc(c.nome)}</b><small>${esc(c.sala)} • aberto em ${c.aberta_em}${c.encerrada_em ? " • encerrado em " + c.encerrada_em : ""}</small></div></div>
      <div>${pill(aberto ? "Em acompanhamento" : "Resolvido", aberto ? "danger" : "success")} ${pill(`${c.faltas_atuais} faltas em ${dados.busca.criterio.dias} dias`, "warning")}</div>
    </div>
    ${aberto ? contatosFamilia(c.contatos) : ""}
    <div style="margin-top:8px">${c.registros.map((r) => `<div class="nota ${r.nome_usuario === "Sistema" ? "sistema" : ""}"><small><b>${esc(r.nome_usuario)}</b> • ${r.quando}</small>${esc(r.texto)}</div>`).join("")}</div>
    ${aberto ? `<textarea rows="2" maxlength="500" data-nota="${c.id}" placeholder="Anote o acompanhamento (ligação, visita, conversa com a família...)" style="margin-top:8px" aria-label="Acompanhamento de ${esc(c.nome)}"></textarea>
      <div class="acoes acoes-separadas"><button class="btn pequeno" data-anotar="${c.id}">Registrar acompanhamento</button><button class="btn perigo-leve pequeno" data-encerrar="${c.id}" data-nome="${esc(c.nome)}">Encerrar caso</button></div>` : ""}
    ${blocoConselho(c)}
  </article>`;
}
function desenharBusca() {
  const abertos = dados.busca.casos.filter((c) => c.status === "Em acompanhamento");
  const encerrados = dados.busca.casos.filter((c) => c.status !== "Em acompanhamento");
  document.getElementById("busca-lista").innerHTML =
    `<div class="topo"><h2>Em acompanhamento (${abertos.length})</h2></div>` +
    (abertos.length ? abertos.map(cartaoCaso).join("") : `<div class="vazio"><b>Nenhum aluno com faltas significativas</b><small>Quando algum aluno atingir o limite, o caso aparece aqui automaticamente.</small></div>`) +
    (encerrados.length ? `<div class="topo" style="margin-top:28px"><h2>Encerrados (${encerrados.length})</h2></div>` + encerrados.map(cartaoCaso).join("") : "");
  const recarregar = async () => { dados.busca = await api("/api/busca-ativa"); desenharBusca(); };
  document.querySelectorAll("[data-anotar]").forEach((b) => b.onclick = seguro(async () => {
    const texto = document.querySelector(`[data-nota="${b.dataset.anotar}"]`).value;
    await api(`/api/busca-ativa/${b.dataset.anotar}/acompanhamento`, { method: "POST", body: JSON.stringify({ texto }) });
    await recarregar(); avisar("Acompanhamento registrado.");
  }));
  document.querySelectorAll("[data-encerrar]").forEach((b) => b.onclick = seguro(async () => {
    const r = await confirmar({ titulo: `Encerrar o caso de ${b.dataset.nome}?`, texto: "O caso sai de \"Em acompanhamento\" e vai para os encerrados (o histórico fica guardado). Se o aluno voltar a faltar muito, o sistema abre um caso novo sozinho.",
      botao: "Encerrar caso", perigo: true, campo: { rotulo: "Motivo do encerramento (opcional)", placeholder: "Ex.: aluno voltou a frequentar, família regularizou a situação...", valor: document.querySelector(`[data-nota="${b.dataset.encerrar}"]`).value } });
    if (!r) return;
    const texto = r.valor;
    await api(`/api/busca-ativa/${b.dataset.encerrar}/encerrar`, { method: "PUT", body: JSON.stringify({ texto }) });
    await recarregar(); avisar("Caso encerrado.");
  }));
  const painel = (id) => document.querySelector(`[data-ct-painel="${id}"]`);
  document.querySelectorAll("[data-ct-abrir]").forEach((b) => b.onclick = () => painel(b.dataset.ctAbrir).classList.toggle("oculto"));
  document.querySelectorAll("[data-ct-cancelar]").forEach((b) => b.onclick = () => painel(b.dataset.ctCancelar).classList.add("oculto"));
  document.querySelectorAll("[data-ct-enviar]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.ctEnviar, caso = dados.busca.casos.find((c) => String(c.id) === id), erro = document.querySelector(`[data-ct-erro="${id}"]`);
    erro.classList.add("oculto");
    try {
      await api("/api/protecao", { method: "POST", body: JSON.stringify({ aluno_id: caso.aluno_id, motivo: "Faltas", bua_id: caso.id,
        descricao: document.querySelector(`[data-ct-fatos="${id}"]`).value, recursos_esgotados: document.querySelector(`[data-ct-esgotei="${id}"]`).checked }) });
      await recarregar();
    } catch (e) { if (e.message !== "Sessão expirada") { erro.textContent = e.message; erro.classList.remove("oculto"); } }
  });
}

// ---------- Relatório mensal (administração) ----------
function telaRelatorio() {
  return `<div class="linha no-print" style="flex-wrap:wrap;align-items:flex-end;justify-content:flex-start;gap:12px;margin-bottom:16px">
    <label class="campo-bloco"><small>Mês</small><input type="month" id="rel-mes" style="max-width:200px"></label>
    <button class="btn outline pequeno" id="rel-imprimir">${ico("impressora")} Imprimir / salvar em PDF</button>
    <button class="btn outline pequeno" id="rel-csv">${ico("baixar")} Baixar planilha (CSV)</button>
  </div><div id="rel-conteudo"></div>`;
}
function desenharRelatorio() {
  const r = dados.relatorio, c = r.criterio, s = r.resumo, b = r.busca_ativa;
  const nomeMes = new Date(r.mes + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("rel-mes").value = r.mes;
  document.getElementById("rel-conteudo").innerHTML = `
    <div class="topo"><h2>Relatório mensal — ${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}</h2>
      <small>Gerado em ${new Date().toLocaleString("pt-BR")} por ${esc(usuarioLogado.nome)}. Critério da Busca Ativa: ${c.faltas} faltas em ${c.dias} dias.</small></div>
    <div class="grade g4">
      ${metrica(ico("familia"), "Alunos", s.total_alunos, "cadastrados", "info", "Mês")}
      ${metrica(ico("calendario"), "Dias com chamada", s.dias_com_registro, "dias com registro", "neutral", "Mês")}
      ${metrica(ico("confere"), "Frequência média", pct(s.percentual), `${s.presencas} presenças`, "success", "Mês")}
      ${metrica(ico("proibido"), "Total de faltas", s.faltas, "no mês", "danger", "Mês")}
    </div>
    <section class="card"><h2>Frequência por aluno</h2>
      <div class="tabela"><table><caption class="so-leitor">Frequência por aluno</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Turma</th><th scope="col">Presenças</th><th scope="col">Faltas</th><th scope="col">Frequência</th></tr></thead>
      <tbody>${r.alunos.map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${a.presencas}</td><td>${a.faltas}</td>
        <td>${pill(pct(a.percentual), a.percentual == null ? "neutral" : a.percentual < 75 ? "danger" : a.percentual < 90 ? "warning" : "success")}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card" style="margin-top:20px"><h2>Busca Ativa no mês</h2>
      <small>${pl(b.abertos_no_mes, "caso aberto", "casos abertos")} • ${pl(b.encerrados_no_mes, "encerrado", "encerrados")} • ${b.em_acompanhamento} ainda em acompanhamento</small>
      ${b.casos.length ? b.casos.map((k) => `<div style="margin-top:16px"><b>${esc(k.nome)}</b> <small style="display:inline">(${esc(k.sala)})</small> ${pill(k.status, k.status === "Resolvido" ? "success" : "danger")}
        <small>Aberto em ${k.aberta_em}${k.encerrada_em ? " • encerrado em " + k.encerrada_em : ""}</small>
        ${k.registros.map((n) => `<div class="nota ${n.nome_usuario === "Sistema" ? "sistema" : ""}"><small><b>${esc(n.nome_usuario)}</b> • ${n.quando}</small>${esc(n.texto)}</div>`).join("")}</div>`).join("")
        : `<div class="vazio"><small>Nenhum caso de Busca Ativa neste mês.</small></div>`}
    </section>`;
}
// Versão impressa do relatório mensal: página própria, limpa e em A4 (sem menu, cartões, sombras nem botões flutuantes)
function imprimirRelatorio() {
  const r = dados.relatorio, c = r.criterio, s = r.resumo, b = r.busca_ativa;
  const w = window.open("", "_blank");
  if (!w) { avisar("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.", "danger"); return; }
  const nomeMes = new Date(r.mes + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const mesTitulo = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const freq = (v) => (v == null ? "—" : pct(v));
  const baixa = (v) => v != null && v < 75;
  // agrupa por turma (turmas em ordem; alunos em ordem alfabética)
  const turmas = [...new Set(r.alunos.map((a) => a.sala))].sort(ordemTurma).map((sala) => {
    const alunos = r.alunos.filter((a) => a.sala === sala).sort(ordemNome);
    const presencas = alunos.reduce((t, a) => t + a.presencas, 0), faltas = alunos.reduce((t, a) => t + a.faltas, 0);
    return { sala, alunos, presencas, faltas, percentual: presencas + faltas ? Math.round(presencas * 1000 / (presencas + faltas)) / 10 : null,
      abaixo: alunos.filter((a) => baixa(a.percentual)).length };
  });
  const resumoTurmas = turmas.map((t) => `<tr><td>${esc(t.sala)}</td><td class="n">${t.alunos.length}</td><td class="n">${t.presencas}</td><td class="n">${t.faltas}</td>
    <td class="n${baixa(t.percentual) ? " alerta" : ""}">${freq(t.percentual)}</td><td class="n">${t.abaixo || "—"}</td></tr>`).join("");
  const porAluno = turmas.map((t) => `<section class="turma"><h3>${esc(t.sala)} <span>${pl(t.alunos.length, "aluno", "alunos")} • frequência da turma ${freq(t.percentual)}</span></h3>
    <table><thead><tr><th class="n num">Nº</th><th>Aluno</th><th class="n">Presenças</th><th class="n">Faltas</th><th class="n">Frequência</th></tr></thead><tbody>
    ${t.alunos.map((a, i) => `<tr${baixa(a.percentual) ? ' class="alerta"' : ""}><td class="n num">${i + 1}</td><td>${esc(a.nome)}</td><td class="n">${a.presencas}</td><td class="n">${a.faltas}</td><td class="n">${freq(a.percentual)}${baixa(a.percentual) ? " *" : ""}</td></tr>`).join("")}
    </tbody></table></section>`).join("");
  const casos = b.casos.length ? b.casos.map((k) => `<div class="caso"><div class="caso-topo"><b>${esc(k.nome)}</b> — ${esc(k.sala)}<span class="status">${esc(k.status)}</span></div>
      <div class="meta">Aberto em ${esc(k.aberta_em)}${k.encerrada_em ? " • encerrado em " + esc(k.encerrada_em) : ""}</div>
      ${k.registros.length ? `<ul>${k.registros.map((n) => `<li><span class="meta">${esc(n.quando)} • ${esc(n.nome_usuario)}:</span> ${esc(n.texto)}</li>`).join("")}</ul>` : ""}</div>`).join("")
    : `<p class="meta">Nenhum caso de Busca Ativa neste mês.</p>`;
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório mensal — ${esc(mesTitulo)} — S.I.V.E.</title>
  <style>
    @page{size:A4;margin:16mm 14mm 18mm}
    @page{@bottom-left{content:"S.I.V.E. • Relatório mensal • ${esc(mesTitulo)}";font:8pt Arial,sans-serif;color:#777}@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt Arial,sans-serif;color:#777}}
    *{box-sizing:border-box}
    body{font:9.5pt/1.4 Arial,Helvetica,sans-serif;color:#1a1a1a;margin:0;padding:24px;max-width:820px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:10px;border-bottom:2px solid #140040}
    header img{height:44px;width:auto}
    header .titulo{text-align:right}
    header h1{font-size:15pt;margin:0;color:#140040}
    header .escola{font-size:9pt;color:#555;margin-top:2px}
    .info{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 16px;font-size:8.5pt;color:#555;margin:8px 0 18px}
    h2{font-size:11pt;color:#140040;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #ccc;break-after:avoid}
    .resumo{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #ccc;border-radius:4px}
    .resumo div{padding:8px 12px;border-left:1px solid #ccc}.resumo div:first-child{border-left:0}
    .resumo b{display:block;font-size:15pt;color:#140040;line-height:1.2}.resumo span{font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:.03em}
    table{width:100%;border-collapse:collapse}
    th{font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em;color:#555;text-align:left;font-weight:700;padding:5px 6px;border-bottom:1px solid #999}
    td{padding:4px 6px;border-bottom:1px solid #e3e3e3}
    tbody tr:nth-child(even) td{background:#f7f7f7}
    tr{break-inside:avoid}
    .n{text-align:right;white-space:nowrap}.num{width:34px;color:#777}
    th.n{text-align:right}
    tr.alerta td,td.alerta{font-weight:700}
    .turma{margin-top:14px}
    .turma h3{font-size:10pt;margin:0 0 4px;break-after:avoid}.turma h3 span{font-weight:400;color:#555;font-size:8.5pt;margin-left:6px}
    .nota{font-size:8pt;color:#555;margin-top:6px}
    .caso{padding:8px 0;border-bottom:1px solid #e3e3e3;break-inside:avoid}
    .caso-topo{display:flex;gap:8px;align-items:baseline}.status{margin-left:auto;font-size:8pt;border:1px solid #999;border-radius:3px;padding:1px 6px}
    .caso ul{margin:4px 0 0;padding-left:16px}.caso li{margin:2px 0}
    .meta{color:#555;font-size:8.5pt}
    .assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px;break-inside:avoid}
    .assinaturas div{border-top:1px solid #333;padding-top:4px;text-align:center;font-size:8.5pt;color:#333}
    .rodape{margin-top:20px;font-size:7.5pt;color:#777;border-top:1px solid #ddd;padding-top:6px}
    .acoes{position:sticky;top:0;background:#fff;padding:10px 0;margin-bottom:10px;border-bottom:1px solid #eee;display:flex;gap:8px;justify-content:flex-end}
    .acoes button{font:600 10pt Arial,sans-serif;padding:8px 16px;border-radius:6px;border:1px solid #0B78B3;background:#0B78B3;color:#fff;cursor:pointer}
    .acoes button.sec{background:#fff;color:#0B78B3}
    @media print{body{padding:0;max-width:none}.acoes{display:none}}
  </style></head><body>
  <div class="acoes"><button id="fechar" class="sec">Fechar</button><button id="imprimir">Imprimir / salvar em PDF</button></div>
  <header><img src="${location.origin}/assets/logo-sive.png" alt="S.I.V.E. — Sistema Inteligente de Vigilância Escolar">
    <div class="titulo"><h1>Relatório mensal de frequência</h1><div class="escola">${esc(r.escola || "")}${r.escola ? " • " : ""}${esc(mesTitulo)}</div></div></header>
  <div class="info"><span>Emitido em ${esc(agora)} por ${esc(usuarioLogado.nome)}</span><span>Critério da Busca Ativa: ${c.faltas} faltas em ${c.dias} dias</span></div>
  <h2>Resumo do mês</h2>
  <div class="resumo"><div><span>Alunos</span><b>${s.total_alunos}</b></div><div><span>Dias com chamada</span><b>${s.dias_com_registro}</b></div>
    <div><span>Frequência média</span><b>${freq(s.percentual)}</b></div><div><span>Total de faltas</span><b>${s.faltas}</b></div></div>
  <h2>Frequência por turma</h2>
  <table><thead><tr><th>Turma</th><th class="n">Alunos</th><th class="n">Presenças</th><th class="n">Faltas</th><th class="n">Frequência</th><th class="n">Abaixo de 75%</th></tr></thead><tbody>${resumoTurmas}</tbody></table>
  <h2>Frequência por aluno</h2>
  <p class="nota">Alunos em ordem alfabética dentro de cada turma. Em negrito e com * : frequência abaixo de 75% no mês. "—": sem chamada registrada.</p>
  ${porAluno}
  <h2>Busca Ativa no mês</h2>
  <p class="meta">${pl(b.abertos_no_mes, "caso aberto", "casos abertos")} • ${pl(b.encerrados_no_mes, "encerrado", "encerrados")} • ${b.em_acompanhamento} ainda em acompanhamento</p>
  ${casos}
  <div class="assinaturas"><div>Direção</div><div>Coordenação pedagógica</div></div>
  <p class="rodape">Documento de uso interno da escola. Contém dados pessoais de alunos (LGPD, art. 14): não compartilhe fora da equipe responsável.</p>
  </body></html>`);
  w.document.close();
  w.document.getElementById("imprimir").addEventListener("click", () => w.print());
  w.document.getElementById("fechar").addEventListener("click", () => w.close());
  const img = w.document.querySelector("header img"); // espera o logo carregar antes de abrir a caixa de impressão
  const abrir = () => setTimeout(() => w.print(), 150);
  if (img.complete) abrir(); else { img.onload = abrir; img.onerror = abrir; }
}
function ligarRelatorio() {
  document.getElementById("rel-mes").onchange = seguro(async (e) => {
    if (!e.target.value) return;
    dados.relatorio = await api("/api/relatorio-mensal?mes=" + e.target.value);
    desenharRelatorio();
  });
  document.getElementById("rel-imprimir").onclick = imprimirRelatorio;
  document.getElementById("rel-csv").onclick = () => {
    const r = dados.relatorio;
    const linhas = [["Aluno", "Turma", "Presenças", "Faltas", "Frequência (%)"],
      ...r.alunos.map((a) => [a.nome, a.sala, a.presencas, a.faltas, a.percentual == null ? "" : String(a.percentual).replace(".", ",")])];
    const csv = "\uFEFF" + linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `relatorio-frequencia-${r.mes}.csv`; link.click();
    URL.revokeObjectURL(url);
  };
  desenharRelatorio();
}

// =====================================================================
// FASE 4 — banners, calendário de eventos e perfil do responsável
// =====================================================================
const tipoClasse = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); // "Reunião" -> "reuniao"
const tomTipo = { Evento: "info", Reunião: "warning", Passeio: "success", Feriado: "danger", Prazo: "warning" };
function quandoEvento(e) {
  let t = dataCurta(e.data);
  if (e.data_fim && e.data_fim !== e.data) t += " a " + dataCurta(e.data_fim);
  return t + (e.hora ? " • " + e.hora : "");
}
// A imagem do banner é protegida: o navegador baixa com o login e mostra a partir da memória (blob)
async function urlBanner(id) {
  if (cacheBanner.has(id)) return cacheBanner.get(id);
  const r = await fetch(`/api/eventos/${id}/banner`, { headers: { Authorization: "Bearer " + usuarioLogado.token } });
  if (!r.ok) throw new Error("banner indisponível");
  const url = URL.createObjectURL(await r.blob());
  cacheBanner.set(id, url);
  return url;
}
function carregarImagensBanner(raiz) {
  raiz.querySelectorAll("[data-banner-img]").forEach(async (img) => {
    try { img.src = await urlBanner(img.dataset.bannerImg); img.classList.add("pronta"); } catch { img.remove(); }
  });
}
function blocoBanners() {
  const lista = dados.banners || [];
  if (!lista.length) return "";
  return `<section class="banners" aria-label="Eventos em destaque" aria-roledescription="carrossel">
    ${lista.map((e, i) => `<article class="banner ban-${tipoClasse(e.tipo)} ${i === 0 ? "ativo" : ""}" aria-hidden="${i === 0 ? "false" : "true"}">
      ${e.tem_banner ? `<img data-banner-img="${e.id}" alt="">` : `<span class="banner-icone" aria-hidden="true">${ico({ Evento: "estrela", Reunião: "familia", Passeio: "onibus", Feriado: "sol", Prazo: "relogio" }[e.tipo] || "calendario")}</span>`}
      <div class="banner-texto"><span class="pill banner-tipo">${esc(e.tipo)} • ${e.sala ? esc(e.sala) : "Escola toda"}</span>
        <h3>${esc(e.titulo)}</h3><small>${quandoEvento(e)}${e.local ? " • " + esc(e.local) : ""}</small>
        <button class="btn pequeno banner-btn" data-ver-evento="${e.data}">Ver no calendário</button></div></article>`).join("")}
    ${lista.length > 1 ? `<div class="banner-pontos">${lista.map((e, i) => `<button data-ponto="${i}" class="${i === 0 ? "ativo" : ""}" aria-label="Destaque ${i + 1}: ${esc(e.titulo)}"></button>`).join("")}</div>` : ""}
  </section>`;
}
function ligarBanners() {
  const caixa = document.querySelector(".banners");
  if (!caixa) return;
  carregarImagensBanner(caixa);
  const slides = [...caixa.querySelectorAll(".banner")], pontos = [...caixa.querySelectorAll("[data-ponto]")];
  let atual = 0;
  const ir = (i) => {
    atual = (i + slides.length) % slides.length;
    slides.forEach((s, k) => { s.classList.toggle("ativo", k === atual); s.setAttribute("aria-hidden", k === atual ? "false" : "true"); });
    pontos.forEach((p, k) => p.classList.toggle("ativo", k === atual));
  };
  const reiniciar = () => { clearInterval(timerBanner); if (slides.length > 1 && !menosMovimento()) timerBanner = setInterval(() => ir(atual + 1), 6000); };
  pontos.forEach((p) => p.onclick = () => { ir(Number(p.dataset.ponto)); reiniciar(); });
  caixa.querySelectorAll("[data-ver-evento]").forEach((b) => b.onclick = () => { dados.calMes = b.dataset.verEvento.slice(0, 7); dados.calDia = b.dataset.verEvento; mostrar("calendario"); });
  reiniciar();
}

// ---------- Calendário ----------
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const eventosDoDia = (iso) => dados.cal.eventos.filter((e) => e.data <= iso && iso <= (e.data_fim || e.data));
function cartaoEvento(e) {
  const acoes = e.pode_gerenciar ? `<div class="evento-acoes">
      <button type="button" class="evento-icone" data-editar-evento="${e.id}" title="Editar evento" aria-label="Editar o evento ${esc(e.titulo)}">${ico("caneta")}</button>
      <button type="button" class="evento-icone perigo" data-excluir-evento="${e.id}" data-titulo="${esc(e.titulo)}" title="Excluir evento" aria-label="Excluir o evento ${esc(e.titulo)}">${ico("lixeira")}</button></div>` : "";
  return `<div class="item evento${acoes ? " com-acoes" : ""}">${acoes}
    ${e.tem_banner ? `<img class="evento-img" data-banner-img="${e.id}" alt="Banner do evento ${esc(e.titulo)}">` : ""}
    <div class="linha" style="gap:8px;flex-wrap:wrap;align-items:flex-start"><div><b>${esc(e.titulo)}</b><small>${ico("calendario")} ${quandoEvento(e)}${e.local ? " • " + ico("local") + " " + esc(e.local) : ""}</small></div>
      <div>${pill(esc(e.tipo), tomTipo[e.tipo] || "info")} ${pill(e.sala ? esc(e.sala) : "Escola toda", "neutral")}${e.destaque ? " " + pill("Banner", "info") : ""}</div></div>
    ${e.descricao ? `<p style="margin-top:8px">${esc(e.descricao)}</p>` : ""}
    <small style="margin-top:6px">Criado por ${esc(e.criado_por_nome)}</small>
</div>`;
}
function telaCalendario() {
  const papel = usuarioLogado.papel, podeCriar = papel !== "pai";
  const salas = papel === "admin" ? nomesTurmas() : [];
  const destino = papel === "admin"
    ? `<select id="ev-sala"><option value="">Escola toda</option>${salas.map((s) => `<option>${esc(s)}</option>`).join("")}</select>`
    : `<input value="${esc(usuarioLogado.sala || "")}" disabled>`;
  const msg = dados.calMsg || ""; dados.calMsg = "";
  return `<div class="topo"><h2>Calendário escolar</h2><small>${papel === "pai" ? "Eventos da escola e da turma do seu filho." : papel === "professor" ? `Eventos da escola e da sua turma (${esc(usuarioLogado.sala)}).` : "Eventos da escola e de cada turma. Os eventos em destaque aparecem como banner nos painéis."}</small></div>
  ${msg ? `<p class="pill success" style="margin-bottom:14px;white-space:normal">${esc(msg)}</p>` : ""}
  <div class="grade cal-layout">
    <section class="card"><div class="linha" style="gap:8px">
        <button class="btn outline pequeno" id="cal-ant" aria-label="Mês anterior">‹</button>
        <h2 id="cal-titulo" style="text-align:center;flex:1"></h2>
        <button class="btn outline pequeno" id="cal-prox" aria-label="Próximo mês">›</button></div>
      <div class="cal-grade" id="cal-grade" role="group" aria-label="Dias do mês"></div>
      <div class="acoes" style="justify-content:center"><button class="btn outline pequeno" id="cal-hoje">Hoje</button></div></section>
    <div><section class="card" id="cal-dia"></section>
      <section class="card" style="margin-top:16px"><h2>Próximos eventos</h2><div id="cal-proximos"></div></section></div>
  </div>
  ${podeCriar ? `<form id="form-evento" class="card" style="margin-top:20px"><h2 id="ev-form-titulo">Novo evento</h2>
    <small>${papel === "professor" ? "O evento aparece para a sua turma." : "Escolha uma turma ou a escola toda."}</small>
    <div class="grade dois" style="margin-top:12px"><div><small>Título</small><input id="ev-titulo" required maxlength="100" placeholder="Ex.: Festa da primavera"></div>
      <div><small>Tipo</small><select id="ev-tipo">${dados.cal.tipos.map((t) => `<option>${t}</option>`).join("")}</select></div></div>
    <div class="grade g3" style="margin-top:12px"><div><small>Data</small><input type="date" id="ev-data" required></div>
      <div><small>Termina em (opcional)</small><input type="date" id="ev-fim"></div><div><small>Hora (opcional)</small><input type="time" id="ev-hora"></div></div>
    <div class="grade dois" style="margin-top:12px"><div><small>Local (opcional)</small><input id="ev-local" maxlength="100" placeholder="Ex.: Pátio central"></div><div><small>Para quem</small>${destino}</div></div>
    <div style="margin-top:12px"><small>Descrição (opcional)</small><textarea id="ev-desc" rows="3" maxlength="500"></textarea></div>
    <label class="termo-aceite"><input type="checkbox" id="ev-destaque"> <span>Mostrar como <b>banner</b> nos painéis (Central do Dia, Minha Turma e Portal da Família) até a data do evento</span></label>
    <div style="margin-top:12px"><small>Imagem do banner (opcional: PNG ou JPG, até 2 MB, de preferência deitada)</small><input type="file" id="ev-imagem" accept=".png,.jpg,.jpeg,image/png,image/jpeg"></div>
    <label class="termo-aceite oculto" id="ev-remover-box"><input type="checkbox" id="ev-remover"> <span>Remover o banner atual deste evento</span></label>
    <label class="termo-aceite oculto" id="ev-eca-box"><input type="checkbox" id="ev-eca"> <span>A imagem <b>não mostra alunos</b>, ou todos os alunos que aparecem têm autorização de uso de imagem (ECA, art. 17; LGPD, art. 14). O banner é visto por várias famílias.</span></label>
    <p id="ev-erro" class="pill danger oculto" style="margin-top:12px;white-space:normal"></p>
    <div class="acoes" style="margin-top:14px"><button class="btn" type="submit" id="ev-salvar" style="max-width:220px">Criar evento</button>
      <button class="btn outline oculto" type="button" id="ev-cancelar">Cancelar edição</button></div></form>` : ""}`;
}
function desenharCalendario() {
  const [ano, mes] = dados.calMes.split("-").map(Number), hoje = hojeLocalISO();
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("cal-titulo").textContent = nome.charAt(0).toUpperCase() + nome.slice(1);
  if (!dados.calDia || dados.calDia.slice(0, 7) !== dados.calMes) dados.calDia = hoje.slice(0, 7) === dados.calMes ? hoje : `${dados.calMes}-01`;
  const inicio = new Date(ano, mes - 1, 1).getDay(), dias = new Date(ano, mes, 0).getDate();
  let html = SEMANA.map((d) => `<div class="cal-semana">${d}</div>`).join("") + '<div class="cal-vazio"></div>'.repeat(inicio);
  for (let d = 1; d <= dias; d++) {
    const iso = `${dados.calMes}-${String(d).padStart(2, "0")}`, evs = eventosDoDia(iso);
    const chips = evs.slice(0, 2).map((e) => `<span class="cal-chip ban-${tipoClasse(e.tipo)}">${esc(e.titulo)}</span>`).join("") + (evs.length > 2 ? `<span class="cal-mais">+${evs.length - 2}</span>` : "");
    const pontos = evs.slice(0, 3).map((e) => `<i class="ban-${tipoClasse(e.tipo)}" aria-hidden="true">${esc(e.tipo.slice(0, 2))}</i>`).join("");
    html += `<button class="cal-dia ${iso === hoje ? "hoje" : ""} ${iso < hoje ? "passado" : ""} ${iso === dados.calDia ? "sel" : ""}" data-dia="${iso}">
      <span class="cal-num">${d}</span><span class="cal-chips">${chips}</span><span class="cal-pontos">${pontos}</span><span class="so-leitor">${evs.length ? `, ${pl(evs.length, "evento", "eventos")}` : ""}</span></button>`;
  }
  document.getElementById("cal-grade").innerHTML = html;
  document.querySelectorAll("[data-dia]").forEach((b) => b.onclick = () => {
    dados.calDia = b.dataset.dia; desenharCalendario();
    const campo = document.getElementById("ev-data"); // o dia clicado já vai para o "Novo evento", se não tiver passado
    if (campo && dados.calDia >= hoje) { campo.value = dados.calDia; campo.dispatchEvent(new Event("change")); }
  });
  const doDia = eventosDoDia(dados.calDia), titulo = new Date(dados.calDia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const avisoPassado = dados.calDia < hoje && usuarioLogado.papel !== "pai" ? `<p class="cal-aviso-passado">${ico("cadeado")} Este dia já passou. Novos eventos só podem ser marcados para hoje ou para os próximos dias.</p>` : "";
  document.getElementById("cal-dia").innerHTML = `<h2>${titulo.charAt(0).toUpperCase() + titulo.slice(1)}</h2>${avisoPassado}${doDia.length ? doDia.map(cartaoEvento).join("") : vazio("Nenhum evento neste dia.")}`;
  document.getElementById("cal-proximos").innerHTML = dados.cal.proximos.length ? dados.cal.proximos.map((e) => `<button class="proximo" data-ir-dia="${e.data}">
      <span class="proximo-data ban-${tipoClasse(e.tipo)}"><b>${Number(e.data.slice(8))}</b><small>${new Date(e.data + "T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
      <span><b>${esc(e.titulo)}</b><small>${esc(e.tipo)} • ${quandoEvento(e)}${e.sala ? " • " + esc(e.sala) : ""}</small></span></button>`).join("") : vazio("Nenhum evento marcado.");
  document.querySelectorAll("[data-ir-dia]").forEach((b) => b.onclick = seguro(async () => { await irParaMes(b.dataset.irDia.slice(0, 7), b.dataset.irDia); }));
  document.querySelectorAll("[data-editar-evento]").forEach((b) => b.onclick = () => editarEvento(Number(b.dataset.editarEvento)));
  document.querySelectorAll("[data-excluir-evento]").forEach((b) => b.onclick = seguro(async () => {
    if (!(await confirmar({ titulo: "Excluir este evento?", texto: `"${b.dataset.titulo}" sai do calendário e dos banners para todas as pessoas. Essa ação não pode ser desfeita.`, botao: "Excluir evento", perigo: true }))) return;
    await api(`/api/eventos/${b.dataset.excluirEvento}`, { method: "DELETE" });
    dados.calMsg = "Evento excluído."; await mostrar("calendario");
  }));
  carregarImagensBanner(document.getElementById("cal-dia"));
}
async function irParaMes(mes, dia) {
  dados.calMes = mes; dados.calDia = dia || null;
  dados.cal = await api("/api/eventos?mes=" + mes);
  desenharCalendario();
}
// Editar evento (só a gestão): o formulário "Novo evento" vira "Editar evento" com os dados preenchidos
function modoFormEvento(e) {
  const $ = (id) => document.getElementById(id), hoje = hojeLocalISO();
  dados.eventoEditando = e || null;
  $("ev-form-titulo").textContent = e ? "Editar evento" : "Novo evento";
  $("ev-salvar").textContent = e ? "Salvar alterações" : "Criar evento";
  $("ev-cancelar").classList.toggle("oculto", !e);
  $("ev-remover").checked = false; $("ev-remover-box").classList.toggle("oculto", !(e && e.tem_banner));
  $("ev-erro").classList.add("oculto");
  if (!e) { $("form-evento").reset(); $("ev-eca-box").classList.add("oculto"); }
  $("ev-titulo").value = e ? e.titulo : ""; $("ev-desc").value = e ? e.descricao || "" : "";
  if (e) $("ev-tipo").value = e.tipo;
  $("ev-hora").value = e ? e.hora || "" : ""; $("ev-local").value = e ? e.local || "" : "";
  if ($("ev-sala")) $("ev-sala").value = e ? e.sala || "" : "";
  $("ev-destaque").checked = !!(e && e.destaque);
  // um evento que já aconteceu pode manter a data dele, mas não pode ir para outro dia que já passou
  $("ev-data").min = e && e.data < hoje ? e.data : hoje;
  $("ev-data").value = e ? e.data : (dados.calDia >= hoje ? dados.calDia : hoje);
  $("ev-fim").value = e ? e.data_fim || "" : "";
  $("ev-data").onchange();
}
function editarEvento(id) {
  const e = [...dados.cal.eventos, ...dados.cal.proximos].find((x) => x.id === id);
  if (!e || !document.getElementById("form-evento")) return;
  modoFormEvento(e);
  const form = document.getElementById("form-evento");
  form.scrollIntoView({ behavior: menosMovimento() ? "auto" : "smooth", block: "start" });
  setTimeout(() => document.getElementById("ev-titulo").focus({ preventScroll: true }), 300);
}
function ligarCalendario() {
  const mover = (delta) => seguro(async () => {
    const [a, m] = dados.calMes.split("-").map(Number), d = new Date(a, m - 1 + delta, 1);
    await irParaMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  document.getElementById("cal-ant").onclick = mover(-1);
  document.getElementById("cal-prox").onclick = mover(1);
  document.getElementById("cal-hoje").onclick = seguro(() => irParaMes(hojeLocalISO().slice(0, 7), hojeLocalISO()));
  desenharCalendario();
  const form = document.getElementById("form-evento");
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  // Eventos só de hoje em diante: o calendário do navegador não deixa escolher dia passado
  const hoje = hojeLocalISO();
  $("ev-data").min = hoje; $("ev-fim").min = hoje;
  $("ev-data").value = dados.calDia >= hoje ? dados.calDia : hoje;
  $("ev-data").onchange = () => { $("ev-fim").min = $("ev-data").value || hoje; };
  $("ev-data").onchange();
  dados.eventoEditando = null;
  $("ev-cancelar").onclick = () => modoFormEvento(null);
  $("ev-imagem").onchange = () => $("ev-eca-box").classList.toggle("oculto", !$("ev-imagem").files.length);
  form.onsubmit = async (e) => {
    e.preventDefault(); $("ev-erro").classList.add("oculto");
    try {
      const arquivo = $("ev-imagem").files[0];
      const editando = dados.eventoEditando;
      if (!$("ev-data").value || ($("ev-data").value < hojeLocalISO() && !(editando && editando.data === $("ev-data").value))) throw new Error("Não é possível marcar evento em uma data que já passou. Escolha hoje ou um dia futuro");
      if ($("ev-fim").value && $("ev-fim").value < $("ev-data").value) throw new Error("A data de término precisa ser igual ou depois da data de início");
      if (arquivo && arquivo.size > 2 * 1024 * 1024) throw new Error("A imagem do banner precisa ter até 2 MB");
      if (arquivo && !$("ev-eca").checked) throw new Error("Confirme que a imagem não mostra alunos, ou que todos têm autorização de uso de imagem");
      const sala = $("ev-sala");
      await api(editando ? `/api/eventos/${editando.id}` : "/api/eventos", { method: editando ? "PUT" : "POST", body: JSON.stringify({ remover_banner: editando ? $("ev-remover").checked : undefined, titulo: $("ev-titulo").value, tipo: $("ev-tipo").value, data: $("ev-data").value,
        data_fim: $("ev-fim").value || undefined, hora: $("ev-hora").value || undefined, local: $("ev-local").value, sala: sala ? sala.value : undefined,
        descricao: $("ev-desc").value, destaque: $("ev-destaque").checked, imagem_sem_alunos: $("ev-eca").checked,
        banner: arquivo ? { nome_arquivo: arquivo.name, conteudo: await lerBase64(arquivo) } : undefined }) });
      dados.calMsg = `Evento "${$("ev-titulo").value.trim()}" ${editando ? "atualizado" : "criado"}.`; dados.eventoEditando = null; dados.calMes = $("ev-data").value.slice(0, 7); dados.calDia = $("ev-data").value;
      await mostrar("calendario");
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("ev-erro", erro.message); }
  };
}

// ---------- Perfil do responsável ----------
function telaPerfil() {
  const p = dados.perfil, r = p.responsavel || {}, c = p.conta, f = p.filho;
  const [rotulo, tom] = statusConsent[p.consentimento.status];
  const msg = dados.perfilMsg || ""; dados.perfilMsg = "";
  return `<div class="topo"><h2>Meu perfil</h2><small>Seus dados de contato, seu filho e a segurança da sua conta.</small></div>
  <div class="grade dois" style="align-items:start">
    <form id="form-perfil" class="card"><div class="aluno"><span class="avatar" style="width:48px;height:48px;font-size:1rem">${iniciais(c.nome)}</span><div><h2>${esc(c.nome)}</h2><small>Login: ${esc(c.login)} • Responsável desde ${c.criado_em}</small></div></div>
      <small style="margin-top:10px">O nome é usado nas assinaturas digitais. Para corrigi-lo, procure a secretaria da escola (LGPD, art. 18, III).</small>
      <div class="grade dois" style="margin-top:14px"><div><small>Telefone principal</small><input id="pf-tel" required maxlength="20" value="${esc(r.telefone || "")}" placeholder="(11) 90000-0000" inputmode="tel" autocomplete="tel"></div>
        <div><small>Telefone para recados (opcional)</small><input id="pf-tel2" maxlength="20" value="${esc(r.telefone2 || "")}" inputmode="tel"></div></div>
      <div style="margin-top:12px"><small>E-mail (opcional)</small><input id="pf-email" type="email" maxlength="120" value="${esc(r.email || "")}" autocomplete="email"></div>
      <div style="margin-top:12px"><small>Como prefere que a escola entre em contato?</small><select id="pf-contato">${p.contatos.map((x) => `<option ${x === r.contato_preferido ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <p id="pf-erro" class="pill danger oculto" style="margin-top:12px;white-space:normal"></p>
      ${msg ? `<p class="pill success" style="margin-top:12px">${esc(msg)}</p>` : ""}
      <button class="btn" type="submit" style="max-width:220px">Salvar contatos</button>
      ${r.atualizado_em ? `<small style="margin-top:8px">Atualizado em ${r.atualizado_em}</small>` : ""}</form>
    <div>
      <section class="card"><h2>Meu filho</h2>
        <div class="aluno" style="margin-top:10px"><span class="avatar">${iniciais(f.nome)}</span><div><b>${esc(f.nome)}</b><small>${esc(f.sala)} • Matrícula ${esc(f.matricula || "—")} • você é ${esc(f.parentesco || "responsável")}</small></div></div>
        ${p.outros_responsaveis.length ? `<small style="margin-top:12px;font-weight:700;text-transform:uppercase">Outros responsáveis cadastrados</small>${p.outros_responsaveis.map((o) => `<small>${esc(o.nome)} (${esc(o.parentesco)})</small>`).join("")}` : ""}
        <div class="linha" style="margin-top:14px;flex-wrap:wrap;gap:8px"><span>Consentimento (imagem e informações): ${pill(rotulo, tom)}</span><button class="btn outline pequeno" data-consent="alterar">${p.consentimento.status === "pendente" ? "Responder ao termo" : "Alterar ou revogar"}</button></div>
        <div class="acoes"><button class="btn outline pequeno" id="pf-dados">${ico("documento")} Baixar os dados do meu filho (LGPD)</button></div></section>
      <section class="card" style="margin-top:16px"><h2>Segurança da conta</h2>
        <small>Último acesso: ${c.ultimo_acesso || "—"}</small>
        <small>Política de privacidade aceita em ${c.aceite_em || "—"} (versão ${esc(c.aceite_versao || "—")})</small>
        ${p.ultimos_acessos.length ? `<small style="margin-top:10px;font-weight:700;text-transform:uppercase">Últimos acessos à sua conta</small>${p.ultimos_acessos.map((a) => `<small>${ico("cadeadoAberto")} ${a.quando}</small>`).join("")}<small style="margin-top:6px">Não reconhece algum acesso? Troque sua senha e avise a escola.</small>` : ""}
        <div class="acoes"><button class="btn pequeno" id="pf-senha">${ico("chave")} Trocar senha</button><button class="btn outline pequeno" id="pf-politica">${ico("cadeado")} Política de privacidade</button></div></section>
    </div>
  </div>`;
}
function ligarPerfil() {
  const $ = (id) => document.getElementById(id);
  $("pf-senha").onclick = () => mostrarTelaSenha(false);
  $("pf-politica").onclick = () => mostrarTermo("ler");
  $("pf-dados").onclick = seguro(() => baixarDadosAluno(dados.perfil.filho.id));
  $("form-perfil").onsubmit = async (e) => {
    e.preventDefault(); $("pf-erro").classList.add("oculto");
    try {
      await api("/api/meu-perfil", { method: "PUT", body: JSON.stringify({ telefone: $("pf-tel").value, telefone2: $("pf-tel2").value, email: $("pf-email").value, contato_preferido: $("pf-contato").value }) });
      dados.perfilMsg = "Contatos atualizados! A escola já vê os dados novos."; await mostrar("perfil");
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("pf-erro", erro.message); }
  };
}

// =====================================================================
// FASE 5 — Monitoramento: câmeras e reconhecimento facial (SIMULADOS) e situação ao vivo
// =====================================================================
const situacaoAgora = { na_escola: ["Na escola", "success"], saiu: ["Saiu", "info"], nao_chegou: ["Não chegou", "neutral"], ausente: ["Ausente", "danger"] };
const pillAgora = (a) => pill(a.texto, situacaoAgora[a.situacao][1]);
function telaSeguranca() {
  return `<div class="topo"><h2>Monitoramento</h2><small>Câmeras, reconhecimento facial e entradas e saídas de hoje. <b>Simulação:</b> não há câmeras de verdade ligadas a este sistema.</small></div>
  <div class="grade g4" id="mon-metricas"></div>
  <section class="card" id="mon-facial" style="margin-bottom:20px"></section>
  <div id="mon-resultado" aria-live="polite"></div>
  <div class="linha" style="flex-wrap:wrap;gap:8px;margin-bottom:12px"><h2>Câmeras</h2><button class="btn pequeno" id="mon-chegada">${ico("play")} Simular chegada de quem falta</button></div>
  <div class="cams" id="mon-cams"></div>
  <div class="grade dois" style="margin-top:20px;align-items:start">
    <section class="card"><div class="linha"><div><h2>Passagens de hoje</h2><small>Reconhecimento facial nos portões</small></div><span class="pill success">● AO VIVO</span></div><div id="mon-eventos"></div></section>
    <section class="card"><h2>Liberação de saída</h2><small>Consulte os responsáveis autorizados antes de liberar a retirada.</small>
      <div style="margin-top:16px"><small>Turma e aluno</small><select id="saida-aluno" data-filtro-turma><option value="">Escolha o aluno...</option>${opcoesAlunos(dados.mon.alunos)}</select></div>
      <input id="buscaSaida" aria-label="Ou digite o nome do aluno" placeholder="Ou digite o nome do aluno (ex.: João Pedro)" style="margin-top:10px"><div id="resultado"></div></section>
  </div>
  <section class="card" style="margin-top:20px"><div class="linha" style="flex-wrap:wrap;gap:8px"><div><h2>Situação dos alunos agora</h2><small>Atualiza sozinha a cada 5 segundos.</small></div>
    <div class="linha" style="gap:8px;flex-wrap:wrap"><select id="mon-turma" class="filtro-turma-tabela" aria-label="Filtrar por turma" style="width:auto"><option value="">Todas as turmas</option>${turmasDe(dados.mon.alunos).map((s) => `<option${s === dados.turmaMon ? " selected" : ""}>${esc(s)}</option>`).join("")}</select><input id="mon-busca" class="campo-busca" placeholder="Buscar aluno..." aria-label="Buscar aluno" style="max-width:240px"></div></div>
    <div class="tabela"><table><caption class="so-leitor">Situação dos alunos agora</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Agora</th><th scope="col">Cadastro facial</th><th scope="col">Portaria</th></tr></thead><tbody id="mon-alunos"></tbody></table></div></section>
  <form id="form-camera" class="card" style="margin-top:20px"><h2>Nova câmera</h2>
    <small>Câmeras só em áreas comuns: o sistema recusa banheiros, vestiários e trocadores (ECA, art. 17). Reconhecimento facial só nos portões.</small>
    <div class="grade g3" style="margin-top:12px"><div><small>Nome</small><input id="cam-nome" required maxlength="60" placeholder="Ex.: Portão da quadra"></div>
      <div><small>Onde fica</small><input id="cam-local" required maxlength="60" placeholder="Ex.: Entrada da quadra"></div>
      <div><small>Tipo</small><select id="cam-tipo"><option>Entrada</option><option>Saída</option><option>Área comum</option></select></div></div>
    <label class="termo-aceite" id="cam-rec-box"><input type="checkbox" id="cam-rec"> <span>Fazer reconhecimento facial nesta câmera (só alunos com cadastro facial)</span></label>
    <p id="cam-erro" class="pill danger oculto" style="margin-top:12px;white-space:normal"></p>
    <button class="btn" type="submit" style="margin-top:14px;max-width:220px">Cadastrar câmera</button></form>`;
}
function desenharMonMetricas() {
  const m = dados.mon, r = m.resumo, ativas = m.cameras.filter((c) => c.ativa).length;
  document.getElementById("mon-metricas").innerHTML =
    metrica(ico("escola"), "Na escola agora", r.na_escola, `${r.nao_chegou} não chegaram • ${r.saiu} saíram`, "success", "Ao vivo") +
    metrica(ico("camera"), "Câmeras online", `${ativas}/${m.cameras.length}`, ativas === m.cameras.length ? "Todas funcionando" : pl(m.cameras.length - ativas, "desligada", "desligadas"), ativas === m.cameras.length ? "info" : "warning", "Agora") +
    metrica(ico("rosto"), "Reconhecidos hoje", r.reconhecidos_hoje, `${pl(r.com_cadastro_facial, "aluno", "alunos")} com cadastro facial`, "info", "Hoje") +
    metrica(ico("proibido"), "Sem cadastro facial", r.sem_cadastro_hoje, "imagens descartadas hoje", "neutral", "Hoje");
}
function desenharMonFacial() {
  const f = dados.mon.facial;
  document.getElementById("mon-facial").innerHTML = `<div class="linha" style="flex-wrap:wrap;gap:10px">
      <div><h2>Reconhecimento facial ${f.ligado ? pill("Ligado", "success") : pill("Desligado", "neutral")}</h2><small>${f.alterado_por ? `Alterado por ${esc(f.alterado_por)} em ${f.alterado_em}` : ""}</small></div>
      <button class="btn ${f.ligado ? "outline" : ""} pequeno" id="mon-facial-btn">${f.ligado ? "Desligar o reconhecimento" : "Ligar o reconhecimento"}</button></div>
    <div class="regras"><small>${ico("confere", "ok")} Só reconhece alunos cujo responsável <b>autorizou</b> no Termo de Consentimento (dado biométrico é dado sensível: LGPD, art. 11). Se o responsável revogar, para na hora.</small>
      <small>${ico("confere", "ok")} Só para turmas <b>a partir do Pré</b> (berçário e maternal ficam de fora).</small>
      <small>${ico("confere", "ok")} Só nos <b>portões</b> de entrada e saída. Câmeras de área comum só gravam e nunca ficam em banheiros ou vestiários.</small>
      <small>${ico("confere", "ok")} <b>Não guarda fotos nem biometria</b>: sem cadastro facial, a imagem é descartada e ninguém é identificado. As passagens são apagadas depois de ${f.retencao_dias} dias.</small>
      <small>${ico("confere", "ok")} Os responsáveis veem só a entrada e a saída do próprio filho, nunca as câmeras.</small></div>`;
  document.getElementById("mon-facial-btn").onclick = seguro(async () => {
    if (f.ligado && !(await confirmar({ titulo: "Desligar o reconhecimento facial?", texto: "As câmeras deixam de identificar os alunos na hora. A partir de agora, as entradas e saídas precisam ser registradas pela portaria.", botao: "Desligar", perigo: true }))) return;
    await api("/api/configuracoes/reconhecimento-facial", { method: "PUT", body: JSON.stringify({ ligado: !f.ligado }) });
    await recarregarMonitoramento(true);
  });
}
// Vídeo SIMULADO de cada câmera (assets/cameras): desenhado, 10 s em loop, pessoas de longe e sem rosto. Câmera nova usa a cena do seu tipo.
function videoDaCamera(c) {
  const cena = /refeit/i.test(c.nome) ? "refeitorio" : c.tipo === "Entrada" ? "portao-entrada" : c.tipo === "Saída" ? "portao-saida" : "patio";
  const parado = menosMovimento(); // quem pediu menos movimento vê só a imagem parada
  return `<video src="assets/cameras/${cena}.mp4" poster="assets/cameras/${cena}.jpg" muted loop playsinline ${parado ? "" : "autoplay"} preload="auto" aria-hidden="true" tabindex="-1"></video>`;
}
function desenharMonCameras() {
  const alunos = opcoesAlunos(dados.mon.alunos);
  document.getElementById("mon-cams").innerHTML = dados.mon.cameras.map((c) => `<article class="cam ${c.ativa ? "" : "desligada"}" data-cam="${c.id}">
    <div class="cam-video" role="img" aria-label="Imagem simulada da câmera ${esc(c.nome)}">
      ${c.ativa ? `${videoDaCamera(c)}<span class="cam-rec">● REC</span>` : `<span class="cam-sem-sinal">${ico("semSinal")} Sem sinal</span>`}
      <span class="cam-nome">${esc(c.nome)}</span><span class="cam-hora"></span>
      <div class="cam-alerta oculto" data-cam-alerta="${c.id}"></div></div>
    <div class="cam-info"><div class="linha" style="gap:6px;flex-wrap:wrap"><small>${ico("local")} ${esc(c.local)}</small><span>${pill(c.tipo, "neutral")} ${c.reconhecimento ? pill("Facial", "info") : ""}</span></div>
      ${c.reconhecimento ? `<small>${c.passagens_hoje} passagem(ns) hoje</small>` : "<small>Só gravação (área comum)</small>"}
      ${c.reconhecimento && c.ativa ? `<div style="margin-top:8px"><small>Simular passagem de</small><select data-cam-aluno="${c.id}" data-filtro-turma><option value="">Aluno escolhido pelo sistema</option><option value="desconhecido">Visitante (rosto desconhecido)</option>${alunos}</select></div>
        <button class="btn pequeno" data-simular="${c.id}" style="margin-top:8px">${ico("foto")} Simular passagem</button>` : ""}
      <button class="btn outline pequeno" data-cam-ativa="${c.id}" data-ligar="${c.ativa ? 0 : 1}" style="margin-top:8px">${c.ativa ? "Desligar câmera" : "Ligar câmera"}</button></div></article>`).join("");
  document.querySelectorAll("[data-simular]").forEach((b) => b.onclick = seguro(async () => {
    const escolha = document.querySelector(`[data-cam-aluno="${b.dataset.simular}"]`).value;
    b.disabled = true;
    try { await simularPassagem(Number(b.dataset.simular), escolha); } finally { b.disabled = false; }
  }));
  document.querySelectorAll("[data-cam-ativa]").forEach((b) => b.onclick = seguro(async () => {
    await api(`/api/cameras/${b.dataset.camAtiva}/ativa`, { method: "PUT", body: JSON.stringify({ ativa: b.dataset.ligar === "1" }) });
    await recarregarMonitoramento(true);
  }));
  atualizarRelogio();
}
async function simularPassagem(camId, escolha) {
  const corpo = { cam_id: camId };
  if (escolha === "desconhecido") corpo.desconhecido = true; else if (escolha) corpo.aluno_id = Number(escolha);
  const r = await api("/api/reconhecimento/simular", { method: "POST", body: JSON.stringify(corpo) });
  dados.monResultado = { ...r, camId };
  const alerta = document.querySelector(`[data-cam-alerta="${camId}"]`);
  if (alerta) {
    alerta.className = `cam-alerta ${r.resultado === "Reconhecido" ? "ok" : "nao"}`;
    alerta.innerHTML = r.resultado === "Reconhecido" ? `${ico("visto")} ${esc(r.aluno.nome.split(" ")[0])} • ${String(r.confianca).replace(".", ",")}%` : `${ico("proibido")} Sem cadastro facial`;
    setTimeout(() => alerta.classList.add("oculto"), 3500);
  }
  await recarregarMonitoramento(false);
  return r;
}
function desenharMonResultado() {
  const r = dados.monResultado, caixa = document.getElementById("mon-resultado");
  if (!r) { caixa.innerHTML = ""; return; }
  const ok = r.resultado === "Reconhecido", podeManual = !ok && r.aluno;
  const cam = dados.mon.cameras.find((c) => c.id === r.camId);
  caixa.innerHTML = `<div class="card" style="margin-bottom:16px;border-left:4px solid var(${ok ? "--success" : "--warning"})"><div class="linha" style="flex-wrap:wrap;gap:8px">
    <div><b>${ok ? ico("visto") + " Reconhecido" : ico("proibido") + " Sem cadastro facial"} • ${esc(r.camera)} • ${esc(r.sentido)}</b><small>${esc(r.mensagem)}</small></div>
    ${podeManual ? `<button class="btn pequeno" data-manual="${r.aluno.id}" data-sentido="${r.sentido}" data-cam="${cam ? cam.id : ""}" style="width:auto">Registrar ${r.sentido === "Entrada" ? "entrada" : "saída"} pela portaria</button>` : ""}</div></div>`;
  ligarBotoesManual(caixa);
}
function ligarBotoesManual(raiz) {
  raiz.querySelectorAll("[data-manual]").forEach((b) => b.onclick = seguro(async () => {
    const entrada = b.dataset.sentido === "Entrada";
    await api(entrada ? "/api/acessos" : "/api/saidas/manual", { method: "POST", body: JSON.stringify({ aluno_id: Number(b.dataset.manual), cam_id: Number(b.dataset.cam) || undefined }) });
    dados.monResultado = null;
    await recarregarMonitoramento(false);
  }));
}
function desenharMonEventos() {
  const ev = dados.mon.eventos;
  document.getElementById("mon-eventos").innerHTML = ev.length ? ev.map((e) => `<div class="log">
    <div class="icone ${e.resultado === "Reconhecido" ? "success" : "neutral"}">${ico(e.resultado === "Reconhecido" ? "visto" : "proibido")}</div>
    <div><b>${e.resultado === "Reconhecido" ? `${e.sentido}: ${esc(e.aluno)}` : "Rosto sem cadastro facial"}</b><small>${esc(e.camera)} • ${e.resultado === "Reconhecido" ? `${esc(e.sala)} • ${String(e.confianca).replace(".", ",")}% de confiança` : "imagem descartada, ninguém identificado"}</small></div><small>${e.hora}</small></div>`).join("")
    : vazio("Nenhuma passagem pelas câmeras hoje.");
}
function desenharMonAlunos() {
  const busca = (document.getElementById("mon-busca").value || "").toLowerCase();
  const camEntrada = dados.mon.cameras.find((c) => c.tipo === "Entrada"), camSaida = dados.mon.cameras.find((c) => c.tipo === "Saída");
  const turmaMon = document.getElementById("mon-turma").value;
  document.getElementById("mon-alunos").innerHTML = dados.mon.alunos.filter((a) => (!turmaMon || a.sala === turmaMon) && a.nome.toLowerCase().includes(busca)).map((a) => `<tr>
    <td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${esc(a.nome)}</b><small>${esc(a.sala)}</small></div></div></td>
    <td>${pillAgora(a)}<small>${esc(a.detalhe)}</small></td>
    <td>${a.facial.ok ? pill(ico("visto") + " Ativo", "success") : pill("Sem cadastro", "neutral")}<small>${esc(a.facial.motivo)}</small></td>
    <td>${a.situacao === "na_escola" ? `<button class="btn outline pequeno" data-manual="${a.id}" data-sentido="Saída" data-cam="${camSaida ? camSaida.id : ""}">Registrar saída</button>`
      : a.situacao !== "ausente" ? `<button class="btn outline pequeno" data-manual="${a.id}" data-sentido="Entrada" data-cam="${camEntrada ? camEntrada.id : ""}">Registrar entrada</button>` : "—"}</td></tr>`).join("");
  ligarBotoesManual(document.getElementById("mon-alunos"));
}
async function recarregarMonitoramento(cameras) {
  dados.mon = await api("/api/monitoramento");
  if (tela !== "seguranca") return;
  desenharMonMetricas(); desenharMonEventos(); desenharMonAlunos(); desenharMonResultado();
  if (cameras) { desenharMonFacial(); desenharMonCameras(); }
}
function ligarMonitoramento() {
  desenharMonMetricas(); desenharMonFacial(); desenharMonCameras(); desenharMonEventos(); desenharMonAlunos(); desenharMonResultado(); desenharSaida();
  document.getElementById("mon-busca").oninput = desenharMonAlunos;
  document.getElementById("mon-turma").onchange = (e) => { dados.turmaMon = e.target.value; desenharMonAlunos(); };
  document.getElementById("buscaSaida").oninput = () => { liberada = false; const s = document.getElementById("saida-aluno"); if (s.value) s.value = ""; desenharSaida(); };
  document.getElementById("saida-aluno").onchange = (e) => { liberada = false; if (e.target.value) document.getElementById("buscaSaida").value = ""; desenharSaida(); };
  // demonstração: quem ainda não chegou passa pelo portão principal, um de cada vez
  document.getElementById("mon-chegada").onclick = seguro(async () => {
    const cam = dados.mon.cameras.find((c) => c.tipo === "Entrada" && c.reconhecimento && c.ativa);
    if (!cam) throw new Error("Ligue uma câmera de entrada com reconhecimento facial");
    if (!dados.mon.facial.ligado) throw new Error("Ligue o reconhecimento facial para simular");
    const faltam = dados.mon.alunos.filter((a) => a.situacao === "nao_chegou");
    if (!faltam.length) throw new Error("Todos os alunos já chegaram ou estão ausentes hoje");
    const botao = document.getElementById("mon-chegada"); botao.disabled = true;
    try {
      for (const a of faltam) {
        if (tela !== "seguranca") return;
        await simularPassagem(cam.id, String(a.id));
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } finally { if (document.getElementById("mon-chegada")) botao.disabled = false; }
  });
  const formCam = document.getElementById("form-camera"), $ = (id) => document.getElementById(id);
  const sincronizar = () => { const comum = $("cam-tipo").value === "Área comum"; $("cam-rec").disabled = comum; if (comum) $("cam-rec").checked = false; };
  $("cam-tipo").onchange = sincronizar; sincronizar();
  formCam.onsubmit = async (e) => {
    e.preventDefault(); $("cam-erro").classList.add("oculto");
    try {
      await api("/api/cameras", { method: "POST", body: JSON.stringify({ nome: $("cam-nome").value, local: $("cam-local").value, tipo: $("cam-tipo").value, reconhecimento: $("cam-rec").checked }) });
      formCam.reset(); sincronizar(); await recarregarMonitoramento(true);
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("cam-erro", erro.message); }
  };
  timerTela = setInterval(() => recarregarMonitoramento(false).catch(() => {}), 5000);
}
async function desenharSaida() {
  const texto = document.getElementById("buscaSaida").value.trim(), escolhido = (document.getElementById("saida-aluno") || {}).value;
  const box = document.getElementById("resultado");
  const vazioSaida = `<div class="vazio"><b>Escolha a turma e o aluno</b><small>Ou digite o nome. Os responsáveis autorizados aparecem aqui.</small></div>`;
  if (!escolhido && texto.length < 3) { box.innerHTML = vazioSaida; return; }
  const r = await api(escolhido ? "/api/saida?id=" + encodeURIComponent(escolhido) : "/api/saida?nome=" + encodeURIComponent(texto));
  if (!r) { box.innerHTML = vazioSaida; return; }
  const naEscola = r.status && r.status.situacao === "na_escola";
  box.innerHTML = `<div class="linha info" style="padding:12px;border-radius:8px;margin-top:20px;flex-wrap:wrap;gap:8px"><div><b>${esc(r.aluno.nome)}</b><small>${esc(r.aluno.sala)} • Matrícula ${esc(r.aluno.matricula || "—")}</small></div>${r.status ? pillAgora(r.status) : ""}</div>
    <small style="margin-top:16px;font-weight:700;text-transform:uppercase">Responsáveis autorizados para retirada</small>
    <div class="responsaveis resp-2">${r.responsaveis.map((x) => `<article class="resp"><div class="aluno">${x.foto ? `<img src="${esc(x.foto)}" alt="${esc(x.nome)}">` : `<span class="avatar">${iniciais(x.nome)}</span>`}<div><b>${esc(x.nome)}</b><small>${esc(x.parentesco)}</small></div></div><small style="margin-top:10px">${ico("telefone")} ${esc(x.telefone || "—")}</small></article>`).join("") || "<small>Nenhum responsável cadastrado.</small>"}</div>
    ${naEscola || liberada ? `<button class="btn" id="liberar" ${liberada ? "disabled" : ""}>${liberada ? ico("confere") + " Saída liberada" : ico("escudoOk") + " Confirmar liberação"}</button>` : `<small style="margin-top:10px">A liberação só aparece quando o aluno está na escola.</small>`}`;
  const botao = document.getElementById("liberar");
  if (botao && !liberada) botao.onclick = seguro(async () => {
    await api("/api/saidas", { method: "POST", body: JSON.stringify({ aluno_id: r.aluno.id }) });
    liberada = true; await desenharSaida(); await recarregarMonitoramento(false);
  });
}


// ---------- Cadastro de aluno ----------
const porNome = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
const nomesTurmas = () => (dados.turmas || []).filter((t) => t.ativa).map((t) => t.nome).sort(porNome); // turmas em uso, para os campos de escolha
function telaCadastroAluno() {
  const msg = dados.cadastroMsg || ""; dados.cadastroMsg = "";
  const todos = dados.alunos || [], alunos = todos.filter((a) => a.situacao === "Ativo"), foraDaEscola = todos.filter((a) => a.situacao !== "Ativo");
  // Ações pouco usadas e sensíveis (mudar a situação do aluno) ficam num menu "⋯", com confirmação. Antes era um seletor solto em cada linha.
  const menuAluno = (a) => `<details class="menu-acoes"><summary class="btn outline pequeno" aria-label="Mais ações para ${esc(a.nome)}" title="Mais ações">${ico("mais")}</summary>
    <div class="menu-acoes-lista"><button type="button" data-ca-situacao="${a.id}" data-nome="${esc(a.nome)}" data-atual="${esc(a.situacao)}">Mudar situação…</button></div></details>`;
  const tomSituacao = { Ativo: "success", Transferido: "info", Concluiu: "neutral", Desistente: "warning" };
  const linhaAluno = (a, fora) => `<tr data-turma="${esc(a.sala)}" data-nome="${esc(a.nome.toLowerCase())}"><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${esc(a.matricula || "—")}</td>
    <td>${pill(esc(a.situacao), tomSituacao[a.situacao] || "neutral")}${fora && a.situacao_em ? `<small>desde ${a.situacao_em}</small>` : ""}</td>
    <td class="celula-acoes"><button type="button" class="btn outline pequeno" data-ca-ficha="${a.id}">Abrir ficha</button>${menuAluno(a)}</td></tr>`;
  const ordenados = [...alunos].sort((x, y) => porNome(x.sala, y.sala) || porNome(x.nome, y.nome));
  const turmasComAluno = [...new Set(alunos.map((a) => a.sala))].sort(porNome);
  const lista = ordenados.length ? `<div class="linha filtros-lista">
      <select id="ca-filtro-turma" aria-label="Filtrar por turma" style="width:auto"><option value="">Todas as turmas (${alunos.length})</option>${turmasComAluno.map((t) => `<option value="${esc(t)}">${esc(t)} (${alunos.filter((a) => a.sala === t).length})</option>`).join("")}</select>
      <input id="ca-busca" class="campo-busca" placeholder="Buscar pelo nome..." aria-label="Buscar aluno pelo nome" style="max-width:280px"></div>
    <div class="tabela"><table><caption class="so-leitor">Alunos matriculados</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Turma</th><th scope="col">Matrícula</th><th scope="col">Situação</th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead><tbody id="ca-linhas">${ordenados.map((a) => linhaAluno(a, false)).join("")}</tbody></table></div>
    <small id="ca-contagem" style="margin-top:8px"></small>` : "";
  const fora = foraDaEscola.length ? `<details class="pasta" style="margin-top:18px"><summary><b>${ico("pasta")} Fora da escola</b> <small style="display:inline">(${foraDaEscola.length}: transferidos, concluintes e desistentes)</small></summary>
    <div class="tabela"><table><caption class="so-leitor">Alunos fora da escola</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Última turma</th><th scope="col">Matrícula</th><th scope="col">Situação</th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead><tbody>${[...foraDaEscola].sort((x, y) => porNome(x.nome, y.nome)).map((a) => linhaAluno(a, true)).join("")}</tbody></table></div></details>` : "";
  const editando = dados.turmaEditando ? (dados.turmas || []).find((t) => t.id === dados.turmaEditando) : null;
  const opcoesTurno = (atual) => `<option value="">—</option>${["Manhã", "Tarde", "Integral", "Noite"].map((t) => `<option ${t === atual ? "selected" : ""}>${t}</option>`).join("")}`;
  return `<div class="topo linha" style="flex-wrap:wrap">
    <div><h2>Alunos e turmas</h2><small>Todos os alunos em uma lista: filtre pela turma ou busque pelo nome. As turmas ficam logo abaixo.</small></div>
    <button type="button" class="btn" id="ca-novo" style="width:auto;padding:10px 18px">+ Novo cadastro</button></div>
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  <section class="card">
    <h2>Lista de alunos (${alunos.length})</h2>
    ${lista || `<div class="vazio"><b>Nenhum aluno cadastrado</b><small>Clique em "+ Novo cadastro" para começar.</small></div>`}
    ${fora}
  </section>
  <section class="card" style="margin-top:20px">
    <h2>Turmas</h2><small>O aluno, o docente, os comunicados e os eventos só podem usar turmas desta lista. Renomear uma turma atualiza tudo sozinho.</small>
    <div class="tabela" style="margin-top:12px"><table><caption class="so-leitor">Turmas cadastradas</caption><thead><tr><th scope="col">Turma</th><th scope="col">Ano letivo</th><th scope="col">Turno</th><th scope="col">Alunos</th><th scope="col">Professores</th><th scope="col">Situação</th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead><tbody>
      ${(dados.turmas || []).map((t) => `<tr><td><b>${esc(t.nome)}</b></td><td>${t.ano_letivo}</td><td>${esc(t.turno || "—")}</td><td>${t.alunos}</td><td>${esc(t.professores || "—")}</td>
        <td>${t.ativa ? pill("Em uso", "success") : pill("Encerrada", "neutral")}</td><td><button type="button" class="btn outline pequeno" data-tur-editar="${t.id}">Editar</button></td></tr>`).join("")}
    </tbody></table></div>
    <form id="form-turma" class="grade" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px;align-items:end">
      <div><small>${editando ? "Nome da turma" : "Nova turma"}</small><input id="tur-nome" maxlength="40" required placeholder="Ex.: 3º Ano B" value="${esc(editando ? editando.nome : "")}"></div>
      <div><small>Ano letivo</small><input id="tur-ano" type="number" min="2000" max="2100" required value="${editando ? editando.ano_letivo : new Date().getFullYear()}"></div>
      <div><small>Turno</small><select id="tur-turno">${opcoesTurno(editando ? editando.turno : "")}</select></div>
      ${editando ? `<label style="display:flex;gap:6px;align-items:center;font-size:0.875rem"><input type="checkbox" id="tur-ativa" style="width:auto" ${editando.ativa ? "checked" : ""}> Turma em uso</label>` : ""}
      <div class="acoes" style="margin:0"><button class="btn pequeno" type="submit">${editando ? "Salvar alterações" : "+ Criar turma"}</button>
        ${editando ? `<button type="button" class="btn outline pequeno" id="tur-cancelar">Cancelar</button>` : ""}</div>
    </form>
    <p id="tur-erro" class="pill danger oculto" style="margin-top:10px;white-space:normal"></p>
  </section>
  <section class="card" style="margin-top:20px">
    <h2>Importar vários alunos de uma planilha</h2>
    <small>Cadastre a turma inteira de uma vez. Aceita CSV e Excel (.xlsx).</small>
    <ol style="margin:12px 0 12px 20px;font-size:0.875rem;line-height:1.6">
      <li>Baixe o modelo e preencha uma linha por aluno (pode copiar e colar da sua lista de chamada).</li>
      <li>Escolha o arquivo. O sistema confere tudo <b>antes</b> de cadastrar.</li>
      <li>Revise o resultado e confirme a importação.</li>
    </ol>
    <button type="button" class="btn outline" id="imp-modelo" style="width:auto;padding:8px 16px">${ico("baixar")} Baixar modelo da planilha</button>
    <div style="margin-top:14px"><small>Turma para todos os alunos (opcional: vale quando a coluna Turma estiver vazia ou não existir)</small><input id="imp-turma" placeholder="Ex.: 2º Ano B"></div>
    <div style="margin-top:14px"><small>Arquivo da planilha (a primeira aba é usada)</small><input type="file" id="imp-arquivo" accept=".csv,.xlsx,.txt,text/csv"></div>
    <p id="imp-erro" class="pill danger oculto" style="margin-top:12px;white-space:normal"></p>
    <div id="imp-previa" style="margin-top:14px"></div>
  </section>
  <div id="modal-aluno" class="modal oculto" role="dialog" aria-modal="true" aria-labelledby="modal-aluno-titulo">
    <div class="modal-caixa">
      <div class="linha"><h2 id="modal-aluno-titulo">Novo cadastro de aluno</h2>
        <button type="button" class="btn outline pequeno" id="ca-fechar" aria-label="Fechar" style="width:auto">✕</button></div>
      <small style="margin:4px 0 14px">Preencha os dados da criança e dos responsáveis.</small>
      <form id="form-aluno">
        <small>Nome da criança</small><input id="ca-nome" required>
        <div class="grade dois" style="margin-top:12px">
          <div><small>Turma</small><select id="ca-sala" required><option value="">Escolha a turma...</option>${nomesTurmas().map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
          <div><small>Matrícula</small><input id="ca-matricula" placeholder="Opcional"></div>
        </div>
        <div class="linha" style="margin-top:22px"><b>Responsáveis (pais, etc.)</b>
          <button type="button" class="btn outline" id="ca-add-resp" style="width:auto;padding:6px 14px;margin-top:0">+ Adicionar</button></div>
        <div id="ca-responsaveis"></div>
        <p id="ca-erro" class="pill danger oculto" style="margin-top:14px"></p>
        <button class="btn" type="submit" style="margin-top:18px;max-width:220px">Cadastrar aluno</button>
      </form>
    </div>
  </div>`;
}
// ---------- Importar alunos por planilha (CSV ou Excel) ----------
// Dois passos: "conferir" (nada é gravado) e "importar". O arquivo fica só na memória do navegador até a confirmação.
const MODELO_CSV = "\uFEFF" + [
  "Nome do aluno;Turma;Matrícula;Responsável;Parentesco;Telefone;Responsável 2;Parentesco 2;Telefone 2",
  "EXEMPLO - Maria da Silva;2º Ano B;2026001;Ana da Silva;Mãe;(11) 98888-1111;Carlos da Silva;Pai;(11) 97777-2222",
  "EXEMPLO - João Souza;2º Ano B;;Paula Souza;Mãe;(11) 96666-3333;;;",
].join("\r\n");
let impArquivo = null; // { nome, base64 } do arquivo escolhido
const situacaoImp = { ok: ["Pronto", "success"], erro: ["Com erro", "danger"], duplicado: ["Já cadastrado", "warning"], importado: ["Importado", "success"] };
function bufferParaBase64(buffer) {
  let binario = ""; const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
function erroImportacao(texto) {
  const caixa = document.getElementById("imp-erro");
  caixa.textContent = texto || ""; caixa.classList.toggle("oculto", !texto);
}
function iniciarImportacao() {
  const $ = (id) => document.getElementById(id);
  impArquivo = null;
  $("imp-modelo").onclick = () => {
    const url = URL.createObjectURL(new Blob([MODELO_CSV], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "modelo-importacao-alunos.csv"; link.click(); URL.revokeObjectURL(url);
  };
  $("imp-arquivo").onchange = async (e) => {
    const arquivo = e.target.files[0]; e.target.value = ""; // limpa para poder escolher o mesmo arquivo de novo
    if (!arquivo) return;
    $("imp-previa").replaceChildren(); erroImportacao("");
    if (arquivo.size > 2 * 1024 * 1024) return erroImportacao("O arquivo tem mais de 2 MB. Divida a planilha em partes.");
    impArquivo = { nome: arquivo.name, base64: bufferParaBase64(await arquivo.arrayBuffer()) };
    await enviarPlanilha(false);
  };
  $("imp-turma").onchange = () => { if (impArquivo) enviarPlanilha(false); };
}
async function enviarPlanilha(confirmar) {
  erroImportacao("");
  try {
    const r = await api("/api/alunos/importar", { method: "POST", body: JSON.stringify({
      nome_arquivo: impArquivo.nome, conteudo: impArquivo.base64, turma_padrao: document.getElementById("imp-turma").value.trim(), confirmar }) });
    desenharPrevia(r, confirmar);
    if (confirmar) impArquivo = null;
  } catch (e) {
    if (e.message === "Sessão expirada" || e.message === "Aceite pendente") return;
    document.getElementById("imp-previa").replaceChildren(); erroImportacao(e.message);
  }
}
function desenharPrevia(r, importado) {
  const linhas = r.linhas.map((l) => {
    const [rotulo, tom] = situacaoImp[l.status];
    const resp = l.responsaveis.map((x) => `${esc(x.nome)} <small>(${esc(x.parentesco)}${x.telefone ? ", " + esc(x.telefone) : ""})</small>`).join("<br>") || "—";
    const problemas = l.problemas.map((p) => `<small style="display:block;color:var(--danger)">${esc(p)}</small>`).join("");
    return `<tr><td>${l.linha}</td><td style="min-width:180px">${pill(rotulo, tom)}${problemas}</td><td><b>${esc(l.nome) || "—"}</b></td><td>${esc(l.sala) || "—"}</td><td>${esc(l.matricula) || "—"}</td><td>${resp}</td></tr>`;
  }).join("");
  const resumo = importado
    ? `${pill(`${ico("confere")} ${pl(r.importados, "aluno importado", "alunos importados")}`, "success")} ${r.ignorados ? pill(pl(r.ignorados, "linha não importada", "linhas não importadas"), "warning") : ""}`
    : `${pill(pl(r.total, "linha", "linhas"), "info")} ${pill(pl(r.prontos, "pronta", "prontas"), "success")} ${r.duplicados ? pill(pl(r.duplicados, "já cadastrada", "já cadastradas"), "warning") : ""} ${r.com_erro ? pill(`${r.com_erro} com erro`, "danger") : ""}`;
  const ignoradas = r.ignoradas && r.ignoradas.length ? `<small style="display:block;margin-top:6px">Colunas que não fazem parte do cadastro e foram ignoradas: ${r.ignoradas.map(esc).join(", ")}.</small>` : "";
  const acoes = importado
    ? `<button type="button" class="btn outline" id="imp-nova" style="width:auto;padding:8px 16px">Importar outra planilha</button>`
    : `<button type="button" class="btn" id="imp-confirmar" style="width:auto;padding:8px 18px" ${r.prontos ? "" : "disabled"}>Importar ${pl(r.prontos, "aluno", "alunos")}</button>
       <button type="button" class="btn outline" id="imp-cancelar" style="width:auto;padding:8px 16px">Cancelar</button>`;
  document.getElementById("imp-previa").innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="word-break:break-all">${esc(impArquivo ? impArquivo.nome : "")}</b></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">${resumo}</div>
    ${importado || r.prontos ? "" : '<p class="pill danger" style="white-space:normal">Nenhum aluno pronto para importar. Corrija a planilha e escolha o arquivo de novo.</p>'}
    <div class="tabela" style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px"><table><caption class="so-leitor">Prévia da importação de alunos</caption><thead><tr><th scope="col">Linha</th><th scope="col">Situação</th><th scope="col">Aluno</th><th scope="col">Turma</th><th scope="col">Matrícula</th><th scope="col">Responsáveis</th></tr></thead><tbody>${linhas}</tbody></table></div>
    ${ignoradas}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${acoes}</div>`;
  const $ = (id) => document.getElementById(id);
  if ($("imp-confirmar")) $("imp-confirmar").onclick = async () => { $("imp-confirmar").disabled = true; await enviarPlanilha(true); };
  if ($("imp-cancelar")) $("imp-cancelar").onclick = () => { impArquivo = null; $("imp-previa").replaceChildren(); erroImportacao(""); };
  if ($("imp-nova")) $("imp-nova").onclick = () => { $("imp-previa").replaceChildren(); $("imp-arquivo").click(); };
}
function linhaResponsavel() {
  return `<div class="card" style="margin-top:10px;padding:14px;background:var(--muted)" data-linha-resp>
    <div class="grade dois">
      <div><small>Nome</small><input class="r-nome"></div>
      <div><small>Parentesco</small><select class="r-parentesco"><option>Mãe</option><option>Pai</option><option>Responsável</option></select></div>
    </div>
    <div style="margin-top:10px"><small>Telefone</small><input class="r-telefone" placeholder="(11) 90000-0000"></div>
    <button type="button" class="btn outline r-remover" style="margin-top:10px;width:auto;padding:6px 14px">Remover</button>
  </div>`;
}
function wireRemoverResponsavel() {
  document.querySelectorAll(".r-remover").forEach((b) => b.onclick = () => b.closest("[data-linha-resp]").remove());
}
function desenharCadastroAluno() {
  iniciarImportacao();
  const $ = (id) => document.getElementById(id);
  const modal = $("modal-aluno"), form = $("form-aluno"), listaResp = $("ca-responsaveis");
  const limparFormulario = () => { // sempre começa limpo, com uma linha de responsável
    form.reset(); listaResp.innerHTML = linhaResponsavel(); wireRemoverResponsavel(); $("ca-erro").classList.add("oculto");
  };
  const abrirModal = () => { limparFormulario(); modal.classList.remove("oculto"); $("ca-nome").focus(); };
  const fecharModal = () => modal.classList.add("oculto");
  limparFormulario();
  $("ca-novo").onclick = abrirModal;
  $("ca-fechar").onclick = fecharModal;
  modal.onclick = (e) => { if (e.target === modal) fecharModal(); }; // clicar fora do pop-up fecha
  modal.onkeydown = (e) => { if (e.key === "Escape") fecharModal(); };
  $("ca-add-resp").onclick = () => { listaResp.insertAdjacentHTML("beforeend", linhaResponsavel()); wireRemoverResponsavel(); };
  document.querySelectorAll("[data-ca-ficha]").forEach((b) => b.onclick = () => abrirFicha(Number(b.dataset.caFicha), "cadastro"));
  // Filtro por turma + busca pelo nome (na própria lista, sem recarregar)
  const filtrarAlunos = () => {
    const turma = $("ca-filtro-turma").value, busca = $("ca-busca").value.trim().toLowerCase();
    const linhas = [...document.querySelectorAll("#ca-linhas tr")];
    linhas.forEach((tr) => { tr.classList.toggle("oculto", (turma && tr.dataset.turma !== turma) || (busca && !tr.dataset.nome.includes(busca))); });
    const visiveis = linhas.filter((tr) => !tr.classList.contains("oculto")).length;
    $("ca-contagem").textContent = `${visiveis} de ${pl(linhas.length, "aluno", "alunos")}`;
  };
  if ($("ca-filtro-turma")) { $("ca-filtro-turma").onchange = filtrarAlunos; $("ca-busca").oninput = filtrarAlunos; filtrarAlunos(); }
  // Mudar a situação: janela com a escolha, o motivo e a consequência explicada
  document.querySelectorAll("[data-ca-situacao]").forEach((b) => b.onclick = seguro(async () => {
    b.closest("details").open = false;
    const nome = b.dataset.nome, atual = b.dataset.atual;
    const escolha = await confirmar({ titulo: `Situação de ${nome}`, texto: "Quem sai da escola não é apagado: o aluno sai das chamadas, comunicados e listas do dia a dia, mas todo o histórico continua guardado e pode voltar a qualquer momento.",
      botao: "Continuar", campo: { rotulo: "Nova situação", tipo: "select", opcoes: ["Ativo", "Transferido", "Concluiu", "Desistente"], valor: atual } });
    if (!escolha || escolha.valor === atual) return;
    const nova = escolha.valor;
    let motivo = "";
    if (nova !== "Ativo") {
      const m = await confirmar({ titulo: `Marcar ${nome} como "${nova}"?`, texto: "O aluno vai para \"Fora da escola\" e deixa de aparecer nas chamadas e nos comunicados.", botao: `Confirmar: ${nova}`, perigo: true,
        campo: { rotulo: "Motivo ou observação (opcional)", placeholder: "Ex.: escola de destino" } });
      if (!m) return;
      motivo = m.valor;
    }
    await api(`/api/alunos/${b.dataset.caSituacao}/situacao`, { method: "PUT", body: JSON.stringify({ situacao: nova, motivo }) });
    dados.cadastroMsg = nova === "Ativo" ? `${nome} voltou para a lista de alunos.` : `${nome} foi para "Fora da escola" (${nova}). O histórico continua guardado.`;
    await mostrar("cadastro");
  }));
  // Turmas: criar, ou editar a que foi escolhida no botão "Editar"
  document.querySelectorAll("[data-tur-editar]").forEach((b) => b.onclick = () => { dados.turmaEditando = Number(b.dataset.turEditar); mostrar("cadastro"); });
  if ($("tur-cancelar")) $("tur-cancelar").onclick = () => { dados.turmaEditando = null; mostrar("cadastro"); };
  $("form-turma").onsubmit = async (e) => {
    e.preventDefault();
    const corpo = { nome: $("tur-nome").value.trim(), ano_letivo: Number($("tur-ano").value), turno: $("tur-turno").value || null, ativa: $("tur-ativa") ? $("tur-ativa").checked : true };
    try {
      if (dados.turmaEditando) await api(`/api/turmas/${dados.turmaEditando}`, { method: "PUT", body: JSON.stringify(corpo) });
      else await api("/api/turmas", { method: "POST", body: JSON.stringify(corpo) });
      dados.cadastroMsg = dados.turmaEditando ? `Turma ${corpo.nome} atualizada.` : `Turma ${corpo.nome} criada.`;
      dados.turmaEditando = null;
      await mostrar("cadastro");
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("tur-erro", erro.message); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const erroBox = $("ca-erro");
    erroBox.classList.add("oculto");
    const responsaveis = [...document.querySelectorAll("[data-linha-resp]")].map((linha) => ({
      nome: linha.querySelector(".r-nome").value.trim(),
      parentesco: linha.querySelector(".r-parentesco").value,
      telefone: linha.querySelector(".r-telefone").value.trim(),
    })).filter((r) => r.nome);
    try {
      await api("/api/alunos", { method: "POST", body: JSON.stringify({
        nome: $("ca-nome").value.trim(),
        sala: $("ca-sala").value.trim(),
        matricula: $("ca-matricula").value.trim(),
        responsaveis,
      }) });
      dados.cadastroMsg = "Aluno cadastrado com sucesso!";
      await mostrar("cadastro"); // recarrega a lista já com o aluno novo
    } catch (erro) {
      erroBox.textContent = erro.message;
      erroBox.classList.remove("oculto");
    }
  };
}

// ---------- Usuários do sistema ----------
function telaUsuarios() {
  return `<section class="card" id="reativacao" style="margin-bottom:20px"></section>
  <section class="card">
    <h2>Novo usuário</h2><small>A senha é gerada automaticamente; repasse ao usuário e peça para trocar no primeiro acesso.</small>
    <form id="form-usuario" style="margin-top:14px">
      <div class="grade dois">
        <div><small>Nome completo</small><input id="nu-nome" required></div>
        <div><small>Usuário (login)</small><input id="nu-usuario" required></div>
      </div>
      <label class="campo-bloco" style="margin-top:12px"><small>E-mail (para recuperar a senha)</small><input id="nu-email" type="email" maxlength="120" autocomplete="off"></label>
      <div style="margin-top:12px"><small>Perfil</small>
        <select id="nu-papel">
          <option value="admin">Gestão (administração)</option>
          <option value="pai">Pai / responsável</option>
          <option value="professor">Docente</option>
        </select>
      </div>
      <div id="nu-campo-aluno" style="margin-top:12px"><small>Turma e aluno (filho)</small><select id="nu-aluno" data-filtro-turma></select></div>
      <div id="nu-campo-sala" class="oculto" style="margin-top:12px"><small>Turma que leciona (outras turmas podem ser marcadas depois, na lista abaixo)</small><select id="nu-sala"><option value="">Escolha a turma...</option>${nomesTurmas().map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
      <p id="nu-erro" class="pill danger oculto" style="margin-top:12px"></p>
      <div id="nu-sucesso" class="oculto pill success" style="margin-top:12px;display:block"></div>
      <button class="btn" type="submit" style="margin-top:16px;max-width:220px">Criar usuário</button>
    </form>
  </section>
  <section class="card" style="margin-top:20px">
    <h2>Usuários cadastrados</h2>
    <div class="tabela"><table><caption class="so-leitor">Usuários cadastrados</caption><thead><tr><th scope="col">Nome</th><th scope="col">Usuário</th><th scope="col">Perfil</th><th scope="col">Vínculo</th><th scope="col">Último acesso</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead>
    <tbody id="lista-usuarios"></tbody></table></div>
  </section>
  <div id="modal-vinculo" class="modal oculto" role="dialog" aria-modal="true" aria-labelledby="vinculo-titulo">
    <div class="modal-caixa" style="max-width:520px">
      <div class="linha"><h2 id="vinculo-titulo"></h2><button type="button" class="btn outline pequeno" id="vinculo-fechar" aria-label="Fechar" style="width:auto">✕</button></div>
      <div id="vinculo-corpo" style="margin-top:10px"></div>
      <p id="vinculo-erro" class="pill danger oculto" style="margin-top:10px;white-space:normal"></p>
    </div>
  </div>`;
}
function desenharUsuarios() {
  const selectAluno = document.getElementById("nu-aluno");
  selectAluno.innerHTML = `<option value="">Escolha o aluno...</option>` + opcoesAlunos(dados.alunos);
  const papelSel = document.getElementById("nu-papel");
  papelSel.onchange = () => {
    document.getElementById("nu-campo-aluno").classList.toggle("oculto", papelSel.value !== "pai");
    document.getElementById("nu-campo-sala").classList.toggle("oculto", papelSel.value !== "professor");
  };
  papelSel.onchange();
  document.getElementById("form-usuario").onsubmit = async (e) => {
    e.preventDefault();
    const erroBox = document.getElementById("nu-erro"), sucessoBox = document.getElementById("nu-sucesso");
    erroBox.classList.add("oculto"); sucessoBox.classList.add("oculto");
    try {
      const r = await api("/api/usuarios", { method: "POST", body: JSON.stringify({
        usuario: document.getElementById("nu-usuario").value.trim(),
        nome: document.getElementById("nu-nome").value.trim(),
        email: document.getElementById("nu-email").value.trim(),
        papel: papelSel.value,
        aluno_id: papelSel.value === "pai" ? Number(selectAluno.value) : undefined,
        sala: papelSel.value === "professor" ? document.getElementById("nu-sala").value.trim() : undefined,
      }) });
      sucessoBox.textContent = `Usuário criado! Senha provisória: ${r.senha_genercada} — repasse ao usuário.`;
      sucessoBox.classList.remove("oculto");
      document.getElementById("form-usuario").reset(); papelSel.onchange();
      dados.usuarios = await api("/api/usuarios");
      desenharListaUsuarios();
    } catch (erro) {
      erroBox.textContent = erro.message;
      erroBox.classList.remove("oculto");
    }
  };
  desenharListaUsuarios();
  desenharReativacao();
}
async function recarregarUsuarios(msg) {
  [dados.usuarios, dados.reat] = await Promise.all([api("/api/usuarios"), api("/api/reativacao")]);
  dados.reatMsg = msg || ""; desenharListaUsuarios(); desenharReativacao();
}
function statusUsuario(u) {
  if (u.ativo) return pill("Ativo", "success") + (u.senha_temporaria ? " " + pill("Senha provisória", "warning") : "") + (u.senha_pedida_em ? " " + pill("Pediu senha nova", "danger") : "") + (u.email ? "" : " " + pill("Sem e-mail", "neutral"));
  if (u.inativado_motivo === "inatividade") return pill(`Inativo: ${u.dias_sem_acesso} dias sem acesso`, "warning") + (u.reativacao_pedida_em ? " " + pill("Pediu reativação", "danger") : "");
  return pill("Inativo", "neutral");
}
// Ações por usuário: a principal fica à vista; as sensíveis (desativar, zerar duas etapas) ficam no menu "⋯" e pedem confirmação.
// A própria pessoa logada não vê "Desativar" na sua linha (o servidor também recusa).
function acoesUsuario(u) {
  const eu = usuarioLogado.id ? u.id === usuarioLogado.id : u.nome === usuarioLogado.nome && u.papel === usuarioLogado.papel;
  const botaoEmail = (classe, texto) => `<button type="button" ${classe} data-email="${u.id}" data-nome="${esc(u.nome)}" data-valor="${esc(u.email_conta || "")}">${texto}</button>`;
  if (eu) return `${pill("Você", "info")} ${botaoEmail('class="btn outline pequeno"', u.email ? "Alterar e-mail" : "Definir e-mail")}`;
  if (!u.ativo && u.inativado_motivo === "inatividade") return `<button class="btn pequeno" data-reativar="${u.id}" data-nome="${esc(u.nome)}">Reativar</button>`;
  if (!u.ativo) return `<button class="btn outline pequeno" data-id="${u.id}" data-ativo="1" data-nome="${esc(u.nome)}">Ativar</button>`;
  return `${u.senha_pedida_em ? `<button class="btn pequeno" data-nova-senha="${u.id}" data-nome="${esc(u.nome)}">Gerar senha nova</button> ` : ""}<details class="menu-acoes"><summary class="btn outline pequeno" aria-label="Mais ações para ${esc(u.nome)}" title="Mais ações">${ico("mais")}</summary>
    <div class="menu-acoes-lista"><button type="button" data-nova-senha="${u.id}" data-nome="${esc(u.nome)}">Gerar senha nova…</button>${botaoEmail("", u.email ? "Alterar e-mail…" : "Definir e-mail…")}${u.dois_fatores ? `<button type="button" data-zerar-2fa="${u.id}" data-nome="${esc(u.nome)}">Redefinir duas etapas…</button>` : ""}
      <button type="button" class="perigo" data-id="${u.id}" data-ativo="0" data-nome="${esc(u.nome)}">Desativar acesso…</button></div></details>`;
}
function desenharListaUsuarios() {
  document.getElementById("lista-usuarios").innerHTML = dados.usuarios.map((u) => `<tr>
    <td>${esc(u.nome)}</td><td>${esc(u.usuario)}</td><td>${papelLabel(u.papel)}</td>
    <td>${vinculoUsuario(u)}</td><td>${u.ultimo_acesso || "Nunca entrou"}</td>
    <td>${statusUsuario(u)}${u.dois_fatores ? " " + pill("2 etapas", "info") : ""}</td>
    <td class="celula-acoes">${acoesUsuario(u)}</td>
  </tr>`).join("");
  document.querySelectorAll("#lista-usuarios [data-ativo]").forEach((b) => b.onclick = seguro(async () => {
    const ativar = b.dataset.ativo === "1", det = b.closest("details"); if (det) det.open = false;
    if (!ativar && !(await confirmar({ titulo: `Desativar o acesso de ${b.dataset.nome}?`, texto: "A pessoa sai do sistema na hora, em todos os aparelhos, e não consegue mais entrar. Nada é apagado: você pode ativar de novo quando quiser.", botao: "Desativar acesso", perigo: true }))) return;
    await api(`/api/usuarios/${b.dataset.id}/ativo`, { method: "PUT", body: JSON.stringify({ ativo: ativar }) });
    await recarregarUsuarios();
    avisar(ativar ? `Acesso de ${b.dataset.nome} ativado.` : `Acesso de ${b.dataset.nome} desativado.`);
  }));
  document.querySelectorAll("#lista-usuarios [data-reativar]").forEach((b) => b.onclick = reativarProfessor(b));
  document.querySelectorAll("#lista-usuarios [data-email]").forEach((b) => b.onclick = seguro(async () => {
    const r = await confirmar({ titulo: `E-mail de ${b.dataset.nome}`, texto: "Usado para recuperar a senha. Deixe em branco para remover.", botao: "Salvar", campo: { rotulo: "E-mail", valor: b.dataset.valor, placeholder: "nome@escola.com.br" } });
    if (!r) return;
    await api(`/api/usuarios/${b.dataset.email}/email`, { method: "PUT", body: JSON.stringify({ email: r.valor }) });
    await recarregarUsuarios(`E-mail de ${b.dataset.nome} salvo.`);
  }));
  document.querySelectorAll("#lista-usuarios [data-nova-senha]").forEach((b) => b.onclick = seguro(async () => {
    if (!(await confirmar({ titulo: `Gerar senha nova para ${b.dataset.nome}?`, texto: "Antes, confirme pessoalmente ou por telefone que o pedido é mesmo dessa pessoa: qualquer um pode pedir pela tela de login. A senha atual deixa de valer, os logins abertos são encerrados e ela troca a senha no próximo acesso.", botao: "Gerar senha nova" }))) return;
    const r = await api(`/api/usuarios/${b.dataset.novaSenha}/nova-senha`, { method: "PUT", body: "{}" });
    await recarregarUsuarios(`Senha nova de ${b.dataset.nome}: ${r.senha_provisoria} (repasse à pessoa; ela troca no próximo acesso).`);
  }));
  document.querySelectorAll("#lista-usuarios [data-zerar-2fa]").forEach((b) => b.onclick = seguro(async () => {
    if (!(await confirmar({ titulo: `Redefinir a verificação em duas etapas de ${b.dataset.nome}?`, texto: "Use só se a pessoa perdeu o celular. O login dela é encerrado em todos os aparelhos e ela configura o aplicativo de novo no próximo acesso.", botao: "Redefinir", perigo: true }))) return;
    await api(`/api/usuarios/${b.dataset.zerar2fa}/2fa/zerar`, { method: "PUT", body: "{}" });
    await recarregarUsuarios(`Verificação em duas etapas de ${b.dataset.nome} redefinida.`);
  }));
  document.querySelectorAll("#lista-usuarios [data-vinculo]").forEach((b) => b.onclick = () => abrirVinculo(dados.usuarios.find((u) => u.id === Number(b.dataset.vinculo))));
}
// Pop-up "Filhos" (responsável com mais de um filho) ou "Turmas" (professor com mais de uma turma)
function abrirVinculo(u) {
  const $ = (id) => document.getElementById(id);
  const modal = $("modal-vinculo"), corpo = $("vinculo-corpo"), erro = $("vinculo-erro");
  const fechar = () => modal.classList.add("oculto");
  const falhou = (e) => { if (e.message !== "Sessão expirada") { erro.textContent = e.message; erro.classList.remove("oculto"); } };
  const depois = async () => { dados.usuarios = await api("/api/usuarios"); desenharListaUsuarios(); abrirVinculo(dados.usuarios.find((x) => x.id === u.id)); };
  erro.classList.add("oculto");
  if (u.papel === "professor") {
    const marcadas = new Set(u.turmas.length ? u.turmas : [u.sala]);
    $("vinculo-titulo").textContent = `Turmas de ${u.nome.split(" ")[0]}`;
    corpo.innerHTML = `<small>Marque as turmas em que leciona. Com mais de uma, aparece um seletor no topo da tela dele para trocar de turma.</small>
      <div style="display:grid;gap:8px;margin-top:12px">${nomesTurmas().map((t) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="${esc(t)}" style="width:auto" ${marcadas.has(t) ? "checked" : ""}> ${esc(t)}${t === u.sala ? ' <small style="display:inline">(principal)</small>' : ""}</label>`).join("")}</div>
      <button type="button" class="btn pequeno" id="vinculo-salvar" style="margin-top:14px">Salvar turmas</button>`;
    $("vinculo-salvar").onclick = async () => {
      const turmas = [...corpo.querySelectorAll("input:checked")].map((c) => c.value);
      try { await api(`/api/usuarios/${u.id}/turmas`, { method: "PUT", body: JSON.stringify({ turmas }) }); fechar(); dados.usuarios = await api("/api/usuarios"); desenharListaUsuarios(); }
      catch (e) { falhou(e); }
    };
  } else {
    const ligados = new Set(u.filhos.map((f) => f.id));
    $("vinculo-titulo").textContent = `Filhos de ${u.nome.split(" ")[0]}`;
    corpo.innerHTML = `<small>O responsável entra com o mesmo login e troca de filho pelo seletor no topo da tela.</small>
      <div style="margin-top:10px">${u.filhos.map((f) => `<div class="linha" style="padding:8px 0;border-top:1px solid var(--border)"><span>${esc(f.nome)}${f.id === u.aluno_id ? ' <small style="display:inline">(principal)</small>' : ""}</span>
        ${f.id === u.aluno_id ? "" : `<button type="button" class="btn outline pequeno" data-desligar="${f.id}">Remover</button>`}</div>`).join("")}</div>
      <div class="grade dois" style="margin-top:12px"><div><small>Adicionar outro filho</small><select id="vinculo-aluno" data-filtro-turma><option value="">Escolha o aluno...</option>${opcoesAlunos(dados.alunos.filter((a) => !ligados.has(a.id)))}</select></div>
        <div><small>Parentesco</small><select id="vinculo-parentesco"><option>Mãe</option><option>Pai</option><option>Responsável</option></select></div></div>
      <button type="button" class="btn pequeno" id="vinculo-ligar" style="margin-top:12px">Adicionar filho</button>`;
    $("vinculo-ligar").onclick = async () => {
      try { await api(`/api/usuarios/${u.id}/filhos`, { method: "POST", body: JSON.stringify({ aluno_id: Number($("vinculo-aluno").value), parentesco: $("vinculo-parentesco").value }) }); await depois(); }
      catch (e) { falhou(e); }
    };
    corpo.querySelectorAll("[data-desligar]").forEach((b) => b.onclick = async () => {
      if (!(await confirmar({ titulo: "Remover este aluno do responsável?", texto: "O responsável deixa de ver este aluno no Portal da Família. Os registros já feitos continuam guardados.", botao: "Remover", perigo: true }))) return;
      try { await api(`/api/usuarios/${u.id}/filhos/${b.dataset.desligar}`, { method: "DELETE" }); await depois(); }
      catch (e) { falhou(e); }
    });
  }
  $("vinculo-fechar").onclick = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); };
  modal.onkeydown = (e) => { if (e.key === "Escape") fechar(); };
  modal.classList.remove("oculto"); $("vinculo-fechar").focus();
}
// Coluna "Vínculo": filhos do responsável ou turmas do professor, com o botão para alterar
function vinculoUsuario(u) {
  if (u.papel === "pai") {
    const filhos = u.filhos.length ? u.filhos : u.aluno_nome ? [{ id: u.aluno_id, nome: u.aluno_nome }] : [];
    return `${filhos.map((f) => esc(f.nome)).join("<br>") || "—"}<br><button type="button" class="btn outline pequeno" data-vinculo="${u.id}" style="margin-top:6px">Filhos</button>`;
  }
  if (u.papel === "professor") {
    const turmas = u.turmas.length ? u.turmas : u.sala ? [u.sala] : [];
    return `${turmas.map((t) => esc(t) + (t === u.sala && turmas.length > 1 ? " <small style=\"display:inline\">(principal)</small>" : "")).join("<br>") || "—"}<br><button type="button" class="btn outline pequeno" data-vinculo="${u.id}" style="margin-top:6px">Turmas</button>`;
  }
  return "—";
}
// ---------- Reativação de professores (60 dias sem acessar) ----------
const reativarProfessor = (b) => seguro(async () => {
  if (!(await confirmar({ titulo: `Reativar o acesso de ${b.dataset.nome}?`, texto: "O sistema gera uma senha provisória nova, que você repassa ao docente. A senha é trocada no primeiro acesso e o prazo de 60 dias volta a contar.", botao: "Reativar" }))) return;
  const r = await api(`/api/usuarios/${b.dataset.reativar}/reativar`, { method: "PUT", body: "{}" });
  await recarregarUsuarios(`Acesso de ${b.dataset.nome} reativado. Senha provisória: ${r.senha_provisoria} (repasse ao docente; a senha é trocada no primeiro acesso).`);
});
function desenharReativacao() {
  const r = dados.reat, caixa = document.getElementById("reativacao");
  const msg = dados.reatMsg; dados.reatMsg = "";
  const inativos = r.inativos.map((u) => `<div class="item"><div class="linha" style="flex-wrap:wrap;gap:8px">
      <div class="aluno"><span class="avatar">${iniciais(u.nome)}</span><div><b>${esc(u.nome)}</b><small>${esc(u.sala || "—")} • usuário ${esc(u.usuario)} • último acesso ${u.ultimo_acesso || "nunca"} • inativado em ${u.inativado_em}</small></div></div>
      <div>${u.pedido_em ? pill(`Pediu reativação em ${u.pedido_em}`, "danger") : pill(`${u.dias_sem_acesso} dias sem acesso`, "warning")}</div></div>
      <div class="acoes"><button class="btn pequeno" data-reativar="${u.id}" data-nome="${esc(u.nome)}">Reativar com senha nova</button></div></div>`).join("");
  const perto = r.perto.map((u) => `<div class="linha" style="padding:8px 0;border-top:1px solid var(--border);flex-wrap:wrap;gap:8px"><span><b>${esc(u.nome)}</b> <small style="display:inline">(${esc(u.sala || "—")}) • último acesso ${u.ultimo_acesso || "nunca"}</small></span>${pill(`Faltam ${pl(u.faltam, "dia", "dias")} para a suspensão`, "warning")}</div>`).join("");
  caixa.innerHTML = `<div class="linha" style="flex-wrap:wrap;gap:8px"><h2>Reativação de docentes</h2>${r.inativos.length ? pill(pl(r.inativos.length, "inativo", "inativos"), "warning") : pill("Nenhum inativo", "success")}</div>
    <small>Docentes que ficam ${r.dias} dias sem entrar no sistema têm o acesso suspenso automaticamente. Ao tentar entrar, o pedido de reativação chega aqui. A reativação gera uma senha provisória nova e o prazo volta a contar.</small>
    ${msg ? `<p class="pill success" style="margin-top:12px;white-space:normal">${esc(msg)}</p>` : ""}
    ${inativos || ""}
    ${perto ? `<small style="margin-top:14px;font-weight:700;text-transform:uppercase">Perto do limite (${r.aviso} dias ou mais sem acesso)</small>${perto}` : ""}
    ${!inativos && !perto ? `<div class="vazio" style="padding:20px"><small>Nenhum docente parado há ${r.aviso} dias ou mais.</small></div>` : ""}`;
  caixa.querySelectorAll("[data-reativar]").forEach((b) => b.onclick = reativarProfessor(b));
}

// ---------- Logs de atividade ----------
function telaLogs() {
  const pessoas = [...new Set(dados.logs.map((l) => l.nome_usuario))].sort(porNome);
  return `<div class="topo"><h2>Registro de atividades</h2><small>Tudo o que foi feito no sistema, por quem e quando (as últimas 200 ações).</small></div>
  <section class="card" style="margin-bottom:16px"><div class="linha" style="flex-wrap:wrap;gap:10px"><div><b>Os registros estão completos?</b><small>O sistema protege este histórico: se alguém apagar ou alterar um registro por fora do sistema, a conferência mostra exatamente onde.</small></div>
    <button type="button" class="btn outline pequeno" id="logs-conferir" style="width:auto">${ico("escudoOk")} Conferir agora</button></div><div id="logs-integridade"></div></section>
  <section class="card"><div class="linha filtros-lista">
      <select id="logs-pessoa" aria-label="Filtrar por pessoa" style="width:auto"><option value="">Todas as pessoas</option>${pessoas.map((n) => `<option>${esc(n)}</option>`).join("")}</select>
      <input id="logs-busca" class="campo-busca" placeholder="Buscar na ação ou no detalhe..." aria-label="Buscar nos registros" style="max-width:300px"></div>
    <div class="tabela"><table><caption class="so-leitor">Registro de atividades</caption><thead><tr><th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">Perfil</th><th scope="col">O que fez</th><th scope="col">Detalhe</th></tr></thead>
  <tbody id="logs-linhas"></tbody></table></div><small id="logs-contagem" style="margin-top:8px"></small></section>`;
}
function desenharLogs() {
  const pessoa = document.getElementById("logs-pessoa").value, busca = document.getElementById("logs-busca").value.trim().toLowerCase();
  const lista = dados.logs.filter((l) => (!pessoa || l.nome_usuario === pessoa) && (!busca || `${acaoLabel(l.acao)} ${l.detalhe || ""}`.toLowerCase().includes(busca)));
  document.getElementById("logs-linhas").innerHTML = lista.length ? lista.map((l) => `<tr><td>${l.quando}</td><td>${esc(l.nome_usuario)}</td><td>${papelLabel(l.papel)}</td><td>${acaoLabel(l.acao)}</td><td>${esc(l.detalhe || "—")}</td></tr>`).join("")
    : `<tr><td colspan="5">${vazio("Nenhum registro com esse filtro.")}</td></tr>`;
  document.getElementById("logs-contagem").textContent = `${lista.length} de ${pl(dados.logs.length, "registro", "registros")}`;
}

// ---------- Minha Turma e chamada (professor) ----------
// A chamada vem primeiro (é a tarefa do dia). Ninguém vem marcado "por padrão": só quem passou pelo portão já vem como Presente,
// com a origem à vista ("entrou 07:31 • câmera"). O professor confirma, marca o resto e salva. No celular, cada aluno é um cartão com botões grandes.
const horaDe = (texto) => ((String(texto || "").match(/\d{2}:\d{2}/) || [""])[0]);
function origemPresenca(a) { // de onde veio a presença que já está marcada
  if (a.origem_hoje === "chamada") return "";
  if (a.origem_hoje === "portao") return `entrou ${horaDe(a.obs_hoje)} • ${/facial/.test(a.obs_hoje || "") ? "câmera" : "portaria"}`;
  if (a.agora && a.agora.situacao === "na_escola") return `entrou ${horaDe(a.agora.texto)} • portão`;
  return "";
}
function telaTurma() {
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const alunos = dados.turma.alunos;
  const registrada = alunos.length > 0 && alunos.every((a) => a.origem_hoje === "chamada");
  const fimDeSemana = [0, 6].includes(new Date().getDay());
  return `<div class="topo"><h2>Minha turma — ${esc(usuarioLogado.sala)}</h2><small>Chamada de hoje (${hoje}), contato dos responsáveis e ficha de cada aluno.</small></div>
  <section class="card chamada"><div class="linha" style="flex-wrap:wrap;gap:8px"><h2>Chamada de hoje</h2>${registrada ? pill("Chamada salva hoje", "success") : pill("Ainda não salva", "warning")}</div>
    ${fimDeSemana ? `<p class="pill info aviso-largo" style="margin-top:8px">${ico("calendario")} Hoje não tem aula. A chamada só é necessária em dia letivo.</p>` : ""}
    ${alunos.length ? `<div class="chamada-resumo" id="chamada-resumo"></div>
      <div class="tabela so-computador"><table><caption class="so-leitor">Chamada de hoje</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Agora</th><th scope="col">Chamada</th><th scope="col">Faltas (${dados.turma.dias_faltas} dias)</th><th scope="col">Pendências</th><th scope="col">Responsáveis</th><th scope="col"><span class="so-leitor">Ações</span></th></tr></thead>
      <tbody id="chamada-linhas"></tbody></table></div>
      <div class="chamada-cards so-celular" id="chamada-cards"></div>
      <div class="chamada-rodape"><button class="btn" id="chamada-salvar">Salvar chamada de hoje</button></div>`
      : `<div class="vazio"><b>Nenhum aluno cadastrado nesta turma</b><small>Peça à gestão para cadastrar os alunos da turma ${esc(usuarioLogado.sala)}.</small></div>`}
  </section>
  ${blocoBanners()}`;
}
function desenharChamada() {
  const corpo = document.getElementById("chamada-linhas");
  if (!corpo) return;
  const alunos = dados.turma.alunos;
  const botoes = (a, s) => `<div class="seg" role="group" aria-label="Chamada de ${esc(a.nome)}"><button class="${s === "Presente" ? "on-p" : ""}" data-aluno="${a.id}" data-status="Presente" aria-pressed="${s === "Presente"}">Presente</button><button class="${s === "Ausente" ? "on-a" : ""}" data-aluno="${a.id}" data-status="Ausente" aria-pressed="${s === "Ausente"}">Ausente</button></div>`;
  const origem = (a) => { const o = origemPresenca(a); return o && dados.chamada[a.id] === "Presente" ? `<small class="origem">${ico("setaBaixo")} ${esc(o)}</small>` : ""; };
  corpo.innerHTML = alunos.map((a) => {
    const s = dados.chamada[a.id];
    return `<tr class="${s ? "" : "sem-marcacao"}"><td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><b>${esc(a.nome)}</b></div></td>
      <td>${a.agora ? pillAgora(a.agora) : "—"}</td>
      <td>${botoes(a, s)}${origem(a)}</td>
      <td>${pill(a.faltas, a.faltas >= 5 ? "danger" : a.faltas > 0 ? "warning" : "neutral")}</td>
      <td>${a.pendencias ? pill(`${a.pendencias} em aberto`, "warning") : pill("Nenhuma", "neutral")}</td><td>${esc(a.responsaveis || "—")}</td>
      <td><button class="btn outline pequeno" data-ficha="${a.id}">Ficha</button></td></tr>`;
  }).join("");
  document.getElementById("chamada-cards").innerHTML = alunos.map((a) => {
    const s = dados.chamada[a.id];
    return `<article class="chamada-card ${s ? "" : "sem-marcacao"}">
      <div class="linha"><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${esc(a.nome)}</b>${origem(a) || `<small>${a.faltas ? `${pl(a.faltas, "falta", "faltas")} em ${dados.turma.dias_faltas} dias` : "Sem faltas recentes"}</small>`}</div></div>
        <button class="btn outline pequeno" data-ficha="${a.id}">Ficha</button></div>
      ${botoes(a, s)}</article>`;
  }).join("");
  const presentes = alunos.filter((a) => dados.chamada[a.id] === "Presente").length, ausentes = alunos.filter((a) => dados.chamada[a.id] === "Ausente").length;
  const faltam = alunos.length - presentes - ausentes;
  document.getElementById("chamada-resumo").innerHTML = `<span>${pill(pl(presentes, "presente", "presentes"), "success")} ${pill(pl(ausentes, "ausente", "ausentes"), ausentes ? "danger" : "neutral")} ${faltam ? pill(`${faltam} sem marcar`, "warning") : pill("Todos marcados", "info")}</span>
    ${faltam ? `<button type="button" class="btn outline pequeno" id="chamada-restantes">${faltam === 1 ? "Marcar o restante como presente" : `Marcar os ${faltam} restantes como presentes`}</button>` : ""}`;
  document.querySelectorAll("#tela [data-aluno]").forEach((b) => b.onclick = () => { dados.chamada[b.dataset.aluno] = b.dataset.status; desenharChamada(); });
  document.querySelectorAll("#tela [data-ficha]").forEach((b) => b.onclick = () => abrirFicha(Number(b.dataset.ficha), "turma"));
  const restantes = document.getElementById("chamada-restantes");
  if (restantes) restantes.onclick = () => { alunos.forEach((a) => { if (!dados.chamada[a.id]) dados.chamada[a.id] = "Presente"; }); desenharChamada(); };
  document.getElementById("chamada-salvar").onclick = seguro(async () => {
    if (faltam) {
      avisar(`Falta marcar ${pl(faltam, "aluno", "alunos")}. Marque cada um ou use "Marcar os restantes como presentes".`, "warning");
      const primeiro = document.querySelector(`#${matchMedia("(max-width: 760px)").matches ? "chamada-cards" : "chamada-linhas"} .sem-marcacao`);
      if (primeiro) primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    await api("/api/chamada", { method: "POST", body: JSON.stringify({
      registros: Object.entries(dados.chamada).map(([id, status]) => ({ aluno_id: Number(id), status })),
    }) });
    avisar(`Chamada salva: ${pl(presentes, "presente", "presentes")} e ${pl(ausentes, "ausente", "ausentes")}.`);
    await mostrar("turma");
  });
}

// ---------- Portal da Família ----------
// Cartão "Status agora" (Fase 5): entrada e saída de hoje, atualizado sozinho a cada 30 segundos
const seloAgora = { na_escola: "● Seguro", saiu: "● Saiu da escola", nao_chegou: "● Aguardando chegada", ausente: "● Ausente" };
function cartaoStatusAgora() {
  const a = dados.agora, hoje = dados.historico.hoje;
  const movs = a && a.movimentos.length ? a.movimentos.map((m) => `<small style="color:#DCEEF8">${ico(m.sentido === "Entrada" ? "setaBaixo" : "setaCima")} ${m.hora} • ${m.sentido} • ${esc(m.local)} (${esc(m.como)})</small>`).join("") : "";
  return `<div class="linha"><div><small style="color:#DCEEF8">Status agora <span class="ao-vivo">● ao vivo</span></small><h3>${a ? esc(a.texto) : "—"}</h3></div><span class="pill" style="background:rgba(255,255,255,.2)">${a ? seloAgora[a.situacao] : ""}</span></div>
    <small style="color:#DCEEF8;margin-top:4px">${a ? esc(a.detalhe) : ""}</small>
    <hr style="margin:16px 0;opacity:.3"><small style="color:#DCEEF8">Movimentos de hoje</small>${movs || '<small style="color:#DCEEF8">Nenhuma entrada ou saída registrada hoje.</small>'}
    <small style="color:#DCEEF8;margin-top:10px">Chamada de hoje</small><b>${hoje ? esc(hoje.status) + " — " + esc(hoje.observacao) : "Ainda não registrada"}</b>
    <small style="color:#DCEEF8;margin-top:10px">Turma</small><b>${dados.filho ? esc(dados.filho.sala) : "—"}</b>`;
}
// "Precisa da sua atenção": tudo o que espera uma ação do responsável, com o botão que leva direto até lá
function itensAtencao() {
  const f = dados.ficha, itens = [];
  f.autorizacoes.filter((a) => !a.assinada && !a.vencida).forEach((a) => itens.push({ icone: "caneta", texto: `Autorização para assinar: <b>${esc(a.titulo)}</b>${a.valida_ate ? ` <small style="display:inline">• até ${a.valida_ate}</small>` : ""}`, botao: "Assinar", aba: "autorizacoes" }));
  if (dados.ocorrenciasNovas) itens.push({ icone: "prancheta", texto: dados.ocorrenciasNovas === 1 ? "<b>1 ocorrência</b> registrada pelo docente esperando a sua ciência" : `<b>${dados.ocorrenciasNovas} ocorrências</b> registradas pelo docente esperando a sua ciência`, botao: "Ler e assinar", tela: "ocorrencias" });
  f.pendencias.filter((p) => p.status === "Aberta" && p.tipo === "Documento").forEach((p) => itens.push({ icone: "documento", texto: `A escola pediu: <b>${esc(p.descricao)}</b>`, botao: "Enviar documento", aba: "documentos" }));
  const naoLidos = f.comunicados.filter((c) => !c.lido).length;
  if (naoLidos) itens.push({ icone: "megafone", texto: naoLidos === 1 ? "<b>1 comunicado</b> ainda não lido" : `<b>${naoLidos} comunicados</b> ainda não lidos`, botao: "Ler", aba: "comunicados" });
  if (f.consentimento && f.consentimento.status === "pendente") itens.push({ icone: "termo", texto: "<b>Termo de consentimento</b> (imagem e informações) ainda sem resposta", botao: "Responder", consent: true });
  return itens;
}
function cartaoAtencao() {
  const itens = itensAtencao();
  return `<section class="card atencao ${itens.length ? "tem-itens" : ""}" aria-labelledby="atencao-titulo"><div class="linha"><h2 id="atencao-titulo">${itens.length ? "Precisa da sua atenção" : "Tudo em dia"}</h2>${itens.length ? pill(itens.length, "warning") : ""}</div>
    ${itens.length ? itens.map((x, i) => `<div class="atencao-item"><span class="icone warning">${ico(x.icone)}</span><span class="atencao-texto">${x.texto}</span><button type="button" class="btn pequeno" data-atencao="${i}">${x.botao}</button></div>`).join("")
      : `<div class="atencao-ok">${ico("confere", "ok")} <span>Nada esperando por você agora. Quando a escola mandar algo, aparece aqui e no sino lá em cima.</span></div>`}</section>`;
}
function ligarAtencao() {
  const itens = itensAtencao();
  document.querySelectorAll("[data-atencao]").forEach((b) => b.onclick = () => {
    const x = itens[Number(b.dataset.atencao)];
    if (x.tela) return mostrar(x.tela);
    if (x.consent) return seguro(() => mostrarConsentimento("alterar"))();
    dados.fichaAba = x.aba; desenharFicha();
    document.getElementById("ficha-filho").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
function telaPais() {
  const h = dados.historico;
  return `<div class="topo"><small>Olá, ${esc(usuarioLogado.nome.split(" ")[0])}</small><h2>Acompanhe ${dados.filho ? "o(a) " + esc(dados.filho.nome.split(" ")[0]) : "seu filho"}</h2></div>
  <div class="grade pais-topo">
    <section class="status" id="status-agora">${cartaoStatusAgora()}</section>
    ${cartaoAtencao()}
  </div>
  ${blocoBanners()}
  <div class="grade pais" style="align-items:start">
    <aside class="card"><h2>Histórico de presença</h2><small>Últimos ${h.dias} dias</small>${blocoHistorico(h)}</aside>
    ${cartaoConsentimento().replace('style="margin-top:20px"', 'style="margin-top:0"')}
  </div>
  <section class="card" id="ficha-filho" style="margin-top:20px"><h2>Ficha do meu filho</h2><small>Comunicados, autorizações para assinar, documentos, pendências e ocorrências.</small><div id="ficha-corpo"></div></section>`;
}

// ---------- Ficha do aluno (abas): usada pela gestão, pelo professor da turma e pelo responsável ----------
const tamanhoLegivel = (b) => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB");
const lerBase64 = (arquivo) => new Promise((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => erro(new Error("Não foi possível ler o arquivo"));
  r.readAsDataURL(arquivo);
});
const vazio = (texto) => `<div class="vazio"><small>${texto}</small></div>`;
const erroBox = (id) => `<p class="pill danger oculto" id="${id}" style="margin-top:8px"></p>`;
const mostrarErro = (id, msg) => { const e = document.getElementById(id); e.textContent = msg; e.classList.remove("oculto"); };

function abrirFicha(alunoId, origem) {
  dados.fichaAlunoId = alunoId; dados.fichaOrigem = origem; dados.fichaAba = "comunicados";
  mostrar("ficha");
}
function telaFicha() {
  return `<div class="no-print" style="margin-bottom:12px"><button class="btn outline pequeno" id="ficha-voltar">← Voltar</button></div><div id="ficha-corpo"></div>`;
}
async function recarregarFicha() {
  dados.ficha = await api(`/api/alunos/${dados.ficha.aluno.id}/ficha`);
  desenharFicha();
}
function abaComunicados(f, ehPai) {
  return f.comunicados.length ? f.comunicados.map((c) => `<div class="item">
    <div class="linha" style="gap:8px;flex-wrap:wrap"><b>${esc(c.titulo)}</b>${c.lido ? pill("Lido", "success") : pill("Não lido", "warning")}</div>
    <small>${c.data} • ${esc(c.criado_por_nome)} • ${c.sala ? esc(c.sala) : "Escola toda"}</small>
    <p style="margin-top:8px">${esc(c.texto)}</p>
    ${c.lido ? `<small style="margin-top:6px">Lido em ${c.lido_em}</small>` : ehPai ? `<button class="btn pequeno" data-ler="${c.id}" style="margin-top:10px">Marcar como lido</button>` : ""}</div>`).join("") : vazio("Nenhum comunicado para este aluno.");
}
function abaAutorizacoes(f, ehPai) {
  const situacao = (a) => a.assinada ? pill("Assinada", "success") : a.vencida ? pill(`Prazo encerrado em ${a.valida_ate}`, "neutral") : pill(a.valida_ate ? `Assinar até ${a.valida_ate}` : "Pendente", "warning");
  return f.autorizacoes.length ? f.autorizacoes.map((a) => `<div class="item ${a.vencida ? "vencida" : ""}">
    <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${esc(a.titulo)}</b><small>${ico("calendario")} ${esc(a.validade || "—")}</small></div>${situacao(a)}</div>
    <small style="margin-top:6px">${esc(a.detalhe || "")}</small>
    ${a.assinada
      ? `${seloAssinatura("Assinatura digital do responsável", a.assinada_nome, a.assinada_em, a.codigo)}
         <button class="btn outline pequeno" data-comprovante="${a.id}" style="margin-top:8px">Ver comprovante</button>`
      : a.vencida ? `<small style="margin-top:8px">O prazo para assinar terminou e esta autorização não pode mais ser assinada pelo sistema. Se ainda precisar, fale com a escola.</small>`
      : ehPai ? `<div class="assinatura-caixa">
         <label class="termo-aceite confirma-assinatura"><input type="checkbox" data-as-confirmo="${a.id}"> <span><b>Li e autorizo</b> o que está descrito acima.</span></label>
         <div class="linha" style="gap:8px;flex-wrap:wrap;justify-content:flex-start;width:100%"><input type="password" placeholder="Sua senha" data-as-senha="${a.id}" autocomplete="current-password" aria-label="Sua senha para assinar" style="max-width:220px">
         <button class="btn pequeno" data-assinar="${a.id}" style="width:auto">${ico("caneta")} Assinar digitalmente</button></div>
         <small>A assinatura usa o nome do seu cadastro e fica registrada com data, hora e um código de verificação.</small></div>` : ""}
  </div>`).join("") : vazio("Nenhuma autorização para este aluno.");
}
function abaDocumentos(f, ehGestao) {
  const solicitacoes = f.pendencias.filter((p) => p.status === "Aberta" && p.tipo === "Documento");
  const lista = f.documentos.length ? f.documentos.map((d) => `<div class="item">
    <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${ico("documento")} ${esc(d.titulo)}</b><small>${esc(d.nome_original)} • ${tamanhoLegivel(d.tamanho)} • ${d.enviado_em} • ${esc(d.enviado_por_nome)}</small></div>${pill(esc(d.categoria), "info")}</div>
    <div class="acoes"><button class="btn outline pequeno" data-baixar="${d.id}" data-nome="${esc(d.nome_original)}">${ico("baixar")} Baixar</button>${ehGestao ? `<button class="btn outline pequeno" data-excluir-doc="${d.id}">${ico("lixeira")} Excluir</button>` : ""}</div></div>`).join("") : vazio("Nenhum documento anexado ainda.");
  return `<small class="nota-seguranca">${ico("cadeado")} Os arquivos ficam criptografados e cada download é registrado (LGPD).</small>${lista}
  <form id="form-doc" class="item" style="background:var(--muted)"><b>Anexar documento</b>
    <div class="grade dois" style="margin-top:8px"><div><small>Categoria</small><select id="doc-cat">${f.categorias.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div><small>Título</small><input id="doc-titulo" required maxlength="120" placeholder="Ex.: Relatório do 1º bimestre"></div></div>
    ${solicitacoes.length ? `<div style="margin-top:8px"><small>Este documento atende a qual solicitação da escola? (opcional)</small><select id="doc-pend"><option value="">Nenhuma</option>${solicitacoes.map((p) => `<option value="${p.id}">${esc(p.descricao)}</option>`).join("")}</select></div>` : ""}
    <div style="margin-top:8px"><small>Arquivo (PDF, PNG, JPG, DOC ou DOCX — até 5 MB)</small><input type="file" id="doc-arquivo" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" required></div>
    ${erroBox("doc-erro")}<button class="btn pequeno" type="submit" style="margin-top:10px">Enviar documento</button></form>`;
}
function abaPendencias(f, podeRegistrar, ehGestao) {
  const lista = f.pendencias.length ? f.pendencias.map((p) => `<div class="item">
    <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${esc(p.descricao)}</b><small>${pill(p.tipo, "neutral")} Aberta em ${p.criada_em} por ${esc(p.criada_por_nome)}</small></div>${p.status === "Aberta" ? pill("Aberta", "danger") : pill("Resolvida", "success")}</div>
    ${p.status === "Resolvida" ? `<small style="margin-top:6px">Resolvida em ${p.resolvida_em} por ${esc(p.resolvida_por_nome)}</small>` : ehGestao ? `<button class="btn outline pequeno" data-resolver="${p.id}" style="margin-top:10px">Marcar como resolvida</button>` : ""}</div>`).join("") : vazio("Nenhuma pendência.");
  return lista + (podeRegistrar ? `<form id="form-pend" class="item" style="background:var(--muted)"><b>Nova pendência</b>
    <div class="grade dois" style="margin-top:8px"><div><small>Tipo</small><select id="pend-tipo"><option>Documento</option><option>Cadastro</option><option>Outro</option></select></div>
      <div><small>Descrição</small><input id="pend-desc" required maxlength="200" placeholder="Ex.: Entregar comprovante de residência"></div></div>
    ${erroBox("pend-erro")}<button class="btn pequeno" type="submit" style="margin-top:10px">Abrir pendência</button></form>` : "");
}
function abaOcorrencias(f, podeRegistrar) {
  const lista = f.ocorrencias.length ? f.ocorrencias.map((o) => `<div class="item">
    <div class="linha" style="gap:8px;flex-wrap:wrap"><small>${o.data} • registrada por ${esc(o.registrada_por_nome)}</small>${o.tipo === "Advertencia" ? pill("Advertência", "danger") : pill("Ação", "info")}</div><p style="margin-top:6px">${esc(o.descricao)}</p></div>`).join("") : vazio("Nenhuma ação ou advertência registrada.");
  return lista + (podeRegistrar ? `<form id="form-ocor" class="item" style="background:var(--muted)"><b>Registrar ação ou advertência</b>
    <div class="grade dois" style="margin-top:8px"><div><small>Tipo</small><select id="ocor-tipo"><option value="Advertencia">Advertência</option><option value="Acao">Ação</option></select></div>
      <div><small>Data</small><input type="date" id="ocor-data"></div></div>
    <div style="margin-top:8px"><small>Descrição (só os fatos, sem rótulos nem julgamentos sobre a criança)</small><textarea id="ocor-desc" rows="3" maxlength="500" required></textarea></div>
    ${erroBox("ocor-erro")}<button class="btn pequeno" type="submit" style="margin-top:10px">Registrar</button></form>` : "");
}
function abrirComprovante(a, aluno) {
  const w = window.open("", "_blank");
  if (!w) { avisar("O navegador bloqueou a janela do comprovante. Permita pop-ups para este site e tente de novo.", "danger"); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante ${esc(a.codigo)}</title>
    <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#140040}h1{font-size:1.375rem}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:10px;border-bottom:1px solid #EAD6CA}td:first-child{color:#5B5278;width:38%}.cod{font-size:1.25rem;letter-spacing:2px;font-weight:700}@media print{button{display:none}}</style></head><body>
    <h1>${ico("escudoOk")} S.I.V.E. — Comprovante de autorização digital</h1>
    <table aria-label="Dados da autorização"><tr><td>Autorização</td><td>${esc(a.titulo)}</td></tr><tr><td>Detalhes</td><td>${esc(a.detalhe || "—")}</td></tr>
    <tr><td>Aluno(a)</td><td>${esc(aluno.nome)} — ${esc(aluno.sala)}</td></tr><tr><td>Assinada por</td><td>${esc(a.assinada_nome)}</td></tr>
    <tr><td>Data e hora</td><td>${esc(a.assinada_em)}</td></tr><tr><td>Código de verificação</td><td class="cod">${esc(a.codigo)}</td></tr></table>
    ${blocoVerificacao(a.codigo)}<p>Documento gerado pelo sistema S.I.V.E. A assinatura foi confirmada com a senha do responsável.</p><button id="imprimir">Imprimir</button></body></html>`);
  w.document.close();
  w.document.getElementById("imprimir").addEventListener("click", () => w.print());
}
async function baixarDadosAluno(alunoId) {
  const r = await fetch(`/api/alunos/${alunoId}/meus-dados`, { headers: { Authorization: "Bearer " + usuarioLogado.token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Não foi possível gerar o arquivo");
  const url = URL.createObjectURL(await r.blob());
  const link = document.createElement("a");
  link.href = url; link.download = `dados-aluno-${alunoId}.json`; link.click();
  URL.revokeObjectURL(url);
}
async function baixarDocumento(id, nome) {
  const r = await fetch(`/api/documentos/${id}/arquivo`, { headers: { Authorization: "Bearer " + usuarioLogado.token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Não foi possível baixar");
  const url = URL.createObjectURL(await r.blob());
  const link = document.createElement("a");
  link.href = url; link.download = nome; link.click();
  URL.revokeObjectURL(url);
}
function desenharFicha() {
  const f = dados.ficha, papel = usuarioLogado.papel;
  const ehPai = papel === "pai", ehGestao = papel === "admin", podeRegistrar = !ehPai;
  const aba = dados.fichaAba;
  const naoLidos = f.comunicados.filter((c) => !c.lido).length, autPend = f.autorizacoes.filter((a) => !a.assinada && !a.vencida).length;
  const pendAbertas = f.pendencias.filter((p) => p.status === "Aberta").length;
  const abas = [["comunicados", "Comunicados", naoLidos ? pl(naoLidos, "novo", "novos") : ""], ["autorizacoes", "Autorizações", autPend ? pl(autPend, "pendente", "pendentes") : ""],
    ["documentos", "Documentos", f.documentos.length || ""], ["pendencias", "Pendências", pendAbertas ? pl(pendAbertas, "aberta", "abertas") : ""], ["ocorrencias", "Ocorrências", f.ocorrencias.length || ""]];
  const cabecalho = ehPai ? "" : `<section class="card"><div class="aluno"><span class="avatar">${iniciais(f.aluno.nome)}</span><div><h2>${esc(f.aluno.nome)}</h2><small>${esc(f.aluno.sala)} • Matrícula ${esc(f.aluno.matricula || "—")}</small>${f.aluno.situacao && f.aluno.situacao !== "Ativo" ? pill(`${esc(f.aluno.situacao)}${f.aluno.situacao_em ? " em " + f.aluno.situacao_em : ""}${f.aluno.situacao_motivo ? " — " + esc(f.aluno.situacao_motivo) : ""}`, "warning") : ""}</div></div>
    <small style="margin-top:10px;font-weight:700;text-transform:uppercase">Responsáveis</small>
    ${f.responsaveis.length ? f.responsaveis.map((r) => `<small>${esc(r.nome)} (${esc(r.parentesco)}) • ${ico("telefone")} ${esc(r.telefone || "—")}${r.telefone2 ? " / " + esc(r.telefone2) : ""}${r.email ? " • " + ico("email") + " " + esc(r.email) : ""} • prefere ${esc(r.contato_preferido || "WhatsApp")}</small>`).join("") : "<small>Nenhum responsável cadastrado.</small>"}${consentimentoNaFicha(f)}
    ${f.agora ? `<small style="margin-top:10px;font-weight:700;text-transform:uppercase">Agora</small><span>${pillAgora(f.agora)} <small style="display:inline">${esc(f.agora.detalhe)}</small></span>` : ""}</section>`;
  const conteudo = { comunicados: () => abaComunicados(f, ehPai), autorizacoes: () => abaAutorizacoes(f, ehPai), documentos: () => abaDocumentos(f, ehGestao),
    pendencias: () => abaPendencias(f, podeRegistrar, ehGestao), ocorrencias: () => abaOcorrencias(f, podeRegistrar) }[aba]();
  const msg = dados.fichaMsg; dados.fichaMsg = "";
  const botaoDados = ehPai || ehGestao ? `<div class="acoes" style="margin:10px 0"><button class="btn outline pequeno" data-baixar-dados="${f.aluno.id}" title="Direito de acesso aos dados (LGPD, art. 18)">${ico("documento")} Baixar os dados do aluno (LGPD)</button></div>` : "";
  document.getElementById("ficha-corpo").innerHTML = `${cabecalho}${botaoDados}
    <div class="abas">${abas.map(([id, nome, qtd]) => `<button class="aba ${id === aba ? "ativa" : ""}" data-aba="${id}">${nome}${qtd !== "" ? ` <span class="qtd">${qtd}</span>` : ""}</button>`).join("")}</div>
    ${msg ? `<p class="pill success" style="margin-bottom:8px">${esc(msg)}</p>` : ""}${conteudo}`;

  const corpo = document.getElementById("ficha-corpo");
  corpo.querySelectorAll("[data-aba]").forEach((b) => b.onclick = () => { dados.fichaAba = b.dataset.aba; desenharFicha(); });
  corpo.querySelectorAll("[data-ler]").forEach((b) => b.onclick = seguro(async () => {
    await api(`/api/comunicados/${b.dataset.ler}/ler`, { method: "POST", body: "{}" }); await recarregarFicha();
    if (tela === "pais") { document.querySelector(".atencao").outerHTML = cartaoAtencao(); ligarAtencao(); }
  }));
  corpo.querySelectorAll("[data-assinar]").forEach((b) => b.onclick = seguro(async () => {
    const id = b.dataset.assinar;
    if (!corpo.querySelector(`[data-as-confirmo="${id}"]`).checked) throw new Error("Marque “Li e autorizo” para assinar.");
    if (!corpo.querySelector(`[data-as-senha="${id}"]`).value) throw new Error("Digite a sua senha para assinar.");
    await api(`/api/autorizacoes/${id}/assinar`, { method: "POST", body: JSON.stringify({ confirmo: true, senha: corpo.querySelector(`[data-as-senha="${id}"]`).value }) });
    dados.fichaMsg = "Autorização assinada! O comprovante está disponível abaixo.";
    avisar("Autorização assinada.");
    await recarregarFicha();
    if (tela === "pais") { document.querySelector(".atencao").outerHTML = cartaoAtencao(); ligarAtencao(); }
  }));
  corpo.querySelectorAll("[data-comprovante]").forEach((b) => b.onclick = () =>
    abrirComprovante(f.autorizacoes.find((a) => a.id === Number(b.dataset.comprovante)), f.aluno));
  corpo.querySelectorAll("[data-baixar-dados]").forEach((b) => b.onclick = seguro(() => baixarDadosAluno(b.dataset.baixarDados)));
  corpo.querySelectorAll("[data-baixar]").forEach((b) => b.onclick = seguro(() => baixarDocumento(b.dataset.baixar, b.dataset.nome)));
  corpo.querySelectorAll("[data-excluir-doc]").forEach((b) => b.onclick = seguro(async () => {
    if (!(await confirmar({ titulo: "Excluir este documento?", texto: "O arquivo é apagado do sistema e não pode ser recuperado. A exclusão fica registrada nos logs.", botao: "Excluir documento", perigo: true }))) return;
    await api(`/api/documentos/${b.dataset.excluirDoc}`, { method: "DELETE" });
    dados.fichaMsg = "Documento excluído."; await recarregarFicha();
  }));
  corpo.querySelectorAll("[data-resolver]").forEach((b) => b.onclick = seguro(async () => {
    await api(`/api/pendencias/${b.dataset.resolver}/resolver`, { method: "PUT", body: "{}" });
    dados.fichaMsg = "Pendência resolvida."; await recarregarFicha();
  }));
  const formDoc = document.getElementById("form-doc");
  if (formDoc) formDoc.onsubmit = async (e) => {
    e.preventDefault();
    document.getElementById("doc-erro").classList.add("oculto");
    try {
      const arquivo = document.getElementById("doc-arquivo").files[0];
      if (!arquivo) throw new Error("Escolha um arquivo");
      if (arquivo.size > 5 * 1024 * 1024) throw new Error("O arquivo passa de 5 MB");
      const pend = document.getElementById("doc-pend");
      const r = await api("/api/documentos", { method: "POST", body: JSON.stringify({
        aluno_id: f.aluno.id, categoria: document.getElementById("doc-cat").value, titulo: document.getElementById("doc-titulo").value,
        nome_arquivo: arquivo.name, conteudo: await lerBase64(arquivo), pendencia_id: pend && pend.value ? Number(pend.value) : undefined }) });
      dados.fichaMsg = r.pendencia_resolvida ? "Documento enviado e a solicitação da escola foi atendida!" : "Documento enviado com sucesso!";
      await recarregarFicha();
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("doc-erro", erro.message); }
  };
  const formPend = document.getElementById("form-pend");
  if (formPend) formPend.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/pendencias", { method: "POST", body: JSON.stringify({ aluno_id: f.aluno.id, tipo: document.getElementById("pend-tipo").value, descricao: document.getElementById("pend-desc").value }) });
      dados.fichaMsg = "Pendência aberta."; await recarregarFicha();
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("pend-erro", erro.message); }
  };
  const formOcor = document.getElementById("form-ocor");
  if (formOcor) formOcor.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/advertencias", { method: "POST", body: JSON.stringify({ aluno_id: f.aluno.id, tipo: document.getElementById("ocor-tipo").value,
        descricao: document.getElementById("ocor-desc").value, data: document.getElementById("ocor-data").value || undefined }) });
      dados.fichaMsg = "Registro salvo."; await recarregarFicha();
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("ocor-erro", erro.message); }
  };
}

// ---------- Assinatura digital: selo (no lugar da letra cursiva) e confirmação com senha ----------
// Selo: quem assinou, quando e o código que qualquer pessoa confere em "Verificar assinatura" (ou pelo QR code do comprovante)
function seloAssinatura(rotulo, nome, em, codigo) {
  return `<div class="selo-assinatura">${ico("escudoOk")}<div><small>${rotulo}</small><b>${esc(nome)}</b>
    <small>Assinado digitalmente em ${esc(em)}${codigo ? ` • código ${esc(codigo)}` : ""}</small>
    ${codigo ? `<a class="selo-link" href="/?verificar=${encodeURIComponent(codigo)}" target="_blank" rel="noopener">Verificar assinatura</a>` : ""}</div></div>`;
}
// Caixa para assinar: não basta estar logado, a pessoa confirma com a própria senha
function caixaAssinar(rotulo, atributos = "") {
  return `<div class="assinatura-caixa" ${atributos}>
    <small><b>${rotulo}</b></small>
    <small>Para assinar digitalmente, confirme com a sua senha do sistema. Ficam registrados a data, a hora, de onde você assinou e um código de verificação.</small>
    <div class="linha" style="gap:8px;flex-wrap:wrap;justify-content:flex-start;width:100%">
      <input type="password" data-senha-assinatura autocomplete="current-password" placeholder="Sua senha" aria-label="Sua senha para assinar" style="max-width:220px">
      <button type="button" class="btn pequeno" data-confirmar-assinatura style="width:auto">${ico("escudoOk")} Assinar digitalmente</button></div>
    <p class="pill danger oculto" data-erro-assinatura style="white-space:normal"></p></div>`;
}
// Liga a caixa: envia a senha para `url` e, dando certo, chama `depois`
function ligarCaixaAssinar(caixa, url, depois) {
  const q = (s) => caixa.querySelector(s), botao = q("[data-confirmar-assinatura]"), senha = q("[data-senha-assinatura]"), erro = q("[data-erro-assinatura]");
  const enviar = async () => {
    erro.classList.add("oculto");
    if (!senha.value) { erro.textContent = "Digite a sua senha para assinar."; erro.classList.remove("oculto"); return senha.focus(); }
    botao.disabled = true;
    try { await api(url, { method: "POST", body: JSON.stringify({ senha: senha.value }) }); await depois(); }
    catch (e) { botao.disabled = false; senha.value = ""; if (e.message !== "Sessão expirada") { erro.textContent = e.message; erro.classList.remove("oculto"); } }
  };
  botao.onclick = enviar;
  senha.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); enviar(); } };
}

// ---------- Ocorrências do professor (registro do dia, com assinatura digital) ----------
const mesPorExtenso = (mesIso) => { const t = new Date(mesIso + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); };
const dataBR = (iso) => iso.split("-").reverse().join("/");
function telaOcorrencias() {
  const msg = dados.ocorrenciaMsg || ""; dados.ocorrenciaMsg = "";
  const alunos = opcoesAlunos(dados.turma.alunos, usuarioLogado.sala);
  return `<div class="topo"><h2>Ocorrências</h2><small>Registre o que aconteceu com um aluno da sua turma. Cada registro é assinado e fica arquivado abaixo.</small></div>
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  <form id="form-ocorrencia" class="card" style="margin-bottom:20px">
    <b>Nova ocorrência</b>
    <div class="grade dois" style="margin-top:10px">
      <div><small>Turma e aluno</small><select id="oc-aluno" data-filtro-turma required><option value="">Escolha o aluno...</option>${alunos}</select></div>
      <div><small>Turma</small><input value="${esc(usuarioLogado.sala)}" disabled></div>
    </div>
    <div class="grade dois">
      <div><small>Data</small><input type="date" id="oc-data" value="${hojeLocalISO()}" max="${hojeLocalISO()}" required></div>
      <div><small>Horário</small><input type="time" id="oc-horario" required></div>
    </div>
    <div><small>Quando o responsável foi notificado</small><input type="datetime-local" id="oc-notificado" required></div>
    <div style="margin-top:12px"><small>Ocorrência (descreva os fatos e as providências tomadas)</small><textarea id="oc-descricao" rows="4" maxlength="1000" required></textarea></div>
    <div style="margin-top:12px"><small>Quem buscou o aluno (nome e parentesco, se alguém buscou)</small><input id="oc-buscado" maxlength="100" required></div>
    <div class="assinatura-caixa">
      <small><b>Assinatura digital do docente</b></small>
      <small>Ao registrar, você assina digitalmente a ocorrência. Confirme com a sua senha do sistema.</small>
      <input type="password" id="oc-senha" autocomplete="current-password" required placeholder="Sua senha" aria-label="Sua senha para assinar" style="max-width:260px">
    </div>
    <p id="oc-erro" class="pill danger oculto" style="margin-top:12px;white-space:normal"></p>
    <button class="btn" type="submit" style="margin-top:14px;max-width:300px">${ico("escudoOk")} Registrar e assinar</button>
  </form>
  <section class="card"><h2>Arquivo de ocorrências (${dados.ocorrencias.length})</h2>
    <small>Organizado em pastas por mês. A pasta mais recente já vem aberta.</small>
    <div style="margin-top:12px">${pastasOcorrencias(dados.ocorrencias)}</div></section>`;
}
function pastasOcorrencias(lista) {
  if (!lista.length) return vazio("Nenhuma ocorrência arquivada ainda.");
  const meses = new Map(); // mês (AAAA-MM) -> ocorrências, já da mais recente para a mais antiga
  for (const o of lista) {
    const mes = o.data.slice(0, 7);
    if (!meses.has(mes)) meses.set(mes, []);
    meses.get(mes).push(o);
  }
  return [...meses].map(([mes, itens], i) => `<details class="pasta" ${i === 0 ? "open" : ""}>
    <summary><b>${ico("pasta")} ${mesPorExtenso(mes)}</b> <small style="display:inline">(${pl(itens.length, "ocorrência", "ocorrências")})</small></summary>
    ${itens.map((o) => `<div class="item">
      <div class="linha" style="flex-wrap:wrap;gap:8px"><div><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario}</small></div>${pill("Código " + esc(o.codigo), "neutral")}</div>
      <p style="margin-top:8px;white-space:pre-line">${esc(o.descricao)}</p>
      <small>Responsável notificado em ${o.notificado_em} • Buscado por ${esc(o.buscado_por)}</small>
      ${seloAssinatura("Registrado e assinado pelo docente", o.professor_nome, o.assinada_em, o.codigo)}
      ${o.resp_assinada_em
        ? seloAssinatura("Ciência do responsável", o.resp_nome, o.resp_assinada_em, o.resp_codigo)
        : `<div style="margin-top:10px">${pill("Aguardando a assinatura do responsável", "warning")}</div>`}
      ${o.ges_assinada_em
        ? seloAssinatura("Assinatura da gestão", o.ges_nome, o.ges_assinada_em, o.ges_codigo)
        : `<div style="margin-top:6px">${pill("Aguardando a assinatura da gestão", "warning")}</div>`}
    </div>`).join("")}
  </details>`).join("");
}
function ligarOcorrencias() {
  const $ = (id) => document.getElementById(id);
  $("oc-horario").value = new Date().toTimeString().slice(0, 5);
  $("form-ocorrencia").onsubmit = async (e) => {
    e.preventDefault();
    $("oc-erro").classList.add("oculto");
    try {
      const r = await api("/api/ocorrencias-escolares", { method: "POST", body: JSON.stringify({
        aluno_id: Number($("oc-aluno").value), data: $("oc-data").value, horario: $("oc-horario").value, notificado_em: $("oc-notificado").value,
        descricao: $("oc-descricao").value, buscado_por: $("oc-buscado").value, senha: $("oc-senha").value,
      }) });
      dados.ocorrenciaMsg = `Ocorrência registrada e assinada. Código de verificação: ${r.codigo}`;
      await mostrar("ocorrencias"); // recarrega o arquivo com o registro novo
    } catch (erro) { $("oc-senha").value = ""; if (erro.message !== "Sessão expirada") mostrarErro("oc-erro", erro.message); }
  };
}

// ---------- Ocorrências no Portal da Família: o responsável lê o registro do professor e assina que tomou ciência ----------
function telaOcorrenciasPai() {
  const msg = dados.ocorrenciaMsg || ""; dados.ocorrenciaMsg = "";
  const cartao = (o) => {
    const nova = !o.resp_assinada_em;
    return `<article class="card" style="margin-bottom:14px;${nova ? "border-left:4px solid var(--warning)" : ""}">
    <div class="linha" style="flex-wrap:wrap;gap:8px"><div><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario}</small></div>
      ${nova ? pill("Nova • aguardando sua assinatura", "warning") : pill("Assinada", "success")}</div>
    <p style="margin-top:10px;white-space:pre-line">${esc(o.descricao)}</p>
    <small style="margin-top:6px">Responsável notificado em ${o.notificado_em} • Buscado por ${esc(o.buscado_por)}</small>
    ${seloAssinatura("Registrado e assinado pelo docente", o.professor_nome, o.assinada_em, o.codigo)}
    ${nova ? caixaAssinar("Sua assinatura digital (responsável)", `data-oc-assin="${o.id}"`)
      : seloAssinatura("Sua ciência (responsável)", o.resp_nome, o.resp_assinada_em, o.resp_codigo)}
  </article>`;
  };
  return `<div class="topo"><h2>Ocorrências</h2><small>Registros feitos pelo docente sobre o seu filho. Leia e assine para confirmar que você tomou ciência.</small></div>
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  ${dados.ocorrencias.length ? dados.ocorrencias.map(cartao).join("") : vazio("Nenhuma ocorrência registrada.")}`;
}
function ligarOcorrenciasPai() {
  document.querySelectorAll("[data-oc-assin]").forEach((caixa) => ligarCaixaAssinar(caixa, `/api/minhas-ocorrencias/${caixa.dataset.ocAssin}/assinar`, async () => {
    dados.ocorrenciaMsg = "Assinatura registrada. Obrigado por confirmar que tomou ciência da ocorrência.";
    await mostrar("ocorrencias"); // recarrega a lista e o número no menu
  }));
}
// Número de ocorrências ainda não assinadas, ao lado de "Ocorrências" no menu do responsável
async function atualizarNovasOcorrencias() {
  if (usuarioLogado.papel !== "pai") return;
  try {
    dados.ocorrenciasNovas = (await api("/api/minhas-ocorrencias/novas")).novas;
    desenharMenu();
  } catch { /* o número aparece na próxima troca de tela */ }
}

// ---------- Comunicados (gestão e professor) ----------
function telaComunicados() {
  const prof = usuarioLogado.papel === "professor";
  const salas = prof ? [] : nomesTurmas();
  return `<section class="card"><h2>Novo comunicado</h2>
    <small>${prof ? `Será enviado aos responsáveis da turma ${esc(usuarioLogado.sala)}.` : "Escolha uma turma ou envie para a escola toda."}</small>
    <form id="form-com" style="margin-top:14px"><small>Título</small><input id="com-titulo" required maxlength="120">
      ${prof ? "" : `<div style="margin-top:12px"><small>Destino</small><select id="com-sala"><option value="">Escola toda</option>${salas.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>`}
      <div style="margin-top:12px"><small>Texto (não cite nomes de alunos: todas as famílias leem este aviso)</small><textarea id="com-texto" rows="4" maxlength="1500" required></textarea></div>
      <p class="pill danger oculto" id="com-erro" style="margin-top:12px"></p><p class="pill success oculto" id="com-ok" style="margin-top:12px">Comunicado publicado!</p>
      <button class="btn" type="submit" style="margin-top:16px;max-width:240px">Publicar comunicado</button></form></section>
    <div class="topo" style="margin-top:24px"><h2>Comunicados publicados</h2><small>Acompanhe quantos responsáveis já leram cada um.</small></div><div id="com-lista"></div>`;
}
function desenharComunicados() {
  document.getElementById("com-lista").innerHTML = dados.comunicados.length ? dados.comunicados.map((c) => {
    const p = c.destinatarios ? Math.round(c.lidos * 100 / c.destinatarios) : 0;
    return `<article class="card" style="margin-bottom:12px">
      <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${esc(c.titulo)}</b><small>${c.criado_em} • ${esc(c.criado_por_nome)}</small></div>${pill(c.sala ? esc(c.sala) : "Escola toda", "info")}</div>
      <p style="margin-top:8px">${esc(c.texto)}</p>
      <div class="linha" style="margin-top:12px"><small>Lido por <b>${c.lidos}</b> de <b>${c.destinatarios}</b> ${c.destinatarios === 1 ? "aluno" : "alunos"}</small><small>${p}%</small></div>
      <div class="barra"><i style="width:${p}%"></i></div>
      <button class="btn outline pequeno" data-leituras="${c.id}" style="margin-top:12px">Ver quem leu</button><div id="leit-${c.id}" class="oculto" style="margin-top:10px"></div></article>`;
  }).join("") : vazio("Nenhum comunicado publicado ainda.");
  document.querySelectorAll("[data-leituras]").forEach((b) => b.onclick = seguro(async () => {
    const box = document.getElementById("leit-" + b.dataset.leituras);
    if (!box.classList.contains("oculto")) { box.classList.add("oculto"); return; }
    const lista = await api(`/api/comunicados/${b.dataset.leituras}/leituras`);
    box.innerHTML = lista.map((l) => `<div class="linha" style="padding:6px 0;border-top:1px solid var(--border)"><span>${esc(l.nome)} <small style="display:inline">(${esc(l.sala)})</small></span>${l.lido ? pill("Leu em " + l.lido_em, "success") : pill("Não leu", "warning")}</div>`).join("");
    box.classList.remove("oculto");
  }));
}
function ligarComunicados() {
  desenharComunicados();
  document.getElementById("form-com").onsubmit = async (e) => {
    e.preventDefault();
    document.getElementById("com-erro").classList.add("oculto"); document.getElementById("com-ok").classList.add("oculto");
    try {
      const sala = document.getElementById("com-sala");
      const corpo = { titulo: document.getElementById("com-titulo").value, texto: document.getElementById("com-texto").value, sala: sala ? sala.value : undefined };
      try { await api("/api/comunicados", { method: "POST", body: JSON.stringify(corpo) }); }
      catch (e) {
        if (e.codigo !== "NOME_DE_ALUNO") throw e;
        if (!(await confirmar({ titulo: "O comunicado cita nomes de alunos", texto: `Nomes encontrados: ${e.alunos.join(", ")}. Todas as famílias que recebem o aviso vão ler (ECA, arts. 17 e 18). Publique só se for necessário.`, botao: "Publicar mesmo assim", perigo: true }))) return;
        await api("/api/comunicados", { method: "POST", body: JSON.stringify({ ...corpo, confirmar_nomes: true }) });
      }
      document.getElementById("form-com").reset();
      dados.comunicados = await api("/api/comunicados"); desenharComunicados();
      document.getElementById("com-ok").classList.remove("oculto");
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("com-erro", erro.message); }
  };
}

// ---------- Autorizações digitais (gestão) ----------
function telaAutorizacoes() {
  const salas = nomesTurmas();
  return `<section class="card"><h2>Nova autorização</h2><small>O responsável de cada aluno do destino receberá a autorização para assinar digitalmente.</small>
    <form id="form-aut" style="margin-top:14px"><div class="grade dois"><div><small>Título</small><input id="aut-titulo" required maxlength="100" placeholder="Ex.: Passeio ao zoológico"></div>
      <div><small>Assinar até (último dia)</small><input id="aut-valida-ate" type="date" min="${hojeLocalISO()}"></div></div>
      <div style="margin-top:12px"><small>Quando é (texto livre, opcional)</small><input id="aut-validade" maxlength="50" placeholder="Ex.: Passeio em 25 de outubro"></div>
      <div style="margin-top:12px"><small>Detalhes</small><input id="aut-detalhe" maxlength="250" placeholder="Ex.: Saída às 8h, retorno às 15h"></div>
      <div style="margin-top:12px"><small>Destino</small><select id="aut-sala"><option value="">Todos os alunos</option>${salas.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
      <p class="pill danger oculto" id="aut-erro" style="margin-top:12px"></p><p class="pill success oculto" id="aut-ok" style="margin-top:12px"></p>
      <button class="btn" type="submit" style="margin-top:16px;max-width:240px">Enviar para assinatura</button></form></section>
    <div class="topo" style="margin-top:24px"><h2>Autorizações enviadas</h2><small>Acompanhe quem já assinou.</small></div><div id="aut-lista"></div>`;
}
function desenharGrupos() {
  document.getElementById("aut-lista").innerHTML = dados.grupos.length ? dados.grupos.map((g) => {
    const p = g.total ? Math.round(g.assinadas * 100 / g.total) : 0;
    return `<article class="card" style="margin-bottom:12px">
      <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${esc(g.titulo)}</b><small>${ico("calendario")} ${esc(g.validade || "—")}${g.valida_ate ? ` • assinar até ${g.valida_ate}` : ""} • criada em ${g.criada_em} por ${esc(g.criada_por_nome)}</small></div>
        ${g.assinadas === g.total ? pill("Todas assinadas", "success") : g.vencida ? pill(`Prazo encerrado • ${g.total - g.assinadas} sem assinatura`, "neutral") : pill(pl(g.total - g.assinadas, "pendente", "pendentes"), "warning")}</div>
      ${g.detalhe ? `<small style="margin-top:6px">${esc(g.detalhe)}</small>` : ""}
      <div class="linha" style="margin-top:12px"><small>Assinadas: <b>${g.assinadas}</b> de <b>${g.total}</b></small><small>${p}%</small></div><div class="barra"><i style="width:${p}%"></i></div>
      <button class="btn outline pequeno" data-grupo="${g.grupo}" style="margin-top:12px">Ver detalhes</button><div id="grp-${g.grupo}" class="oculto" style="margin-top:10px"></div></article>`;
  }).join("") : vazio("Nenhuma autorização enviada ainda.");
  document.querySelectorAll("[data-grupo]").forEach((b) => b.onclick = seguro(async () => {
    const box = document.getElementById("grp-" + b.dataset.grupo);
    if (!box.classList.contains("oculto")) { box.classList.add("oculto"); return; }
    const lista = await api(`/api/autorizacoes-grupos/${b.dataset.grupo}`);
    box.innerHTML = `<div class="tabela"><table><caption class="so-leitor">Assinaturas da autorização</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Situação</th><th scope="col">Assinada por</th><th scope="col">Data e hora</th><th scope="col">Código</th></tr></thead><tbody>${lista.map((l) => `<tr><td><b>${esc(l.nome)}</b><small>${esc(l.sala)}</small></td>
      <td>${l.assinada ? pill("Assinada", "success") : pill("Pendente", "warning")}</td><td>${esc(l.assinada_nome || "—")}</td><td>${l.assinada_em || "—"}</td><td>${esc(l.codigo || "—")}</td></tr>`).join("")}</tbody></table></div>`;
    box.classList.remove("oculto");
  }));
}
function ligarAutorizacoes() {
  desenharGrupos();
  document.getElementById("form-aut").onsubmit = async (e) => {
    e.preventDefault();
    const ok = document.getElementById("aut-ok");
    document.getElementById("aut-erro").classList.add("oculto"); ok.classList.add("oculto");
    try {
      const r = await api("/api/autorizacoes", { method: "POST", body: JSON.stringify({ titulo: document.getElementById("aut-titulo").value,
        validade: document.getElementById("aut-validade").value, valida_ate: document.getElementById("aut-valida-ate").value || undefined, detalhe: document.getElementById("aut-detalhe").value, sala: document.getElementById("aut-sala").value }) });
      document.getElementById("form-aut").reset();
      dados.grupos = await api("/api/autorizacoes-grupos"); desenharGrupos();
      ok.textContent = `Autorização enviada para ${pl(r.alunos, "aluno", "alunos")}!`; ok.classList.remove("oculto");
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("aut-erro", erro.message); }
  };
}

// ---------- Navegação ----------
async function mostrar(id) {
  const trocouDeAba = id !== tela; // recarregar a mesma tela (ex.: depois de salvar) mantém a rolagem
  tela = id;
  clearInterval(timerTela); clearInterval(timerBanner);
  document.getElementById("titulo").textContent = titulos[id];
  document.title = `${titulos[id]} — S.I.V.E.`;
  ajustarVLibras(id === "protecao");
  pararVoz();
  desenharMenu();
  atualizarNovasOcorrencias();
  fecharMenu();
  try {
    if (id === "secretaria") {
      dados.resumo = await api("/api/resumo"); dados.gestao = await api("/api/gestao-alunos"); dados.banners = await api("/api/eventos/banners");
      dados.ordem = dados.ordem || { campo: "nome", dir: 1 }; dados.filtroGestao = dados.filtroGestao || "todos";
    }
    if (id === "seguranca") { dados.mon = await api("/api/monitoramento"); dados.monResultado = null; }
    if (id === "calendario") {
      dados.calMes = dados.calMes || hojeLocalISO().slice(0, 7);
      dados.cal = await api("/api/eventos?mes=" + dados.calMes);
      if (usuarioLogado.papel === "admin") dados.turmas = await api("/api/turmas");
    }
    if (id === "perfil") dados.perfil = await api("/api/meu-perfil");
    if (id === "frequencia") dados.freq = await api("/api/frequencia");
    if (id === "busca") dados.busca = await api("/api/busca-ativa");
    if (id === "relatorio") dados.relatorio = await api("/api/relatorio-mensal");
    if (id === "ficha") dados.ficha = await api(`/api/alunos/${dados.fichaAlunoId}/ficha`);
    if (id === "comunicados") {
      dados.comunicados = await api("/api/comunicados");
      if (usuarioLogado.papel === "admin") dados.turmas = await api("/api/turmas");
    }
    if (id === "autorizacoes") { dados.grupos = await api("/api/autorizacoes-grupos"); dados.turmas = await api("/api/turmas"); }
    if (id === "cadastro") { dados.alunos = await api("/api/alunos"); dados.turmas = await api("/api/turmas"); }
    if (id === "ocorrencias") {
      if (usuarioLogado.papel === "pai") dados.ocorrencias = await api("/api/minhas-ocorrencias");
      else { dados.ocorrencias = await api("/api/ocorrencias-escolares"); dados.turma = await api("/api/minha-turma"); }
    }
    if (id === "usuarios") { dados.alunos = (await api("/api/alunos")).filter((a) => a.situacao === "Ativo"); dados.turmas = await api("/api/turmas"); dados.usuarios = await api("/api/usuarios"); dados.reat = await api("/api/reativacao"); }
    if (id === "logs") dados.logs = await api("/api/logs");
    if (id === "consentimentos") dados.consents = await api("/api/consentimentos");
    if (id === "protecao") {
      dados.protecao = await api("/api/protecao");
      dados.alunosProtecao = usuarioLogado.papel === "admin" ? await api("/api/alunos") : (await api("/api/minha-turma")).alunos;
      if (usuarioLogado.papel === "admin") dados.limiteFaltas = await api("/api/protecao/faltas-limite");
    }
    if (id === "turma") {
      dados.turma = await api("/api/minha-turma"); dados.banners = await api("/api/eventos/banners");
      // Ninguém vem marcado por padrão: só o que já foi salvo, ou quem passou pelo portão hoje (câmera ou portaria)
      dados.chamada = Object.fromEntries(dados.turma.alunos.map((a) => [a.id, a.status_hoje || (a.agora && a.agora.situacao === "na_escola" ? "Presente" : undefined)]).filter(([, v]) => v));
    }
    if (id === "pais") {
      const alunoId = usuarioLogado.aluno_id;
      dados.filho = await api(`/api/alunos/${alunoId}`);
      dados.historico = await api(`/api/presencas/${alunoId}?dias=30`);
      dados.ficha = await api(`/api/alunos/${alunoId}/ficha`);
      dados.agora = await api(`/api/alunos/${alunoId}/agora`); dados.banners = await api("/api/eventos/banners");
      dados.ocorrenciasNovas = (await api("/api/minhas-ocorrencias/novas")).novas;
      dados.fichaAba = dados.abaPedida || (dados.ficha.autorizacoes.some((a) => !a.assinada && !a.vencida) ? "autorizacoes" : "comunicados");
    }
    document.getElementById("tela").innerHTML = {
      secretaria: telaSecretaria, seguranca: telaSeguranca, pais: telaPais, frequencia: telaFrequencia, busca: telaBusca,
      relatorio: telaRelatorio, cadastro: telaCadastroAluno, usuarios: telaUsuarios, logs: telaLogs, turma: telaTurma,
      ficha: telaFicha, comunicados: telaComunicados, autorizacoes: telaAutorizacoes, consentimentos: telaConsentimentos, protecao: telaProtecao,
      calendario: telaCalendario, perfil: telaPerfil, ocorrencias: usuarioLogado.papel === "pai" ? telaOcorrenciasPai : telaOcorrencias,
    }[id]();
    if (trocouDeAba) { window.scrollTo({ top: 0, behavior: "instant" }); document.getElementById("tela").scrollTop = 0; } // cada aba abre do topo
    if (["secretaria", "turma", "pais"].includes(id)) ligarBanners();
    if (id === "secretaria") ligarGestao();
    if (id === "seguranca") ligarMonitoramento();
    if (id === "calendario") ligarCalendario();
    if (id === "perfil") ligarPerfil();
    if (id === "frequencia") ligarFrequencia();
    if (id === "busca") desenharBusca();
    if (id === "relatorio") ligarRelatorio();
    if (id === "cadastro") desenharCadastroAluno();
    if (id === "ocorrencias") (usuarioLogado.papel === "pai" ? ligarOcorrenciasPai : ligarOcorrencias)();
    if (id === "usuarios") desenharUsuarios();
    if (id === "turma") desenharChamada();
    if (id === "ficha") { document.getElementById("ficha-voltar").onclick = () => mostrar(dados.fichaOrigem); desenharFicha(); }
    if (id === "logs") {
      desenharLogs();
      document.getElementById("logs-pessoa").onchange = desenharLogs; document.getElementById("logs-busca").oninput = desenharLogs;
      document.getElementById("logs-conferir").onclick = seguro(async () => {
        const r = await api("/api/logs/integridade"), caixa = document.getElementById("logs-integridade");
        caixa.innerHTML = r.ok ? `<p class="pill success aviso-largo" style="margin-top:10px">${ico("confere")} Tudo certo: ${pl(r.conferidos, "registro conferido", "registros conferidos")}, nenhum foi apagado ou alterado.</p>`
          : `<p class="pill danger aviso-largo" style="margin-top:10px">${ico("aviso")} Atenção: o registro nº ${r.problema_em.id} (${esc(r.problema_em.quando)}, ${esc(acaoLabel(r.problema_em.acao))}) ou o anterior a ele foi apagado ou alterado por fora do sistema. Avise o responsável pela segurança dos dados.</p>`;
      });
    }
    if (id === "comunicados") ligarComunicados();
    if (id === "protecao") ligarProtecao();
    if (id === "autorizacoes") ligarAutorizacoes();
    if (id === "pais") {
      desenharFicha(); ligarAtencao();
      if (dados.abaPedida) { dados.abaPedida = null; document.getElementById("ficha-filho").scrollIntoView({ behavior: "smooth", block: "start" }); }
      timerTela = setInterval(async () => { // status ao vivo: atualiza sozinho a cada 30 segundos
        try { dados.agora = await api(`/api/alunos/${usuarioLogado.aluno_id}/agora`); const c = document.getElementById("status-agora"); if (c && tela === "pais") c.innerHTML = cartaoStatusAgora(); } catch { /* tenta de novo na próxima */ }
      }, 30000);
    }
  } catch (erro) {
    if (usuarioLogado) document.getElementById("tela").innerHTML = `<div class="card"><b>Não foi possível carregar os dados.</b><small>${erro.message === "Sessão expirada" ? "Faça login novamente." : esc(erro.message)}</small></div>`;
  }
}
function desenharMenu() {
  const menus = menusPorPapel[usuarioLogado.papel];
  const ativa = tela === "ficha" ? dados.fichaOrigem : tela;
  const novas = usuarioLogado.papel === "pai" ? dados.ocorrenciasNovas || 0 : 0;
  const contador = (m) => (m.id === "ocorrencias" && novas ? `<span class="contador" title="${pl(novas, "ocorrência nova", "ocorrências novas")}">${novas}</span>` : "");
  const trocouAba = ativa !== ultimaAbaAtiva; ultimaAbaAtiva = ativa;
  const classe = (m) => (m.id === ativa ? `ativo${trocouAba ? " entrou" : ""}` : "");
  document.getElementById("nav").innerHTML = menus.map((m, i) => `${m.grupo && m.grupo !== (menus[i - 1] || {}).grupo ? `<div class="nav-grupo">${m.grupo}</div>` : ""}<button class="${classe(m)}" data-id="${m.id}" ${m.id === ativa ? 'aria-current="page"' : ""}>${iconeMenu(m.icone)}<span><b>${m.nome}</b><small>${m.dica}</small></span>${contador(m)}</button>`).join("");
  document.getElementById("btn-menu").classList.toggle("tem-aviso", novas > 0); // no celular o menu fica fechado: um ponto no ☰ avisa
  document.querySelectorAll("#nav button").forEach((b) => b.onclick = async () => { await mostrar(b.dataset.id); document.getElementById("tela").focus({ preventScroll: true }); }); // o menu é redesenhado: sem isso, quem usa o teclado perde o lugar
}
// VLibras: o texto clicado é enviado ao servidor de tradução do governo. A tela Proteção é sigilosa (ECA, art. 100), então nela o tradutor fica desligado.
// Esconder o botão não basta: com o avatar já aberto, o clique no texto ainda traduziria. Por isso o pedido de tradução também é barrado aqui.
const fetchOriginal = window.fetch.bind(window);
window.fetch = (url, ...resto) => (tela === "protecao" && String(url.url || url).includes("traducao2.vlibras.gov.br") ? Promise.reject(new Error("Tradução desligada nesta tela")) : fetchOriginal(url, ...resto));
function ajustarVLibras(sigiloso) {
  const botao = document.getElementById("vlibras-access-wrapper"), avatar = document.getElementById("vlibras-app-root");
  if (botao) botao.classList.toggle("oculto", sigiloso);
  if (avatar && sigiloso) avatar.dataset.active = "false";
}
function fecharMenu() { menu.classList.remove("aberto"); overlay.classList.remove("aberto"); document.getElementById("btn-menu").setAttribute("aria-expanded", "false"); }
document.getElementById("btn-menu").onclick = (e) => { menu.classList.add("aberto"); overlay.classList.add("aberto"); e.currentTarget.setAttribute("aria-expanded", "true"); };
document.getElementById("overlay").onclick = fecharMenu;

// ---------- Tutorial do primeiro acesso: um tour pelas telas do perfil, com a opção de pular ----------
// Aparece uma vez por pessoa (usu_tutorial_visto_em). Quem fecha o navegador no meio vê de novo; quem pula ou conclui, não.
// Cada passo destaca um elemento real da tela (alvo). Passo "opcional" sai do tour se o elemento não existir para aquela pessoa.
const TELA_INICIAL = { admin: "secretaria", pai: "pais", professor: "turma" };
const TUTORIAL_INICIO = {
  admin: "Em menos de 1 minuto, você conhece as principais telas da gestão.",
  professor: "Em menos de 1 minuto, você aprende a fazer a chamada e conhece as telas da sua turma.",
  pai: "Em menos de 1 minuto, você aprende a acompanhar o seu filho pelo sistema.",
};
const PASSOS_TUTORIAL = {
  admin: [
    { alvo: '#nav [data-id="secretaria"]', titulo: "Central do Dia", texto: "Comece o dia por aqui. Esta tela resume a escola e mostra os alertas que precisam de atenção." },
    { alvo: '#nav [data-id="seguranca"]', titulo: "Monitoramento", texto: "Acompanhe os portões e as câmeras, veja quem está na escola e libere as saídas." },
    { alvo: '#nav [data-id="busca"]', titulo: "Busca Ativa", texto: "Os alunos com muitas faltas aparecem aqui, com o contato da família para ligar, chamar no WhatsApp ou mandar e-mail." },
    { alvo: '#nav [data-id="comunicados"]', titulo: "Comunicados", texto: "Publique avisos para as famílias e veja quem já leu." },
    { alvo: '#nav [data-id="autorizacoes"]', titulo: "Autorizações", texto: "Peça a assinatura digital dos responsáveis, defina o último dia para assinar e acompanhe quem já assinou." },
    { alvo: '#nav [data-id="cadastro"]', titulo: "Alunos e turmas", texto: "Cadastre os alunos um a um ou importe uma turma inteira por planilha." },
    { alvo: '#nav [data-id="usuarios"]', titulo: "Usuários", texto: "Crie os acessos de docentes e responsáveis. O sistema gera uma senha provisória, que você repassa à pessoa." },
    { alvo: "#busca-rapida", opcional: true, titulo: "Busca rápida", texto: "Digite o nome de um aluno para abrir a ficha dele. O atalho é a tecla /." },
  ],
  professor: [
    { alvo: ".card.chamada > .linha", opcional: true, titulo: "Chamada de hoje", texto: "Esta é a sua principal tarefa do dia. Quem passou pelo portão já vem como Presente. Marque Presente ou Ausente para os outros alunos." },
    { alvo: "#chamada-salvar", opcional: true, titulo: "Salvar a chamada", texto: "Quando todos estiverem marcados, clique aqui. O sistema só salva quando não falta nenhum aluno." },
    { alvo: "#seletor-contexto", opcional: true, titulo: "Trocar de turma", texto: "Você tem mais de uma turma. Escolha aqui qual quer ver." },
    { alvo: '#nav [data-id="ocorrencias"]', titulo: "Ocorrências", texto: "Registre o que aconteceu com um aluno. O responsável lê o registro e assina que tomou ciência." },
    { alvo: '#nav [data-id="comunicados"]', titulo: "Comunicados", texto: "Publique avisos para as famílias da sua turma." },
    { alvo: '#nav [data-id="calendario"]', titulo: "Calendário", texto: "Veja os eventos da escola e crie eventos para a sua turma." },
    { alvo: '#nav [data-id="protecao"]', titulo: "Proteção", texto: "Registre aqui uma suspeita de maus-tratos. O registro é sigiloso: a família nunca vê." },
    { alvo: "#busca-rapida", opcional: true, titulo: "Busca rápida", texto: "Digite o nome de um aluno da turma para abrir a ficha dele. O atalho é a tecla /." },
  ],
  pai: [
    { alvo: "#status-agora", opcional: true, titulo: "Status agora", texto: "Mostra se o seu filho está na escola, desde que horas e por qual portão entrou. Atualiza sozinho." },
    { alvo: ".card.atencao > .linha", opcional: true, titulo: "Precisa da sua atenção", texto: "Tudo o que espera uma resposta sua fica aqui: autorizações, ocorrências, documentos e comunicados. Cada item tem um botão que leva direto ao lugar certo." },
    { alvo: "#btn-avisos", opcional: true, titulo: "Sino de avisos", texto: "Mostra as entradas e saídas do seu filho e as novidades da escola. O número indica quantos avisos são novos." },
    { alvo: "#seletor-contexto", opcional: true, titulo: "Trocar de filho", texto: "Você tem mais de um filho na escola. Escolha aqui quem quer acompanhar." },
    { alvo: '#nav [data-id="ocorrencias"]', titulo: "Ocorrências", texto: "Leia os registros feitos pelo docente e assine que tomou ciência." },
    { alvo: '#nav [data-id="calendario"]', titulo: "Calendário", texto: "Veja os eventos da escola e da turma do seu filho." },
    { alvo: '#nav [data-id="perfil"]', titulo: "Meu perfil", texto: "Atualize o telefone e o e-mail para a escola conseguir falar com você. Também é aqui que você baixa os dados do seu filho." },
  ],
};
let tutorial = null; // enquanto o tour está aberto: { passos, atual, voltarFoco }
const alvoDoPasso = (p) => { const el = p.alvo && document.querySelector(p.alvo); return el && el.getClientRects().length ? el : null; };
async function iniciarTutorial() {
  if (tutorial) return;
  fecharMenu();
  const inicial = TELA_INICIAL[usuarioLogado.papel];
  if (tela !== inicial) await mostrar(inicial); // os passos apontam para a tela inicial do perfil
  if (!usuarioLogado || tutorial) return;
  tutorial = { atual: 0, voltarFoco: document.activeElement, passos: [
    { titulo: `Boas-vindas ao S.I.V.E., ${usuarioLogado.nome.trim().split(/\s+/)[0]}!`, texto: TUTORIAL_INICIO[usuarioLogado.papel] },
    ...PASSOS_TUTORIAL[usuarioLogado.papel].filter((p) => !p.opcional || alvoDoPasso(p)),
    { alvo: "#btn-acessibilidade", titulo: "Acessibilidade", texto: "Aqui você aumenta o texto, muda o contraste e liga a leitura em voz alta. Os ajustes ficam salvos na sua conta." },
    { alvo: "#btn-tutorial", titulo: "Tudo pronto!", texto: "Para rever este tutorial quando quiser, clique neste botão de ajuda, no fim do menu." },
  ] };
  const caixaTutorial = document.getElementById("tutorial");
  caixaTutorial.classList.remove("oculto"); caixaTutorial.classList.add("sem-transicao"); // a caixa já nasce no lugar certo; a animação vale só entre os passos
  await irParaPasso(0);
  requestAnimationFrame(() => requestAnimationFrame(() => caixaTutorial.classList.remove("sem-transicao")));
}
async function irParaPasso(i) {
  const t = tutorial, p = t.passos[i], $ = (id) => document.getElementById(id), ultimo = i === t.passos.length - 1;
  t.atual = i;
  $("tutorial-passo").textContent = `Passo ${i + 1} de ${t.passos.length}`;
  $("tutorial-titulo").textContent = p.titulo; $("tutorial-texto").textContent = p.texto;
  $("tutorial-barra").style.width = `${((i + 1) / t.passos.length) * 100}%`;
  $("tutorial-voltar").classList.toggle("oculto", i === 0);
  $("tutorial-pular").classList.toggle("oculto", ultimo);
  $("tutorial-proximo").textContent = i === 0 ? "Começar" : ultimo ? "Concluir" : "Próximo";
  // No celular o menu fica escondido: abre só nos passos que apontam para ele e espera a animação terminar
  const el = p.alvo && document.querySelector(p.alvo), noMenu = el && el.closest("#menu") && !matchMedia("(min-width:1024px)").matches;
  if (noMenu && !menu.classList.contains("aberto")) {
    menu.classList.add("aberto"); overlay.classList.add("aberto");
    await new Promise((ok) => setTimeout(ok, 320));
    if (tutorial !== t || t.atual !== i) return;
  } else if (!noMenu) fecharMenu();
  const alvo = alvoDoPasso(p);
  if (alvo && !alvo.closest("header")) alvo.scrollIntoView({ block: "center" }); // o topo é fixo: já está à vista
  desenharTutorial();
  $("tutorial-proximo").focus({ preventScroll: true });
}
// Recorta o destaque em volta do alvo e põe a caixa de texto no primeiro lado onde ela cabe
function desenharTutorial() {
  if (!tutorial) return;
  const foco = document.getElementById("tutorial-foco"), caixa = document.getElementById("tutorial-caixa");
  const alvo = alvoDoPasso(tutorial.passos[tutorial.atual]), w = caixa.offsetWidth, h = caixa.offsetHeight, m = 12, d = 16;
  const limita = (v, max) => Math.max(m, Math.min(v, max));
  const lugar = (el, x, y) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
  const tamanho = (el, largura, altura) => Object.assign(el.style, { width: `${largura}px`, height: `${altura}px` });
  if (!alvo) { lugar(foco, innerWidth / 2, innerHeight / 2); tamanho(foco, 0, 0); return lugar(caixa, (innerWidth - w) / 2, (innerHeight - h) / 2); }
  const r = alvo.getBoundingClientRect(), maxX = innerWidth - w - m, maxY = innerHeight - h - m;
  lugar(foco, r.left - 6, r.top - 6); tamanho(foco, r.width + 12, r.height + 12);
  if (r.right + d + w <= innerWidth - m) lugar(caixa, r.right + d, limita(r.top, maxY));
  else if (r.bottom + d + h <= innerHeight - m) lugar(caixa, limita(r.left, maxX), r.bottom + d);
  else if (r.top - d - h >= m) lugar(caixa, limita(r.left, maxX), r.top - d - h);
  else if (r.left - d - w >= m) lugar(caixa, r.left - d - w, limita(r.top, maxY));
  else lugar(caixa, (innerWidth - w) / 2, maxY);
}
function fecharTutorial() {
  if (!tutorial) return;
  const { voltarFoco } = tutorial;
  tutorial = null;
  document.getElementById("tutorial").classList.add("oculto");
  fecharMenu(); menu.scrollTop = 0; // os passos rolam o menu até o item destacado
  if (voltarFoco && voltarFoco.focus) voltarFoco.focus({ preventScroll: true });
}
function encerrarTutorial(pulou) {
  fecharTutorial();
  window.scrollTo(0, 0);
  if (!usuarioLogado.tutorial_visto) {
    usuarioLogado.tutorial_visto = true;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    api("/api/tutorial/visto", { method: "POST", body: "{}" }).catch(() => { /* neste aparelho já não aparece de novo */ });
  }
  avisar(pulou ? "Tutorial pulado. Para ver depois, use o botão de ajuda no fim do menu." : "Tutorial concluído. Bom uso do S.I.V.E.!");
}
document.getElementById("tutorial-pular").onclick = () => encerrarTutorial(true);
document.getElementById("tutorial-voltar").onclick = () => irParaPasso(tutorial.atual - 1);
document.getElementById("tutorial-proximo").onclick = () => (tutorial.atual === tutorial.passos.length - 1 ? encerrarTutorial(false) : irParaPasso(tutorial.atual + 1));
document.getElementById("btn-tutorial").onclick = seguro(iniciarTutorial);
document.getElementById("tutorial").onkeydown = (e) => {
  e.stopPropagation(); // os atalhos do sistema (como a tecla /) não valem durante o tour
  if (e.key === "Escape") encerrarTutorial(true);
  if (e.key === "ArrowRight") document.getElementById("tutorial-proximo").click();
  if (e.key === "ArrowLeft" && tutorial.atual > 0) irParaPasso(tutorial.atual - 1);
  if (e.key === "Tab") { // o foco fica dentro da caixa
    const botoes = [...document.querySelectorAll("#tutorial-caixa button")].filter((b) => !b.classList.contains("oculto"));
    const i = botoes.indexOf(document.activeElement), n = botoes.length;
    e.preventDefault(); botoes[(i + (e.shiftKey ? n - 1 : 1)) % n].focus();
  }
};
addEventListener("resize", desenharTutorial);
addEventListener("scroll", desenharTutorial, { capture: true, passive: true });

// ---------- Painel de Acessibilidade: texto, contraste, daltonismo, fonte, leitura e voz. Salvo na conta de quem está logado ----------
let timerPreferencias;
const preferenciasAtuais = () => (usuarioLogado && usuarioLogado.acessibilidade) || lerPreferenciasLocais() || {};
function guardarPreferencias(p) {
  if (!usuarioLogado) { try { localStorage.setItem("sive-acessibilidade", JSON.stringify(p)); } catch { /* navegador sem armazenamento: vale só até fechar */ } return; }
  usuarioLogado.acessibilidade = p;
  localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
  clearTimeout(timerPreferencias);
  timerPreferencias = setTimeout(() => api("/api/acessibilidade", { method: "PUT", body: JSON.stringify(p) }).catch((e) => { if (e.message !== "Sessão expirada") avisar("Não foi possível salvar na sua conta. O ajuste vale só neste aparelho.", "warning"); }), 400);
}
// Ao entrar: vale o que está na conta. Conta sem nada salvo herda o que a pessoa já tinha escolhido antes do login.
function preferenciasAoEntrar() {
  const locais = lerPreferenciasLocais();
  if (!usuarioLogado.acessibilidade && locais) guardarPreferencias(locais);
  aplicarPreferencias(preferenciasAtuais());
}
function preencherPainel() {
  const p = preferenciasAtuais(), f = document.getElementById("form-acessibilidade");
  f.elements.texto.value = p.texto || "normal";
  f.elements.contraste.value = contrasteEmUso(p);
  ["daltonismo", "fonte", "espaco", "links", "semMovimento", "voz"].forEach((c) => { f.elements[c].checked = !!p[c]; });
  atualizarAreaVoz();
}
document.getElementById("btn-acessibilidade").onclick = () => { preencherPainel(); document.getElementById("painel-acessibilidade").showModal(); };
document.getElementById("a11y-fechar").onclick = () => document.getElementById("painel-acessibilidade").close();
document.getElementById("painel-acessibilidade").onclick = (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }; // clique fora do painel
document.getElementById("form-acessibilidade").onsubmit = (e) => e.preventDefault();
document.getElementById("form-acessibilidade").onchange = (e) => {
  const f = e.currentTarget, p = { ...preferenciasAtuais(), texto: f.elements.texto.value };
  if (e.target.name === "contraste") p.contraste = f.elements.contraste.value; // sem mexer aqui, continua seguindo o aparelho
  ["daltonismo", "fonte", "espaco", "links", "semMovimento", "voz"].forEach((c) => { p[c] = f.elements[c].checked; });
  if (!p.voz) pararVoz();
  aplicarPreferencias(p); guardarPreferencias(p); atualizarAreaVoz();
  if (p.voz && e.target.name === "voz") { vozAquecida = false; aquecerVoz(); } // ligar a leitura já deixa a voz carregada
};
document.getElementById("a11y-padrao").onclick = () => {
  pararVoz(); aplicarPreferencias({}); guardarPreferencias({}); preencherPainel();
  avisar("Ajustes de acessibilidade desfeitos.");
};

// Leitura em voz alta no jeito do NVDA: lê o que está sob o mouse ou com o foco na hora, interrompe a fala anterior e diz o tipo do elemento. Ctrl interrompe.
// Só com voz instalada no aparelho. As vozes on-line mandariam o texto para fora, e a tela Proteção é sigilosa (e o som é ouvido por quem está perto).
// O que foi digitado nos campos nunca é lido: pode ser senha, e o som é ouvido por quem está perto.
const VELOCIDADE_VOZ = 1.4;
const temVoz = "speechSynthesis" in window;
const vozDoAparelho = () => {
  if (!temVoz) return null;
  const locais = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith("pt"));
  return locais.find((v) => v.lang.toLowerCase() === "pt-br") || locais[0] || null;
};
const vozBloqueada = () => !!usuarioLogado && tela === "protecao";
const vozLigada = () => !!preferenciasAtuais().voz;
// Por que a voz demorava: cada fala nova mandada antes da anterior começar entrava na fila do motor de voz do Windows,
// e passando o mouse por vários itens a fala certa chegava a demorar 3–5 s. Agora só uma fala espera para começar por vez:
// um pedido novo substitui o anterior em vez de entrar na fila. O item que vai ser lido ganha um contorno na hora,
// para a pessoa ver que foi acionado. (O motor de voz do aparelho ainda leva por volta de 1 s para começar a falar: isso é dele.)
let ocupado = false, pendente = null, geracao = 0, vozAquecida = false, lendoAgora = null;
function marcarLendo(el) {
  if (lendoAgora) lendoAgora.classList.remove("lendo-voz");
  lendoAgora = el && el.classList ? el : null;
  if (lendoAgora) lendoAgora.classList.add("lendo-voz");
}
function pararVoz() {
  geracao++; pendente = null; ocupado = false; marcarLendo(null);
  if (temVoz) speechSynthesis.cancel();
}
const novaFala = (texto, voz) => { const fala = new SpeechSynthesisUtterance(texto); fala.voice = voz; fala.lang = voz.lang; fala.rate = VELOCIDADE_VOZ; return fala; };
// Primeiro trecho curto (a voz começa antes) e o resto em trechos de até 180 letras
function dividirTexto(t) {
  t = t.slice(0, 12000);
  const primeiro = (t.match(/^.{1,70}(?:[.!?;:,]\s|\s|$)/) || [t])[0];
  return [primeiro, ...(t.slice(primeiro.length).match(/.{1,180}(?:[.!?;:,]\s|\s|$)/g) || [])].map((x) => x.trim()).filter(Boolean);
}
function falar(texto, alvo = null) {
  const voz = vozDoAparelho(), limpo = String(texto || "").replace(/\s+/g, " ").trim();
  if (!voz || vozBloqueada() || !limpo) return;
  vozAquecida = true;
  marcarLendo(alvo); // retorno na hora, antes mesmo de a voz começar
  pendente = { texto: limpo, voz, alvo };
  if (!ocupado) iniciarFala();
}
function iniciarFala() {
  const p = pendente; pendente = null;
  if (!p) return;
  const minha = ++geracao;
  ocupado = true;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const falas = dividirTexto(p.texto).map((t) => novaFala(t, p.voz));
  let trava;
  const liberar = () => { // a fala começou (ou falhou): libera para o próximo pedido, se houver
    if (minha !== geracao || !ocupado) return;
    ocupado = false; clearTimeout(trava);
    if (pendente) iniciarFala();
  };
  trava = setTimeout(liberar, 4000); // segurança: se o navegador não avisar que começou
  falas[0].onstart = liberar;
  falas[0].onerror = liberar;
  falas[falas.length - 1].onend = () => { if (minha === geracao) marcarLendo(null); };
  falas.forEach((f) => speechSynthesis.speak(f));
}
// O navegador só libera a voz depois de um clique ou tecla: no primeiro, uma fala muda e curta já deixa a voz carregada
function aquecerVoz() {
  const voz = vozDoAparelho();
  if (vozAquecida || !voz || !vozLigada()) return;
  vozAquecida = true;
  const fala = novaFala("ok", voz); fala.volume = 0;
  speechSynthesis.speak(fala);
}
function nomeDoControle(el) {
  const rotulos = (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => document.getElementById(id)).filter(Boolean);
  return el.getAttribute("aria-label") || rotulos.map((r) => r.innerText).join(" ") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText.trim() || el.title || el.placeholder || (el.querySelector("img[alt]") || {}).alt || "";
}
function descreverControle(el) {
  const tag = el.tagName, tipo = (el.getAttribute("type") || "").toLowerCase(), nome = nomeDoControle(el);
  if (tag === "A") return `${nome}, link`;
  if (tag === "BUTTON") return `${nome}, botão`;
  if (tag === "SUMMARY") return `${nome}, botão ${el.parentElement.open ? "expandido" : "recolhido"}`;
  if (tag === "SELECT") return `${nome}, caixa de combinação, ${el.selectedOptions[0] ? el.selectedOptions[0].text : "vazia"}`;
  if (tag === "TEXTAREA") return `${nome}, campo de edição`;
  if (tag !== "INPUT") return "";
  if (tipo === "checkbox") return `${nome}, caixa de seleção, ${el.checked ? "marcada" : "não marcada"}`;
  if (tipo === "radio") return `${nome}, botão de opção, ${el.checked ? "marcado" : "não marcado"}`;
  return `${nome}, ${tipo === "password" ? "campo de senha" : "campo de edição"}`;
}
const CONTROLES = "a,button,summary,select,textarea,input";
function textoParaLer(alvo) {
  if (alvo.matches(CONTROLES)) return descreverControle(alvo);
  if (alvo.matches("label")) return alvo.control ? descreverControle(alvo.control) : alvo.innerText;
  return /^H[1-6]$/.test(alvo.tagName) ? `${alvo.innerText}, título nível ${alvo.tagName[1]}` : alvo.getAttribute("aria-label") || alvo.innerText;
}
const alvoDeLeitura = (el) => (el.closest("[aria-hidden='true']") ? null : el.closest(`${CONTROLES},label`) || el.closest("p,li,h1,h2,h3,h4,td,th") || el.closest("small,b"));
function atualizarAreaVoz() {
  const ligada = !!preferenciasAtuais().voz, aviso = document.getElementById("a11y-voz-aviso"), pode = !!vozDoAparelho() && !vozBloqueada();
  document.getElementById("a11y-voz-area").classList.toggle("oculto", !ligada);
  document.getElementById("a11y-ler").disabled = document.getElementById("a11y-parar").disabled = !pode;
  aviso.textContent = vozBloqueada() ? "A leitura em voz alta fica desligada nesta tela, que é sigilosa."
    : vozDoAparelho() ? "Passe o mouse, use a tecla Tab ou clique em um texto para ouvir. A tecla Ctrl interrompe a leitura." : "Este aparelho não tem voz em português instalada. Instale uma nas configurações de idioma do aparelho.";
}
if (temVoz) speechSynthesis.addEventListener("voiceschanged", atualizarAreaVoz);
document.getElementById("a11y-ler").onclick = () => {
  const principal = [...document.querySelectorAll("main")].find((m) => m.getClientRects().length);
  document.getElementById("painel-acessibilidade").close();
  if (principal) falar(principal.innerText);
};
document.getElementById("a11y-parar").onclick = pararVoz;
["pointerdown", "keydown"].forEach((evento) => document.addEventListener(evento, aquecerVoz, true));
document.addEventListener("keydown", (e) => { if (e.key === "Control" && vozLigada()) pararVoz(); });
document.addEventListener("focusin", (e) => {
  if (vozLigada() && e.target.matches(CONTROLES)) { alvoSobMouse = e.target; falar(descreverControle(e.target), e.target); }
});
let alvoSobMouse = null, timerMouseVoz, mouseX, mouseY;
document.addEventListener("mouseover", (e) => {
  if (!vozLigada() || (e.clientX === mouseX && e.clientY === mouseY)) return; // mouse parado: foi o conteúdo que passou por baixo dele, como a faixa animada
  mouseX = e.clientX; mouseY = e.clientY;
  const alvo = alvoDeLeitura(e.target);
  if (alvo === alvoSobMouse) return;
  alvoSobMouse = alvo; clearTimeout(timerMouseVoz);
  if (alvo) timerMouseVoz = setTimeout(() => falar(textoParaLer(alvo), alvo), 80); // espera só o mouse parar de atravessar a tela
});
document.addEventListener("click", (e) => {
  if (!vozLigada() || e.target.closest(`${CONTROLES},label,dialog`)) return;
  const alvo = alvoDeLeitura(e.target);
  if (alvo) falar(textoParaLer(alvo), alvo);
});

// ---------- Data e hora no cabeçalho (atualiza sozinha a cada segundo) ----------
function atualizarRelogio() {
  const agora = new Date();
  const data = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hora = agora.toLocaleTimeString("pt-BR");
  document.getElementById("data-hora").textContent = data.charAt(0).toUpperCase() + data.slice(1) + " • " + hora;
  document.querySelectorAll(".cam-hora").forEach((el) => { el.textContent = agora.toLocaleDateString("pt-BR") + " " + hora; }); // relógio das câmeras
}
atualizarRelogio();
setInterval(atualizarRelogio, 1000);
