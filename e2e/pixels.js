// Visual occlusion must be asserted on rendered pixels, never with
// document.elementsFromPoint: that API reports stacking order only and returns
// the topmost element even when it is fully transparent. A dropdown that let
// the board show through it passed an elementsFromPoint check for exactly that
// reason, so these helpers read the composited image instead.

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function excludedBoxes(page, selectors) {
  const boxes = [];
  for (const selector of selectors) {
    for (const handle of await page.locator(selector).all()) {
      const box = await handle.boundingBox();
      if (box) boxes.push(box);
    }
  }
  return boxes;
}

export async function scanRegion(page, selector, { exclude = [] } = {}) {
  const target = await page.locator(selector).first().boundingBox();
  if (!target) throw new Error(`scanRegion: ${selector} has no bounding box`);

  const skip = (await excludedBoxes(page, exclude))
    .filter((box) => boxesOverlap(box, target))
    .map((box) => ({
      x: Math.floor(box.x - target.x),
      y: Math.floor(box.y - target.y),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    }));

  const clip = {
    x: Math.round(target.x),
    y: Math.round(target.y),
    width: Math.round(target.width),
    height: Math.round(target.height),
  };
  const shot = await page.screenshot({ clip });

  return page.evaluate(
    async ({ dataUrl, skip, clip }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const scaleX = img.width / clip.width;
      const scaleY = img.height / clip.height;
      const scaledSkip = skip.map((s) => ({
        x: Math.floor(s.x * scaleX),
        y: Math.floor(s.y * scaleY),
        width: Math.ceil(s.width * scaleX),
        height: Math.ceil(s.height * scaleY),
      }));

      const colors = {};
      let total = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (scaledSkip.some((s) => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height)) continue;
          const i = (y * canvas.width + x) * 4;
          const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
          colors[key] = (colors[key] ?? 0) + 1;
          total += 1;
        }
      }
      return { total, colors };
    },
    { dataUrl: `data:image/png;base64,${shot.toString('base64')}`, skip, clip },
  );
}

export async function assertOpaque(page, selector, { expected, exclude = [], tolerance = 30, maxForeignRatio = 0.04 } = {}) {
  const { total, colors } = await scanRegion(page, selector, { exclude });
  if (total === 0) throw new Error(`assertOpaque: ${selector} scanned 0 pixels`);

  let targetColor = expected;
  if (!targetColor) {
    const sorted = Object.entries(colors).sort((a, b) => b[1] - a[1]);
    targetColor = sorted[0][0].split(',').map(Number);
  }

  const foreign = Object.entries(colors)
    .filter(([key]) => {
      const [r, g, b] = key.split(',').map(Number);
      return (
        Math.abs(r - targetColor[0]) > tolerance ||
        Math.abs(g - targetColor[1]) > tolerance ||
        Math.abs(b - targetColor[2]) > tolerance
      );
    })
    .sort((a, b) => b[1] - a[1]);

  const foreignCount = foreign.reduce((sum, [, count]) => sum + count, 0);
  const ratio = foreignCount / total;
  if (ratio > maxForeignRatio) {
    const worst = foreign.slice(0, 5).map(([key, count]) => `rgb(${key}) x${count}`).join(', ');
    throw new Error(
      `assertOpaque: ${selector} is not opaque — ${foreignCount}/${total} (${(ratio * 100).toFixed(1)}%) px differ from ` +
        `rgb(${targetColor.join(',')}). Content behind it is showing through. Worst offenders: ${worst}`,
    );
  }
  return { total, foreignCount, ratio };
}
