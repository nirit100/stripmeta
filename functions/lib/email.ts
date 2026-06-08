// Cloudflare Email Service (REST API) — swap this file to use a different provider.
// Required env vars: EMAIL_CF_API_TOKEN, EMAIL_CF_ACCOUNT_ID, BUG_REPORT_FROM, BUG_REPORT_TO

export interface BugReportEmail {
  text: string;
  replyTo?: string;
  attachments?: { filename: string; content: string; type: string }[];
}

export async function sendBugReport(
  report: BugReportEmail,
  env: { EMAIL_CF_API_TOKEN: string; EMAIL_CF_ACCOUNT_ID: string; BUG_REPORT_FROM: string; BUG_REPORT_TO: string }
): Promise<void> {
  const body: Record<string, unknown> = {
    to: env.BUG_REPORT_TO,
    from: { address: env.BUG_REPORT_FROM, name: 'StripMeta Bug Reports' },
    subject: 'StripMeta Bug Report',
    text: report.text,
    ...(report.replyTo ? { reply_to: report.replyTo } : {}),
    ...(report.attachments?.length ? {
      attachments: report.attachments.map(a => ({
        content: a.content,
        filename: a.filename,
        type: a.type,
        disposition: 'attachment',
      })),
    } : {}),
  };

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.EMAIL_CF_ACCOUNT_ID}/email/sending/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  const json = await res.json() as {
    success: boolean;
    errors: { code: number; message: string }[];
    result: { delivered: string[]; permanent_bounces: string[]; queued: string[] } | null;
  };

  if (!res.ok || !json.success) {
    const detail = json.errors?.map(e => `${e.code}: ${e.message}`).join(', ') ?? res.status;
    throw new Error(`Email delivery failed: ${detail}`);
  }

  if (json.result?.permanent_bounces?.length) {
    throw new Error(`Email permanently bounced for: ${json.result.permanent_bounces.join(', ')}`);
  }
}
