/// <reference path="../../worker-configuration.d.ts" />

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

export async function onRequestPost(ctx: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = ctx;

  if (!env.EMAIL || !env.BUG_REPORT_TO || !env.BUG_REPORT_FROM) {
    return new Response('Not configured', { status: 503 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  let payload: Payload;
  const attachments: NonNullable<Parameters<SendEmail['send']>[0]['attachments']> = [];

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
          content: await val.arrayBuffer(),
          filename: sanitizeFilename(val.name),
          type: val.type || 'application/octet-stream',
          disposition: 'attachment',
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

  const text = sections.join('\n\n---\n\n');

  try {
    await env.EMAIL.send({
      to: env.BUG_REPORT_TO,
      from: { email: env.BUG_REPORT_FROM, name: 'StripMeta Bug Reports' },
      ...(payload.email ? { replyTo: payload.email } : {}),
      subject: 'StripMeta Bug Report',
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  } catch (err) {
    console.error('Email send failed:', err);
    return new Response('Delivery failed', { status: 502 });
  }

  return new Response('ok', { status: 200 });
}
