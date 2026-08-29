#!/usr/bin/env python3
"""Build deterministic original static art for the native first-run welcome deck."""
from pathlib import Path
import hashlib, shutil
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parents[1] / "assets" / "welcome"
OUT.mkdir(parents=True, exist_ok=True)
MASTERS = OUT / "masters"
MASTERS.mkdir(parents=True, exist_ok=True)
AUTHORITATIVE = {
    "logo-black.png": (ROOT / "packages/happy-desktop-ui/src/assets/brand/logo-black.png", "c03f4f326e12c296edb7cac3a1aa319e975940a63dae53e958f1bdb73635ffd7"),
    "logo-white.png": (ROOT / "packages/happy-desktop-ui/src/assets/brand/logo-white.png", "15bed5bdc3d48ec683e87ba76a7ab7a35b9fe8514196ad92871dcf26b29ec371"),
    "welcome-sky.jpg": (ROOT / "packages/happy-desktop-ui/src/assets/backdrops/welcome-sky.jpg", "2c0eae8be9635c1bfc3c9b06b22f06e59789a81ad25b71924fb01963b16d1e6b"),
    "welcome-sky-dark.jpg": (ROOT / "packages/happy-desktop-ui/src/assets/backdrops/welcome-sky-dark.jpg", "f705cac25e0e84564a3cea853bc908c3d818d520250056cba2dbc51b41cbd106"),
}
for name, (source, expected) in AUTHORITATIVE.items():
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"authoritative welcome asset drifted: {source} ({digest})")
    shutil.copyfile(source, OUT / name)

S = 640
AA = Image.Resampling.LANCZOS

def canvas():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))

def alpha_centroid(image):
    alpha = image.getchannel("A")
    total = sum(alpha.getdata())
    if total == 0:
        raise SystemExit("welcome art has no painted pixels")
    width, height = image.size
    x = sum(value * (index % width) for index, value in enumerate(alpha.getdata())) / total
    y = sum(value * (index // width) for index, value in enumerate(alpha.getdata())) / total
    return x, y

def normalize_center(image):
    x, y = alpha_centroid(image)
    target = (image.width - 1) / 2
    shifted = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shifted.alpha_composite(image, (round(target - x), round(target - y)))
    x, y = alpha_centroid(shifted)
    if abs(x - target) > 0.6 or abs(y - target) > 0.6:
        raise SystemExit(f"welcome art centroid is not normalized: {(x, y)}")
    return shifted

def save(image, name):
    master = normalize_center(image)
    master.save(MASTERS / name, optimize=True)
    derivative = master.resize((320, 320), AA)
    derivative.save(OUT / name, optimize=True)

def ellipse(draw, box, fill, outline=None, width=1):
    draw.ellipse(tuple(int(v) for v in box), fill=fill, outline=outline, width=width)

def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(tuple(int(v) for v in box), radius=radius, fill=fill, outline=outline, width=width)

# Multiplayer: three distinct people around one friendly agent signal.
im=canvas(); d=ImageDraw.Draw(im)
ellipse(d,(92,116,548,572),(0,0,0,0),"#FFFFFF",12)
for x,y,c in [(166,330,"#FFB703"),(320,270,"#7C5CFC"),(474,330,"#00BFA6")]:
    ellipse(d,(x-68,y-68,x+68,y+68),c)
    ellipse(d,(x-24,y-34,x+24,y+14),"#FFF7E8")
    d.arc((x-30,y-8,x+30,y+42),0,180,fill="#2E2842",width=10)
    rounded(d,(x-88,y+60,x+88,y+160),42,c)
# shared live-session agent spark
ellipse(d,(268,102,372,206),"#212033")
ellipse(d,(293,128,311,146),"#7DF9E3"); ellipse(d,(329,128,347,146),"#7DF9E3")
d.line((320,102,320,70),fill="#212033",width=12); ellipse(d,(307,48,333,74),"#FF4D8D")
save(im,"scene-multiplayer.png")

# Models together: an original geometric llama with three model-color ribbons.
im=canvas(); d=ImageDraw.Draw(im)
rounded(d,(190,170,446,504),82,"#F3E8D2", "#312E45",12)
# neck/head and ears
rounded(d,(282,78,450,310),72,"#FFF5E5", "#312E45",12)
d.polygon([(294,112),(250,48),(338,86)],fill="#F3E8D2",outline="#312E45")
d.polygon([(410,92),(470,44),(448,130)],fill="#F3E8D2",outline="#312E45")
ellipse(d,(326,146,346,166),"#312E45"); ellipse(d,(398,146,418,166),"#312E45")
d.arc((344,166,410,226),0,180,fill="#312E45",width=10)
# three model ribbons stay together around the body
for y,c in [(330,"#6C63FF"),(370,"#FF4D8D"),(410,"#00BFA6")]: rounded(d,(126,y,488,y+26),13,c)
# legs
rounded(d,(220,470,270,574),24,"#F3E8D2","#312E45",10); rounded(d,(366,470,416,574),24,"#F3E8D2","#312E45",10)
save(im,"scene-models.png")

# Open and adaptable: a magic tool building modular blocks rather than copying the Lottie wand.
im=canvas(); d=ImageDraw.Draw(im)
# modular blocks
for x,y,c in [(118,366,"#7C5CFC"),(250,366,"#00BFA6"),(382,366,"#FFB703"),(250,234,"#FF4D8D")]:
    rounded(d,(x,y,x+112,y+112),24,c,"#FFFFFF",8)
# wand diagonal
rounded(d,(120,430,410,482),26,"#302B45")
d.polygon([(396,398),(522,268),(550,296),(424,426)],fill="#FFF7E8",outline="#302B45")
# deterministic sparks
for x,y,r,c in [(484,176,24,"#FFB703"),(548,230,14,"#FF4D8D"),(422,212,16,"#00BFA6"),(526,130,10,"#FFFFFF")]:
    d.polygon([(x,y-r),(x+r//3,y-r//3),(x+r,y),(x+r//3,y+r//3),(x,y+r),(x-r//3,y+r//3),(x-r,y),(x-r//3,y-r//3)],fill=c)
save(im,"scene-adaptable.png")

# Security: original lock with a network contained inside its shield.
im=canvas(); d=ImageDraw.Draw(im)
d.polygon([(320,76),(504,154),(474,404),(320,558),(166,404),(136,154)],fill="#242139",outline="#FFFFFF")
d.line((230,270,410,270),fill="#00D4B4",width=14)
for x,y in [(230,270),(410,270),(320,346)]: ellipse(d,(x-24,y-24,x+24,y+24),"#00D4B4")
d.line((230,270,320,346,410,270),fill="#00D4B4",width=14)
# shackle and body
rounded(d,(244,252,396,448),34,"#FFB703","#FFF7E8",10)
d.arc((250,126,390,326),180,360,fill="#FFF7E8",width=28)
ellipse(d,(296,320,344,368),"#302B45"); rounded(d,(310,356,330,406),10,"#302B45")
save(im,"scene-security.png")

print("generated 4 original 640px masters, 4 320px derivatives, and 4 pinned assets in", OUT)
