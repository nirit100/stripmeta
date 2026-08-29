import { getLog } from '../lib/state/logger.ts';
import { getErroredFiles } from '../lib/state/erroredFiles.ts';
import { buildAnonMap } from '../lib/domain/anonMap.ts';
import { settings } from '../lib/state/settings.ts';
import { formatBytes } from '../lib/util/format.ts';
import { REPORT_LIMITS, clampField } from '../../shared/bugReport.ts';
import type { BugReportPayload } from '../../shared/bugReport.ts';

const modal = document.getElementById('bug-report-modal') as HTMLDialogElement | null;
const logPreview = document.getElementById('bug-log-preview') as HTMLElement;
const platformCheckbox = document.getElementById('bug-include-platform') as HTMLInputElement;
const platformPreview = document.getElementById('bug-platform-preview') as HTMLElement;
const filesSection = document.getElementById('bug-files-section') as HTMLElement;
const filesCheckbox = document.getElementById('bug-include-files') as HTMLInputElement;
const filesInfo = document.getElementById('bug-files-info') as HTMLElement;
const messageInput = document.getElementById('bug-message') as HTMLTextAreaElement;
const emailInput = document.getElementById('bug-email') as HTMLInputElement;
const submitBtn = document.getElementById('btn-bug-submit') as HTMLButtonElement;
const submitStatus = document.getElementById('bug-submit-status') as HTMLElement;
const messageOptional = document.getElementById('bug-message-optional') as HTMLElement;
const settingsPreview = document.getElementById('bug-settings-preview') as HTMLElement;

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// — Turnstile —
//
// Loaded at the moment Send is pressed, not on page load and not when this
// modal opens. Someone who opens the report screen and closes it again fetches
// nothing from Cloudflare; the stripping flow — which is the whole app for
// almost everyone — never touches it at all. With no sitekey configured none of
// this runs.

interface TurnstileApi {
  render(el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }): string;
  reset(widgetId: string): void;
}

/** Interactive challenges are rare, but a person has to have time to solve one. */
const TURNSTILE_TIMEOUT_MS = 60_000;

const turnstileHost = document.getElementById('bug-turnstile');
let turnstileWidgetId: string | null = null;
let turnstileScript: Promise<void> | null = null;
let tokenWaiters: ((token: string | null) => void)[] = [];

function turnstileSitekey(): string | undefined {
  return turnstileHost?.dataset.sitekey || undefined;
}

function settleToken(token: string | null): void {
  const waiters = tokenWaiters;
  tokenWaiters = [];
  for (const resolve of waiters) resolve(token);
}

function loadTurnstileScript(): Promise<void> {
  turnstileScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { turnstileScript = null; reject(new Error('script blocked')); };
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/**
 * Fetches the widget if this is the first submit, then resolves with a fresh
 * token. Tokens are single-use, so every submit asks for a new one. Throws with
 * a message fit to show the user.
 */
async function getTurnstileToken(): Promise<string> {
  const sitekey = turnstileSitekey();
  if (!sitekey || !turnstileHost) throw new Error('The bot check is not configured.');

  try {
    await loadTurnstileScript();
  } catch {
    throw new Error('Could not load the bot check — it may be blocked by an extension or your network.');
  }

  const turnstile = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (!turnstile) throw new Error('Could not start the bot check.');

  const pending = new Promise<string | null>(resolve => tokenWaiters.push(resolve));

  if (turnstileWidgetId === null) {
    turnstileWidgetId = turnstile.render(turnstileHost, {
      sitekey,
      callback: token => settleToken(token),
      'expired-callback': () => settleToken(null),
      'error-callback': () => settleToken(null),
    });
  } else {
    turnstile.reset(turnstileWidgetId);
  }

  const token = await Promise.race([
    pending,
    new Promise<null>(resolve => setTimeout(() => resolve(null), TURNSTILE_TIMEOUT_MS)),
  ]);

  if (!token) throw new Error('The bot check did not complete — please try again.');
  return token;
}

/** Drops the used widget state so a retry starts a fresh check. */
function resetTurnstile(): void {
  const turnstile = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (turnstile && turnstileWidgetId !== null) turnstile.reset(turnstileWidgetId);
}

function getSettingsAndStats(): string {
  const on = (v: boolean) => v ? 'on' : 'off';
  const lines = [
    `Version: ${__APP_VERSION__}`,
    '',
    '— Settings —',
    `Paranoid mode: ${on(settings.paranoid)}`,
    `Process clean files: ${on(!settings.skipClean)}`,
    `Process experimental files: ${on(!settings.skipExperimental)}`,
    `Try unsupported files: ${on(!settings.skipUnsupported)}`,
    `Include skipped in output: ${on(settings.includeSkipped)}`,
    `Warn on unload: ${on(settings.warnUnload)}`,
    `Auto-show results: ${on(settings.autoAbout)}`,
    `Persist settings: ${on(settings.persist)}`,
  ];
  const raw = localStorage.getItem('stripmeta:stats_v1');
  if (raw) {
    try {
      const s = JSON.parse(raw) as Record<string, unknown>;
      lines.push('', '— Stats —');
      if (s.filesProcessed) lines.push(`Files processed: ${s.filesProcessed}`);
      if (s.gpsRemoved)     lines.push(`GPS removed: ${s.gpsRemoved}`);
      if (s.datesRemoved)   lines.push(`Timestamps removed: ${s.datesRemoved}`);
      if (s.bytesStripped)  lines.push(`Data stripped: ${formatBytes(Number(s.bytesStripped))}`);
      if (s.date)           lines.push(`Last run: ${new Date(s.date as string).toLocaleDateString()}`);
    } catch { /* no stats */ }
  }
  return lines.join('\n');
}

function getPlatformInfo(): string {
  const lines = [
    `UA: ${navigator.userAgent}`,
    `Platform: ${navigator.platform}`,
    `Screen: ${screen.width}×${screen.height} @ ${window.devicePixelRatio}x`,
    `Language: ${navigator.language}`,
    `Cores: ${navigator.hardwareConcurrency}`,
  ];
  const mem = (navigator as unknown as Record<string, unknown>).deviceMemory;
  if (mem) lines.push(`Memory: ${mem} GB`);
  return lines.join('\n');
}

function populate() {
  const entries = getLog();
  logPreview.innerHTML = '';
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'text-base-content/30 italic';
    li.textContent = 'No errors logged.';
    logPreview.appendChild(li);
  } else {
    const anonMap = buildAnonMap(entries);
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = e.level === 'error' ? 'text-error/70' : 'text-warning/70';
      const name = anonMap.get(e.filePath || e.fileName) ?? e.fileName;
      li.innerHTML = `<span class="shrink-0 mr-1.5">${e.level === 'error' ? '✗' : '⚠'}</span><span class="break-all">${escHtml(name)}: ${escHtml(e.message)}</span>`;
      logPreview.appendChild(li);
    }
  }

  settingsPreview.textContent = getSettingsAndStats();
  platformPreview.textContent = getPlatformInfo();
  platformPreview.style.display = '';

  const erroredFiles = getErroredFiles();
  if (erroredFiles.length > 0) {
    filesSection.classList.remove('hidden');
    const totalBytes = erroredFiles.reduce((s, f) => s + f.file.size, 0);
    const sizeStr = totalBytes < 1024 * 1024
      ? `${(totalBytes / 1024).toFixed(1)} KB`
      : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
    const names = erroredFiles.map(f => f.path || f.file.name).join(', ');
    filesInfo.textContent = `${erroredFiles.length} file${erroredFiles.length !== 1 ? 's' : ''} · ${sizeStr}: ${names}`;
  } else {
    filesSection.classList.add('hidden');
    filesCheckbox.checked = false;
  }

  messageOptional.style.display = entries.length === 0 ? 'none' : '';

  submitStatus.textContent = '';
  submitStatus.className = 'text-xs';
  submitBtn.disabled = false;
  submitBtn.textContent = 'Send report';
}

async function submit() {
  const entries = getLog();
  if (entries.length === 0 && !messageInput.value.trim()) {
    submitStatus.textContent = 'Please describe the issue — no error log is available.';
    submitStatus.className = 'text-xs text-error';
    messageInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitStatus.textContent = '';
  submitStatus.className = 'text-xs';

  // The one moment anything is fetched from Cloudflare.
  let turnstileToken: string | undefined;
  if (turnstileSitekey()) {
    submitBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Checking…';
    try {
      turnstileToken = await getTurnstileToken();
    } catch (err) {
      submitStatus.textContent = err instanceof Error ? err.message : 'The bot check failed.';
      submitStatus.className = 'text-xs text-error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send report';
      return;
    }
  }

  submitBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Sending…';
  const includeFiles = filesCheckbox.checked;
  const anonMap = buildAnonMap(entries);
  const logText = entries
    .map(e => {
      const name = anonMap.get(e.filePath || e.fileName) ?? e.fileName;
      return `[${e.level.toUpperCase()}] ${name}: ${e.message}`;
    })
    .join('\n');

  const basePayload: BugReportPayload = {
    log: clampField(logText),
    settingsAndStats: clampField(getSettingsAndStats()),
    platform: platformCheckbox.checked ? clampField(getPlatformInfo()) : undefined,
    message: messageInput.value.trim() || undefined,
    email: emailInput.value.trim() || undefined,
    turnstileToken,
  };

  let body: BodyInit;
  const headers: Record<string, string> = {};

  if (includeFiles) {
    const files = getErroredFiles();
    const totalBytes = files.reduce((n, f) => n + f.file.size, 0);
    // Check here so an oversize report says why, rather than coming back a 413.
    if (files.length > REPORT_LIMITS.maxAttachments || totalBytes > REPORT_LIMITS.maxAttachmentBytes) {
      submitStatus.textContent = `Too much to attach (${files.length} files, ${formatBytes(totalBytes)}). `
        + `The limit is ${REPORT_LIMITS.maxAttachments} files and ${formatBytes(REPORT_LIMITS.maxAttachmentBytes)} — `
        + 'please untick "include files" and describe the problem instead.';
      submitStatus.className = 'text-xs text-error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send report';
      return;
    }
    const fd = new FormData();
    fd.append('payload', JSON.stringify(basePayload));
    for (const { file } of files) {
      fd.append('files', file, file.name);
    }
    body = fd;
  } else {
    body = JSON.stringify(basePayload);
    headers['Content-Type'] = 'application/json';
  }

  /** A token is spent whether or not the send worked, so a retry needs a new one. */
  function allowRetry(message: string): void {
    submitStatus.textContent = message;
    submitStatus.className = 'text-xs text-error';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send report';
    resetTurnstile();
  }

  try {
    const res = await fetch('/api/report', { method: 'POST', body, headers });
    if (res.ok) {
      submitStatus.textContent = 'Report sent — thank you!';
      submitStatus.className = 'text-xs text-success';
      submitBtn.textContent = 'Sent ✓';
    } else if (res.status === 429) {
      allowRetry('Too many requests — please wait a moment and try again.');
    } else if (res.status === 413) {
      allowRetry('The report was too large to send — try again without attaching files.');
    } else if (res.status === 403) {
      allowRetry('The bot check was rejected — please try again.');
    } else {
      allowRetry(`Failed (${res.status}).`);
    }
  } catch {
    allowRetry('Network error — please try again.');
  }
}

export function openBugReport() {
  populate();
  modal?.showModal();
}

submitBtn?.addEventListener('click', submit);

platformCheckbox?.addEventListener('change', () => {
  platformPreview.style.display = platformCheckbox.checked ? '' : 'none';
});

document.querySelectorAll<HTMLElement>('.js-open-bug-report').forEach(el => {
  el.addEventListener('click', openBugReport);
});
