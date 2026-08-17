#!/usr/bin/env node
// API wedge watchdog — 08-17 실사고 재발 방지.
//
// 무엇을 막나: local-api-server 프로세스가 내부 상태 오염으로 「살아는
// 있는데(소켓 accept·인증 전 경로 즉답) 실제 핸들러 실행만 영영 안 끝나는」
// 웨지에 빠진 사고가 있었다. 컨테이너 HEALTHCHECK 는 /api/sidecar-health
// (인증 전 경로)만 봐서 15일 묵은 웨지를 끝까지 초록으로 보고했다.
//
// 왜 프로세스 단위 재시작인가: 컨테이너 재시작은 내장 redis(/tmp, --save '')
// 의 시드 데이터를 전부 날린다. 웨지는 local-api-server 한 프로세스의
// 문제이므로 그 프로세스만 죽이고 supervisord autorestart 에 맡기는 것이
// 올바른 granularity 다.
//
// 판정: 실제 핸들러 디스패치 경로(/api/health?compact=1 — 인증 게이트 →
// 동적 import → 핸들러 → redis 일괄 읽기)를 주기 프로브. **HTTP 상태와
// 무관하게 응답이 오면 건강**(503 REDIS_DOWN 도 즉답이면 프로세스는 멀쩡).
// 타임아웃(무응답)만 웨지 증거로 센다. 연결 거부는 재시작 중일 수 있어
// 로그만 남기고 킬 카운터에 넣지 않는다 — 갓 부팅한 프로세스를 오살하지
// 않기 위해서다.
//
// 오탐 비용: redis REST 프록시가 죽어 compact health 가 60초대까지 늘어지는
// 경우에도 발화할 수 있다. 그 경우 local-api-server 재시작은 무익하지만
// 무해하고(프록시는 자기 supervisord 항목이 되살림), 로그가 크게 남아
// 사람이 볼 수 있다. 놓친 웨지 15일 > 무해한 재시작 몇 번.

const PORT = Number.parseInt(process.env.LOCAL_API_PORT ?? '', 10) || 46123;
const TOKEN = process.env.LOCAL_API_TOKEN || '';
const INTERVAL_MS = positiveInt(process.env.API_WATCHDOG_INTERVAL_MS, 60_000);
const PROBE_TIMEOUT_MS = positiveInt(process.env.API_WATCHDOG_PROBE_TIMEOUT_MS, 20_000);
const CONSECUTIVE_FAILS = positiveInt(process.env.API_WATCHDOG_CONSECUTIVE_FAILS, 3);
// 킬 직후 재시작·워밍업 시간을 주는 유예 사이클 수.
const COOLDOWN_CYCLES = positiveInt(process.env.API_WATCHDOG_COOLDOWN_CYCLES, 3);
// supervisord 프로그램 command 와 일치해야 한다(supervisord-onpod.conf).
const KILL_PATTERN = process.env.API_WATCHDOG_KILL_PATTERN || 'node /app/local-api-server.mjs';
const PROBE_URL = `http://127.0.0.1:${PORT}/api/health?compact=1`;

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt(raw ?? '', 10);
  return parsed > 0 ? parsed : fallback;
}

function log(msg) { console.log(`[ApiWatchdog] ${msg}`); }
function warn(msg) { console.warn(`[ApiWatchdog] ${msg}`); }

if ((process.env.API_WATCHDOG_DISABLED || '').toLowerCase() === 'true') {
  // supervisord autorestart 가 종료를 재기동으로 되돌리므로, 끈 상태에서는
  // 조용히 상주만 한다.
  log('disabled via API_WATCHDOG_DISABLED — idling');
  setInterval(() => {}, 2 ** 31 - 1);
} else {
  main();
}

function main() {
  log(`watching ${PROBE_URL} every ${INTERVAL_MS}ms (timeout ${PROBE_TIMEOUT_MS}ms, kill after ${CONSECUTIVE_FAILS} consecutive timeouts)`);
  let consecutiveTimeouts = 0;
  let cooldownRemaining = 0;
  // 부팅 직후는 api 서버가 아직 뜨는 중일 수 있어 첫 프로브를 한 사이클
  // 늦춘다. 같은 시점에 KILL_PATTERN 이 실프로세스와 맞는지 자가진단 —
  // 패턴 드리프트는 「웨지 때 pkill 이 아무것도 못 맞추는」 무음 고장이라
  // 부팅 로그에서 미리 크게 알린다.
  setTimeout(() => {
    void selfCheckKillPattern();
    void probeOnce();
    setInterval(() => { void probeOnce(); }, INTERVAL_MS);
  }, INTERVAL_MS);

  async function probeOnce() {
    if (cooldownRemaining > 0) {
      cooldownRemaining -= 1;
      return;
    }
    const startedAt = Date.now();
    try {
      const resp = await fetch(PROBE_URL, {
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      // body 를 끝까지 읽어야 (1) keep-alive 소켓이 안 오염되고 (2) 「헤더만
      // 뱉고 body 에서 멈추는」 웨지도 잡힌다. body 읽기 실패는 삼키지 말고
      // 아래 catch 로 흘려 타임아웃이면 스트라이크로 센다.
      await resp.arrayBuffer();
      if (resp.status === 401 || resp.status === 403) {
        // 인증 게이트에서 튕기면 핸들러 경로를 전혀 밟지 못한 것 — 프로브가
        // 장님이 된 상태다(토큰 회전·per-program env 이동 등). 건강 판정은
        // 유지하되 매 사이클 크게 남긴다.
        warn(`probe answered HTTP ${resp.status} at the auth gate — probe is NOT exercising the handler path (token drift?); wedge detection is blind until fixed`);
      }
      if (consecutiveTimeouts > 0) {
        log(`recovered: HTTP ${resp.status} in ${Date.now() - startedAt}ms after ${consecutiveTimeouts} timeout(s)`);
      }
      consecutiveTimeouts = 0;
    } catch (error) {
      const name = error?.name || '';
      const causeCode = error?.cause?.code || '';
      // undici 는 연결·헤더·body 단계 타임아웃을 TypeError('fetch failed')
      // 로 감싼다 — 이름만 보면 「집계 제외」로 새서, accept 백로그가 가득
      // 찬 웨지(연결 자체가 안 잡힘)를 영영 못 세는 구멍이 된다.
      const isTimeout = name === 'TimeoutError' || name === 'AbortError'
        || causeCode === 'UND_ERR_CONNECT_TIMEOUT'
        || causeCode === 'UND_ERR_HEADERS_TIMEOUT'
        || causeCode === 'UND_ERR_BODY_TIMEOUT';
      if (!isTimeout) {
        // ECONNREFUSED 등 — 죽었거나 재시작 중. supervisord 소관이므로
        // 킬 카운터는 건드리지 않는다.
        warn(`probe error (not counted): ${causeCode || error?.message || error}`);
        return;
      }
      consecutiveTimeouts += 1;
      warn(`probe timeout ${consecutiveTimeouts}/${CONSECUTIVE_FAILS} (${causeCode || name}: no full response in ${PROBE_TIMEOUT_MS}ms — wedged handler suspect)`);
      if (consecutiveTimeouts >= CONSECUTIVE_FAILS) {
        consecutiveTimeouts = 0;
        cooldownRemaining = COOLDOWN_CYCLES;
        await killApiServer();
      }
    }
  }
}

async function selfCheckKillPattern() {
  const { execFile } = await import('node:child_process');
  await new Promise((resolve) => {
    execFile('pgrep', ['-f', KILL_PATTERN], (error) => {
      if (error) {
        console.error(`[ApiWatchdog] SELF-CHECK FAILED: no process matches KILL_PATTERN "${KILL_PATTERN}" — a wedge kill would be a silent no-op. Align it with the supervisord [program:worldmonitor-api] command.`);
      } else {
        log('self-check ok: KILL_PATTERN matches a live process');
      }
      resolve();
    });
  });
}

async function killApiServer() {
  warn(`WEDGE CONFIRMED — killing "${KILL_PATTERN}" so supervisord restarts it (2026-08-17 incident playbook)`);
  const { execFile } = await import('node:child_process');
  await new Promise((resolve) => {
    execFile('pkill', ['-f', KILL_PATTERN], (error) => {
      if (error && error.code === 1) {
        // exit 1 = 매치 0건. 방금 죽었을 수도 있지만 KILL_PATTERN 드리프트일
        // 수도 있다 — 후자면 「고쳤다는 로그만 남고 웨지는 생존」하는 최악의
        // 무음 고장이므로 성공으로 위장하지 않고 크게 남긴다.
        console.error(`[ApiWatchdog] pkill matched NOTHING for "${KILL_PATTERN}" — either the process just died (supervisord will restart it) or KILL_PATTERN drifted from the supervisord command. Verify with ps.`);
      } else if (error) {
        warn(`pkill failed: ${error.message}`);
      } else {
        log('kill signal sent — supervisord autorestart will bring it back');
      }
      resolve();
    });
  });
}
