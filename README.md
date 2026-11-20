# AniCastMap · 애니성우맵 · アニキャストマップ

**Live:** https://anicastmap.vercel.app

AniCastMap is an interactive web app that maps the **voice actors (seiyuu) shared between the anime you watch**. Pick your anime, mark a favorite, and watch an animated network grow: anime hubs, their characters, and the voice actors who bridge your shows.

> 🇰🇷 내가 본 애니 사이에서 **겹치는 성우**를 한눈에 보여 주는 인터랙티브 관계도입니다. 로그인 없이 브라우저에서 바로 동작합니다.
> 🇯🇵 視聴したアニメをつなぐ**共通の声優**を、インタラクティブな相関図で表示するウェブアプリです。

## Features

- **Shared-voice-actor graph** — force-directed network of anime, characters and voice actors; actors who appear in 2+ of your anime are highlighted as bridges. Bridge detection scans a deep cast pool (up to 75 characters per series), so even a small supporting role is never dropped.
- **Three views** — characters, voice actors, and detail cards (keys `1` `2` `3`). Hovering a voice actor in character view fans out every character they voice.
- **Seasons merged automatically** — seasons, sequels and movies of one series become a single entry.
- **Korean-aware search** — Hangul, initial-consonant (chosung), Japanese and English titles, with Korean alias and Wikidata lookups. Only mainline TV / movie / ONA titles are shown.
- **Three display languages** — every title, character and voice actor name in Korean, Japanese or English (names come from a curated dictionary, Wikidata labels and kana-based transliteration, never from English spelling).
- **Graph filters** — *Supporting roles* (default: main characters plus supporting roles voiced by a main-role actor from another watched anime) and *Childhood / sub voice actors* (flashback and alternate voices, badged).
- **Main-role recommendations** — select a voice actor to see other anime where they play a lead; add one and it ripples into the graph.
- **Anime preview** — cover, merged seasons, main characters and voice actors, and which of them are already in your graph.
- **Remembers you** — your watched list, favorite anime, language, view mode, filters and the graph you had open are saved in your browser (`localStorage`, nothing is sent anywhere) and restored instantly on your next visit. New lists start empty. Select titles, save them to the list, then create the map. Later additions extend it in place. The 11-title example has its own temporary session.
- **Works instantly** — curated preset anime load with no network; other titles use live [AniList](https://anilist.co) data.

Keyboard: `1` `2` `3` view · `Space` pause physics · `R` replay · `F` fit view · `Esc` close.

## Tech stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS 4 · Framer Motion · d3-force (physics) · HTML canvas for edges + a transform-synced DOM layer for nodes · Zustand.

## Local development

Requires Node.js 20+ (developed on Node 26).

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build
```

### Verification scripts

```bash
node --import tsx scripts/check-graph.ts          # graph builder: bridges, filters, carry/rebuild
node --import tsx scripts/check-engine.ts         # physics, genesis, camera, recommendation overlay
node --import tsx scripts/check-persistence.ts    # saved session: validation, storage failures, restore / hydrate / reset
node --import tsx scripts/check-data.ts           # localisation, merging, search (offline)
node --import tsx scripts/check-data.ts --live    # + live AniList / Wikidata checks
```

### Data generation

```bash
node scripts/fetch-presets.mjs      # regenerate src/data/presetAnime.ts from live AniList
node scripts/ko-build-characters.mjs # regenerate src/data/koreanCharacters.ts (Korean character names by AniList id)
node scripts/gen-og-image.mjs       # regenerate public/og-image.png + favicon.svg (macOS: uses Quick Look)
```

## Project layout

```
src/types/      shared contract (records, graph model, engine handle)
src/store/      Zustand store (curation, view, filters, recommendations) + debounced persistence
src/services/   AniList client, franchise merging, search, Korean names, kana → Hangul, saved-session storage
src/engine/     graph builder (two-pass bridge-first), BFS genesis, force simulation
src/components/ canvas stage, nodes, HUD, drawers
src/lib/        session boot / restore / reset, graph rebuild helpers
src/i18n/       UI strings (ko / ja / en)
src/data/       preset anime, Korean title / name dictionaries
scripts/        verification and data-generation scripts
public/         og-image.png, favicon.svg, robots.txt, sitemap.xml, llms.txt
```

## Deployment

Deployed on Vercel. `vercel.json` sets the SPA fallback (static files such as `robots.txt`, `sitemap.xml`, `llms.txt` and `og-image.png` are served as-is) and long-lived caching for hashed assets.

## Data licence

The generated search index (`src/data/searchIndex.ts`, built by `scripts/build-search-index.ts`) is a derivative of
[anime-offline-database](https://github.com/manami-project/anime-offline-database) by manami-project and is offered
under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/), including its
share-alike terms: a publicly used adapted version of the index must also be offered under the ODbL. See
[LICENSE-DATA](LICENSE-DATA). This does not change the licensing of the code.

## Data & credits

Anime, character and voice actor data from the [AniList](https://anilist.co) GraphQL API. Korean labels additionally use [Wikidata](https://www.wikidata.org). Korean title search also uses [anime-offline-database](https://github.com/manami-project/anime-offline-database) by manami-project, made available under the [Open Database License (ODbL 1.0)](https://opendatacommons.org/licenses/odbl/1-0/). Character and cover images are loaded from AniList's CDN and belong to their respective rights holders.
