// api/_kw-env.js — 배포 환경 판정 + 운영(production) 부팅 검증.
// KW_ENV=production 인 팟에서는 운영자 뒷문(dev-login)이 어떤 값으로도 켜지지 않고,
// 공개 오리진(KW_PUBLIC_ORIGIN)·세션 서명키(WM_SESSION_SECRET)가 없으면 기동을 거부한다.
// 엔트리포인트(docker/entrypoint-onpod.sh)가 assertBootEnv() 를 호출하고, 핸들러도
// 요청마다 같은 판정을 다시 한다(핸들러는 지연 로드라 부팅 검증만으론 부족).
import { isAdminEmail } from './_kw-admin.js';

export function isProduction(env = process.env) {
  return String(env.KW_ENV || '').trim().toLowerCase() === 'production';
}

/** dev-login 이 살아 있는가 — 운영은 무조건 false, 그 외는 토큰(≥16자)이 있을 때만. */
export function devLoginAllowed(env = process.env) {
  if (isProduction(env)) return false;
  const t = env.KW_DEV_LOGIN_TOKEN;
  return Boolean(t && String(t).length >= 16);
}

/** dev-login 으로 세션을 만들 수 있는 이메일인가 — 운영자 이메일은 항상 거부,
 *  KW_DEV_LOGIN_EMAILS(쉼표 구분) 가 있으면 그 목록만 허용. */
export function devLoginEmailAllowed(email, env = process.env) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (isAdminEmail(e)) return false;
  const raw = String(env.KW_DEV_LOGIN_EMAILS || '').trim();
  if (!raw) return true;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(e);
}

/** 운영 부팅 검증 — 문제 목록을 돌려준다(빈 배열=정상). */
export function bootEnvProblems(env = process.env) {
  const problems = [];
  if (!isProduction(env)) return problems;
  if (env.KW_DEV_LOGIN_TOKEN) problems.push('KW_DEV_LOGIN_TOKEN must not be set when KW_ENV=production');
  if (!String(env.KW_PUBLIC_ORIGIN || '').trim()) problems.push('KW_PUBLIC_ORIGIN is required when KW_ENV=production');
  if (!String(env.WM_SESSION_SECRET || '').trim()) problems.push('WM_SESSION_SECRET is required when KW_ENV=production');
  return problems;
}

export function assertBootEnv(env = process.env) {
  const problems = bootEnvProblems(env);
  if (problems.length) throw new Error(`[kw-env] refusing to boot:\n - ${problems.join('\n - ')}`);
  if (isProduction(env) && !String(env.KW_ADMIN_EMAILS || '').trim()) {
    console.warn('[kw-env] KW_ADMIN_EMAILS is empty — superadmin is disabled for everyone');
  }
}
