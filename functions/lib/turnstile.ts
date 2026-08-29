// Turnstile server-side verification, following Cloudflare's siteverify contract.
//
// Split from the request handler so every outcome can be tested without standing
// up a Function — including the ones Cloudflare signals through a 200 body
// rather than an HTTP error, which is the trap here: trusting `res.ok` alone
// would let every invalid token through.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SiteverifyResponse {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface VerifyTurnstileOptions {
  token: string | undefined;
  secret: string;
  /** The action the widget was rendered with; a token claiming another is refused. */
  expectedAction: string;
  /** Hostnames a token may have been minted on. Empty means refuse everything. */
  expectedHostnames: readonly string[];
  remoteIp?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Splits the comma-separated TURNSTILE_HOSTNAMES value. */
export function parseHostnames(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(h => h.trim()).filter(Boolean);
}

export async function verifyTurnstile(options: VerifyTurnstileOptions): Promise<VerifyResult> {
  const {
    token, secret, expectedAction, expectedHostnames,
    remoteIp = null, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing-input-response' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'token-too-long' };

  // Fail closed: with no allowlist configured, a token minted on any site that
  // embeds this sitekey would otherwise be accepted.
  if (expectedHostnames.length === 0) return { ok: false, reason: 'no-hostname-allowlist' };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  let res: Response;
  try {
    res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(timeoutMs),
      body,
    });
  } catch {
    // Includes the timeout: a hanging siteverify must not hang the report.
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
  if (json.action !== expectedAction) {
    return { ok: false, reason: `unexpected-action:${json.action ?? 'none'}` };
  }
  if (!json.hostname || !expectedHostnames.includes(json.hostname)) {
    // Stops someone embedding this sitekey on their own page and replaying the
    // tokens it mints against this endpoint.
    return { ok: false, reason: `unexpected-hostname:${json.hostname ?? 'none'}` };
  }
  return { ok: true };
}
