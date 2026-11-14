// Generates public/og-image.png (1200×630) and public/favicon.svg. Deterministic (seeded) — rerun after a brand change.
// Rasterisation uses macOS Quick Look (`qlmanage`), so no image dependency is needed: `node scripts/gen-og-image.mjs`
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const W = 1200, H = 630;
const BG = '#090A0F', BRIDGE = '#7cf3ff';

let seed = 20260514;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };

// Hubs = anime (accent colours from the preset palette); small nodes = their cast; cyan-ringed nodes = shared voice actors.
const hubs = [
  { x: 790, y: 150, c: '#e45d5d', n: 8 }, { x: 1040, y: 190, c: '#71b7db', n: 7 }, { x: 925, y: 385, c: '#b49be8', n: 8 },
  { x: 700, y: 440, c: '#78c6a3', n: 6 }, { x: 1100, y: 490, c: '#e4a15d', n: 6 }, { x: 1120, y: 60, c: '#e982a0', n: 4 },
];
const links = [[0, 1], [1, 2], [2, 3], [0, 3], [2, 4], [0, 2], [1, 5]];

const edges = [], nodes = [], bridges = [];
hubs.forEach((h, i) => {
  for (let k = 0; k < h.n; k++) {
    const a = (k / h.n) * Math.PI * 2 + rand() * 0.6, r = 58 + rand() * 34;
    const x = h.x + Math.cos(a) * r, y = h.y + Math.sin(a) * r;
    edges.push(`<line x1="${h.x}" y1="${h.y}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${h.c}" stroke-opacity="0.45" stroke-width="1.4"/>`);
    nodes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(5 + rand() * 4).toFixed(1)}" fill="${h.c}" stroke="${BG}" stroke-width="2.5"/>`);
  }
});
for (const [a, b] of links) {
  const A = hubs[a], B = hubs[b], t = 0.42 + rand() * 0.16;
  const x = A.x + (B.x - A.x) * t + (rand() - 0.5) * 24, y = A.y + (B.y - A.y) * t + (rand() - 0.5) * 24;
  edges.push(`<line x1="${A.x}" y1="${A.y}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${A.c}" stroke-opacity="0.75" stroke-width="2"/>`);
  edges.push(`<line x1="${B.x}" y1="${B.y}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${B.c}" stroke-opacity="0.75" stroke-width="2"/>`);
  bridges.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="#141722" stroke="${BRIDGE}" stroke-width="2.5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${BRIDGE}"/>`);
}
const hubSvg = hubs.map(h => `<circle cx="${h.x}" cy="${h.y}" r="30" fill="${h.c}" fill-opacity="0.18"/><circle cx="${h.x}" cy="${h.y}" r="20" fill="#10121a" stroke="${h.c}" stroke-width="3"/><circle cx="${h.x}" cy="${h.y}" r="7" fill="${h.c}"/>`).join('');
const stars = Array.from({ length: 70 }, () => `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H).toFixed(0)}" r="${(0.5 + rand() * 1.1).toFixed(1)}" fill="#d2dcff" fill-opacity="${(0.12 + rand() * 0.35).toFixed(2)}"/>`).join('');
const FONT = `'Apple SD Gothic Neo','Helvetica Neue',Helvetica,Arial,sans-serif`;

// Quick Look lays an SVG out in a 768px-wide viewport and scales it up to `-s` (→ ×1.5625 = 1200) on a SQUARE canvas.
// So: square viewBox, artwork centred vertically; a centred `sips` crop then yields exactly W×H.
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="${BG}"/><g transform="translate(0 ${(W - H) / 2})">
<defs><radialGradient id="g" cx="0.72" cy="0.5" r="0.7"><stop offset="0" stop-color="#171a27"/><stop offset="1" stop-color="${BG}"/></radialGradient>
<linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="${BG}" stop-opacity="0.96"/><stop offset="0.8" stop-color="${BG}" stop-opacity="0.9"/><stop offset="1" stop-color="${BG}" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>${stars}${edges.join('')}${nodes.join('')}${hubSvg}${bridges.join('')}
<rect width="660" height="${H}" fill="url(#fade)"/>
<text x="76" y="268" font-family="${FONT}" font-size="112" font-weight="700" fill="#ffffff" letter-spacing="-3">AniCastMap</text>
<text x="80" y="352" font-family="${FONT}" font-size="58" font-weight="600" fill="#d6d9ea">애니성우맵</text>
<rect x="80" y="388" width="64" height="4" rx="2" fill="${BRIDGE}"/>
<text x="80" y="446" font-family="${FONT}" font-size="31" fill="#9aa0b8">겹치는 성우로 이어지는 애니 관계도</text>
<text x="80" y="488" font-family="${FONT}" font-size="26" fill="#7c829c">Anime voice actor &amp; cast network graph</text>
<text x="80" y="570" font-family="${FONT}" font-size="24" fill="#5d6380" letter-spacing="1">anicastmap.vercel.app</text>
</g></svg>`;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${BG}"/>
<line x1="17" y1="20" x2="34" y2="34" stroke="#e45d5d" stroke-width="3" stroke-linecap="round"/><line x1="47" y1="19" x2="34" y2="34" stroke="#71b7db" stroke-width="3" stroke-linecap="round"/><line x1="34" y1="34" x2="25" y2="50" stroke="#b49be8" stroke-width="3" stroke-linecap="round"/>
<circle cx="17" cy="20" r="6" fill="#e45d5d"/><circle cx="47" cy="19" r="6" fill="#71b7db"/><circle cx="25" cy="50" r="6" fill="#b49be8"/>
<circle cx="34" cy="34" r="9" fill="#10121a" stroke="${BRIDGE}" stroke-width="3"/><circle cx="34" cy="34" r="3" fill="${BRIDGE}"/></svg>
`;

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public/favicon.svg'), favicon);
const tmp = mkdtempSync(join(tmpdir(), 'og-'));
writeFileSync(join(tmp, 'og.svg'), og);
execFileSync('qlmanage', ['-t', '-s', String(W), '-o', tmp, join(tmp, 'og.svg')], { stdio: 'ignore' });
copyFileSync(join(tmp, 'og.svg.png'), join(root, 'public/og-image.png'));
// Centred crop of the square canvas → exactly 1200×630.
execFileSync('sips', ['--cropToHeightWidth', String(H), String(W), join(root, 'public/og-image.png')], { stdio: 'ignore' });
console.log('wrote public/og-image.png and public/favicon.svg');
