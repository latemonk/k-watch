// api/kcg-aircraft-trace.js
// KCG fork(07-23 사장님 지시): adsb.lol 동등한 항공기 실시간 추적 프록시.
//   ?icao=71be02          → tar1090 trace_recent(최근 궤적, 고도·속도 포함)
//   ?icao=71be02&live=1   → api.adsb.lol /v2/icao 단건 실시간 상세(등록번호·
//                            기종·스쿼크·수직속도·IAS 등)
// 브라우저가 adsb.lol 을 직접 못 부르는 이유: /data/traces 는 CORS 헤더가
// 없다. 캐시는 트래픽 예의용 최소치(trace 10s / live 2s).
var config = { runtime: "edge" };

var cache = /* @__PURE__ */ new Map();
var TRACE_TTL_MS = 10e3;
var LIVE_TTL_MS = 2e3;
var CACHE_MAX = 500;

function json(status, body, maxAge) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": maxAge ? "public, max-age=" + maxAge : "no-store"
    }
  });
}

function cacheGet(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  return null;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, at: Date.now() });
}

// tar1090 trace 행: [초오프셋, lat, lon, alt_baro|"ground", gs, track, flags,
// vert_rate, ...] — 프론트가 쓰는 필드만 추려 절대시각으로 변환.
function parseTrace(raw) {
  const base = Number(raw && raw.timestamp || 0) * 1e3;
  const rows = Array.isArray(raw && raw.trace) ? raw.trace : [];
  const points = [];
  for (const r of rows) {
    if (!Array.isArray(r) || typeof r[1] !== "number" || typeof r[2] !== "number") continue;
    points.push({
      ts: base + Number(r[0] || 0) * 1e3,
      lat: r[1],
      lon: r[2],
      altFt: typeof r[3] === "number" ? r[3] : 0,
      onGround: r[3] === "ground",
      gs: typeof r[4] === "number" ? r[4] : 0,
      track: typeof r[5] === "number" ? r[5] : 0,
      vertRate: typeof r[7] === "number" ? r[7] : 0
    });
  }
  return points;
}

async function fetchTrace(icao) {
  const suffix = icao.slice(-2);
  const resp = await fetch(`https://adsb.lol/data/traces/${suffix}/trace_recent_${icao}.json`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) k-monitor" },
    signal: AbortSignal.timeout(8e3)
  });
  if (resp.status === 404) return { found: false, points: [] };
  if (!resp.ok) throw new Error("trace HTTP " + resp.status);
  // tar1090 trace 는 gzip 사전압축 파일 — 팟의 IPv4 패치 fetch 가
  // Content-Encoding 자동 해제를 못 하는 경우가 있어(07-23 실측: 본문이
  // gzip 매직바이트 그대로) 수동으로 해제한다.
  const buf = new Uint8Array(await resp.arrayBuffer());
  let text;
  if (buf.length > 2 && buf[0] === 31 && buf[1] === 139) {
    const ds = new DecompressionStream("gzip");
    const stream = new Response(new Blob([buf]).stream().pipeThrough(ds));
    text = await stream.text();
  } else {
    text = new TextDecoder().decode(buf);
  }
  const raw = JSON.parse(text);
  return { found: true, points: parseTrace(raw) };
}

async function fetchLive(icao) {
  const resp = await fetch(`https://api.adsb.lol/v2/icao/${icao}`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) k-monitor" },
    signal: AbortSignal.timeout(8e3)
  });
  if (!resp.ok) throw new Error("live HTTP " + resp.status);
  const data = await resp.json();
  const ac = Array.isArray(data && data.ac) ? data.ac[0] : null;
  if (!ac || typeof ac.lat !== "number") return { found: false };
  const altBaro = typeof ac.alt_baro === "number" ? ac.alt_baro : null;
  return {
    found: true,
    hex: String(ac.hex || icao),
    callsign: String(ac.flight || "").trim(),
    registration: String(ac.r || ""),
    aircraftType: String(ac.t || ""),
    category: String(ac.category || ""),
    squawk: String(ac.squawk || ""),
    emergency: String(ac.emergency || ""),
    lat: ac.lat,
    lon: ac.lon,
    altBaroFt: altBaro,
    altGeomFt: typeof ac.alt_geom === "number" ? ac.alt_geom : null,
    onGround: ac.alt_baro === "ground",
    gsKt: typeof ac.gs === "number" ? ac.gs : null,
    iasKt: typeof ac.ias === "number" ? ac.ias : null,
    mach: typeof ac.mach === "number" ? ac.mach : null,
    track: typeof ac.track === "number" ? ac.track : null,
    trueHeading: typeof ac.true_heading === "number" ? ac.true_heading : null,
    baroRateFpm: typeof ac.baro_rate === "number" ? ac.baro_rate : null,
    geomRateFpm: typeof ac.geom_rate === "number" ? ac.geom_rate : null,
    navAltitudeFt: typeof ac.nav_altitude_mcp === "number" ? ac.nav_altitude_mcp : null,
    seenSec: typeof ac.seen === "number" ? ac.seen : null,
    seenPosSec: typeof ac.seen_pos === "number" ? ac.seen_pos : null,
    rssi: typeof ac.rssi === "number" ? ac.rssi : null,
    messages: typeof ac.messages === "number" ? ac.messages : null
  };
}

async function handler(req) {
  const url = new URL(req.url);
  const icao = String(url.searchParams.get("icao") || "").trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(icao)) return json(400, { error: "icao(hex 6자리) 파라미터가 필요해요" });
  const live = url.searchParams.get("live") === "1";
  const key = (live ? "live:" : "trace:") + icao;
  const ttl = live ? LIVE_TTL_MS : TRACE_TTL_MS;
  const hit = cacheGet(key, ttl);
  if (hit) return json(200, hit);
  try {
    const data = live ? await fetchLive(icao) : await fetchTrace(icao);
    cacheSet(key, data);
    return json(200, data);
  } catch {
    return json(502, { error: live ? "실시간 조회에 실패했어요" : "궤적 조회에 실패했어요" });
  }
}
export {
  config,
  handler as default
};
