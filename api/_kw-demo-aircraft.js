// api/_kw-demo-aircraft.js
// K-Watch 데모 항공기 — 로그인 전 화면용 시연 항적. 상태 없이 「현재 시각」의
// 순수 함수로 계산한다(어느 요청에서도 같은 기체가 같은 자리). 한반도 권역
// 정기편(국내선·근거리 국제선) + 해경 회전익·고정익 순찰기 소수.
//
// 응답 형식은 aviation/v1 PositionSample 과 같고 source 는 SIMULATED 로 박아
// 실데이터와 구분된다. /api/kcg-aircraft-trace 의 trace·live 응답도 같은
// 모델에서 만들어 추적 카드가 데모에서도 움직인다.

const AIRPORTS = {
  ICN: [37.469, 126.451], GMP: [37.558, 126.791], CJU: [33.511, 126.493], PUS: [35.179, 128.938],
  TAE: [35.894, 128.659], KWJ: [35.126, 126.809], CJJ: [36.717, 127.499], RSU: [34.842, 127.617],
  USN: [35.594, 129.352], KPO: [35.988, 129.420], KUV: [35.904, 126.616], YNY: [38.061, 128.669],
  NRT: [35.772, 140.393], KIX: [34.427, 135.244], FUK: [33.586, 130.451], HND: [35.553, 139.781],
  PVG: [31.144, 121.808], TAO: [36.362, 120.088], TSN: [39.124, 117.346], DLC: [38.966, 121.539], HKG: [22.308, 113.918],
};

// [출발, 도착, 편수(왕복 슬롯), 항공사 코드 목록, 순항고도 m]
const ROUTES = [
  ['GMP', 'CJU', 12, ['KAL', 'AAR', 'JJA', 'JNA', 'TWB', 'ABL', 'ESR'], 7900],
  ['ICN', 'CJU', 2, ['KAL', 'JJA'], 7900],
  ['PUS', 'CJU', 4, ['KAL', 'ABL', 'JJA'], 6700],
  ['TAE', 'CJU', 2, ['TWB', 'JNA'], 6700],
  ['KWJ', 'CJU', 2, ['KAL', 'JJA'], 5500],
  ['CJJ', 'CJU', 2, ['AAR', 'ESR'], 6700],
  ['GMP', 'PUS', 4, ['KAL', 'AAR', 'JJA'], 7300],
  ['GMP', 'USN', 1, ['KAL'], 6100],
  ['GMP', 'RSU', 1, ['AAR'], 5500],
  ['GMP', 'YNY', 1, ['JJA'], 4900],
  ['ICN', 'FUK', 4, ['KAL', 'JJA', 'TWB'], 9400],
  ['PUS', 'FUK', 2, ['ABL', 'JJA'], 7000],
  ['ICN', 'KIX', 4, ['KAL', 'AAR', 'JNA'], 10400],
  ['PUS', 'KIX', 1, ['ABL'], 9400],
  ['ICN', 'NRT', 4, ['KAL', 'AAR', 'JAL'], 11000],
  ['ICN', 'HND', 2, ['ANA', 'KAL'], 11000],
  ['ICN', 'PVG', 4, ['CES', 'KAL', 'AAR'], 10400],
  ['ICN', 'TAO', 2, ['CSN', 'KAL'], 8800],
  ['ICN', 'TSN', 1, ['KAL'], 10400],
  ['ICN', 'DLC', 1, ['CSN'], 9400],
  ['ICN', 'HKG', 2, ['CPA', 'KAL'], 11600],
  ['PUS', 'PVG', 1, ['CES'], 9400],
  // 한반도 상공 통과편
  ['TSN', 'NRT', 3, ['JAL', 'ANA', 'CCA'], 11600],
  ['DLC', 'KIX', 2, ['CSN', 'JAL'], 11000],
  ['TAO', 'NRT', 2, ['CSN', 'ANA'], 11600],
  ['TSN', 'HND', 2, ['ANA', 'CCA'], 11900],
];

// 해경 항공기(회전익·고정익) — 정박 기지 주변 순찰 궤도
const PATROL = [
  { hex: '71c9a1', callsign: 'KCG501', type: 'KUH1', category: 'A7', reg: 'HL9625', base: [37.15, 125.9], r: 0.45, alt: 460, gs: 105, periodMin: 55, phase: 0.1 },
  { hex: '71c9a2', callsign: 'KCG512', type: 'AW139', category: 'A7', reg: 'HL9642', base: [34.55, 126.1], r: 0.5, alt: 520, gs: 120, periodMin: 65, phase: 0.6 },
  { hex: '71c9a3', callsign: 'KCG523', type: 'S92', category: 'A7', reg: 'HL9656', base: [34.7, 129.35], r: 0.55, alt: 490, gs: 125, periodMin: 70, phase: 0.35 },
  { hex: '71c9a4', callsign: 'KCG531', type: 'KUH1', category: 'A7', reg: 'HL9631', base: [37.6, 130.6], r: 0.6, alt: 430, gs: 100, periodMin: 75, phase: 0.8 },
  { hex: '71c9b1', callsign: 'KCG701', type: 'CN35', category: 'A3', reg: 'HL5237', base: [36.3, 124.6], r: 1.4, alt: 1520, gs: 205, periodMin: 130, phase: 0.25 },
  { hex: '71c9b2', callsign: 'KCG702', type: 'C295', category: 'A3', reg: 'HL5241', base: [36.6, 131.2], r: 1.6, alt: 1680, gs: 215, periodMin: 150, phase: 0.7 },
];

const CRUISE_KTS = 445;
const TURNAROUND_MIN = 55;   // 착륙 → 다음 출발까지(지상 대기·표시 안 함)
const TAXI_MIN = 6;

function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }
function distNm(a, b) {
  const φ1 = rad(a[0]), φ2 = rad(b[0]), Δφ = rad(b[0] - a[0]), Δλ = rad(b[1] - a[1]);
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearing(a, b) {
  const φ1 = rad(a[0]), φ2 = rad(b[0]), Δλ = rad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
// 대권 보간
function interp(a, b, f) {
  const φ1 = rad(a[0]), λ1 = rad(a[1]), φ2 = rad(b[0]), λ2 = rad(b[1]);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ1 - φ2) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ1 - λ2) / 2) ** 2));
  if (d === 0) return [a[0], a[1]];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))];
}

let FLIGHTS = null;
function flights() {
  if (FLIGHTS) return FLIGHTS;
  const out = [];
  let n = 0;
  for (const [from, to, slots, airlines, cruiseM] of ROUTES) {
    const a = AIRPORTS[from], b = AIRPORTS[to];
    const nm = distNm(a, b);
    const airborneMin = TAXI_MIN * 2 + (nm / CRUISE_KTS) * 60 + 12; // 상승·강하 여유
    const cycleMin = airborneMin + TURNAROUND_MIN;                 // 편도 1회 + 지상 대기
    for (let s = 0; s < slots; s++) {
      n++;
      const airline = airlines[s % airlines.length];
      const num = 100 + ((n * 37) % 880);
      out.push({
        id: n, from, to, a, b, nm, airline, airborneMin, cycleMin, cruiseM,
        // 왕복: 짝수 슬롯은 정방향 위상, 홀수는 역방향으로 시작
        phase: (s / slots) + (n % 7) * 0.013,
        hex: `71b${(0x100 + n * 0x1f).toString(16).padStart(3, '0')}`.slice(0, 6),
        callsign: `${airline}${num}`,
      });
    }
  }
  FLIGHTS = out;
  return FLIGHTS;
}

function flightState(f, nowMs) {
  // 한 사이클 = 편도(airborne) + 지상. 사이클마다 방향 반전(A→B, B→A …)
  const cycleMs = f.cycleMin * 60e3;
  const abs = nowMs / cycleMs + f.phase;
  const cycleIdx = Math.floor(abs);
  const t = abs - cycleIdx;
  const airborneFrac = f.airborneMin / f.cycleMin;
  if (t >= airborneFrac) return null; // 지상 대기 — 표시 안 함
  const p = t / airborneFrac;          // 0..1 비행 진행률
  const forward = cycleIdx % 2 === 0;
  const from = forward ? f.a : f.b, to = forward ? f.b : f.a;
  const [lat, lon] = interp(from, to, p);
  // 고도 프로필: 0~14% 상승, 86~100% 강하
  let alt, vr;
  if (p < 0.14) { alt = f.cruiseM * (p / 0.14); vr = 9.5; }
  else if (p > 0.86) { alt = f.cruiseM * ((1 - p) / 0.14); vr = -7.5; }
  else { alt = f.cruiseM; vr = 0; }
  const gs = p < 0.06 || p > 0.94 ? 180 + 2000 * Math.min(p, 1 - p) : CRUISE_KTS - (f.cruiseM < 7000 ? 60 : 0);
  return {
    lat, lon, altitudeM: Math.round(alt), groundSpeedKts: Math.round(gs), trackDeg: Math.round(bearing([lat, lon], to)),
    verticalRate: vr, onGround: false, progress: p, from: forward ? f.from : f.to, to: forward ? f.to : f.from,
  };
}

function patrolState(p, nowMs) {
  const θ = ((nowMs / (p.periodMin * 60e3)) + p.phase) * 2 * Math.PI;
  const lat = p.base[0] + p.r * 0.75 * Math.sin(θ);
  const lon = p.base[1] + p.r * Math.cos(θ);
  const dLat = p.r * 0.75 * Math.cos(θ), dLon = -p.r * Math.sin(θ);
  const track = (deg(Math.atan2(dLon * Math.cos(rad(lat)), dLat)) + 360) % 360;
  return { lat, lon, altitudeM: p.alt, groundSpeedKts: p.gs, trackDeg: Math.round(track), verticalRate: 0, onGround: false };
}

function inBbox(lat, lon, b) {
  if (!b) return true;
  return lat >= b.swLat && lat <= b.neLat && lon >= b.swLon && lon <= b.neLon;
}

/** bbox 안 데모 항공기(PositionSample 형식) */
export function demoAircraftPositions(nowMs = Date.now(), bbox = null) {
  const out = [];
  for (const f of flights()) {
    const s = flightState(f, nowMs);
    if (!s || !inBbox(s.lat, s.lon, bbox)) continue;
    out.push({
      icao24: f.hex, callsign: f.callsign,
      lat: Math.round(s.lat * 1e4) / 1e4, lon: Math.round(s.lon * 1e4) / 1e4,
      altitudeM: s.altitudeM, groundSpeedKts: s.groundSpeedKts, trackDeg: s.trackDeg, verticalRate: s.verticalRate,
      onGround: false, source: 'POSITION_SOURCE_SIMULATED', observedAt: nowMs - (f.id * 211) % 4000, squawk: String(1000 + (f.id * 53) % 6000).padStart(4, '0').replace(/[89]/g, '3'),
    });
  }
  for (const p of PATROL) {
    const s = patrolState(p, nowMs);
    if (!inBbox(s.lat, s.lon, bbox)) continue;
    out.push({
      icao24: p.hex, callsign: p.callsign, lat: Math.round(s.lat * 1e4) / 1e4, lon: Math.round(s.lon * 1e4) / 1e4,
      altitudeM: s.altitudeM, groundSpeedKts: s.groundSpeedKts, trackDeg: s.trackDeg, verticalRate: 0,
      onGround: false, source: 'POSITION_SOURCE_SIMULATED', observedAt: nowMs - 1500, squawk: '7000',
    });
  }
  return out;
}

function findDemo(icao) {
  const hex = String(icao || '').toLowerCase();
  const f = flights().find(x => x.hex === hex);
  if (f) return { kind: 'flight', f };
  const p = PATROL.find(x => x.hex === hex);
  if (p) return { kind: 'patrol', p };
  return null;
}
export function isDemoIcao(icao) { return findDemo(icao) !== null; }

/** /api/kcg-aircraft-trace?icao= 형식 — 최근 30분 궤적(30초 간격) */
export function demoAircraftTrace(icao, nowMs = Date.now()) {
  const d = findDemo(icao);
  if (!d) return { found: false, points: [] };
  const points = [];
  for (let back = 30 * 60e3; back >= 0; back -= 30e3) {
    const t = nowMs - back;
    const s = d.kind === 'flight' ? flightState(d.f, t) : patrolState(d.p, t);
    if (!s) { points.length = 0; continue; } // 지상 구간 이전 점은 버림
    points.push({ ts: t, lat: Math.round(s.lat * 1e4) / 1e4, lon: Math.round(s.lon * 1e4) / 1e4, altFt: Math.round(s.altitudeM * 3.28084), gs: s.groundSpeedKts, track: s.trackDeg, vertRate: Math.round(s.verticalRate * 196.85) });
  }
  return { found: points.length > 0, points, demo: true };
}

/** /api/kcg-aircraft-trace?icao=&live=1 형식 */
export function demoAircraftLive(icao, nowMs = Date.now()) {
  const d = findDemo(icao);
  if (!d) return { found: false };
  const s = d.kind === 'flight' ? flightState(d.f, nowMs) : patrolState(d.p, nowMs);
  if (!s) return { found: false };
  const isPatrol = d.kind === 'patrol';
  const altFt = Math.round(s.altitudeM * 3.28084);
  return {
    found: true, demo: true,
    hex: isPatrol ? d.p.hex : d.f.hex,
    callsign: isPatrol ? d.p.callsign : d.f.callsign,
    registration: isPatrol ? d.p.reg : `HL${7700 + (d.f.id * 13) % 299}`,
    aircraftType: isPatrol ? d.p.type : (d.f.nm > 700 ? 'B77W' : d.f.nm > 400 ? 'A21N' : 'B738'),
    category: isPatrol ? d.p.category : 'A3',
    squawk: isPatrol ? '7000' : String(1000 + (d.f.id * 53) % 6000).padStart(4, '0').replace(/[89]/g, '3'),
    emergency: 'none',
    lat: Math.round(s.lat * 1e4) / 1e4, lon: Math.round(s.lon * 1e4) / 1e4,
    altBaroFt: altFt, altGeomFt: altFt + 120, onGround: false,
    gsKt: s.groundSpeedKts, iasKt: Math.round(s.groundSpeedKts * 0.62), mach: Math.round(s.groundSpeedKts / 661 * 100) / 100,
    track: s.trackDeg, trueHeading: s.trackDeg, baroRateFpm: Math.round(s.verticalRate * 196.85), geomRateFpm: Math.round(s.verticalRate * 196.85),
    navAltitudeFt: isPatrol ? altFt : Math.round(d.f.cruiseM * 3.28084 / 100) * 100,
    seenSec: 0.4, seenPosSec: 0.8, rssi: -18.5, messages: 1000 + Math.floor(nowMs / 1000) % 50000,
  };
}

export const _demoFlightsForTest = flights;
