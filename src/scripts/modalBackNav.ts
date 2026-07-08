// Makes the browser's Back button close an open <dialog> instead of navigating
// away — for every modal in the app, without each modal's own script knowing
// about this. Patches HTMLDialogElement.prototype.showModal once, globally.
//
// If several dialogs happen to be open at once, Back closes only the
// top-most (most recently opened) one; a further Back press closes the next,
// and only once none are left does Back actually navigate.
//
// Each showModal() pushes a same-URL history entry so Back has something of
// ours to consume first. If the dialog is later closed some other way (✕,
// backdrop, Escape, code) that entry would otherwise linger — a wasted extra
// Back press to leave the page — so we walk it back off the stack ourselves.

const stack: HTMLDialogElement[] = [];

// True only for the one 'close' event we're expecting as a *result* of the
// popstate handler below calling .close() — that history entry is already
// gone (the browser consumed it to fire popstate), so onClose must not also
// call history.back() for it.
let closingFromPopstate = false;

const nativeShowModal = HTMLDialogElement.prototype.showModal;

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  nativeShowModal.call(this);
  stack.push(this);
  history.pushState({ stripmetaModal: true }, '');
  this.addEventListener('close', onClose, { once: true });
};

function onClose(this: HTMLDialogElement): void {
  const idx = stack.lastIndexOf(this);
  if (idx === -1) return;
  stack.splice(idx, 1);

  if (closingFromPopstate) { closingFromPopstate = false; return; }
  history.back();
}

window.addEventListener('popstate', () => {
  const top = stack[stack.length - 1];
  if (!top?.open) return; // no modal open — let the real back navigation proceed

  closingFromPopstate = true;
  top.close();
});

export {};
