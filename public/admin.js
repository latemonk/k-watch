// K-Watch 슈퍼어드민 — /api/admin/stats 를 그려 준다. DOM 은 전부 createElement(문자열 HTML 주입 없음).
(() => {
  const app = document.getElementById('app');
  const who = document.getElementById('who');
  const stamp = document.getElementById('stamp');
  document.getElementById('refresh').addEventListener('click', () => load());

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = String(text); return n; };
  const num = (v) => new Intl.NumberFormat('ko-KR').format(Number(v) || 0);
  const krw = (v) => `${num(v)}원`;
  const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '–');
  const dt = (ms) => (ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '–');
  const d = (ms) => (ms ? new Date(ms).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' }) : '–');
  const dow = ['일', '월', '화', '수', '목', '금', '토'];

  async function load() {
    stamp.textContent = '불러오는 중…';
    let r;
    try { r = await fetch('/api/admin/stats', { credentials: 'same-origin', cache: 'no-store' }); }
    catch { return state('서버에 연결하지 못했어요', '잠시 후 새로고침해 주세요.'); }
    if (r.status === 401) return state('로그인이 필요해요', '운영자 구글 계정으로 로그인하면 현황이 보여요.', loginButton());
    if (r.status === 404) return state('페이지를 찾을 수 없어요', '');
    if (!r.ok) return state(`현황을 가져오지 못했어요 (HTTP ${r.status})`, '잠시 후 새로고침해 주세요.');
    render(await r.json());
  }

  function loginButton() {
    const b = el('button', 'btn btn-primary', '구글 계정으로 로그인');
    b.type = 'button';
    b.addEventListener('click', () => location.assign(`/api/auth/google/start?next=${encodeURIComponent('/admin')}`));
    return b;
  }

  function state(title, desc, extra) {
    stamp.textContent = '';
    const box = el('div', 'state');
    box.append(el('h2', null, title));
    if (desc) box.append(el('p', null, desc));
    if (extra) box.append(extra);
    app.replaceChildren(box);
  }

  function tile(label, value, unit, subs, hero) {
    const t = el('div', hero ? 'tile hero' : 'tile');
    t.append(el('div', 'label', label));
    const v = el('div', 'value', num(value));
    if (unit) v.append(el('small', null, unit));
    t.append(v);
    if (subs && subs.length) {
      const s = el('div', 'sub');
      for (const [k, val] of subs) { const span = el('span', null, `${k} `); span.append(el('b', null, val)); s.append(span); }
      t.append(s);
    }
    return t;
  }

  function section(title, note) {
    const h = el('h2', 'sec', title);
    if (note) h.append(el('small', null, note));
    return h;
  }

  function table(headers, rows, rowFn) {
    const panel = el('div', 'panel');
    if (!rows.length) { panel.append(el('div', 'empty', '아직 데이터가 없어요.')); return panel; }
    const sc = el('div', 'scroll');
    const t = el('table');
    const thead = el('thead'); const trh = el('tr');
    for (const h of headers) trh.append(el('th', h.num ? 'num' : null, h.label));
    thead.append(trh); t.append(thead);
    const tb = el('tbody');
    for (const row of rows) tb.append(rowFn(row));
    t.append(tb); sc.append(t); panel.append(sc);
    return panel;
  }

  function barCell(value, max, dim) {
    const td = el('td');
    const wrap = el('div', 'cell-bar');
    const bar = el('span', dim ? 'bar dim' : 'bar');
    bar.style.width = `${max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 90)) : 0}px`;
    wrap.append(bar, el('span', 'n', num(value)));
    td.append(wrap);
    return td;
  }

  function badge(kind, label) { return el('span', `badge ${kind}`, label); }

  function render(s) {
    const T = s.totals; const P = s.periods;
    stamp.textContent = `${dt(s.generatedAt)} 기준`;
    const frag = document.createDocumentFragment();

    frag.append(section('오늘', `한국 시간 ${s.today} · 7일·30일은 오늘 포함`));
    const k1 = el('div', 'kpis');
    k1.append(
      tile('오늘 방문자 (비로그인 고유)', P.today.visitors, '명', [['7일', num(P.d7.visitors)], ['30일', num(P.d30.visitors)]], true),
      tile('오늘 활성 로그인 사용자', P.today.activeUsers, '명', [['7일', num(P.d7.activeUsers)], ['30일', num(P.d30.activeUsers)]]),
      tile('오늘 가입', P.today.signups, '명', [['7일', num(P.d7.signups)], ['30일', num(P.d30.signups)]]),
      tile('오늘 결제', P.today.revenue, '원', [['건수', num(P.today.payments)], ['7일', krw(P.d7.revenue)], ['30일', krw(P.d30.revenue)]]),
    );
    frag.append(k1);

    frag.append(section('누적·구독', `Pro 월 ${krw(s.priceKrw)} 기준`));
    const k2 = el('div', 'kpis');
    k2.append(
      tile('전체 가입자', T.users, '명', [['최근 7일 로그인', num(T.login7d)]]),
      tile('Pro 이용 중', T.proActive, '명', [['자동갱신 켬', num(T.autoRenewOn)], ['7일 내 갱신 예정', num(T.renewalsDue7d)]]),
      tile('무료 체험 중', T.trialActive, '명', [['만료', num(T.expired)]]),
      tile('월 반복 매출 (MRR)', T.mrr, '원', [['누적 매출', krw(T.revenueTotal)]]),
      tile('결제 전환', T.paidUsers, '명', [['가입 대비', pct(T.paidUsers, T.users)], ['30일 실패', num(T.failed30d)]]),
    );
    frag.append(k2);

    frag.append(section('일별 추이 (최근 30일)', '방문자는 비로그인 고유, 활성은 로그인 사용자 고유 · 활동 기록은 이번 배포부터 쌓여요'));
    const maxV = Math.max(...s.daily.map((r) => r.visitors), 1);
    const maxA = Math.max(...s.daily.map((r) => r.activeUsers), 1);
    frag.append(table(
      [{ label: '날짜' }, { label: '방문자' }, { label: '활성 사용자' }, { label: '가입', num: true }, { label: '결제', num: true }, { label: '매출', num: true }],
      s.daily,
      (r) => {
        const tr = el('tr', r.day === s.today ? 'today' : null);
        const day = new Date(`${r.day}T00:00:00+09:00`);
        tr.append(el('td', null, `${r.day.slice(5)} (${dow[day.getDay()]})`));
        tr.append(barCell(r.visitors, maxV, true));
        tr.append(barCell(r.activeUsers, maxA, false));
        tr.append(el('td', 'num', r.signups ? num(r.signups) : '·'));
        tr.append(el('td', 'num', r.payments ? num(r.payments) : '·'));
        tr.append(el('td', 'num', r.revenue ? krw(r.revenue) : '·'));
        return tr;
      },
    ));

    frag.append(section('최근 가입자', '최근 30명'));
    const stateLabel = { pro: 'Pro', trial: '체험', expired: '만료', none: '없음' };
    frag.append(table(
      [{ label: '사용자' }, { label: '상태' }, { label: '이용 만료' }, { label: '카드' }, { label: '누적 결제', num: true }, { label: '가입' }, { label: '마지막 로그인' }, { label: '마지막 활동' }],
      s.recentUsers,
      (u) => {
        const tr = el('tr');
        const td = el('td'); const box = el('div', 'user');
        const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; if (u.picture) img.src = u.picture;
        const id = el('div', 'id'); id.append(el('div', 'name', u.name || '이름 없음'), el('div', 'email', u.email));
        box.append(img, id); td.append(box); tr.append(td);
        const st = el('td'); st.append(badge(u.state, stateLabel[u.state] || u.state)); if (u.autoRenew) st.append(document.createTextNode(' 자동갱신')); tr.append(st);
        tr.append(el('td', null, d(u.liveUntil)));
        tr.append(el('td', null, u.hasCard ? `${u.cardLabel || '등록'}${u.failCount ? ` · 실패 ${u.failCount}` : ''}` : '–'));
        tr.append(el('td', 'num', u.paidTotal ? krw(u.paidTotal) : '·'));
        tr.append(el('td', null, dt(u.createdAt)));
        tr.append(el('td', null, dt(u.lastLoginAt)));
        tr.append(el('td', null, u.lastActiveDay ? u.lastActiveDay.slice(5) : '–'));
        return tr;
      },
    ));

    frag.append(section('최근 결제', '최근 30건 · 실패 포함'));
    const kindLabel = { subscription: '첫 결제', renewal: '자동갱신' };
    const statusLabel = { paid: '결제됨', failed: '실패', pending: '대기' };
    frag.append(table(
      [{ label: '시각' }, { label: '사용자' }, { label: '종류' }, { label: '금액', num: true }, { label: '상태' }, { label: '주문번호' }],
      s.recentPayments,
      (p) => {
        const tr = el('tr');
        tr.append(el('td', null, dt(p.paidAt || p.createdAt)));
        tr.append(el('td', null, p.email));
        tr.append(el('td', null, kindLabel[p.kind] || p.kind));
        tr.append(el('td', 'num', krw(p.amountKrw)));
        const st = el('td'); st.append(badge(p.status, statusLabel[p.status] || p.status)); if (p.failReason) st.append(el('span', 'mono', ` ${p.failReason}`)); tr.append(st);
        tr.append(el('td', 'mono', p.orderId));
        return tr;
      },
    ));

    frag.append(el('p', 'foot', '방문자 수는 비로그인 상태로 대시보드를 연 브라우저를 날짜·IP·브라우저 해시로 센 값이라 봇과 상시 열어 둔 탭이 섞일 수 있어요. 활성 사용자는 로그인 상태로 대시보드를 연 계정 수예요.'));
    app.replaceChildren(frag);
    who.textContent = '';
  }

  load();
})();
