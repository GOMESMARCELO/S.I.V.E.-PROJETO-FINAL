// Preferências de acessibilidade: carregado no <head>, antes de a página aparecer, para a tela já nascer do jeito que a pessoa escolheu.
// As escolhas viram atributos na tag <html> (data-texto, data-contraste...) e o css/style.css faz o resto.
// Quem está logado usa o que está salvo na conta; quem ainda não entrou usa o que escolheu neste navegador.
(() => {
  const ler = (chave) => { try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; } };
  const contrasteDoAparelho = () => (matchMedia("(prefers-contrast: more)").matches ? "alto" : matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "padrao");
  const marcar = (nome, valor) => { if (valor) document.documentElement.setAttribute(`data-${nome}`, valor); else document.documentElement.removeAttribute(`data-${nome}`); };
  window.lerPreferenciasLocais = () => ler("sive-acessibilidade");
  window.contrasteEmUso = (p) => p.contraste || contrasteDoAparelho(); // sem escolha salva, segue o aparelho
  window.aplicarPreferencias = (p) => {
    const contraste = window.contrasteEmUso(p);
    marcar("texto", p.texto && p.texto !== "normal" ? p.texto : "");
    marcar("contraste", contraste === "padrao" ? "" : contraste);
    marcar("daltonismo", p.daltonismo ? "1" : "");
    marcar("fonte", p.fonte ? "legivel" : "");
    marcar("espaco", p.espaco ? "1" : "");
    marcar("links", p.links ? "1" : "");
    marcar("sem-movimento", p.semMovimento ? "1" : "");
  };
  const sessao = ler("sive-usuario");
  window.aplicarPreferencias((sessao && sessao.acessibilidade) || ler("sive-acessibilidade") || {});
})();
