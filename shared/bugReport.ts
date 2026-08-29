/**
 * The bug report contract, shared by the browser form and the Pages Function.
 *
 * These were previously two independent shapes. The form sent a
 * `settingsAndStats` field, showed it to the user in the consent preview, and
 * the Function — which never declared it — dropped it silently. One declaration
 * imported by both ends makes that class of drift a type error.
 */

export interface BugReportPayload {
  log?: string;
  settingsAndStats?: string;
  platform?: string;
  message?: string;
  email?: string;
  /** Turnstile token, when the widget is configured. */
  turnstileToken?: string;
}

/**
 * The Turnstile action label for this surface. Rendered on the widget and
 * checked against the verified token, so a token minted for some other action
 * cannot be spent here.
 */
export const TURNSTILE_ACTION = 'bug-report';

/** Caps on what a single report may carry. Enforced on the server; previewed on the client. */
export const REPORT_LIMITS = {
  /** Attached files, which are the user's own failed images. */
  maxAttachments: 10,
  /** Total attachment bytes across the report. */
  maxAttachmentBytes: 8 * 1024 * 1024,
  /** Per text field, so a runaway log can't fill an inbox. */
  maxFieldChars: 20_000,
} as const;

/**
 * A permissive sanity check for the optional reply-to address.
 *
 * The value reaches the mail API as JSON, so this is not about header
 * injection; it is about not handing the provider something that will bounce,
 * and not echoing arbitrary text into an email header field.
 */
export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>,;:"'\\]+@[^\s@<>,;:"'\\]+\.[A-Za-z]{2,}$/.test(value);
}

/** Truncates a field to the shared limit, marking it when shortened. */
export function clampField(value: string): string {
  if (value.length <= REPORT_LIMITS.maxFieldChars) return value;
  return value.slice(0, REPORT_LIMITS.maxFieldChars) + '\n… (truncated)';
}
