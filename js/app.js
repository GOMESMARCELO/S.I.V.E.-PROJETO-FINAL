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

const menusPorPapel = {
  admin: [
    { id: "secretaria", nome: "Central do Dia", dica: "Secretaria", icone: "🏠" },
    { id: "seguranca", nome: "Monitoramento", dica: "Segurança", icone: "🛡️" },
    { id: "cadastro", nome: "Cadastrar Aluno", dica: "Novo aluno", icone: "➕" },
    { id: "usuarios", nome: "Usuários", dica: "Acessos ao sistema", icone: "🔐" },
    { id: "logs", nome: "Logs", dica: "Atividade do sistema", icone: "📜" },
  ],
  pai: [
    { id: "pais", nome: "Portal dos Pais", dica: "Meu filho", icone: "👪" },
  ],
  professor: [
    { id: "turma", nome: "Minha Turma", dica: "Alunos e contatos", icone: "📚" },
  ],
};
const titulos = {
  secretaria: "Central do Dia", seguranca: "Painel de Segurança", pais: "Portal dos Pais",
  cadastro: "Cadastrar Aluno", usuarios: "Usuários do Sistema", logs: "Logs de Atividade", turma: "Minha Turma",
};
const papelLabel = (p) => ({ admin: "Gestão", pai: "Responsável", professor: "Professor(a)" }[p] || p);
const acaoLabel = (a) => ({
  login_sucesso: "Login", login_falha: "Tentativa de login falhou", cadastro_aluno: "Cadastrou aluno",
  cadastro_usuario: "Cadastrou usuário", troca_senha: "Trocou a senha", autorizacao_alternada: "Alterou autorização",
  liberacao_saida: "Liberou saída", reativar_usuario: "Reativou usuário", desativar_usuario: "Desativou usuário",
}[a] || a);

const pill = (texto, tom) => `<span class="pill ${tom}">${texto}</span>`;
const iniciais = (nome) => nome.split(" ").slice(0, 2).map((n) => n[0]).join("");

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

// ---------- Tela da Secretaria ----------
function metrica(icone, rotulo, valor, nota, tom, tag) {
  return `<article class="card metrica"><div class="linha"><div class="icone ${tom}">${icone}</div><small>${tag}</small></div>
    <small>${rotulo}</small><div class="num">${valor}</div><small>${nota}</small></article>`;
}
function alerta(icone, n, titulo, texto, tom) {
  return `<button class="card alerta"><div class="icone ${tom}">${icone}</div><div><b>${titulo}</b><small>${texto}</small></div><span class="num">${n}</span></button>`;
}
function telaSecretaria() {
  return `<div class="topo"><p class="destaque">Visão geral</p><h2>Bom dia, ${usuarioLogado.nome.split(" ")[0]}</h2><small>Acompanhe os indicadores e prioridades da escola.</small></div>
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
  selectAluno.innerHTML = dados.alunos.map((a) => `<option value="${a.id}">${a.nome} — ${a.sala}</option>`).join("");
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
    <td>${u.nome}</td><td>${u.usuario}</td><td>${papelLabel(u.papel)}</td>
    <td>${u.aluno_nome || u.sala || "—"}</td>
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
  <tbody>${dados.logs.map((l) => `<tr><td>${l.quando}</td><td>${l.nome_usuario}</td><td>${papelLabel(l.papel)}</td><td>${acaoLabel(l.acao)}</td><td>${l.detalhe || "—"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

// ---------- Minha Turma (professor) ----------
function telaTurma() {
  return `<div class="topo"><h2>Minha turma — ${usuarioLogado.sala}</h2><small>Alunos da turma e contato dos responsáveis.</small></div>
  <section class="card"><div class="tabela"><table><thead><tr><th>Aluno</th><th>Pendência</th><th>Responsáveis</th></tr></thead>
  <tbody>${dados.turma.map((a) => `<tr><td><div class="aluno"><span class="avatar">${iniciais(a.nome)}</span><b>${a.nome}</b></div></td>
    <td>${pill(a.pendencia, a.pendencia === "Nenhuma" ? "neutral" : "warning")}</td><td>${a.responsaveis || "—"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

// ---------- Portal dos Pais ----------
function telaPais() {
  return `<div class="topo"><small>Olá, ${usuarioLogado.nome.split(" ")[0]}</small><h2>Acompanhe ${dados.filho ? "o(a) " + dados.filho.nome.split(" ")[0] : "seu filho"}</h2></div>
  <div class="grade pais" style="align-items:start"><div>
    <section class="status"><div class="linha"><div><small style="color:#dbe6ff">Status agora</small><h3>Na Escola</h3></div><span class="pill" style="background:rgba(255,255,255,.2)">● Seguro</span></div>
      <hr style="margin:20px 0;opacity:.3"><small style="color:#dbe6ff">Turma</small><b>${dados.filho ? dados.filho.sala : "—"}</b></section>
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
    if (id === "secretaria") dados.alunos = await api("/api/alunos");
    if (id === "seguranca") logs = await api("/api/acessos");
    if (id === "usuarios") { dados.alunos = await api("/api/alunos"); dados.usuarios = await api("/api/usuarios"); }
    if (id === "logs") dados.logs = await api("/api/logs");
    if (id === "turma") dados.turma = await api("/api/minha-turma");
    if (id === "pais") {
      const alunoId = usuarioLogado.aluno_id;
      dados.filho = await api(`/api/alunos/${alunoId}`);
      dados.autorizacoes = await api(`/api/autorizacoes/${alunoId}`);
      const presencas = await api(`/api/presencas/${alunoId}`);
      dados.historico = presencas.map((p) => ({
        data: new Date(p.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }),
        detalhe: p.observacao, status: p.status,
      }));
    }
    document.getElementById("tela").innerHTML = {
      secretaria: telaSecretaria, seguranca: telaSeguranca, pais: telaPais,
      cadastro: telaCadastroAluno, usuarios: telaUsuarios, logs: telaLogs, turma: telaTurma,
    }[id]();
    if (id === "secretaria") { desenharAlunos(); document.getElementById("busca").oninput = (e) => desenharAlunos(e.target.value); }
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
    if (id === "cadastro") desenharCadastroAluno();
    if (id === "usuarios") desenharUsuarios();
    if (id === "pais") desenharAutorizacoes();
  } catch (erro) {
    if (usuarioLogado) document.getElementById("tela").innerHTML = `<div class="card"><b>Não foi possível carregar os dados.</b><small>${erro.message === "Sessão expirada" ? "Faça login novamente." : erro.message}</small></div>`;
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
