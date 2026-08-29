import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile, parseHostnames } from '../functions/lib/turnstile';
import type { VerifyTurnstileOptions } from '../functions/lib/turnstile';

const ACTION = 'bug-report';
const HOSTS = ['stripmeta.info'];

/** A siteverify stub returning `body` with status 200 unless told otherwise. */
function respond(body: unknown, init: ResponseInit = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, ...init }));
}

/** A passing response, with the action and hostname the app expects. */
const accepted = { success: true, action: ACTION, hostname: HOSTS[0] };

function verify(over: Partial<VerifyTurnstileOptions> = {}) {
  return verifyTurnstile({
    token: 'tok',
    secret: 'sekrit',
    expectedAction: ACTION,
    expectedHostnames: HOSTS,
    fetchImpl: respond(accepted) as unknown as typeof fetch,
    ...over,
  });
}

describe('verifyTurnstile', () => {
  it('accepts a token Cloudflare says is good, for the right action and hostname', async () => {
    expect(await verify()).toEqual({ ok: true });
  });

  it('rejects an absent token without calling out at all', async () => {
    const fetchImpl = respond(accepted);
    expect(await verify({ token: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: 'missing-input-response' });
    expect((await verify({ token: '', fetchImpl: fetchImpl as unknown as typeof fetch })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an over-long token without calling out', async () => {
    const fetchImpl = respond(accepted);
    const result = await verify({ token: 'x'.repeat(2049), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'token-too-long' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when no hostname allowlist is configured', async () => {
    // Without this, a secret set but TURNSTILE_HOSTNAMES forgotten would accept
    // tokens minted on any site that embeds the sitekey.
    const fetchImpl = respond(accepted);
    const result = await verify({ expectedHostnames: [], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'no-hostname-allowlist' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a 200 with success:false as a rejection — the case that matters', async () => {
    // Cloudflare signals a bad token in the body, not the status code. Trusting
    // res.ok alone would let every invalid token through.
    const result = await verify({
      fetchImpl: respond({ success: false, 'error-codes': ['invalid-input-response'] }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-input-response' });
  });

  it('reports a replayed token, which Cloudflare flags rather than erroring', async () => {
    const result = await verify({
      fetchImpl: respond({ success: false, 'error-codes': ['timeout-or-duplicate'] }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'timeout-or-duplicate' });
  });

  it('rejects a token minted for a different action', async () => {
    const result = await verify({
      fetchImpl: respond({ ...accepted, action: 'signup' }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'unexpected-action:signup' });
  });

  it('rejects a token minted on a hostname that is not ours', async () => {
    // The attack this closes: the sitekey is public, so anyone can embed the
    // widget on their own page — only the hostname check stops those tokens.
    const result = await verify({
      fetchImpl: respond({ ...accepted, hostname: 'evil.example' }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'unexpected-hostname:evil.example' });
  });

  it('rejects a response carrying no hostname at all', async () => {
    const result = await verify({
      fetchImpl: respond({ success: true, action: ACTION }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'unexpected-hostname:none' });
  });

  it('accepts any hostname on the allowlist', async () => {
    const result = await verify({
      expectedHostnames: ['stripmeta.info', 'www.stripmeta.info'],
      fetchImpl: respond({ ...accepted, hostname: 'www.stripmeta.info' }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
  });

  it('falls back to a generic reason when a failure carries no codes', async () => {
    expect(await verify({ fetchImpl: respond({ success: false }) as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: 'rejected' });
  });

  it('rejects on a non-200 from siteverify', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await verify({ fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: 'siteverify-http-500' });
  });

  it('rejects rather than throwing when the network fails or times out', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await verify({ fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: 'network-error' });
  });

  it('gives up rather than hanging the report when siteverify never answers', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    const result = await verify({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });
    expect(result).toEqual({ ok: false, reason: 'network-error' });
  });

  it('rejects rather than throwing on an unparseable body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(await verify({ fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: 'siteverify-bad-json' });
  });

  it('posts form-encoded credentials, with the client IP when known', async () => {
    const fetchImpl = respond(accepted);
    await verify({ remoteIp: '203.0.113.7', fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(String(init.body));
    expect(body.get('secret')).toBe('sekrit');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it('omits remoteip when the header was absent', async () => {
    const fetchImpl = respond(accepted);
    await verify({ remoteIp: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = new URLSearchParams(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.has('remoteip')).toBe(false);
  });
});

describe('parseHostnames', () => {
  it('splits, trims and drops blanks', () => {
    expect(parseHostnames(' stripmeta.info , www.stripmeta.info ,, ')).toEqual(['stripmeta.info', 'www.stripmeta.info']);
  });

  it('yields nothing for unset or empty, so verification fails closed', () => {
    expect(parseHostnames(undefined)).toEqual([]);
    expect(parseHostnames('')).toEqual([]);
    expect(parseHostnames('   ')).toEqual([]);
  });
});
