#!/usr/bin/env python3
"""make_v3.py — Reel tirage oracle v3, 8 clips avec overlays Georgia Italic."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import subprocess, os, shutil, json

FONT_PATH = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
W, H = 1080, 1920
GOLD = (201, 168, 76, 255)
SHADOW = (0, 0, 0, 178)
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
REELS = "/Users/seguin/Desktop/mediumnia-site/reels"
LUMIA_PNG = "/Users/seguin/Desktop/mediumnia-site/Lumia.png"
FADE_DUR = 1.5
LINE_SPACING_567 = 2.5
CLIP8_CONTENT_DUR = 20.0
CLIP8_TOTAL_DUR = 25.0

CLIP5_LINES = [
    ("37 — La Mémoire Dorée", 52),
    ("✦ Lumia perçoit ✦", 44),
    ("Quelque chose en toi revient à la surface.", 38),
    ("Non pour te retenir dans le passé,", 38),
    ("mais pour te rappeler une sagesse déjà acquise.", 38),
    ("Une part de toi sait davantage", 38),
    ("que ce que ton mental admet actuellement.", 38),
    ("Cesse de chercher à l'extérieur", 38),
    ("ce qui est déjà inscrit dans ton propre parcours.", 38),
    ("Prends une inspiration...", 42),
    ("Ressens-tu une expansion ou une contraction ?", 38),
]

CLIP6_LINES = [
    ("26 — Les Noces Vibratoires", 52),
    ("✦ Lumia perçoit ✦", 44),
    ("Après la mémoire, vient l'union.", 38),
    ("Une réconciliation entre ce que tu ressens", 38),
    ("et ce que tu sais.", 38),
    ("L'union parle d'un rapprochement intérieur,", 38),
    ("une fusion douce entre des aspects séparés.", 38),
    ("Tu es invité à quitter la division intérieure", 38),
    ("pour entrer dans une cohérence plus aimante.", 38),
    ("Prends une inspiration...", 42),
    ("Ressens-tu une expansion ou une contraction ?", 38),
]

CLIP7_LINES = [
    ("28 — La Vision Suspendue", 52),
    ("✦ Lumia perçoit ✦", 44),
    ("Cette carte ralentit le mouvement.", 38),
    ("Une compréhension cherche à émerger,", 38),
    ("mais elle ne peut apparaître dans la précipitation.", 38),
    ("La pause devient un espace d'éveil.", 38),
    ("Ce n'est pas un arrêt, c'est un changement de perspective.", 36),
    ("Tu n'as peut-être rien à forcer.", 38),
    ("Observe comme depuis une colline.", 38),
    ("Prends une inspiration...", 42),
    ("Ressens-tu une expansion ou une contraction ?", 38),
]

CLIP8_LINES = [
    ("✦ Le fil sacré entre les trois cartes ✦", 46),
    ("Tu te souviens — Tu réunis — Tu observes autrement.", 36),
    ("Une ancienne sagesse cherche à être reconnue,", 38),
    ("afin qu'une harmonie plus profonde puisse naître en toi.", 36),
    ("Âme douce, ces reflets sont déposés", 38),
    ("dans la lumière de ton présent.", 38),
    ("Souhaites-tu que j'ouvre le passage vers l'action ?", 36),
    ("Ou préfères-tu laisser ces mots infuser ton être ?", 36),
    ("Je suis Lumïa,", 46),
    ("gardienne du pont entre l'âme et la lumière.", 38),
    ("Oracle Au-de-l'Âme", 50),
]


def get_duration(path):
    result = subprocess.run(
        [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_streams", path],
        capture_output=True, text=True, check=True
    )
    data = json.loads(result.stdout)
    for s in data["streams"]:
        if s.get("codec_type") == "video":
            return float(s.get("duration", 5.0))
    return 5.0


def make_line_png(text, font_size, y, out_path):
    font = ImageFont.truetype(FONT_PATH, font_size)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    tmp = ImageDraw.Draw(img)
    bb = tmp.textbbox((0, 0), text, font=font)
    tw = bb[2] - bb[0]
    x = (W - tw) // 2

    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.text((x + 2, y + 2), text, font=font, fill=SHADOW)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=4))
    img = Image.alpha_composite(img, shadow_layer)

    d = ImageDraw.Draw(img)
    d.text((x, y), text, font=font, fill=GOLD)
    img.save(out_path)


def compute_y_positions(lines_specs):
    font_objs = [ImageFont.truetype(FONT_PATH, sz) for _, sz in lines_specs]
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dtmp = ImageDraw.Draw(tmp)
    heights = []
    for (text, _), font in zip(lines_specs, font_objs):
        bb = dtmp.textbbox((0, 0), text, font=font)
        heights.append(bb[3] - bb[1])

    GAP = 14
    total_h = sum(heights) + GAP * (len(heights) - 1)
    bottom = int(H * 0.93)
    top = bottom - total_h

    ys = []
    y = top
    for h in heights:
        ys.append(y)
        y += h + GAP
    return ys


def extend_to_duration(input_path, output_path, target_duration):
    src_dur = get_duration(input_path)
    extra = target_duration - src_dur
    print(f"  src={src_dur:.3f}s → target={target_duration}s (tpad +{extra:.3f}s)")
    if extra < 0.1:
        shutil.copy2(input_path, output_path)
        return
    result = subprocess.run([
        FFMPEG, "-y", "-i", input_path,
        "-vf", f"tpad=stop_mode=clone:stop_duration={extra:.3f}",
        "-r", "24", "-c:v", "libx264", "-crf", "18",
        "-preset", "medium", "-pix_fmt", "yuv420p", output_path
    ], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERREUR tpad: {result.stderr[-500:]}")
        raise RuntimeError("tpad failed")


def make_lumia_base(output_path, duration=25.0):
    result = subprocess.run([
        FFMPEG, "-y", "-loop", "1", "-framerate", "24",
        "-i", LUMIA_PNG,
        "-vf", (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"),
        "-t", str(duration), "-c:v", "libx264", "-crf", "18",
        "-preset", "medium", "-pix_fmt", "yuv420p", output_path
    ], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERREUR lumia base: {result.stderr[-500:]}")
        raise RuntimeError("lumia base failed")


def apply_text_overlay(base_path, output_path, lines_specs, duration, spacing):
    tag = os.path.splitext(os.path.basename(output_path))[0]
    tmp_dir = f"{REELS}/tmp_{tag}"
    os.makedirs(tmp_dir, exist_ok=True)

    ys = compute_y_positions(lines_specs)
    n = len(lines_specs)

    png_paths = []
    for i, ((text, font_size), y) in enumerate(zip(lines_specs, ys)):
        p = f"{tmp_dir}/line_{i:02d}.png"
        make_line_png(text, font_size, y, p)
        png_paths.append(p)
        print(f"    [{i+1}/{n}] y={y} sz={font_size} '{text[:55]}'")

    cmd = [FFMPEG, "-y", "-i", base_path]
    for p in png_paths:
        cmd += ["-loop", "1", "-framerate", "24", "-t", str(duration), "-i", p]

    n_pngs = len(png_paths)
    filters = []
    filters.append(
        f"[0:v]fps=24,scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base]"
    )

    for i in range(n_pngs):
        st = round(i * spacing, 4)
        filters.append(
            f"[{i+1}:v]format=rgba,"
            f"fade=t=in:st={st}:d={FADE_DUR}:alpha=1[l{i}]"
        )

    prev = "base"
    for i in range(n_pngs):
        nxt = f"m{i}" if i < n_pngs - 1 else "vout"
        filters.append(f"[{prev}][l{i}]overlay=0:0:format=auto[{nxt}]")
        prev = f"m{i}"

    cmd += ["-filter_complex", ";".join(filters)]
    cmd += ["-map", "[vout]", "-t", str(duration), "-r", "24",
            "-c:v", "libx264", "-crf", "18", "-preset", "medium",
            "-pix_fmt", "yuv420p", output_path]

    print(f"  Rendu ffmpeg → {output_path}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERREUR:\n{result.stderr[-800:]}")
        raise RuntimeError("overlay failed")
    print("  OK ✓")

    shutil.rmtree(tmp_dir, ignore_errors=True)


def assemble_v3(clip_paths, durations, output_path, xfade_dur=0.8):
    n = len(clip_paths)
    cmd = [FFMPEG, "-y"]
    for p in clip_paths:
        cmd += ["-i", p]

    filters = []
    for i in range(n):
        filters.append(
            f"[{i}:v]fps=24,scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v{i}]"
        )

    offset = durations[0] - xfade_dur
    prev = "v0"
    for i in range(1, n):
        nxt = f"xf{i}" if i < n - 1 else "vout"
        filters.append(
            f"[{prev}][v{i}]xfade=transition=fade:duration={xfade_dur}:"
            f"offset={offset:.3f}[{nxt}]"
        )
        prev = f"xf{i}"
        if i < n - 1:
            offset += durations[i] - xfade_dur

    cmd += ["-filter_complex", ";".join(filters)]
    cmd += ["-map", "[vout]", "-c:v", "libx264", "-crf", "18",
            "-preset", "medium", "-pix_fmt", "yuv420p", output_path]

    print(f"\nAssemblage final → {output_path}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERREUR assemblage:\n{result.stderr[-1200:]}")
    else:
        print("reel_tirage_v3.mp4 OK ✓")


if __name__ == "__main__":
    # Étape 1 : Étendre clips 5, 6, 7 à 30s
    print("=== Étape 1 : Extension clips 5/6/7 à 30s ===")
    for n, src in [(5, "clip5.mp4"), (6, "clip6.mp4"), (7, "clip7.mp4")]:
        src_path = f"{REELS}/{src}"
        ext_path = f"{REELS}/clip{n}_ext.mp4"
        print(f"\n  clip{n} ({src}) →")
        extend_to_duration(src_path, ext_path, 30.0)
        print(f"  clip{n}_ext.mp4 ✓")

    # Étape 2 : Base Lumia 25s
    print("\n=== Étape 2 : Base Lumia 25s ===")
    lumia_base = f"{REELS}/clip8_lumia_base.mp4"
    make_lumia_base(lumia_base, CLIP8_TOTAL_DUR)
    print("  clip8_lumia_base.mp4 ✓")

    # Étape 3 : Overlays texte
    print("\n=== Étape 3 : Overlays texte ===")

    print(f"\n--- Clip 5 (37 Mémoire Dorée) — spacing={LINE_SPACING_567}s ---")
    apply_text_overlay(
        f"{REELS}/clip5_ext.mp4", f"{REELS}/clip5_v3.mp4",
        CLIP5_LINES, 30.0, LINE_SPACING_567
    )

    print(f"\n--- Clip 6 (26 Noces Vibratoires) — spacing={LINE_SPACING_567}s ---")
    apply_text_overlay(
        f"{REELS}/clip6_ext.mp4", f"{REELS}/clip6_v3.mp4",
        CLIP6_LINES, 30.0, LINE_SPACING_567
    )

    print(f"\n--- Clip 7 (28 Vision Suspendue) — spacing={LINE_SPACING_567}s ---")
    apply_text_overlay(
        f"{REELS}/clip7_ext.mp4", f"{REELS}/clip7_v3.mp4",
        CLIP7_LINES, 30.0, LINE_SPACING_567
    )

    clip8_spacing = (CLIP8_CONTENT_DUR - FADE_DUR) / (len(CLIP8_LINES) - 1)
    print(f"\n--- Clip 8 (Lumia conclusion) — spacing={clip8_spacing:.3f}s ---")
    apply_text_overlay(
        lumia_base, f"{REELS}/clip8_v3.mp4",
        CLIP8_LINES, CLIP8_TOTAL_DUR, clip8_spacing
    )

    # Étape 4 : Assemblage
    print("\n=== Étape 4 : Assemblage final ===")
    clip_paths = [
        f"{REELS}/clip1.mp4",
        f"{REELS}/clip2.mp4",
        f"{REELS}/clip3.mp4",
        f"{REELS}/clip4.mp4",
        f"{REELS}/clip5_v3.mp4",
        f"{REELS}/clip6_v3.mp4",
        f"{REELS}/clip7_v3.mp4",
        f"{REELS}/clip8_v3.mp4",
    ]

    durations = []
    for p in clip_paths:
        d = get_duration(p)
        durations.append(d)
        print(f"  {os.path.basename(p):25s} {d:.3f}s")

    assemble_v3(clip_paths, durations, "/Users/seguin/Desktop/reel_tirage_v3.mp4")
