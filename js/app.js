// S.I.V.E. — versão em HTML, CSS e JavaScript puro
let dados = {};
let tela = "";
let liberada = false;
let logs = [];
let timerAcesso = null;
let simulado = false;
let usuarioLogado = null; // { token, papel, nome, aluno_id, sala, senha_temporaria }
let forcarTrocaSenha = false;

// Chama a API do servidor Node e devolve o JSON, já enviando o login (token)
async function api(url, opcoes = {}) {
  const resposta = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(usuarioLogado ? { Authorization: "Bearer " + usuarioLogado.token } : {}) },
    ...opcoes,
  });
  if (resposta.status === 401 || resposta.status === 403) {
    const corpo = await resposta.json().catch(() => ({}));
    if (resposta.status === 401) { sair(); throw new Error("Sessão expirada"); }
    throw new Error(corpo.erro || "Acesso negado");
  }
  if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).erro || "Falha na API");
  return resposta.json();
}
// Usado nos botões: se a API der erro, avisa na tela em vez de falhar em silêncio
const seguro = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { if (e.message !== "Sessão expirada") alert(e.message); }
};

const menusPorPapel = {
  admin: [
    { id: "secretaria", nome: "Central do Dia", dica: "Secretaria", icone: "🏠" },
    { id: "seguranca", nome: "Monitoramento", dica: "Segurança", icone: "🛡️" },
    { id: "frequencia", nome: "Frequência", dica: "Presença e faltas", icone: "📅" },
    { id: "busca", nome: "Busca Ativa", dica: "Faltas e acompanhamento", icone: "🔎" },
    { id: "relatorio", nome: "Relatório Mensal", dica: "Frequência e casos", icone: "📊" },
    { id: "cadastro", nome: "Cadastrar Aluno", dica: "Novo aluno", icone: "➕" },
    { id: "usuarios", nome: "Usuários", dica: "Acessos ao sistema", icone: "🔐" },
    { id: "logs", nome: "Logs", dica: "Atividade do sistema", icone: "📜" },
  ],
  pai: [
    { id: "pais", nome: "Portal dos Pais", dica: "Meu filho", icone: "👪" },
  ],
  professor: [
    { id: "turma", nome: "Minha Turma", dica: "Chamada e contatos", icone: "📚" },
  ],
};
const titulos = {
  secretaria: "Central do Dia", seguranca: "Painel de Segurança", pais: "Portal dos Pais",
  frequencia: "Controle de Frequência", busca: "Busca Ativa", relatorio: "Relatório Mensal",
  cadastro: "Cadastrar Aluno", usuarios: "Usuários do Sistema", logs: "Logs de Atividade", turma: "Minha Turma",
};
const papelLabel = (p) => ({ admin: "Gestão", pai: "Responsável", professor: "Professor(a)", sistema: "Sistema" }[p] || p);
const acaoLabel = (a) => ({
  login_sucesso: "Login", login_falha: "Tentativa de login falhou", cadastro_aluno: "Cadastrou aluno",
  cadastro_usuario: "Cadastrou usuário", troca_senha: "Trocou a senha", autorizacao_alternada: "Alterou autorização",
  liberacao_saida: "Liberou saída", reativar_usuario: "Reativou usuário", desativar_usuario: "Desativou usuário",
  chamada_registrada: "Registrou a chamada", busca_ativa_aberta: "Abriu caso de Busca Ativa (automático)",
  busca_ativa_acompanhamento: "Anotou acompanhamento (Busca Ativa)", busca_ativa_encerrada: "Encerrou caso de Busca Ativa",
  relatorio_mensal: "Gerou relatório mensal",
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
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });
    const dadosLogin = await r.json();
    if (!r.ok) throw new Error(dadosLogin.erro || "Não foi possível entrar");
    usuarioLogado = dadosLogin;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    if (usuarioLogado.senha_temporaria) mostrarTelaSenha(true); else entrarNoApp();
  } catch (erro) {
    erroBox.textContent = erro.message;
    erroBox.classList.remove("oculto");
  }
};
function sair() {
  usuarioLogado = null;
  localStorage.removeItem("sive-usuario");
  document.getElementById("app").classList.add("oculto");
  document.getElementById("tela-senha").classList.add("oculto");
  document.getElementById("tela-login").classList.remove("oculto");
  document.getElementById("form-login").reset();
}
document.getElementById("btn-sair").onclick = sair;

function entrarNoApp() {
  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("tela-senha").classList.add("oculto");
  document.getElementById("app").classList.remove("oculto");
  document.getElementById("user-nome").textContent = usuarioLogado.nome;
  document.getElementById("user-papel").textContent = papelLabel(usuarioLogado.papel);
  document.getElementById("user-iniciais").textContent = iniciais(usuarioLogado.nome);
  const telaInicial = { admin: "secretaria", pai: "pais", professor: "turma" }[usuarioLogado.papel];
  mostrar(telaInicial);
}
// Mantém o login se a página for recarregada
const salvo = localStorage.getItem("sive-usuario");
if (salvo) {
  usuarioLogado = JSON.parse(salvo);
  if (usuarioLogado.senha_temporaria === undefined) { localStorage.removeItem("sive-usuario"); usuarioLogado = null; }
}
if (usuarioLogado) {
  if (usuarioLogado.senha_temporaria) mostrarTelaSenha(true); else entrarNoApp();
}

// ---------- Troca de senha (forçada no primeiro acesso, ou voluntária pelo botão 🔑) ----------
function mostrarTelaSenha(forcado) {
  forcarTrocaSenha = forcado;
  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("app").classList.add("oculto");
  document.getElementById("tela-senha").classList.remove("oculto");
  document.getElementById("senha-subtitulo").textContent = forcado
    ? "Sua senha é provisória — crie uma nova para continuar."
    : "Atualize sua senha quando quiser.";
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
    await api("/api/minha-senha", { method: "PUT", body: JSON.stringify({
      senha_atual: document.getElementById("senha-atual").value, senha_nova: nova,
    }) });
    usuarioLogado.senha_temporaria = false;
    localStorage.setItem("sive-usuario", JSON.stringify(usuarioLogado));
    document.getElementById("form-senha").reset();
    document.getElementById("tela-senha").classList.add("oculto");
    if (forcarTrocaSenha) entrarNoApp(); else document.getElementById("app").classList.remove("oculto");
  } catch (erro) {
    erroBox.textContent = erro.message;
    erroBox.classList.remove("oculto");
  }
};

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
  <div class="grade g3">
    ${metrica("👥", "Total de Alunos", r.total_alunos, "alunos cadastrados", "info", "Escola")}
    ${metrica("✅", "Presentes", r.presentes, r.percentual == null ? "Sem chamada registrada" : `${pct(r.percentual)} de presença`, "success", tag)}
    ${metrica("⚠️", "Ausentes", r.ausentes, `${r.busca_ativa} em Busca Ativa`, "warning", tag)}
  </div>
  <div class="topo"><h2>Atenção necessária</h2><small>Pendências que precisam de acompanhamento.</small></div>
  <div class="grade g3">
    ${alerta("⚠️", r.busca_ativa, "Crianças em busca ativa", "Por excesso de faltas", "danger", "busca")}
    ${alerta("📄", "—", "Documentos aguardando", "Disponível em breve", "warning")}
    ${alerta("📋", r.autorizacoes_pendentes, "Autorizações pendentes", "Aguardando assinatura", "info")}
  </div>
  <section class="card"><div class="linha" style="flex-wrap:wrap"><div><h2>Gestão de alunos</h2><small>Informações e pendências recentes.</small></div>
    <input id="busca" placeholder="🔍 Buscar aluno..." style="max-width:280px"></div>
    <div class="tabela"><table><thead><tr><th>Nome da criança</th><th>Comunicados</th><th>Autorizações</th><th>Pendências</th><th>Ações</th></tr></thead>
    <tbody id="linhas"></tbody></table></div></section>`;
}
function desenharAlunos(filtro = "") {
  const lista = dados.alunos.filter((a) => a.nome.toLowerCase().includes(filtro.toLowerCase()));
  document.getElementById("linhas").innerHTML = lista.map((a) => `<tr>
    <td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${esc(a.nome)}</b><small>${esc(a.sala)}</small></div></div></td>
    <td>${a.comunicados}</td>
    <td>${pill(a.autorizacao, a.autorizacao.includes("pendente") ? "warning" : "success")}</td>
    <td>${pill(a.pendencia, a.tom === "ok" ? "neutral" : a.tom)}</td><td>⋯</td></tr>`).join("");
}

// ---------- Controle de frequência (administração) ----------
function telaFrequencia() {
  return `<div class="topo"><h2>Controle de frequência</h2><small>Presença e faltas por dia. Clique em "Histórico" para ver o detalhe de cada aluno.</small></div>
  <div class="grade g4" id="freq-cards"></div>
  <section class="card">
    <div class="linha" style="flex-wrap:wrap;align-items:flex-end;gap:12px">
      <div><small>Data</small><input type="date" id="freq-data" style="max-width:200px"></div>
      <input id="freq-busca" placeholder="🔍 Buscar aluno..." style="max-width:280px">
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
    metrica("👥", "Total de Alunos", f.total, "alunos cadastrados", "info", tag) +
    metrica("✅", "Presentes", f.presentes, f.presentes + f.ausentes ? `${pct(calcPct(f.presentes, f.ausentes))} de presença` : "Sem chamada neste dia", "success", tag) +
    metrica("🚫", "Ausentes", f.ausentes, "faltas no dia", "danger", tag) +
    metrica("❔", "Sem registro", f.sem_registro, "chamada não feita", "neutral", tag);
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
}

// ---------- Relatório mensal (administração) ----------
function telaRelatorio() {
  return `<div class="linha no-print" style="flex-wrap:wrap;align-items:flex-end;justify-content:flex-start;gap:12px;margin-bottom:16px">
    <div><small>Mês</small><input type="month" id="rel-mes" style="max-width:200px"></div>
    <button class="btn outline pequeno" id="rel-imprimir">🖨️ Imprimir / salvar em PDF</button>
    <button class="btn outline pequeno" id="rel-csv">⬇️ Baixar planilha (CSV)</button>
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
      ${metrica("👥", "Alunos", s.total_alunos, "cadastrados", "info", "Mês")}
      ${metrica("📅", "Dias com chamada", s.dias_com_registro, "dias com registro", "neutral", "Mês")}
      ${metrica("✅", "Frequência média", pct(s.percentual), `${s.presencas} presenças`, "success", "Mês")}
      ${metrica("🚫", "Total de faltas", s.faltas, "no mês", "danger", "Mês")}
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

// ---------- Tela de Segurança ----------
function telaSeguranca() {
  return `<div class="grade g3">
    <div class="card"><small>Acessos confirmados</small><div class="linha"><b style="font-size:30px">786</b>${pill("Tempo real", "success")}</div></div>
    <div class="card"><small>Portões ativos</small><div class="linha"><b style="font-size:30px">3/3</b><small>Todos online</small></div></div>
    <div class="card"><small>Última sincronização</small><div class="linha"><b style="font-size:30px">Agora</b>✅</div></div>
  </div>
  <div class="grade dois">
    <section class="card"><div class="linha"><div><h2>Acessos em tempo real</h2><small>Reconhecimento facial nas salas</small></div><span class="pill success">● AO VIVO</span></div><div id="logs"></div></section>
    <section class="card"><h2>Liberação de saída</h2><small>Consulte antes de autorizar a retirada.</small>
      <input id="buscaSaida" placeholder="Digite João Pedro Silva..." style="margin-top:16px"><div id="resultado"></div></section>
  </div>`;
}
function desenharLogsAoVivo(novo) {
  document.getElementById("logs").innerHTML = logs.map((l, i) => `<div class="log ${novo && i === 0 ? "novo" : ""}">
    <div class="icone success">✔</div><div><b>Entrada confirmada: ${esc(l.nome)}</b><small>${esc(l.sala)} • Câmera validada</small></div><small>${l.hora}</small></div>`).join("");
}
async function desenharSaida() {
  const texto = document.getElementById("buscaSaida").value.trim();
  const box = document.getElementById("resultado");
  const vazio = `<div class="vazio"><b>Busque pelo nome do aluno</b><small>Os responsáveis autorizados aparecerão aqui.</small></div>`;
  if (texto.length < 3) { box.innerHTML = vazio; return; }
  const r = await api("/api/saida?nome=" + encodeURIComponent(texto));
  if (!r) { box.innerHTML = vazio; return; }
  box.innerHTML = `<div class="linha info" style="padding:12px;border-radius:8px;margin-top:20px"><div><b>${esc(r.aluno.nome)}</b><small>${esc(r.aluno.sala)} • Matrícula ${esc(r.aluno.matricula)}</small></div>${pill("Na escola", "success")}</div>
    <small style="margin-top:16px;font-weight:700;text-transform:uppercase">Responsáveis autorizados para retirada</small>
    <div class="responsaveis resp-2">${r.responsaveis.map((x) => `<article class="resp"><div class="aluno"><img src="${x.foto || ""}" alt="${esc(x.nome)}"><div><b>${esc(x.nome)}</b><small>${esc(x.parentesco)}</small></div></div><small style="margin-top:10px">📞 ${esc(x.telefone)}</small></article>`).join("")}</div>
    <button class="btn" id="liberar" ${liberada ? "disabled" : ""}>${liberada ? "✅ Saída liberada" : "🛡️ Confirmar liberação"}</button>`;
  document.getElementById("liberar").onclick = async () => {
    await api("/api/saidas", { method: "POST", body: JSON.stringify({ aluno_id: r.aluno.id }) });
    liberada = true; desenharSaida();
  };
}

// ---------- Cadastro de aluno ----------
function telaCadastroAluno() {
  return `<div class="topo"><h2>Cadastrar aluno</h2><small>Preencha os dados da criança e dos responsáveis.</small></div>
  <form id="form-aluno" class="card" style="max-width:680px">
    <small>Nome da criança</small><input id="ca-nome" required>
    <div class="grade dois" style="margin-top:12px">
      <div><small>Turma / sala</small><input id="ca-sala" placeholder="Ex.: 2º Ano B" required></div>
      <div><small>Matrícula</small><input id="ca-matricula" placeholder="Opcional"></div>
    </div>
    <div class="linha" style="margin-top:22px"><b>Responsáveis (pais, etc.)</b>
      <button type="button" class="btn outline" id="ca-add-resp" style="width:auto;padding:6px 14px;margin-top:0">+ Adicionar</button></div>
    <div id="ca-responsaveis"></div>
    <p id="ca-erro" class="pill danger oculto" style="margin-top:14px"></p>
    <p id="ca-sucesso" class="pill success oculto" style="margin-top:14px"></p>
    <button class="btn" type="submit" style="margin-top:18px;max-width:220px">Cadastrar aluno</button>
  </form>`;
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
  const lista = document.getElementById("ca-responsaveis");
  lista.innerHTML = linhaResponsavel();
  wireRemoverResponsavel();
  document.getElementById("ca-add-resp").onclick = () => { lista.insertAdjacentHTML("beforeend", linhaResponsavel()); wireRemoverResponsavel(); };
  document.getElementById("form-aluno").onsubmit = async (e) => {
    e.preventDefault();
    const erroBox = document.getElementById("ca-erro"), sucessoBox = document.getElementById("ca-sucesso");
    erroBox.classList.add("oculto"); sucessoBox.classList.add("oculto");
    const responsaveis = [...document.querySelectorAll("[data-linha-resp]")].map((linha) => ({
      nome: linha.querySelector(".r-nome").value.trim(),
      parentesco: linha.querySelector(".r-parentesco").value,
      telefone: linha.querySelector(".r-telefone").value.trim(),
    })).filter((r) => r.nome);
    try {
      await api("/api/alunos", { method: "POST", body: JSON.stringify({
        nome: document.getElementById("ca-nome").value.trim(),
        sala: document.getElementById("ca-sala").value.trim(),
        matricula: document.getElementById("ca-matricula").value.trim(),
        responsaveis,
      }) });
      document.getElementById("form-aluno").reset();
      lista.innerHTML = linhaResponsavel(); wireRemoverResponsavel();
      sucessoBox.textContent = "Aluno cadastrado com sucesso!";
      sucessoBox.classList.remove("oculto");
    } catch (erro) {
      erroBox.textContent = erro.message;
      erroBox.classList.remove("oculto");
    }
  };
}

// ---------- Usuários do sistema ----------
function telaUsuarios() {
  return `<section class="card">
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
      <div id="nu-campo-sala" class="oculto" style="margin-top:12px"><small>Turma que leciona</small><input id="nu-sala" placeholder="Ex.: 2º Ano B"></div>
      <p id="nu-erro" class="pill danger oculto" style="margin-top:12px"></p>
      <div id="nu-sucesso" class="oculto pill success" style="margin-top:12px;display:block"></div>
      <button class="btn" type="submit" style="margin-top:16px;max-width:220px">Criar usuário</button>
    </form>
  </section>
  <section class="card" style="margin-top:20px">
    <h2>Usuários cadastrados</h2>
    <div class="tabela"><table><thead><tr><th>Nome</th><th>Login</th><th>Papel</th><th>Vínculo</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody id="lista-usuarios"></tbody></table></div>
  </section>`;
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
}
function desenharListaUsuarios() {
  document.getElementById("lista-usuarios").innerHTML = dados.usuarios.map((u) => `<tr>
    <td>${esc(u.nome)}</td><td>${esc(u.usuario)}</td><td>${papelLabel(u.papel)}</td>
    <td>${esc(u.aluno_nome || u.sala || "—")}</td>
    <td>${pill(u.ativo ? "Ativo" : "Inativo", u.ativo ? "success" : "neutral")} ${u.senha_temporaria ? pill("Senha provisória", "warning") : ""}</td>
    <td><button class="btn outline" data-id="${u.id}" data-ativo="${u.ativo ? 0 : 1}" style="width:auto;padding:4px 12px">${u.ativo ? "Desativar" : "Ativar"}</button></td>
  </tr>`).join("");
  document.querySelectorAll("#lista-usuarios button").forEach((b) => b.onclick = async () => {
    await api(`/api/usuarios/${b.dataset.id}/ativo`, { method: "PUT", body: JSON.stringify({ ativo: b.dataset.ativo === "1" }) });
    dados.usuarios = await api("/api/usuarios"); desenharListaUsuarios();
  });
}

// ---------- Logs de atividade ----------
function telaLogs() {
  return `<div class="topo"><h2>Logs de atividade</h2><small>Últimas ações registradas no sistema, com quem fez o quê.</small></div>
  <section class="card"><div class="tabela"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Papel</th><th>Ação</th><th>Detalhe</th></tr></thead>
  <tbody>${dados.logs.map((l) => `<tr><td>${l.quando}</td><td>${esc(l.nome_usuario)}</td><td>${papelLabel(l.papel)}</td><td>${acaoLabel(l.acao)}</td><td>${esc(l.detalhe || "—")}</td></tr>`).join("")}</tbody></table></div></section>`;
}

// ---------- Minha Turma e chamada (professor) ----------
function telaTurma() {
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const alunos = dados.turma.alunos;
  const registrada = alunos.length > 0 && alunos.every((a) => a.status_hoje);
  const salva = dados.chamadaSalva; dados.chamadaSalva = false;
  return `<div class="topo"><h2>Minha turma — ${esc(usuarioLogado.sala)}</h2><small>Chamada de hoje (${hoje}) e contato dos responsáveis.</small></div>
  <section class="card"><div class="linha" style="flex-wrap:wrap;gap:8px"><h2>Chamada de hoje</h2>${registrada ? pill("Chamada registrada hoje", "success") : pill("Ainda não registrada", "warning")}</div>
    ${alunos.length ? `<div class="tabela"><table><thead><tr><th>Aluno</th><th>Hoje</th><th>Faltas (${dados.turma.dias_faltas} dias)</th><th>Pendência</th><th>Responsáveis</th></tr></thead>
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
      <td><div class="seg"><button class="${s === "Presente" ? "on-p" : ""}" data-aluno="${a.id}" data-status="Presente">Presente</button><button class="${s === "Ausente" ? "on-a" : ""}" data-aluno="${a.id}" data-status="Ausente">Ausente</button></div></td>
      <td>${pill(a.faltas, a.faltas >= 5 ? "danger" : a.faltas > 0 ? "warning" : "neutral")}</td>
      <td>${pill(esc(a.pendencia), a.pendencia === "Nenhuma" ? "neutral" : "warning")}</td><td>${esc(a.responsaveis || "—")}</td></tr>`;
  }).join("");
  corpo.querySelectorAll("[data-aluno]").forEach((b) => b.onclick = () => { dados.chamada[b.dataset.aluno] = b.dataset.status; desenharChamada(); });
  document.getElementById("chamada-salvar").onclick = seguro(async () => {
    await api("/api/chamada", { method: "POST", body: JSON.stringify({
      registros: Object.entries(dados.chamada).map(([id, status]) => ({ aluno_id: Number(id), status })),
    }) });
    dados.chamadaSalva = true;
    await mostrar("turma");
  });
}

// ---------- Portal dos Pais ----------
function telaPais() {
  const h = dados.historico, hoje = h.hoje;
  const status = hoje ? (hoje.status === "Presente" ? "Na Escola" : "Ausente hoje") : "Sem registro hoje";
  const selo = hoje ? (hoje.status === "Presente" ? "● Seguro" : "● Ausente") : "● Sem registro";
  return `<div class="topo"><small>Olá, ${esc(usuarioLogado.nome.split(" ")[0])}</small><h2>Acompanhe ${dados.filho ? "o(a) " + esc(dados.filho.nome.split(" ")[0]) : "seu filho"}</h2></div>
  <div class="grade pais" style="align-items:start"><div>
    <section class="status"><div class="linha"><div><small style="color:#dbe6ff">Status agora</small><h3>${status}</h3></div><span class="pill" style="background:rgba(255,255,255,.2)">${selo}</span></div>
      <hr style="margin:20px 0;opacity:.3"><small style="color:#dbe6ff">Registro de hoje</small><b>${hoje ? esc(hoje.observacao) : "Chamada ainda não registrada"}</b>
      <small style="color:#dbe6ff;margin-top:10px">Turma</small><b>${dados.filho ? esc(dados.filho.sala) : "—"}</b></section>
    <div class="topo" style="margin-top:24px"><h2>Autorizações digitais</h2><small>Revise e aprove com um toque.</small></div><div id="autorizacoes"></div></div>
    <aside class="card"><h2>Histórico de presença</h2><small>Últimos ${h.dias} dias</small>
      ${blocoHistorico(h)}
      <button class="btn outline">✉️ Solicitar relatório</button></aside></div>`;
}
function desenharAutorizacoes() {
  document.getElementById("autorizacoes").innerHTML = dados.autorizacoes.map((a) => {
    const ok = !!a.aprovada;
    return `<article class="card" style="margin-bottom:12px"><div class="linha"><div><b>${esc(a.titulo)}</b><small>📅 ${esc(a.data)}</small><small style="margin-top:6px">${esc(a.detalhe)}</small></div>${ok ? '<span class="icone success">✔</span>' : ""}</div>
      <button class="btn ${ok ? "outline" : ""}" data-id="${a.id}">${ok ? "Autorização aprovada" : "Revisar e aprovar"}</button></article>`;
  }).join("");
  document.querySelectorAll("#autorizacoes button").forEach((b) => b.onclick = async () => {
    await api(`/api/autorizacoes/${b.dataset.id}/alternar`, { method: "PUT" });
    dados.autorizacoes = await api(`/api/autorizacoes/${usuarioLogado.aluno_id}`);
    desenharAutorizacoes();
  });
}

// ---------- Navegação ----------
async function mostrar(id) {
  tela = id;
  clearTimeout(timerAcesso);
  document.getElementById("titulo").textContent = titulos[id];
  desenharMenu();
  fecharMenu();
  try {
    if (id === "secretaria") { dados.resumo = await api("/api/resumo"); dados.alunos = await api("/api/alunos"); }
    if (id === "seguranca") logs = await api("/api/acessos");
    if (id === "frequencia") dados.freq = await api("/api/frequencia");
    if (id === "busca") dados.busca = await api("/api/busca-ativa");
    if (id === "relatorio") dados.relatorio = await api("/api/relatorio-mensal");
    if (id === "usuarios") { dados.alunos = await api("/api/alunos"); dados.usuarios = await api("/api/usuarios"); }
    if (id === "logs") dados.logs = await api("/api/logs");
    if (id === "turma") {
      dados.turma = await api("/api/minha-turma");
      dados.chamada = Object.fromEntries(dados.turma.alunos.map((a) => [a.id, a.status_hoje || "Presente"]));
    }
    if (id === "pais") {
      const alunoId = usuarioLogado.aluno_id;
      dados.filho = await api(`/api/alunos/${alunoId}`);
      dados.autorizacoes = await api(`/api/autorizacoes/${alunoId}`);
      dados.historico = await api(`/api/presencas/${alunoId}?dias=30`);
    }
    document.getElementById("tela").innerHTML = {
      secretaria: telaSecretaria, seguranca: telaSeguranca, pais: telaPais, frequencia: telaFrequencia, busca: telaBusca,
      relatorio: telaRelatorio, cadastro: telaCadastroAluno, usuarios: telaUsuarios, logs: telaLogs, turma: telaTurma,
    }[id]();
    if (id === "secretaria") {
      desenharAlunos(); document.getElementById("busca").oninput = (e) => desenharAlunos(e.target.value);
      document.querySelectorAll("[data-ir]").forEach((b) => b.onclick = () => mostrar(b.dataset.ir));
    }
    if (id === "seguranca") {
      desenharLogsAoVivo(false); desenharSaida();
      document.getElementById("buscaSaida").oninput = () => { liberada = false; desenharSaida(); };
      if (!simulado) timerAcesso = setTimeout(async () => { // simula a Beatriz entrando (uma vez)
        simulado = true;
        await api("/api/acessos", { method: "POST", body: JSON.stringify({ aluno_id: 5, sala: "Sala 4" }) });
        logs = await api("/api/acessos");
        if (tela === "seguranca") desenharLogsAoVivo(true);
      }, 3500);
    }
    if (id === "frequencia") ligarFrequencia();
    if (id === "busca") desenharBusca();
    if (id === "relatorio") ligarRelatorio();
    if (id === "cadastro") desenharCadastroAluno();
    if (id === "usuarios") desenharUsuarios();
    if (id === "turma") desenharChamada();
    if (id === "pais") desenharAutorizacoes();
  } catch (erro) {
    if (usuarioLogado) document.getElementById("tela").innerHTML = `<div class="card"><b>Não foi possível carregar os dados.</b><small>${erro.message === "Sessão expirada" ? "Faça login novamente." : esc(erro.message)}</small></div>`;
  }
}
function desenharMenu() {
  const menus = menusPorPapel[usuarioLogado.papel];
  document.getElementById("nav").innerHTML = menus.map((m) => `<button class="${m.id === tela ? "ativo" : ""}" data-id="${m.id}"><span>${m.icone}</span><span><b>${m.nome}</b><small>${m.dica}</small></span></button>`).join("");
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
}
atualizarRelogio();
setInterval(atualizarRelogio, 1000);
