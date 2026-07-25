import { test, expect, type Page } from '@playwright/test';

/**
 * KCG fork(07-25 사장님 지시) — 헬기/고정익 구분 회귀 테스트.
 *
 * ADS-B 뷰포트 응답을 고정(헬기 1대 + 여객기 1대)해서
 *   ① 지도 아이콘이 회전익/고정익으로 갈리는지(아이콘 스냅샷)
 *   ② 헬기를 클릭하면 추적 카드 첫 줄이 「헬기 · H60 · …」인지
 *   ③ 공역 항공기 현황 패널이 헬기를 따로 세는지
 * 를 실제 브라우저에서 확인한다. 상류(adsb.lol)를 안 타므로 결과가 항상 같다.
 */

// 지도 중심 = 헬기 위치(고정익은 살짝 북동쪽에 둬 한 화면에 같이 잡힌다).
const CENTER = { lat: 37.3, lon: 127.0 };
const HELI_ICAO = 'ae0e8f';

const AIRCRAFT_FIXTURE = {
  positions: [
    {
      // UH-60(H60) — 기종 코드로 회전익 판정
      icao24: HELI_ICAO, callsign: '95266280',
      lat: CENTER.lat, lon: CENTER.lon,
      altitudeM: 488, groundSpeedKts: 114, trackDeg: 165, verticalRate: 0,
      onGround: false, source: 'POSITION_SOURCE_OPENSKY', observedAt: Date.now(),
      squawk: '0352', aircraftType: 'H60', registration: '95-26628', emitterCategory: 'A7',
    },
    {
      // 여객기 — 고정익 아이콘 유지
      icao24: '71be02', callsign: 'KAL123',
      lat: CENTER.lat + 0.05, lon: CENTER.lon + 0.11,
      altitudeM: 10058, groundSpeedKts: 452, trackDeg: 45, verticalRate: 0,
      onGround: false, source: 'POSITION_SOURCE_OPENSKY', observedAt: Date.now(),
      squawk: '2000', aircraftType: 'B738', registration: 'HL8242', emitterCategory: 'A3',
    },
  ],
  source: 'adsb-lol',
  updatedAt: Date.now(),
};

async function stubAviation(page: Page): Promise<void> {
  await page.route('**/api/aviation/v1/track-aircraft*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AIRCRAFT_FIXTURE) }));
  // 단건 실시간·노선 조회는 오프라인 고정 — 카드는 뷰포트 스냅샷으로 채워진다.
  await page.route('**/api/kcg-aircraft-trace*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: false, points: [] }) }));
  await page.route('**/api/kcg-flight-info*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: false }) }));
}

test.describe('헬기/고정익 구분', () => {
  test('지도 아이콘·추적 카드·현황 패널이 회전익을 따로 표시한다', async ({ page }) => {
    await stubAviation(page);
    await page.goto(`/?lat=${CENTER.lat}&lon=${CENTER.lon}&zoom=9&view=global&layers=flights`);

    const canvas = page.locator('#deckgl-overlay, canvas').first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });

    // 뷰포트 항공기 페치가 한 번 돌 때까지 기다린다(레이어 준비 신호 대신
    // 스텁 응답이 실제로 소비됐는지를 API 호출로 확인).
    await page.waitForResponse((r) => r.url().includes('/api/aviation/v1/track-aircraft'), { timeout: 60_000 });

    // ① 공역 항공기 현황 패널 — 헬기를 따로 센다(고정익 1 + 헬기 1 = 2대).
    const heliStat = page.locator('.kca-stat', { hasText: '헬기' }).first();
    await expect(heliStat).toContainText('1', { timeout: 30_000 });

    // ② 목록 행 — 헬기는 🚁 표식 + 기종 코드
    const heliRow = page.locator(`tr[data-icao="${HELI_ICAO}"]`);
    await expect(heliRow).toContainText('🚁');
    await expect(heliRow).toContainText('H60');
    const planeRow = page.locator('tr[data-icao="71be02"]');
    await expect(planeRow).toContainText('B738');
    await expect(planeRow).not.toContainText('🚁');

    // ③ 편명 클릭 → 지도 포커스 + 추적 카드 첫 줄에 「헬기 · H60 · 등록번호」
    await heliRow.locator('.kca-td-focus').click();
    const card = page.locator('.kcg-aircraft-tracker-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('헬기');
    await expect(card).toContainText('H60');
    await expect(card).toContainText('95-26628');

    // ④ 범례 — 고정익/회전익 두 항목이 함께 노출(로케일 무관하게 확인)
    const legend = page.locator('.deckgl-legend');
    await expect(legend).toContainText(/헬기|Helicopter/);

    // ⑤ 아이콘 — 추적을 끝내 하이라이트(빨강)를 없앤 뒤, 고도색으로 그려진
    // 회전익/고정익 실루엣을 스냅샷으로 남긴다(사람이 눈으로 보는 산출물).
    await heliRow.locator('.kca-td-focus').click(); // 같은 기체 재클릭 = 추적 종료
    await expect(card).toBeHidden();
    await page.waitForTimeout(3_000);
    await canvas.screenshot({ path: 'test-results/kcg-helicopter-icons.png' });
  });
});
