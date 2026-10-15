# ThePanel — Competitor & Predecessor Research

> Research date: 2026-10-16. Purpose: catalog the apps/platforms that already do
> "connect Shopify (or a master catalog) to eBay / Etsy / AbeBooks", learn their
> architecture and product patterns, and note the gaps ThePanel can exploit.
> Sources: live pages of Shopify App Store, sellbrite.com, litcommerce.com (fetched today),
> plus established knowledge of the book-tools space.

---

## 1. The big generic multichannel platforms

These are the "Shopify addons" you've seen. All are SaaS: your products live in
Shopify (or another cart), their cloud is the sync hub, marketplaces are spokes.

### 1.1 Shopify Marketplace Connect (formerly Codisto) — by Shopify itself
- **Channels:** Amazon, eBay, Walmart, Target Plus. **Not Etsy, not AbeBooks.**
- **Pricing:** free to install; 50 synced orders/mo free, then 1% per synced order, capped at $99/mo.
- **Model:** embedded in Shopify admin. You create listings *inside* the Shopify UI
  (a bulk listing editor); marketplace orders import back as Shopify orders.
- **Status (Oct 2026): 4.1★ over 2,124 reviews, and trending badly.** Recent 1-star
  reviews describe: prices being reduced to zero, items listed then removed, the
  eBay integration breaking outright for ~a month, image upload failures, problems
  above ~200 listings. This is Shopify's own app and it's still fragile at small scale.
- **Lesson for ThePanel:** even the platform owner ships a fragile eBay sync. A
  dedicated, single-operator, locally-controlled tool that *works* is a real
  alternative. Also: their fees are order-based — we pay nothing.

### 1.2 Sellbrite (GoDaddy)
- **Model:** standalone SaaS (not embedded in Shopify). Connects carts
  (Shopify, BigCommerce, WooCommerce) to marketplaces (Amazon, eBay, Etsy,
  Walmart, Google, Newegg, Sears…).
- **Core pitch:** "list in bulk with templates, auto-sync inventory to avoid
  overselling, ship from one interface." That's a 3-part feature set:
  **listing management → inventory sync → order fulfillment.**
- **Key patterns worth copying:**
  - **Listing templates** (per-channel field mapping: title, description, price, category).
  - **Overselling prevention is the headline feature** — not listing creation.
    For single-copy books this maps exactly to our W3 "a sale anywhere closes
    the book everywhere" flow. They treat inventory sync as the product; we should too.
  - Order/fulfillment layer we explicitly don't need (single operator, low volume).

### 1.3 LitCommerce
- **Model:** SaaS, hub = your store (Shopify/Wix/BigCommerce/…) or CSV import;
  spokes = eBay, Etsy, Amazon, TikTok Shop, Walmart, Reverb, Faire, Facebook, etc.
- **Pricing:** tiered by listing count/order volume.
- **Notable patterns:**
  - **15-minute sync cycle** as a published, concrete SLA. (We poll Shopify every
    30 min — same class of solution; webhooks are a later optimization, as planned.)
  - **Channel-specific price & quantity rules** — exactly our `sync_rules`
    multipliers/min prices, but generalized.
  - **Channel-native depth:** they market "each integration is purpose-built" —
    eBay business-policy mapping, Etsy vintage/digital handling, Amazon GTIN
    exemption. Validates ThePanel's per-channel adapters + per-channel rules
    (Etsy vintage filter, AbeBooks condition filter) over a one-size-fits-all connector.
  - **Cross-listing mode:** marketplace → other marketplaces without a webstore
    hub. ThePanel's hub is Shopify, but the pattern (one master, many spokes) is identical.
  - **AI listing generation** (image→listing, Etsy-tone descriptions) — current
    market direction; our `notes templates` with per-book variables are the
    deterministic, book-appropriate version of this.

### 1.4 CedCommerce (per-marketplace app suite)
- **Model:** a separate Shopify app per channel (Etsy Integration, eBay, TikTok…),
  $9–$59+/mo per channel, plus paid onboarding/customization at scale.
- **Etsy Integration ‑ CedCommerce: 4.5★, 1,250 reviews** — the leading Etsy app.
  Syncs products, inventory, orders, pricing both ways; bulk listing with
  **profiles** (mapping templates for attributes/shipping/tax); supports multiple
  Etsy accounts; handles VAT-inclusive price transfer.
- **Cautionary review pattern:** long-time merchant paying ~$6.5k/yr for Etsy +
  ~$9k across channels, still hit **overselling from inventory sync failure** —
  the exact failure ThePanel's single-copy model (quantity 0/1, sale closes
  everywhere) is structurally immune to, as long as W3 works.
- **Lesson:** the "profile/mapping template" concept is how they make bulk
  listing tractable at 1000s of SKUs. Our `sync_rules` + `notes templates` +
    `listingComposer.js` are the same idea, scoped to books.

### 1.5 Rithum (formerly ChannelAdvisor) / Feedonomics / GoDataFeed
- Enterprise feed & marketplace platforms (four/five-figure contracts). Relevant
  only as the top of the market: their core abstraction is **a normalized
  internal product record + per-channel feed transformations** — which is
  literally `products` table + `listingComposer.js` in ThePanel. Our architecture
  mirrors the enterprise pattern at a one-person scale.

---

## 2. Single-channel Shopify addons (the narrow competitors)

- **InfoShore Etsy Integration** (5.0★, 29 reviews, free plan): small app doing
  Etsy↔Shopify sync; proof that a focused single-channel tool can outrate the
  giants on satisfaction.
- **eBay's official Shopify app: REMOVED from the App Store.** The page now says
  "not currently available." Shopify's Marketplace Connect had a public month-long
  eBay outage. **The Shopify↔eBay space is currently served only by third parties —
  a real gap.**
- **inkFrog / CrazyLister class tools:** eBay listing templates & bulk management,
  often paired with a channel link. Not book-aware.

---

## 3. The book-specific world (AbeBooks & book inventory tools)

No Shopify app connects to AbeBooks. AbeBooks has **no public API** — integration
is bulk-file upload only, so everyone in this space works the same way ThePanel
does:

- **HomeBase 3.0** (AbeBooks' free inventory software): local database, edits
  books, exports the HomeBase-format bulk file you upload to AbeBooks. It's
  standalone — no Shopify, no eBay/Etsy. ThePanel = HomeBase + master catalog
  from Shopify + live channels.
- **FillZ** (AbeBooks' own multichannel service, subscription): pushes one book
  inventory to Amazon, eBay, etc., plus repricing. Cloud, book-aware, dated.
- **BookManager / Monsoon / library-POS tools:** bookseller back-office; none
  treat Shopify as master.
- **Key validation:** our AbeBooks decision (TSV export file, `listingComposer.js`
  HomeBase-style columns) is *the only possible* integration mode — every peer
  tool does file export. The plan's locked decision matches industry reality.

---

## 4. Generic iPaaS (Zapier, Make)

- Connect Shopify events to Etsy/eBay actions one zap at a time. No bulk listing
  semantics, no single-copy inventory logic, per-task pricing. Not competitors —
  but their trigger→action vocabulary ("Product created", "Order paid") is a good
  checklist for our `jobs` types and future webhooks.

---

## 5. What every successful platform in this space has in common

Regardless of size, all of them converge on the same architecture:

1. **One master product record** normalized internally (Shopify for us).
2. **Per-channel adapters** that speak each marketplace's API and rules
   (categories, policies, compliance filters like Etsy vintage).
3. **A mapping/profile/template layer** between master data and channel listing.
4. **Rules-based pricing** per channel (multipliers, minimums, rounding).
5. **A sync engine with a published cadence** (15 min … 30 min), polling first,
   webhooks later.
6. **Overselling prevention as the #1 trust feature** — sale on one channel
   de-lists everywhere. (Single-copy model makes this trivial for us: qty 0/1.)
7. **Error surfacing**: failed listings land in a "needs attention" queue with
   retry. Their 1-star reviews are all failure-of-this; our durable `jobs` table
   + error badges + logs panel is the same answer.
8. **Bulk operations**: selection + bulk list/edit/export. We already have the
   selection framework; pushes arrive with the eBay adapter.

## 6. Gaps ThePanel can exploit (learned from the above)

- **Shopify↔eBay is underserved right now** (official app gone; Marketplace
  Connect's eBay sync publicly broken). Our Phase 3 target is the weak spot.
- **Nobody is book-aware**: condition grading, ISBN-as-aspect, vintage-rule for
  Etsy, AbeBooks export — the generic tools make you hand-map all of it.
- **Nobody does AbeBooks from Shopify at all.**
- **Single-copy inventory** is a structural simplification none of the SaaS tools
  model; it makes the overselling problem (their biggest failure mode) a
  non-issue for us.
- **Local-first, no order-based fees**: at 1% of synced orders capped $99/mo,
  Marketplace Connect costs more per year than ThePanel's total runtime cost
  (zero, localhost).

## 7. Concrete things to borrow into the plan

| Pattern | Who does it | ThePanel equivalent / action |
|---|---|---|
| Per-channel price/qty rules | LitCommerce, Sellbrite | Already planned (`sync_rules`); keep multipliers, min, rounding |
| Profile/mapping templates | CedCommerce, Sellbrite | `listingComposer.js` + notes templates; extend with per-channel field mapping if eBay requires category mapping |
| eBay business-policy mapping | LitCommerce | Phase 3 eBay adapter: map payment/return policies in adapter settings, not per listing |
| 15-min sync SLA | LitCommerce | Keep 30-min poll; publish cadence in the UI (sync status card) |
| Oversell = headline feature | Sellbrite | W3 flow is our version; test it end-to-end in Phase 3 |
| Error queue + retry | all | `jobs` table + "Needs attention" view — already planned, prioritize |
| AI listing generation | LitCommerce | Notes templates are the deterministic version; optional later |
| Etsy vintage compliance | Etsy policy; LitCommerce defers | Our `vintage_only` rule already encodes it — a differentiator, keep it |

---

## Sources (fetched 2026-10-16)

- apps.shopify.com/marketplace-connect (listing + reviews)
- apps.shopify.com/etsy-marketplace-integration (CedCommerce listing + reviews)
- apps.shopify.com/ebay (removed-app page)
- sellbrite.com (product overview, integrations)
- litcommerce.com (product overview, channel-native features, sync cadence)
