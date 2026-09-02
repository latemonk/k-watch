// api/_kw-db.js
// K-Watch 사용자·구독 저장소 — onpod 관리형 Postgres(DATABASE_URL).
// 내장 redis 는 /tmp·persist off·LRU 라 계정·결제 기록을 둘 수 없다.
// 이 모듈은 api/auth/*, api/pay/* (서브디렉터리 핸들러 = esbuild 재번들 대상
// 아님 → /app/node_modules 의 pg 를 런타임 해석) 에서만 import 한다.
// 핫패스(선박·항공기) 핸들러는 DB 를 치지 않는다(_kw-user-session.js 참조).

import pg from 'pg';

let pool = null;
let schemaReady = null;

export function dbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // sslmode=require 를 Node pg 는 「인증서 검증까지」로 읽어 자체서명 체인에서
  // 실패한다 — 연결 문자열의 sslmode 는 떼고 ssl 옵션으로 명시한다.
  const u = new URL(url);
  const wantsSsl = u.searchParams.get('sslmode') && u.searchParams.get('sslmode') !== 'disable';
  u.searchParams.delete('sslmode');
  pool = new pg.Pool({
    connectionString: u.toString(),
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  pool.on('error', (e) => console.error('[kw-db] pool error:', e.message));
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kw_users (
  id BIGSERIAL PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'trial',
  live_until TIMESTAMPTZ,
  toss_customer_key TEXT,
  toss_billing_key TEXT,
  toss_card_label TEXT,
  sub_auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  sub_fail_count INT NOT NULL DEFAULT 0,
  renew_claimed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS kw_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES kw_users(id),
  kind TEXT NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  order_name TEXT NOT NULL,
  amount_krw INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_key TEXT,
  fail_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kw_payments_user_idx ON kw_payments(user_id, id DESC);
CREATE INDEX IF NOT EXISTS kw_users_renew_idx ON kw_users(live_until) WHERE sub_auto_renew;
`;

/** 스키마 보장(멱등). 프로세스당 1회. */
export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(SCHEMA_SQL).then(() => true).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export async function q(text, params = []) {
  await ensureSchema();
  return getPool().query(text, params);
}

/** 트랜잭션 헬퍼 */
export async function tx(fn) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

export function trialDays() {
  const n = Number(process.env.KW_TRIAL_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}

/**
 * 구글 프로필로 사용자 upsert. 첫 로그인이면 무료 체험 기간을 스탬프한다.
 * @returns {Promise<KwUserRow>}
 */
export async function upsertGoogleUser({ sub, email, name, picture }) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) throw new Error('email required');
  const days = trialDays();
  const r = await q(
    `INSERT INTO kw_users (google_sub, email, name, picture, plan, live_until, last_login_at)
     VALUES ($1, $2, $3, $4, 'trial', CASE WHEN $5::int > 0 THEN now() + ($5::int * interval '1 day') ELSE NULL END, now())
     ON CONFLICT (email) DO UPDATE SET
       google_sub = COALESCE(kw_users.google_sub, EXCLUDED.google_sub),
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE kw_users.name END,
       picture = CASE WHEN EXCLUDED.picture <> '' THEN EXCLUDED.picture ELSE kw_users.picture END,
       last_login_at = now()
     RETURNING *`,
    [sub ? String(sub) : null, em, String(name || '').slice(0, 80), String(picture || '').slice(0, 300), days],
  );
  return r.rows[0];
}

export async function getUserById(id) {
  const r = await q('SELECT * FROM kw_users WHERE id = $1', [Number(id)]);
  return r.rows[0] || null;
}

/** 세션 쿠키 페이로드용 요약 — 라이브 이용 만료 = live_until */
export function userToSession(row) {
  const until = row.live_until ? new Date(row.live_until).getTime() : 0;
  const plan = until > Date.now() ? (row.toss_billing_key ? 'pro' : row.plan || 'trial') : 'none';
  return { id: row.id, email: row.email, name: row.name, picture: row.picture, plan, liveUntil: until };
}

/**
 * @typedef {Object} KwUserRow
 * @property {number} id
 * @property {string|null} google_sub
 * @property {string} email
 * @property {string} name
 * @property {string} picture
 * @property {string} plan
 * @property {string|Date|null} live_until
 * @property {string|null} toss_customer_key
 * @property {string|null} toss_billing_key
 * @property {string|null} toss_card_label
 * @property {boolean} sub_auto_renew
 * @property {number} sub_fail_count
 */
