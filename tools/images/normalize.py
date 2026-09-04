#!/usr/bin/env python3
"""
Приведение фото товаров и устройств к единому стандарту (docs/IMAGE_STANDARD.md):
фон удалён, объект отцентрован на квадратном холсте, поля одинаковые, результат — WebP с альфа-каналом.

Использование:
  pip install -r tools/images/requirements.txt
  python tools/images/normalize.py <папка-или-файл> <папка-вывода> [--model isnet-general-use] [--flood] [--largest]

  --flood    вместо нейросети удалять однотонный светлый фон заливкой от краёв (студийные фото на белом,
             в том числе тёмные объекты, которые нейросеть делает полупрозрачными)
  --largest  оставить только самый крупный объект (убирает ошмётки фона; не использовать для наборов из нескольких предметов)
  --threshold N  порог альфы для жёсткой маски (по умолчанию 90)
  --fill 0.84    доля стороны холста, которую занимает объект
  --side 1000    сторона холста в пикселях

Та же геометрия применяется на сервере при загрузке (packages/domain/src/media/normalize.ts);
удаление фона на сервере включается переменной IMAGE_CUTOUT_COMMAND, например:
  IMAGE_CUTOUT_COMMAND=rembg i -m isnet-general-use {input} {output}
"""
import argparse
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

try:
    from scipy import ndimage
except ImportError:  # scipy нужен только для --largest
    ndimage = None


def normalize(rgba: Image.Image, side: int, fill: float) -> Image.Image | None:
    bbox = rgba.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
    if not bbox:
        return None
    obj = rgba.crop(bbox)
    scale = side * fill / max(obj.size)
    obj = obj.resize((max(1, round(obj.width * scale)), max(1, round(obj.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(obj, ((side - obj.width) // 2, (side - obj.height) // 2), obj)
    return canvas


def solidify(rgba: Image.Image, thr: int, largest: bool) -> Image.Image:
    a = np.asarray(rgba.getchannel('A'))
    hard = a > thr
    if largest:
        if ndimage is None:
            sys.exit('--largest требует scipy')
        lab, n = ndimage.label(hard)
        if n > 1:
            sizes = ndimage.sum(hard, lab, range(1, n + 1))
            hard = lab == (1 + int(np.argmax(sizes)))
    soft = np.clip((a.astype(int) - thr) * 255 // max(1, 200 - thr), 0, 255).astype('uint8')
    alpha = Image.fromarray(np.where(hard, np.maximum(soft, 1), 0).astype('uint8')).filter(ImageFilter.GaussianBlur(0.5))
    out = rgba.copy()
    out.putalpha(alpha)
    return out


def flood_cut(im: Image.Image, tol: int = 28) -> Image.Image:
    """Удаляет светлый однотонный фон заливкой от краёв кадра."""
    im = im.convert('RGB')
    a = np.asarray(im).astype(int)
    h, w, _ = a.shape
    near = a.min(axis=2) >= 255 - tol
    mask = np.zeros((h, w), bool)
    q: deque = deque()
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True
                q.append((ny, nx))
    alpha = Image.fromarray(((~mask) * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--model', default='isnet-general-use')
    ap.add_argument('--flood', action='store_true')
    ap.add_argument('--largest', action='store_true')
    ap.add_argument('--threshold', type=int, default=90)
    ap.add_argument('--fill', type=float, default=0.84)
    ap.add_argument('--side', type=int, default=1000)
    args = ap.parse_args()

    files = [args.src] if os.path.isfile(args.src) else [os.path.join(args.src, n) for n in sorted(os.listdir(args.src)) if n.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
    os.makedirs(args.out, exist_ok=True)
    session = None
    if not args.flood:
        from rembg import new_session, remove

        session = new_session(args.model)
    for f in files:
        im = Image.open(f).convert('RGB')
        im.thumbnail((1400, 1400))
        cut = flood_cut(im) if args.flood else remove(im, session=session)
        result = normalize(solidify(cut, args.threshold, args.largest), args.side, args.fill)
        stem = os.path.splitext(os.path.basename(f))[0]
        if result is None:
            print(f'! {stem}: объект не найден', file=sys.stderr)
            continue
        result.save(os.path.join(args.out, f'{stem}.webp'), 'WEBP', quality=90, method=4)
        print(stem)


if __name__ == '__main__':
    main()
