# StripMeta

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Built with Astro](https://img.shields.io/badge/Built%20with-Astro-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![Live site](https://img.shields.io/badge/Live%20site-stripmeta.info-brightgreen)](https://stripmeta.info)
[![Cloudflare Pages](https://img.shields.io/endpoint?url=https://cloudflare-pages-status-badge-stripmeta.nico-rittinghaus.workers.dev/?projectName=stripmeta&branch=main&showEnv=true)](https://stripmeta.info)
[![Tests](https://github.com/nirit100/stripmeta/actions/workflows/test.yml/badge.svg)](https://github.com/nirit100/stripmeta/actions/workflows/test.yml)

Remove EXIF and other embedded metadata from photos — entirely in your browser. Nothing is ever uploaded anywhere.

> [!TIP]
> **Looking for the StripMeta.info tool?** Use it directly at **[stripmeta.info](https://stripmeta.info)** — no installation needed.

## What it does

Photos taken with phones and cameras carry hidden metadata: GPS coordinates, device serial numbers, camera make and model, timestamps, software signatures, and more. StripMeta removes all of it before you share an image.

**Supported formats:**

| Format | Method | Quality |
|--------|--------|---------|
| JPEG | Strips EXIF segments from the binary — image data untouched | Lossless |
| PNG | Removes metadata chunks (`tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME`) | Lossless |
| WebP | Removes `EXIF` and `XMP` chunks from the RIFF container | Lossless |
| HEIC / HEIF ⚠️ | Removes Exif item from the ISOBMFF container without re-encoding | Lossless (experimental) |
| AVIF ⚠️ | Removes Exif item from the ISOBMFF container without re-encoding | Lossless (experimental) |
| GIF, BMP, TIFF, SVG | Re-encodes through canvas as JPEG 95% | Lossy |

> [!NOTE]
> Handlers marked **experimental** pass the test suite but the ISOBMFF specification is very complicated. Verify output before relying on it for sensitive files.

Files are identified by their actual content (magic bytes), not by filename or MIME type — so a JPEG saved with a `.png` extension is still stripped correctly. *coughs in Android*

## Privacy

All processing happens locally in the browser. No server ever sees your files.

## Tech stack

- [Astro](https://astro.build) 6.x — static site with no server runtime
- [Tailwind CSS](https://tailwindcss.com) v4 + [DaisyUI](https://daisyui.com) v5
- [exifr](https://github.com/MikeKovarik/exifr) — metadata reading
- [piexifjs](https://github.com/hMatoba/piexifjs) — JPEG EXIF stripping
- [png-chunks-extract/encode](https://github.com/hughsk/png-chunks-extract) — PNG chunk manipulation
- Deployed on Cloudflare Pages

## Development & Contributions

```bash
npm install
npm run dev       # localhost:4321
npm test          # vitest
npm run build     # production build → dist/
```

Feel free to modify and host your own flavour, although I would prefer contributions.

### Configuration

See [docs/environment-variables.md](docs/environment-variables.md) for a full list of environment variables and their descriptions.

### Deployment

<details>
<summary>Deployment & versioning notes</summary>

Deploy-Prod only triggers when Tests pass on a `v*` tag push. Add `/no-deploy` to the tag's commit message to skip deployment despite a passing test run.

**Versioning:** The build embeds the current git description (`git describe --tags --always`) as the app version, visible in the footer and included in bug reports. On Cloudflare Pages, it falls back to `CF_PAGES_COMMIT_SHA` if git isn't available.

To cut a release, bump the version and tag it:

```bash
npm run bump           # patch: 0.0.1 → 0.0.2
npm run bump minor     # minor: 0.0.1 → 0.1.0
npm run bump major     # major: 0.0.1 → 1.0.0
npm run bump 1.2.3     # explicit version

git push && git push origin v<version>
```

Tagged builds show the tag (e.g. `v1.2.3`); untagged builds show the short commit hash.

</details>

### On Donations

The donation links are in the app to help cover hosting costs. They are constants injected at deployment time.

## License

AGPL-3.0
