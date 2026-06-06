# StripMeta

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Built with Astro](https://img.shields.io/badge/Built%20with-Astro-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![Live site](https://img.shields.io/badge/Live%20site-stripmeta.info-brightgreen)](https://stripmeta.info)
[![Cloudflare Pages](https://img.shields.io/endpoint?url=https://cloudflare-pages-status-badge.nico-rittinghaus.workers.dev/?projectName=stripmeta&branch=main&showEnv=true)](https://stripmeta.info)

Remove EXIF and other embedded metadata from photos — entirely in your browser. Nothing is ever uploaded anywhere.

## What it does

Photos taken with phones and cameras carry hidden metadata: GPS coordinates, device serial numbers, camera make and model, timestamps, software signatures, and more. StripMeta removes all of it before you share an image.

**Supported formats:**

| Format | Method | Quality |
|--------|--------|---------|
| JPEG | Strips EXIF segments from the binary — image data untouched | Lossless |
| PNG | Removes metadata chunks (`tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME`) | Lossless |
| WebP | Removes `EXIF` and `XMP` chunks from the RIFF container | Lossless |
| GIF, BMP, AVIF, TIFF, SVG | Re-encodes through canvas as JPEG 95% | Lossy |

Files are identified by their actual content (magic bytes), not by filename or MIME type — so a JPEG saved with a `.png` extension is still stripped correctly.

## Privacy

All processing happens locally in the browser. No server ever sees your files.

## Tech stack

- [Astro](https://astro.build) 6.x — static site with no server runtime
- [Tailwind CSS](https://tailwindcss.com) v4 + [DaisyUI](https://daisyui.com) v5
- [exifr](https://github.com/MikeKovarik/exifr) — metadata reading
- [piexifjs](https://github.com/hMatoba/piexifjs) — JPEG EXIF stripping
- [png-chunks-extract/encode](https://github.com/hughsk/png-chunks-extract) — PNG chunk manipulation
- Deployed on Cloudflare Pages

## Development

```bash
npm install
npm run dev       # localhost:4321
npm test          # vitest
npm run build     # production build → dist/
```

Requires Node 22+.

## License

AGPL-3.0
