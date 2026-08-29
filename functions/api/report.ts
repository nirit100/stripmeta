import { sendBugReport } from '../lib/email.ts';
import { verifyTurnstile } from '../lib/turnstile.ts';
import { REPORT_LIMITS, isPlausibleEmail, clampField } from '../../shared/bugReport.ts';
import type { BugReportPayload } from '../../shared/bugReport.ts';

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^\w\s.\-]/g, '_').trim().replace(/\s+/g, ' ').replace(/_+/g, '_').slice(0, 100);
  return clean || 'file';
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function onRequestPost(ctx: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = ctx;

  if (!env.EMAIL_CF_API_TOKEN || !env.EMAIL_CF_ACCOUNT_ID || !env.BUG_REPORT_TO || !env.BUG_REPORT_FROM) {
    return new Response('Not configured', { status: 503 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  let payload: BugReportPayload;
  const attachments: { filename: string; content: string; type: string }[] = [];

  if (contentType.includes('multipart/form-data')) {
    let fd: FormData;
    try {
      fd = await request.formData();
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const raw = fd.get('payload');
    if (typeof raw !== 'string') return new Response('Bad request', { status: 400 });
    try {
      payload = JSON.parse(raw) as BugReportPayload;
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const files = [...fd.entries()].filter(([key, val]) => key === 'files' && val instanceof File)
      .map(([, val]) => val as File);

    if (files.length > REPORT_LIMITS.maxAttachments) {
      return new Response('Too many attachments', { status: 413 });
    }
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    if (totalBytes > REPORT_LIMITS.maxAttachmentBytes) {
      return new Response('Attachments too large', { status: 413 });
    }

    for (const file of files) {
      attachments.push({
        content: bufferToBase64(await file.arrayBuffer()),
        filename: sanitizeFilename(file.name),
        type: file.type || 'application/octet-stream',
      });
    }
  } else {
    try {
      payload = (await request.json()) as BugReportPayload;
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  }

  const field = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? clampField(v) : null;

  const sections: string[] = [];
  const message  = field(payload.message);
  const log      = field(payload.log);
  const settings = field(payload.settingsAndStats);
  const platform = field(payload.platform);

  if (message)  sections.push(`Message:\n${message}`);
  if (log)      sections.push(`Error log:\n${log}`);
  if (settings) sections.push(`Settings and stats:\n${settings}`);
  if (platform) sections.push(`Platform:\n${platform}`);
  if (attachments.length > 0) sections.push(`Attached files: ${attachments.map(a => a.filename).join(', ')}`);

  if (sections.length === 0) return new Response('Bad request', { status: 400 });

  // Enforced only once a secret is configured, so an unconfigured deployment
  // and local dev keep working without a widget.
  if (env.TURNSTILE_SECRET) {
    const verdict = await verifyTurnstile(
      payload.turnstileToken,
      env.TURNSTILE_SECRET,
      request.headers.get('CF-Connecting-IP'),
    );
    if (!verdict.ok) {
      console.warn('[turnstile]', verdict.reason);
      return new Response('Verification failed', { status: 403 });
    }
  }

  // Only pass on an address that could actually receive a reply.
  const replyTo = typeof payload.email === 'string' && isPlausibleEmail(payload.email.trim())
    ? payload.email.trim()
    : undefined;

  try {
    await sendBugReport(
      { text: sections.join('\n\n---\n\n'), replyTo, attachments },
      env
    );
  } catch (err) {
    console.error(err);
    return new Response('Delivery failed', { status: 502 });
  }

  return new Response('ok', { status: 200 });
}
