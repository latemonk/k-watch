/**
 * KCG fork(07-25 사장님 지시) — 회전익(헬기) / 고정익 구분.
 *
 * 커뮤니티 ADS-B(adsb.lol · airplanes.live)의 뷰포트 피드는 기종 코드(`t`,
 * ICAO Doc 8643 형식판정부호)와 에미터 카테고리(`category`)를 같이 실어준다.
 * 이 둘로 헬기를 갈라내 지도 아이콘·목록·추적 카드에서 따로 보여준다.
 *
 * 판정 우선순위
 *   1) category === 'A7'  — ADS-B 에미터 카테고리의 회전익. 기체가 직접
 *      송신하는 값이라 가장 확실하지만, 안 채우고 쏘는 기체가 많다.
 *   2) 기종 코드 명시 목록 + 좁은 접두 규칙(오탐 예외 포함).
 *   3) 둘 다 모르면 고정익으로 둔다(모양을 함부로 바꾸지 않는다).
 *
 * ⚠접두 규칙 오탐 함정: 'H25B'(호커 800)·'SH33/SH36'(쇼츠 330/360)처럼
 * 헬기 접두를 닮은 고정익이 실제로 있다. 아래 EXCEPTIONS 로 먼저 걷어낸다.
 */

export type AircraftKind = 'helicopter' | 'fixedWing';

/** 헬기 접두를 닮았지만 고정익인 기종(오탐 차단). */
const FIXED_WING_EXCEPTIONS = new Set([
  'H25A', 'H25B', 'H25C', // Hawker 700/800/1000
  'SH33', 'SH36',         // Shorts 330 / 360
]);

/**
 * 회전익 기종 코드(ICAO Doc 8643). 접두 규칙으로 안 잡히는 것만 명시.
 * 한반도 상공 실제 등장 기체(육군 H60·H64·H47·H500·KUH1, 해경 A139·S92·
 * KA32·B412·EC55, 소방·닥터헬기 EC35·EC45·A169, 주한미군 V22)를 우선 담았다.
 */
const ROTORCRAFT_TYPES = new Set([
  // Leonardo / AgustaWestland — A1xx 는 안토노프(A124·A140·A148·A158)와
  // 겹치므로 접두 규칙을 쓰지 않고 헬기 코드만 명시한다.
  'A109', 'A119', 'A129', 'A139', 'A149', 'A169', 'A189', 'A609', 'EH10',
  // Airbus Helicopters (구 Aerospatiale/Eurocopter) — EC/H 접두는 규칙이 처리.
  'AS32', 'AS3B', 'AS50', 'AS55', 'AS65', 'BK17', 'PUMA', 'GAZL', 'LYNX',
  'NH90', 'TIGR', 'SA36', 'SA65',
  // Bell — B4xx 는 BAe146(B461~B463)과 겹칠 수 있어 헬기 코드만 명시.
  'B06', 'B06T', 'B47G', 'B47J', 'B205', 'B206', 'B212', 'B214', 'B222',
  'B230', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505',
  // Sikorsky
  'S58T', 'S61', 'S61R', 'S64', 'S65C', 'S70', 'S76', 'S92',
  // MD / Hughes / Schweizer / Enstrom / Robinson
  'EXPL', 'MD52', 'MD60', 'H269', 'S269', 'EN28', 'EN48', 'R22', 'R44', 'R66',
  // PZL / KAI / 기타
  'W3', 'KUH1', 'V22',
]);

/**
 * 접두 규칙.
 *  - MI/KA + 숫자 : 밀(Mi-8·Mi-17·Mi-24…) · 카모프(Ka-27·Ka-32·Ka-52…)
 *  - EC + 숫자    : 유로콥터 전 계열(EC30·EC35·EC45·EC55·EC75…)
 *  - H  + 숫자    : H60·H64·H47·H500·H135·H145·H160·H175 등(예외는 위에서 차단)
 *  - 군용 임무기호 + 숫자 : AH64·CH47·MH60·SH60·UH1·HH60·OH58·TH57·VH60·EH10
 */
const ROTORCRAFT_PREFIX_RE = /^(?:MI\d|KA\d|EC\d|H\d|(?:AH|CH|EH|HH|MH|OH|SH|TH|UH|VH)\d)/;

/** ADS-B 에미터 카테고리 — A7 = 회전익. */
const ROTORCRAFT_EMITTER_CATEGORY = 'A7';

/** 기종 코드·에미터 카테고리로 회전익/고정익 판정. */
export function classifyAircraftKind(a: { aircraftType?: string; emitterCategory?: string }): AircraftKind {
  const type = (a.aircraftType || '').trim().toUpperCase();
  if (type && !FIXED_WING_EXCEPTIONS.has(type)) {
    if (ROTORCRAFT_TYPES.has(type) || ROTORCRAFT_PREFIX_RE.test(type)) return 'helicopter';
  }
  // 기종 코드가 고정익으로 판정됐어도, 그건 상류 DB 가 못 맞춘 경우가 있어
  // 기체가 직접 송신하는 에미터 카테고리를 뒤에서 한 번 더 본다.
  if ((a.emitterCategory || '').trim().toUpperCase() === ROTORCRAFT_EMITTER_CATEGORY) {
    return FIXED_WING_EXCEPTIONS.has(type) ? 'fixedWing' : 'helicopter';
  }
  return 'fixedWing';
}

/** 지도·목록에서 쓰는 헬기 여부(판정 결과 캐싱 없이 가볍게 재계산). */
export function isRotorcraft(a: { aircraftType?: string; emitterCategory?: string }): boolean {
  return classifyAircraftKind(a) === 'helicopter';
}
