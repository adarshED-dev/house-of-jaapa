# House of Jaapa Ecommerce

Full-stack ecommerce foundation built from the requirements document in this folder.

## Stack

- Express API
- React + Vite admin/store UI
- SQL database using Node's built-in SQLite driver
- JWT auth

## Run locally

```bash
npm install
npm run seed
npm run dev
```

The React app runs on `http://localhost:5173` and proxies API calls to the Express server on `http://localhost:4000`.

Seeded admin login:

- Email: `admin@houseofjaapa.com`
- Password: `admin12345`

## Main modules

- Product, variant, media, SEO, category, brand, vendor, collection, pricing
- Inventory, warehouses, movement history, low-stock reporting
- Customer profiles, addresses, groups, tags, notes, reward points
- Cart, discounts, checkout, orders, payments, shipments
- Reviews, CMS pages/blog/media metadata, settings
- Admin authentication, roles, audit logs
- Reports dashboard

The project is intentionally structured so additional enterprise features from the brief can be added without changing the core API/UI shape.

