# Note on Shopify authentication (Oct 14, 2026)

## What happened

The backend stopped connecting to Shopify: every Admin API call returned **HTTP 401**. The static
`SHOPIFY_ACCESS_TOKEN` in `backend/.env` was a `shpat_` token issued by Shopify's legacy
"custom app created in the Shopify admin" flow (Settings → Apps → Develop apps → API credentials,
"reveal token once"). That flow has been discontinued:

- The admin's Develop apps page now redirects to the new **Dev Dashboard** (dev.shopify.com).
- Dev Dashboard apps **never show a static Admin API access token**. Per Shopify's docs:
  "With a client credentials grant, you won't see a token in the Shopify admin. Instead, you
  request tokens programmatically when you need them."
- Admin-created custom apps can no longer be created at all. The old token became invalid when
  the app (thePanel) was migrated to the Dev Dashboard model.

## Why the key was so hard to find (dead ends, so nobody repeats them)

When the 401 was first diagnosed, the token was hunted for in the Shopify UI and **could not be
found anywhere** — not because it was hidden, but because **it no longer exists as a visible
artifact in any menu**. The specific dead ends:

1. **Store admin → Settings → Apps → thePanel (app installation page).** This page looks like
   the right place (it shows permissions, privacy, app history, uninstall) but it has **no
   credentials section at all**. In the legacy world this area led to "API credentials" with
   the reveal-once token; after the Dev Dashboard migration, that section was simply removed.
2. **Store admin → Settings → Apps → App development** (the legacy "Develop apps" page whose
   URL used to list custom apps with their tokens). It no longer shows apps — it now renders a
   banner redirecting to the Dev Dashboard, and old deep links such as
   `/settings/apps/development/app/<handle>` return **404**.
3. **Dev Dashboard (dev.shopify.com) → thePanel.** Its navigation (Overview / Logs / Versions /
   App settings) contains only the **Client ID and Client secret** under App settings →
   Credentials. There is no Admin API access token on any of these pages, no "reveal" button
   for one, and the Versions / Create version pages don't expose one either.
4. **The "Install app" flow (Apps → ⋯ → Install app).** Tried both with the app already
   installed (it just bounced straight to the app surface) and after an uninstall + fresh
   install through the consent screen — the flow completes and returns you to the app **without
   ever displaying a token**.

The reason for all of these failures: with the Dev Dashboard model, Shopify **pre-generates
nothing to show you**. A long-lived static token shown at install time is the discontinued
legacy-custom-app behavior. Dev Dashboard apps issue tokens **only programmatically**, via the
client credentials grant (or OAuth grants, for apps with a server and UI). In other words: the
search failed because the thing being searched for — a visible static API key in some menu —
does not exist anymore. **Don't look for a key; exchange the Client ID + secret for a
short-lived token instead.** The lesson: check the current Shopify docs *before* exploring the
admin UI, because the UI has been mid-migration and menu labels still point at retired flows.

## The fix: client credentials grant

Shopify's documented path for a server-side app acting on **stores in your own organization**
(thePanel backend → Collectible Library) is the
[client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant):

```
POST https://{shop}.myshopify.com/admin/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id=<SHOPIFY_CLIENT_ID>
client_secret=<SHOPIFY_CLIENT_SECRET>
```

Response: `{ access_token, scope, expires_in: 86399 }` — token is valid ~24 h.

### Where the credentials live

Dev Dashboard → Apps → **thePanel** → App settings → Credentials:
- Client ID and Client secret are visible there (secret can be revealed / rotated).
- Requirements for the grant: app exists in the Dev Dashboard, scopes are declared on the app's
  version (ours: `read/write_products`, `read/write_inventory`, `read_orders`), the app is
  installed on the store, and app + store are in the same organization (org 116664430).

### What changed in this repo

- `backend/src/config/shopify.js` — `fetchAccessToken()` exchanges client credentials for an
  access token, caches it in memory, and refreshes 60 s before expiry. Falls back to a static
  `SHOPIFY_ACCESS_TOKEN` if client credentials are not configured (legacy support).
- `backend/.env` — `SHOPIFY_ACCESS_TOKEN` is now empty/unused; auth uses
  `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`. Also `SHOPIFY_API_VERSION=2026-07`.
- `backend/src/services/shopifyService.js` — `Shop.domain` was removed in API 2026-07; the shop
  query now uses `primaryDomain { url }` with `myshopifyDomain` fallback.

## Operational notes

- **Token expiry is a non-issue**: the backend auto-fetches a fresh token daily. If you ever see
  401s again, first rotate the client secret in the Dev Dashboard (Settings → Credentials →
  Rotate) and update `SHOPIFY_CLIENT_SECRET` in `.env`.
- **Rotating the client secret invalidates tokens** tied to the old secret; the backend recovers
  on its next token fetch.
- **On Oct 14, 2026** the thePanel app was uninstalled and reinstalled on Collectible Library as
  part of debugging (the Dev Dashboard install flow via Apps → ⋯ → Install app). No store data
  was affected. If the app is ever uninstalled, reinstall it the same way — the grant starts
  working again immediately after.
- Store config: `SHOPIFY_STORE_URL=collectorslibrary.myshopify.com` (Collectible Library,
  collectiblelibrary.com; also reachable as 800275-61.myshopify.com).
- Scope readback from the grant may list fewer scopes than the app version declares
  (e.g. `write_inventory,read_orders,write_products`); `read_products` queries work regardless.
  This is a known quirk of the readback, not a permission problem.
- Reference docs:
  - Client credentials grant: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
  - Access token types/lifetimes: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
  - Dev Dashboard: https://shopify.dev/docs/apps/build/dev-dashboard
