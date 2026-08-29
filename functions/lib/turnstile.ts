// Turnstile server-side verification. Split from the request handler so the
// outcomes — including the ones Cloudflare signals through a 200 body rather
// than an HTTP error — can be tested without standing up a Function.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Checks a Turnstile token against Cloudflare.
 *
 * `remoteIp` is optional and passed through when available; Cloudflare treats
 * it as a hint, not a requirement. `fetchImpl` exists for tests.
 */
export async function verifyTurnstile(
  token: string | undefined,
  secret: string,
  remoteIp?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'missing-input-response' };

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  let res: Response;
  try {
    res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body });
  } catch {
    return { ok: false, reason: 'network-error' };
  }

  if (!res.ok) return { ok: false, reason: `siteverify-http-${res.status}` };

  let json: SiteverifyResponse;
  try {
    json = await res.json() as SiteverifyResponse;
  } catch {
    return { ok: false, reason: 'siteverify-bad-json' };
  }

  // A rejected token still comes back 200; the verdict is in the body.
  if (!json.success) {
    return { ok: false, reason: json['error-codes']?.join(', ') || 'rejected' };
  }
  return { ok: true };
}
