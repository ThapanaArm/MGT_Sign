import { fmtDate } from './format';

export const SIG_FONTS = ['Dancing Script', 'Great Vibes', 'Caveat'] as const;
export const INK = '#0B1E5B';

/** Crop a canvas to its non-transparent pixels (+8px padding) and return a PNG data URL, or null when empty. */
export function trimCanvas(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 <= x0) return null;
  const p = 8, o = document.createElement('canvas');
  o.width = x1 - x0 + p * 2; o.height = y1 - y0 + p * 2;
  o.getContext('2d')!.drawImage(c, x0 - p, y0 - p, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

/** Typed signature in a script font, trimmed PNG data URL. */
export function textSig(text: string, font: string, size = 90): string {
  const c = document.createElement('canvas');
  c.width = Math.max(200, text.length * size * 0.7 + 60); c.height = size * 1.8;
  const x = c.getContext('2d')!;
  x.font = `${size}px "${font}"`; x.fillStyle = INK; x.textBaseline = 'middle';
  x.fillText(text, 20, c.height / 2);
  return trimCanvas(c) || c.toDataURL('image/png');
}

/** Round company stamp, like the prototype's makeStamp(). */
export function makeStamp(company: string): string {
  const c = document.createElement('canvas'); c.width = c.height = 320;
  const x = c.getContext('2d')!, col = '#B3242B';
  x.strokeStyle = col; x.fillStyle = col; x.globalAlpha = 0.9;
  x.lineWidth = 8; x.beginPath(); x.arc(160, 160, 150, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 3; x.beginPath(); x.arc(160, 160, 124, 0, Math.PI * 2); x.stroke();
  const txt = (company || 'MGT GROUP').toUpperCase().slice(0, 26) + ' ★ ';
  x.font = '600 26px Prompt'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const chars = [...txt];
  const step = (Math.PI * 2) / Math.max(chars.length, 18);
  chars.forEach((ch, i) => {
    const a = -Math.PI / 2 + (i - chars.length / 2) * step;
    x.save(); x.translate(160 + Math.cos(a) * 137, 160 + Math.sin(a) * 137); x.rotate(a + Math.PI / 2); x.fillText(ch, 0, 0); x.restore();
  });
  x.font = '700 40px Prompt'; x.fillText('APPROVED', 160, 145);
  x.font = '500 24px Prompt'; x.fillText(fmtDate(Date.now()), 160, 190);
  return c.toDataURL('image/png');
}

/** Make sure the fonts used on canvases are loaded before drawing. */
export async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('400 24px Prompt'), document.fonts.load('600 24px Prompt'), document.fonts.load('700 24px Prompt'),
      ...SIG_FONTS.map(f => document.fonts.load(`40px "${f}"`)),
    ]);
    await document.fonts.ready;
  } catch { /* fonts API unavailable */ }
}

/**
 * Render a text/checkbox value to a PNG the size of the field (3x the PDF point size), font Prompt,
 * so Thai and other scripts render exactly in the server-stamped PDF.
 */
export function renderValuePng(kind: 'text' | 'checkbox', value: string, wPt: number, hPt: number): string {
  const sc = 3, c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(wPt * sc)); c.height = Math.max(4, Math.round(hPt * sc));
  const x = c.getContext('2d')!;
  if (kind === 'checkbox') {
    x.strokeStyle = '#222'; x.lineWidth = sc; x.strokeRect(sc, sc, c.width - sc * 2, c.height - sc * 2);
    if (value === 'true') {
      x.lineWidth = sc * 1.6; x.beginPath();
      x.moveTo(c.width * 0.2, c.height * 0.55); x.lineTo(c.width * 0.42, c.height * 0.78); x.lineTo(c.width * 0.82, c.height * 0.25); x.stroke();
    }
  } else {
    x.fillStyle = '#111'; x.font = `${c.height * 0.62}px Prompt`; x.textBaseline = 'middle';
    x.fillText(value, sc * 3, c.height / 2);
  }
  return c.toDataURL('image/png');
}
