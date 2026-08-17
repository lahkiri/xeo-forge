from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'logo.png'
out = root / 'desktop' / 'assets' / 'icon.ico'
out.parent.mkdir(parents=True, exist_ok=True)
image = Image.open(source).convert('RGBA')
image.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(out)
