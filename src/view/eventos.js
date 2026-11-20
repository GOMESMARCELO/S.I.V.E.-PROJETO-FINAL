// View: formato em que cada evento é devolvido para a tela.
const formatarEvento = (usuario) => (e) => ({ ...e, destaque: !!e.destaque, tem_banner: !!e.tem_banner, pode_gerenciar: usuario.papel === "admin", criado_por_id: undefined });

module.exports = { formatarEvento };
