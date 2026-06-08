# Environment Variables

## Build-time variables

Set these in your Cloudflare Pages dashboard (or `.env` for local development). Astro bakes them into the static output at build time.

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_KOFI_URL` | No | Ko-fi donation page URL. If unset, the Ko-fi button is hidden. |
| `PUBLIC_KOFI_ID` | No | Ko-fi account ID (used by the Ko-fi widget). |
| `PUBLIC_PAYPAL_URL` | No | PayPal donation page URL. If unset, the PayPal button is hidden. |
| `PUBLIC_GITHUB_URL` | No | GitHub repository URL. |
| `PUBLIC_PRIVACY_URL` | No | Privacy policy page URL. If unset, the Privacy link is hidden. |
| `PUBLIC_IMPRESSUM_URL` | No | Impressum page URL. If unset, the Impressum link is hidden. |
| `PUBLIC_BUG_REPORT_ENABLED` | No | Set to `true` to show the bug report buttons. Requires the runtime variables below to also be configured. |

## Runtime variables

Set these in the Cloudflare Pages dashboard under **Settings → Variables and Secrets**. They are available to Pages Functions at request time and are never included in the static build output.

If you're making your own version of this you probably want to replace the whole bug reporter backend anyways.

| Variable | Type | Description |
|---|---|---|
| `BUG_REPORT_FROM` | Plaintext | Sender address for bug report emails. Must be on a domain onboarded in Cloudflare Email Service. |
| `BUG_REPORT_TO` | Plaintext | Recipient address for bug report emails. |
| `EMAIL_CF_ACCOUNT_ID` | Plaintext | Cloudflare account ID, used to call the Email Service REST API. |
| `EMAIL_CF_API_TOKEN` | Secret | Cloudflare API token with **Email Send** permission. |
