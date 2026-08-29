import { describe, it, expect, vi } from 'vitest';
import { verifyTurnstile } from '../functions/lib/turnstile';

function respond(body: unknown, init: ResponseInit = {}): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch;
}

describe('verifyTurnstile', () => {
  it('accepts a token Cloudflare says is good', async () => {
    expect(await verifyTurnstile('tok', 'secret', null, respond({ success: true })))
      .toEqual({ ok: true });
  });

  it('rejects an absent token without calling out at all', async () => {
    const fetchImpl = respond({ success: true });
    expect(await verifyTurnstile(undefined, 'secret', null, fetchImpl))
      .toEqual({ ok: false, reason: 'missing-input-response' });
    expect((await verifyTurnstile('', 'secret', null, fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a 200 with success:false as a rejection — the case that matters', async () => {
    // Cloudflare signals a bad token in the body, not the status code. Trusting
    // res.ok alone would let every invalid token through.
    const result = await verifyTurnstile('tok', 'secret', null,
      respond({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(result).toEqual({ ok: false, reason: 'invalid-input-response' });
  });

  it('joins multiple error codes into the reason', async () => {
    const result = await verifyTurnstile('tok', 'secret', null,
      respond({ success: false, 'error-codes': ['timeout-or-duplicate', 'bad-request'] }));
    expect(result).toEqual({ ok: false, reason: 'timeout-or-duplicate, bad-request' });
  });

  it('falls back to a generic reason when no codes are given', async () => {
    expect(await verifyTurnstile('tok', 'secret', null, respond({ success: false })))
      .toEqual({ ok: false, reason: 'rejected' });
  });

  it('rejects on a non-200 from siteverify', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await verifyTurnstile('tok', 'secret', null, fetchImpl))
      .toEqual({ ok: false, reason: 'siteverify-http-500' });
  });

  it('rejects rather than throwing when the network fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await verifyTurnstile('tok', 'secret', null, fetchImpl))
      .toEqual({ ok: false, reason: 'network-error' });
  });

  it('rejects rather than throwing on an unparseable body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await verifyTurnstile('tok', 'secret', null, fetchImpl))
      .toEqual({ ok: false, reason: 'siteverify-bad-json' });
  });

  it('sends the secret and token, and the client IP when known', async () => {
    const fetchImpl = respond({ success: true });
    await verifyTurnstile('tok', 'sekrit', '203.0.113.7', fetchImpl);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('secret')).toBe('sekrit');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it('omits remoteip when the header was absent', async () => {
    const fetchImpl = respond({ success: true });
    await verifyTurnstile('tok', 'sekrit', null, fetchImpl);
    const body = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    expect(body.get('remoteip')).toBeNull();
  });
});
