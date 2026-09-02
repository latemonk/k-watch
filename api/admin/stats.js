// GET /api/admin/stats — 슈퍼어드민 현황(운영자 이메일만). 일별 버킷은 전부 KST.
import { json } from '../_kw-http.js';
import { requireAdmin } from '../_kw-admin.js';
import { dbEnabled, q, kstToday } from '../_kw-db.js';

export const config = { runtime: 'edge' };

const KST = `AT TIME ZONE 'Asia/Seoul'`;

export default async function handler(req) {
  if (req.method !== 'GET') return json(405, { error: 'GET only' });
  const { response } = await requireAdmin(req);
  if (response) return response;
  if (!dbEnabled()) return json(503, { error: 'db_not_configured', message: 'DB 연결이 없어요.' });

  const today = kstToday();
  const priceKrw = Math.max(1000, Number(process.env.KW_PRO_PRICE_KRW) || 29000);

  const [head, mrr, act, daily, users, payments] = await Promise.all([
    q(`SELECT
        (SELECT count(*) FROM kw_users) AS total_users,
        (SELECT count(*) FROM kw_users WHERE live_until > now() AND toss_billing_key IS NOT NULL) AS pro_active,
        (SELECT count(*) FROM kw_users WHERE live_until > now() AND toss_billing_key IS NULL) AS trial_active,
        (SELECT count(*) FROM kw_users WHERE live_until IS NOT NULL AND live_until <= now()) AS expired,
        (SELECT count(*) FROM kw_users WHERE sub_auto_renew AND live_until > now()) AS auto_renew_on,
        (SELECT count(*) FROM kw_users WHERE sub_auto_renew AND live_until BETWEEN now() AND now() + interval '7 days') AS renewals_due_7d,
        (SELECT count(DISTINCT user_id) FROM kw_payments WHERE status = 'paid') AS paid_users,
        (SELECT coalesce(sum(amount_krw), 0) FROM kw_payments WHERE status = 'paid') AS revenue_total,
        (SELECT count(*) FROM kw_payments WHERE status = 'failed' AND created_at > now() - interval '30 days') AS failed_30d,
        (SELECT count(*) FROM kw_users WHERE last_login_at > now() - interval '7 days') AS login_7d`),
    q(`SELECT coalesce(sum(p.amount_krw), 0) AS mrr
       FROM kw_users u
       JOIN LATERAL (SELECT amount_krw FROM kw_payments WHERE user_id = u.id AND status = 'paid' ORDER BY paid_at DESC NULLS LAST LIMIT 1) p ON true
       WHERE u.sub_auto_renew AND u.live_until > now()`),
    q(`SELECT
        (SELECT count(*) FROM kw_user_activity WHERE day = $1::date) AS au_1,
        (SELECT count(DISTINCT user_id) FROM kw_user_activity WHERE day >= $1::date - 6) AS au_7,
        (SELECT count(DISTINCT user_id) FROM kw_user_activity WHERE day >= $1::date - 29) AS au_30,
        (SELECT count(*) FROM kw_visitor_activity WHERE day = $1::date) AS vis_1,
        (SELECT count(*) FROM kw_visitor_activity WHERE day >= $1::date - 6) AS vis_7,
        (SELECT count(*) FROM kw_visitor_activity WHERE day >= $1::date - 29) AS vis_30`, [today]),
    q(`WITH days AS (
         SELECT d::date AS day FROM generate_series($1::date - 29, $1::date, interval '1 day') d
       )
       SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
         (SELECT count(*) FROM kw_users u WHERE (u.created_at ${KST})::date = days.day) AS signups,
         (SELECT count(*) FROM kw_user_activity a WHERE a.day = days.day) AS active_users,
         (SELECT count(*) FROM kw_visitor_activity v WHERE v.day = days.day) AS visitors,
         (SELECT count(*) FROM kw_payments p WHERE p.status = 'paid' AND (p.paid_at ${KST})::date = days.day) AS payments,
         (SELECT coalesce(sum(amount_krw), 0) FROM kw_payments p WHERE p.status = 'paid' AND (p.paid_at ${KST})::date = days.day) AS revenue
       FROM days ORDER BY days.day DESC`, [today]),
    q(`SELECT u.id, u.email, u.name, u.picture, u.live_until, u.toss_billing_key IS NOT NULL AS has_card, u.toss_card_label,
              u.sub_auto_renew, u.sub_fail_count, u.created_at, u.last_login_at,
              (SELECT coalesce(sum(amount_krw), 0) FROM kw_payments WHERE user_id = u.id AND status = 'paid') AS paid_total,
              (SELECT to_char(max(day), 'YYYY-MM-DD') FROM kw_user_activity WHERE user_id = u.id) AS last_active_day
       FROM kw_users u ORDER BY u.id DESC LIMIT 30`),
    q(`SELECT p.id, p.kind, p.order_id, p.order_name, p.amount_krw, p.status, p.fail_reason, p.created_at, p.paid_at, u.email
       FROM kw_payments p JOIN kw_users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 30`),
  ]);

  const h = head.rows[0] || {};
  const a = act.rows[0] || {};
  const rows = daily.rows.map((r) => ({
    day: r.day, signups: n(r.signups), activeUsers: n(r.active_users), visitors: n(r.visitors), payments: n(r.payments), revenue: n(r.revenue),
  }));
  const sum = (days, key) => rows.slice(0, days).reduce((acc, r) => acc + r[key], 0);
  const now = Date.now();

  return json(200, {
    generatedAt: now,
    today,
    priceKrw,
    totals: {
      users: n(h.total_users), proActive: n(h.pro_active), trialActive: n(h.trial_active), expired: n(h.expired),
      autoRenewOn: n(h.auto_renew_on), renewalsDue7d: n(h.renewals_due_7d), paidUsers: n(h.paid_users),
      revenueTotal: n(h.revenue_total), failed30d: n(h.failed_30d), login7d: n(h.login_7d), mrr: n(mrr.rows[0]?.mrr),
    },
    periods: {
      today: { signups: sum(1, 'signups'), activeUsers: n(a.au_1), visitors: n(a.vis_1), payments: sum(1, 'payments'), revenue: sum(1, 'revenue') },
      d7: { signups: sum(7, 'signups'), activeUsers: n(a.au_7), visitors: n(a.vis_7), payments: sum(7, 'payments'), revenue: sum(7, 'revenue') },
      d30: { signups: sum(30, 'signups'), activeUsers: n(a.au_30), visitors: n(a.vis_30), payments: sum(30, 'payments'), revenue: sum(30, 'revenue') },
    },
    daily: rows,
    recentUsers: users.rows.map((u) => ({
      id: n(u.id), email: u.email, name: u.name, picture: u.picture,
      state: stateOf(u, now), liveUntil: ts(u.live_until), hasCard: Boolean(u.has_card), cardLabel: u.toss_card_label || null,
      autoRenew: Boolean(u.sub_auto_renew), failCount: n(u.sub_fail_count), createdAt: ts(u.created_at), lastLoginAt: ts(u.last_login_at),
      paidTotal: n(u.paid_total), lastActiveDay: u.last_active_day || null,
    })),
    recentPayments: payments.rows.map((p) => ({
      id: n(p.id), email: p.email, kind: p.kind, orderId: p.order_id, orderName: p.order_name, amountKrw: n(p.amount_krw),
      status: p.status, failReason: p.fail_reason || null, createdAt: ts(p.created_at), paidAt: ts(p.paid_at),
    })),
  }, { 'Cache-Control': 'no-store' });
}

function n(v) { return Number(v) || 0; }
function ts(v) { return v ? new Date(v).getTime() : null; }
function stateOf(u, now) {
  const until = u.live_until ? new Date(u.live_until).getTime() : 0;
  if (until > now) return u.has_card ? 'pro' : 'trial';
  return until ? 'expired' : 'none';
}
