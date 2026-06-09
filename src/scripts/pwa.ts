interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const VISITS_KEY  = 'stripmeta-visits';
const DECLINED_KEY = 'stripmeta-install-declined';
const PROMPT_AFTER = 3;

// Already running as an installed PWA — nothing to do.
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

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
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'dismissed') localStorage.setItem(DECLINED_KEY, '1');
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

  // Navbar button opens the modal; the modal's Install button triggers the browser prompt.
  installBtn?.addEventListener('click', () => openModal('manual'));
  promptInstall?.addEventListener('click', triggerInstall);
  promptDismiss?.addEventListener('click', () => {
    closeModal();
    localStorage.setItem(DECLINED_KEY, '1');
  });
}
