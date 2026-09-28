// S.I.V.E. — versão em HTML, CSS e JavaScript puro
let dados = {};
let tela = "secretaria";
let liberada = false;
let logs = [];
let timerAcesso = null;
let simulado = false;

// Chama a API do servidor Node e devolve o JSON
async function api(url, opcoes = {}) {
  const resposta = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opcoes });
  if (!resposta.ok) throw new Error("Falha na API");
  return resposta.json();
}

const menus = [
  { id: "secretaria", nome: "Central do Dia", dica: "Secretaria", icone: "🏠" },
  { id: "seguranca", nome: "Monitoramento", dica: "Segurança", icone: "🛡️" },
  { id: "pais", nome: "Portal dos Pais", dica: "Famílias", icone: "👪" },
];
const titulos = { secretaria: "Central do Dia", seguranca: "Painel de Segurança", pais: "Portal dos Pais" };

const pill = (texto, tom) => `<span class="pill ${tom}">${texto}</span>`;
const iniciais = (nome) => nome.split(" ").slice(0, 2).map((n) => n[0]).join("");

function metrica(icone, rotulo, valor, nota, tom, tag) {
  return `<article class="card metrica"><div class="linha"><div class="icone ${tom}">${icone}</div><small>${tag}</small></div>
    <small>${rotulo}</small><div class="num">${valor}</div><small>${nota}</small></article>`;
}
function alerta(icone, n, titulo, texto, tom) {
  return `<button class="card alerta"><div class="icone ${tom}">${icone}</div><div><b>${titulo}</b><small>${texto}</small></div><span class="num">${n}</span></button>`;
}

function telaSecretaria() {
  return `<div class="topo"><p class="destaque">Visão geral</p><h2>Bom dia, Mariana</h2><small>Acompanhe os indicadores e prioridades da escola.</small></div>
  <div class="grade g3">
    ${metrica("👥", "Total de Alunos", "842", "12 novas matrículas", "info", "Este ano")}
    ${metrica("✅", "Presentes Hoje", "786", "93,3% de presença", "success", "+1,8%")}
    ${metrica("⚠️", "Ausentes", "56", "7 faltas recorrentes", "warning", "+4 hoje")}
  </div>
  <div class="topo"><h2>Atenção necessária</h2><small>Pendências que precisam de acompanhamento.</small></div>
  <div class="grade g3">
    ${alerta("⚠️", "7", "Crianças em busca ativa", "Por faltas consecutivas", "danger")}
    ${alerta("📄", "18", "Documentos aguardando", "Entrega pelas famílias", "warning")}
    ${alerta("📋", "23", "Autorizações pendentes", "Aguardando assinatura", "info")}
  </div>
  <section class="card"><div class="linha" style="flex-wrap:wrap"><div><h2>Gestão de alunos</h2><small>Informações e pendências recentes.</small></div>
    <input id="busca" placeholder="🔍 Buscar aluno..." style="max-width:280px"></div>
    <div class="tabela"><table><thead><tr><th>Nome da criança</th><th>Comunicados</th><th>Autorizações</th><th>Pendências</th><th>Ações</th></tr></thead>
    <tbody id="linhas"></tbody></table></div></section>`;
}
function desenharAlunos(filtro = "") {
  const lista = dados.alunos.filter((a) => a.nome.toLowerCase().includes(filtro.toLowerCase()));
  document.getElementById("linhas").innerHTML = lista.map((a) => `<tr>
    <td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><div><b>${a.nome}</b><small>${a.sala}</small></div></div></td>
    <td>${a.comunicados}</td>
    <td>${pill(a.autorizacao, a.autorizacao.includes("pendente") ? "warning" : "success")}</td>
    <td>${pill(a.pendencia, a.tom === "ok" ? "neutral" : a.tom)}</td><td>⋯</td></tr>`).join("");
}

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
function desenharLogs(novo) {
  document.getElementById("logs").innerHTML = logs.map((l, i) => `<div class="log ${novo && i === 0 ? "novo" : ""}">
    <div class="icone success">✔</div><div><b>Entrada confirmada: ${l.nome}</b><small>${l.sala} • Câmera validada</small></div><small>${l.hora}</small></div>`).join("");
}
async function desenharSaida() {
  const texto = document.getElementById("buscaSaida").value.trim();
  const box = document.getElementById("resultado");
  const vazio = `<div class="vazio"><b>Busque pelo nome do aluno</b><small>Os responsáveis autorizados aparecerão aqui.</small></div>`;
  if (texto.length < 3) { box.innerHTML = vazio; return; }
  const r = await api("/api/saida?nome=" + encodeURIComponent(texto));
  if (!r) { box.innerHTML = vazio; return; }
  box.innerHTML = `<div class="linha info" style="padding:12px;border-radius:8px;margin-top:20px"><div><b>${r.aluno.nome}</b><small>${r.aluno.sala} • Matrícula ${r.aluno.matricula}</small></div>${pill("Na escola", "success")}</div>
    <small style="margin-top:16px;font-weight:700;text-transform:uppercase">Responsáveis autorizados para retirada</small>
    <div class="responsaveis resp-2">${r.responsaveis.map((x) => `<article class="resp"><div class="aluno"><img src="${x.foto}" alt="${x.nome}"><div><b>${x.nome}</b><small>${x.parentesco}</small></div></div><small style="margin-top:10px">📞 ${x.telefone}</small></article>`).join("")}</div>
    <button class="btn" id="liberar" ${liberada ? "disabled" : ""}>${liberada ? "✅ Saída liberada" : "🛡️ Confirmar liberação"}</button>`;
  document.getElementById("liberar").onclick = async () => {
    await api("/api/saidas", { method: "POST", body: JSON.stringify({ aluno_id: r.aluno.id }) });
    liberada = true; desenharSaida();
  };
}

function telaPais() {
  return `<div class="topo"><small>Olá, Ana Paula</small><h2>Acompanhe o João</h2></div>
  <div class="grade pais" style="align-items:start"><div>
    <section class="status"><div class="linha"><div><small style="color:#dbe6ff">Status agora</small><h3>Na Escola</h3></div><span class="pill" style="background:rgba(255,255,255,.2)">● Seguro</span></div>
      <hr style="margin:20px 0;opacity:.3"><small style="color:#dbe6ff">Último registro</small><b>Entrada na Sala 2 às 07:15</b></section>
    <div class="topo" style="margin-top:24px"><h2>Autorizações digitais</h2><small>Revise e aprove com um toque.</small></div><div id="autorizacoes"></div></div>
    <aside class="card"><h2>Histórico de presença</h2><small>Setembro de 2026</small>
      ${dados.historico.map((h) => `<div class="hist ${h.status === "Ausente" ? "ausente" : ""}"><span class="ponto"></span><div><b style="font-size:14px">${h.data}</b><small>${h.detalhe}</small></div>${pill(h.status, h.status === "Presente" ? "success" : "warning")}</div>`).join("")}
      <button class="btn outline">✉️ Solicitar relatório</button></aside></div>`;
}
function desenharAutorizacoes() {
  document.getElementById("autorizacoes").innerHTML = dados.autorizacoes.map((a) => {
    const ok = !!a.aprovada;
    return `<article class="card" style="margin-bottom:12px"><div class="linha"><div><b>${a.titulo}</b><small>📅 ${a.data}</small><small style="margin-top:6px">${a.detalhe}</small></div>${ok ? '<span class="icone success">✔</span>' : ""}</div>
      <button class="btn ${ok ? "outline" : ""}" data-id="${a.id}">${ok ? "Autorização aprovada" : "Revisar e aprovar"}</button></article>`;
  }).join("");
  document.querySelectorAll("#autorizacoes button").forEach((b) => b.onclick = async () => {
    await api(`/api/autorizacoes/${b.dataset.id}/alternar`, { method: "PUT" });
    dados.autorizacoes = await api("/api/autorizacoes/2");
    desenharAutorizacoes();
  });
}

async function mostrar(id) {
  tela = id;
  clearTimeout(timerAcesso);
  document.getElementById("titulo").textContent = titulos[id];
  desenharMenu();
  fecharMenu();
  try {
    // Busca no banco (via servidor) só o que a tela precisa
    if (id === "secretaria") dados.alunos = await api("/api/alunos");
    if (id === "seguranca") logs = await api("/api/acessos");
    if (id === "pais") {
      dados.autorizacoes = await api("/api/autorizacoes/2"); // 2 = João Pedro Silva
      const presencas = await api("/api/presencas/2");
      dados.historico = presencas.map((p) => ({
        data: new Date(p.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }),
        detalhe: p.observacao, status: p.status,
      }));
    }
    document.getElementById("tela").innerHTML = { secretaria: telaSecretaria, seguranca: telaSeguranca, pais: telaPais }[id]();
    if (id === "secretaria") { desenharAlunos(); document.getElementById("busca").oninput = (e) => desenharAlunos(e.target.value); }
    if (id === "seguranca") {
      desenharLogs(false); desenharSaida();
      document.getElementById("buscaSaida").oninput = () => { liberada = false; desenharSaida(); };
      if (!simulado) timerAcesso = setTimeout(async () => { // simula a Beatriz entrando (uma vez)
        simulado = true;
        await api("/api/acessos", { method: "POST", body: JSON.stringify({ aluno_id: 5, sala: "Sala 4" }) });
        logs = await api("/api/acessos");
        if (tela === "seguranca") desenharLogs(true);
      }, 3500);
    }
    if (id === "pais") desenharAutorizacoes();
  } catch (erro) {
    document.getElementById("tela").innerHTML = `<div class="card"><b>Não foi possível carregar os dados.</b><small>Confira se o servidor está rodando (npm start) e se o MySQL está ligado.</small></div>`;
  }
}
function desenharMenu() {
  document.getElementById("nav").innerHTML = menus.map((m) => `<button class="${m.id === tela ? "ativo" : ""}" data-id="${m.id}"><span>${m.icone}</span><span><b>${m.nome}</b><small>${m.dica}</small></span></button>`).join("");
  document.querySelectorAll("#nav button").forEach((b) => b.onclick = () => mostrar(b.dataset.id));
}
const fecharMenu = () => { menu.classList.remove("aberto"); overlay.classList.remove("aberto"); };
document.getElementById("btn-menu").onclick = () => { menu.classList.add("aberto"); overlay.classList.add("aberto"); };
document.getElementById("overlay").onclick = fecharMenu;

mostrar("secretaria");
