// Controller: o que cada endereço da API faz — câmeras e reconhecimento facial (simulados).
const db = require("../model/db");
const { registrarLog } = require("../model/log");
const { alunoPermitido } = require("../model/alunos");
const { RETENCAO_RECONHECIMENTOS_DIAS } = require("../model/rotina");
const { nomeTurma, normalizar } = require("../model/utilitarios");
const { LOCAIS_PROIBIDOS, cadastroFacial, facialLigado, marcarPresencaPelaEntrada, resumoAoVivo, statusAoVivo } = require("../model/monitoramento");
const { rota } = require("../middlewares/rota");
const { semPermissao } = require("../middlewares/permissoes");

const verSituacaoAgora = rota(async (req, res) => {
  const aluno = await alunoPermitido(req.usuario, Number(req.params.alunoId));
  if (!aluno) return semPermissao(res);
  res.json((await statusAoVivo({ alunoId: aluno.id }))[0]);
});

// Painel de monitoramento (só gestão): câmeras, regra do reconhecimento facial, situação ao vivo e últimas passagens
const verMonitoramento = rota(async (req, res) => {
  const ligado = await facialLigado();
  const [[cfg]] = await db.query("SELECT atualizado_por_nome AS por, DATE_FORMAT(atualizado_em, '%d/%m/%Y %H:%i') AS em FROM tb_configuracoes WHERE chave = 'reconhecimento_facial'");
  const [cameras] = await db.query(`SELECT c.id_camera AS id, c.nome AS nome, c.local AS local, c.tipo AS tipo, c.reconhecimento AS reconhecimento, c.ativa AS ativa,
    (SELECT COUNT(*) FROM tb_reconhecimentos r WHERE r.id_camera = c.id_camera AND r.data_hora >= CURDATE()) AS passagens_hoje FROM tb_cameras c ORDER BY c.id_camera`);
  const [eventos] = await db.query(`SELECT r.id_reconhecimento AS id, DATE_FORMAT(r.data_hora, '%H:%i:%s') AS hora, r.sentido AS sentido, r.resultado AS resultado, r.motivo AS motivo, r.confianca AS confianca,
    c.nome AS camera, a.nome AS aluno, ${nomeTurma("a")} AS sala FROM tb_reconhecimentos r JOIN tb_cameras c ON c.id_camera = r.id_camera LEFT JOIN tb_alunos a ON a.id_aluno = r.id_aluno
    WHERE r.data_hora >= CURDATE() ORDER BY r.id_reconhecimento DESC LIMIT 20`);
  const aoVivo = await statusAoVivo();
  const alunos = [];
  for (const s of aoVivo) alunos.push({ ...s, facial: await cadastroFacial(s, ligado) });
  const [[hoje]] = await db.query("SELECT COUNT(CASE WHEN resultado = 'Reconhecido' THEN 1 END) AS reconhecidos, COUNT(CASE WHEN resultado <> 'Reconhecido' THEN 1 END) AS sem_cadastro FROM tb_reconhecimentos WHERE data_hora >= CURDATE()");
  res.json({ facial: { ligado, alterado_por: cfg ? cfg.por : null, alterado_em: cfg ? cfg.em : null, retencao_dias: RETENCAO_RECONHECIMENTOS_DIAS },
    cameras: cameras.map((c) => ({ ...c, reconhecimento: !!c.reconhecimento, ativa: !!c.ativa })), eventos: eventos.map((e) => ({ ...e, confianca: e.confianca == null ? null : Number(e.confianca) })),
    resumo: { ...resumoAoVivo(aoVivo), reconhecidos_hoje: hoje.reconhecidos, sem_cadastro_hoje: hoje.sem_cadastro, com_cadastro_facial: alunos.filter((a) => a.facial.ok).length }, alunos });
});

const ligarReconhecimentoFacial = rota(async (req, res) => {
  const ligado = req.body.ligado === true;
  await db.query(`INSERT INTO tb_configuracoes (chave, valor, atualizado_por_nome, atualizado_em) VALUES ('reconhecimento_facial', ?, ?, NOW())
    ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por_nome = VALUES(atualizado_por_nome), atualizado_em = NOW()`, [ligado ? "ligado" : "desligado", req.usuario.nome]);
  await registrarLog(req.usuario, ligado ? "facial_ligado" : "facial_desligado", null);
  res.json({ ok: true, ligado });
});

const criarCamera = rota(async (req, res) => {
  const nome = String(req.body.nome || "").trim(), local = String(req.body.local || "").trim(), tipo = req.body.tipo;
  if (nome.length < 2 || nome.length > 60) return res.status(400).json({ erro: "Dê um nome à câmera (até 60 caracteres)." });
  if (local.length < 2 || local.length > 60) return res.status(400).json({ erro: "Informe onde a câmera fica (até 60 caracteres)." });
  if (!["Entrada", "Saída", "Área comum"].includes(tipo)) return res.status(400).json({ erro: "Escolha o tipo da câmera." });
  if (LOCAIS_PROIBIDOS.test(normalizar(`${nome} ${local}`))) return res.status(400).json({ erro: "Câmeras não podem ficar em banheiros, vestiários, trocadores ou outros espaços de intimidade (ECA, art. 17, e política de privacidade da escola)." });
  const reconhecimento = req.body.reconhecimento === true;
  if (reconhecimento && tipo === "Área comum") return res.status(400).json({ erro: "O reconhecimento facial só é usado nos portões de entrada e de saída. Câmeras de área comum só gravam." });
  await db.query("INSERT INTO tb_cameras (nome, local, tipo, reconhecimento) VALUES (?, ?, ?, ?)", [nome, local, tipo, reconhecimento]);
  await registrarLog(req.usuario, "camera_cadastrada", `${nome} — ${local} (${tipo}${reconhecimento ? ", reconhecimento facial" : ""})`);
  res.status(201).json({ ok: true });
});

const ativarCamera = rota(async (req, res) => {
  const [r] = await db.query("UPDATE tb_cameras SET ativa = ? WHERE id_camera = ?", [req.body.ativa === true, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "Câmera não encontrada." });
  await registrarLog(req.usuario, req.body.ativa === true ? "camera_ligada" : "camera_desligada", `câmera id ${req.params.id}`);
  res.json({ ok: true });
});

// Remover câmera (só a gestão). Câmera que já registrou entradas, saídas ou reconhecimentos não é apagada: esses registros
// fazem parte do histórico da escola (e do que a família vê). Nesse caso a orientação é desligar a câmera.
const removerCamera = rota(async (req, res) => {
  const [[cam]] = await db.query("SELECT id_camera AS id, nome AS nome FROM tb_cameras WHERE id_camera = ?", [req.params.id]);
  if (!cam) return res.status(404).json({ erro: "Câmera não encontrada." });
  const [[uso]] = await db.query(`SELECT (SELECT COUNT(*) FROM tb_acessos WHERE id_camera = ?) + (SELECT COUNT(*) FROM tb_saidas WHERE id_camera = ?)
    + (SELECT COUNT(*) FROM tb_reconhecimentos WHERE id_camera = ?) AS total`, [cam.id, cam.id, cam.id]);
  if (Number(uso.total) > 0) return res.status(409).json({ erro: `A câmera "${cam.nome}" já tem ${uso.total} registro(s) de passagem guardados no histórico, por isso não pode ser removida. Use "Desligar câmera" para tirá-la de uso.` });
  await db.query("DELETE FROM tb_cameras WHERE id_camera = ?", [cam.id]);
  await registrarLog(req.usuario, "camera_removida", `${cam.nome} (id ${cam.id})`);
  res.json({ ok: true });
});

// SIMULAÇÃO de uma passagem diante de uma câmera com reconhecimento facial.
// aluno_id: quem "passou" (vazio = o sistema escolhe). desconhecido: true = um rosto que não é de aluno (visitante).
const simularReconhecimento = rota(async (req, res) => {
  const [[cam]] = await db.query("SELECT id_camera AS id, nome AS nome, tipo AS tipo, reconhecimento AS reconhecimento, ativa AS ativa FROM tb_cameras WHERE id_camera = ?", [Number(req.body.cam_id)]);
  if (!cam) return res.status(404).json({ erro: "Câmera não encontrada." });
  if (!cam.ativa) return res.status(400).json({ erro: "Esta câmera está desligada." });
  if (!cam.reconhecimento) return res.status(400).json({ erro: "Esta câmera é de área comum: ela só grava, não faz reconhecimento facial." });
  const ligado = await facialLigado();
  if (!ligado) return res.status(409).json({ erro: "O reconhecimento facial está desligado. Ligue o recurso no topo da tela para simular." });
  const sentido = cam.tipo === "Saída" ? "Saída" : "Entrada";
  const registrar = (alunoId, resultado, motivo, confianca) => db.query("INSERT INTO tb_reconhecimentos (id_camera, id_aluno, sentido, resultado, motivo, confianca) VALUES (?, ?, ?, ?, ?, ?)",
    [cam.id, alunoId, sentido, resultado, motivo, confianca]);

  if (req.body.desconhecido === true) {
    await registrar(null, "Sem cadastro facial", "Rosto sem cadastro: imagem descartada", null);
    await registrarLog(req.usuario, "reconhecimento_simulado", `${cam.nome}: rosto sem cadastro`);
    return res.json({ resultado: "Sem cadastro facial", camera: cam.nome, sentido, mensagem: "Rosto sem cadastro facial (pode ser um visitante). A imagem foi descartada e nada foi identificado." });
  }
  let aluno;
  if (req.body.aluno_id) aluno = (await statusAoVivo({ alunoId: Number(req.body.aluno_id) }))[0];
  else { // escolhe alguém que faça sentido: na entrada, quem ainda não chegou; na saída, quem está na escola
    const candidatos = (await statusAoVivo()).filter((s) => sentido === "Entrada" ? s.situacao === "nao_chegou" : s.situacao === "na_escola");
    aluno = candidatos[Math.floor(Math.random() * candidatos.length)];
    if (!aluno) return res.status(400).json({ erro: sentido === "Entrada" ? "Todos os alunos já chegaram ou estão ausentes hoje" : "Nenhum aluno na escola para sair" });
  }
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const cad = await cadastroFacial(aluno, ligado);
  if (!cad.ok) { // sem cadastro facial: a câmera não reconhece ninguém, a imagem é descartada e o aluno NÃO é identificado no registro
    await registrar(null, "Sem cadastro facial", "Rosto sem cadastro: imagem descartada", null);
    await registrarLog(req.usuario, "reconhecimento_simulado", `${cam.nome}: rosto sem cadastro`);
    return res.json({ resultado: "Sem cadastro facial", camera: cam.nome, sentido, aluno: { id: aluno.id, nome: aluno.nome, sala: aluno.sala }, motivo: cad.motivo,
      mensagem: `Simulação: ${aluno.nome} passou pela câmera, mas não tem cadastro facial (${cad.motivo.charAt(0).toLowerCase() + cad.motivo.slice(1)}). A câmera não o identificou e a imagem foi descartada. Registre a ${sentido === "Entrada" ? "entrada" : "saída"} pela portaria.` });
  }
  const confianca = Math.round((92 + Math.random() * 7.6) * 10) / 10;
  await registrar(aluno.id, "Reconhecido", null, confianca);
  if (sentido === "Entrada") {
    await db.query("INSERT INTO tb_acessos (id_aluno, id_turma, id_camera, metodo) VALUES (?, (SELECT a.id_turma FROM tb_alunos a WHERE a.id_aluno = ?), ?, 'Facial')", [aluno.id, aluno.id, cam.id]);
    await marcarPresencaPelaEntrada(aluno.id, "reconhecimento facial");
  } else await db.query("INSERT INTO tb_saidas (id_aluno, id_camera, metodo) VALUES (?, ?, 'Facial')", [aluno.id, cam.id]);
  await registrarLog(req.usuario, "reconhecimento_simulado", `${cam.nome}: aluno id ${aluno.id} reconhecido (${String(confianca).replace(".", ",")}%)`);
  res.json({ resultado: "Reconhecido", camera: cam.nome, sentido, aluno: { id: aluno.id, nome: aluno.nome, sala: aluno.sala }, confianca,
    mensagem: `${aluno.nome} reconhecido(a) no ${cam.nome} com ${String(confianca).replace(".", ",")}% de confiança. ${sentido} registrada.` });
});

// Saída registrada à mão pela portaria (aluno sem cadastro facial no portão de saída)
const liberarSaida = rota(async (req, res) => {
  const [[aluno]] = await db.query("SELECT id_aluno AS id FROM tb_alunos WHERE id_aluno = ?", [Number(req.body.aluno_id)]);
  if (!aluno) return res.status(404).json({ erro: "Aluno não encontrado." });
  const [[cam]] = await db.query("SELECT id_camera AS id, nome AS nome FROM tb_cameras WHERE id_camera = ? AND tipo = 'Saída'", [Number(req.body.cam_id) || 0]);
  await db.query("INSERT INTO tb_saidas (id_aluno, id_camera, metodo, liberado_por_nome) VALUES (?, ?, 'Manual', ?)", [aluno.id, cam ? cam.id : null, req.usuario.nome]);
  await registrarLog(req.usuario, "saida_manual", `aluno id ${aluno.id}${cam ? " — " + cam.nome : ""}`);
  res.status(201).json({ ok: true });
});

module.exports = { verSituacaoAgora, verMonitoramento, ligarReconhecimentoFacial, criarCamera, ativarCamera, removerCamera, simularReconhecimento, liberarSaida };
