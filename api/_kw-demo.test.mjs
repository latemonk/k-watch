import { strict as assert } from 'node:assert';
import test from 'node:test';

const fleet = await import('./_kw-demo-fleet.js');
const air = await import('./_kw-demo-aircraft.js');
const KB = { swLat: 33, swLon: 124, neLat: 39.2, neLon: 131.5 };

test('demo fleet: deterministic, plenty of vessels, none on land, valid report shape', () => {
  const t = 1_800_000_000_000;
  const a = fleet.demoVesselReports(t, KB);
  const b = fleet.demoVesselReports(t, KB);
  assert.deepEqual(a, b);
  assert.ok(a.length > 120, `expected >120 vessels in Korea bbox, got ${a.length}`);
  for (const r of a) {
    assert.match(r.mmsi, /^\d{9}$/);
    assert.ok(r.lat >= KB.swLat && r.lat <= KB.neLat && r.lon >= KB.swLon && r.lon <= KB.neLon);
    assert.ok(!fleet.isDemoLand(r.lat, r.lon), `${r.name} on land at ${r.lat},${r.lon}`);
    assert.ok(r.speed >= 0 && r.speed < 30);
    assert.ok(r.course >= 0 && r.course < 360);
    assert.ok(r.timestamp <= t && r.timestamp > t - 60_000);
  }
  assert.equal(new Set(a.map(r => r.mmsi)).size, a.length, 'mmsi unique');
});

test('demo fleet: vessels actually move over time', () => {
  const t = 1_800_000_000_000;
  const a = new Map(fleet.demoVesselReports(t, KB).map(r => [r.mmsi, r]));
  const b = fleet.demoVesselReports(t + 10 * 60_000, KB);
  let moved = 0;
  for (const r of b) { const p = a.get(r.mmsi); if (p && (Math.abs(p.lat - r.lat) > 1e-4 || Math.abs(p.lon - r.lon) > 1e-4)) moved++; }
  assert.ok(moved > b.length * 0.8, `only ${moved}/${b.length} moved`);
});

test('demo fleet: snapshot shape matches VesselSnapshot + tile bbox filtering', () => {
  const s = fleet.demoVesselSnapshot(Date.now(), { bbox: { swLat: 33.3, swLon: 123.7, neLat: 37.3, neLon: 127.7 }, includeTankers: true });
  assert.ok(s.status.connected && s.status.vessels > 100);
  assert.ok(Array.isArray(s.densityZones) && s.densityZones.length === 6);
  assert.ok(s.tankerReports.length > 20 && s.tankerReports.length < s.status.vessels);
  assert.equal(fleet.demoVesselSnapshot(Date.now(), { includeTankers: false }).tankerReports.length, 0);
  assert.ok(fleet.isDemoMmsi(s.tankerReports[0].mmsi));
  assert.equal(fleet.isDemoMmsi('440123456'), false);
});

test('land mask sanity', () => {
  assert.equal(fleet.isDemoLand(37.55, 126.98), true);   // 서울
  assert.equal(fleet.isDemoLand(35.15, 129.05), true);   // 부산 시내
  assert.equal(fleet.isDemoLand(33.5, 126.53), true);    // 제주시
  assert.equal(fleet.isDemoLand(36.5, 125.5), false);    // 서해
  assert.equal(fleet.isDemoLand(35.1, 129.5), false);    // 부산 동쪽 해상
  assert.equal(fleet.isDemoLand(37.2, 131.8), false);    // 독도 해상
});

test('demo aircraft: deterministic, in bbox, SIMULATED source, unique hex, moving', () => {
  const t = 1_800_000_000_000;
  const a = air.demoAircraftPositions(t, KB);
  assert.deepEqual(a, air.demoAircraftPositions(t, KB));
  assert.ok(a.length >= 15, `expected >=15 aircraft, got ${a.length}`);
  for (const p of a) {
    assert.match(p.icao24, /^[0-9a-f]{6}$/);
    assert.equal(p.source, 'POSITION_SOURCE_SIMULATED');
    assert.ok(p.lat >= KB.swLat && p.lat <= KB.neLat && p.lon >= KB.swLon && p.lon <= KB.neLon);
    assert.ok(p.altitudeM > 0 && p.altitudeM <= 12500);
    assert.ok(p.groundSpeedKts > 50 && p.groundSpeedKts < 600);
    assert.match(p.squawk, /^[0-7]{4}$/);
  }
  assert.equal(new Set(a.map(p => p.icao24)).size, a.length);
  const later = new Map(air.demoAircraftPositions(t + 120_000, KB).map(p => [p.icao24, p]));
  let moved = 0;
  for (const p of a) { const q = later.get(p.icao24); if (q && Math.hypot(q.lat - p.lat, q.lon - p.lon) > 0.01) moved++; }
  assert.ok(moved > a.length * 0.7);
});

test('demo aircraft: patrol helicopters present with rotorcraft type; trace + live follow the same model', () => {
  const t = Date.now();
  const a = air.demoAircraftPositions(t, KB);
  const heli = a.find(p => p.callsign === 'KCG501');
  assert.ok(heli, 'KCG501 helicopter should be in Korea bbox');
  const live = air.demoAircraftLive(heli.icao24, t);
  assert.equal(live.found, true);
  assert.equal(live.aircraftType, 'KUH1');
  assert.equal(live.category, 'A7');
  assert.ok(Math.abs(live.lat - heli.lat) < 1e-3);
  const trace = air.demoAircraftTrace(heli.icao24, t);
  assert.ok(trace.found && trace.points.length >= 50);
  assert.ok(trace.points.every(p => typeof p.altFt === 'number' && typeof p.lat === 'number'));
  assert.equal(air.demoAircraftLive('abcdef').found, false);
  assert.equal(air.isDemoIcao(heli.icao24), true);
  assert.equal(air.isDemoIcao('000000'), false);
});
