# Express Distributors

Wholesale e-commerce storefront, customer accounts, and admin/POS API (Next.js + Express + MongoDB).

## Quick start

```bash
npm run install:all
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env`: set `MONGODB_URI`, `JWT_SECRET` (e.g. `openssl rand -hex 32`), and optional services (Stripe, SMTP, Cloudinary). Never commit `.env`.

```bash
npm run dev
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:5001](http://localhost:5001) (override with `PORT`)

### MongoDB transactions (local)

Purchase order receiving, physical count, POS inventory writes, and similar paths use MongoDB multi-document transactions. A standalone `mongod` will reject them. For local development, run MongoDB as a single-node replica set (for example `scripts/enable-local-mongo-replica-set.sh`). This is an environment requirement, not an application inventory-behavior change. Most backend unit tests mock sessions and do not need a live replica set.

## Security notes for production

- Terminate TLS at your host (HTTPS only); set `NODE_ENV=production` and `FRONTEND_URL` to your public site URL.
- Keep MongoDB on a private network; do not expose it to the public internet.
- Set `JWT_EXPIRES_IN` to a value you are comfortable with (default in code is `8h` if unset).
- With SMTP configured, new accounts that register with **email** must verify via the link before login. Password reset emails use a **1-hour** token; verification links expire in **24 hours**.
- Default bootstrap admin (`admin@edinc.com`) is created only when **not** in production, unless `ALLOW_DEFAULT_ADMIN=true`.
- Customer order tracking requires the **checkout email** plus order number (reduces scraping by order id).

## Repo layout

```
frontend/    # Next.js app
backend/     # Express API
```

Public env vars for the browser belong in `frontend/.env` with the `NEXT_PUBLIC_` prefix only (e.g. Stripe publishable key). All secrets stay in `backend/.env` or your host’s secret store.
