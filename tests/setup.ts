// Node 22+ defines a global `localStorage` getter that, without a
// --localstorage-file flag, shadows happy-dom's own localStorage and leaves
// the global `localStorage` undefined. Rebind it to a real Storage instance
// (from a dedicated happy-dom Window, since `window.localStorage` in this
// environment resolves back through the same global getter we're replacing).
import { Window } from 'happy-dom';

const storageWindow = new Window();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  get: () => storageWindow.localStorage,
});
