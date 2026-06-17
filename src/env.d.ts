/// <reference types="astro/client" />

declare const __APP_VERSION__: string;

// Non-standard but widely-supported attribute for directory picking; not in
// Astro's built-in InputHTMLAttributes. Used by #dir-input in index.astro.
declare namespace astroHTML.JSX {
  interface InputHTMLAttributes {
    webkitdirectory?: boolean;
  }
}
