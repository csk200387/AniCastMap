/** Shared by the live client and the offline preset generator. */
export function hexToHsl(hex: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#71b7db';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const l = (max + min) / 2;
  if (!delta) return [0, 0, l];
  const h = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(h * 60 + 360) % 360, delta / (1 - Math.abs(2 * l - 1)), l];
}
export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  return '#' + [0, 8, 4].map(n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  }).join('');
}
export function normalizeAccent(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  if (/^#[0-9a-f]{6}$/i.test(hex) && l >= 0.58 && l <= 0.76 && s >= 0.45) return hex.toLowerCase();
  // Inward half-channel margin keeps quantised RGB inside the requested HSL bounds.
  return hslToHex(h, Math.max(0.455, s), Math.max(0.582, Math.min(0.758, l)));
}
