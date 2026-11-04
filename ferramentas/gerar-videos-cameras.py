# Gera os vídeos SIMULADOS das câmeras do S.I.V.E. (assets/cameras/*.mp4 e *.jpg): 10 s, loop perfeito, pessoas de longe e sem rosto.
# Tudo é desenhado pelo próprio script (não usa fotos nem filmagens de verdade).
# Uso (precisa de Python 3 com Pillow e numpy, e do ffmpeg):  python ferramentas/gerar-videos-cameras.py assets/cameras
import math, os, sys, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1280, 720            # desenha em 2x e reduz (bordas suaves)
OUT_W, OUT_H = 640, 360
FPS, SEG = 15, 10
N = FPS * SEG
TAU = math.tau

# ---------- utilidades ----------
def lerp(a, b, t): return a + (b - a) * t
def mix(c1, c2, t): return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))
def ponto_no_caminho(pts, f):
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg); alvo = f * total
    for i, s in enumerate(seg):
        if alvo <= s or i == len(seg) - 1:
            t = 0 if s == 0 else min(1, alvo / s)
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            return lerp(x1, x2, t), lerp(y1, y2, t), (x2 - x1)
        alvo -= s
def comprimento(pts): return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

PELES = [(92, 64, 48), (140, 100, 76), (176, 132, 102), (120, 84, 62), (200, 160, 128)]
CABELOS = [(30, 24, 20), (60, 40, 28), (20, 18, 18), (110, 80, 50)]
UNIF = [(40, 70, 130), (36, 62, 118), (48, 80, 140)]       # camiseta do uniforme (azul)
CALCA = [(40, 40, 52), (30, 34, 60), (52, 52, 62)]
ADULTO_ROUPA = [(150, 60, 50), (70, 110, 80), (200, 190, 170), (90, 90, 110), (160, 120, 60), (60, 60, 70)]
MOCHILA = [(180, 60, 60), (60, 140, 90), (220, 170, 40), (120, 70, 150), (40, 40, 40)]

class Pessoa:
    def __init__(self, rnd, crianca=True, mochila=None):
        self.crianca = crianca
        self.pele = rnd.choice(PELES); self.cabelo = rnd.choice(CABELOS)
        self.blusa = rnd.choice(UNIF) if crianca else rnd.choice(ADULTO_ROUPA)
        self.calca = rnd.choice(CALCA)
        self.mochila = (rnd.choice(MOCHILA) if (mochila if mochila is not None else crianca and rnd.random() < .8) else None)
        self.alt = rnd.uniform(.62, .78) if crianca else rnd.uniform(.95, 1.08)

ALVO = [None]
def aparece(f, borda=.07): return max(0, min(1, f / borda, (1 - f) / borda))
def desenhar_pessoa(d, p, x, y, escala, fase, dx=0, andando=True, sentado=False, sombra=True, alpha=1):
    """(x, y) = pés no chão. escala = altura em px de um adulto naquele ponto. fase em radianos (passada).
    alpha < 1: a pessoa surge ou some aos poucos (o loop não dá "pulo")."""
    if alpha <= 0: return
    if alpha < .99:
        camada = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        desenhar_pessoa(ImageDraw.Draw(camada, "RGBA"), p, x, y, escala, fase, dx, andando, sentado, sombra)
        a = camada.getchannel("A").point(lambda v: int(v * alpha)); camada.putalpha(a)
        ALVO[0].paste(camada, (0, 0), camada); return
    h = escala * p.alt
    if sombra and not sentado:
        d.ellipse([x - h * .2, y - h * .035, x + h * .2, y + h * .035], fill=(0, 0, 0, 70))
    perna = h * .42; tronco = h * .36; cab = h * .11
    quadril_y = y - perna
    balanco = math.sin(fase) if andando else 0
    sobe = abs(math.cos(fase)) * h * .015 if andando else 0
    quadril_y -= sobe
    lw = max(2, h * .07)
    if sentado:
        quadril_y = y
    else:
        for s in (-1, 1):
            px = x + s * balanco * h * .13 + s * h * .025
            d.line([x + s * h * .03, quadril_y, px, y - 1], fill=p.calca, width=int(lw))
            d.ellipse([px - lw * .7, y - lw * .6, px + lw * .7, y + lw * .2], fill=(25, 25, 30))
    ombro_y = quadril_y - tronco
    larg = h * .13
    # braços (atrás do corpo)
    for s in (-1, 1):
        bx = x + s * larg * .9 - s * balanco * h * .1 * (1 if andando else 0)
        d.line([x + s * larg * .75, ombro_y + h * .03, bx, ombro_y + tronco * .8], fill=mix(p.blusa, (0, 0, 0), .15), width=int(lw * .8))
    d.rounded_rectangle([x - larg, ombro_y, x + larg, quadril_y + h * .02], radius=larg * .6, fill=p.blusa)
    if p.mochila:
        lado = -1 if dx >= 0 else 1   # mochila nas costas: aparece do lado oposto ao caminho
        mx = x + lado * larg * .55
        d.rounded_rectangle([mx - larg * .7, ombro_y + h * .02, mx + larg * .7, ombro_y + tronco * .75], radius=larg * .3, fill=p.mochila)
    # cabeça (de longe e de cima: só o cabelo e um pouco de pele, sem rosto)
    cy = ombro_y - cab * .9
    d.ellipse([x - cab, cy - cab, x + cab, cy + cab], fill=p.pele)
    d.chord([x - cab * 1.05, cy - cab * 1.1, x + cab * 1.05, cy + cab * .7], 180, 360, fill=p.cabelo)

def arvore(d, x, y, r, t, cor=(70, 110, 70)):
    d.rectangle([x - r * .1, y - r * .9, x + r * .1, y], fill=(80, 60, 45))
    bal = math.sin(TAU * t + x) * r * .04
    for k, (ox, oy, rr) in enumerate([(0, -1.5, 1), (-.6, -1.1, .75), (.6, -1.15, .75), (0, -1.9, .65)]):
        c = mix(cor, (255, 255, 255), .06 * k)
        d.ellipse([x + ox * r + bal - rr * r, y + oy * r - rr * r, x + ox * r + bal + rr * r, y + oy * r + rr * r], fill=c)

def escala_y(y, horizonte, perto, longe, baixo=H):
    t = max(0, (y - horizonte) / (baixo - horizonte))
    return lerp(longe, perto, t)

# ---------- pós-processamento: aparência de câmera de segurança ----------
def cftv(img, i, seed):
    a = np.asarray(img.resize((OUT_W, OUT_H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(.5)), dtype=np.float32)
    lum = a @ np.array([.299, .587, .114], dtype=np.float32)
    a = a * .45 + lum[..., None] * .55                 # menos cor
    a = a * np.array([.94, 1.0, .98], dtype=np.float32) # leve tom esverdeado
    a = 18 + a * .86                                     # contraste mais baixo
    yy, xx = np.mgrid[0:OUT_H, 0:OUT_W]
    v = ((xx - OUT_W / 2) / (OUT_W / 2)) ** 2 + ((yy - OUT_H / 2) / (OUT_H / 2)) ** 2
    a *= (1 - .32 * np.clip(v, 0, 1.6))[..., None]       # vinheta
    rng = np.random.default_rng(seed * 1000 + i)
    a += rng.normal(0, 4.5, (OUT_H, OUT_W, 1))            # granulado
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

# ---------- cenas ----------
def cena_entrada(i, rnd_pessoas):
    """Portão principal visto de dentro, do alto: rua lá no fundo, grade com o portão aberto, caminho até a escola."""
    u = i / N
    img = Image.new("RGB", (W, H), (150, 150, 140)); ALVO[0] = img; d = ImageDraw.Draw(img, "RGBA")
    HZ = 150
    d.rectangle([0, 0, W, 60], fill=(190, 185, 170))                     # muro do outro lado da rua
    d.rectangle([0, 60, W, 150], fill=(80, 82, 88))                      # rua
    for k in range(0, W, 120): d.rectangle([k + ((u * 0) % 1), 102, k + 60, 108], fill=(200, 190, 120))
    d.rectangle([0, 150, W, 190], fill=(175, 170, 160))                  # calçada de fora
    # carro passando (uma vez a cada 10 s)
    cx = lerp(-300, W + 300, u)
    d.rounded_rectangle([cx, 70, cx + 230, 135], radius=18, fill=(140, 40, 40)); d.rounded_rectangle([cx + 50, 76, cx + 170, 110], radius=10, fill=(60, 70, 80))
    # pátio de dentro (piso), com faixa do caminho
    d.polygon([(0, 205), (W, 205), (W, H), (0, H)], fill=(160, 152, 138))
    d.polygon([(560, 205), (720, 205), (980, H), (300, H)], fill=(185, 178, 162))
    for k in range(8):
        y = 205 + (k + 1) ** 1.6 * 9
        d.line([0, y, W, y], fill=(150, 142, 128), width=2)
    # canteiros e árvores
    d.polygon([(0, 260), (250, 260), (120, H), (0, H)], fill=(96, 130, 84)); d.polygon([(W, 260), (W - 250, 260), (W - 120, H), (W, H)], fill=(96, 130, 84))
    pessoas = []
    # caminhos: entram pelo portão (centro) e descem até sair embaixo
    caminhos = [[(-80, 182), (600, 182), (630, 220), (560, 420), (380, H + 80)], [(W + 80, 184), (680, 184), (650, 225), (760, 420), (980, H + 80)],
                [(-80, 186), (640, 186), (640, 235), (650, 450), (700, H + 90)]]
    for k in range(7):
        c = caminhos[k % 3]; f = (u * (1 if k % 2 else 2) + k / 7 + (k % 3) * .11) % 1
        x, y, dx = ponto_no_caminho(c, f)
        passos = round(comprimento(c) / 55)
        pessoas.append((y, rnd_pessoas[k], x, dx, f * passos * TAU, True, aparece(f, .03)))
    # pais na calçada de fora andando de lado
    for k in range(3):
        f = (u + k / 3) % 1; ida = k % 2 == 0
        x = lerp(-80, W + 80, f if ida else 1 - f); y = 178 + k * 4
        pessoas.append((y, rnd_pessoas[10 + k], x, 1 if ida else -1, f * 22 * TAU, True))
    # porteiro parado ao lado do portão
    pessoas.append((236, rnd_pessoas[14], 520, 0, 0, False))
    # grade e portão (atrás das pessoas de dentro, na frente das de fora)
    def grade():
        for gx in range(0, W, 26):
            if 560 <= gx <= 720: continue
            d.line([gx, 140, gx, 205], fill=(50, 70, 60), width=5)
        d.rectangle([0, 136, 560, 142], fill=(50, 70, 60)); d.rectangle([720, 136, W, 142], fill=(50, 70, 60))
        d.rectangle([548, 110, 572, 210], fill=(120, 116, 110)); d.rectangle([708, 110, 732, 210], fill=(120, 116, 110))
        # folhas do portão abertas para dentro
        d.polygon([(572, 140), (520, 175), (520, 238), (572, 205)], outline=(50, 70, 60), width=5)
        d.polygon([(708, 140), (760, 175), (760, 238), (708, 205)], outline=(50, 70, 60), width=5)
    pessoas.sort(key=lambda p: p[0])
    feito = False
    for y, p, x, dx, fase, anda, *al in pessoas:
        if y > 200 and not feito: grade(); feito = True
        desenhar_pessoa(d, p, x, y, escala_y(y, 120, 300, 70), fase, dx, anda, alpha=al[0] if al else 1)
    if not feito: grade()
    arvore(d, 110, 420, 90, u); arvore(d, W - 110, 440, 95, u + .3)
    return img

def cena_saida(i, rnd_pessoas):
    """Portão de saída na rua lateral, câmera no alto do muro: calçada em diagonal, portão à esquerda, carros parados."""
    u = i / N
    img = Image.new("RGB", (W, H), (120, 122, 126)); ALVO[0] = img; d = ImageDraw.Draw(img, "RGBA")
    d.polygon([(0, 0), (W, 0), (W, 120), (0, 300)], fill=(196, 188, 172))             # muro da escola
    for k in range(0, W, 64): d.line([k, 0, k, 300 - k * 180 / W], fill=(180, 172, 156), width=2)
    d.polygon([(0, 300), (W, 120), (W, 300), (0, 560)], fill=(178, 172, 160))         # calçada
    for k in range(10):
        x = k * 140; d.line([x, 300 - x * 180 / W, x - 60, 560 - x * 260 / W], fill=(160, 154, 142), width=2)
    d.polygon([(0, 560), (W, 300), (W, 330), (0, 590)], fill=(150, 146, 136))         # meio-fio
    d.polygon([(0, 590), (W, 330), (W, H), (0, H)], fill=(78, 80, 86))                # rua
    for k in range(6):
        x = 80 + k * 230; y = 650 - x * 260 / W
        d.line([x, y, x + 110, y - 22], fill=(210, 200, 130), width=8)
    # portão de saída (abertura no muro)
    d.polygon([(170, 120), (330, 92), (330, 255), (170, 286)], fill=(70, 72, 70))
    d.polygon([(170, 120), (250, 106), (250, 270), (170, 286)], outline=(60, 80, 70), width=6)
    # carros estacionados esperando
    for cx, cy, cor in [(560, 520, (60, 80, 120)), (980, 430, (200, 200, 205))]:
        d.polygon([(cx, cy), (cx + 260, cy - 52), (cx + 270, cy + 30), (cx + 10, cy + 82)], fill=cor)
        d.polygon([(cx + 60, cy + 4), (cx + 190, cy - 22), (cx + 196, cy + 20), (cx + 66, cy + 46)], fill=(50, 58, 66))
    # carro passando na rua
    t = u; cx = lerp(W + 300, -400, t); cy = 700 - (cx + 150) * 260 / W
    d.polygon([(cx, cy), (cx + 280, cy - 56), (cx + 290, cy + 26), (cx + 10, cy + 82)], fill=(150, 150, 60))
    pessoas = []
    # alunos saem do portão e seguem pela calçada (para a direita) ou atravessam até os carros
    c1 = [(240, 230), (280, 330), (700, 250), (W + 120, 165)]
    c2 = [(240, 230), (300, 360), (600, 420), (640, 470)]
    c3 = [(-120, 470), (400, 370), (900, 270), (W + 120, 195)]
    for k in range(6):
        c = c1 if k % 2 == 0 else c3; vel = 1 if k < 4 else 2
        f = (u * vel + k / 6) % 1
        x, y, dx = ponto_no_caminho(c, f)
        passos = round(comprimento(c) / 50)
        pessoas.append((y, rnd_pessoas[k], x, dx, f * passos * TAU, True, aparece(f)))
    # aluno com responsável indo até o carro (some atrás dele)
    f = u
    x, y, dx = ponto_no_caminho(c2, f); pessoas.append((y, rnd_pessoas[8], x, dx, f * round(comprimento(c2) / 50) * TAU, True, aparece(f, .12)))
    pessoas.append((y + 6, rnd_pessoas[9], x + 30, dx, f * round(comprimento(c2) / 50) * TAU + 1, True, aparece(f, .12)))
    # inspetora parada no portão
    pessoas.append((300, rnd_pessoas[12], 340, 0, 0, False))
    pessoas.sort(key=lambda p: p[0])
    for y, p, x, dx, fase, anda, *al in pessoas:
        desenhar_pessoa(d, p, x, y, escala_y(y, 80, 215, 120, 700), fase, dx, anda, alpha=al[0] if al else 1)
    arvore(d, W - 120, 210, 80, u)
    return img

def cena_patio(i, rnd_pessoas):
    """Pátio central visto de cima: quadra pintada, árvore com banco e crianças brincando."""
    u = i / N
    img = Image.new("RGB", (W, H), (168, 160, 146)); ALVO[0] = img; d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([0, 0, W, 110], fill=(190, 182, 168))                                   # parede do fundo
    for k in range(6): d.rectangle([60 + k * 210, 30, 180 + k * 210, 90], fill=(110, 130, 150))  # janelas
    d.rectangle([0, 110, W, 130], fill=(150, 142, 130))
    d.polygon([(260, 170), (1020, 170), (1180, 640), (100, 640)], fill=(120, 140, 160))  # quadra
    d.polygon([(260, 170), (1020, 170), (1180, 640), (100, 640)], outline=(235, 235, 225), width=5)
    d.line([180, 405, 1100, 405], fill=(235, 235, 225), width=5)
    d.ellipse([560, 365, 720, 445], outline=(235, 235, 225), width=5)
    # árvore, banco e bebedouro
    d.rounded_rectangle([30, 560, 190, 590], radius=6, fill=(120, 86, 60))
    d.rectangle([1180, 150, 1230, 230], fill=(200, 200, 205))
    pessoas = []
    # roda de pega-pega: corre em círculo
    for k in range(5):
        a = TAU * (u * 2 + k / 5)
        x = 640 + math.cos(a) * 250; y = 470 + math.sin(a) * 90
        pessoas.append((y, rnd_pessoas[k], x, -math.sin(a), a * 6, True))
    # dois passando a bola (vão e voltam)
    for k, (bx, by) in enumerate([(330, 250), (560, 230)]):
        sway = math.sin(TAU * u * 4 + k) * 6
        pessoas.append((by, rnd_pessoas[6 + k], bx + sway, 1 - 2 * k, 0, False))
    bf = (math.sin(TAU * u * 4 - math.pi / 2) + 1) / 2
    bx = lerp(345, 545, bf); by = 210 - math.sin(math.pi * bf) * 40
    # grupo conversando perto do banco e um adulto (inspetor) andando devagar no fundo
    for k, (gx, gy) in enumerate([(90, 600), (150, 610), (60, 640)]):
        pessoas.append((gy, rnd_pessoas[15 + k], gx + math.sin(TAU * u * 2 + k) * 3, 1, 0, False))
    f = (math.sin(TAU * u) + 1) / 2
    pessoas.append((150, rnd_pessoas[13], lerp(320, 980, f), math.cos(TAU * u), f * 14 * TAU, True))
    arvore(d, 150, 520, 105, u, (80, 118, 76))
    pessoas.sort(key=lambda p: p[0])
    bola_feita = False
    for y, p, x, dx, fase, anda in pessoas:
        if not bola_feita and y > 215:
            d.ellipse([bx - 9, by - 9, bx + 9, by + 9], fill=(230, 120, 40)); bola_feita = True
        desenhar_pessoa(d, p, x, y, escala_y(y, 0, 210, 115), fase, dx, anda)
    return img

def cena_refeitorio(i, rnd_pessoas):
    """Refeitório: mesas compridas em perspectiva, alunos sentados dos dois lados e alguns andando com bandeja."""
    u = i / N
    img = Image.new("RGB", (W, H), (176, 170, 158)); ALVO[0] = img; d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([0, 0, W, 150], fill=(200, 196, 184))
    for k in range(5): d.rectangle([40 + k * 270, 20, 170 + k * 270, 70], fill=(150, 170, 186))
    d.rectangle([380, 80, 900, 150], fill=(150, 150, 150)); d.rectangle([380, 80, 900, 94], fill=(120, 120, 124))  # balcão
    for k in range(4): d.rectangle([410 + k * 125, 104, 490 + k * 125, 140], fill=(170, 175, 180))
    for k in range(12): d.line([640 + (k - 6) * 120, 150, 640 + (k - 6) * 300, H], fill=(166, 160, 148), width=2)
    rnd = random.Random(7); n = 0
    criancas = [p for p in rnd_pessoas if p.crianca]
    # cozinheira atrás do balcão
    desenhar_pessoa(d, rnd_pessoas[13], 520 + math.sin(TAU * u * 2) * 40, 150, 120, 0, 1, False)
    mesas = []
    for r, y in enumerate([255, 395, 585]):
        esc = escala_y(y, 60, 250, 120); prof = esc * .22
        for lado in (-1, 1):
            xa, xb = sorted([640 + lado * (70 + r * 20), 640 + lado * (300 + r * 150)])
            mesas.append((y, xa, xb, esc, prof))
    caminhantes = []
    for k in range(3):
        f = (u + k / 3) % 1; ida = k % 2 == 0
        y = lerp(175, H + 80, f) if ida else lerp(H + 80, 175, f)
        caminhantes.append((y, rnd_pessoas[20 + k], 640 + (k - 1) * 36, f * 16 * TAU, aparece(f, .1)))
    def andarilhos(ate):
        while caminhantes and caminhantes[0][0] <= ate:
            y, p, x, fase, al = caminhantes.pop(0)
            esc = escala_y(y, 60, 270, 110); desenhar_pessoa(d, p, x, y, esc, fase, 1, True, alpha=al)
            s = esc * p.alt; d.rectangle([x - s * .15, y - s * .63, x + s * .15, y - s * .57], fill=(222, 222, 228, int(255 * al)))
    caminhantes.sort(key=lambda c: c[0])
    for (y, xa, xb, esc, prof) in mesas:
        lugares = max(2, int((xb - xa) / (esc * .32)))
        assentos = [xa + (k + .5) * (xb - xa) / lugares for k in range(lugares)]
        topo = y - prof
        andarilhos(topo)
        # lado de lá: de frente para a câmera (a mesa esconde da cintura para baixo)
        for x in assentos:
            if rnd.random() < .25: continue
            p = criancas[n % len(criancas)]; n += 1
            bob = math.sin(TAU * u * 3 + n) * 1.5
            desenhar_pessoa(d, p, x, topo + prof * .35 + bob, esc * .95, 0, 1, False, sentado=True)
        d.polygon([(xa, topo), (xb, topo), (xb + prof * .3, y), (xa - prof * .3, y)], fill=(214, 208, 198))   # tampo
        d.rectangle([xa - prof * .3, y, xb + prof * .3, y + prof * .35], fill=(150, 144, 134))
        for x in assentos[::2]: d.rectangle([x - 5, topo + 4, x + 22, topo + 14], fill=(230, 160, 70))       # pratos/frutas
        andarilhos(y + prof)
        # lado de cá: de costas para a câmera, sentado no banco
        d.rectangle([xa - prof * .2, y + prof * 1.15, xb + prof * .2, y + prof * 1.45], fill=(120, 100, 80))
        for x in assentos:
            if rnd.random() < .3: continue
            p = criancas[n % len(criancas)]; n += 1
            p2 = Pessoa(random.Random(n)); p2.blusa, p2.cabelo, p2.mochila, p2.pele, p2.alt = p.blusa, p.cabelo, None, p.cabelo, p.alt
            bob = math.sin(TAU * u * 3 + n) * 1.5
            desenhar_pessoa(d, p2, x, y + prof * 1.2 + bob, esc * 1.02, 0, 1, False, sentado=True)
    andarilhos(H * 3)
    return img

CENAS = {"portao-entrada": cena_entrada, "portao-saida": cena_saida, "patio": cena_patio, "refeitorio": cena_refeitorio}

def pessoas_da_cena(seed):
    r = random.Random(seed)
    ps = [Pessoa(r, crianca=True) for _ in range(30)]
    for k in (10, 11, 12, 13, 14, 9):   # alguns adultos (pais, porteiro, inspetores)
        ps[k] = Pessoa(r, crianca=False, mochila=False)
    return ps

def gerar(nome, pasta, so_quadro=None):
    seed = sum(map(ord, nome)); ps = pessoas_da_cena(seed); f = CENAS[nome]
    if so_quadro is not None:
        cftv(f(so_quadro, ps), so_quadro, seed).save(os.path.join(pasta, f"{nome}-quadro.png")); return
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
                           os.path.join(pasta, f"{nome}.mp4")], stdin=subprocess.PIPE)
    for i in range(N):
        q = cftv(f(i, ps), i, seed)
        if i == 0: q.convert("RGB").save(os.path.join(pasta, f"{nome}.jpg"), quality=78)
        ff.stdin.write(q.tobytes())
    ff.stdin.close(); ff.wait()

if __name__ == "__main__":
    pasta = sys.argv[1]; os.makedirs(pasta, exist_ok=True)
    nomes = [a for a in sys.argv[2:] if a in CENAS] or list(CENAS)
    quadro = int(sys.argv[sys.argv.index("--quadro") + 1]) if "--quadro" in sys.argv else None
    for n in nomes: gerar(n, pasta, quadro); print("ok", n)
