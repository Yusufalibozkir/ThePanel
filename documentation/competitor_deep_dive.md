# Deep Dive — How the Multichannel Platforms Actually Work (v2, expanded)

> Companion to `competitor_research.md`. Researched 2026-10-16 from vendor help centers,
> developer docs, and product pages: Sellbrite Help Center + sellbrite.com, Shopify Help
> Center (Marketplace Connect), LitCommerce site + helpdesk, eBay Developers Program
> (Inventory API overview + publishing-offers guide), Etsy Open API v3 (Listings
> Tutorial), AbeBooks HomeBase 3.2 page + support. Facts are tagged:
> **[D]** = documented in a fetched source (quoted or closely paraphrased),
> **[I]** = inferred — reconstructed from documented behavior; the industry-standard
> architecture every player converges on. Where ThePanel's real code is referenced, the
> path is exact (read from the repo the same day).
>
> Read Parts 1–3 to understand *them*; Parts 4–6 to rebuild *ours*.

---

## Part 0 — Executive summary

1. Every multichannel platform, from Shopify's own Marketplace Connect down to
   one-person Shopify apps, is the same machine: a **normalized master product
   record**, a **per-channel listing projection** with a documented **status state
   machine**, a **rules/template layer** that transforms master data into
   channel-shaped listings, a **polling sync engine** (15 min is the industry
   cadence), and a **per-channel × per-feature enablement matrix**. ThePanel's plan
   already matches this shape; the details below are where the value is.
2. The **listing lifecycle** is always two-phase: assemble a draft, verify it, then
   publish. eBay's API models this natively (Inventory Item → Offer → `publishOffer`);
   Etsy's API models it natively (`createDraftListing` → activate). Every vendor UI
   mirrors it (Sellbrite: "Once your draft listings are created, select **Publish**").
   One-way data flow + two-phase publish + per-item job results is the trust formula.
3. **Overselling is the #1 trust feature and the #1 failure mode.** The documented
   failure pattern (a CedCommerce merchant paying ~$6.5k/yr still oversold) is always
   the same root cause: two writers to the same inventory. The single-writer doctrine
   is stated verbatim by Sellbrite: adjusting inventory channel-side "can interfere
   with syncing and can even cause you to oversell." ThePanel's 0/1 single-copy model
   plus Shopify-as-master makes this class of failure structurally impossible.
4. The **Shopify↔eBay space is currently broken**: eBay's own official Shopify app is
   removed from the App Store [D], Marketplace Connect's eBay integration had a
   publicly reported month-long outage [D], and Shopify's help center warns "it's
   important to have only one marketplace connector app connected to avoid data
   conflicts" [D]. Phase 3 (eBay end-to-end) targets the weak spot of the market.
5. **Etsy is closed to new connections on Marketplace Connect** [D] — only
   third-party apps (CedCommerce 4.5★/1,250 reviews) serve Shopify↔Etsy today. Etsy
   API draft validation was relaxed [D] (shipping profile required only at
   activation), which lowers our Phase 4 friction.
6. **AbeBooks has no public API.** HomeBase 3.2 authenticates with a private
   user-ID + API-key upload channel [D]; everyone else uses FTPS (TLS 1.2) bulk
   files [D]. ThePanel's TSV export is the only sanctioned route; the ceiling for
   automation is scheduled FTPS delivery of the same file.
7. Nobody in the general-purpose space is book-aware (condition grading, ISBN as
   first-class aspect, vintage-rule compliance, AbeBooks grades) and nobody models
   single-copy inventory. Those are ThePanel's two durable differentiators; several
   competitor subsystems (multi-warehouse, FBA routing, reserved-inventory math)
   exist only to solve problems ThePanel deleted by design. Keep them deleted.

Document map:

| Part | Content |
|---|---|
| 1 | The universal architecture: entities, full schema, state machines, sync-engine algorithms, matching subsystem, rule systems, ownership doctrine |
| 2 | Platform-by-platform deep dives (Sellbrite, Marketplace Connect, LitCommerce, CedCommerce, HomeBase/AbeBooks) |
| 3 | Channel API reference: the exact contracts our eBay/Etsy adapters must implement |
| 4 | UI/UX analysis: information architecture, screen-by-screen wireframes, interaction states, badge system, microcopy, anti-patterns |
| 5 | Failure-mode catalog: symptom → root cause → detection → prevention → ThePanel mitigation |
| 6 | Application to ThePanel, grounded in the actual code (schema, engines, routes) with concrete proposals |
| 7 | Sources |

---

## Part 1 — The universal architecture

### 1.1 The five canonical entities

Every system in this space — Sellbrite, LitCommerce, Marketplace Connect, CedCommerce,
Rithum/ChannelAdvisor, Feedonomics, and ThePanel — is built from the same five data
entities. The differences between products are differences of *which entity owns which
field*, not of structure.

```
                 ┌─────────────────────────────────────────┐
                 │              CHANNEL (n)                 │
                 │  eBay · Etsy · AbeBooks · …              │
                 │  credentials, settings, policies,        │
                 │  sync toggles, cadence, health           │
                 └───────────────┬─────────────────────────┘
                                 │ 1
                                 │
   ┌─────────────┐        ┌──────┴───────────┐
   │   PRODUCT   │1──────*│     LISTING      │   per (product, channel)
   │ (catalog)   │        │ (projection)     │
   └──────┬──────┘        └──────┬───────────┘
          │1                     │1
          │                      │
          *                      *
   ┌─────────────┐        ┌──────────────────┐
   │ RULES /     │        │ TEMPLATE /       │
   │ PRICING     │        │ PROFILE (mapping)│
   └─────────────┘        └──────────────────┘
```

1. **Product** — the master record. Normalized fields: SKU, title, description, price,
   quantity, images, category, attributes/metadata. In Sellbrite this is their internal
   "product catalog" (imported from the cart); in LitCommerce the "All Products"
   catalog; in Marketplace Connect the Shopify product itself (no separate copy — the
   app reads the store's catalog live); in ThePanel the `products` table (a Shopify
   mirror plus metadata).
2. **Listing** — the per-channel projection of a product. Carries: the channel
   reference, the link to the product, the channel-side identifier (eBay offer/listing
   ID, Etsy listing_id), channel-specific fields (eBay category/condition/business
   policies; Etsy taxonomy/who_made/when_made/shipping profile), a **status** (see
   1.3), the channel price, and the last-synced state. ThePanel: `platform_listings`.
3. **Channel** — the connection record: credentials (OAuth refresh tokens), account
   identifiers (eBay seller account, Etsy shop_id, AbeBooks bookseller ID),
   per-channel settings (sync toggles, rules, defaults, policies), connection health
   (last validated, token expiry). ThePanel: `platform_credentials` + `sync_rules`
   (the channel is split across two tables; functionally equivalent).
4. **Rules / Pricing** — the per-channel transform of price and quantity. Sellbrite
   markets this as its differentiator [D]: "being able to have control over pricing is
   what separates Sellbrite from other listing tools." Marketplace Connect exposes the
   same machinery as documented "price adjustments" and "inventory adjustments" [D]
   (see 1.6). ThePanel: `sync_rules.price_modifier` + `engines/pricing.js`.
5. **Template / Profile** — the per-channel field mapping and defaults: how title and
   description are composed, which category/taxonomy is used, payment/return/shipping
   policies, condition mapping. Sellbrite: **Templates** (Title & Description
   Template, Payments & Returns Template, Pricing Template) [D]. CedCommerce:
   **Profiles** [D]. LitCommerce: **listing templates and rules** [D]. ThePanel:
   `services/listingComposer.js` + notes templates + per-channel defaults seeded in
   `sync_rules`.

#### Field-ownership matrix [I, from documented behavior]

The deepest question in this architecture is *who owns each field*. All vendor
designs answer it the same way:

| Field | Owner | Written by | Channel may override? |
|---|---|---|---|
| Title, description, images, category, attributes | Master product (Shopify) | Shopify sync | No — pushed to channel; Sellbrite *locks* these fields in the UI when a Template applies [D] |
| Price | Rules engine, derived from master | Pricing engine on push | No — price sync is a channel-level toggle [D] |
| Quantity | Master inventory | Sync engine only (single writer) [D] | **Never** — channel-side edits cause oversell [D] |
| Channel ID (offerId / listing_id) | Listing row | Channel adapter on create | N/A |
| Status | Listing row | Adapter + order importer | Channel reports sale → status change |
| Policies (payment/return/fulfillment; shipping profile) | Channel settings (Account API / shop) | Setup wizard | Referenced by ID, never inlined per listing [D] |
| Per-platform notes/title override | Listing row (panel-owned) | Operator | N/A — ThePanel-specific (`notes`, `title_override`) |
| Credentials | Vault | Setup + refresh flow | Never exposed to UI raw [D pattern] |

Sellbrite makes ownership *visible*: "any listing with Templates applied will have
locked fields. To update those, you'll need to edit the Template or update your
product data in Shopify" [D]. This is the single most important UX lesson in the
whole document (see 4.2, pattern 6).

### 1.2 Generalized database structure

Reconstructed schema [I], aligned to what every vendor's documented behavior implies.
Column-by-column commentary follows; the ThePanel column shows where the same concept
already lives in `backend/migrate-sqlite.js`.

```sql
-- ═══════════════ MASTER CATALOG ═══════════════
products(
  id,                       -- stable PK
  source_product_id,        -- Shopify product gid / REST id  (ThePanel: shopify_product_id UNIQUE)
  sku, isbn,                -- identity/join keys for matching (ThePanel: metadata.sku, products.isbn)
  title, description,       -- truth content
  base_price, cost,         -- money (ThePanel: price, cost)
  quantity,                 -- ThePanel: 0/1 single-copy semantics
  images[],                 -- ThePanel: images JSON
  condition,                -- book-specific (ThePanel: condition CHECK enum)
  attributes JSON,          -- parsed tags: author/year/publisher/binding (ThePanel: metadata JSON)
  metadata_status,          -- data-quality flag (ThePanel: ok|partial|unverified|missing)
  sold_at, sold_via,        -- single-copy sale closure (ThePanel: same names)
  created_at, updated_at,
  deleted_at                -- soft delete, universal [I]
)

-- ═══════════════ CHANNEL CONNECTION ═══════════════
channels(                   -- ThePanel: platform_credentials + sync_rules (split)
  platform,                 -- enum
  account_ref,              -- eBay seller username / Etsy shop_id
  credentials_encrypted,    -- OAuth refresh token etc. (ThePanel: credentials TEXT, AES-256-GCM)
  token_expires_at,         -- proactive refresh (ThePanel: token_expires_at)
  last_validated_at,        -- "Test connection" evidence (ThePanel: last_validated_at)
  sync_settings JSON        -- per-feature toggles (see 1.4)
)

-- ═══════════════ PER-CHANNEL LISTING ═══════════════
listings(                   -- ThePanel: platform_listings
  id,
  product_id FK,
  platform,                 -- (ThePanel: CHECK in ('ebay','abebooks','etsy'))
  external_id,              -- eBay offerId/listingId · Etsy listing_id (ThePanel: platform_listing_id)
  status,                   -- state machine, see 1.3 (ThePanel: status)
  enabled,                  -- participation toggle (ThePanel: sync_enabled INTEGER)
  external_price,           -- price last pushed (ThePanel: external_price)
  channel_fields JSON,      -- category, condition enum, policies, taxonomy…
  notes, title_override,    -- panel-owned content (ThePanel: notes, title_override)
  platform_url,             -- link to live listing (ThePanel: platform_url)
  last_synced_at,           -- per-listing freshness
  last_exported_at,         -- AbeBooks export watermark (ThePanel: last_exported_at)
  error_message,            -- last failure detail (ThePanel: error_message)
  created_at, updated_at,
  UNIQUE(product_id, platform)  -- ThePanel: same constraint
)

-- ═══════════════ MAPPING / DEFAULTS ═══════════════
templates(                  -- ThePanel: listingComposer.js (code) + notes templates
  id, platform, name,
  kind,                     -- title_desc | payments_returns | pricing | shipping
  body,                     -- template text w/ variables
  defaults JSON             -- category id, policy ids, handling time, condition map
)

-- ═══════════════ RULES ═══════════════
rules(                      -- ThePanel: sync_rules
  id, platform UNIQUE,
  enabled, auto_sync,
  conditions JSON,          -- filters: min/max price, conditions[], year_before,
                            --   tags_any[], tags_all[]  (ThePanel: conditions)
  price_modifier JSON       -- multiplier, fixed_fee, min_price, rounding (ThePanel: same)
)

-- ═══════════════ SYNC ENGINE ═══════════════
sync_runs(                  -- ThePanel: sync_logs
  id, platform, action,     -- create|update|delete|export|sync (ThePanel: CHECK)
  status,                   -- success|failed|skipped
  product_id NULL,          -- per-record rows (ThePanel: same)
  details JSON,             -- stats: created/updated/failed/skipped counts
  error_message, timestamp
)

jobs(                       -- ThePanel: jobs (durable queue)
  id, type,                 -- list|update|end_listing|sync_shopify|export_abebooks
  payload JSON,
  status,                   -- pending|running|done|failed
  attempts, max_attempts, next_run_at, last_error,  -- backoff retry [D pattern]
  created_at, updated_at
)

changes(                    -- ThePanel: product_changes (v4, with platform + run_id)
  id, change_id, product_id,
  platform NULL,            -- NULL = base overlay; else platform-scoped
  field, old_value, new_value,
  source,                   -- manual | sync
  run_id NULL,              -- links to the sync run that produced it
  changed_at
)
```

Structural observations that matter:

- **Soft delete is universal.** Sold/ended listings are never removed — they are the
  audit trail and the "don't relist this" memory. ThePanel plan W6 states the same
  ("never hard-delete from panel").
- **`external_id` lives on the listing row, never on the product.** One product →
  N listings → N external IDs. ThePanel is correct (`platform_listings.platform_listing_id`).
- **`error_message` lives on the listing row.** That is what powers "needs attention"
  views in every product. ThePanel is correct.
- **Sync state is journaled, not just current.** Vendors expose run history
  (Sellbrite/LitCommerce dashboards); ThePanel's `product_changes` with `run_id` is a
  strictly richer design (field-level, peel-back) — no competitor exposes that.
- **ThePanel splits "channel" across two tables** (`platform_credentials` for secrets,
  `sync_rules` for behavior). Vendors keep one row; ours is arguably safer (secrets
  table can be locked down separately). No change needed.
- **ThePanel already has the participation toggle**: `platform_listings.sync_enabled`
  and `sync_rules.enabled/auto_sync` — the Marketplace Connect "Enabled" concept
  exists at both levels. Keep both: rule decides *should* (eligibility), listing
  `sync_enabled` decides *may* (this specific book).

### 1.3 The listing lifecycle state machine

Etsy documents the cleanest version [D]; eBay's is structurally identical with
different names; vendor UIs add error/linked states on top.

#### Etsy's documented state machine [D]

| state | description | allowed actions |
|---|---|---|
| `draft` | inactive because state is not "active" or lacks ≥1 image | publish (`updateListing`), delete |
| `published` | active, searchable, **> 0 unsold inventory** | deactivate, delete |
| `deactivated` | deliberately unsearchable/unsellable | publish, delete |
| `sold_out` | published with 0 unsold inventory | **delete only** |
| `expired` | not renewed after expiry (not charged) | publish, delete |

Implications for single-copy books: an Etsy sale drives the listing to `sold_out`,
from which the only transition is delete — W3's `end_listing` job for Etsy is
terminal by platform design. Published listings require ≥1 image and >0 quantity
[D], so the image-requirement check in our Etsy rule is enforced twice (rule +
API).

#### eBay's model [D]

Inventory Item (SKU-keyed, always exists) → Offer (created, not live) →
`publishOffer` → live listing. Ending = `withdrawOffer`. Two eBay-specific behaviors
[D]: (1) **Out-of-Stock Control** — a seller preference that keeps a 0-quantity
listing alive and hidden ≤ 90 days (for future multi-copy support; we *end* instead);
(2) **listings created via the Inventory API cannot be edited in Seller Hub or any
other listing platform** — once ThePanel lists a book, panel-only management is
*enforced by eBay*. This dovetails perfectly with the single-writer doctrine.

#### The composite vendor state machine [I]

```
                      create draft
                           │
                           ▼
        ┌──────────── draft ─────────────┐
        │   (not buyer-visible)          │
        └───────┬─────────────┬──────────┘
        delete  │             │ publish (per-item job)
                ▼             ▼
             deleted    ┌─ listed/active ──┐
                        │  (live, synced)  │
                        └─┬──────┬────────┘
              push/update │      │ sale detected (channel order)
                 ┌────────┘      ▼
                 │          sold ──── (fan-out: end everywhere, W3)
        error ◄──┤ failed        │
        (retry)  │ update push   ▼
                 └──────── delisted (ended/withdrawn/deactivated)
```

Vendor-added states on top of the platform states: **error** (last push failed;
listing row keeps the badge and is retried), **unlinked** (channel listing not
connected to a catalog product — frozen out of sync [D]), and **in-flight** (job
running; see 4.2 pattern 3).

**ThePanel gap:** our `status` CHECK is `('draft','exported','active','sold','error','delisted')`
— missing only the transient `publishing` state (a job owns the listing between
"publish clicked" and "API confirmed"). Adding it lets the UI show honest in-flight
state instead of a spinner over `draft`. Cheap win nobody else ships.

### 1.4 The sync engine

#### Cadence matrix [D]

| Vendor | Product pull | Price push | Inventory push | Order pull |
|---|---|---|---|---|
| LitCommerce | — (webhook/LiveSync for Woo; poll otherwise) | every 15 min | every 15 min | every 15 min (each independently enabled per channel) |
| Sellbrite | n/a (hub owns catalog) | price sync toggle per channel | 15 min paid / 2 h free | continuous import |
| Marketplace Connect | Shopify is live (embedded) | push on change | push on change | order import, 50/mo free then 1% fee |
| ThePanel (plan) | poll Shopify every 30 min + manual | on push | on push + W3 | eBay: Fulfillment API poll; Etsy: order sync; AbeBooks: manual mark |

15 minutes is the industry answer for *scheduled* sync; ThePanel's 30-minute poll is
in-family [I]. LitCommerce publishes the number in-product ("We put a number on it")
— cadence transparency is itself a feature (see 4.2 pattern 9).

#### Sync pipeline (generalized algorithm) [I]

```
loop every CADENCE (or on manual trigger):
  run = start_sync_run(platform, kind)

  1. PULL phase (Shopify master):
     changed = shopify.graphql(products(since: last_cursor))
     for each p in changed:
       if p.deleted: mark delisted_pending; queue end_listing jobs (W6)
       else: upsert products row; journal product_changes(source='sync', run_id)
     stats.pulled = len(changed)

  2. EVALUATE phase (rules, per platform):
     for each product where quantity == 1 (single copy):
       verdict = rules.evaluate(product, sync_rules[platform])
       # verdict: eligible | skipped(reason)
       # reasons: metadata missing, vintage filter, condition filter,
       #          price guardrail, no images (etsy/ebay)
       update listing status/draft accordingly; skip-reasons feed the
       # "Needs attention" + Readiness card views

  3. PUSH phase (compose + two-phase commit):
     for each eligible listing needing create/update:
       composed = listingComposer(product, platform, rule)
       job = enqueue(type='list'|'update', payload=composed)
       listing.status = 'publishing'
     runner executes jobs: create draft/offer → verify → publish →
       store external_id, external_price, platform_url → status='active'
       on failure: attempts++, backoff, status='error', last_error
     stats = {created, updated, failed, skipped+reasons}

  4. ORDER/SALE phase (channels → hub):
     orders = ebay.fulfillment.getOrders(filter=last_7d) / etsy.getReceipts
     for each new order line matching an external_id:
       closeBook(product, sold_via=platform)  # W3, idempotent by order id

  finish_sync_run(run, stats)
```

#### The oversell guard (W3) as the industry pattern [D]

Sellbrite's marketing inversion of our W3: "When a product sells on one channel,
inventory quantities are updated across your other channels to help prevent
overselling" [D]. HomeBase 3.2 has the book version [D]: "If you have more than one
copy… we'll automatically decrease the quantity online when an item is marked as
sold." The full close-the-book sequence, generalized:

```
closeBook(product, sold_via):
  product.quantity = 0; product.sold_at = now; product.sold_via = sold_via
  for each listing of product where status in (active, publishing, exported):
    enqueue('end_listing', {listing})            # withdraw offer / deactivate / (AbeBooks: next export marks gone)
  enqueue('update_shopify_inventory', {product}) # master stays accurate
  journal product_changes(run_id)
```

Idempotency and in-flight handling are where competitors fail (see Part 5, F-1/F-2):
the guard must key on the channel order ID so a double-reported sale doesn't fire
twice, and a sale arriving *while a publish job is mid-flight* must cancel or
immediately-end the fresh listing. ThePanel's jobs runner should check
`product.quantity == 0` at publish time and abort with reason `sold_before_publish`.

#### Error taxonomy and retry [I, from documented behavior]

| Error class | Detection | Retry policy | Operator surface |
|---|---|---|---|
| Transient API failure (5xx, rate limit) | HTTP status | backoff ×3 (ThePanel `max_attempts=3`) | silent unless exhausted |
| Validation failure (missing image, bad category, condition unmapped) | 4xx with message | **no retry** — data problem | error badge + reason + "fix" link |
| Auth failure (token expired, revoked) | 401 | refresh token once, then stop | channel health card goes red; "reconnect" |
| Partial batch failure | per-item results | per-item | batch summary: "3 created, 1 failed, 4 skipped" (ThePanel W4 format) |
| Silent divergence (channel qty ≠ expected) | reconcile pass (rare among vendors) | push correction | drift report |

The marketplace-connect review catalog (Part 5) is essentially what happens when the
last two rows of this table are missing.

### 1.5 The matching / linking subsystem [D — Marketplace Connect]

For sellers who already have live marketplace listings. Marketplace Connect's flow is
the reference design, documented in detail:

**Candidate generation:** on connecting a marketplace with existing listings, the app
"searches your Shopify store to suggest a product match based on the product **SKU,
UPC, or title**" [D].

**Scoring buckets** [D]:
- **"Ready to list"** — confident match (SKU/UPC exact).
- **"Close match"** — probable (title similarity, partial identifiers).
- **"No match"** — nothing found in the store.

**Screen flow** [D]: Listings → marketplace dropdown → **Link listings** → click a
badge → rows of marketplace listings → **Approve all** (confident) or per-row
**Shopify SKU dropdown** → **Confirm match** → **Review matches** → **Link
listings**. From that moment "Marketplace Connect begins syncing orders and inventory
for your linked listings" [D].

**Link-state visibility** (LitCommerce) [D]: a chain icon per listing row; blue dot =
linked and syncing; red dot = unlinked and frozen ("price or quantity will not be
automatically updated"). Sellbrite's troubleshooting tree starts with "check the
linking of listings" [D, YouTube academy]. Unlinked listings are the #1 support
ticket category across all vendors [I].

**eBay adoption path** [D]: eBay's `bulkMigrateListings` converts existing Trading-API
listings into the Inventory API model — the API-level underpinning of every vendor's
link flow. Our future "adopt existing listings" feature would: pull channel listings →
SKU-match against `products` → three-bucket review UI → create `platform_listings`
rows with `external_id` backfilled → resume sync.

### 1.6 Rule systems: the full formula inventory

#### Marketplace Connect's documented rule set [D] — the most explicit in the industry

**Price adjustments** (per marketplace account, applied to future listings):
- **constant value** (set price to X), or
- **percentage increase/decrease** relative to Shopify catalog price, or
- **dollar increase/decrease**, or
- **price rounding** "if desired."

**Inventory adjustments** (same settings area) [D, with worked examples]:
- **fixed inventory value** — listing always shows N;
- **buffer** — "if you set a buffer of 2 when your store inventory is 5, the listing
  displays 3";
- **maximum quantity** — "if you set a maximum of 5, a maximum of 5 always displays,
  unless your store inventory drops below 5, in which case the listing displays the
  actual inventory."

For ThePanel's single-copy model, all three inventory modes collapse to identity
(qty 0/1) — but the *price* side maps directly onto `engines/pricing.js`:

| MC concept | ThePanel `price_modifier` | Note |
|---|---|---|
| constant value | (not needed) | could be added as `absolute` for repricing |
| percentage ± | `multiplier` | 1.10 = +10% |
| dollar ± | `fixed_fee` | MC adds/subtracts; ours adds (negative fixed_fee works) |
| rounding | `rounding: 'up_x99'` | ours rounds up to .99, never below input [code] |

**Other MC per-account defaults** [D]: shipping services; return policy (accepted?,
period, refund type, who pays return shipping); **auto categorization** (manual vs
automatic category assignment); **auto-list products** (automatically list new
products with defaults — our `sync_rules.auto_sync` is exactly this).

**Worked example (our engine, current code):** base $12.00, eBay rule
`{multiplier:1.10, min_price:5.0, rounding:'up_x99'}` → 12.00×1.10 = 13.20 → round
up to X.99 → **$13.99**; min_price floor re-checked after rounding [code]. Cost
guardrail rejects if price < cost with reason string [code] — the guardrail
competitors lack (see F-3 in Part 5).

#### Sellbrite pricing [D]

"Customized price rules for each channel or sync your pricing to match across
channels" [D]. Price sync is a channel-level toggle; Pricing Template vs Price Sync
are the two mechanisms [D]. Pricing rules live with inventory rules in channel
settings.

#### HomeBase PricePartner [D]

Bulk price adjustment over a selected subset or the whole catalog: **fixed amount,
percentage, or set-to value**. The manual sibling of a rules engine — ThePanel
equivalent would be a "reprice selection" bulk action (see 6.6).

#### Sellbrite inventory levels [D]

Three-level model: **available** (sellable), **reserved** (allocated to unshipped
orders), **on-hand** (physical), per warehouse. Channels are configured to show one
warehouse's stock or aggregated stock. FBA inventory appears "as soon as it is
received by Amazon" [D]. ThePanel's single-copy model: available = 1 − sold; reserved
reappears only as the transient between sale-detection and end-listings (UI signal,
not a column).

### 1.7 The data-ownership doctrine (single writer) [D]

Stated outright by Sellbrite [D]: *"Inventory Sync doesn't just allow you to make
quantity adjustments in one place, it means you have to. Adjusting inventory
quantities directly in one of your sales channels can interfere with syncing the
correct quantities, and can even cause you to oversell. Always make inventory
adjustments in Sellbrite."*

And by Shopify's setup guide [D]: *"It's important to have only one marketplace
connector app connected to avoid data conflicts."*

Two rules, one theorem: **exactly one writer per datum.** ThePanel's formulation:
Shopify is the single writer of product truth; the panel is the single writer of
channel listings; channels are the single reporter of sales; the operator is the
single writer of overrides (journaled in `product_changes`). The
`product_changes` overlay (`products` = truth mirror, manual edits stored only in
the journal) is this theorem implemented at the storage layer — stricter than any
competitor's UI-level locking.

---

## Part 2 — Platform-by-platform deep dives

### 2.1 Sellbrite (GoDaddy) — the reference UX

**Positioning:** standalone SaaS at app.sellbrite.com; your cart (Shopify,
BigCommerce, WooCommerce…) is one "channel" among many — the hub is Sellbrite's own
product catalog and inventory, *not* the cart. A dedicated flavored product
("Sellbrite for Shopify") exists with its own help track. Acquired by GoDaddy.

**Documented architecture invariants:**
- Products are imported from the cart into Sellbrite's catalog; marketplaces receive
  listings; marketplace orders import into Sellbrite and (for Shopify flavor) into
  Shopify.
- Inventory quantities live in Sellbrite (available/reserved/on-hand per warehouse);
  channel listing quantities are projections.
- SKUs do not have to match across channels, but "taking the time to clean up your
  SKUs is suggested prior to starting" [D] — SKU hygiene is the matching substrate.
- Bulk listing is capped **"up to 100 at a time per channel"** [D]. Even mature SaaS
  batches pushes; per-item results follow.
- Open API for 3PL/WMS integration [D].

**Onboarding [D]:** a "simple 3-step setup wizard helps you get your products into
Sellbrite, connect your channels, and sync your inventory." The help center's
go-live path is a numbered checklist (Step 1 … Step 7) that ends at "Step 6: Enable
Inventory Sync." The design lesson: onboarding is a *finite, numbered checklist that
terminates at sync-on* — not a tour, not a video, not a sandbox. Completion is a
state you reach.

**The listing-creation wizard [D] — step by step:**
1. Products > All Products. Filters: category, tag, quantity, more. The table shows
   **which products are already listed on which channels** (channel-presence
   columns).
2. Select products → **"List Product on Channel"** → pick a marketplace.
3. "Follow the guided steps to configure your listing settings. Sellbrite saves
   these settings as **Templates** so you won't have to repeat this process for
   future listings. For example, when configuring payment settings, you're building
   a **Payments & Returns Template** that stores your handling time, item location,
   return policy, and more." [D]
4. Draft listings are created per product.
5. "Once your draft listings are created, select **Publish** to send them to the
   marketplace." [D]

The wizard's side effect — reusable Templates — is the pattern: every guided flow
should leave behind a named, reusable configuration (our export flow's mode + rules
snapshot should save as a preset; see 6.6).

**Update flows [D] — two paths:**
- **Manual edit:** open the listing from the **Listings Manager**, edit, **Save &
  Publish**. "Keep in mind that any listing with Templates applied will have
  **locked fields**. To update those, you'll need to edit the Template or update
  your product data in Shopify." [D]
- **Via Templates:** "edit your product's title or description in Shopify and select
  Save. Sellbrite will pick up that change automatically and push it to all linked
  listings" [D]. Prices: apply a Pricing Template or enable Price Sync.

**Inventory sync semantics [D]:**
- Enable **per channel**; "if you want all of your channels to receive inventory
  from Sellbrite, make sure that it's enabled in each one."
- Cadence: **15 min on paid plans, 2 h on the free plan**.
- Requires **linked** listings; unlinked listings get no quantity updates.
- Single-writer doctrine (quoted in 1.7).

**Multi-warehouse [D]:** per-channel rules decide whether a listing shows one
warehouse's stock or aggregate stock; FBA and Flexport locations appear as
warehouses; FBA inventory syncs automatically as received.

**Failure modes:** see Part 5 (F-1 partial-batch, F-4 locked-field confusion).

**ThePanel borrow list (Sellbrite):**
1. Numbered setup checklist ending at "sync enabled" (6.6, component C-1).
2. Channel-presence columns on the product table (C-3).
3. Wizard-builds-reusable-template (C-5).
4. Locked-fields-with-affordance for Shopify-owned fields (C-6).
5. "100 at a time" batch honesty with per-item results (already our jobs design).
6. Published cadence ("every 15 min" / our "every 30 min") in the sync status card.

### 2.2 Shopify Marketplace Connect (formerly Codisto) — the embedded model

**Positioning:** Shopify's own first-party connector; runs inside the Shopify admin;
marketplace orders arrive as Shopify orders. Formerly Codisto (launched 2017),
acquired and rebranded [D: app-store listing].

**Supported channels [D]:** Amazon, eBay, Walmart, Target Plus (US). **Etsy: "New
connections to Etsy can't be made at this time"** [D] — existing connections
continue. No AbeBooks.

**Fees [D]:** free to install; "connecting and listing products on all supported
marketplaces" free; **unlimited manual order imports** free; the first **50 synced
orders/month free**, then a per-order fee (1%, capped $99/mo per the app-store
listing). The monetized event is *order sync*, not listing sync.

**Requirements [D]:** real (non-password-protected) online store; active payment
provider. Setup prerequisites per marketplace: verified seller account, store
policies visible on the marketplace, payout method/bank, shipping rates configured
marketplace-side. One-connector rule (quoted in 1.7).

**Connection flow [D]:** install → **Connect account** on a marketplace → marketplace
sign-in/OAuth → done. More marketplaces via **Connect marketplace**. Disconnect
lives in Settings → Accounts → account → **Disconnect account** (with confirm
dialog). Settings → Accounts → *marketplace* → **New listings → Manage** exposes the
per-account defaults (below).

**Listings UI [D] — two modes:**
- **Single edit mode:** Listings → marketplace dropdown → click a product → "in the
  **Listing enabled** section, select **Enabled**, then complete the fields for each
  remaining section" → **Save**. The row-level Enabled toggle is the participation
  model: on/off per channel; the rest is field completion toward publishability.
- **Bulk editor [D]:** Listings → marketplace → **Bulk edit** → **Filters** (Status,
  Tag, SKU — "create product groups") → checkbox selection → set **Enabled** column
  → fill remaining columns → optionally **Columns** button to add more editable
  fields → **Save**. One grid, per-column edits, one commit. This is Shopify's
  bulk-edit grid applied to channel fields.

**eBay defaults (documented settings inventory) [D] — per eBay account, "New
listings" section:**
- **Price adjustments:** constant value | percentage ± | dollar ±, plus optional
  price rounding.
- **Inventory adjustments:** fixed value | buffer | maximum (worked examples in 1.6).
- **Shipping:** choose shipping services for listings.
- **Return policy:** returns accepted?, period, refund type, who pays return
  shipping.
- **Auto categorization:** manual categories vs automatic ("Marketplace Connect …
  automatically categorize listings into the most relevant eBay categories").
- **Auto-list products:** automatically list products with the chosen defaults.
- Defaults apply to **future** listings only; existing listings unaffected [D].
- **Condition definitions:** required per listing; links to eBay's condition ID
  values [D] — the exact enum our adapter must map (`new → 1000 New`,
  `like_new → 1500 Like New`… per eBay metadata).
- **Image sync off-switch:** in the bulk editor, add column **Other > Catalog image
  sync** → select all → Off → Save [D]. Manage images channel-side instead of
  syncing from Shopify — a field-level escape hatch from the ownership doctrine.

**Link flow:** documented in 1.5 (badges, Approve all, Confirm match, Review
matches, and the irreversible eBay rules decision — "Use eBay settings" vs "Use
Marketplace Connect settings… the original settings for the eBay listing can't be
restored" [D]).

**Failure catalog [D via reviews, Oct 2026]:** price corruption to zero; items
listed then removed; eBay sync dead ~a month with support claiming fixes; image
upload failures; degradation above ~200 items. 4.1★/2,124 reviews, 14% one-star.
Root-cause analysis in Part 5. The operational lesson that matters most: **per-item
error visibility beats batch-level status**, and **computed-price guardrails are not
optional**.

**ThePanel borrow list (Marketplace Connect):** row-level Enabled (have it:
`sync_enabled`); bulk grid + Columns picker (C-4); filters-as-groups; irreversible
warnings (C-8); the per-account defaults card as the shape of our per-platform
settings (price adjustments + policies + auto-list toggle — nearly 1:1 with our
`sync_rules` fields); condition-enum mapping table in settings.

### 2.3 LitCommerce — the channel-native SaaS

**Positioning:** SaaS hub; "Main Store" is your webstore (Shopify/Woo/Wix/
BigCommerce) or, if none, LitCommerce itself [D]. 10+ marketplace spokes including
eBay, Etsy, Amazon, Walmart, TikTok Shop, Reverb, Faire, Facebook, Temu.

**Two documented onboarding paths** (a genuinely superior design):

*Path A — webstore-first [D]:*
1. **Set your online store as the Main Store** ("source of truth").
2. **Connect your first sales channel** (marketplace sign-in + authorize). One
   channel during initial setup; more from the dashboard afterward.
3. **List products:** select products → "created as **Drafts** on the channel… go to
   that channel to continue to edit/provide required information to your listings…
   before going live." AI Description Generator available for Etsy & eBay.
4. (If already selling there) **Import listings & create on Main Store:** import
   channel listings → auto-link by SKU/UPC → "Create on Shopify" for unmatched.
5. **Link unlinked listings** (chain icon: blue dot linked / red dot not linked).
6. **Enable price and inventory sync** (15-min cycle; channel-specific rules for
   different price/quantity per platform; "depending on the sales channel, also
   SKU, image, title & description" [D]).
7. **Enable order sync** — "your eCommerce platform store will instantly receive
   all order details from every sales channel" [D].

*Path B — marketplace-first (crosslisting) [D]:* choose the marketplace you already
sell on → connect → define Main Store (or **"Skip, I don't have any of these"** —
LitCommerce becomes the hub) → build the central catalog by **importing marketplace
listings** (with filters) or **adding products** (AI listing generator; CSV/XML/
Google-Sheets import with AI-mapped headers) → connect more marketplaces →
cross-list (drafts again) → link (auto by SKU, manual otherwise) → enable syncs →
manage orders and performance from the dashboard.

**Sync [D]:** price sync, inventory sync, order sync — each an independent per-channel
switch, each on the 15-minute cycle; price/inventory rules share one settings page
per channel; Woo gets a real-time LiveSync plugin; shop can sync "multiple Shopify
and WooCommerce stores" (multi-hub).

**Channel-native depth [D] — their differentiator thesis:** each integration is
purpose-built rather than one generic connector stretched: eBay (auto-relist;
eBay-compliant mobile templates; business-policy bulk mapping), Etsy (digital +
physical listings; custom personalization requests; AI description polish), Amazon
(list without ASIN via GTIN exemption; FBA & MFN orders; in-app offers), TikTok Shop
(multi-region; auto category suggestions; multi-warehouse mapping). ThePanel's
thesis is identical at book scale: per-platform rule cards (Etsy vintage filter,
AbeBooks condition filter) instead of a generic connector.

**Feed tool [D]:** the same listing-composition layer emits product feeds to 300+
ad platforms (CSV/XML/JSON, multi-currency, "LLMs.txt for AI search visibility").
Reminder: the composer is reusable beyond marketplaces — our AbeBooks TSV is a feed
in exactly this sense.

**ThePanel borrow list (LitCommerce):** per-feature sync switches on one rules card
(C-12); chain-dot link-state grammar → our status badges (C-3); published cadence +
"next sync at" (C-9); the two-directional onboarding mental model (ours is
webstore-first only — correct for now); drafts-before-live as the universal push
shape.

### 2.4 CedCommerce Etsy Integration — the per-channel Shopify app pattern

**Positioning:** one app per marketplace on the Shopify App Store; the Etsy app is
the leading Etsy connector: 4.5★/1,250 reviews, Built-for-Shopify badge [D].

**Documented capability set [D]:** two-way real-time sync of products, inventory,
orders, pricing; automatic linking of Etsy listings to Shopify products; bulk list/
edit; **multiple Etsy accounts**; product segmentation by category/attribute/
shipping; VAT transfer for VAT-inclusive Etsy prices "without duplicating tax";
templates for shipping/tax/inventory; profiles/advanced mapping praised in reviews
as "huge time-savers for large catalogs."

**Profiles [D + reviews]:** mapping templates deciding how a Shopify product becomes
an Etsy listing (category, type, attributes, shipping profile, tags); segmentation
rules assign products to profiles in bulk. This is the "generic product →
channel-shaped listing" layer as a first-class user-editable object. ThePanel's
`listingComposer.js` hardcodes book-shaped composition; when eBay/Etsy arrive, the
per-channel profile (category id, condition enum, policy IDs) must become an
editable settings object, not code constants.

**Pricing [D]:** Beginner $9/mo (10 products, 1 account, unlimited import,
inventory sync, email support); Growth $59/mo (1,000 listings, 500 orders/mo,
2 accounts, 500 Pins/mo, chat+meeting support). Plus paid onboarding/customization
at scale (documented in a review: ~$2.5k initial, ~$6.5k renewal).

**Documented failure [D, review]:** after 1.5 years and ~$9k/yr across Etsy/eBay/
TikTok apps: **overselling caused by inventory sync failure**, unresponsive
escalation, unclear recurring "customization" charges. Root cause per Part 5 F-2:
two-way inventory sync + no idempotent single-writer. ThePanel's one-way master
model is the structural answer.

**ThePanel borrow list (CedCommerce):** profile-as-editable-object (C-13);
segmentation rules ≈ our `sync_rules.conditions` (already stronger: tags_any/all,
year, condition, price bounds); multiple accounts per platform is a non-goal.

### 2.5 HomeBase 3.2 and the AbeBooks world — the book-native reference

**HomeBase 3.2** [D] — free Windows app (Win 7/8/10/11), explicitly **single-computer
("not designed to be networked")**; authenticates to AbeBooks with **user ID + API
key** (3.2 replaced email/password). ThePanel is, in effect, HomeBase rebuilt with
Shopify as the catalog source and live marketplace channels added.

Documented feature inventory [D]:
- **Inventory management:** "Upload inventory directly to AbeBooks, or export files
  for FTP and other online venues" — dual-mode (private direct upload + file
  export).
- **Multi-select:** edit or delete multiple listings at once — bulk ops as a
  first-class verb.
- **PricePartner:** adjust prices of a selected subset or all listings by **fixed
  amount, percentage, or set to the same value**.
- **ISBN lookup** (registered booksellers): find ISBNs in the database and pick the
  best match — the ancestor of our OpenLibrary enrichment.
- **Quantity:** multi-copy with auto-decrement online when marked sold — the
  book-world W3.
- **Import formats [D]:** HomeBase 2, Alibris, Amazon Standard Book loader,
  BookRouter, BookTrakker, **UIEE**, ZVAB, plus custom delimited files.

**AbeBooks ingestion [D]:** FTPS (TLS 1.2 required) is the file-based inventory
processing option — use FTPS-capable software (FileZilla-class) or an inventory
program with FTPS connectivity. This is the automation ceiling for any third party:
**scheduled FTPS upload of a bulk file.** HomeBase's direct upload uses a private,
non-public API surface [I from the user-ID+API-key design].

**ThePanel borrow list (HomeBase):** PricePartner → "reprice selection" bulk action
(± amount/percent, set-to) running through the pricing engine + `product_changes`
journal (C-7); multi-select verbs already exist in our selection framework; the
HomeBase-compatible file layout we already emit in `listingComposer.js`
(BookNo/ISBN/Title/Author/Publisher/Year/Binding/Condition/Price/Qty/Description;
condition map: new→New, like_new→Fine, very_good→Very Good, good→Good,
acceptable→Fair [code]). Future automation: an AbeBooks "FTPS delivery" job type
using the same vault + export service — no model change, just a transport.

### 2.6 The removed eBay app and the one-connector rule

The official eBay Shopify app page now reads "This app is not currently available on
the Shopify App Store" [D], and its Zendesk help center is decommissioned [D — the
FAQ URL returns "help center closed"]. Combined with Marketplace Connect's eBay
outage reports and Shopify's one-connector warning [D], the picture: **eBay↔Shopify
today is third-party-only, and the third parties are shaky.** Phase 3 lands ThePanel
exactly in the gap, for one operator, with no order fees.

---

## Part 3 — Channel API reference (the contracts our adapters must implement)

This part is the engineering spec extracted from the platform docs. An adapter that
implements these sequences satisfies everything the SaaS vendors do.

### 3.1 eBay — Sell Inventory API + Account API + Fulfillment API

#### Object model [D]

- **Location** (merchant-defined `merchantLocationKey`, address) — must exist before
  publishing. Address needs city+state/province+country **or** postal code+country.
- **Inventory Item** — keyed by **seller-defined SKU, unique across the seller's
  inventory** [D]. Carries product (title, description, aspects, imageUrls),
  condition, availability (`shipToLocationAvailability.quantity`).
- **Offer** — what becomes a live listing. Must reference marketplace, inventory
  item (SKU), location, category ID; carries quantity, description, price; **must
  reference payment + fulfillment + return business policies** [D].
- **Inventory Item Group** — variations (irrelevant for single-copy books; one
  SKU = one book = one offer).

#### Publish-required fields [D — complete, from the publishing-offers guide]

**Location:** `merchantLocationKey`; `location.address` with (city +
stateOrProvince + country) or (postalCode + country).

**Inventory Item:** `sku`; `availability.shipToLocationAvailability.quantity`
(required here or on the offer — the **offer quantity overrides the item quantity**
[D]); `condition`; `product.title`, `product.description`, `product.aspects`,
`product.imageUrls` (at least one image must exist before publish [D]).

**Offer:** `offerId`; `sku`; `availableQuantity` (0 ⇒ out-of-stock listing); `marketplaceId`;
`format`; `categoryId`; `listingPolicies` → `paymentPolicyId` + `returnPolicyId` +
`fulfillmentPolicyId` (all three required, created via Account API after opting the
seller into business policies [D]); `merchantLocationKey`; `pricingSummary.price`;
`listingDuration`.

Publish call note [D]: fields optional at create time **become required at publish**
— e.g., an offer without `merchantLocationKey` passes `createOffer` but fails
`publishOffer`. Design adapters to validate the full publish set *before* the first
call and surface misses as skip-reasons, not API errors.

#### Sequence: listing one book (adapter contract)

```
1. (once per account) Account API: optInToProgram(business policies);
   create fulfillment/return/payment policies; store their IDs in vault.
2. (once) createInventoryLocation(merchantLocationKey, address)         → vault
3. per book:
   a. createOrReplaceInventoryItem(sku=variant SKU, condition=mapped,
      product={title, description (sanitized HTML), aspects {ISBN, Author, Year,
      Binding, Publisher}, imageUrls=Shopify image URLs},
      availability.shipToLocationAvailability.quantity=1)
   b. createOffer(sku, marketplaceId=EBAY_US, format=FIXED_PRICE,
      categoryId=267 (Books), listingPolicies={...IDs}, merchantLocationKey,
      pricingSummary.price=computed price, listingDuration=GTC,
      availableQuantity=1)
   c. publishOffer(offerId) → listingId; store external_id=offerId,
      platform_url from listingId
   d. (verify) GetItem or getOffers → confirm live
4. update: updateOffer (price/quantity) or updateInventoryItem (content)
5. end: withdrawOffer(offerId) → status='ended'
6. sale detection: Fulfillment API getOrders (poll on cadence; filter by
   lastModifiedDate) → order lines carry SKU/lineItemIds → closeBook()
```

#### Operational facts [D]

- **Seller Hub edit lock-out:** "listings created through the Inventory API cannot
  be edited through Seller Hub or any other listing platform" — panel-only
  management is enforced by eBay itself.
- **Out-of-Stock Control:** seller preference (My eBay or Trading API
  `SetUserPreferences`) keeps 0-qty listings alive/hidden ≤ 90 days — only relevant
  if multi-copy ever ships.
- **Real-time Inventory Check:** register an endpoint eBay calls at checkout to
  verify quantity — the strongest oversell guard; requires public HTTPS (post-tunnel
  Phase 5).
- **`bulkMigrateListings`:** converts existing listings into the Inventory model —
  the underpinning of any future "adopt my existing listings" feature.
- **Auth:** OAuth user token + refresh token (Phase 3 gate: developer account,
  keyset, redirect). Sell APIs also expose `bulkPublishOffer` for batched pushes.
- Fees (from our plan, reflected in the default eBay pricing rule): ~13% final
  value + $0.30 — kept in the rule, never hardcoded.

### 3.2 Etsy — Open API v3

#### Auth & headers [D]

- OAuth 2 token with scopes `listings_r`, `listings_w` (+ `listings_d` for deletes).
- Every request also carries `x-api-key: <keystring>:<shared secret>` [D].
- App approval required before production (apply early — plan already says so).

#### State machine [D] — see 1.3 table. Single-copy consequences:
- A sale ⇒ `sold_out` ⇒ only action is `deleteListing` ⇒ W3 end-listing for Etsy is
  terminal.
- Published requires ≥1 image and >0 unsold inventory.

#### `createDraftListing` minimum body [D]

`quantity, title, description, price, who_made, when_made, taxonomy_id` —
plus `image_ids` (required for active), `shipping_profile_id` and
`readiness_state_id` (required for physical). Draft validation has been relaxed
[D, GitHub discussion #1524]: physical drafts no longer hard-require the shipping
profile at draft time — it is required to activate. Price unit: **shop default
currency in cents** (US pennies in the tutorial example) [D] — the classic adapter
bug; convert dollars → integer cents.

#### Book field mapping (ThePanel-specific)

| Etsy field | Source | Rule |
|---|---|---|
| `quantity` | — | literal 1 (single copy) |
| `title` | `listingComposer` title (title_override ∥ product.title) | 140-char Etsy limit |
| `description` | `listingComposer` description (base + notes), sanitized | — |
| `price` | pricing engine × 100, integer cents | Etsy $0.20 listing fee in rule |
| `who_made` | — | `someone_else` (books) |
| `when_made` | `metadata.year` | vintage enum (e.g. `1970s`); vintage rule enforces 20+ years |
| `taxonomy_id` | book taxonomy constant | set once in profile |
| `shipping_profile_id` | shop shipping profile | setup step, stored in vault/settings |
| `readiness_state_id` | processing profile | setup step |
| `image_ids` / `uploadListingImage` | Shopify images (download → multipart) | ≥1 required |

#### Sequence: listing one book

```
1. (once) create shipping profile + return policy + processing profile (shop
   management endpoints or Etsy UI) → store IDs
2. per book:
   a. createDraftListing(shop_id, fields above)          → listing_id (state=draft)
   b. for each image: uploadListingImage(shop_id, listing_id, binary)   (multipart)
      — or reference existing shop image_ids
   c. updateListing(shop_id, listing_id, {state: 'active'})  → live
3. update: updateListing (content/price) / updateListingInventory (quantity)
4. sale: order/receipt sync → closeBook(); Etsy listing is sold_out → deleteListing
```

#### Inventory model [D] (for completeness)

`products[]` → `offerings[]` (price, quantity, is_enabled, readiness_state_id) and
`property_values[]` with scale/value IDs. **Single-copy books collapse this to one
product, one offering, quantity 1, no properties.** Variation limits (70/4900/2500/
400) are documented but irrelevant. `updateListingInventory` is PUT-replace — the
whole products array must be sent every time [D]; for us that's a constant
one-element array.

#### Webhooks [D]

V3 documents webhooks (essentials) — later optimization, same stance as Shopify
webhooks: polling first (15–30 min class), webhooks when proven insufficient.

### 3.3 Shopify (master side) — already implemented

See `documentation/note_on_shopify_key.md`: client-credentials grant, ~24 h token,
auto-refresh 60 s before expiry, GraphQL Admin API 2026-07, scopes
read/write_products, read/write_inventory, read_orders. Our adapter's Shopify
surface (poll + W3 quantity write-back) is done; nothing from the competitors
suggests changing it (Marketplace Connect itself treats Shopify as live data).

### 3.4 AbeBooks — the file contract [D]

- Format: tab-separated bulk file, HomeBase-style column layout (our
  `listingComposer.js` columns) or UIEE-class formats; imported by AbeBooks' file
  processor.
- Transport: manual upload through bookseller account, or **FTPS with TLS 1.2** [D].
- Semantics: full or delta uploads; AbeBooks reconciles by BookNo/ISBN; deletions
  expressed by omitting/zeroing records per their spec (delta logic is ours:
  `last_exported_at` watermark + `product_changes` staleness check — already built).
- No public API [D]. Automation ceiling: scheduled FTPS delivery of the same file
  the export service generates today.

---

## Part 4 — UI & UX analysis

### 4.1 Information architecture compared

| Vendor | Primary nav | Context switching | Orders | Errors surface |
|---|---|---|---|---|
| Sellbrite | Products · Listings · Orders · Inventory · Reports · Settings | Listings Manager scoped per channel | central dashboard | per-listing badges + troubleshooting tree |
| Marketplace Connect | Listings (embedded in Shopify admin) | **marketplace dropdown** at top of Listings | in Shopify admin orders | bulk-editor status column; app chat |
| LitCommerce | All Products · per-channel sections · Orders · Insights · Settings | channel nav sections | unified dashboard | chain-dot on rows; per-channel health |
| HomeBase | single book table | — | — | in-table statuses |

Consensus shape: **one catalog view + one per-channel listing context + an orders/
errors surface + settings.** ThePanel's frontend (overview + channel views + settings
+ logs) already matches; channel views are Marketplace Connect's dropdown collapsed
into tabs — equivalent.

### 4.2 The thirteen patterns (C-1…C-13), with wireframes

Each pattern is battle-proven at ≥2 vendors; references appear in Part 2 borrow
lists and Part 6 adoption plan.

**C-1 — Numbered setup checklist that ends at "sync on."** [Sellbrite go-live
steps; LitCommerce 7-step]
```
┌ Getting started ──────────────────────────────────────┐
│ ① Connect Shopify            ✓  (Shopify: connected)  │
│ ② First catalog sync         ✓  (1,412 books)         │
│ ③ Review metadata            ◐  37 need attention →   │
│ ④ Configure channel rules    ◐  eBay rule open →      │
│ ⑤ Store eBay credentials     ○                        │
│ ⑥ Test connection            ○                        │
│ ⑦ First push (5 books)       ○                        │
└───────────────────────────────────────────────────────┘   persisted per-step
```
Completion state stored in settings; each step deep-links to the real screen.

**C-2 — Marketplace dropdown / channel tabs.** Marketplace Connect: one Listings
surface, channel chosen by dropdown; filters (Status/Tag/SKU) persist per channel.

**C-3 — Channel-presence badges per product row.** Sellbrite ("see which are
already listed on specific channels") + LitCommerce chain-dot grammar. One chip per
platform on every book row:
```
│ ☐ │ Title                │ Price │ [eB ●] [Et ○] [AB ✓] │ … │
```
`●` green = active/synced · `◐` amber = draft/publishing/stale · `✕` red = error ·
`○` gray = not listed/ruled out · `✓` blue = exported (AbeBooks) · `∅` = sold.
Hover = state + last-synced timestamp + error text. Click = filter to that state.

**C-4 — Bulk grid with Filters + Columns picker.** [Marketplace Connect Bulk edit]
Checkbox select-all/many → per-column edits (including the Enabled column) → one
Save. Columns button adds fields. Our overview's selection framework + bulk bar is
the toolbar; the incremental piece is editable columns and a column chooser.

**C-5 — Wizard that leaves reusable config behind.** [Sellbrite Templates] Every
guided flow (export, push, notes-template) ends with "save these choices as a
preset" → named preset row (mode, rules snapshot, template) reusable from the bulk
bar.

**C-6 — Locked fields with affordance.** [Sellbrite "locked fields"] Shopify-owned
fields render locked with a lock glyph and "Edit in Shopify ↗" (or "Add local
override…" which writes to the `product_changes` overlay). Makes the ownership
doctrine visible instead of enforced by errors.

**C-7 — PricePartner bulk reprice.** [HomeBase] Selection → "Reprice…" →
{± amount | ± % | set to} applied through the pricing engine and journaled into
`product_changes`; preview diff before commit (C-8 discipline).

**C-8 — Irreversible-action warnings.** [Marketplace Connect: "the original
settings can't be restored"] Applied to: delist-everywhere, export generate (marks
books `exported`), bulk log purge, reprice commit. Pattern: name what changes,
show the count, name what cannot be undone.

**C-9 — Published cadence + next-sync clock.** [LitCommerce "we put a number on
it"] Sync status card: "Shopify poll · every 30 min · next 14:32 · last run 14:02:
3 created, 1 failed →". Boring, trust-building, one API call.

**C-10 — Error queue as first-class filter.** One chip on every screen:
"Needs attention (12)" aggregating error-status books + exhausted jobs +
`metadata_status='missing'` books blocked by rules. Every vendor converges here
because support costs force it.

**C-11 — Two-phase push with preview.** [Sellbrite drafts+Publish; Etsy/eBay APIs]
Assemble → preview table with per-row problems (skip reasons) → publish as per-item
jobs. ThePanel already has this shape for AbeBooks (`export/preview` then
`export/generate`); generalize it to eBay/Etsy pushes.

**C-12 — One rules card per channel.** [LitCommerce: price + inventory rules on the
same page; Marketplace Connect: one "New listings" defaults card] Fields: enabled
+ auto-list toggles; price adjustments (multiplier/fixed/min/rounding); inventory
options (n/a for 0/1); channel filters (conditions, year, tags); separate **price
push** and **stock push** switches; policies/defaults (category, condition map,
policy IDs once eBay lands).

**C-13 — Profile as editable object.** [CedCommerce profiles] The channel-specific
mapping (category, condition enum, taxonomy, policy IDs) is data in settings, not
code constants — editable, versioned, exportable.

**(Future) C-14 — Link/adopt flow.** [Marketplace Connect] Badged match review:
Ready to list / Close match / No match → Approve all / Confirm match per row →
Review matches → Link. Only needed if existing eBay/Etsy listings must be adopted;
filed for Phase 5+.

### 4.3 Interaction-state matrix [I]

| State | Product table | Channel view | Sync card |
|---|---|---|---|
| Empty (no data) | "No books yet — connect Shopify and sync" + CTA | "Channel not connected" + vault CTA | "Never synced" |
| Loading | skeleton rows | skeleton | spinner + last-known values grayed |
| Stale (sync running) | badges dimmed, "syncing…" chip | read-only banner | progress + per-item ticks |
| Error | red badge + row-level reason | skip-reason list | red banner + retry CTA |
| Partial success | amber badges per row | summary: "3 created, 1 failed, 4 skipped (metadata missing)" [our W4 format] | stats row |

### 4.4 Microcopy patterns [D-derived]

- Cadence as a number, not a vibe: "syncs every 15 minutes" (LitCommerce) → ours:
  "polls Shopify every 30 minutes; next run 14:32."
- Irreversibility named plainly: "the original settings for the eBay listing can't
  be restored" (Marketplace Connect) → ours: "This marks 214 books as exported and
  stamps last-exported times. It can't be undone per-book."
- Doctrine as instruction: "Always make inventory adjustments in Sellbrite" →
  ours: "Stock comes from Shopify. Mark sales here; edit stock in Shopify."
- Confidence labels, not jargon: "Ready to list / Close match / No match" — for any
  future match UI; today: "Eligible / Skipped: vintage rule / Needs metadata."

### 4.5 Anti-patterns (observed) → our countermeasures

1. Batch-level red/green for pushes (all three vendors at their worst) → per-item
   results + skip reasons (C-11, jobs design).
2. Silent price computation without guardrails (MC zero-price bug) → pricing engine
   floors + cost guard + preview diff (already coded in `engines/pricing.js`).
3. Locked fields with no explanation → C-6 affordance.
4. Inventory editable both places → doctrine copy + channel-side quantities
   read-only in our UI (we never render an editable channel qty).
5. Unlinked/frozen listings invisible → we can't be unlinked (we create every
   listing), but the same visibility budget goes to error/stale badges (C-3).

---

## Part 5 — Failure-mode catalog

Symptom → root cause → detection → prevention → ThePanel mitigation. Symptoms 1–5
are documented from Marketplace Connect/CedCommerce reviews (Oct 2026); causes are
inferred from the documented architectures.

| # | Symptom [D] | Root cause [I] | Detection | Prevention | ThePanel mitigation |
|---|---|---|---|---|---|
| F-1 | "Lists items then removes them"; users discover failures late | partial batch failure reported at batch level; no per-item surface | per-item job results | per-item statuses + summary counts (W4 format) | jobs table + error badges + C-10 queue (built/designed) |
| F-2 | Overselling despite paying for sync (CedCommerce) | two writers to inventory; channel-side edits race the sync engine | reconcile pass; order-id dedupe | single-writer doctrine [D] | Shopify master + 0/1 qty + closeBook() keyed by channel order id |
| F-3 | Prices reduced to zero (MC) | unguarded computed price (0-qty or 0-price source data flowed to channel) | price sanity check pre-push | min_price floor, cost guard, ceiling | `computePrice` guardrails + preview diff (C-11) before any push |
| F-4 | "Chokes uploading images" (MC) | image push not chunked/verified; Shopify CDN URLs mass-fetched | per-image job result | fetch-verify-retry per image | eBay takes URLs directly (3.1-a); Etsy upload per image with job retry (3.2-b) |
| F-5 | Degrades above ~200 listings (MC) | monolithic batch transactions, no pagination | load testing at catalog scale | SQLite + paginated SQL; our catalog is ~1.5k rows — trivial | non-issue by architecture; keep queries paginated (logs panel already is) |
| F-6 | Integration dead for a month "despite assurances" (MC eBay) | external API change; no health signal to users | channel health check on cadence | version-pinned APIs + connection test on every sync | credential vault `last_validated_at` + sync-run status; alert on N consecutive failures |
| F-7 | Oversell from inventory desync (CedCommerce premium plan) | link table drift; unlinked listings frozen silently [D mechanism] | link-state per row (red dot) | link state visible (LitCommerce) | we own every listing row; statuses replace link states |
| F-8 | Renewal/customization fee shock (CedCommerce review) | services sold as software | — | — | non-applicable (local, free); note as market positioning |

Meta-lesson: every F-row is a *visibility* failure first and a *data* failure
second. ThePanel's logs panel + product_changes journal is over-provisioned
relative to every competitor here — that is the moat, keep investing in it.

---

## Part 6 — Application to ThePanel (grounded in the actual code)

### 6.1 Current state (verified in repo, 2026-10-16)

Schema (`backend/migrate-sqlite.js`):
- `products` — Shopify mirror with `sold_at/sold_via`, `metadata_status`,
  book condition CHECK, `metadata` JSON. Matches the universal Product entity.
- `platform_listings` — `platform_listing_id`, `status ∈ (draft, exported, active,
  sold, error, delisted)`, `external_price`, `notes`, `title_override`,
  **`sync_enabled`** (C-2/Enabled already present), `last_synced_at`,
  `last_exported_at`, `error_message`, `UNIQUE(product_id, platform)`.
- `sync_rules` — per-platform `enabled`, `auto_sync`, `conditions` JSON, seeded
  defaults matching the plan (eBay 1.10/min 5; Etsy 1.20/min 10/vintage; AbeBooks
  1.15/min 4.5/condition filter).
- `sync_logs`, `product_changes` (v4: platform scope + run_id), `platform_credentials`
  (AES-256-GCM vault), `jobs` (types: list, update, end_listing, sync_shopify,
  export_abebooks, backfill_metadata; attempts/max_attempts/next_run_at).

Engines/services: `engines/pricing.js` (formula + up_x99 rounding + min/cost
guardrails, pure), `engines/rules.js`, `services/listingComposer.js`
(AbeBooks condition map, template variables, HTML sanitizer, plain-text
derivation), `services/metadata/*` (tagParser, OpenLibrary, status),
`services/abebooksExportService.js` (full/delta/selection + preview), jobs
runner/handlers, credential/changeLog/syncLog/job/product/platformListing/rules
services. Routes: sync, shopify, settings, rules, products, logs, jobs, abebooks.

Assessment vs the universal architecture: **ThePanel already implements entities 1–5
and the journal layer competitors lack.** The gaps are the eBay/Etsy adapters
(Phase 3/4, contract in Part 3), the transient states, per-feature push switches,
and the UX patterns below.

### 6.2 Gap list (pattern → current state → change)

| Pattern | Current | Change |
|---|---|---|
| C-1 setup checklist | none | settings row + Getting-started card (7 steps, persisted) |
| C-3 channel badges | overview has per-platform info; unify to badge grammar | one chip per platform per row, state colors, click-to-filter |
| C-4 bulk grid | selection + bulk bar exist | add column chooser; per-column edit for enabled/price/notes |
| C-5 presets | export modes are parameters, not saved presets | named presets table or JSON in settings |
| C-6 locked fields | overlay works, UI affordance unclear | lock glyph + "edit in Shopify / add override" on Shopify-owned fields |
| C-7 reprice selection | pricing engine only (rules-driven) | bulk action ±/set-to via engine + journal + preview |
| C-8 irreversible warnings | purge endpoints require filter [plan] | extend to export generate, delist-everywhere, reprice commit |
| C-9 sync clock | manual "Sync now" | sync status card with cadence + next-run + last stats |
| C-10 error queue | error badges planned | aggregate chip: error books + failed jobs + blocked-by-metadata |
| C-11 two-phase push | AbeBooks preview/generate only | same shape for eBay/Etsy: compose → preview table → per-item publish jobs |
| C-12 rules card | rules editor planned | include **separate price-push and stock-push switches** per platform (new) |
| C-13 profile object | composer constants | per-channel profile in settings (category, condition map, policy IDs) |

### 6.3 Schema evolution (minimal, additive)

```sql
-- transient publish state (C-11): job owns listing between click and API confirm
ALTER TABLE platform_listings ... status IN (..., 'publishing');  -- + CHECK update

-- per-feature push switches (LitCommerce/Sellbrite matrix)
-- store in sync_rules.conditions or add columns:
ALTER TABLE sync_rules ADD COLUMN price_push INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sync_rules ADD COLUMN stock_push INTEGER NOT NULL DEFAULT 1;

-- sale idempotency (F-2): record channel order ids that already closed a book
CREATE TABLE IF NOT EXISTS channel_orders (
  platform TEXT NOT NULL, external_order_id TEXT NOT NULL,
  product_id TEXT NOT NULL, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (platform, external_order_id)
);

-- job types for W3 fan-out + future FTPS delivery
-- jobs.type CHECK += ('update_shopify_inventory', 'mark_sold', 'deliver_abebooks_ftps')
```

`sync_enabled` already exists — no change. `enabled`-at-rule-level exists
(`sync_rules.enabled`). The dual semantics (rule = should, listing = may) match
Marketplace Connect's model exactly; document it in the plan's schema section.

### 6.4 Adapter contract (from Part 3)

```js
// backend/src/adapters/ebayAdapter.js · etsyAdapter.js
module.exports = {
  testConnection(credentials) -> {ok, shopName, expiresAt},
  createDraft(composedListing, profile) -> {externalId, url?},   // eBay: item+offer (unpublished); Etsy: draft listing
  publish(externalId, profile) -> {url},                          // eBay: publishOffer; Etsy: images+activate
  update(externalId, composedListing, profile) -> {},
  end(externalId) -> {},                                          // eBay: withdrawOffer; Etsy: deactivate (terminal if sold_out)
  fetchSales(since) -> [{orderId, sku, quantity, soldAt}],        // eBay: fulfillment getOrders; Etsy: receipts
}
// profile: {categoryId|taxonomyId, conditionMap, policyIds, shippingProfileId, ...}  // C-13 object
```

Job handlers `list`/`update`/`end_listing` call the adapter; `mark_sold` +
`update_shopify_inventory` implement closeBook() idempotently via `channel_orders`.

### 6.5 API additions (proposed)

- `POST /api/ebay/push/preview` · `POST /api/ebay/push/generate` (mirror the
  AbeBooks preview/generate shape — C-11 generalized)
- same pair for Etsy when Phase 4 lands
- `GET /api/status/sync` → cadence, next-run, last-run stats (C-9)
- `GET /api/attention` → aggregated needs-attention list (C-10)
- `POST /api/products/reprice` → PricePartner action (C-7)
- `POST /api/settings/presets` (C-5)

### 6.6 Adoption order (value per effort)

1. **C-9 + C-10** (sync status card + attention chip) — one endpoint, pure UI.
2. **`publishing` state + closeBook() idempotency** — small migration, big trust.
3. **C-3 badge grammar + C-6 locked fields** — visual doctrine.
4. **C-12 rules card with push switches** — settings edit.
5. **C-11 preview/publish for eBay** — lands with the Phase 3 adapter; C-13 profile
   object in the same stroke.
6. **C-7 reprice + C-5 presets + C-4 columns** — bulk polish.
7. **C-1 checklist** — ship last, when all steps exist for real.

---

## Part 7 — Sources (fetched 2026-10-16)

- support.sellbrite.com — "How does Sellbrite work?"; "Create Marketplace Listings";
  "Update Marketplace Listings"; "How Does Inventory Sync work?"; help-center index
  (collections: What is Sellbrite / Training & Setup / Sellbrite for Shopify)
- sellbrite.com — how-sellbrite-works (3-step wizard, 100-per-channel batch, SKU
  matching FAQ, price rules claim); inventory-management-software (available/
  reserved/on-hand; multi-warehouse; Excel-like editor; FBA)
- help.shopify.com — Marketplace Connect: setup (fees, requirements, one-connector
  rule, Etsy closed); list-and-edit-products (single edit; bulk editor; filters;
  columns); link-existing (match badges, Approve all, eBay rules irreversibility);
  products/manage/ebay (price adjustments, inventory adjustments w/ buffer & max
  examples, shipping, return policy, auto categorization, auto-list, condition
  definitions, image-sync off via bulk editor)
- litcommerce.com — how-it-works (both 7-step paths; Main Store selection incl.
  "Skip"; drafts; chain icon blue/red dots); homepage (15-min cycle; channel-native
  depth; feed tool)
- help.litcommerce.com — price-sync / inventory-sync step pages (15-min cadence,
  per-channel activation) via search snippets; academy video titles (rules on one
  page)
- developer.ebay.com — Inventory API overview (entities; business policies;
  publish-note mechanics; Seller Hub edit lock-out; Out-of-Stock Control;
  Real-time Inventory Check; bulkMigrateListings) and "Required fields for
  publishing an offer" (complete field lists for Location / Inventory Item / Offer)
- developer.etsy.com — Listings Tutorial (state machine; createDraftListing minimum
  fields; cents pricing; image upload + activation; inventory/offerings model;
  scopes; x-api-key format); github.com/etsy/open-api discussion #1524 (draft
  validation relaxation)
- abebooks.com — HomeBase 3.2 page (features, PricePartner, ISBN lookup, quantity
  auto-decrement, import formats, user-ID + API-key); support.abebooks.com
  inventory-management solutions (FTPS, TLS 1.2) via search snippets
- apps.shopify.com — Marketplace Connect listing + reviews (4.1★; failure reports);
  eBay app removed-app page; CedCommerce Etsy listing + reviews + pricing
- ThePanel repo — `backend/migrate-sqlite.js`, `backend/src/engines/pricing.js`,
  `backend/src/services/listingComposer.js`, `backend/src/config/database.js`,
  `documentation/plan.md`, `documentation/note_on_shopify_key.md`

