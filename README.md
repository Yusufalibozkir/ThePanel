# ThePanel

Single-operator book inventory panel. Shopify is the master catalog; ThePanel syncs it
into a local SQLite database and (in later phases) lists books on eBay and Etsy while
generating bulk-upload export files for AbeBooks.

Architecture and roadmap: see `documentation/plan.md` (source of truth).

## Stack

| Layer    | Choice                                    |
|----------|-------------------------------------------|
| Backend  | Express 5, port 3001, bound to 127.0.0.1  |
| Database | SQLite via better-sqlite3 (`backend/database/thepanel.db`) |
| Shopify  | GraphQL Admin API (custom app token)      |
| Frontend | React + Vite, port 5173                   |

No Postgres. Ever. The old `pg` / `node-pg-migrate` setup has been removed.

## Setup

1. **Backend**
   ```bash
   cd backend
   npm install
   npm run migrate        # creates/updates SQLite schema
   ```
2. **Credentials** — configure `backend/.env` (see `backend/.env.example`):
   - `SHOPIFY_STORE_URL` — e.g. `your-store.myshopify.com`
   - `SHOPIFY_ACCESS_TOKEN` — custom-app Admin API token (`read_products`, `read_inventory`)
   - `APP_ENCRYPTION_KEY` — 32-byte hex key used to encrypt channel credentials at rest
3. **Frontend**
   ```bash
   cd frontend
   npm install
   ```

## Running

```bash
# terminal 1
cd backend && npm run dev      # http://127.0.0.1:3001

# terminal 2
cd frontend && npm run dev     # http://localhost:5173
```

Or double-click `start.bat` on Windows (opens both servers).

## Backend scripts

| Script                  | Purpose                                        |
|-------------------------|------------------------------------------------|
| `npm run dev`           | Start API server (nodemon)                     |
| `npm run migrate`       | Create/migrate the SQLite schema               |
| `npm run backfill-metadata` | One-time tag/ISBN enrichment over the catalog |
| `npm test`              | Unit tests (node:test) for engines             |

## Repository layout

```
backend/    Express API, services, SQLite DB (database/thepanel.db)
frontend/   React dashboard
archive/    Unused Remix scaffold (the-panel) — kept for reference
documentation/plan.md  — implementation plan
```

## Notes

- The panel is localhost-only; no auth for MVP.
- Channel credentials are encrypted at rest (AES-256-GCM) and never returned raw by the API.
- Each book is a single copy: `quantity` is 0/1; a sale anywhere closes the book everywhere.
