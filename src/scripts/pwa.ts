interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const VISITS_KEY  = 'stripmeta-visits';
const DECLINED_KEY = 'stripmeta-install-declined';
const PROMPT_AFTER = 3;

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// Update banner — only relevant when running as an installed PWA.
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

  navigator.serviceWorker.ready.then(reg => {
    // Already waiting when the page loaded (e.g. user refreshed mid-update).
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner(reg.waiting);
    }

    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(newSW);
        }
      });
    });

    // Browser checks on every page load automatically; poll hourly for long sessions.
    setInterval(() => { if (navigator.onLine) reg.update(); }, 60 * 60 * 1000);
  });

  reload?.addEventListener('click', () => {
    if (!waitingSW) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    waitingSW.postMessage({ type: 'SKIP_WAITING' });
  });

  dismiss?.addEventListener('click', () => {
    toast?.classList.add('pwa-toast-hide');
    toast?.addEventListener('animationend', () => toast.classList.remove('pwa-toast-show', 'pwa-toast-hide'), { once: true });
  });
}

if (!isStandalone) {
  const visits = parseInt(localStorage.getItem(VISITS_KEY) ?? '0', 10) + 1;
  localStorage.setItem(VISITS_KEY, String(visits));

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  const installBtn    = document.getElementById('btn-pwa-install')    as HTMLButtonElement | null;
  const modal         = document.getElementById('pwa-install-modal')  as HTMLDialogElement | null;
  const modalTitle    = document.getElementById('pwa-modal-title')    as HTMLElement       | null;
  const modalIntro    = document.getElementById('pwa-modal-intro')    as HTMLElement       | null;
  const promptInstall = document.getElementById('pwa-prompt-install') as HTMLButtonElement | null;
  const promptDismiss = document.getElementById('pwa-prompt-dismiss') as HTMLButtonElement | null;

  const modalText = {
    auto:   { title: "Oh, it's you again 👀",   intro: "I noticed you've dropped by a couple of times now. I wasn't going to say anything, but since we're basically old friends at this point —" },
    manual: { title: "Nice, let's do this 🙌",  intro: "Bold move. Here's the deal:" },
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

    const declined = localStorage.getItem(DECLINED_KEY) === '1';
    if (!declined && visits >= PROMPT_AFTER) {
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

  // Navbar button opens the modal; the modal's Install button triggers the browser prompt.
  installBtn?.addEventListener('click', () => openModal('manual'));
  promptInstall?.addEventListener('click', triggerInstall);
  promptDismiss?.addEventListener('click', closeModal);
}
