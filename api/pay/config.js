// GET /api/pay/config — 결제 가능 여부·클라이언트 키·상품
import { json } from '../_kw-http.js';
import { PRODUCT, payEnabled, clientKey } from '../_kw-toss.js';
import { dbEnabled } from '../_kw-db.js';
export const config = { runtime: 'edge' };
export default async function handler() {
  const enabled = payEnabled() && dbEnabled();
  return json(200, { enabled, clientKey: enabled ? clientKey() : null, product: PRODUCT });
}
