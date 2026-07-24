// KCG 속보 배너 e2e — (1) 한글 헤드라인=즉시 표시·상단 바 밀착(top 41px)
// (2) 영문 헤드라인=즉시 미표시 → 한글화 완료 후에만 표시
import { chromium } from 'playwright-core';

const URL = process.env.KCG_URL || 'https://k-watch.onpod.ai';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(14000); // 앱 하이드레이션 대기 (BreakingNewsBanner 생성 포함)

const dispatch = (id, headline) => page.evaluate(([id, headline]) => {
  document.dispatchEvent(new CustomEvent('wm:breaking-news', {
    detail: { id, headline, source: 'e2e', threatLevel: 'high', timestamp: new Date(), origin: 'rss_alert' },
  }));
}, [id, headline]);

// 1) 한글 헤드라인 → 즉시 표시 + 위치 실측
await dispatch('e2e-ko', '동해 NLL 인근 미상 선박 3척 남하 — 해경 경비함 출동');
await page.waitForTimeout(800);
const ko = await page.evaluate(() => {
  const el = document.querySelector('.breaking-alert[data-alert-id="e2e-ko"]');
  const box = document.querySelector('.breaking-news-container')?.getBoundingClientRect();
  const header = document.querySelector('.header')?.getBoundingClientRect();
  return {
    shown: !!el,
    text: el?.querySelector('.breaking-alert-headline')?.textContent ?? null,
    containerTop: box ? Math.round(box.top) : null,
    headerBottom: header ? Math.round(header.bottom) : null,
  };
});
console.log('KO alert:', JSON.stringify(ko));
console.log(ko.shown && ko.containerTop === ko.headerBottom ? '✔ 한글 즉시 표시 + 헤더 밀착' : '✖ FAIL(ko)');

// 2) 영문 헤드라인 → 즉시에는 미표시, 한글화 후 표시
await dispatch('e2e-en', 'Unidentified vessels crossing the maritime boundary, coast guard responding');
await page.waitForTimeout(500);
const immediateEn = await page.$('.breaking-alert[data-alert-id="e2e-en"]');
console.log(immediateEn ? '✖ FAIL: 영문이 번역 전에 표시됨' : '✔ 영문 즉시 미표시(번역 대기)');

let enText = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  enText = await page.$eval('.breaking-alert[data-alert-id="e2e-en"] .breaking-alert-headline', (el) => el.textContent).catch(() => null);
  if (enText) break;
}
if (enText) {
  const hangul = /[가-힣]/.test(enText);
  console.log('EN→KO headline:', enText.slice(0, 80));
  console.log(hangul ? '✔ 한글화 완료 후 표시' : '✖ FAIL: 표시됐지만 한글 아님');
} else {
  console.log('⚠ 60초 내 번역 결과 미도착 — 배너 미표시(스펙상 허용: 번역 실패 시 생략). LLM 경로 확인 필요');
}

await page.screenshot({ path: '/tmp/kcg-breaking-banner-e2e.png' });
await browser.close();
