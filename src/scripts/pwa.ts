interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const VISITS_KEY   = 'stripmeta-visits';
const DECLINED_KEY = 'stripmeta-install-declined';
const PROMPT_AFTER = 3;

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

type ManualPlatform = 'safari-ios' | 'firefox-android' | 'safari-macos';

// Browsers that support PWA install but not the beforeinstallprompt API.
function getManualInstallPlatform(): ManualPlatform | null {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) ||
    // iPadOS 13+ reports as macOS in the UA; distinguish via touch support.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isChromium = /Chrome\/|CriOS\/|Chromium\/|EdgA\//.test(ua);
  const isFirefox  = /Firefox\//.test(ua);
  const isSafari   = /Safari\//.test(ua) && !isChromium && !isFirefox;

  if (isIOS)                              return 'safari-ios';   // All iOS browsers use WebKit's share sheet
  if (/Android/.test(ua) && isFirefox)   return 'firefox-android';
  if (/Macintosh/.test(ua) && isSafari)  return 'safari-macos';
  return null;
}

// ── Update banner (standalone / installed PWA only) ───────────────────────────

if (isStandalone && 'serviceWorker' in navigator) {
  const toast   = document.getElementById('pwa-update-toast');
  const reload  = document.getElementById('pwa-update-reload');
  const dismiss = document.getElementById('pwa-update-dismiss');

  let waitingSW: ServiceWorker | null = null;

  function showUpdateBanner(sw: ServiceWorker) {
    waitingSW = sw;
    toast?.classList.remove('pwa-toast-hide');
    toast?.classList.add('pwa-toast-show');
  }

  function applyUpdate(sw: ServiceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    sw.postMessage({ type: 'SKIP_WAITING' });
  }

  navigator.serviceWorker.ready.then(reg => {
    // SW was already waiting on startup — apply silently, no toast.
    if (reg.waiting && navigator.serviceWorker.controller) applyUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(newSW);
      });
    });

    // Browser checks on every page load automatically; poll hourly for long sessions.
    setInterval(() => { if (navigator.onLine) reg.update(); }, 60 * 60 * 1000);
  });

  reload?.addEventListener('click', () => {
    if (waitingSW) applyUpdate(waitingSW);
  });

  dismiss?.addEventListener('click', () => {
    toast?.classList.add('pwa-toast-hide');
    toast?.addEventListener('animationend', () => toast.classList.remove('pwa-toast-show', 'pwa-toast-hide'), { once: true });
  });
}

// ── Install prompt (browser tab / not yet installed) ─────────────────────────

if (!isStandalone) {
  const visits = parseInt(localStorage.getItem(VISITS_KEY) ?? '0', 10) + 1;
  localStorage.setItem(VISITS_KEY, String(visits));

  const installBtn = document.getElementById('btn-pwa-install') as HTMLButtonElement | null;

  const manualPlatform = getManualInstallPlatform();

  if (manualPlatform && 'serviceWorker' in navigator) {
    // ── Manual install: Safari iOS / Firefox Android / Safari macOS ────────────
    // These browsers can install PWAs but don't fire beforeinstallprompt.
    // Show the install button immediately and open a how-to modal on click.
    const manualModal = document.getElementById('pwa-manual-modal') as HTMLDialogElement | null;
    manualModal?.querySelector<HTMLElement>(`[data-platform="${manualPlatform}"]`)?.classList.remove('hidden');
    installBtn?.classList.remove('hidden');
    installBtn?.addEventListener('click', () => manualModal?.showModal());

  } else if (!manualPlatform) {
    // ── Automated install: Chromium-based browsers (Chrome, Edge, Brave, …) ───
    let deferredPrompt: BeforeInstallPromptEvent | null = null;

    const modal         = document.getElementById('pwa-install-modal')  as HTMLDialogElement | null;
    const modalTitle    = document.getElementById('pwa-modal-title')    as HTMLElement       | null;
    const modalIntro    = document.getElementById('pwa-modal-intro')    as HTMLElement       | null;
    const promptInstall = document.getElementById('pwa-prompt-install') as HTMLButtonElement | null;
    const promptDismiss = document.getElementById('pwa-prompt-dismiss') as HTMLButtonElement | null;

    const modalText = {
      auto:   { title: "Oh, it's you again 👀",  intro: "I noticed you've dropped by a couple of times now. I wasn't going to say anything, but since we're basically old friends at this point —" },
      manual: { title: "Nice, let's do this 🙌", intro: "Bold move. Here's the deal:" },
    };

    function openModal(trigger: 'auto' | 'manual' = 'auto') {
      if (modalTitle) modalTitle.textContent = modalText[trigger].title;
      if (modalIntro) modalIntro.textContent = modalText[trigger].intro;
      modal?.showModal();
    }
    function closeModal() { modal?.close(); }

    async function triggerInstall() {
      if (!deferredPrompt) return;
      closeModal();
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn?.classList.add('hidden');
    }

    window.addEventListener('beforeinstallprompt', ((e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn?.classList.remove('hidden');
      if (localStorage.getItem(DECLINED_KEY) !== '1' && visits >= PROMPT_AFTER) {
        setTimeout(() => openModal('auto'), 1500);
      }
    }) as EventListener);

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installBtn?.classList.add('hidden');
      closeModal();
    });

    // Any close (✕, backdrop, or "No thanks") suppresses the auto-prompt permanently.
    modal?.addEventListener('close', () => localStorage.setItem(DECLINED_KEY, '1'));
    installBtn?.addEventListener('click', () => openModal('manual'));
    promptInstall?.addEventListener('click', triggerInstall);
    promptDismiss?.addEventListener('click', closeModal);
  }
}
