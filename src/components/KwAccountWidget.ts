// K-Watch 헤더 계정 위젯 + 데모 안내 배너 + Pro 구독 모달.
// 업스트림 Clerk/Dodo 계정 UI(AuthHeaderWidget·UnifiedSettings 결제 탭)는 이 포크에서
// 백엔드가 없어 죽어 있으므로, 구글 로그인·토스페이먼츠 빌링에 맞춘 독립 위젯을 둔다.
// DOM 은 전부 createElement 로 만든다(safe-html 린트).
import {
  cancelKwBilling, completeKwBilling, daysLeft, fetchKwPayConfig, formatKrw, formatUntil,
  getKwAccount, logoutKwAccount, prepareKwBilling, refreshKwAccount, startGoogleLogin,
  startKwAccountPolling, subscribeKwAccount, type KwAccountState,
} from '@/services/kw-account';
import { showKcgModalNode } from '@/utils/kcg-modal';
import { showToast } from '@/utils/toast';

const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';
const BANNER_DISMISS_KEY = 'kw-demo-banner-dismissed';
// 마지막으로 확인한 모드 힌트 — /api/auth/me 응답 전에 배너 자리를 먼저 잡아 레이아웃 흔들림(CLS)을 막는다
const MODE_HINT_KEY = 'kw-mode-hint';

interface TossPaymentsBilling {
  requestBillingAuth(opts: { method: 'CARD'; successUrl: string; failUrl: string; customerEmail?: string; customerName?: string }): Promise<void>;
}
interface TossPaymentsSdk { payment(opts: { customerKey: string }): TossPaymentsBilling }
declare global { interface Window { TossPayments?: (clientKey: string) => TossPaymentsSdk } }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function mountKwAccount(): void {
  const mount = document.getElementById('kwAccountMount');
  const bannerMount = document.getElementById('kwDemoBannerMount');
  if (!mount) return;
  const widget = new KwAccountWidget(mount, bannerMount);
  widget.init();
}

class KwAccountWidget {
  private menu: HTMLElement | null = null;
  private onDocClick = (e: MouseEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node) && !this.root.contains(e.target as Node)) this.closeMenu();
  };

  constructor(private root: HTMLElement, private bannerMount: HTMLElement | null) {}

  init(): void {
    this.root.classList.add('kw-account');
    this.reserveBanner();
    subscribeKwAccount((s) => this.render(s));
    startKwAccountPolling();
    void this.handleReturnParams();
  }

  // 결제창·구글 로그인에서 돌아온 URL 파라미터 처리
  private async handleReturnParams(): Promise<void> {
    const u = new URL(location.href);
    const p = u.searchParams;
    let touched = false;
    if (p.get('login') === 'ok') { showToast('로그인했어요. 실시간 데이터를 불러와요.'); touched = true; }
    if (p.get('login') === 'failed') { showToast(`구글 로그인에 실패했어요. (${p.get('reason') || 'unknown'})`); touched = true; }
    if (p.get('kwpay') === 'fail') {
      showToast(`카드 등록이 취소되거나 실패했어요. ${p.get('message') || ''}`.trim()); touched = true;
    }
    if (p.get('kwpay') === 'success' && p.get('authKey') && p.get('customerKey')) {
      touched = true;
      const authKey = p.get('authKey') as string;
      const customerKey = p.get('customerKey') as string;
      showToast('카드 등록을 확인하고 첫 결제를 진행해요…');
      try {
        const r = await completeKwBilling(authKey, customerKey);
        showToast(`결제가 완료됐어요 (${formatKrw(r.amountKrw)}). 실시간 데이터를 불러와요.`);
        await refreshKwAccount();
        setTimeout(() => location.replace(stripParams(u)), 1200);
        return;
      } catch (e) {
        showToast(e instanceof Error ? e.message : '결제에 실패했어요.');
      }
    }
    if (touched) history.replaceState(null, '', stripParams(u));
  }

  private render(s: KwAccountState): void {
    this.root.replaceChildren();
    this.closeMenu();
    if (!s.loaded) return;
    if (!s.loggedIn) {
      const demo = el('span', 'kw-pill kw-pill-demo', s.mode === 'live' ? '전체 공개' : '데모');
      demo.title = s.mode === 'live' ? '운영자가 게이트를 꺼 두어 모두에게 실시간 데이터가 보여요.' : '지금 보이는 선박·항공기는 시연용 가상 데이터예요.';
      const btn = el('button', 'kw-login-btn');
      btn.type = 'button';
      btn.append(googleGlyph(), el('span', undefined, '로그인'));
      btn.title = '구글 계정으로 로그인';
      btn.addEventListener('click', () => this.login(s));
      this.root.append(demo, btn);
    } else {
      const btn = el('button', 'kw-user-btn');
      btn.type = 'button';
      btn.append(avatar(s), el('span', 'kw-user-plan', planLabel(s)));
      btn.title = s.user?.email || '';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(s, btn); });
      this.root.append(btn);
    }
    this.renderBanner(s);
  }

  private login(s: KwAccountState): void {
    if (!s.googleEnabled) {
      showToast('구글 로그인 연결이 준비 중이에요. 곧 열려요.');
      return;
    }
    startGoogleLogin();
  }

  private toggleMenu(s: KwAccountState, anchor: HTMLElement): void {
    if (this.menu) { this.closeMenu(); return; }
    const m = el('div', 'kw-menu');
    m.setAttribute('role', 'menu');
    const head = el('div', 'kw-menu-head');
    head.append(avatar(s, 32), el('div', 'kw-menu-id'));
    const idBox = head.lastElementChild as HTMLElement;
    idBox.append(el('div', 'kw-menu-name', s.user?.name || '이름 없음'), el('div', 'kw-menu-email', s.user?.email || ''));
    m.append(head);

    const status = el('div', 'kw-menu-status');
    if (s.mode === 'live' && s.liveUntil) {
      status.append(el('div', 'kw-menu-status-title', s.plan === 'pro' ? 'K-Watch Pro 이용 중' : `무료 체험 중 (${daysLeft(s.liveUntil)}일 남음)`));
      status.append(el('div', 'kw-menu-status-sub', `실시간 데이터 ${formatUntil(s.liveUntil)}까지${s.subscription?.autoRenew ? ' · 매월 자동 결제' : ''}`));
    } else {
      status.append(el('div', 'kw-menu-status-title kw-warn', s.liveUntil ? '이용권이 만료됐어요' : '실시간 데이터 이용권이 없어요'));
      status.append(el('div', 'kw-menu-status-sub', '지금은 시연용 가상 데이터가 보여요.'));
    }
    m.append(status);

    const actions = el('div', 'kw-menu-actions');
    if (s.subscription?.autoRenew) {
      const cancel = el('button', 'kw-menu-btn', '자동 결제 해지');
      cancel.type = 'button';
      cancel.addEventListener('click', async () => {
        if (!confirm('자동 결제를 해지할까요? 이미 결제한 기간까지는 계속 이용할 수 있어요.')) return;
        try { await cancelKwBilling(); showToast('자동 결제를 해지했어요. 남은 기간은 그대로 이용할 수 있어요.'); await refreshKwAccount(); }
        catch (e) { showToast(e instanceof Error ? e.message : '해지에 실패했어요.'); }
      });
      actions.append(cancel);
    } else {
      const sub = el('button', 'kw-menu-btn kw-menu-btn-primary', s.mode === 'live' ? 'K-Watch Pro 구독하기' : 'Pro 구독하고 실시간 데이터 열기');
      sub.type = 'button';
      sub.addEventListener('click', () => { this.closeMenu(); void this.openSubscribeModal(); });
      actions.append(sub);
    }
    if (s.isAdmin) {
      const admin = el('button', 'kw-menu-btn', '슈퍼어드민 열기');
      admin.type = 'button';
      admin.addEventListener('click', () => { location.assign('/admin'); });
      actions.append(admin);
    }
    const logout = el('button', 'kw-menu-btn', '로그아웃');
    logout.type = 'button';
    logout.addEventListener('click', () => { void logoutKwAccount(); });
    actions.append(logout);
    m.append(actions);

    const r = anchor.getBoundingClientRect();
    m.style.top = `${Math.round(r.bottom + 6)}px`;
    m.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    document.body.appendChild(m);
    this.menu = m;
    setTimeout(() => document.addEventListener('click', this.onDocClick), 0);
  }

  private closeMenu(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener('click', this.onDocClick);
  }

  // 첫 페인트에 빈 배너 자리(고정 높이)를 깔아 둔다. 직전 방문이 라이브였거나 닫아 둔 세션이면 생략.
  private reserveBanner(): void {
    const mount = this.bannerMount;
    if (!mount) return;
    let hint = 'demo';
    try { hint = localStorage.getItem(MODE_HINT_KEY) || 'demo'; } catch { /* storage blocked */ }
    if (hint === 'live' || sessionStorage.getItem(BANNER_DISMISS_KEY) === '1') return;
    const ph = el('div', 'kw-demo-banner kw-demo-banner-placeholder');
    ph.setAttribute('aria-hidden', 'true');
    mount.append(ph);
  }

  private renderBanner(s: KwAccountState): void {
    const mount = this.bannerMount;
    if (!mount) return;
    try { localStorage.setItem(MODE_HINT_KEY, s.mode); } catch { /* storage blocked */ }
    mount.replaceChildren();
    if (s.mode === 'live') { document.documentElement.classList.remove('kw-demo'); return; }
    document.documentElement.classList.add('kw-demo');
    if (sessionStorage.getItem(BANNER_DISMISS_KEY) === '1') return;

    const bar = el('div', 'kw-demo-banner');
    bar.setAttribute('role', 'status');
    const txt = el('div', 'kw-demo-banner-text');
    const cta = el('button', 'kw-demo-banner-cta');
    cta.type = 'button';
    if (!s.loggedIn) {
      txt.append(el('strong', undefined, '시연 모드'), document.createTextNode(' 지금 보이는 선박·항공기 위치는 시연용 가상 데이터예요. 실시간 데이터는 로그인하면 볼 수 있어요.'));
      cta.append(googleGlyph(), el('span', undefined, '구글로 로그인'));
      cta.addEventListener('click', () => this.login(s));
    } else {
      txt.append(el('strong', undefined, s.liveUntil ? '체험이 끝났어요' : '이용권 없음'), document.createTextNode(' 실시간 데이터는 K-Watch Pro 구독 후 이용할 수 있어요. 지금은 시연용 가상 데이터가 보여요.'));
      cta.textContent = 'Pro 구독하기';
      cta.addEventListener('click', () => { void this.openSubscribeModal(); });
    }
    const close = el('button', 'kw-demo-banner-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', '안내 닫기');
    close.addEventListener('click', () => { sessionStorage.setItem(BANNER_DISMISS_KEY, '1'); bar.remove(); });
    bar.append(txt, cta, close);
    mount.append(bar);
  }

  private async openSubscribeModal(): Promise<void> {
    let cfg;
    try { cfg = await fetchKwPayConfig(); } catch { showToast('결제 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    const s = getKwAccount();
    const body = el('div', 'kw-sub');
    const price = el('div', 'kw-sub-price');
    price.append(el('span', 'kw-sub-price-num', formatKrw(cfg.product.priceKrw)), el('span', 'kw-sub-price-unit', ` / ${cfg.product.days}일`));
    body.append(price);
    const ul = el('ul', 'kw-sub-benefits');
    for (const t of [
      '한반도 해역 선박 AIS 실시간 위치·항적',
      '한반도 공역 항공기 ADS-B 실시간 위치·추적',
      'AI 이상징후 판독(해상·공역)과 경보',
      '매월 자동 결제, 언제든 해지 가능(남은 기간은 유지)',
    ]) ul.append(el('li', undefined, t));
    body.append(ul);
    const note = el('p', 'kw-sub-note');
    note.textContent = s.liveUntil && s.liveUntil > Date.now()
      ? `지금 남은 이용 기간(${formatUntil(s.liveUntil)}까지) 뒤에 ${cfg.product.days}일이 더해져요. 결제는 토스페이먼츠에서 안전하게 처리돼요.`
      : '카드 등록 직후 첫 달 요금이 결제되고, 바로 실시간 데이터가 열려요. 결제는 토스페이먼츠에서 안전하게 처리돼요.';
    body.append(note);
    const btn = el('button', 'kw-sub-btn', cfg.enabled ? '카드 등록하고 구독 시작' : '결제 준비 중이에요');
    btn.type = 'button';
    btn.disabled = !cfg.enabled;
    if (!s.loggedIn) { btn.textContent = '먼저 로그인해 주세요'; btn.disabled = true; }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '토스페이먼츠 카드 등록창을 여는 중…';
      try {
        await this.startBillingAuth(cfg.clientKey as string);
      } catch (e) {
        showToast(e instanceof Error ? e.message : '카드 등록창을 열지 못했어요.');
        btn.disabled = false;
        btn.textContent = '카드 등록하고 구독 시작';
      }
    });
    body.append(btn);
    showKcgModalNode('K-Watch Pro 구독', body, 480);
  }

  private async startBillingAuth(clientKey: string): Promise<void> {
    const prep = await prepareKwBilling();
    await loadTossSdk();
    if (!window.TossPayments) throw new Error('결제 모듈을 불러오지 못했어요.');
    const toss = window.TossPayments(clientKey);
    const payment = toss.payment({ customerKey: prep.customerKey });
    const origin = location.origin;
    await payment.requestBillingAuth({
      method: 'CARD',
      successUrl: `${origin}/?kwpay=success`,
      failUrl: `${origin}/?kwpay=fail`,
      customerEmail: prep.customerEmail,
      customerName: prep.customerName,
    });
  }
}

let sdkPromise: Promise<void> | null = null;
function loadTossSdk(): Promise<void> {
  if (window.TossPayments) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = TOSS_SDK_URL;
    sc.async = true;
    sc.onload = () => resolve();
    sc.onerror = () => { sdkPromise = null; reject(new Error('토스페이먼츠 결제 모듈 로드에 실패했어요.')); };
    document.head.appendChild(sc);
  });
  return sdkPromise;
}

function stripParams(u: URL): string {
  for (const k of ['login', 'reason', 'kwpay', 'authKey', 'customerKey', 'code', 'message']) u.searchParams.delete(k);
  return `${u.pathname}${u.search}${u.hash}`;
}

function planLabel(s: KwAccountState): string {
  if (s.mode !== 'live' || !s.liveUntil) return '만료';
  if (s.plan === 'pro') return 'Pro';
  return `체험 ${daysLeft(s.liveUntil)}일`;
}

function avatar(s: KwAccountState, size = 22): HTMLElement {
  const name = s.user?.name || s.user?.email || '?';
  if (s.user?.picture) {
    const img = el('img', 'kw-avatar');
    img.src = s.user.picture;
    img.alt = name;
    img.width = size; img.height = size;
    img.referrerPolicy = 'no-referrer';
    return img;
  }
  const c = el('span', 'kw-avatar kw-avatar-initial', name.trim().charAt(0).toUpperCase());
  c.style.width = `${size}px`; c.style.height = `${size}px`; c.style.lineHeight = `${size}px`;
  return c;
}

function googleGlyph(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const paths: Array<[string, string]> = [
    ['#EA4335', 'M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z'],
    ['#4285F4', 'M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z'],
    ['#FBBC05', 'M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z'],
    ['#34A853', 'M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z'],
  ];
  for (const [fill, d] of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('fill', fill); p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
