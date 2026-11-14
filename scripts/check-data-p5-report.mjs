// Run with node scripts/check-data-p5-report.mjs to print the full lead report.
const report = `# P5-DATA-SUBVA-KONAMES implementation report

Only the dispatched services/data/scripts paths were edited. No dependencies, dev server, contract, engine, store, or UI changes.

## Changed files

- Services: \`anilistClient.ts\`, \`franchise.ts\`, \`localize.ts\`, new \`voiceCredits.ts\`, \`kanaToHangul.ts\`, \`koreanNameResolver.ts\`.
- Data: generated \`koreanCharacters.ts\`, generated \`koreanNameCache.ts\`, \`koreanNames.ts\`, regenerated \`presetAnime.ts\`.
- Scripts: \`fetch-presets.mjs\`, \`check-data.ts\`, new \`verify-title-ids.ts\`, \`ko-character-source.mjs\`, \`ko-build-characters.mjs\`, \`ko-check-resolver.ts\`, \`check-data-p5-report.mjs\`.

## Credits and payload reliability

Every cast query uses \`voiceActorRoles(language:JAPANESE,sort:[RELEVANCE,ID]) { roleNotes dubGroup voiceActor { id name { full native } image { large } } }\`.

Cheap metadata/relations remain batched in up to eight media aliases. Each cast request contains one media with two character aliases of 25 entries, except releases after the first four in a franchise of more than five members (one 25-entry page). This preserves the existing traversal and request budget.

| Franchise | Members | Cast request shape | Total AniList requests |
| --- | ---: | --- | ---: |
| Re:Zero | 5 | Five requests, each two pages | 10 in live check; 11 in final regeneration |
| Jujutsu Kaisen | 6 | First four two pages; last two one page | 11 |
| Frieren | 2 | Two requests, each two pages | 4 |

These are actual cold live loads, not preset hits. No HTTP 500 failures occurred in the measured loads; normal 429 backoff remained enabled. Re:Zero and Jujutsu Kaisen both retain 75 characters, with display cast derived by slicing the first 16. Names/subcredits are enriched only after the franchise pool is merged and capped.

Sein: primary Yuuichi Nakamura, sub Natsumi Kawaida / CHILDHOOD. Stark: primary Chiaki Kobayashi, sub Arisa Kiyoto / CHILDHOOD. These are verified by runtime names and returned AniList records. Each character occupies one pool entry. Merge selects a primary from a highest-role occurrence when available, otherwise the first non-null primary. Any member primary is excluded from merged subs; CHILDHOOD wins over ALTERNATE when sub IDs overlap.

## Korean character dictionary

358 unique AniList character IDs, from 26 source groups. Matching is case-insensitive exact \`name.full\`, including AniList's accents and occasional trailing spaces. Counts below are source names matched, so shared IDs across groups count once in the generated dictionary.

| Source franchise | Matched / requested | Unmatched in the traversed deep pool |
| --- | ---: | --- |
| 장송의 프리렌 (154587) | 26/28 | Macht, Solitar |
| 주술회전 (113415) | 26/26 | — |
| 진격의 거인 (16498) | 20/20 | — |
| 체인소 맨 (127230) | 15/15 | — |
| 봇치 더 록! (130003) | 13/13 | — |
| 최애의 아이 (150672) | 15/17 | Gorou Amamiya, Sarina Tendouji |
| 귀멸의 칼날 (101922) | 24/24 | — |
| Re:제로부터 시작하는 이세계 생활 (21355) | 25/25 | — |
| 닥터 스톤 (105333) | 16/18 | Ryuusui Nanami, Francois |
| 사이키 쿠스오의 재난 (98034) | 14/14 | — |
| 그 비스크 돌은 사랑을 한다 (132405) | 6/7 | Amane Himeno |
| 나 혼자만 레벨업 (151807) | 14/14 | — |
| 던전밥 (153518) | 16/16 | — |
| 약사의 혼잣말 (161645) | 17/17 | — |
| 초 가구야 공주! (201903) | 4/4 | — |
| 스파이 패밀리 (140960) | 12/12 | — |
| 목소리의 형태 (20954) | 8/8 | — |
| 너의 이름은. (21519) | 7/7 | — |
| 하이큐!! (20464) | 13/13 | — |
| 원펀맨 (21087) | 12/12 | — |
| 청춘 돼지는 바니걸 선배의 꿈을 꾸지 않는다 (101291) | 8/8 | — |
| 모브 사이코 100 (21507) | 12/12 | — |
| 카구야 님은 고백받고 싶어 (101921) | 12/12 | — |
| 도쿄 구울 (20605) | 12/12 | — |
| 노라가미 (20447) | 11/11 | — |
| 진격! 거인중학교 (21281) | 12/12 | — |

The seven unmatched source names are absent from the currently traversed anime pools and are omitted from the generated ID dictionary. No IDs or Korean spellings were invented to force matches. All 26 present Frieren source names use the requested Korean spellings, including Sein → 자인, Übel → 위벨, Lügner → 뤼그너, Flamme → 플람메.

## Wikidata

Resolution accepts an exact Japanese label and human Q5 for VAs, or an exact Japanese label plus instance/subclass path to fictional character Q95074 for characters. More than one matching ko-labelled entity is rejected. Anime IDs use [P8729](https://www.wikidata.org/wiki/Property:P8729) before a typed Japanese-title match. See [Q95074](https://www.wikidata.org/wiki/Q95074) for the character class.

One franchise-wide SPARQL POST handles all remaining unknown names, with a three-second total cap (including pacing), at most one request per second, silent failure, and positive/negative seven-day cache entries. \`ensureKoName\` reads the static/localStorage cache synchronously. Node uses the same in-memory cache. The generated static cache contains 109 successful labels and nine negative entries.

The voice-only diagnostic batch for the Frieren pool resolved 56/64 previously unknown names (87.5%); the following Jujutsu Kaisen diagnostic resolved 53/54 additional unknown names (98.1%) after shared cache hits. Both requests completed within three seconds. These counts exclude curated records and the two manual corrections below. Full mixed character/VA batches often exceed the three-second cap; their network-only yield can be zero. Static hits preserve the audited voice labels in those cases, and fallback localisation still completes within the cap. Some smaller mixed batches resolve successfully. Character resolution remains enabled with the strict ambiguity/type guard; no blanket restriction was applied.

Spot-checked exact-native VA resolutions (all printed by the audit script):

| AniList full name | Japanese | Wikidata Korean label |
| --- | --- | --- |
| Arisa Kiyoto | 清都ありさ | 키요토 아리사 |
| Youji Ueda | 上田燿司 | 우에다 요지 |
| Hiroki Touchi | 東地宏樹 | 토치 히로키 |
| Atsuko Tanaka | 田中敦子 | 타나카 아츠코 |
| Natsumi Kawaida | 川井田夏海 | 카와이다 나츠미 |
| Jirou Saitou | 斉藤次郎 | 사이토 지로 |
| Haruka Terui | 照井春佳 | 테루이 하루카 |
| Ayana Taketatsu | 竹達彩奈 | 타케타츠 아야나 |
| Tarusuke Shingaki | 新垣樽助 | 신가키 타루스케 |
| Takuya Eguchi | 江口拓也 | 에구치 타쿠야 |
| Junichi Suwabe | 諏訪部順一 | 스와베 준이치 |
| Mikako Komatsu | 小松未可子 | 코마츠 미카코 |
| Kouki Uchiyama | 内山昂輝 | 우치야마 고키 |
| Subaru Kimura | 木村昴 | 키무라 스바루 |

Exact matching prevents wrong-entity matches, but Wikidata ko labels can contain editorial errors. Two observed errors were overridden in \`KO_NAMES\`: Megumi Arakawa → 아라카와 메구미, Naoki Bandou → 반도 나오키. Curated dictionaries always outrank the resolver. Native-only matching also safely misses non-identical ja spellings; it does not guess.

## Localisation and regeneration

Precedence: existing curated ko → character-ID dictionary / VA-full-name dictionary → validated synchronous Wikidata cache → native kana → existing romaji (family-first for kanji natives) → native fallback. Existing call signatures still work. Kana tests cover all ten requested examples, hiragana, small-kana combinations, long vowels, and batchim. ン uses ㄴ without optional labial assimilation. The existing curated-pair romaji regression is 95/110 = 86.4% (original 93/108 = 86.1%).

Reproduction commands:

\`\`\`sh
node scripts/ko-build-characters.mjs
node --import tsx scripts/ko-check-resolver.ts --voices-only --write-cache
node scripts/fetch-presets.mjs
node --import tsx scripts/check-data.ts
node --import tsx scripts/check-data.ts --live
node --import tsx scripts/verify-title-ids.ts
\`\`\`

\`ko-build-characters.mjs --cached\` reuses the live snapshots it writes to \`/tmp/animegraph-p5-pools\`. \`fetch-presets.mjs --cached\` uses those snapshots and reapplies the current dictionaries/resolver. \`fetch-presets.mjs --selected\` fetches the current 11-preset selection afresh; default mode reevaluates the broader candidate set. The audit script reads those same snapshots.

## Final validation

Final verification passed on the final implementation:

- \`node --import tsx scripts/check-data.ts\`: PASS offline.
- \`node --import tsx scripts/check-data.ts --live\`: PASS offline and live, including Sein/Stark subcredits, all present Frieren dictionary names, Re:Zero/Noi/Matsuoka identity, search, bridge, roots, filmography and recommendations.
- \`node --import tsx scripts/verify-title-ids.ts\`: PASS, all 93 IDs (including Dungeon Meshi, Solo Leveling and The Apothecary Diaries).
- Requested filtered typecheck: zero errors in owned files.

 Presets: 337,374 bytes (329.5 KiB), 11 franchises, 159 primary bridge VAs; Re:Zero retained. Sein has \`ko: "자인"\` with primary/sub credits baked in. JSON remains compact, and \`cast\` is derived from the stored deep pool.

No functional contract change is needed. The locked \`AnimeRecord.fullCastPool\` comment still mentions unique character/VA pairs; the lead may update that documentation to describe one entry per character. The contract was not edited.
`;
console.log(report);
