/**
 * "Wrapped"-style summary card: a 1200×1350 bento poster of the user's map, drawn on a 2× canvas so every portrait
 * and name stays legible (a screenshot of an 80-node graph does not). Pure data in, pixels out.
 */
import { pickName, pickTitle, type AnimeRecord, type DisplayLocale, type GraphData, type VoiceActorNode } from '../types/contract';
import type { UI } from '../i18n/ui';
import { initialsOf, withAlpha } from '../components/nodes/nodeTheme';

export const CARD = { width: 1200, height: 1350, scale: 2 } as const;
const SANS = '"Pretendard Variable", Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const PAD = 56;
const LINE = 'rgba(255,255,255,0.1)';

/** An image slot: `name` (romanised) seeds the monogram when the image cannot be loaded. */
interface Pic { src: string; color: string; name: string }
interface Chip extends Pic { label: string; title: string }
export interface CardData {
  brand: string; date: string; stats: string; favoriteLabel: string; topLabel: string; rosterLabel: string; cta: string;
  emptyTop: string;
  anchor: (Pic & { title: string; meta: string }) | null;
  top: (Pic & { label: string; badge: string; chips: Chip[] })[];
  roster: (Pic & { title: string })[];
  more: string | null;
}

type Dict = (typeof UI)['ko'];

/** Ranks bridge voice actors (degree, then role count) and packs everything the card prints, in ONE locale. */
export function buildCardData(graph: GraphData, watched: readonly AnimeRecord[], anchorId: number | null, locale: DisplayLocale, t: Dict): CardData {
  const vas = graph.nodes.filter((n): n is VoiceActorNode => n.kind === 'VOICE_ACTOR');
  const bridges = vas.filter((n) => n.degree >= 2).sort((a, b) => b.degree - a.degree || b.roles.length - a.roles.length);
  const roles = vas.reduce((sum, n) => sum + n.roles.length, 0);
  const anime = (id: number) => graph.animeById.get(id);
  const anchor = anchorId === null ? undefined : anime(anchorId);
  const shown = watched.filter((w) => graph.animeById.has(w.id));
  const ROSTER = 10;
  return {
    brand: t.brand,
    date: new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium' }).format(new Date()),
    stats: t.cardStats(graph.animeById.size, bridges.length, roles),
    favoriteLabel: t.cardFavorite, topLabel: t.cardTop, rosterLabel: t.cardRoster, cta: t.cardCta, emptyTop: t.cardNoBridges,
    anchor: anchor ? { src: anchor.coverImage, color: anchor.color, name: anchor.title.romaji, title: pickTitle(anchor.title, locale),
      meta: [anchor.seasonYear, anchor.studio].filter(Boolean).join(' · ') } : null,
    top: bridges.slice(0, 4).map((n) => {
      const color = anime(n.roles[0]?.animeId ?? -1)?.color ?? '#8b9cff';
      const perAnime = new Map<number, (typeof n.roles)[number]>();
      for (const r of n.roles) if (!perAnime.has(r.animeId) && !r.sub) perAnime.set(r.animeId, r);
      return { src: n.voiceActor.image, color, name: n.voiceActor.name.full, label: pickName(n.voiceActor.name, locale), badge: t.cardOverlap(n.degree),
        chips: [...perAnime.values()].slice(0, 4).map((r): Chip => {
          const a = anime(r.animeId);
          return { src: r.character.image, color: a?.color ?? color, name: r.character.name.full, label: pickName(r.character.name, locale), title: a ? pickTitle(a.title, locale) : '' };
        }) };
    }),
    roster: (shown.length > ROSTER ? shown.slice(0, ROSTER - 1) : shown).map((a) => ({ src: a.coverImage, color: a.color, name: a.title.romaji, title: pickTitle(a.title, locale) })),
    more: shown.length > ROSTER ? t.cardMore(shown.length - (ROSTER - 1)) : null,
  };
}

/* ------------------------------------------------------------------ */
/* CORS-safe images                                                    */
/* ------------------------------------------------------------------ */

const images = new Map<string, Promise<ImageBitmap | null>>();
/**
 * fetch → Blob → ImageBitmap keeps the canvas origin-clean (an <img> without CORS taints it and toBlob throws).
 * `no-store`: the graph's <img> tags already cached these URLs from requests without an Origin header, and the
 * AniList CDN answers those without ACAO and without `Vary: Origin` — a cache hit would fail CORS. Any failure
 * (offline, 404, timeout) resolves null and the caller paints a monogram instead, so export never fails.
 */
export function loadCorsSafeImage(url: string): Promise<ImageBitmap | null> {
  if (!url) return Promise.resolve(null);
  let job = images.get(url);
  if (!job) {
    job = fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => createImageBitmap(blob))
      .catch(() => null);
    images.set(url, job);
  }
  return job;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D;

function ellipsize(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + '…';
}
/** Up to `lines` lines, breaking on spaces when possible (CJK titles break anywhere). */
function wrap(ctx: Ctx, text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest && out.length < lines) {
    if (out.length === lines - 1 || ctx.measureText(rest).width <= max) { out.push(ellipsize(ctx, rest, max)); break; }
    let cut = rest.length;
    while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > max) cut--;
    const space = rest.lastIndexOf(' ', cut);
    if (space > cut * 0.5) cut = space;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return out;
}
function cell(ctx: Ctx, x: number, y: number, w: number, h: number, r = 20, fill = 'rgba(255,255,255,0.03)') {
  ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.stroke();
}
function text(ctx: Ctx, value: string, x: number, y: number, size: number, weight: number, color: string, font = SANS, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}
/** Cover-fit image in a rounded box, or a monogram on the accent colour when the image is unavailable. */
function picture(ctx: Ctx, img: ImageBitmap | null, pic: Pic, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  if (img) {
    const s = Math.max(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 3, iw, ih);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, withAlpha(pic.color, 0.9)); g.addColorStop(1, '#12141c');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    text(ctx, initialsOf(pic.name.replace(/[^\p{L}\p{N}\s]/gu, ' ')), x + w / 2, y + h / 2 + Math.min(w, h) * 0.14, Math.min(w, h) * 0.38, 700, 'rgba(255,255,255,0.92)', SANS, 'center');
  }
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.stroke();
}

/** Every string drawn, so the (dynamically subset) web fonts are loaded for exactly these glyphs first. */
function allText(d: CardData): string {
  return [d.brand, d.date, d.stats, d.favoriteLabel, d.topLabel, d.rosterLabel, d.cta, d.emptyTop, d.more ?? '', d.anchor?.title ?? '', d.anchor?.meta ?? '',
    ...d.top.flatMap((v) => [v.label, v.badge, ...v.chips.flatMap((c) => [c.label, c.title])]), ...d.roster.map((r) => r.title), 'anicastmap.vercel.app'].join('');
}

export async function drawSummaryCard(canvas: HTMLCanvasElement, d: CardData): Promise<void> {
  const glyphs = allText(d);
  await Promise.all([
    ...[400, 600, 700].map((w) => document.fonts.load(`${w} 24px ${SANS}`, glyphs)),
    document.fonts.load(`500 15px ${MONO}`, glyphs),
  ]).catch(() => undefined);
  const pics: Pic[] = [...(d.anchor ? [d.anchor] : []), ...d.top, ...d.top.flatMap((v) => v.chips), ...d.roster];
  const loaded = new Map(await Promise.all(pics.map(async (p) => [p.src, await loadCorsSafeImage(p.src)] as const)));
  const img = (p: Pic) => loaded.get(p.src) ?? null;

  canvas.width = CARD.width * CARD.scale; canvas.height = CARD.height * CARD.scale;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(CARD.scale, 0, 0, CARD.scale, 0, 0);
  const W = CARD.width, H = CARD.height, inner = W - PAD * 2;

  // Obsidian ground + faint constellation grid.
  ctx.fillStyle = '#090A0F'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for (let x = 0.5; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0.5; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Header strip.
  text(ctx, d.brand, PAD, 92, 30, 700, '#ffffff');
  text(ctx, d.date, W - PAD, 92, 15, 500, 'rgba(255,255,255,0.5)', MONO, 'right');
  ctx.font = `500 16px ${SANS}`;
  const statsW = ctx.measureText(d.stats).width + 32;
  cell(ctx, PAD, 112, statsW, 36, 18, 'rgba(255,255,255,0.05)');
  text(ctx, d.stats, PAD + 16, 136, 16, 500, 'rgba(255,255,255,0.85)');

  // Favourite anime.
  const ay = 166, ah = 150;
  cell(ctx, PAD, ay, inner, ah);
  if (d.anchor) {
    ctx.fillStyle = d.anchor.color; ctx.fillRect(PAD + 1, ay + 22, 3, ah - 44);
    picture(ctx, img(d.anchor), d.anchor, PAD + 22, ay + 16, 84, 118, 12);
    text(ctx, d.favoriteLabel, PAD + 130, ay + 44, 15, 600, 'rgba(255,255,255,0.5)');
    ctx.font = `700 30px ${SANS}`;
    wrap(ctx, d.anchor.title, inner - 160, 2).forEach((line, i) => text(ctx, line, PAD + 130, ay + 84 + i * 36, 30, 700, '#ffffff'));
    if (d.anchor.meta) text(ctx, d.anchor.meta, W - PAD - 22, ay + 44, 14, 500, 'rgba(255,255,255,0.45)', MONO, 'right');
  }

  // Top 4 shared voice actors (2×2).
  text(ctx, d.topLabel, PAD, 362, 22, 700, '#ffffff');
  const gx = 20, gy = 382, cw = (inner - gx) / 2, ch = 328;
  if (!d.top.length) {
    cell(ctx, PAD, gy, inner, ch);
    text(ctx, d.emptyTop, W / 2, gy + ch / 2, 18, 500, 'rgba(255,255,255,0.5)', SANS, 'center');
  }
  d.top.forEach((va, i) => {
    const x = PAD + (i % 2) * (cw + gx), y = gy + Math.floor(i / 2) * (ch + gx);
    cell(ctx, x, y, cw, ch);
    picture(ctx, img(va), va, x + 24, y + 24, 88, 88, 26);
    ctx.font = `700 24px ${SANS}`;
    text(ctx, ellipsize(ctx, va.label, cw - 160), x + 132, y + 58, 24, 700, '#ffffff');
    ctx.font = `600 14px ${SANS}`;
    const bw = ctx.measureText(va.badge).width + 24;
    ctx.beginPath(); ctx.roundRect(x + 132, y + 74, bw, 28, 14); ctx.fillStyle = withAlpha(va.color, 0.16); ctx.fill();
    ctx.strokeStyle = withAlpha(va.color, 0.55); ctx.stroke();
    text(ctx, va.badge, x + 144, y + 93, 14, 600, '#ffffff');
    text(ctx, `#${i + 1}`, x + cw - 24, y + 50, 16, 500, 'rgba(255,255,255,0.35)', MONO, 'right');
    va.chips.forEach((c, j) => {
      const cy = y + 132 + j * 48;
      picture(ctx, img(c), c, x + 24, cy, 40, 40, 11);
      ctx.font = `600 16px ${SANS}`;
      text(ctx, ellipsize(ctx, c.label, cw - 104), x + 78, cy + 18, 16, 600, '#ffffff');
      ctx.fillStyle = c.color; ctx.fillRect(x + 78, cy + 26, 2, 13);
      ctx.font = `400 15px ${SANS}`;
      text(ctx, ellipsize(ctx, c.title, cw - 112), x + 86, cy + 38, 15, 400, 'rgba(255,255,255,0.6)');
    });
  });

  // Watched roster.
  const ry = gy + ch * 2 + gx + 44;
  text(ctx, d.rosterLabel, PAD, ry, 18, 700, '#ffffff');
  const tileW = (inner - 9 * 14) / 10, tileH = tileW * 1.3;
  d.roster.forEach((a, i) => {
    const x = PAD + i * (tileW + 14), y = ry + 16;
    picture(ctx, img(a), a, x, y, tileW, tileH, 10);
    ctx.font = `500 13px ${SANS}`;
    wrap(ctx, a.title, tileW, 2).forEach((line, k) => text(ctx, line, x, y + tileH + 20 + k * 17, 13, 500, 'rgba(255,255,255,0.75)'));
  });
  if (d.more) {
    const x = PAD + 9 * (tileW + 14), y = ry + 16;
    cell(ctx, x, y, tileW, tileH, 10, 'rgba(255,255,255,0.05)');
    text(ctx, d.more, x + tileW / 2, y + tileH / 2 + 6, 16, 600, 'rgba(255,255,255,0.8)', SANS, 'center');
  }

  // Footer.
  ctx.fillStyle = LINE; ctx.fillRect(PAD, H - 52, inner, 1);
  text(ctx, 'anicastmap.vercel.app', PAD, H - 22, 15, 500, 'rgba(255,255,255,0.45)', MONO);
  text(ctx, d.cta, W - PAD, H - 22, 15, 500, 'rgba(255,255,255,0.75)', SANS, 'right');
}

export const cardBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));

