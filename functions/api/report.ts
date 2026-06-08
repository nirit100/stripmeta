/// <reference path="../../worker-configuration.d.ts" />

import { sendBugReport } from '../lib/email.ts';

interface Payload {
  log?: string;
  platform?: string;
  message?: string;
  email?: string;
}

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
  let payload: Payload;
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
      payload = JSON.parse(raw) as Payload;
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    for (const [key, val] of fd.entries()) {
      if (key === 'files' && val instanceof File) {
        attachments.push({
          content: bufferToBase64(await val.arrayBuffer()),
          filename: sanitizeFilename(val.name),
          type: val.type || 'application/octet-stream',
        });
      }
    }
  } else {
    try {
      payload = (await request.json()) as Payload;
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  }

  const sections: string[] = [];
  if (payload.message)  sections.push(`Message:\n${payload.message}`);
  if (payload.log)      sections.push(`Error log:\n${payload.log}`);
  if (payload.platform) sections.push(`Platform:\n${payload.platform}`);
  if (attachments.length > 0) sections.push(`Attached files: ${attachments.map(a => a.filename).join(', ')}`);

  try {
    await sendBugReport(
      { text: sections.join('\n\n---\n\n'), replyTo: payload.email, attachments },
      env
    );
  } catch (err) {
    console.error(err);
    return new Response('Delivery failed', { status: 502 });
  }

  return new Response('ok', { status: 200 });
}
