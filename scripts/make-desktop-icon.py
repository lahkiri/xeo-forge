from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "logo.png"
out = root / "desktop" / "assets" / "icon.ico"
out.parent.mkdir(parents=True, exist_ok=True)

# electron-builder requires an ICO entry at least 256x256; upscale the supplied 128px mark once.
image = Image.open(source).convert("RGBA").resize((256, 256), Image.Resampling.LANCZOS)
image.save(
    out,
    sizes=[
        (16, 16),
        (24, 24),
        (32, 32),
        (48, 48),
        (64, 64),
        (128, 128),
        (256, 256),
    ],
)
print(out)
