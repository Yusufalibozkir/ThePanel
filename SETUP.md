# ThePanel - Setup Guide

## Prerequisites

- PostgreSQL installed and running
- Node.js (v16 or higher)
- npm

## Database Setup

1. Create a PostgreSQL database:
```sql
CREATE DATABASE thepanel;
```

2. Update the `.env` file in the `backend` folder with your database credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=thepanel
DB_USER=postgres
DB_PASSWORD=your_password_here
```

3. Run database migrations:
```bash
cd backend
npm run migrate
```

This will create all necessary tables:
- products
- platform_listings
- sync_rules
- sync_logs
- platform_credentials

## Backend Setup

1. Install dependencies:
```bash
cd backend
npm install
```

2. Start the backend server:
```bash
npm run dev
```

The backend will run on `http://localhost:3001`

### Available API Endpoints

**Shopify:**
- GET `/api/shopify/test` - Test Shopify connection
- GET `/api/shopify/products` - Get products from Shopify
- GET `/api/shopify/products/:id` - Get single product
- GET `/api/shopify/inventory` - Get inventory levels

**Products:**
- GET `/api/products` - Get all products from database
- GET `/api/products/:id` - Get single product
- POST `/api/products` - Create product
- PUT `/api/products/:id` - Update product
- DELETE `/api/products/:id` - Delete product

**Sync:**
- POST `/api/sync/shopify` - Sync products from Shopify to database
- GET `/api/sync/logs` - Get sync logs

## Frontend Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

## Usage

1. Make sure PostgreSQL is running
2. Start the backend: `cd backend && npm run dev`
3. Start the frontend: `cd frontend && npm run dev`
4. Open `http://localhost:5173` in your browser
5. Click "Sync from Shopify" to import products from your Shopify store

## Features Implemented (Phase 1)

✅ Backend API server with Express
✅ PostgreSQL database with full schema
✅ Database migrations
✅ Shopify API integration
✅ Product CRUD operations
✅ Sync products from Shopify to database
✅ React frontend dashboard
✅ Product list view with platform status

## Next Steps (Phase 2)

- eBay API integration
- AbeBooks API integration
- Etsy API integration
- Platform credential management
- Create/update/delete listings on platforms

## Troubleshooting

### Database Connection Error
- Ensure PostgreSQL is running
- Check your `.env` file has correct database credentials
- Verify the database exists: `psql -U postgres -l`

### Migration Errors
- If migrations fail, check PostgreSQL logs
- Ensure your user has CREATE privileges
- Try running migrations with verbose output: `npm run migrate -- -v`

### Shopify Connection Error
- Verify your Shopify credentials in `backend/.env`
- Check that your API token has the required scopes
- Test connection: `curl http://localhost:3001/api/shopify/test`
