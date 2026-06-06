const ABOUT_KEY = 'stripmeta:about_shown_v1';

const modal = document.getElementById('about-modal') as HTMLDialogElement | null;
const btnAbout = document.getElementById('btn-about-footer') as HTMLButtonElement | null;

function showAbout(auto = false) {
  if (!modal) return;
  if (auto && localStorage.getItem(ABOUT_KEY)) return;
  try {
    modal.showModal();
    if (auto) localStorage.setItem(ABOUT_KEY, '1');
  } catch (e) {
    // ignore
  }
}

// Show after first successful processing
window.addEventListener('stripmeta:processed', () => showAbout(true), { once: true });

// Footer about button always opens the modal
btnAbout?.addEventListener('click', () => showAbout(false));

export {};
