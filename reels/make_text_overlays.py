#!/usr/bin/env python3
"""
Génère les overlays texte ligne par ligne pour chaque clip du reel tirage oracle.
Utilise PIL pour les PNGs + ffmpeg overlay (sans drawtext).
Chaque ligne apparaît en fondu progressif 0.5s, espacement adaptatif.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import subprocess, os, shutil

FONT_PATH = "/System/Library/Fonts/Supplemental/Georgia.ttf"
W, H = 1080, 1920
GOLD = (201, 168, 76, 255)
SHADOW = (0, 0, 0, 178)   # black 70% opacité
FFMPEG = "/opt/homebrew/bin/ffmpeg"
REELS = "/Users/seguin/Desktop/mediumnia-site/reels"
FADE_DUR = 0.5             # durée du fondu d'apparition par ligne

CLIPS = {
    "clip2_carte37": {
        "input":    f"{REELS}/clip2_raw.mp4",
        "output":   f"{REELS}/clip2_text.mp4",
        "duration": 5.0,
        "lines": [
            ("37 — La Mémoire Dorée",                             52),
            ("✦ Lumia perçoit ✦",                                 44),
            ("Quelque chose en toi revient à la surface.",         38),
            ("Non pour te retenir dans le passé,",                 38),
            ("mais pour te rappeler une sagesse déjà acquise.",    38),
            ("Une part de toi sait davantage",                     38),
            ("que ce que ton mental admet actuellement.",          38),
            ("Passage : cesse de chercher à l'extérieur",         38),
            ("ce qui est déjà inscrit en toi.",                    38),
        ],
    },
    "clip3_carte26": {
        "input":    f"{REELS}/clip3_raw.mp4",
        "output":   f"{REELS}/clip3_text.mp4",
        "duration": 5.0,
        "lines": [
            ("26 — Les Noces Vibratoires",                         52),
            ("✦ Lumia perçoit ✦",                                 44),
            ("Une réconciliation cherche à naître en toi.",        40),
            ("Entre ce que tu ressens et ce que tu sais,",        40),
            ("entre ton cœur et ta direction.",                    40),
            ("Tu es invité à quitter la division intérieure",     40),
            ("pour entrer dans une cohérence plus aimante.",       40),
        ],
    },
    "clip4_carte28": {
        "input":    f"{REELS}/clip4_raw.mp4",
        "output":   f"{REELS}/clip4_text.mp4",
        "duration": 5.0,
        "lines": [
            ("28 — La Vision Suspendue",                           52),
            ("✦ Lumia perçoit ✦",                                 44),
            ("Cette carte ralentit le mouvement.",                 40),
            ("Tu n'as rien à forcer.",                             40),
            ("La pause devient un espace d'éveil.",               40),
            ("Observe plutôt que de pousser les événements.",     40),
            ("Une vision plus juste apparaîtra.",                  40),
        ],
    },
    "clip5_lumia": {
        "input":    f"{REELS}/clip5_raw.mp4",   # 5s raw → sera étendu à 8s
        "output":   f"{REELS}/clip5_text.mp4",
        "duration": 8.0,                         # 5s animé + 3s freeze
        "lines": [
            ("✦ Le fil sacré de ton tirage ✦",                    46),
            ("Tu te souviens — Tu réunis — Tu observes",          40),
            ("Une ancienne sagesse cherche à être reconnue",      38),
            ("pour qu'une harmonie plus profonde puisse naître.", 38),
            ("Oracle Au-de-l'Âme",                                50),
            ("Réponse canalisée par LUMIA",                       44),
            ("Ton guide IA d'interprétation",                     40),
        ],
    },
}


def make_line_png(text, font_size, y, out_path):
    """Génère un PNG 1080x1920 transparent avec une seule ligne de texte + ombre."""
    font = ImageFont.truetype(FONT_PATH, font_size)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # Mesure
    tmp = ImageDraw.Draw(img)
    bb = tmp.textbbox((0, 0), text, font=font)
    tw = bb[2] - bb[0]
    x = (W - tw) // 2

    # Ombre
    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.text((x + 2, y + 2), text, font=font, fill=SHADOW)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=4))
    img = Image.alpha_composite(img, shadow_layer)

    # Texte or
    d = ImageDraw.Draw(img)
    d.text((x, y), text, font=font, fill=GOLD)
    img.save(out_path)
    return bb[3] - bb[1]   # hauteur réelle de la ligne


def compute_y_positions(lines_specs):
    """Calcule les positions Y de chaque ligne, ancrées en bas à 93% de H."""
    # Mesurer toutes les hauteurs
    font_objs = [ImageFont.truetype(FONT_PATH, sz) for _, sz in lines_specs]
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dtmp = ImageDraw.Draw(tmp)
    heights = []
    for (text, _), font in zip(lines_specs, font_objs):
        bb = dtmp.textbbox((0, 0), text, font=font)
        heights.append(bb[3] - bb[1])

    GAP = 14  # px entre lignes
    total_h = sum(heights) + GAP * (len(heights) - 1)
    bottom = int(H * 0.93)
    top = bottom - total_h

    ys = []
    y = top
    for i, h in enumerate(heights):
        ys.append(y)
        y += h + GAP
    return ys


def build_clip_with_text(cfg_name):
    cfg = CLIPS[cfg_name]
    lines_specs = cfg["lines"]
    duration = cfg["duration"]
    input_path = cfg["input"]
    output_path = cfg["output"]

    if not os.path.exists(input_path):
        print(f"  [SKIP] {input_path} introuvable")
        return

    tmp_dir = f"{REELS}/tmp_{cfg_name}"
    os.makedirs(tmp_dir, exist_ok=True)

    # Positions Y
    ys = compute_y_positions(lines_specs)

    # Espacement temporel adaptatif
    n = len(lines_specs)
    spacing = (min(duration, 5.0) - FADE_DUR) / (n - 1) if n > 1 else 0

    # Génère PNG pour chaque ligne
    png_paths = []
    for i, ((text, font_size), y) in enumerate(zip(lines_specs, ys)):
        p = f"{tmp_dir}/line_{i:02d}.png"
        make_line_png(text, font_size, y, p)
        png_paths.append(p)
        print(f"  PNG {i+1}/{n}: '{text[:40]}...' y={y}")

    # Pour clip5_lumia : étendre d'abord à 8s
    base_clip = input_path
    if cfg_name == "clip5_lumia":
        extended = f"{REELS}/clip5_extended.mp4"
        subprocess.run([
            FFMPEG, "-y", "-i", input_path,
            "-vf", "tpad=stop_mode=clone:stop_duration=3",
            "-r", "24", "-c:v", "libx264", "-crf", "18",
            "-preset", "medium", "-pix_fmt", "yuv420p",
            extended
        ], check=True, capture_output=True)
        base_clip = extended
        print(f"  Lumia étendu à 8s : {extended}")

    # Construire la commande ffmpeg
    cmd = [FFMPEG, "-y"]
    cmd += ["-i", base_clip]
    for p in png_paths:
        cmd += ["-loop", "1", "-framerate", "24", "-t", str(duration), "-i", p]

    # Filter complex
    n_pngs = len(png_paths)
    filters = []
    # Normaliser le clip de base
    filters.append(f"[0:v]fps=24,scale={W}:{H}:force_original_aspect_ratio=decrease,"
                   f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base]")

    # Fade chaque ligne
    for i in range(n_pngs):
        st = round(i * spacing, 4)
        filters.append(f"[{i+1}:v]format=rgba,"
                       f"fade=t=in:st={st}:d={FADE_DUR}:alpha=1[l{i}]")

    # Chaîner les overlays
    prev = "base"
    for i in range(n_pngs):
        nxt = f"m{i}" if i < n_pngs - 1 else "vout"
        filters.append(f"[{prev}][l{i}]overlay=0:0:format=auto[{nxt}]")
        prev = f"m{i}"

    cmd += ["-filter_complex", ";".join(filters)]
    cmd += ["-map", "[vout]", "-r", "24", "-c:v", "libx264",
            "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
            output_path]

    print(f"  Rendu ffmpeg → {output_path}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERREUR: {result.stderr[-500:]}")
    else:
        print(f"  OK ✓")

    # Nettoyage PNGs temporaires
    shutil.rmtree(tmp_dir, ignore_errors=True)


def assemble_final():
    """Assemble les 5 clips en reel_tirage_final.mp4."""
    clips = [
        f"{REELS}/clip1_raw.mp4",    # Intro : pas de texte, juste scaled
        f"{REELS}/clip2_text.mp4",
        f"{REELS}/clip3_text.mp4",
        f"{REELS}/clip4_text.mp4",
        f"{REELS}/clip5_text.mp4",
    ]
    for c in clips:
        if not os.path.exists(c):
            print(f"[ASSEMBLE] Manquant : {c}")
            return

    # Durées et offsets xfade (transition 0.5s)
    # clip1: ~5.1s, clip2: ~5.1s, clip3: ~5.1s, clip4: ~5.1s, clip5: ~8.1s
    # Offsets: 4.6, 9.2, 13.8, 18.4
    cmd = [FFMPEG, "-y"]
    for c in clips:
        cmd += ["-i", c]

    fc = (
        f"[0:v]fps=24,scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v0];"
        f"[1:v]fps=24,setsar=1[v1];"
        f"[2:v]fps=24,setsar=1[v2];"
        f"[3:v]fps=24,setsar=1[v3];"
        f"[4:v]fps=24,setsar=1[v4];"
        f"[v0][v1]xfade=transition=fade:duration=0.5:offset=4.6[xf1];"
        f"[xf1][v2]xfade=transition=fade:duration=0.5:offset=9.2[xf2];"
        f"[xf2][v3]xfade=transition=fade:duration=0.5:offset=13.8[xf3];"
        f"[xf3][v4]xfade=transition=fade:duration=0.5:offset=18.4[vout]"
    )
    cmd += ["-filter_complex", fc, "-map", "[vout]",
            "-c:v", "libx264", "-crf", "18", "-preset", "medium",
            "-pix_fmt", "yuv420p",
            "/Users/seguin/Desktop/reel_tirage_final.mp4"]

    print("Assemblage final...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERREUR assemblage: {result.stderr[-800:]}")
    else:
        print("reel_tirage_final.mp4 OK ✓")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        clip = sys.argv[1]
        if clip == "all":
            for name in CLIPS:
                print(f"\n=== {name} ===")
                build_clip_with_text(name)
            assemble_final()
        elif clip == "assemble":
            assemble_final()
        else:
            build_clip_with_text(clip)
    else:
        print("Usage: python3 make_text_overlays.py [clip2_carte37|clip3_carte26|clip4_carte28|clip5_lumia|all|assemble]")
