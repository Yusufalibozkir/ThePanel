# Comprehensive System Plan: Multi-Platform Book Inventory Panel

## System Architecture

**Tech Stack Recommendation:**
- **Backend:** Node.js + Express (JavaScript/TypeScript)
  - Reason: Excellent API integration libraries for all platforms, async by nature, easy webhook handling
- **Database:** PostgreSQL
  - Reason: Relational data (products linked to multiple platform listings), JSON support for flexible fields
- **Frontend:** React + Tailwind CSS
  - Reason: Modern, responsive dashboard, component-based for listing cards
- **Task Queue:** Bull + Redis
  - Reason: Handle async syncing, retry failed API calls, rate limit management
- **API Documentation:** OpenAPI/Swagger for your own endpoints

---

## Database Schema

```
products (master table - from Shopify)
├── id (UUID)
├── shopify_product_id (string, unique)
├── isbn (string, indexed)
├── title (string)
├── author (string)
├── description (text)
├── price (decimal)
├── cost (decimal) - for profit tracking
├── condition (enum: new, like_new, very_good, good, acceptable)
├── quantity (integer)
├── images (jsonb array)
├── metadata (jsonb) - publisher, year, binding, etc.
├── created_at / updated_at

platform_listings
├── id (UUID)
├── product_id (FK to products)
├── platform (enum: ebay, abebooks, etsy)
├── platform_listing_id (string)
├── status (enum: draft, active, sold, error, delisted)
├── platform_price (decimal) - can differ from base price
├── platform_url (string)
├── sync_enabled (boolean)
├── last_synced_at (timestamp)
├── error_message (text)
├── created_at / updated_at

sync_rules
├── id (UUID)
├── platform (enum: ebay, abebooks, etsy)
├── enabled (boolean)
├── conditions (jsonb) - filters: min_price, max_price, condition, tags, etc.
├── price_modifier (jsonb) - e.g., +10%, -$5
├── auto_sync (boolean)

sync_logs
├── id (UUID)
├── product_id (FK)
├── platform
├── action (enum: create, update, delete)
├── status (success, failed)
├── details (jsonb)
├── timestamp

platform_credentials
├── platform (primary key)
├── credentials (encrypted jsonb)
├── token_expires_at
├── last_validated_at
```

---

## System Components

### 1. **Backend API Server** (`/backend`)

**Core Services:**

```
/services
├── shopify-service.js       # Fetch products, handle webhooks
├── ebay-service.js          # List, update, delete on eBay
├── abebooks-service.js      # AbeBooks integration
├── etsy-service.js          # Etsy integration
├── sync-engine.js           # Orchestrates syncing logic
├── pricing-engine.js        # Calculate platform-specific prices
└── inventory-manager.js     # Track inventory across platforms
```

**API Endpoints:**

```
Authentication:
POST /api/auth/setup         # Initial platform credential setup

Products:
GET  /api/products           # List all products with platform status
GET  /api/products/:id       # Single product with all listings
POST /api/products/sync      # Manual sync from Shopify

Platforms:
GET  /api/platforms          # Status of all platform connections
POST /api/platforms/:name/test    # Test platform credentials
GET  /api/platforms/:name/listings # Get all listings on platform

Listings:
POST /api/listings/create    # Create listing on specific platform(s)
PUT  /api/listings/:id       # Update listing
DELETE /api/listings/:id     # Remove listing
POST /api/listings/bulk-sync # Sync multiple products

Sync Rules:
GET  /api/sync-rules
POST /api/sync-rules
PUT  /api/sync-rules/:id

Webhooks:
POST /api/webhooks/shopify   # Shopify webhook receiver
POST /api/webhooks/ebay      # eBay notifications
```

### 2. **Frontend Dashboard** (`/frontend`)

**Pages/Views:**

**Dashboard (Home)**
```
┌─────────────────────────────────────────────────────────┐
│ ThePanel - Book Inventory Manager                      │
├─────────────────────────────────────────────────────────┤
│ [Platform Status Bar]                                   │
│ Shopify: ✓ Connected (142 products)                    │
│ eBay: ✓ Connected (89 listings) | AbeBooks: ⚠ Issues  │
│ Etsy: ✓ Connected (12 listings)                        │
├─────────────────────────────────────────────────────────┤
│ Quick Stats:                                            │
│ Total Products: 142 | Listed: 101 | Pending: 23        │
│ Sync Errors: 4 [View]                                  │
├─────────────────────────────────────────────────────────┤
│ [Sync All from Shopify] [View Logs] [Settings]        │
└─────────────────────────────────────────────────────────┘
```

**Products List**
```
┌─────────────────────────────────────────────────────────┐
│ Search: [_____________] Filter: [All/Synced/Not Synced]│
├──────┬────────────────────┬──────────┬─────────────────┤
│ Img  │ Title/Author       │ Price    │ Platforms       │
├──────┼────────────────────┼──────────┼─────────────────┤
│ [📖] │ The Great Gatsby   │ $15.99   │ 🛒 ✓ 📦 ✓ 🎨 -  │
│      │ F. Scott Fitzgerald│          │ [Sync Now]      │
├──────┼────────────────────┼──────────┼─────────────────┤
│ [📖] │ 1984               │ $12.50   │ 🛒 ✓ 📦 ⚠ 🎨 ✓  │
│      │ George Orwell      │          │ [Fix Error]     │
└──────┴────────────────────┴──────────┴─────────────────┘

Legend: 🛒=eBay, 📦=AbeBooks, 🎨=Etsy
```

**Product Detail View**
```
┌─────────────────────────────────────────────────────────┐
│ ← Back to Products                                      │
├─────────────────────────────────────────────────────────┤
│ [Product Image]  │ The Great Gatsby                     │
│                  │ by F. Scott Fitzgerald                │
│                  │ ISBN: 978-0-7432-7356-5              │
│                  │ Condition: Very Good                  │
│                  │ Base Price: $15.99 | Quantity: 3     │
├──────────────────┴──────────────────────────────────────┤
│ Platform Listings:                                      │
│                                                          │
│ eBay: ✓ Active                                          │
│   Price: $16.99 | Listed: 2 days ago                   │
│   [View on eBay] [Update] [Delist]                     │
│                                                          │
│ AbeBooks: ✓ Active                                      │
│   Price: $18.99 | Listed: 1 week ago                   │
│   [View] [Update] [Delist]                             │
│                                                          │
│ Etsy: ✗ Not Listed                                      │
│   Reason: Not vintage (published 1925 but edition 2004)│
│   [Override & List]                                     │
│                                                          │
│ [Sync All Platforms]                                    │
└─────────────────────────────────────────────────────────┘
```

**Sync Rules Configuration**
```
┌─────────────────────────────────────────────────────────┐
│ Sync Rules - Configure which products go where         │
├─────────────────────────────────────────────────────────┤
│ eBay Rules:                                             │
│ ☑ Auto-sync enabled                                     │
│ ☑ All conditions                                        │
│ Price: Base price + 7% (eBay fees)                     │
│ Minimum price: $5.00                                    │
│ [Save]                                                  │
├─────────────────────────────────────────────────────────┤
│ AbeBooks Rules:                                         │
│ ☑ Auto-sync enabled                                     │
│ ☑ Only: Very Good, Like New, New                       │
│ ☐ Vintage only (20+ years)                             │
│ Price: Base price + 15%                                 │
│ Minimum price: $10.00                                   │
│ [Save]                                                  │
├─────────────────────────────────────────────────────────┤
│ Etsy Rules:                                             │
│ ☐ Auto-sync enabled (manual only)                       │
│ ☑ Vintage only (published before 2006)                 │
│ Price: Base price + 20%                                 │
│ [Save]                                                  │
└─────────────────────────────────────────────────────────┘
```

**Settings/Credentials**
```
┌─────────────────────────────────────────────────────────┐
│ Platform Credentials                                    │
├─────────────────────────────────────────────────────────┤
│ Shopify:                                                │
│ Store URL: [your-store.myshopify.com]                  │
│ API Key: [****************]                             │
│ API Secret: [****************]                          │
│ [Test Connection] Status: ✓ Connected                  │
├─────────────────────────────────────────────────────────┤
│ eBay:                                                   │
│ App ID: [****************]                              │
│ OAuth Token: [Valid until: Dec 2026]                   │
│ [Refresh Token] [Test Connection]                      │
├─────────────────────────────────────────────────────────┤
│ [Similar for AbeBooks and Etsy]                         │
└─────────────────────────────────────────────────────────┘
```

---

## Core Workflows

### Workflow 1: Initial Setup
1. User enters platform credentials in Settings
2. System validates each connection
3. Performs initial sync from Shopify (imports all products)
4. User configures sync rules for each platform
5. User can bulk-sync or manually select products to list

### Workflow 2: New Product Added to Shopify
1. Shopify webhook triggers → `/api/webhooks/shopify`
2. Backend fetches product details
3. Saves to `products` table
4. Evaluates sync rules for each platform
5. If auto-sync enabled and rules match:
   - Queues sync jobs for applicable platforms
   - Applies pricing modifiers
   - Creates listings via platform APIs
6. Updates `platform_listings` table
7. Frontend shows notification: "New product synced to eBay, AbeBooks"

### Workflow 3: Product Sold on eBay
1. eBay webhook/notification received
2. System identifies product via `platform_listings.platform_listing_id`
3. Decrements `products.quantity`
4. If quantity = 0:
   - Marks all other platform listings for delisting
   - Queues jobs to remove from AbeBooks, Etsy
5. Updates inventory across all platforms

### Workflow 4: Manual Sync
1. User clicks "Sync Now" on product or "Sync All"
2. System checks each platform's sync rules
3. For each applicable platform:
   - If not listed: creates new listing
   - If listed: updates price, quantity, description
4. Shows progress bar with platform-by-platform status
5. Displays summary: "3 created, 5 updated, 1 failed"

### Workflow 5: Error Handling
1. API call fails (rate limit, invalid data, etc.)
2. Error logged to `sync_logs`
3. Job moved to retry queue (max 3 attempts)
4. Frontend shows error badge on product
5. User can view error details and manually retry or fix

---

## Technical Implementation Details

### Rate Limiting Strategy
```javascript
// Different platforms have different limits
const rateLimits = {
  ebay: { calls: 5000, per: 'day' },
  abebooks: { calls: 1000, per: 'hour' },
  etsy: { calls: 10, per: 'second' }
};

// Use bottleneck library for rate limiting
// Queue jobs intelligently
```

### Webhook Security
```javascript
// Verify webhook signatures from Shopify
// Use HMAC validation for eBay
// Store webhook secrets encrypted
```

### Data Sync Strategy
- **One-way sync (recommended for MVP):** Shopify → Other platforms
- Inventory updates come back from platforms (when sold)
- Price/description changes only go from Shopify → platforms
- Prevents conflict resolution complexity

### Error Recovery
- Retry queue with exponential backoff
- Dead letter queue for persistent failures
- Manual intervention UI for unresolvable errors

---

## Implementation Phases

**Phase 1: Foundation** (Week 1-2)
- Set up project structure
- Database setup with migrations
- Shopify API integration (read products)
- Basic frontend with product list view
- Manual sync button (Shopify → database)

**Phase 2: Platform Integrations** (Week 3-5)
- eBay API integration (create/update/delete listings)
- AbeBooks API integration
- Etsy API integration
- Credential management UI
- Platform status dashboard

**Phase 3: Automation** (Week 6-7)
- Webhook handlers for Shopify
- Sync rules engine
- Pricing modifier logic
- Auto-sync on product creation
- Inventory synchronization

**Phase 4: Polish** (Week 8)
- Error handling UI
- Sync logs and history
- Bulk operations
- Performance optimization
- Testing and bug fixes

---

## Next Steps

1. Set up the project structure (backend, frontend, database)
2. Install necessary dependencies
3. Begin Phase 1 implementation
4. Create API credential setup guide for each platform
