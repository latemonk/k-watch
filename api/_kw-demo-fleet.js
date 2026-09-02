// api/_kw-demo-fleet.js
// K-Watch 데모 함대 — 로그인하지 않은(또는 이용권이 끝난) 화면에 보여 주는
// 시연용 가상 선박. 릴레이의 DEMO_MODE 합성 함대(scripts/ais-relay.cjs)와 달리
// 프로세스 상태가 없다: 모든 위치가 「현재 시각」의 순수 함수라서 어느
// 프로세스·어느 요청에서 계산해도 같은 배가 같은 자리에 있고, 라이브 릴레이와
// 나란히 돌아도 서로 섞이지 않는다.
//
// 모델
//  - 정박·조업형(loiter): 앵커 주변 타원 궤도(주기 2~8시간) — 어선·순시선
//  - 항로형(transit): 두 웨이포인트 사이를 왕복 — 화물·유조·여객
//  - 연출 1건: 서해 NLL 남쪽에서 중국 어선 2척이 6시간 주기로 접근·체류
// 응답 형식은 relay 의 SnapshotCandidateReport 와 같다(mmsi/name/lat/lon/
// shipType/heading/speed/course/timestamp).

const KOREA_BBOX = { swLat: 31, swLon: 122, neLat: 40.5, neLon: 134 };

// mulberry32 — 시드 고정 PRNG(함대 정의를 매 호출 똑같이 재생성)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES = [
  { id: 'incheon',  name: '인천·경기만',   lat: 37.25, lon: 125.9, loiter: 26 },
  { id: 'west',     name: '서해 중부',     lat: 35.6,  lon: 125.6, loiter: 22 },
  { id: 'jeju',     name: '제주 해역',     lat: 33.4,  lon: 126.0, loiter: 20 },
  { id: 'busan',    name: '부산·대한해협', lat: 34.9,  lon: 129.0, loiter: 28 },
  { id: 'ulsan',    name: '동해 남부',     lat: 36.2,  lon: 130.0, loiter: 18 },
  { id: 'dokdo',    name: '동해·독도',     lat: 37.5,  lon: 131.0, loiter: 12 },
];

// 웨이포인트 — 항만 앞바다·해협(육지를 가로지르지 않게 연안을 따라 이어 붙인다)
const WP = {
  incheonS: [37.15, 126.15], taeanW: [36.7, 125.9], gunsanW: [35.9, 126.15], mokpoW: [34.75, 125.85],
  jindo: [34.25, 125.95], wando: [34.05, 126.85], yeosuS: [34.4, 127.75], geoje: [34.5, 128.65],
  busanS: [34.85, 129.2], ulsanE: [35.5, 129.65], pohangE: [36.0, 129.75], donghaeE: [37.5, 129.55],
  sokchoE: [38.15, 128.95], jejuN: [33.75, 126.5], jejuS: [33.05, 126.55], ulleung: [37.45, 130.7],
  dokdo: [37.2, 131.75], tsushimaW: [34.45, 128.85], kyushuN: [33.95, 129.95],
  shanghaiE: [31.3, 122.9], qingdaoE: [36.1, 121.7], dalianS: [38.55, 122.0], vladi: [42.3, 132.0],
};
const LANES = [
  ['busanS', 'geoje', 'yeosuS', 'wando', 'jindo', 'mokpoW', 'gunsanW', 'taeanW', 'incheonS'], // 남·서해 연안
  ['busanS', 'ulsanE', 'pohangE', 'donghaeE', 'sokchoE'],                                    // 동해 연안
  ['incheonS', 'taeanW', 'gunsanW', 'mokpoW', 'jindo', 'jejuN'],
  ['busanS', 'tsushimaW', 'kyushuN'],                                                         // 한일 항로
  ['incheonS', 'qingdaoE'], ['incheonS', 'dalianS'], ['busanS', 'geoje', 'jejuS', 'shanghaiE'],
  ['donghaeE', 'vladi'], ['pohangE', 'ulleung', 'dokdo'], ['mokpoW', 'jindo', 'jejuN'],
  ['yeosuS', 'wando', 'jejuN'], ['jejuN', 'geoje', 'busanS'],
];

// 거친 육지 마스크 — 시연 화면에서 배가 내륙에 찍히는 것만 막는 용도(정밀 해안선 아님)
const LAND_POLYGONS = [
  // 한반도 본토(남·북)
  [[39.5, 124.4], [39.9, 126.5], [40.5, 129.3], [38.6, 128.4], [38.0, 128.7], [37.5, 129.25], [36.5, 129.5],
   [36.0, 129.55], [35.5, 129.45], [35.1, 129.15], [34.95, 128.7], [34.8, 128.1], [34.75, 127.75], [34.6, 127.3],
   [34.4, 126.9], [34.35, 126.4], [34.65, 126.25], [35.0, 126.35], [35.6, 126.5], [36.0, 126.65], [36.6, 126.35],
   [36.95, 126.45], [37.35, 126.65], [37.75, 126.5], [38.0, 125.7], [38.5, 125.2]],
  // 제주
  [[33.2, 126.15], [33.55, 126.15], [33.6, 126.95], [33.25, 126.95]],
  // 규슈 북서·쓰시마
  [[33.2, 129.6], [33.95, 130.55], [33.55, 131.05], [32.7, 130.35], [32.7, 129.7]],
  [[34.05, 129.15], [34.7, 129.35], [34.72, 129.55], [34.1, 129.35]],
  // 중국 연안(산둥·랴오둥 포함)
  [[30.0, 118.0], [41.5, 118.0], [41.5, 122.3], [39.0, 121.9], [38.6, 121.2], [37.5, 122.7], [35.6, 122.6], [34.5, 120.5], [31.9, 122.4], [30.0, 122.3]],
];
function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
export function isDemoLand(lat, lon) {
  return LAND_POLYGONS.some(poly => pointInPolygon(lat, lon, poly));
}

const NAMES = {
  KR_FISH: ['만선호', '대박호', '해동호', '칠성호', '금빛호', '삼호호', '율림호', '동성호', '태양호', '해진호'],
  KR_CARGO: ['HYUNDAI BUSAN', 'HMM DAON', 'KOREA STAR', 'HANIL GLORY', 'SINOKOR INCHEON', 'PAN KOREA', 'KMTC ULSAN', 'HEUNG-A JANICE'],
  KR_TANKER: ['SK ENERGY 7', 'GS CALTEX PIONEER', 'HANWHA SPIRIT', 'S-OIL VENTURE'],
  KR_PAX: ['SEAWORLD EXPRESS', 'QUEEN JENUVIA', 'SANTA MONICA', 'ORIENT STAR', 'NEW STAR'],
  KR_PATROL: ['해경 3007', '해경 1508', '해경 512', '해경 3012'],
  CN_FISH: ['LU RONG YU 4573', 'ZHE LING YU 23088', 'MIN SHI YU 07551', 'LIAO DAN YU 11223', 'LU WEI YU 6108'],
  CN_CARGO: ['ZHONG GU BO HAI', 'XIN QING DAO', 'COSCO TIANJIN', 'HAI FENG 21'],
  JP_CARGO: ['KAIYO MARU NO.3', 'SHINANO MARU', 'HAKATA EXPRESS', 'SEIYO MARU'],
  RU_CARGO: ['VLADIVOSTOK TRADER', 'PRIMORYE', 'AMUR STAR'],
  FOC_CARGO: ['PACIFIC HARMONY', 'OCEAN CREST', 'GOLDEN WAVE', 'SILVER GATE', 'BLUE HORIZON', 'MAERSK SEBAROK', 'EVER GIFTED'],
};

const DEMO_MMSI_TAG = '9';    // 데모 MMSI 는 MID 뒤 첫 자리를 9 로 고정(실선박과 충돌 방지·판정용)

function pick(arr, i) { return arr[i % arr.length]; }

function chooseClass(r, seq) {
  if (r < 0.30) return { mid: '440', names: NAMES.KR_FISH, shipType: 30, kind: 'loiter', spd: [2, 7] };
  if (r < 0.43) return { mid: '441', names: NAMES.KR_CARGO, shipType: 70 + (seq % 5), kind: 'transit', spd: [10, 16] };
  if (r < 0.49) return { mid: '440', names: NAMES.KR_TANKER, shipType: 80 + (seq % 3), kind: 'transit', spd: [9, 13] };
  if (r < 0.54) return { mid: '440', names: NAMES.KR_PAX, shipType: 60 + (seq % 3), kind: 'transit', spd: [16, 24] };
  if (r < 0.57) return { mid: '440', names: NAMES.KR_PATROL, shipType: 55, kind: 'loiter', spd: [8, 14] };
  if (r < 0.68) return { mid: '412', names: NAMES.CN_FISH, shipType: 30, kind: 'loiter', spd: [2, 6] };
  if (r < 0.75) return { mid: '413', names: NAMES.CN_CARGO, shipType: 70 + (seq % 4), kind: 'transit', spd: [10, 15] };
  if (r < 0.82) return { mid: '431', names: NAMES.JP_CARGO, shipType: 70 + (seq % 3), kind: 'transit', spd: [10, 15] };
  if (r < 0.86) return { mid: '273', names: NAMES.RU_CARGO, shipType: 70, kind: 'transit', spd: [9, 13] };
  const mid = ['352', '636', '538', '477'][seq % 4];
  return { mid, names: NAMES.FOC_CARGO, shipType: (seq % 2 === 0) ? 70 + (seq % 6) : 80 + (seq % 4), kind: 'transit', spd: [10, 16] };
}

let FLEET = null;
function fleet() {
  if (FLEET) return FLEET;
  const out = [];
  let seq = 0;
  const rand = rng(20260902);
  for (const z of ZONES) {
    // 구역 정원: loiter 수 + 그 60% 만큼 transit 을 이 구역 근처 항로에 배정
    const total = Math.round(z.loiter * 1.6);
    for (let i = 0; i < total; i++) {
      seq++;
      const cls = chooseClass((seq * 0.61803) % 1, seq);
      const spd = cls.spd[0] + rand() * (cls.spd[1] - cls.spd[0]);
      const base = {
        mmsi: `${cls.mid}${DEMO_MMSI_TAG}${String(10000 + ((seq * 7919) % 90000))}`,
        name: pick(cls.names, seq),
        shipType: cls.shipType,
        speed: Math.round(spd * 10) / 10,
      };
      if (cls.kind === 'loiter' || i < z.loiter * 0.35) {
        // 앵커·타원 극점이 전부 바다일 때까지 재추출(시드 고정이라 결과도 고정)
        let cLat, cLon, rLat, rLon;
        for (let tries = 0; tries < 40; tries++) {
          cLat = z.lat + (rand() - 0.5) * 2.2; cLon = z.lon + (rand() - 0.5) * 2.4;
          rLat = 0.08 + rand() * 0.45; rLon = 0.1 + rand() * 0.55;
          const shrink = 1 - Math.min(0.8, tries * 0.05);
          rLat *= shrink; rLon *= shrink;
          const ok = !isDemoLand(cLat, cLon) && !isDemoLand(cLat + rLat, cLon) && !isDemoLand(cLat - rLat, cLon)
            && !isDemoLand(cLat, cLon + rLon) && !isDemoLand(cLat, cLon - rLon);
          if (ok) break;
          if (tries === 39) { cLat = z.lat; cLon = z.lon; rLat = 0.05; rLon = 0.05; }
        }
        out.push({
          ...base, kind: 'loiter', cLat, cLon, rLat, rLon,
          periodMs: (2 + rand() * 6) * 3600e3, phase: rand(), dir: rand() < 0.5 ? 1 : -1,
        });
      } else {
        const lane = LANES[(seq + Math.floor(rand() * LANES.length)) % LANES.length];
        out.push({
          ...base, kind: 'transit', lane,
          offLat: (rand() - 0.5) * 0.16, offLon: (rand() - 0.5) * 0.16,
          phase: rand(), dir: rand() < 0.5 ? 1 : -1,
        });
      }
    }
  }
  // 연출: 중국 어선 2척, 6시간 주기로 서해 NLL 남쪽(37.6N,124.9E) 접근 후 2시간 체류
  for (let k = 0; k < 2; k++) {
    out.push({
      mmsi: `412${DEMO_MMSI_TAG}7710${k}`, name: pick(NAMES.CN_FISH, 3 + k), shipType: 30, speed: 4.5,
      kind: 'nll', k,
    });
  }
  FLEET = out;
  return FLEET;
}

const NM_PER_DEG_LAT = 60;
function distNm(a, b) {
  const dLat = (b[0] - a[0]) * NM_PER_DEG_LAT;
  const dLon = (b[1] - a[1]) * NM_PER_DEG_LAT * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}
function bearing(a, b) {
  const φ1 = a[0] * Math.PI / 180, φ2 = b[0] * Math.PI / 180, Δλ = (b[1] - a[1]) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function positionAt(v, nowMs) {
  if (v.kind === 'loiter') {
    const θ = ((nowMs / v.periodMs) + v.phase) * 2 * Math.PI * v.dir;
    const lat = v.cLat + v.rLat * Math.sin(θ);
    const lon = v.cLon + v.rLon * Math.cos(θ);
    // 접선 방향 = 미분
    const dLat = v.rLat * Math.cos(θ) * v.dir;
    const dLon = -v.rLon * Math.sin(θ) * v.dir;
    const course = (Math.atan2(dLon * Math.cos(lat * Math.PI / 180), dLat) * 180 / Math.PI + 360) % 360;
    return { lat, lon, course, speed: v.speed };
  }
  if (v.kind === 'nll') {
    // 6시간 주기: 0~2h 북상 접근(35.9→37.55N), 2~4h 체류(느린 표류), 4~6h 남하 복귀
    const cycle = 6 * 3600e3;
    const t = ((nowMs + v.k * 900e3) % cycle) / cycle;
    const lon = 124.75 + v.k * 0.12;
    if (t < 1 / 3) { const p = t * 3; return { lat: 36.6 + p * 0.95, lon, course: 0, speed: 8.5 }; }
    if (t < 2 / 3) { const p = (t - 1 / 3) * 3; return { lat: 37.55 + Math.sin(p * 2 * Math.PI) * 0.04, lon: lon + Math.cos(p * 2 * Math.PI) * 0.05, course: (p * 360) % 360, speed: 1.8 }; }
    const p = (t - 2 / 3) * 3; return { lat: 37.55 - p * 0.95, lon, course: 180, speed: 8.5 };
  }
  // transit: 레그 길이 합 → 총 항해시간 → 왕복 위상
  const pts = v.lane.map(k => WP[k]);
  const legs = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const d = distNm(pts[i], pts[i + 1]); legs.push(d); total += d; }
  const oneWayMs = (total / v.speed) * 3600e3;
  const cycleMs = oneWayMs * 2;
  let t = ((nowMs / cycleMs) + v.phase) % 1;
  let forward = true;
  if (t >= 0.5) { t = (t - 0.5) * 2; forward = false; } else { t *= 2; }
  if (v.dir < 0) forward = !forward;
  const seq = forward ? pts : [...pts].reverse();
  const seqLegs = forward ? legs : [...legs].reverse();
  let travelled = t * total;
  for (let i = 0; i < seqLegs.length; i++) {
    if (travelled <= seqLegs[i] || i === seqLegs.length - 1) {
      const f = Math.max(0, Math.min(1, travelled / seqLegs[i]));
      const a = seq[i], b = seq[i + 1];
      return {
        lat: a[0] + (b[0] - a[0]) * f + v.offLat,
        lon: a[1] + (b[1] - a[1]) * f + v.offLon,
        course: bearing(a, b), speed: v.speed,
      };
    }
    travelled -= seqLegs[i];
  }
  const last = seq[seq.length - 1];
  return { lat: last[0] + v.offLat, lon: last[1] + v.offLon, course: 0, speed: 0 };
}

function inBbox(lat, lon, b) {
  return lat >= b.swLat && lat <= b.neLat && lon >= b.swLon && lon <= b.neLon;
}

/** bbox 안의 데모 선박 위치 보고(relay SnapshotCandidateReport 형식) */
export function demoVesselReports(nowMs = Date.now(), bbox = null) {
  const b = bbox || KOREA_BBOX;
  const out = [];
  for (const v of fleet()) {
    const p = positionAt(v, nowMs);
    if (!inBbox(p.lat, p.lon, b)) continue;
    // 항로가 해안을 스치는 순간은 「입항 중」으로 보고 화면에서 뺀다
    if (isDemoLand(p.lat, p.lon)) continue;
    const course = Math.round(p.course) % 360;
    out.push({
      mmsi: v.mmsi, name: v.name,
      lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5,
      shipType: v.shipType, heading: course, speed: Math.round(p.speed * 10) / 10, course,
      // 보고 시각: 0~40초 전 사이(전 함대가 같은 초에 찍히는 인위성 제거)
      timestamp: nowMs - ((parseInt(v.mmsi.slice(-3), 10) * 137) % 40000),
    });
  }
  return out;
}

/** 데모 스냅샷(VesselSnapshot 형식) — includeTankers 면 전 선종을 tankerReports 에(포크 관행) */
export function demoVesselSnapshot(nowMs = Date.now(), { bbox = null, includeCandidates = false, includeTankers = false } = {}) {
  const reports = demoVesselReports(nowMs, bbox);
  const all = demoVesselReports(nowMs, null);
  const densityZones = ZONES.map(z => {
    const n = all.filter(r => Math.abs(r.lat - z.lat) < 1.3 && Math.abs(r.lon - z.lon) < 1.4).length;
    return {
      id: `demo-${z.id}`, name: z.name,
      location: { latitude: z.lat, longitude: z.lon },
      intensity: Math.min(1, n / 40), deltaPct: 0, shipsPerDay: n * 6, note: '시연용 가상 데이터',
    };
  });
  return {
    snapshotAt: nowMs,
    densityZones,
    disruptions: [],
    sequence: Math.floor(nowMs / 10000) % 2147483647,
    status: { connected: true, vessels: all.length, messages: all.length * 12 },
    candidateReports: includeCandidates ? reports.filter(r => r.shipType === 55 || r.shipType === 35) : [],
    tankerReports: includeTankers ? reports : [],
  };
}

export function isDemoMmsi(mmsi) {
  const s = String(mmsi || '');
  return s.length === 9 && s[3] === DEMO_MMSI_TAG && fleet().some(v => v.mmsi === s);
}

export const KW_DEMO_KOREA_BBOX = KOREA_BBOX;
export const _demoFleetForTest = fleet;
