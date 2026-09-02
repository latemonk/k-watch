// K-Watch 계정·이용권 상태 — /api/auth/me 를 정본으로 하는 작은 스토어.
// 부트·10분 주기·탭 복귀·결제 완료 뒤 새로고침한다. 서버는 이 호출에서
// 핫패스 쿠키(kwu)를 DB 기준으로 재발급하므로, 체험 만료·결제 연장이
// 선박·항공기 게이트에 반영되는 경로이기도 하다.
import { toApiUrl } from './runtime';

export type KwDataMode = 'live' | 'demo';

export interface KwAccountState {
  loaded: boolean;
  loggedIn: boolean;
  mode: KwDataMode;
  user: { id: number; email: string; name: string; picture: string } | null;
  plan: string;
  liveUntil: number | null;
  googleEnabled: boolean;
  payEnabled: boolean;
  trialDays: number;
  subscription: { autoRenew: boolean; cardLabel: string | null; failCount: number; hasBillingKey: boolean } | null;
}

export interface KwProduct { id: string; name: string; priceKrw: number; days: number }

const REFRESH_MS = 10 * 60 * 1000;
const listeners = new Set<(s: KwAccountState) => void>();
let state: KwAccountState = {
  loaded: false, loggedIn: false, mode: 'demo', user: null, plan: 'none', liveUntil: null,
  googleEnabled: false, payEnabled: false, trialDays: 7, subscription: null,
};
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<KwAccountState> | null = null;

export function getKwAccount(): KwAccountState { return state; }

export function subscribeKwAccount(fn: (s: KwAccountState) => void): () => void {
  listeners.add(fn);
  if (state.loaded) fn(state);
  return () => { listeners.delete(fn); };
}

function emit(): void { for (const fn of listeners) { try { fn(state); } catch { /* listener error must not break others */ } } }

export async function refreshKwAccount(): Promise<KwAccountState> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(toApiUrl('/api/auth/me'), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`me ${r.status}`);
      const j = await r.json();
      state = {
        loaded: true,
        loggedIn: Boolean(j.loggedIn),
        mode: j.mode === 'live' ? 'live' : 'demo',
        user: j.user ?? null,
        plan: String(j.plan ?? 'none'),
        liveUntil: typeof j.liveUntil === 'number' ? j.liveUntil : null,
        googleEnabled: Boolean(j.googleEnabled),
        payEnabled: Boolean(j.payEnabled),
        trialDays: Number(j.trialDays ?? 7),
        subscription: j.subscription ?? null,
      };
    } catch (e) {
      // 서버를 못 물으면 「데모」로 두되 loaded 는 올려 UI 가 멈추지 않게 한다
      console.warn('[kw-account] refresh failed:', e instanceof Error ? e.message : e);
      state = { ...state, loaded: true };
    }
    emit();
    return state;
  })();
  try { return await inflight; } finally { inflight = null; }
}

export function startKwAccountPolling(): void {
  if (timer) return;
  void refreshKwAccount();
  timer = setInterval(() => { void refreshKwAccount(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshKwAccount();
  });
}

export function startGoogleLogin(): void {
  const next = `${location.pathname}${location.search}`;
  location.assign(toApiUrl(`/api/auth/google/start?next=${encodeURIComponent(next)}`));
}

export async function logoutKwAccount(): Promise<void> {
  try { await fetch(toApiUrl('/api/auth/logout'), { method: 'POST', credentials: 'same-origin' }); } catch { /* cookie may already be gone */ }
  location.reload();
}

export async function fetchKwPayConfig(): Promise<{ enabled: boolean; clientKey: string | null; product: KwProduct }> {
  const r = await fetch(toApiUrl('/api/pay/config'), { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) throw new Error(`pay config ${r.status}`);
  return r.json();
}

export async function prepareKwBilling(): Promise<{ customerKey: string; customerEmail: string; customerName: string; product: KwProduct }> {
  const r = await fetch(toApiUrl('/api/pay/billing/prepare'), { method: 'POST', credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || '결제 준비에 실패했어요.');
  return j;
}

export async function completeKwBilling(authKey: string, customerKey: string): Promise<{ liveUntil: number | null; amountKrw: number }> {
  const r = await fetch(toApiUrl('/api/pay/billing/complete'), {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey, customerKey }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || '결제에 실패했어요.');
  return j;
}

export async function cancelKwBilling(): Promise<void> {
  const r = await fetch(toApiUrl('/api/pay/billing/cancel'), { method: 'POST', credentials: 'same-origin' });
  if (!r.ok) throw new Error('해지 요청에 실패했어요.');
}

export function formatKrw(n: number): string { return `${n.toLocaleString('ko-KR')}원`; }

export function formatUntil(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function daysLeft(ms: number): number {
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400e3));
}
