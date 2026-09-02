export interface KwUserSession {
  uid: number;
  email: string;
  name: string;
  picture: string;
  plan: string;
  until: number;
  iat: number;
  exp: number;
}
export function issueUserSessionToken(user: {
  id: number | string; email: string; name?: string; picture?: string; plan?: string;
  liveUntil?: number | string | Date | null;
}): Promise<{ token: string; exp: number; payload: KwUserSession }>;
export function verifyUserSessionToken(token: string): Promise<KwUserSession | null>;
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null;
export function readUserSession(req: Request | { headers: Headers | Record<string, string> }): Promise<KwUserSession | null>;
export function sessionHasLiveAccess(session: KwUserSession | null, nowMs?: number): boolean;
export function gateDisabled(): boolean;
export function resolveDataMode(req: Request | { headers: Headers | Record<string, string> }): Promise<'live' | 'demo'>;
export function userSessionSetCookie(token: string, opts?: { maxAgeSeconds?: number; secure?: boolean }): string;
export function userSessionClearCookie(): string;
export const KW_USER_COOKIE: string;
export const KW_USER_SESSION_TTL_MS: number;
