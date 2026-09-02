// api/_kw-toss.js — 토스페이먼츠 서버 API 헬퍼 + K-Watch Pro 상품 정의.
// 회사 공용 MID(다른 앱들과 같은 live 키) — 격리는 orderId 접두어(kwatch-)로만.
export const PRODUCT = {
  id: 'pro_monthly',
  name: 'K-Watch Pro 월 이용권',
  priceKrw: Math.max(1000, Number(process.env.KW_PRO_PRICE_KRW) || 29000),
  days: Math.max(7, Number(process.env.KW_PRO_DAYS) || 30),
};
export const ORDER_PREFIX = (process.env.TOSS_ORDER_PREFIX || 'kwatch-').replace(/[^a-zA-Z0-9-_]/g, '') || 'kwatch-';

export function payEnabled() {
  return Boolean(process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY);
}
export function clientKey() { return process.env.TOSS_CLIENT_KEY || ''; }

export async function tossPost(path, body, idempotencyKey) {
  const secret = process.env.TOSS_SECRET_KEY;
  if (!secret) throw Object.assign(new Error('결제가 준비되지 않았어요.'), { code: 'NOT_CONFIGURED' });
  const r = await fetch(`https://api.tosspayments.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.message || `토스페이먼츠 API 오류 (${r.status})`);
    err.code = data?.code || `HTTP_${r.status}`;
    err.status = r.status;
    throw err;
  }
  return data;
}

export function cardLabelOf(pay) {
  const c = pay && pay.card;
  if (!c) return null;
  const issuer = c.issuerCode ? ISSUERS[c.issuerCode] || '' : '';
  const num = typeof c.number === 'string' ? c.number.slice(-4) : '';
  return [issuer, num ? `****${num}` : ''].filter(Boolean).join(' ') || null;
}

const ISSUERS = {
  '3K': '기업BC', '46': '광주', '71': '롯데', '30': '산업', '31': '비씨', '51': '삼성', '38': '새마을', '41': '신한',
  '62': '신협', '36': '씨티', '33': '우리', '37': '우체국', '39': '저축', '35': '전북', '42': '제주', '15': '카카오뱅크',
  '3A': '케이뱅크', '24': '토스뱅크', '21': '하나', '61': '현대', '11': 'KB국민', '91': 'NH농협', '34': '수협',
};
