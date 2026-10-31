// S.I.V.E. — versão em HTML, CSS e JavaScript puro
let dados = {};
let tela = "";
let liberada = false;
let timerTela = null;   // atualização automática da tela aberta (monitoramento, status ao vivo)
let timerBanner = null; // troca automática dos banners
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
  const resposta = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(usuarioLogado ? { Authorization: "Bearer " + usuarioLogado.token, ...cabecalhoContexto() } : {}) },
    ...opcoes,
  });
  if (resposta.status === 401 || resposta.status === 403) {
    const corpo = await resposta.json().catch(() => ({}));
    if (resposta.status === 401) { sair(); throw new Error("Sessão expirada"); }
    if (corpo.codigo === "ACEITE_PENDENTE") { usuarioLogado.aceite_ok = false; mostrarTermo("aceitar"); throw new Error("Aceite pendente"); }
    if (corpo.codigo === "2FA_PENDENTE") { usuarioLogado.configurar_2fa = true; mostrarTela2fa(); throw new Error("Aceite pendente"); }
    throw new Error(corpo.erro || "Acesso negado");
  }
  if (!resposta.ok) { const corpo = await resposta.json().catch(() => ({})); throw Object.assign(new Error(corpo.erro || "Falha na API"), { codigo: corpo.codigo, alunos: corpo.alunos }); }
  return resposta.json();
}
// Usado nos botões: se a API der erro, avisa na tela em vez de falhar em silêncio
const seguro = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { if (e.message !== "Sessão expirada" && e.message !== "Aceite pendente") alert(e.message); }
};

const menusPorPapel = {
  admin: [
    { id: "secretaria", nome: "Central do Dia", dica: "Secretaria", icone: "casa" },
    { id: "cadastro", nome: "Cadastro de Aluno", dica: "Novo aluno", icone: "novoAluno" },
    { id: "frequencia", nome: "Frequência", dica: "Presença e faltas", icone: "presenca" },
    { id: "seguranca", nome: "Monitoramento", dica: "Segurança", icone: "olho" },
    { id: "busca", nome: "Busca Ativa", dica: "Faltas e acompanhamento", icone: "lupa" },
    { id: "protecao", nome: "Proteção", dica: "Conselho Tutelar", icone: "escudo" },
    { id: "relatorio", nome: "Relatório Mensal", dica: "Frequência e casos", icone: "grafico" },
    { id: "comunicados", nome: "Comunicados", dica: "Avisos e leituras", icone: "megafone" },
    { id: "calendario", nome: "Calendário", dica: "Eventos e banners", icone: "calendario" },
    { id: "autorizacoes", nome: "Autorizações", dica: "Assinatura digital", icone: "caneta" },
    { id: "consentimentos", nome: "Consentimentos", dica: "Imagem e informações", icone: "termo" },
    { id: "usuarios", nome: "Usuários", dica: "Acessos ao sistema", icone: "cadeado" },
    { id: "logs", nome: "Logs", dica: "Atividade do sistema", icone: "atividade" },
  ],
  pai: [
    { id: "pais", nome: "Portal dos Pais", dica: "Meu filho", icone: "familia" },
    { id: "ocorrencias", nome: "Ocorrências", dica: "Registros do professor", icone: "prancheta" },
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
  sair: { anim: "anda", svg: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>' },
};
// <svg> com os atributos de traço no próprio elemento: funciona também nos comprovantes abertos em outra janela (sem o CSS do sistema)
const ico = (nome, extra = "") => { const i = ICONES[nome];
  return `<svg class="ico${extra ? " " + extra : ""}" data-anim="${i.anim}" viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.svg}</svg>`; };
const iconeMenu = (nome) => `<span class="nav-icone">${ico(nome)}</span>`;
// Ícones escritos direto no index.html (<span data-ico="nome">) são desenhados aqui
document.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = ico(el.dataset.ico); });

// ---------- Página de apresentação (antes do login) ----------
document.getElementById("lp-ano").textContent = new Date().getFullYear();
// Títulos, textos e cards aparecem quando entram na tela, vindos de direções diferentes. Sem suporte ao observador, aparecem de uma vez.
(() => {
  document.querySelectorAll(".lp-secao .lp-sobretitulo, .lp-secao .lp-titulo, .lp-texto, .lp-nota-centro, .lp-faq, .lp-selos > div, .lp-chamada .lp-faixa > *")
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
// Faixa de recursos: o conteúdo é duplicado para correr sem emenda
(() => { const t = document.querySelector(".lp-ticker-trilho"); t.innerHTML += t.innerHTML; })();
// Palavra que se troca no título principal
(() => {
  const el = document.getElementById("lp-troca"), frases = ["segura e conectada", "organizada", "acompanhada de perto", "protegida"];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let i = 0;
  setInterval(() => {
    if (!homeVisivel()) return; // só anima com o site à vista
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
    links.forEach((a) => a.classList.toggle("ativo", a === atual));
  };
  addEventListener("scroll", aoRolar, { passive: true });
  aoRolar();
})();
// Os links "Entrar" (#entrar) abrem a página de login, que tem só o usuário e a senha. Qualquer outro endereço mostra o site.
// Usa o endereço da página, então o botão "voltar" do navegador também volta para o site.
function homeVisivel() { return document.getElementById("lp-home").offsetParent !== null; }
const codigoNaUrl = () => new URLSearchParams(location.search).get("verificar"); // ?verificar=CÓDIGO (link do QR code)
function mostrarPaginaInicial() {
  const verificar = location.hash === "#verificar" || codigoNaUrl() !== null;
  const login = !verificar && location.hash === "#entrar";
  document.getElementById("lp-home").classList.toggle("oculto", login || verificar);
  document.getElementById("lp-entrar").classList.toggle("oculto", !login);
  document.getElementById("lp-verificar").classList.toggle("oculto", !verificar);
  if (verificar) {
    window.scrollTo(0, 0);
    if (codigoNaUrl()) { document.getElementById("ver-codigo").value = codigoNaUrl(); conferirAssinatura(); }
    else document.getElementById("ver-codigo").focus();
    return;
  }
  if (login) { window.scrollTo(0, 0); document.getElementById("login-usuario").focus(); return; }
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
    ${r.assinante ? `<div class="tabela" style="margin-top:12px"><table style="min-width:0">${linha("Documento", esc(r.documento))}${linha("Assinado por", `${esc(r.assinante)} <small style="display:inline">(${esc(r.papel)})</small>`)}
      ${linha("Data e hora", esc(r.assinada_em))}${linha("Como foi assinado", esc(r.metodo))}${linha("Código", `<b>${esc(r.codigo)}</b>`)}
      ${linha("Impressão digital do conteúdo (SHA-256)", `<small style="word-break:break-all;font-family:monospace">${esc(r.hash)}</small>`)}</table></div>` : ""}</div>`;
}
document.getElementById("form-verificar").onsubmit = (e) => { e.preventDefault(); conferirAssinatura(); };

addEventListener("hashchange", mostrarPaginaInicial);
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
  secretaria: "Central do Dia", seguranca: "Monitoramento", pais: "Portal dos Pais", calendario: "Calendário Escolar", perfil: "Meu Perfil",
  frequencia: "Controle de Frequência", busca: "Busca Ativa", relatorio: "Relatório Mensal",
  cadastro: "Cadastro de Aluno", usuarios: "Usuários do Sistema", logs: "Logs de Atividade", turma: "Minha Turma",
  ficha: "Ficha do Aluno", ocorrencias: "Ocorrências", comunicados: "Comunicados", autorizacoes: "Autorizações Digitais", consentimentos: "Consentimento dos Responsáveis", protecao: "Proteção da Criança",
};
const papelLabel = (p) => ({ admin: "Gestão", pai: "Responsável", professor: "Professor(a)", sistema: "Sistema" }[p] || p);
const acaoLabel = (a) => ({
  login_sucesso: "Login", login_falha: "Tentativa de login falhou", logout: "Saiu do sistema", login_codigo_errado: "Errou o código das duas etapas",
  "2fa_ativada": "Ativou a verificação em duas etapas", "2fa_zerada": "Zerou a verificação em duas etapas de um usuário", backup_feito: "Backup automático feito", backup_falhou: "Backup automático falhou",
  logs_apagados: "Apagou logs antigos (prazo de guarda)", turma_criada: "Criou turma", turma_alterada: "Alterou turma", aluno_situacao: "Mudou a situação do aluno",
  responsavel_vinculado: "Ligou aluno a um responsável", responsavel_desvinculado: "Desligou aluno de um responsável", professor_turmas: "Alterou as turmas do professor", cadastro_aluno: "Cadastrou aluno",
  cadastro_usuario: "Cadastrou usuário", troca_senha: "Trocou a senha", autorizacao_alternada: "Alterou autorização",
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
  inativado_por_inatividade: "Inativou professor (60 dias sem acesso)", reativacao_solicitada: "Pediu reativação do acesso",
  perfil_atualizado: "Atualizou o perfil", evento_criado: "Criou evento no calendário", evento_excluido: "Excluiu evento do calendário",
  entrada_manual: "Registrou entrada pela portaria", saida_manual: "Registrou saída pela portaria", reconhecimento_simulado: "Simulou reconhecimento facial",
  facial_ligado: "Ligou o reconhecimento facial", facial_desligado: "Desligou o reconhecimento facial", camera_cadastrada: "Cadastrou câmera",
  camera_ligada: "Ligou câmera", camera_desligada: "Desligou câmera", reconhecimentos_apagados: "Apagou passagens antigas das câmeras (90 dias)",
}[a] || a);

const pill = (texto, tom) => `<span class="pill ${tom}">${texto}</span>`;
const iniciais = (nome) => nome.split(" ").slice(0, 2).map((n) => n[0]).join("");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataCurta = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const pct = (v) => (v == null ? "—" : String(v).replace(".", ",") + "%");
const calcPct = (p, a) => ((p + a) ? Math.round(p * 1000 / (p + a)) / 10 : null);
const saudacao = () => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

// ---------- Login ----------
document.getElementById("form-login").onsubmit = async (e) => {
  e.preventDefault();
  const erroBox = document.getElementById("login-erro");
  erroBox.classList.add("oculto");
  try {
    const usuario = document.getElementById("login-usuario").value.trim();
    const senha = document.getElementById("login-senha").value;
    const caixaCodigo = document.getElementById("login-2fa"), codigo = document.getElementById("login-codigo").value.trim();
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha, codigo: caixaCodigo.classList.contains("oculto") ? undefined : codigo }),
    });
    const dadosLogin = await r.json();
    if (!r.ok) throw new Error(dadosLogin.erro || "Não foi possível entrar");
    if (dadosLogin.precisa_codigo) { // senha certa e conta com duas etapas: pede o código do aplicativo
      caixaCodigo.classList.remove("oculto");
      document.getElementById("login-codigo").focus();
      throw new Error("Digite o código de 6 números do aplicativo autenticador.");
    }
    caixaCodigo.classList.add("oculto"); document.getElementById("login-codigo").value = "";
    usuarioLogado = dadosLogin;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    await telaCarregando();
    seguirLogin();
  } catch (erro) {
    erroBox.textContent = erro.message;
    erroBox.classList.remove("oculto");
  }
};
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
  clearInterval(timerTela); clearInterval(timerBanner);
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
  const telaInicial = { admin: "secretaria", pai: "pais", professor: "turma" }[usuarioLogado.papel];
  atualizarContexto().finally(() => mostrar(telaInicial));
}
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
    if (u.papel === "pai") u.aluno_id = Number(sel.value); else u.sala = sel.value;
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
async function mostrarConsentimento(modo) { // modo "primeiro" (logo após o login) ou "alterar" (pelo Portal dos Pais)
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
  $("cons-nome").value = ""; $("cons-senha").value = ""; $("cons-erro").classList.add("oculto");
}
document.getElementById("form-consent").onsubmit = async (e) => {
  e.preventDefault();
  const $ = (id) => document.getElementById(id), erro = $("cons-erro");
  erro.classList.add("oculto");
  const escolhas = {};
  document.querySelectorAll("#cons-opcoes input").forEach((c) => { escolhas[c.dataset.opcao] = c.checked; });
  if (!Object.values(escolhas).some(Boolean) && !confirm("Você não está autorizando nenhum item. Confirma que NÃO autoriza?")) return;
  try {
    await api(`/api/alunos/${usuarioLogado.aluno_id}/consentimento`, { method: "POST", body: JSON.stringify({ ...escolhas, nome: $("cons-nome").value, senha: $("cons-senha").value }) });
    $("cons-nome").value = ""; $("cons-senha").value = "";
    $("tela-consent").classList.add("oculto");
    entrarNoApp();
  } catch (err) { if (err.message !== "Sessão expirada") { erro.textContent = err.message; erro.classList.remove("oculto"); } }
};
// cartão do Portal dos Pais
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
  return `<div style="display:flex;gap:16px;align-items:center;border:1px solid #EAD6CA;border-radius:8px;padding:12px;margin:16px 0">
    <img src="${location.origin}/api/verificar/${encodeURIComponent(codigo)}/qr.svg" width="120" height="120" alt="QR code para verificar a assinatura">
    <div><b>Confira a autenticidade</b><br>Leia o QR code ou acesse:<br><span style="word-break:break-all">${esc(endereco)}</span><br>
    <small style="color:#5B5278">Assinatura eletrônica confirmada com senha e protegida por selo criptográfico (Ed25519) do sistema. Qualquer alteração no documento depois da assinatura é detectada na verificação.</small></div></div>`;
}
async function abrirComprovanteConsentimento(c, aluno) {
  const w = window.open("", "_blank");
  if (!w) { alert("Permita pop-ups neste site para ver o comprovante."); return; }
  const termo = await (await fetch("/api/consentimento-termo")).json();
  const linhas = termo.opcoes.map((o) => `<tr><td>${esc(o.curto)}</td><td><b>${c[o.id] ? ico("confere") + " Autorizo" : ico("proibido") + " Não autorizo"}</b></td></tr>`).join("");
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante ${esc(c.codigo)}</title>
    <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#140040}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:10px;border-bottom:1px solid #EAD6CA}td:first-child{color:#5B5278;width:48%}.cod{font-size:20px;letter-spacing:2px;font-weight:700}@media print{button{display:none}}</style></head><body>
    <h1>${ico("escudoOk")} S.I.V.E. — Comprovante de consentimento</h1>
    <table><tr><td>Termo</td><td>${esc(termo.titulo)} (versão ${esc(c.versao || termo.versao)})</td></tr>
    <tr><td>Aluno(a)</td><td>${esc(aluno.nome)} — ${esc(aluno.sala)}</td></tr><tr><td>Assinado por</td><td>${esc(c.assinado_nome)}</td></tr>
    <tr><td>Data e hora</td><td>${esc(c.assinado_em)}</td></tr><tr><td>Código de verificação</td><td class="cod">${esc(c.codigo)}</td></tr></table>
    <h3>Escolhas do responsável</h3><table>${linhas}</table>
    ${blocoVerificacao(c.codigo)}<p>Documento gerado pelo sistema S.I.V.E. O consentimento foi confirmado com o nome completo e a senha do responsável e pode ser alterado ou revogado a qualquer momento no Portal dos Pais.</p><button id="imprimir">Imprimir</button></body></html>`);
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
  return `<div class="topo"><h2>Consentimento dos responsáveis</h2><small>Uso de imagem e informações dos alunos (termo versão ${esc(dados.consents.versao)}). Cada responsável assina pelo Portal dos Pais.</small></div>
  <section class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${resumo}</div>
  <div class="tabela"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Situação</th><th>Informações</th><th>Imagens</th><th>Câmeras</th><th>Assinado por</th></tr></thead><tbody>${linhas}</tbody></table></div></section>`;
}

// ---------- Proteção da criança: comunicações ao Conselho Tutelar (ECA arts. 13 e 56; LDB art. 12, VIII) ----------
const motivosProtecao = { "Maus-tratos": "Suspeita ou confirmação de maus-tratos", Faltas: "Faltas reiteradas / evasão escolar", Outro: "Outro motivo de proteção" };
const hojeLocalISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function telaProtecao() {
  const ehAdmin = usuarioLogado.papel === "admin", p = dados.protecao;
  const motivos = (ehAdmin ? ["Maus-tratos", "Faltas", "Outro"] : ["Maus-tratos", "Outro"]).map((m) => `<option value="${m}">${motivosProtecao[m]}</option>`).join("");
  const alunos = dados.alunosProtecao.map((a) => `<option value="${a.id}">${esc(a.nome)}${a.sala ? " — " + esc(a.sala) : ""}</option>`).join("");
  const msg = dados.protecaoMsg || ""; dados.protecaoMsg = "";
  return `<div class="topo"><h2>Proteção da criança</h2><small>Comunicações ao Conselho Tutelar e registros sigilosos.</small></div>
  <section class="card" style="margin-bottom:16px"><b>Por que esta tela existe</b>
    <small>• <b>ECA, art. 13:</b> casos de suspeita ou confirmação de maus-tratos devem ser comunicados ao Conselho Tutelar. Deixar de comunicar é infração administrativa (art. 245).</small>
    <small>• <b>ECA, art. 56:</b> o dirigente da escola comunica ao Conselho Tutelar os maus-tratos e as faltas reiteradas ou a evasão, depois de esgotados os recursos da escola.</small>
    <small>• <b>Sigilo:</b> estes registros não aparecem para os responsáveis nem para outros professores. Cada consulta e cada registro ficam nos logs.</small></section>
  ${ehAdmin && p.pendentes ? `<p class="pill danger" style="white-space:normal;margin-bottom:14px">${ico("aviso")} ${p.pendentes} registro(s) aguardando a comunicação ao Conselho Tutelar.</p>` : ""}
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  <form id="form-protecao" class="card" style="margin-bottom:16px;max-width:760px">
    <b>Registrar um caso</b>
    <div class="grade dois" style="margin-top:10px"><div><small>Aluno</small><select id="pro-aluno" required><option value="">Escolha o aluno...</option>${alunos}</select></div>
      <div><small>Motivo</small><select id="pro-motivo">${motivos}</select></div></div>
    <div style="margin-top:10px"><small>Fatos observados (o que viu ou ouviu, quando e onde; sem julgamentos)</small><textarea id="pro-descricao" rows="4" maxlength="1500" required></textarea></div>
    <div style="margin-top:10px"><small>Medidas já adotadas pela escola (opcional)</small><textarea id="pro-medidas" rows="2" maxlength="1500"></textarea></div>
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
      <div>${pill(motivosProtecao[i.motivo], i.motivo === "Maus-tratos" ? "danger" : "warning")} ${i.pendente ? pill(`Pendente de comunicação${i.dias_registro ? " há " + i.dias_registro + " dia(s)" : ""}`, "danger") : pill("Comunicado ao Conselho Tutelar", "success")}</div>
    </div>
    <div class="nota"><small><b>Fatos</b></small>${esc(i.descricao)}</div>
    ${i.medidas ? `<div class="nota"><small><b>Medidas adotadas pela escola</b></small><span style="white-space:pre-line">${esc(i.medidas)}</span></div>` : ""}
    ${i.pendente
      ? (ehAdmin ? `<div class="grade dois" style="margin-top:10px"><div><small>Data em que comunicou ao Conselho Tutelar</small><input type="date" data-ct-data="${i.id}" value="${hojeLocalISO()}" max="${hojeLocalISO()}"></div>
          <div><small>Protocolo ou nº do ofício (se houver)</small><input data-ct-protocolo="${i.id}" maxlength="60"></div></div>
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
      ${l.alunos.length ? `<div class="tabela"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Dias com chamada</th><th>Faltas</th><th>%</th><th>Conselho Tutelar</th></tr></thead><tbody>${l.alunos.map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${a.dias}</td><td>${a.faltas}</td><td>${pill(virgula(a.percentual) + "%", "danger")}</td><td>${a.comunicado ? pill("Comunicado", "success") : pill("Ainda não comunicado", "warning")}</td></tr>`).join("")}</tbody></table></div>`
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
  if (nova !== confirmar) { erroBox.textContent = "As senhas não coincidem"; erroBox.classList.remove("oculto"); return; }
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

// ---------- Verificação em duas etapas (gestão): configurar o aplicativo autenticador ----------
async function mostrarTela2fa() {
  const $ = (id) => document.getElementById(id);
  ["tela-login", "tela-senha", "tela-termo", "app"].forEach((id) => $(id).classList.add("oculto"));
  $("tela-2fa").classList.remove("oculto");
  $("dois-erro").classList.add("oculto"); $("dois-codigo").value = "";
  try {
    const r = await api("/api/2fa/novo", { method: "POST", body: "{}" });
    $("dois-qr").innerHTML = r.qr; // SVG gerado pelo próprio servidor
    $("dois-segredo").textContent = r.segredo.match(/.{1,4}/g).join(" ");
    $("dois-codigo").focus();
  } catch (e) { if (e.message !== "Sessão expirada") mostrarErro("dois-erro", e.message); }
}
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

// ---------- Histórico de presença (usado pelo Portal dos Pais e pela Frequência) ----------
function blocoHistorico(h) {
  const estat = (rotulo, valor) => `<div class="card" style="padding:12px;text-align:center"><small>${rotulo}</small><b style="font-size:22px;display:block">${valor}</b></div>`;
  const lista = h.registros.length
    ? h.registros.map((r) => `<div class="hist ${r.status === "Ausente" ? "ausente" : ""}"><span class="ponto"></span><div><b style="font-size:14px">${dataCurta(r.data)}</b><small>${esc(r.observacao)}</small></div>${pill(r.status, r.status === "Presente" ? "success" : "warning")}</div>`).join("")
    : `<div class="vazio"><small>Nenhum registro nos últimos ${h.dias} dias.</small></div>`;
  return `<div class="grade g3" style="margin:12px 0">${estat("Frequência", pct(h.percentual))}${estat("Presenças", h.presencas)}${estat("Faltas", h.faltas)}</div><div class="rolagem">${lista}</div>`;
}

// ---------- Tela da Secretaria ----------
function metrica(icone, rotulo, valor, nota, tom, tag) {
  return `<article class="card metrica"><div class="linha"><div class="icone ${tom}">${icone}</div><small>${tag}</small></div>
    <small>${rotulo}</small><div class="num">${valor}</div><small>${nota}</small></article>`;
}
function alerta(icone, n, titulo, texto, tom, ir) {
  return `<button class="card alerta" ${ir ? `data-ir="${ir}"` : ""}><div class="icone ${tom}">${icone}</div><div><b>${titulo}</b><small>${texto}</small></div><span class="num">${n}</span></button>`;
}
function telaSecretaria() {
  const r = dados.resumo;
  const tag = r.eh_hoje ? "Hoje" : dataCurta(r.data);
  const aviso = r.eh_hoje ? "" : ` Mostrando o último dia com chamada registrada (${dataCurta(r.data)}).`;
  return `<div class="topo"><p class="destaque">Visão geral</p><h2>${saudacao()}, ${esc(usuarioLogado.nome.split(" ")[0])}</h2><small>Acompanhe os indicadores e prioridades da escola.${aviso}</small></div>
  ${blocoBanners()}
  ${r.professores_inativos ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning)"><div class="linha" style="flex-wrap:wrap;gap:8px"><b>${ico("pessoa")} ${r.professores_inativos} professor(es) inativado(s) por ${r.inatividade_dias} dias sem acessar${r.reativacoes_pedidas ? ` • ${r.reativacoes_pedidas} pediu(ram) reativação` : ""}</b><button class="btn pequeno" data-ir="usuarios" style="width:auto">Ver em Usuários</button></div><small>O acesso é suspenso sozinho depois de ${r.inatividade_dias} dias sem uso. A gestão reativa com uma senha provisória nova.</small></div>` : ""}
  ${r.comunicacoes_pendentes ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)"><div class="linha" style="flex-wrap:wrap;gap:8px"><b>${ico("aviso")} ${r.comunicacoes_pendentes} comunicação(ões) ao Conselho Tutelar pendente(s)</b><button class="btn pequeno" data-ir-protecao style="width:auto">Abrir Proteção</button></div><small>O ECA (arts. 13 e 56) pede que casos de maus-tratos e de faltas reiteradas sejam comunicados ao Conselho Tutelar.</small></div>` : ""}
  <div class="grade g3">
    ${metrica(ico("familia"), "Total de Alunos", r.total_alunos, "alunos cadastrados", "info", "Escola")}
    <article class="card metrica"><div class="linha"><div class="icone success">${ico("confere")}</div><small>${tag}</small></div>
      <small>Presentes e ausentes</small>
      <div class="linha" style="gap:24px;align-items:flex-end;justify-content:flex-start;flex-wrap:wrap">
        <div><div class="num">${r.presentes}</div><small>${ico("confere", "ok")} Presentes</small></div>
        <div><div class="num">${r.ausentes}</div><small>${ico("aviso")} Ausentes • ${r.busca_ativa} em Busca Ativa</small></div>
      </div>
      <small>${r.percentual == null ? "Sem chamada registrada" : `${pct(r.percentual)} de presença`}</small></article>
    <button type="button" class="card metrica clicavel" data-ir="ocorrencias-gestao" title="Abrir a pasta de ocorrências">
      <div class="linha"><div class="icone info">${ico("prancheta")}</div><small>${ico("pasta")} Abrir pasta</small></div>
      <small>Ocorrências</small><div class="num" id="oc-gestao-num">${r.ocorrencias_gestao}</div>
      <small id="oc-gestao-nota">${notaOcorrenciasGestao(r.ocorrencias_gestao, r.ocorrencias_sem_resp)}</small></button>
  </div>
  <div class="topo"><h2>Atenção necessária</h2><small>Pendências que precisam de acompanhamento.</small></div>
  <div class="grade g3">
    ${alerta(ico("aviso"), r.busca_ativa, "Crianças em busca ativa", "Por excesso de faltas", "danger", "busca")}
    ${alerta(ico("pasta"), r.documentos_recentes, "Documentos recebidos recentemente", "Enviados pelos responsáveis (24h)", "warning", "docs-recentes")}
    ${alerta(ico("caneta"), r.autorizacoes_recentes, "Autorizações recebidas recentemente", "Assinadas nas últimas 24h", "info", "autorizacoes")}
  </div>
  <section class="card"><div class="linha" style="flex-wrap:wrap;gap:12px"><div><h2>Gestão de alunos</h2><small>Clique nos títulos para ordenar e abra a ficha de cada aluno.</small></div>
    <div class="linha" style="gap:16px;flex-wrap:wrap;justify-content:flex-end">
      <select id="g-filtro" style="width:auto"><option value="todos">Todos os alunos</option><option value="pendencias">Com pendências</option><option value="aut">Autorização pendente</option><option value="comunicados">Comunicado não lido</option><option value="adv">Com advertências</option></select>
      <input id="busca" class="campo-busca" placeholder="Buscar aluno..." style="width:240px;max-width:100%"></div></div>
    <div class="tabela"><table><thead><tr>
      <th class="ord" data-ord="nome">Nome da criança <span class="seta"></span></th><th class="ord" data-ord="novos">Comunicados <span class="seta"></span></th>
      <th class="ord" data-ord="aut">Autorizações <span class="seta"></span></th><th class="ord" data-ord="pend">Pendências <span class="seta"></span></th>
      <th class="ord" data-ord="adv">Ações e advertências <span class="seta"></span></th><th></th></tr></thead>
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
    <div class="linha" style="flex-wrap:wrap;gap:8px">
      <div class="aluno"><span class="avatar">${iniciais(o.aluno_nome)}</span><div><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario} • Prof. ${esc(o.professor_nome)}</small></div></div>
      ${pillAssinaturaGestao(o)}</div></button>`;
  const desenharLista = () => {
    $("modal-oc-titulo").innerHTML = `${ico("pasta")} Ocorrências`;
    const pendentes = lista.filter((o) => !o.ges_assinada_em), registradas = lista.filter((o) => o.ges_assinada_em);
    conteudo.innerHTML = `<small style="margin:4px 0 12px">Ocorrências registradas pelos professores. Clique em uma para ler e assinar. Depois da assinatura da gestão, ela passa para “Ocorrências registradas”.</small>
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
      ${seloAssinatura("Registrado e assinado pelo professor", o.professor_nome, o.assinada_em, o.codigo)}
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
  const lista = dados.gestao.filter((a) => a.nome.toLowerCase().includes(busca) && filtrosGestao[dados.filtroGestao](a))
    .sort((x, y) => { const a = chaveOrdem[campo](x), b = chaveOrdem[campo](y); return (a > b ? 1 : a < b ? -1 : x.nome.localeCompare(y.nome)) * dir; });
  document.querySelectorAll("th.ord").forEach((th) => { th.querySelector(".seta").textContent = th.dataset.ord === campo ? (dir === 1 ? "▲" : "▼") : ""; });
  document.getElementById("linhas").innerHTML = lista.length ? lista.map((a) => {
    const novos = a.com_total - a.com_lidos;
    const tipos = a.pend_tipos ? a.pend_tipos.split(",") : [];
    const pendencias = (a.aut_pendentes > 0 ? pill("Autorização", "info") + " " : "") + tipos.map((t) => pill(t, "danger")).join(" ");
    const ocorr = (a.advertencias ? pill(`${a.advertencias} advertência(s)`, "danger") + " " : "") + (a.acoes ? pill(`${a.acoes} ação(ões)`, "info") : "");
    return `<tr>
      <td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${esc(a.nome)}</b><small>${esc(a.sala)}</small></div></div></td>
      <td>${novos > 0 ? pill(`${novos} novo(s)`, "warning") : pill("Em dia", "success")}<small>${a.com_lidos} lido(s)</small></td>
      <td>${a.aut_pendentes > 0 ? pill(`${a.aut_pendentes} pendente(s)`, "warning") : a.aut_assinadas > 0 ? pill("Em dia", "success") : pill("Nenhuma", "neutral")}</td>
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
  <div class="grade g3" id="freq-cards"></div>
  <section class="card">
    <div class="linha" style="flex-wrap:wrap;align-items:flex-end;gap:12px">
      <div><small>Data</small><input type="date" id="freq-data" style="max-width:200px"></div>
      <input id="freq-busca" class="campo-busca" placeholder="Buscar aluno..." style="max-width:280px">
    </div>
    <div class="tabela"><table><thead><tr><th>Aluno</th><th>Situação</th><th>Observação</th><th>Faltas (30 dias)</th><th></th></tr></thead>
    <tbody id="freq-linhas"></tbody></table></div>
  </section>
  <section class="card oculto" id="freq-hist" style="margin-top:20px"></section>`;
}
function desenharFrequencia() {
  const f = dados.freq;
  document.getElementById("freq-data").value = f.data;
  const tag = f.eh_hoje ? "Hoje" : dataCurta(f.data);
  document.getElementById("freq-cards").innerHTML =
    metrica(ico("familia"), "Total de Alunos", f.total, "alunos cadastrados", "info", tag) +
    metrica(ico("confere"), "Presentes", f.presentes, f.presentes + f.ausentes ? `${pct(calcPct(f.presentes, f.ausentes))} de presença` : "Sem chamada neste dia", "success", tag) +
    metrica(ico("proibido"), "Ausentes", f.ausentes, "faltas no dia", "danger", tag);
  const filtro = document.getElementById("freq-busca").value.toLowerCase();
  document.getElementById("freq-linhas").innerHTML = f.alunos.filter((a) => a.nome.toLowerCase().includes(filtro)).map((a) => `<tr>
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
      <textarea rows="3" maxlength="1500" data-ct-fatos="${c.id}" style="margin-top:6px">Aluno com ${c.faltas_atuais} faltas nos últimos ${dados.busca.criterio.dias} dias, em acompanhamento pela Busca Ativa desde ${c.aberta_em}.</textarea>
      <label class="termo-aceite"><input type="checkbox" data-ct-esgotei="${c.id}"> <span>Os recursos da escola foram esgotados (as ações estão registradas acima).</span></label>
      <p class="pill danger oculto" data-ct-erro="${c.id}" style="white-space:normal;margin-top:8px"></p>
      <div class="acoes"><button class="btn pequeno" data-ct-enviar="${c.id}">Registrar comunicação</button><button class="btn outline pequeno" data-ct-cancelar="${c.id}">Cancelar</button></div>
    </div>`;
}
function cartaoCaso(c) {
  const aberto = c.status === "Em acompanhamento";
  return `<article class="card" style="margin-bottom:16px">
    <div class="linha" style="flex-wrap:wrap;gap:8px">
      <div class="aluno"><span class="avatar">${iniciais(c.nome)}</span><div><b>${esc(c.nome)}</b><small>${esc(c.sala)} • aberto em ${c.aberta_em}${c.encerrada_em ? " • encerrado em " + c.encerrada_em : ""}</small></div></div>
      <div>${pill(aberto ? "Em acompanhamento" : "Resolvido", aberto ? "danger" : "success")} ${pill(`${c.faltas_atuais} faltas em ${dados.busca.criterio.dias} dias`, "warning")}</div>
    </div>
    <div style="margin-top:8px">${c.registros.map((r) => `<div class="nota ${r.nome_usuario === "Sistema" ? "sistema" : ""}"><small><b>${esc(r.nome_usuario)}</b> • ${r.quando}</small>${esc(r.texto)}</div>`).join("")}</div>
    ${aberto ? `<textarea rows="2" maxlength="450" data-nota="${c.id}" placeholder="Anote o acompanhamento (ligação, visita, conversa com a família...)" style="margin-top:8px"></textarea>
      <div class="acoes"><button class="btn pequeno" data-anotar="${c.id}">Registrar acompanhamento</button><button class="btn outline pequeno" data-encerrar="${c.id}">Encerrar caso</button></div>` : ""}
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
    await recarregar();
  }));
  document.querySelectorAll("[data-encerrar]").forEach((b) => b.onclick = seguro(async () => {
    if (!confirm("Encerrar este caso de Busca Ativa?")) return;
    const texto = document.querySelector(`[data-nota="${b.dataset.encerrar}"]`).value;
    await api(`/api/busca-ativa/${b.dataset.encerrar}/encerrar`, { method: "PUT", body: JSON.stringify({ texto }) });
    await recarregar();
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
    <div><small>Mês</small><input type="month" id="rel-mes" style="max-width:200px"></div>
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
      <div class="tabela"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Presenças</th><th>Faltas</th><th>Frequência</th></tr></thead>
      <tbody>${r.alunos.map((a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${a.presencas}</td><td>${a.faltas}</td>
        <td>${pill(pct(a.percentual), a.percentual == null ? "neutral" : a.percentual < 75 ? "danger" : a.percentual < 90 ? "warning" : "success")}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card" style="margin-top:20px"><h2>Busca Ativa no mês</h2>
      <small>${b.abertos_no_mes} caso(s) aberto(s) • ${b.encerrados_no_mes} encerrado(s) • ${b.em_acompanhamento} ainda em acompanhamento</small>
      ${b.casos.length ? b.casos.map((k) => `<div style="margin-top:16px"><b>${esc(k.nome)}</b> <small style="display:inline">(${esc(k.sala)})</small> ${pill(k.status, k.status === "Resolvido" ? "success" : "danger")}
        <small>Aberto em ${k.aberta_em}${k.encerrada_em ? " • encerrado em " + k.encerrada_em : ""}</small>
        ${k.registros.map((n) => `<div class="nota ${n.nome_usuario === "Sistema" ? "sistema" : ""}"><small><b>${esc(n.nome_usuario)}</b> • ${n.quando}</small>${esc(n.texto)}</div>`).join("")}</div>`).join("")
        : `<div class="vazio"><small>Nenhum caso de Busca Ativa neste mês.</small></div>`}
    </section>`;
}
function ligarRelatorio() {
  document.getElementById("rel-mes").onchange = seguro(async (e) => {
    if (!e.target.value) return;
    dados.relatorio = await api("/api/relatorio-mensal?mes=" + e.target.value);
    desenharRelatorio();
  });
  document.getElementById("rel-imprimir").onclick = () => window.print();
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
  const reiniciar = () => { clearInterval(timerBanner); if (slides.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) timerBanner = setInterval(() => ir(atual + 1), 6000); };
  pontos.forEach((p) => p.onclick = () => { ir(Number(p.dataset.ponto)); reiniciar(); });
  caixa.querySelectorAll("[data-ver-evento]").forEach((b) => b.onclick = () => { dados.calMes = b.dataset.verEvento.slice(0, 7); dados.calDia = b.dataset.verEvento; mostrar("calendario"); });
  reiniciar();
}

// ---------- Calendário ----------
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const eventosDoDia = (iso) => dados.cal.eventos.filter((e) => e.data <= iso && iso <= (e.data_fim || e.data));
function cartaoEvento(e) {
  return `<div class="item evento">
    ${e.tem_banner ? `<img class="evento-img" data-banner-img="${e.id}" alt="Banner do evento ${esc(e.titulo)}">` : ""}
    <div class="linha" style="gap:8px;flex-wrap:wrap;align-items:flex-start"><div><b>${esc(e.titulo)}</b><small>${ico("calendario")} ${quandoEvento(e)}${e.local ? " • " + ico("local") + " " + esc(e.local) : ""}</small></div>
      <div>${pill(esc(e.tipo), tomTipo[e.tipo] || "info")} ${pill(e.sala ? esc(e.sala) : "Escola toda", "neutral")}${e.destaque ? " " + pill("Banner", "info") : ""}</div></div>
    ${e.descricao ? `<p style="margin-top:8px">${esc(e.descricao)}</p>` : ""}
    <small style="margin-top:6px">Criado por ${esc(e.criado_por_nome)}</small>
    ${e.pode_excluir ? `<div class="acoes"><button class="btn outline pequeno" data-excluir-evento="${e.id}" data-titulo="${esc(e.titulo)}">${ico("lixeira")} Excluir</button></div>` : ""}</div>`;
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
      <div class="cal-grade" id="cal-grade" role="grid"></div>
      <div class="acoes" style="justify-content:center"><button class="btn outline pequeno" id="cal-hoje">Hoje</button></div></section>
    <div><section class="card" id="cal-dia"></section>
      <section class="card" style="margin-top:16px"><h2>Próximos eventos</h2><div id="cal-proximos"></div></section></div>
  </div>
  ${podeCriar ? `<form id="form-evento" class="card" style="margin-top:20px;max-width:980px"><h2>Novo evento</h2>
    <small>${papel === "professor" ? "O evento aparece para a sua turma." : "Escolha uma turma ou a escola toda."}</small>
    <div class="grade dois" style="margin-top:12px"><div><small>Título</small><input id="ev-titulo" required maxlength="100" placeholder="Ex.: Festa da primavera"></div>
      <div><small>Tipo</small><select id="ev-tipo">${dados.cal.tipos.map((t) => `<option>${t}</option>`).join("")}</select></div></div>
    <div class="grade g3" style="margin-top:12px"><div><small>Data</small><input type="date" id="ev-data" required></div>
      <div><small>Termina em (opcional)</small><input type="date" id="ev-fim"></div><div><small>Hora (opcional)</small><input type="time" id="ev-hora"></div></div>
    <div class="grade dois" style="margin-top:12px"><div><small>Local (opcional)</small><input id="ev-local" maxlength="100" placeholder="Ex.: Pátio central"></div><div><small>Para quem</small>${destino}</div></div>
    <div style="margin-top:12px"><small>Descrição (opcional)</small><textarea id="ev-desc" rows="3" maxlength="500"></textarea></div>
    <label class="termo-aceite"><input type="checkbox" id="ev-destaque"> <span>Mostrar como <b>banner</b> nos painéis (Central do Dia, Minha Turma e Portal dos Pais) até a data do evento</span></label>
    <div style="margin-top:12px"><small>Imagem do banner (opcional: PNG ou JPG, até 2 MB, de preferência deitada)</small><input type="file" id="ev-imagem" accept=".png,.jpg,.jpeg,image/png,image/jpeg"></div>
    <label class="termo-aceite oculto" id="ev-eca-box"><input type="checkbox" id="ev-eca"> <span>A imagem <b>não mostra alunos</b>, ou todos os alunos que aparecem têm autorização de uso de imagem (ECA, art. 17; LGPD, art. 14). O banner é visto por várias famílias.</span></label>
    <p id="ev-erro" class="pill danger oculto" style="margin-top:12px;white-space:normal"></p>
    <button class="btn" type="submit" style="margin-top:14px;max-width:220px">Criar evento</button></form>` : ""}`;
}
function desenharCalendario() {
  const [ano, mes] = dados.calMes.split("-").map(Number), hoje = hojeLocalISO();
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("cal-titulo").textContent = nome.charAt(0).toUpperCase() + nome.slice(1);
  if (!dados.calDia || dados.calDia.slice(0, 7) !== dados.calMes) dados.calDia = hoje.slice(0, 7) === dados.calMes ? hoje : `${dados.calMes}-01`;
  const inicio = new Date(ano, mes - 1, 1).getDay(), dias = new Date(ano, mes, 0).getDate();
  let html = SEMANA.map((d) => `<div class="cal-semana" role="columnheader">${d}</div>`).join("") + '<div class="cal-vazio"></div>'.repeat(inicio);
  for (let d = 1; d <= dias; d++) {
    const iso = `${dados.calMes}-${String(d).padStart(2, "0")}`, evs = eventosDoDia(iso);
    const chips = evs.slice(0, 2).map((e) => `<span class="cal-chip ban-${tipoClasse(e.tipo)}">${esc(e.titulo)}</span>`).join("") + (evs.length > 2 ? `<span class="cal-mais">+${evs.length - 2}</span>` : "");
    const pontos = evs.slice(0, 3).map((e) => `<i class="ban-${tipoClasse(e.tipo)}"></i>`).join("");
    html += `<button class="cal-dia ${iso === hoje ? "hoje" : ""} ${iso === dados.calDia ? "sel" : ""}" data-dia="${iso}" aria-label="${d}${evs.length ? `, ${evs.length} evento(s)` : ""}">
      <span class="cal-num">${d}</span><span class="cal-chips">${chips}</span><span class="cal-pontos">${pontos}</span></button>`;
  }
  document.getElementById("cal-grade").innerHTML = html;
  document.querySelectorAll("[data-dia]").forEach((b) => b.onclick = () => { dados.calDia = b.dataset.dia; desenharCalendario(); });
  const doDia = eventosDoDia(dados.calDia), titulo = new Date(dados.calDia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("cal-dia").innerHTML = `<h2>${titulo.charAt(0).toUpperCase() + titulo.slice(1)}</h2>${doDia.length ? doDia.map(cartaoEvento).join("") : vazio("Nenhum evento neste dia.")}`;
  document.getElementById("cal-proximos").innerHTML = dados.cal.proximos.length ? dados.cal.proximos.map((e) => `<button class="proximo" data-ir-dia="${e.data}">
      <span class="proximo-data ban-${tipoClasse(e.tipo)}"><b>${Number(e.data.slice(8))}</b><small>${new Date(e.data + "T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
      <span><b>${esc(e.titulo)}</b><small>${esc(e.tipo)} • ${quandoEvento(e)}${e.sala ? " • " + esc(e.sala) : ""}</small></span></button>`).join("") : vazio("Nenhum evento marcado.");
  document.querySelectorAll("[data-ir-dia]").forEach((b) => b.onclick = seguro(async () => { await irParaMes(b.dataset.irDia.slice(0, 7), b.dataset.irDia); }));
  document.querySelectorAll("[data-excluir-evento]").forEach((b) => b.onclick = seguro(async () => {
    if (!confirm(`Excluir o evento "${b.dataset.titulo}"?`)) return;
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
  $("ev-data").value = dados.calDia;
  $("ev-imagem").onchange = () => $("ev-eca-box").classList.toggle("oculto", !$("ev-imagem").files.length);
  form.onsubmit = async (e) => {
    e.preventDefault(); $("ev-erro").classList.add("oculto");
    try {
      const arquivo = $("ev-imagem").files[0];
      if (arquivo && arquivo.size > 2 * 1024 * 1024) throw new Error("A imagem do banner precisa ter até 2 MB");
      if (arquivo && !$("ev-eca").checked) throw new Error("Confirme que a imagem não mostra alunos, ou que todos têm autorização de uso de imagem");
      const sala = $("ev-sala");
      await api("/api/eventos", { method: "POST", body: JSON.stringify({ titulo: $("ev-titulo").value, tipo: $("ev-tipo").value, data: $("ev-data").value,
        data_fim: $("ev-fim").value || undefined, hora: $("ev-hora").value || undefined, local: $("ev-local").value, sala: sala ? sala.value : undefined,
        descricao: $("ev-desc").value, destaque: $("ev-destaque").checked, imagem_sem_alunos: $("ev-eca").checked,
        banner: arquivo ? { nome_arquivo: arquivo.name, conteudo: await lerBase64(arquivo) } : undefined }) });
      dados.calMsg = `Evento "${$("ev-titulo").value.trim()}" criado.`; dados.calMes = $("ev-data").value.slice(0, 7); dados.calDia = $("ev-data").value;
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
    <form id="form-perfil" class="card"><div class="aluno"><span class="avatar" style="width:48px;height:48px;font-size:16px">${iniciais(c.nome)}</span><div><h2>${esc(c.nome)}</h2><small>Login: ${esc(c.login)} • Responsável desde ${c.criado_em}</small></div></div>
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
      <input id="buscaSaida" placeholder="Digite o nome do aluno (ex.: João Pedro)" style="margin-top:16px"><div id="resultado"></div></section>
  </div>
  <section class="card" style="margin-top:20px"><div class="linha" style="flex-wrap:wrap;gap:8px"><div><h2>Situação dos alunos agora</h2><small>Atualiza sozinha a cada 5 segundos.</small></div>
    <input id="mon-busca" class="campo-busca" placeholder="Buscar aluno..." style="max-width:240px"></div>
    <div class="tabela"><table><thead><tr><th>Aluno</th><th>Agora</th><th>Cadastro facial</th><th>Portaria</th></tr></thead><tbody id="mon-alunos"></tbody></table></div></section>
  <form id="form-camera" class="card" style="margin-top:20px;max-width:980px"><h2>Nova câmera</h2>
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
    metrica(ico("camera"), "Câmeras online", `${ativas}/${m.cameras.length}`, ativas === m.cameras.length ? "Todas funcionando" : `${m.cameras.length - ativas} desligada(s)`, ativas === m.cameras.length ? "info" : "warning", "Agora") +
    metrica(ico("rosto"), "Reconhecidos hoje", r.reconhecidos_hoje, `${r.com_cadastro_facial} aluno(s) com cadastro facial`, "info", "Hoje") +
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
    if (f.ligado && !confirm("Desligar o reconhecimento facial? As entradas passam a ser registradas pela portaria.")) return;
    await api("/api/configuracoes/reconhecimento-facial", { method: "PUT", body: JSON.stringify({ ligado: !f.ligado }) });
    await recarregarMonitoramento(true);
  });
}
function desenharMonCameras() {
  const alunos = dados.mon.alunos.map((a) => `<option value="${a.id}">${esc(a.nome)} — ${esc(a.sala)}</option>`).join("");
  document.getElementById("mon-cams").innerHTML = dados.mon.cameras.map((c) => `<article class="cam ${c.ativa ? "" : "desligada"}" data-cam="${c.id}">
    <div class="cam-video" role="img" aria-label="Imagem simulada da câmera ${esc(c.nome)}">
      ${c.ativa ? `<span class="cam-rec">● REC</span>` : `<span class="cam-sem-sinal">${ico("semSinal")} Sem sinal</span>`}
      <span class="cam-nome">${esc(c.nome)}</span><span class="cam-hora"></span>
      <div class="cam-alerta oculto" data-cam-alerta="${c.id}"></div></div>
    <div class="cam-info"><div class="linha" style="gap:6px;flex-wrap:wrap"><small>${ico("local")} ${esc(c.local)}</small><span>${pill(c.tipo, "neutral")} ${c.reconhecimento ? pill("Facial", "info") : ""}</span></div>
      ${c.reconhecimento ? `<small>${c.passagens_hoje} passagem(ns) hoje</small>` : "<small>Só gravação (área comum)</small>"}
      ${c.reconhecimento && c.ativa ? `<div style="margin-top:8px"><small>Simular passagem de</small><select data-cam-aluno="${c.id}"><option value="">Aluno escolhido pelo sistema</option><option value="desconhecido">Visitante (rosto desconhecido)</option>${alunos}</select></div>
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
  document.getElementById("mon-alunos").innerHTML = dados.mon.alunos.filter((a) => a.nome.toLowerCase().includes(busca)).map((a) => `<tr>
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
  document.getElementById("buscaSaida").oninput = () => { liberada = false; desenharSaida(); };
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
  const texto = document.getElementById("buscaSaida").value.trim();
  const box = document.getElementById("resultado");
  const vazioSaida = `<div class="vazio"><b>Busque pelo nome do aluno</b><small>Os responsáveis autorizados aparecerão aqui.</small></div>`;
  if (texto.length < 3) { box.innerHTML = vazioSaida; return; }
  const r = await api("/api/saida?nome=" + encodeURIComponent(texto));
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
  const turmas = new Map(); // turma -> alunos, já em ordem alfabética
  for (const a of [...alunos].sort((x, y) => porNome(x.nome, y.nome))) {
    if (!turmas.has(a.sala)) turmas.set(a.sala, []);
    turmas.get(a.sala).push(a);
  }
  // Situação: quem sai da escola não é apagado (o histórico fica), só deixa de aparecer nas listas do dia a dia
  const seletorSituacao = (a) => `<select class="ca-situacao" data-aluno="${a.id}" data-nome="${esc(a.nome)}" aria-label="Situação de ${esc(a.nome)}" style="width:auto;padding:6px 8px">
    ${["Ativo", "Transferido", "Concluiu", "Desistente"].map((s) => `<option ${s === a.situacao ? "selected" : ""}>${s}</option>`).join("")}</select>`;
  const linhaAluno = (a) => `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.matricula || "—")}</td><td>${seletorSituacao(a)}</td>
    <td><button type="button" class="btn outline pequeno" data-ca-ficha="${a.id}">Abrir ficha</button></td></tr>`;
  const cabecalho = "<thead><tr><th>Aluno</th><th>Matrícula</th><th>Situação</th><th></th></tr></thead>";
  const lista = [...turmas.keys()].sort(porNome).map((sala) => {
    const da = turmas.get(sala);
    return `<h3 style="margin:18px 0 8px">${esc(sala)} <small style="display:inline">(${da.length} aluno(s))</small></h3>
      <div class="tabela"><table>${cabecalho}<tbody>${da.map(linhaAluno).join("")}</tbody></table></div>`;
  }).join("");
  const fora = foraDaEscola.length ? `<details class="pasta" style="margin-top:18px"><summary><b>${ico("pasta")} Fora da escola</b> <small style="display:inline">(${foraDaEscola.length}: transferidos, concluintes e desistentes)</small></summary>
    <div class="tabela"><table><thead><tr><th>Aluno</th><th>Última turma</th><th>Situação</th><th>Desde</th><th></th></tr></thead><tbody>${[...foraDaEscola].sort((x, y) => porNome(x.nome, y.nome)).map((a) =>
      `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.sala)}</td><td>${seletorSituacao(a)}</td><td>${a.situacao_em || "—"}</td><td><button type="button" class="btn outline pequeno" data-ca-ficha="${a.id}">Abrir ficha</button></td></tr>`).join("")}</tbody></table></div></details>` : "";
  const editando = dados.turmaEditando ? (dados.turmas || []).find((t) => t.id === dados.turmaEditando) : null;
  const opcoesTurno = (atual) => `<option value="">—</option>${["Manhã", "Tarde", "Integral", "Noite"].map((t) => `<option ${t === atual ? "selected" : ""}>${t}</option>`).join("")}`;
  return `<div class="topo linha" style="flex-wrap:wrap">
    <div><h2>Cadastro de Aluno</h2><small>Alunos cadastrados, separados por turma (ordem alfabética).</small></div>
    <button type="button" class="btn" id="ca-novo" style="width:auto;padding:10px 18px">+ Novo cadastro</button></div>
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  <section class="card">
    <h2>Lista de alunos (${alunos.length})</h2>
    ${lista || `<div class="vazio"><b>Nenhum aluno cadastrado</b><small>Clique em "+ Novo cadastro" para começar.</small></div>`}
    ${fora}
  </section>
  <section class="card" style="margin-top:20px">
    <h2>Turmas</h2><small>O aluno, o professor, os comunicados e os eventos só podem usar turmas desta lista. Renomear uma turma atualiza tudo sozinho.</small>
    <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Turma</th><th>Ano letivo</th><th>Turno</th><th>Alunos</th><th>Professores</th><th>Situação</th><th></th></tr></thead><tbody>
      ${(dados.turmas || []).map((t) => `<tr><td><b>${esc(t.nome)}</b></td><td>${t.ano_letivo}</td><td>${esc(t.turno || "—")}</td><td>${t.alunos}</td><td>${esc(t.professores || "—")}</td>
        <td>${t.ativa ? pill("Em uso", "success") : pill("Encerrada", "neutral")}</td><td><button type="button" class="btn outline pequeno" data-tur-editar="${t.id}">Editar</button></td></tr>`).join("")}
    </tbody></table></div>
    <form id="form-turma" class="grade" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px;align-items:end">
      <div><small>${editando ? "Nome da turma" : "Nova turma"}</small><input id="tur-nome" maxlength="40" required placeholder="Ex.: 3º Ano B" value="${esc(editando ? editando.nome : "")}"></div>
      <div><small>Ano letivo</small><input id="tur-ano" type="number" min="2000" max="2100" required value="${editando ? editando.ano_letivo : new Date().getFullYear()}"></div>
      <div><small>Turno</small><select id="tur-turno">${opcoesTurno(editando ? editando.turno : "")}</select></div>
      ${editando ? `<label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" id="tur-ativa" style="width:auto" ${editando.ativa ? "checked" : ""}> Turma em uso</label>` : ""}
      <div class="acoes" style="margin:0"><button class="btn pequeno" type="submit">${editando ? "Salvar alterações" : "+ Criar turma"}</button>
        ${editando ? `<button type="button" class="btn outline pequeno" id="tur-cancelar">Cancelar</button>` : ""}</div>
    </form>
    <p id="tur-erro" class="pill danger oculto" style="margin-top:10px;white-space:normal"></p>
  </section>
  <section class="card" style="max-width:980px;margin-top:20px">
    <h2>Importar vários alunos de uma planilha</h2>
    <small>Cadastre a turma inteira de uma vez. Aceita CSV e Excel (.xlsx).</small>
    <ol style="margin:12px 0 12px 20px;font-size:14px;line-height:1.6">
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
          <div><small>Turma / sala</small><select id="ca-sala" required><option value="">Escolha a turma...</option>${nomesTurmas().map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
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
    ? `${pill(`${ico("confere")} ${r.importados} aluno(s) importado(s)`, "success")} ${r.ignorados ? pill(`${r.ignorados} linha(s) não importada(s)`, "warning") : ""}`
    : `${pill(`${r.total} linha(s)`, "info")} ${pill(`${r.prontos} pronta(s)`, "success")} ${r.duplicados ? pill(`${r.duplicados} já cadastrada(s)`, "warning") : ""} ${r.com_erro ? pill(`${r.com_erro} com erro`, "danger") : ""}`;
  const ignoradas = r.ignoradas && r.ignoradas.length ? `<small style="display:block;margin-top:6px">Colunas que não fazem parte do cadastro e foram ignoradas: ${r.ignoradas.map(esc).join(", ")}.</small>` : "";
  const acoes = importado
    ? `<button type="button" class="btn outline" id="imp-nova" style="width:auto;padding:8px 16px">Importar outra planilha</button>`
    : `<button type="button" class="btn" id="imp-confirmar" style="width:auto;padding:8px 18px" ${r.prontos ? "" : "disabled"}>Importar ${r.prontos} aluno(s)</button>
       <button type="button" class="btn outline" id="imp-cancelar" style="width:auto;padding:8px 16px">Cancelar</button>`;
  document.getElementById("imp-previa").innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="word-break:break-all">${esc(impArquivo ? impArquivo.nome : "")}</b></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">${resumo}</div>
    ${importado || r.prontos ? "" : '<p class="pill danger" style="white-space:normal">Nenhum aluno pronto para importar. Corrija a planilha e escolha o arquivo de novo.</p>'}
    <div class="tabela" style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px"><table><thead><tr><th>Linha</th><th>Situação</th><th>Aluno</th><th>Turma</th><th>Matrícula</th><th>Responsáveis</th></tr></thead><tbody>${linhas}</tbody></table></div>
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
  document.querySelectorAll(".ca-situacao").forEach((sel) => sel.onchange = seguro(async () => {
    const antes = [...sel.options].find((o) => o.defaultSelected).value, nova = sel.value;
    const motivo = nova === "Ativo" ? "" : prompt(`${sel.dataset.nome}: ${nova}.\nMotivo ou observação (opcional, ex.: escola de destino):`, "");
    if (motivo === null) { sel.value = antes; return; } // cancelou
    try { await api(`/api/alunos/${sel.dataset.aluno}/situacao`, { method: "PUT", body: JSON.stringify({ situacao: nova, motivo }) }); }
    catch (e) { sel.value = antes; throw e; }
    dados.cadastroMsg = nova === "Ativo" ? `${sel.dataset.nome} voltou para a lista de alunos.` : `${sel.dataset.nome} foi para "Fora da escola" (${nova}). O histórico continua guardado.`;
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
      <div style="margin-top:12px"><small>Papel</small>
        <select id="nu-papel">
          <option value="admin">Gestão (administração)</option>
          <option value="pai">Pai / responsável</option>
          <option value="professor">Professor(a)</option>
        </select>
      </div>
      <div id="nu-campo-aluno" style="margin-top:12px"><small>Aluno (filho)</small><select id="nu-aluno"></select></div>
      <div id="nu-campo-sala" class="oculto" style="margin-top:12px"><small>Turma que leciona (outras turmas podem ser marcadas depois, na lista abaixo)</small><select id="nu-sala"><option value="">Escolha a turma...</option>${nomesTurmas().map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
      <p id="nu-erro" class="pill danger oculto" style="margin-top:12px"></p>
      <div id="nu-sucesso" class="oculto pill success" style="margin-top:12px;display:block"></div>
      <button class="btn" type="submit" style="margin-top:16px;max-width:220px">Criar usuário</button>
    </form>
  </section>
  <section class="card" style="margin-top:20px">
    <h2>Usuários cadastrados</h2>
    <div class="tabela"><table><thead><tr><th>Nome</th><th>Login</th><th>Papel</th><th>Vínculo</th><th>Último acesso</th><th>Status</th><th>Ações</th></tr></thead>
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
  selectAluno.innerHTML = dados.alunos.map((a) => `<option value="${a.id}">${esc(a.nome)} — ${esc(a.sala)}</option>`).join("");
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
  if (u.ativo) return pill("Ativo", "success") + (u.senha_temporaria ? " " + pill("Senha provisória", "warning") : "");
  if (u.inativado_motivo === "inatividade") return pill(`Inativo: ${u.dias_sem_acesso} dias sem acesso`, "warning") + (u.reativacao_pedida_em ? " " + pill("Pediu reativação", "danger") : "");
  return pill("Inativo", "neutral");
}
function desenharListaUsuarios() {
  document.getElementById("lista-usuarios").innerHTML = dados.usuarios.map((u) => `<tr>
    <td>${esc(u.nome)}</td><td>${esc(u.usuario)}</td><td>${papelLabel(u.papel)}</td>
    <td>${vinculoUsuario(u)}</td><td>${u.ultimo_acesso || "Nunca entrou"}</td>
    <td>${statusUsuario(u)}${u.dois_fatores ? " " + pill("2 etapas", "info") : ""}</td>
    <td>${!u.ativo && u.inativado_motivo === "inatividade"
      ? `<button class="btn pequeno" data-reativar="${u.id}" data-nome="${esc(u.nome)}">Reativar</button>`
      : `<button class="btn outline pequeno" data-id="${u.id}" data-ativo="${u.ativo ? 0 : 1}">${u.ativo ? "Desativar" : "Ativar"}</button>`}
      ${u.dois_fatores && u.usuario !== usuarioLogado.usuario ? `<button class="btn outline pequeno" data-zerar-2fa="${u.id}" data-nome="${esc(u.nome)}" style="margin-top:6px">Zerar 2 etapas</button>` : ""}</td>
  </tr>`).join("");
  document.querySelectorAll("#lista-usuarios [data-ativo]").forEach((b) => b.onclick = seguro(async () => {
    await api(`/api/usuarios/${b.dataset.id}/ativo`, { method: "PUT", body: JSON.stringify({ ativo: b.dataset.ativo === "1" }) });
    await recarregarUsuarios();
  }));
  document.querySelectorAll("#lista-usuarios [data-reativar]").forEach((b) => b.onclick = reativarProfessor(b));
  document.querySelectorAll("#lista-usuarios [data-zerar-2fa]").forEach((b) => b.onclick = seguro(async () => {
    if (!confirm(`Zerar a verificação em duas etapas de ${b.dataset.nome}? Use só se a pessoa perdeu o celular. Ela configura de novo no próximo login.`)) return;
    await api(`/api/usuarios/${b.dataset.zerar2fa}/2fa/zerar`, { method: "PUT", body: "{}" });
    await recarregarUsuarios(`Verificação em duas etapas de ${b.dataset.nome} zerada.`);
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
        ${f.id === u.aluno_id ? "" : `<button type="button" class="btn outline pequeno" data-desligar="${f.id}">Desligar</button>`}</div>`).join("")}</div>
      <div class="grade dois" style="margin-top:12px"><div><small>Ligar outro aluno</small><select id="vinculo-aluno"><option value="">Escolha...</option>${dados.alunos.filter((a) => !ligados.has(a.id)).map((a) => `<option value="${a.id}">${esc(a.nome)} — ${esc(a.sala)}</option>`).join("")}</select></div>
        <div><small>Parentesco</small><select id="vinculo-parentesco"><option>Mãe</option><option>Pai</option><option>Responsável</option></select></div></div>
      <button type="button" class="btn pequeno" id="vinculo-ligar" style="margin-top:12px">Ligar aluno</button>`;
    $("vinculo-ligar").onclick = async () => {
      try { await api(`/api/usuarios/${u.id}/filhos`, { method: "POST", body: JSON.stringify({ aluno_id: Number($("vinculo-aluno").value), parentesco: $("vinculo-parentesco").value }) }); await depois(); }
      catch (e) { falhou(e); }
    };
    corpo.querySelectorAll("[data-desligar]").forEach((b) => b.onclick = async () => {
      if (!confirm("Desligar este aluno do responsável? Ele deixa de ver o aluno no Portal dos Pais.")) return;
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
  if (!confirm(`Reativar o acesso de ${b.dataset.nome}? Uma senha provisória nova será gerada.`)) return;
  const r = await api(`/api/usuarios/${b.dataset.reativar}/reativar`, { method: "PUT", body: "{}" });
  await recarregarUsuarios(`Acesso de ${b.dataset.nome} reativado. Senha provisória: ${r.senha_provisoria} (repasse ao professor; ele troca no primeiro acesso).`);
});
function desenharReativacao() {
  const r = dados.reat, caixa = document.getElementById("reativacao");
  const msg = dados.reatMsg; dados.reatMsg = "";
  const inativos = r.inativos.map((u) => `<div class="item"><div class="linha" style="flex-wrap:wrap;gap:8px">
      <div class="aluno"><span class="avatar">${iniciais(u.nome)}</span><div><b>${esc(u.nome)}</b><small>${esc(u.sala || "—")} • login ${esc(u.usuario)} • último acesso ${u.ultimo_acesso || "nunca"} • inativado em ${u.inativado_em}</small></div></div>
      <div>${u.pedido_em ? pill(`Pediu reativação em ${u.pedido_em}`, "danger") : pill(`${u.dias_sem_acesso} dias sem acesso`, "warning")}</div></div>
      <div class="acoes"><button class="btn pequeno" data-reativar="${u.id}" data-nome="${esc(u.nome)}">Reativar com senha nova</button></div></div>`).join("");
  const perto = r.perto.map((u) => `<div class="linha" style="padding:8px 0;border-top:1px solid var(--border);flex-wrap:wrap;gap:8px"><span><b>${esc(u.nome)}</b> <small style="display:inline">(${esc(u.sala || "—")}) • último acesso ${u.ultimo_acesso || "nunca"}</small></span>${pill(`Faltam ${u.faltam} dia(s) para a suspensão`, "warning")}</div>`).join("");
  caixa.innerHTML = `<div class="linha" style="flex-wrap:wrap;gap:8px"><h2>Reativação de professores</h2>${r.inativos.length ? pill(`${r.inativos.length} inativo(s)`, "warning") : pill("Nenhum inativo", "success")}</div>
    <small>Professores que ficam ${r.dias} dias sem acessar o sistema (AVA) têm o acesso suspenso automaticamente. Ao tentar entrar, o pedido de reativação chega aqui. A reativação gera uma senha provisória nova e o prazo volta a contar.</small>
    ${msg ? `<p class="pill success" style="margin-top:12px;white-space:normal">${esc(msg)}</p>` : ""}
    ${inativos || ""}
    ${perto ? `<small style="margin-top:14px;font-weight:700;text-transform:uppercase">Perto do limite (${r.aviso} dias ou mais sem acesso)</small>${perto}` : ""}
    ${!inativos && !perto ? `<div class="vazio" style="padding:20px"><small>Nenhum professor parado há ${r.aviso} dias ou mais.</small></div>` : ""}`;
  caixa.querySelectorAll("[data-reativar]").forEach((b) => b.onclick = reativarProfessor(b));
}

// ---------- Logs de atividade ----------
function telaLogs() {
  return `<div class="topo"><h2>Logs de atividade</h2><small>Últimas ações registradas no sistema, com quem fez o quê.</small></div>
  <section class="card" style="margin-bottom:16px"><div class="linha" style="flex-wrap:wrap;gap:10px"><div><b>Integridade dos logs</b><small>Cada registro é encadeado ao anterior por um código (hash). Se alguém apagar ou alterar um registro direto no banco, a conferência mostra onde.</small></div>
    <button type="button" class="btn outline pequeno" id="logs-conferir" style="width:auto">${ico("escudoOk")} Conferir integridade</button></div><div id="logs-integridade"></div></section>
  <section class="card"><div class="tabela"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Papel</th><th>Ação</th><th>Detalhe</th></tr></thead>
  <tbody>${dados.logs.map((l) => `<tr><td>${l.quando}</td><td>${esc(l.nome_usuario)}</td><td>${papelLabel(l.papel)}</td><td>${acaoLabel(l.acao)}</td><td>${esc(l.detalhe || "—")}</td></tr>`).join("")}</tbody></table></div></section>`;
}

// ---------- Minha Turma e chamada (professor) ----------
function telaTurma() {
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const alunos = dados.turma.alunos;
  const registrada = alunos.length > 0 && alunos.every((a) => a.status_hoje);
  const salva = dados.chamadaSalva; dados.chamadaSalva = false;
  return `<div class="topo"><h2>Minha turma — ${esc(usuarioLogado.sala)}</h2><small>Chamada de hoje (${hoje}), contato dos responsáveis e ficha de cada aluno.</small></div>
  ${blocoBanners()}
  <section class="card"><div class="linha" style="flex-wrap:wrap;gap:8px"><h2>Chamada de hoje</h2>${registrada ? pill("Chamada registrada hoje", "success") : pill("Ainda não registrada", "warning")}</div>
    ${alunos.length ? `<div class="tabela"><table><thead><tr><th>Aluno</th><th>Agora</th><th>Hoje</th><th>Faltas (${dados.turma.dias_faltas} dias)</th><th>Pendências</th><th>Responsáveis</th><th></th></tr></thead>
      <tbody id="chamada-linhas"></tbody></table></div>
      <p class="pill success ${salva ? "" : "oculto"}" style="margin-top:12px">Chamada salva com sucesso!</p>
      <button class="btn" id="chamada-salvar" style="max-width:260px">Salvar chamada de hoje</button>`
      : `<div class="vazio"><b>Nenhum aluno cadastrado nesta turma</b><small>Peça à administração para cadastrar os alunos da sala ${esc(usuarioLogado.sala)}.</small></div>`}
  </section>`;
}
function desenharChamada() {
  const corpo = document.getElementById("chamada-linhas");
  if (!corpo) return;
  corpo.innerHTML = dados.turma.alunos.map((a) => {
    const s = dados.chamada[a.id];
    return `<tr><td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><b>${esc(a.nome)}</b></div></td>
      <td>${a.agora ? pillAgora(a.agora) : "—"}</td>
      <td><div class="seg"><button class="${s === "Presente" ? "on-p" : ""}" data-aluno="${a.id}" data-status="Presente">Presente</button><button class="${s === "Ausente" ? "on-a" : ""}" data-aluno="${a.id}" data-status="Ausente">Ausente</button></div></td>
      <td>${pill(a.faltas, a.faltas >= 5 ? "danger" : a.faltas > 0 ? "warning" : "neutral")}</td>
      <td>${a.pendencias ? pill(`${a.pendencias} em aberto`, "warning") : pill("Nenhuma", "neutral")}</td><td>${esc(a.responsaveis || "—")}</td>
      <td><button class="btn outline pequeno" data-ficha="${a.id}">Ficha</button></td></tr>`;
  }).join("");
  corpo.querySelectorAll("[data-aluno]").forEach((b) => b.onclick = () => { dados.chamada[b.dataset.aluno] = b.dataset.status; desenharChamada(); });
  corpo.querySelectorAll("[data-ficha]").forEach((b) => b.onclick = () => abrirFicha(Number(b.dataset.ficha), "turma"));
  document.getElementById("chamada-salvar").onclick = seguro(async () => {
    await api("/api/chamada", { method: "POST", body: JSON.stringify({
      registros: Object.entries(dados.chamada).map(([id, status]) => ({ aluno_id: Number(id), status })),
    }) });
    dados.chamadaSalva = true;
    await mostrar("turma");
  });
}

// ---------- Portal dos Pais ----------
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
function telaPais() {
  const h = dados.historico;
  return `<div class="topo"><small>Olá, ${esc(usuarioLogado.nome.split(" ")[0])}</small><h2>Acompanhe ${dados.filho ? "o(a) " + esc(dados.filho.nome.split(" ")[0]) : "seu filho"}</h2></div>
  ${blocoBanners()}
  <div class="grade pais" style="align-items:start">
    <section class="status" id="status-agora">${cartaoStatusAgora()}</section>
    <aside class="card"><h2>Histórico de presença</h2><small>Últimos ${h.dias} dias</small>${blocoHistorico(h)}</aside>
  </div>
  ${cartaoConsentimento()}
  <section class="card" style="margin-top:20px"><h2>Ficha do meu filho</h2><small>Comunicados, autorizações para assinar, documentos, pendências e ocorrências.</small><div id="ficha-corpo"></div></section>`;
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
  return f.autorizacoes.length ? f.autorizacoes.map((a) => `<div class="item">
    <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${esc(a.titulo)}</b><small>${ico("calendario")} ${esc(a.validade || "—")}</small></div>${a.assinada ? pill("Assinada", "success") : pill("Pendente", "warning")}</div>
    <small style="margin-top:6px">${esc(a.detalhe || "")}</small>
    ${a.assinada
      ? `${seloAssinatura("Assinatura digital do responsável", a.assinada_nome, a.assinada_em, a.codigo)}
         <button class="btn outline pequeno" data-comprovante="${a.id}" style="margin-top:8px">Ver comprovante</button>`
      : ehPai ? `<small style="margin-top:10px">Ao assinar, você autoriza o que está descrito acima. Para confirmar, digite seu nome completo e sua senha.</small>
         <div class="grade dois" style="margin-top:8px"><input placeholder="Seu nome completo" data-as-nome="${a.id}" autocomplete="off"><input type="password" placeholder="Sua senha" data-as-senha="${a.id}" autocomplete="off"></div>
         <button class="btn pequeno" data-assinar="${a.id}" style="margin-top:10px">${ico("caneta")} Assinar digitalmente</button>` : ""}
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
    <div style="margin-top:8px"><small>Descrição (só fatos, sem rótulos nem julgamentos sobre a criança: ECA, arts. 17 e 18)</small><textarea id="ocor-desc" rows="3" maxlength="500" required></textarea></div>
    ${erroBox("ocor-erro")}<button class="btn pequeno" type="submit" style="margin-top:10px">Registrar</button></form>` : "");
}
function abrirComprovante(a, aluno) {
  const w = window.open("", "_blank");
  if (!w) { alert("Permita pop-ups neste site para ver o comprovante."); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante ${esc(a.codigo)}</title>
    <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#140040}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:10px;border-bottom:1px solid #EAD6CA}td:first-child{color:#5B5278;width:38%}.cod{font-size:20px;letter-spacing:2px;font-weight:700}@media print{button{display:none}}</style></head><body>
    <h1>${ico("escudoOk")} S.I.V.E. — Comprovante de autorização digital</h1>
    <table><tr><td>Autorização</td><td>${esc(a.titulo)}</td></tr><tr><td>Detalhes</td><td>${esc(a.detalhe || "—")}</td></tr>
    <tr><td>Aluno(a)</td><td>${esc(aluno.nome)} — ${esc(aluno.sala)}</td></tr><tr><td>Assinada por</td><td>${esc(a.assinada_nome)}</td></tr>
    <tr><td>Data e hora</td><td>${esc(a.assinada_em)}</td></tr><tr><td>Código de verificação</td><td class="cod">${esc(a.codigo)}</td></tr></table>
    ${blocoVerificacao(a.codigo)}<p>Documento gerado pelo sistema S.I.V.E. A assinatura foi confirmada com o nome completo e a senha do responsável.</p><button id="imprimir">Imprimir</button></body></html>`);
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
  const naoLidos = f.comunicados.filter((c) => !c.lido).length, autPend = f.autorizacoes.filter((a) => !a.assinada).length;
  const pendAbertas = f.pendencias.filter((p) => p.status === "Aberta").length;
  const abas = [["comunicados", "Comunicados", naoLidos ? `${naoLidos} novo(s)` : ""], ["autorizacoes", "Autorizações", autPend ? `${autPend} pendente(s)` : ""],
    ["documentos", "Documentos", f.documentos.length || ""], ["pendencias", "Pendências", pendAbertas ? `${pendAbertas} aberta(s)` : ""], ["ocorrencias", "Ocorrências", f.ocorrencias.length || ""]];
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
  }));
  corpo.querySelectorAll("[data-assinar]").forEach((b) => b.onclick = seguro(async () => {
    const id = b.dataset.assinar;
    await api(`/api/autorizacoes/${id}/assinar`, { method: "POST", body: JSON.stringify({
      nome: corpo.querySelector(`[data-as-nome="${id}"]`).value, senha: corpo.querySelector(`[data-as-senha="${id}"]`).value }) });
    dados.fichaMsg = "Autorização assinada! O comprovante está disponível abaixo.";
    await recarregarFicha();
  }));
  corpo.querySelectorAll("[data-comprovante]").forEach((b) => b.onclick = () =>
    abrirComprovante(f.autorizacoes.find((a) => a.id === Number(b.dataset.comprovante)), f.aluno));
  corpo.querySelectorAll("[data-baixar-dados]").forEach((b) => b.onclick = seguro(() => baixarDadosAluno(b.dataset.baixarDados)));
  corpo.querySelectorAll("[data-baixar]").forEach((b) => b.onclick = seguro(() => baixarDocumento(b.dataset.baixar, b.dataset.nome)));
  corpo.querySelectorAll("[data-excluir-doc]").forEach((b) => b.onclick = seguro(async () => {
    if (!confirm("Excluir este documento? Essa ação não pode ser desfeita.")) return;
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
  const alunos = dados.turma.alunos.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join("");
  return `<div class="topo"><h2>Ocorrências</h2><small>Registre o que aconteceu com um aluno da sua turma. Cada registro é assinado e fica arquivado abaixo.</small></div>
  ${msg ? `<p class="pill success" style="white-space:normal;margin-bottom:14px">${esc(msg)}</p>` : ""}
  <form id="form-ocorrencia" class="card" style="max-width:760px;margin-bottom:20px">
    <b>Nova ocorrência</b>
    <div class="grade dois" style="margin-top:10px">
      <div><small>Nome do aluno</small><select id="oc-aluno" required><option value="">Escolha o aluno...</option>${alunos}</select></div>
      <div><small>Turma</small><input value="${esc(usuarioLogado.sala)}" disabled></div>
    </div>
    <div class="grade dois">
      <div><small>Data</small><input type="date" id="oc-data" value="${hojeLocalISO()}" max="${hojeLocalISO()}" required></div>
      <div><small>Horário</small><input type="time" id="oc-horario" required></div>
    </div>
    <div><small>Quando o responsável foi notificado</small><input type="datetime-local" id="oc-notificado" required></div>
    <div style="margin-top:12px"><small>Ocorrência (descreva os fatos e as providências tomadas)</small><textarea id="oc-descricao" rows="4" maxlength="1000" required></textarea></div>
    <div style="margin-top:12px"><small>Quem foi buscar o aluno (nome e parentesco)</small><input id="oc-buscado" maxlength="100" required></div>
    <div class="assinatura-caixa">
      <small><b>Assinatura digital do professor</b></small>
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
    <summary><b>${ico("pasta")} ${mesPorExtenso(mes)}</b> <small style="display:inline">(${itens.length} ocorrência(s))</small></summary>
    ${itens.map((o) => `<div class="item">
      <div class="linha" style="flex-wrap:wrap;gap:8px"><div><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario}</small></div>${pill("Código " + esc(o.codigo), "neutral")}</div>
      <p style="margin-top:8px;white-space:pre-line">${esc(o.descricao)}</p>
      <small>Responsável notificado em ${o.notificado_em} • Buscado por ${esc(o.buscado_por)}</small>
      ${seloAssinatura("Registrado e assinado pelo professor", o.professor_nome, o.assinada_em, o.codigo)}
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

// ---------- Ocorrências no Portal dos Pais: o responsável lê o registro do professor e assina que tomou ciência ----------
function telaOcorrenciasPai() {
  const msg = dados.ocorrenciaMsg || ""; dados.ocorrenciaMsg = "";
  const cartao = (o) => {
    const nova = !o.resp_assinada_em;
    return `<article class="card" style="margin-bottom:14px;${nova ? "border-left:4px solid var(--warning)" : ""}">
    <div class="linha" style="flex-wrap:wrap;gap:8px"><div><b>${esc(o.aluno_nome)}</b><small>${esc(o.turma)} • ${dataBR(o.data)} às ${o.horario}</small></div>
      ${nova ? pill("Nova • aguardando sua assinatura", "warning") : pill("Assinada", "success")}</div>
    <p style="margin-top:10px;white-space:pre-line">${esc(o.descricao)}</p>
    <small style="margin-top:6px">Responsável notificado em ${o.notificado_em} • Buscado por ${esc(o.buscado_por)}</small>
    ${seloAssinatura("Registrado e assinado pelo professor", o.professor_nome, o.assinada_em, o.codigo)}
    ${nova ? caixaAssinar("Sua assinatura digital (responsável)", `data-oc-assin="${o.id}"`)
      : seloAssinatura("Sua ciência (responsável)", o.resp_nome, o.resp_assinada_em, o.resp_codigo)}
  </article>`;
  };
  return `<div class="topo"><h2>Ocorrências</h2><small>Registros feitos pelo professor sobre o seu filho. Leia e assine para confirmar que você tomou ciência.</small></div>
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
      <div style="margin-top:12px"><small>Texto (não cite nomes de alunos: todas as famílias leem este aviso — ECA, arts. 17 e 18)</small><textarea id="com-texto" rows="4" maxlength="1500" required></textarea></div>
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
      <div class="linha" style="margin-top:12px"><small>Lido por <b>${c.lidos}</b> de <b>${c.destinatarios}</b> aluno(s)</small><small>${p}%</small></div>
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
        if (!confirm(`Este comunicado cita o nome de aluno(s): ${e.alunos.join(", ")}.\n\nTodas as famílias que recebem o aviso vão ler. Publicar mesmo assim?`)) return;
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
      <div><small>Validade / data</small><input id="aut-validade" maxlength="50" placeholder="Ex.: 25 de outubro"></div></div>
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
      <div class="linha" style="gap:8px;flex-wrap:wrap"><div><b>${esc(g.titulo)}</b><small>${ico("calendario")} ${esc(g.validade || "—")} • criada em ${g.criada_em} por ${esc(g.criada_por_nome)}</small></div>${g.assinadas === g.total ? pill("Todas assinadas", "success") : pill(`${g.total - g.assinadas} pendente(s)`, "warning")}</div>
      ${g.detalhe ? `<small style="margin-top:6px">${esc(g.detalhe)}</small>` : ""}
      <div class="linha" style="margin-top:12px"><small>Assinadas: <b>${g.assinadas}</b> de <b>${g.total}</b></small><small>${p}%</small></div><div class="barra"><i style="width:${p}%"></i></div>
      <button class="btn outline pequeno" data-grupo="${g.grupo}" style="margin-top:12px">Ver detalhes</button><div id="grp-${g.grupo}" class="oculto" style="margin-top:10px"></div></article>`;
  }).join("") : vazio("Nenhuma autorização enviada ainda.");
  document.querySelectorAll("[data-grupo]").forEach((b) => b.onclick = seguro(async () => {
    const box = document.getElementById("grp-" + b.dataset.grupo);
    if (!box.classList.contains("oculto")) { box.classList.add("oculto"); return; }
    const lista = await api(`/api/autorizacoes-grupos/${b.dataset.grupo}`);
    box.innerHTML = `<div class="tabela"><table><thead><tr><th>Aluno</th><th>Situação</th><th>Assinada por</th><th>Data e hora</th><th>Código</th></tr></thead><tbody>${lista.map((l) => `<tr><td><b>${esc(l.nome)}</b><small>${esc(l.sala)}</small></td>
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
        validade: document.getElementById("aut-validade").value, detalhe: document.getElementById("aut-detalhe").value, sala: document.getElementById("aut-sala").value }) });
      document.getElementById("form-aut").reset();
      dados.grupos = await api("/api/autorizacoes-grupos"); desenharGrupos();
      ok.textContent = `Autorização enviada para ${r.alunos} aluno(s)!`; ok.classList.remove("oculto");
    } catch (erro) { if (erro.message !== "Sessão expirada") mostrarErro("aut-erro", erro.message); }
  };
}

// ---------- Navegação ----------
async function mostrar(id) {
  tela = id;
  clearInterval(timerTela); clearInterval(timerBanner);
  document.getElementById("titulo").textContent = titulos[id];
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
      dados.chamada = Object.fromEntries(dados.turma.alunos.map((a) => [a.id, a.status_hoje || "Presente"]));
    }
    if (id === "pais") {
      const alunoId = usuarioLogado.aluno_id;
      dados.filho = await api(`/api/alunos/${alunoId}`);
      dados.historico = await api(`/api/presencas/${alunoId}?dias=30`);
      dados.ficha = await api(`/api/alunos/${alunoId}/ficha`);
      dados.agora = await api(`/api/alunos/${alunoId}/agora`); dados.banners = await api("/api/eventos/banners");
      dados.fichaAba = dados.ficha.autorizacoes.some((a) => !a.assinada) ? "autorizacoes" : "comunicados";
    }
    document.getElementById("tela").innerHTML = {
      secretaria: telaSecretaria, seguranca: telaSeguranca, pais: telaPais, frequencia: telaFrequencia, busca: telaBusca,
      relatorio: telaRelatorio, cadastro: telaCadastroAluno, usuarios: telaUsuarios, logs: telaLogs, turma: telaTurma,
      ficha: telaFicha, comunicados: telaComunicados, autorizacoes: telaAutorizacoes, consentimentos: telaConsentimentos, protecao: telaProtecao,
      calendario: telaCalendario, perfil: telaPerfil, ocorrencias: usuarioLogado.papel === "pai" ? telaOcorrenciasPai : telaOcorrencias,
    }[id]();
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
    if (id === "logs") document.getElementById("logs-conferir").onclick = seguro(async () => {
      const r = await api("/api/logs/integridade"), caixa = document.getElementById("logs-integridade");
      caixa.innerHTML = r.ok ? `<p class="pill success" style="margin-top:10px;white-space:normal">${r.conferidos} registro(s) conferido(s): nenhum foi apagado ou alterado.</p>`
        : `<p class="pill danger" style="margin-top:10px;white-space:normal">Corrente quebrada no registro nº ${r.problema_em.id} (${esc(r.problema_em.quando)}, ${esc(acaoLabel(r.problema_em.acao))}): um registro foi apagado ou alterado logo antes ou nele.</p>`;
    });
    if (id === "comunicados") ligarComunicados();
    if (id === "protecao") ligarProtecao();
    if (id === "autorizacoes") ligarAutorizacoes();
    if (id === "pais") {
      desenharFicha();
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
  const contador = (m) => (m.id === "ocorrencias" && novas ? `<span class="contador" title="${novas} ocorrência(s) nova(s)">${novas}</span>` : "");
  const trocouAba = ativa !== ultimaAbaAtiva; ultimaAbaAtiva = ativa;
  const classe = (m) => (m.id === ativa ? `ativo${trocouAba ? " entrou" : ""}` : "");
  document.getElementById("nav").innerHTML = menus.map((m) => `<button class="${classe(m)}" data-id="${m.id}">${iconeMenu(m.icone)}<span><b>${m.nome}</b><small>${m.dica}</small></span>${contador(m)}</button>`).join("");
  document.getElementById("btn-menu").classList.toggle("tem-aviso", novas > 0); // no celular o menu fica fechado: um ponto no ☰ avisa
  document.querySelectorAll("#nav button").forEach((b) => b.onclick = () => mostrar(b.dataset.id));
}
function fecharMenu() { menu.classList.remove("aberto"); overlay.classList.remove("aberto"); }
document.getElementById("btn-menu").onclick = () => { menu.classList.add("aberto"); overlay.classList.add("aberto"); };
document.getElementById("overlay").onclick = fecharMenu;

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
