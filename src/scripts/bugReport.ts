import { getLog } from './logger.ts';
import { getErroredFiles } from '../lib/erroredFiles.ts';
import { buildAnonMap } from '../lib/anonMap.ts';

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

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  submitBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Sending…';
  submitStatus.textContent = '';
  const includeFiles = filesCheckbox.checked;
  const anonMap = buildAnonMap(entries);
  const logText = entries
    .map(e => {
      const name = anonMap.get(e.filePath || e.fileName) ?? e.fileName;
      return `[${e.level.toUpperCase()}] ${name}: ${e.message}`;
    })
    .join('\n');

  const basePayload = {
    log: logText,
    platform: platformCheckbox.checked ? getPlatformInfo() : undefined,
    message: messageInput.value.trim() || undefined,
    email: emailInput.value.trim() || undefined,
  };

  let body: BodyInit;
  const headers: Record<string, string> = {};

  if (includeFiles) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(basePayload));
    for (const { file } of getErroredFiles()) {
      fd.append('files', file, file.name);
    }
    body = fd;
  } else {
    body = JSON.stringify(basePayload);
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch('/api/report', { method: 'POST', body, headers });
    if (res.ok) {
      submitStatus.textContent = 'Report sent — thank you!';
      submitStatus.className = 'text-xs text-success';
      submitBtn.textContent = 'Sent ✓';
    } else if (res.status === 429) {
      submitStatus.textContent = 'Too many requests — please wait a moment and try again.';
      submitStatus.className = 'text-xs text-error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send report';
    } else {
      submitStatus.textContent = `Failed (${res.status}).`;
      submitStatus.className = 'text-xs text-error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send report';
    }
  } catch {
    submitStatus.textContent = 'Network error — please try again.';
    submitStatus.className = 'text-xs text-error';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send report';
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
