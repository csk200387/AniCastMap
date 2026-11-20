// D12: names on the most visible casts whose established Korean usage differs from the D4 fallback. Each is the
// 나무위키 document title found for that AniList person (review/evidence/names-evidence-40.json, 2026-11-18);
// shown as written, after curated names and before the baked 나무위키/Wikidata data.
// Owner veto of names-namuwiki-changes.json (2026-11-20): Korean dub names stay for 짱구는 못말려 and 유희왕
// (신짱구·봉미선·신형만·신짱아·유희·조이·카이바·모크바); 에렌 예거 stays (fandom usage). 로이드 프론테라, 실피에트
// and 모몽가 out-search the 나무위키 title on Google Trends (KR, 5 years; review/evidence/names-trends-veto.json).
export const ESTABLISHED_KOREAN_NAMES: { voiceActors: Record<number, string>; characters: Record<number, string> } = {
  "voiceActors": {
    "95243": "오오카와 토오루",
    "95898": "쵸",
    "95912": "소우미 요코",
    "96154": "오노 유우키",
    "107041": "오오쿠보 루미",
    "110903": "오오하시 아야카",
    "119154": "타카다 유우키"
  },
  "characters": {
    "1262": "스즈하라 토우지",
    "1555": "휴우가 히나타",
    "8298": "가오나시",
    "36828": "아스나",
    "131043": "하쿠로우",
    "1374": "유희",
    "1377": "조이",
    "1378": "카이바",
    "1381": "모크바",
    "2951": "신짱구",
    "7854": "봉미선",
    "7855": "신짱아",
    "33466": "신형만",
    "40882": "에렌 예거",
    "88346": "실피에트",
    "269308": "로이드 프론테라",
    "288500": "모몽가"
  }
};
