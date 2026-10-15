# ThePanel — System Plan v2 (Refined)

> Supersedes v1. Refined after architecture review on 2026-10-14.
> Phase 1 (Shopify sync → dashboard) exists; this plan governs everything from here on.
> v2.1 (Oct 16, 2026): refinements informed by competitor research — see
> `documentation/competitor_deep_dive.md` (Part 6 maps each learned pattern to this
> plan). Changes: `publishing` listing status, per-feature push switches,
> `channel_orders` sale idempotency, pricing ceiling guardrail, W3 closeBook
> semantics, AbeBooks sold-marking shipped.

## Locked Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Database | **SQLite** (better-sqlite3) | Drop `pg`, `node-pg-migrate`. No Postgres install ever needed. |
| AbeBooks | **Export-file channel** | Panel generates bulk-upload files; no real-time AbeBooks sync. |
| Inventory model | **Single copy per product** | quantity is 0/1. A sale anywhere closes the book everywhere. |
| App shape | **Standalone panel** | Keep `backend/` + `frontend/`. Archive the Remix app `the-panel/`. |
| Job queue | **In-process runner** | No Bull/Redis. Retry + backoff in a durable `jobs` table. |
| Book metadata | **Tags convention + ISBN enrichment** | Parse `author:`, `condition:` etc. from Shopify tags; OpenLibrary lookup as fallback, flagged unverified. |
| Shopify API | **GraphQL Admin API** | REST `/products.json` is legacy. Migrate the sync client. |

---

## Architecture

```
Shopify (master catalog, GraphQL Admin API)
        │  pull (polling + optional webhook later)
        ▼
┌─────────────────────────────┐
│ Backend (Express, port 3001)│
│  ├── sync engine            │
│  ├── rules + pricing engine │
│  ├── job runner (retries)   │
│  └── channel adapters       │
│       ├── ebay   (Sell Inventory API, OAuth)      ── live sync
│       ├── etsy   (Open API v3, OAuth)             ── live sync
│       └── abebooks (export file generator)        ── manual upload
└──────────┬──────────────────┘
           │ SQLite (backend/database/thepanel.db)
           ▼
Frontend (React + Vite, port 5173) — single-operator dashboard
```

Data flow stays one-way: Shopify is the source of truth for product data; channels only report back **sales** and **listing errors**.

---

## Database Schema (v2, SQLite)

Existing 5 tables stay; changes below.

### `products`
- Keep all current columns.
- **Semantics change:** `quantity` is treated as 0/1 (single copy). 1 = available, 0 = gone.
- Add `sold_at` (timestamp), `sold_via` (platform or `shopify`), `metadata_status` (`ok` | `partial` | `unverified` | `missing`) to drive the UI's "needs attention" badges.

### `platform_listings`
- `platform` enum becomes: `ebay`, `etsy`, `abebooks`.
- `status` state machine (v2.1, aligned with documented marketplace lifecycles):
  `draft → publishing → active/exported → sold | error → delisted`.
  `publishing` is the transient state a job owns between "publish clicked" and
  "channel API confirmed" — the UI shows honest in-flight pushes instead of a
  spinner over `draft`.
- For AbeBooks rows: `status` = `draft` (generated, not yet exported), `exported` (included in last export file), `sold`, `error`, `delisted`. `platform_url` stays null; add `last_exported_at`.
- Add `external_price` (renamed from `platform_price` in code only if convenient — no data migration needed yet).
- Add `notes` + `title_override` (v3): panel-owned per-platform content. The main description always comes from `products.description` (Shopify truth); these fields are composed in at listing/export time. Every change is journaled into `product_changes` scoped to the platform.
- `sync_enabled` semantics (dual, per competitor convention): `sync_rules.enabled` decides *should* (rule eligibility); the listing's `sync_enabled` decides *may* (this specific book participates on the platform).

### `sync_rules`
- Keep structure. Add per-platform defaults seeded on first run:
  - eBay: base × 1.10, min $5.00
  - Etsy: base × 1.20, min $10.00, `vintage_only` filter (year cutoff configurable, default 2006)
  - AbeBooks: base × 1.15, min $4.50, conditions filter (new, like_new, very_good, good)
- `conditions` JSON supports: `min_price`, `max_price`, `conditions[]`, `year_before`, `year_after`, `tags_any[]`, `tags_all[]`.
- v2.1: **`price_push` / `stock_push` switches** (both default on) — the
  per-channel × per-feature enablement matrix every multichannel tool exposes
  (e.g. push stock to eBay but not price). The channel adapters must honor
  them on every push; the rules editor UI renders them as two toggles on the
  platform card. `price_modifier` accepts the pricing engine's full input set:
  `multiplier`, `fixed_fee`, `min_price`, `max_price`, `cost`, `rounding`.

### `sync_logs`
- Keep. Add `platform` value `abebooks` for export operations.

### `product_changes` (v4 — versioning overlay)
- Field-level audit trail grouped by `change_id` (one save = one entry). All versions of a book hang off the single `products.id` a Shopify sync creates.
- `platform` column scopes each entry: `NULL` = base product data, `ebay`/`abebooks`/`etsy` = that platform's listing fields.
- `run_id` column links sync-source entries to the sync run that produced them (the `sync_logs` row id doubles as the run id). Manual entries have no run.
- **Base fields (NULL):** the products table is the truth mirror of Shopify; manual edits live only here as an overlay (newest manual value per field wins; falls back to truth when entries are deleted). `sync` entries are an informational record of Shopify-side truth changes.
- **Platform fields:** values live directly on `platform_listings` (`notes`, `title_override` — no Shopify counterpart); every write is journaled here with the platform set. Deleting an entry peels the field back to the previous version (or clears it).
- No snapshots, no joins, one table — indexes on `(product_id)`, `(change_id)`, `(product_id, field)`, `(product_id, source)`, `(product_id, platform)`, `(run_id)` keep it cheap at catalog scale. Global history queries paginate at the SQL level (page of `change_id` groups).

**Logs panel (frontend):** universal review surface with two tabs — *Field changes* (filter by scope/platform, source, product title, sync run; per-entry delete with peel-back; guarded bulk purge) and *Sync runs* (from `sync_logs`; each run links to the field changes it produced; per-record delete and guarded purge). Backed by `/api/logs/*` (purges are POST `/purge` with a required filter); per-book history also lives in the product modal's History tab with platform badges.

### `platform_credentials`
- Keep. Credentials encrypted at rest (AES-256-GCM, key in `APP_ENCRYPTION_KEY` env var). Never returned to the frontend — only a masked preview + `last_validated_at`.

### `jobs` (new)
- Durable in-process queue: `id`, `type` (`list`, `update`, `end_listing`, `sync_shopify`, `export_abebooks`, `backfill_metadata`, `mark_sold`, `update_shopify_inventory`), `payload` (JSON), `status` (`pending`, `running`, `done`, `failed`), `attempts`, `max_attempts` (3), `next_run_at`, `last_error`, timestamps.
- Runner polls every few seconds; exponential backoff on failure. No Redis.
- `end_listing` / `update_shopify_inventory` handlers arrive with the Phase 3/4
  adapters — until a handler is registered the runner fails unknown types, so
  nothing queues them yet (the closeBook data-side runs inline today; see W3).

### `channel_orders` (v2.1 — W3 sale idempotency)
- `(platform, external_order_id)` PK + `product_id` + `closed_at`.
- One channel order closes a book **exactly once**: double-reported sales
  (webhook + poll, retry, manual re-mark) never rewrite `sold_at` or re-journal.
  This table exists because every documented overselling incident in the
  competitor research traces to missing exactly this dedup.

---

## Book Metadata Strategy

1. **Tags (primary):** parse Shopify tags with prefix convention — `author:jrr-tolkien`, `condition:vg`, `publisher:penguin`, `year:1965`, `binding:hardcover`. Condition maps: `new`, `ln` (like new), `vg`, `g`, `acc` (acceptable).
2. **ISBN:** from variant barcode (already captured). Used for AbeBooks export and enrichment.
3. **Enrichment (fallback):** when `author` or `year` is missing and ISBN exists, look up OpenLibrary. Auto-filled values set `metadata_status = 'unverified'` so you can review and confirm in the UI. Confirmed edits write the canonical tags back to Shopify (optional toggle).
4. **Backfill script:** one-time run over the existing catalog applying 1–3; report of what was filled and what still needs manual attention.

Sync rules that depend on metadata (Etsy vintage filter, AbeBooks condition filter) skip books with `metadata_status = 'missing'` and surface them in a "Needs metadata" view rather than silently not listing.

---

## Channels

### eBay — primary live channel
- **API:** Sell Inventory API (`inventory_item` + `offer` + `publish`). Not the legacy Trading API.
- **Auth:** OAuth user token; store refresh token; auto-refresh in adapter. Set up a developer account + app first (Phase 3 gate).
- Listing requirements to enforce in adapter: category ID (books), at least 1 image, condition enum mapping, ISBN in product aspects.
- Fees: ~13% final value + $0.30 — reflected in default pricing rule, not hardcoded.

### Etsy — secondary live channel
- **API:** Open API v3, OAuth 2.0. Requires Etsy developer app approval — apply early (it can take time).
- Constraints: $0.20 per listing, images required, must comply with Etsy handmade/vintage/craft-supply policy — the `vintage_only` rule keeps the catalog compliant (books 20+ years old).
- Only list products passing the vintage rule + having images.

### AbeBooks — export channel ✅ (generator built)
- Panel generates a bulk inventory file (tab-separated, HomeBase-style column layout) from products passing the AbeBooks rule. Column set lives in `backend/src/services/listingComposer.js` (BookNo, ISBN, Title, Author, Publisher, Year, Binding, Condition, Price, Qty, Description) — adjust there if the bookseller upload template differs.
- Listing content is composed by the same module for every channel: `title = title_override || product.title`, `description = Shopify base + platform notes` (plain text for the TSV, sanitized HTML for future channels). BookNo = Shopify variant SKU (captured into `metadata.sku` by the sync) or a stable `AB-<id>` fallback. Condition maps to AbeBooks grades (new→New, like_new→Fine, very_good→Very Good, good→Good, acceptable→Fair).
- **Export modes:** `full` (all eligible), `delta` (new/changed since each book's last export — never resends an unchanged catalog; any `product_changes` entry newer than `last_exported_at` marks a book pending, with a 1-second look-back guard), and `selection` (explicit picks — overrides rule conditions but never the stock check; blocked reasons surface as warnings).
- **Preview before download:** rows + skip report via `POST /api/abebooks/export/preview` (no side effects). `POST /api/abebooks/export/generate` returns the file, marks included books `status='exported'` with a fresh `last_exported_at`, and logs the run in `sync_logs` (`action='export'`).
- UI: "Generate export…" on the AbeBooks view (mode picker, preview table, download) and from the bulk-selection bar in the overview.
- "Sold on AbeBooks" is marked manually in the panel (closes the book everywhere like any other sale) — still to build.
- Notes templates: `POST /api/products/notes-template` applies one template (`{title}`, `{author}`, `{year}`, `{condition}`, `{binding}`, `{publisher}`, `{isbn}`, `{price}`, `{sku}` variables) to a selection of books, rendered per book, each saved through the per-platform versioning path.

### Bulk operations (selection framework) ✅
- Checkbox selection in the overview table (persists across pages/filters) with a bulk action bar: AbeBooks export, notes template.
- Channel views show a **Readiness card** (rule evaluation over the catalog: eligible count + skip reasons) and the real connection state derived from the credential vault.
- eBay/Etsy listing pushes (batch jobs with per-item results) arrive with the Phase 3 adapter.

---

## Pricing Engine (pure logic, built before any channel API)

```
platform_price = max( base_price × multiplier + fixed_fee , min_price )
then apply rounding rule (default: round up to X.99)
```

- All inputs from `sync_rules` (per platform): `multiplier`, `fixed_fee`, `min_price`, `max_price`, `cost`, `rounding`.
- Guardrails (v2.1 — all three, surfaced as skip-with-reason, never silent): never list below `min_price`; skip if computed price < `cost` (bottom guard); skip if computed price > `max_price` (ceiling — a corrupt source price or bad multiplier must surface as a skipped row, not a live absurd listing).
- Ship as a pure module with unit tests — this is the first thing built in Phase 2 since everything else depends on it.

---

## Core Workflows (revised)

### W1 — Setup
1. Enter Shopify token (real one — root `.env` currently has a placeholder, so Phase 1 sync is non-functional until fixed).
2. Sync + metadata backfill.
3. Enter eBay/Etsy credentials via the vault UI; "Test connection" per platform.
4. Review/adjust sync rules; review unverified metadata.

### W2 — New/changed product in Shopify
- **MVP:** scheduled polling (default every 30 min) + manual "Sync now".
- **Later (optional):** Shopify webhooks via public URL (Cloudflare Tunnel); only worth it if polling proves insufficient.

### W3 — Sale on a channel (single-copy model) ✅ data side
1. Channel reports sale (eBay order poll, Etsy receipt sync, or manual mark for Etsy/AbeBooks/Shopify). `POST /api/products/:id/sold` accepts `sold_via`, `platform`, `external_order_id`.
2. **closeBook() (implemented in `productService.markSold`):** record `(platform, external_order_id)` in `channel_orders` (idempotent — a repeat report returns `already_closed` without touching the closure); first sale wins `sold_at`/`sold_via`; quantity 0 recorded as manual overlay; every live `platform_listings` row (`draft`/`publishing`/`active`/`exported`) set to `sold`. Error/delisted rows untouched.
3. Queue `end_listing` jobs for every other active listing — **Phase 3**: the eBay `withdrawOffer` / Etsy deactivate calls; nothing queues them until the adapter handlers exist.
4. Shopify quantity update queued as well (so the store stays accurate) — **Phase 3** (`update_shopify_inventory` handler; GraphQL `inventorySetQuantities`).

### W4 — Manual sync
- Per product ("Sync", "Delist") and bulk ("Sync all eligible"). Progress + summary: "3 created, 5 updated, 1 failed, 4 skipped (metadata missing)".

### W5 — Errors
- Job fails → retry ×3 with backoff → `failed` with `last_error`.
- Product row shows error badge; error detail view; "Retry" button.
- Persistent failures land in a "Needs attention" filter.

### W6 — Product deleted in Shopify
- Mark product `delisted_pending` → queue `end_listing` on all channels → keep row for audit (never hard-delete from panel).

---

## Security

- Encrypt channel credentials at rest (AES-256-GCM, `APP_ENCRYPTION_KEY`).
- Rotate the Shopify API secret currently in root `.env` once development stabilizes (it has been sitting in a local file).
- `.env` files stay gitignored (already correct). Backend never exposes raw credentials over API.
- Panel is localhost-only; no auth needed for MVP, but bind Express to `127.0.0.1`.

---

## Cleanup (Phase 2, Task 0)

- Remove deps: `pg`, `node-pg-migrate`, `@shopify/shopify-api`, `@shopify/shopify-app-remix`; delete `migrate.config.js`.
- Archive `the-panel/` (move to `archive/the-panel/` or delete — it's the unused Remix scaffold).
- Delete stale `database/migrations/` (Postgres ones) if present.
- Set a real `SHOPIFY_ACCESS_TOKEN` in `backend/.env` (custom app with `read_products`, `read_inventory` scopes; GraphQL-ready).
- Consolidate `PROGRESS.md` / `READY.md` / `SETUP.md` into one `README.md` reflecting SQLite reality (current docs contradict each other: Postgres vs SQLite).
- Frontend `condition` filter currently filters a column nothing populates — wire it to the new metadata pipeline.

---

## Implementation Phases (v2)

**Phase 2 — Foundation hardening + engines (no channel APIs)**
- [x] Task 0 cleanup (above)
- [x] GraphQL Admin API sync client (replaces REST)
- [x] Metadata pipeline: tag parser, OpenLibrary enrichment, backfill script, `metadata_status`
- [x] Pricing engine + rules evaluation (pure modules + unit tests; min/cost/max guardrails)
- [x] Credential vault (encrypted storage + masked API + test-connection stubs)
- [x] Jobs table + runner with retries
- [x] Frontend: settings/credentials view, rules editor, metadata review view
- [x] **v2.1 research refinements:** `publishing` status, `price_push`/`stock_push` rule switches, `channel_orders` sale idempotency, W3 closeBook (`productService.markSold`), pricing ceiling guardrail
- [x] **Scheduled Shopify polling (W2)** — `jobs/scheduler.js`, `SYNC_POLL_MINUTES` (default 30, 0 = off), state persisted in `panel_state`, in-flight dedupe
- [x] **Sync transparency (C-9) + attention aggregation (C-10)** — `GET /api/status/sync` (cadence, next run, last run stats, queue health) and `GET /api/status/attention` (error listings + failed jobs + metadata gaps); frontend `SyncStatusCard`
- [x] **Bulk reprice / PricePartner (C-7)** — `POST /api/products/reprice` (percent/amount/set, dry-run diff → journaled local overrides); frontend `RepriceDialog` from the bulk bar
- [x] **Presets (C-5)** — `presets` table + CRUD API; export dialog saves/loads named mode presets
- [x] **Setup checklist (C-1)** — frontend `GettingStarted` card, completion derived from live state (catalog, metadata, rules, credentials, first export)
- [x] **Rules card (C-12)** — max_price/cost guardrail inputs + price/stock push toggles in the rules editor

**Phase 3 — eBay end-to-end**
- [ ] eBay developer app + OAuth flow
- [ ] Adapter: create/update/end listings via Sell Inventory API — object model, publish-required fields, and call sequences are specified in `documentation/competitor_deep_dive.md` Part 3.1 (adapter contract: `testConnection` / `createDraft` / `publish` / `update` / `end` / `fetchSales`; per-channel profile object holds category, condition map, business-policy IDs — data in settings, not code constants)
- [ ] `end_listing` + `update_shopify_inventory` job handlers (W3 fan-out; closeBook data side already runs)
- [ ] Wire rules → pricing → listing flow; sale detection (Fulfillment API order poll); W3 delist-everywhere flow
- [ ] Logs + error UI; "Needs attention" view
- [ ] Two-phase push UI: compose → preview table (per-row skip reasons) → per-item publish jobs (same shape as the AbeBooks export preview/generate); listings show the `publishing` transient state

**Phase 4 — AbeBooks export + Etsy**
- [x] AbeBooks export file generator: modes (full/delta/selection), preview + skip report, download, export baseline, run logging
- [x] Listing composition (`listingComposer.js`): title override, notes folding, condition mapping, SKU capture — shared by all channels
- [x] Bulk selection + notes templates with per-book variables
- [x] AbeBooks manual sold-marking flow (closes the book everywhere) — `POST /api/products/:id/sold` with `platform` + `external_order_id`, idempotent via `channel_orders`
- [ ] Etsy app approval (apply early in Phase 3), OAuth, adapter, vintage-rule enforcement

**Phase 5 — Automation + polish**
- [x] Scheduled polling sync (W2) — scheduler + status card shipped (v2.1); optional webhooks via tunnel remain
- [ ] Optional webhooks via tunnel
- [ ] Bulk operations, performance, final consolidation of docs
- [ ] Channel-status badge grammar refinement on the overview rows (chip states exist; add click-to-filter per state)
- [ ] Bulk grid column chooser (C-4) — editable columns for enabled/price/notes
- [ ] Future: adopt-existing-listings flow (C-14 match review: SKU/UPC match → Ready/Close/No-match buckets → link) when existing eBay/Etsy listings must be brought under panel management

---

## Research-informed product decisions (v2.1)

Distilled from `documentation/competitor_deep_dive.md` (full pattern catalog in its
Part 4/6). These shape the frontend work in Phases 2–5:

1. **Single-writer doctrine, made visible.** Shopify owns product truth; the panel
   owns listings; channels report sales only. Shopify-owned fields render *locked*
   in the UI with an "edit in Shopify / add local override" affordance (Sellbrite's
   locked-fields pattern) — never an editable field that silently loses to the next
   sync.
2. **Two-phase commit everywhere.** Every push (already true for AbeBooks export)
   is compose → preview with per-row skip reasons → per-item jobs. Batch summaries
   in the W4 format ("3 created, 5 updated, 1 failed, 4 skipped (metadata missing)")
   with per-item error visibility — batch-level red/green is the #1 complaint
   against competitors.
3. **Channel-status badge grammar on every book row.** One chip per platform:
   active/synced (green), draft/publishing/stale (amber), error (red), exported
   (blue), not-listed (gray), sold (slash). Click-to-filter. The LitCommerce
   chain-dot pattern applied to our state model.
4. **Sync transparency.** Status card: "polls Shopify every 30 min · next 14:32 ·
   last run: 3 created, 1 failed." Publish the cadence (LitCommerce's "we put a
   number on it").
5. **Per-channel rules card.** One card per platform: enabled + auto-list toggles,
   price adjustments (multiplier/fixed/min/max/cost/rounding), `price_push` /
   `stock_push` switches, channel filters, and (Phase 3+) the channel profile
   (category, condition map, business policies) as editable settings data.
6. **Irreversible-action warnings.** Delist-everywhere, export generate (marks
   books exported), bulk log purge, bulk reprice: name what changes, the count,
   and what cannot be undone.
7. **"Needs attention" as one aggregated filter.** Error-status books + exhausted
   jobs + `metadata_status='missing'` books blocked by rules.
8. **Numbered setup checklist ending at "sync on"** — persisted per-step
   completion; ships last, when every step's screen exists.
9. **PricePartner-style bulk reprice** (selection → ± amount / ± % / set-to,
   previewed through the pricing engine, journaled) as a bulk action.

Explicitly *not* adopted from competitors: two-way inventory sync, multi-warehouse /
FBA routing, reserved-inventory math, order-based fees, fulfillment layers — all
solve problems the single-copy, single-operator, Shopify-master model deleted.

---

## Explicitly Out of Scope (for now)

- Real-time AbeBooks sync (no API exists)
- Multi-quantity inventory (each book is a single copy)
- Multi-user auth / hosted deployment
- Price/stock sync *from* channels back to Shopify (Shopify stays master)
