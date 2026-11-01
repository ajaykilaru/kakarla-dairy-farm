# Kakarla Dairy Farm — Delivery & Billing

A responsive full-stack starter combining the **screen-flow concepts** from `MilkMate UI_UX Design.zip` with the **green palette, Manrope + DM Sans typography, and authentication foundation** from `smart_dairy_auth_roles_added(1).zip`.

## Stack

- React 18 + TypeScript + Vite
- Node.js + Express
- MySQL 8 / compatible managed MySQL
- bcrypt password hashing + signed JWT sessions
- QR code generation (`qrcode`) and camera scanning (`html5-qrcode`)
- Lucide icons with CSS dimensional/3D-style icon treatments

## Current working flows

### Super Admin
- Secure login
- Dashboard statistics from database records
- Customer list/search/create/archive API foundation
- Set or reset customer passwords; customers sign in with their phone number
- Create delivery-boy login accounts
- Assign/reassign customers
- Current cow/buffalo milk rates
- Delivery records
- Payment recording (cash, UPI, bank transfer, other)
- Monthly billed/paid/outstanding report and CSV export
- Customer QR code display
- Search notification recipients and filter sent/received activity by channel
- Review customer support tickets, reply, and open or close a ticket

### Delivery Boy
- Secure login
- Only assigned customers returned by delivery endpoints
- Assigned-customer list and QR lookup
- Camera QR scan where browser camera permissions are available, with manual QR payload/code fallback
- Delivery type and actual quantity selection; calculated charge preview; explicit confirmation before saving
- Delivery forms prefill milk type, scheduled quantity, and an available morning/evening routine from the customer profile
- Each completed delivery creates an in-app customer bill notification, including any short delivery and updated bill balance
- Backend validates assignment before recording delivery
- Add customer to the delivery boy's own assignment
- Payment collection limited to assigned customers

### Customer
- Secure login using the customer phone number and an administrator-set password
- Own QR code
- Own delivery history, current-month charges, payments and balance
- Receive an in-app bill after each completed delivery
- Open support tickets to the owner or assigned delivery partner and reply to the ticket conversation
- Select morning, evening, or both delivery routines when a customer profile is created
- Customer APIs use the authenticated account's linked `customer_id`; the client cannot choose another customer id for these self-service views

## Important implementation boundaries

This is an integrated MVP, not a claim that every business workflow in the design has been completed. The current schema has no separate subscription-plan/calendar table, scheduled route sequencing, delivery attempt/status history, recurring invoice snapshot records, push/SMS provider, or payment-gateway integration. Monthly billing currently calculates from saved deliveries minus saved payments; it does not issue immutable invoices. Telegram notifications are optional and best-effort. Configure, test, and harden those workflows before production use.

Do not use real customer/payment data until you have tested permissions, HTTPS, backups, database migrations, account recovery/password reset, audit logs, and rate limiting. Use a private repository and keep `.env` out of Git.

## 1. Prerequisites

- Node.js 20 or newer recommended
- MySQL 8 or a managed MySQL provider
- MySQL Workbench (optional client; it is not the database server)

## 2. Configure environment

Copy `.env.example` to `.env` and set your own values:

```env
NODE_ENV=development
PORT=3000
JWT_SECRET=replace_with_a_random_secret_at_least_32_characters
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=smart_dairy
DB_SSL=false
DB_SSL_CA=
```

For a hosted MySQL provider, use the provider's hostname, port, user, password and CA certificate; set `DB_SSL=true` when required. Do not set `DB_HOST=localhost` for a remote database. Never commit `.env`.

## 3. Create the database

Open MySQL Workbench, connect to the intended database server, and run `database/schema.sql`.

For a provider that does not permit `CREATE DATABASE`, create/select the database in Workbench first, then remove the first `CREATE DATABASE` and `USE smart_dairy` lines before running the remaining schema. Back up any existing database before running schema/migration changes. For a database from the older starter, inspect its columns first and run `database/migrations/001_auth_roles.sql` only if the role/customer-link/assignment columns and foreign key are not already present. Then run `database/migrations/002_phone_schedules_messages.sql` once to add phone login, delivery schedules, in-app messages and password-reset tokens. Run `database/migrations/003_delivery_boy_notifications.sql` once to enable in-app messages addressed to delivery partners, then run `database/migrations/004_customer_support_tickets.sql` once to add customer support tickets and replies. Do not run migrations against a database already created from the updated schema.

Customer password recovery uses a configurable SMS gateway. Set `SMS_GATEWAY_URL` to an endpoint accepting JSON `{ "to": "phone", "message": "..." }`; optionally set `SMS_GATEWAY_API_KEY` for a Bearer token. Leave these unset if password recovery by SMS is not configured.

## 4. Install and create the initial owner

```bash
npm install
```

Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env` (use at least 12 characters for the initial owner password), then run:

```bash
npm run create-admin
```

This script creates/updates the Super Admin login. Do not expose this script as a public HTTP endpoint.

## 5. Run locally

For a single-server production-style run, build the frontend and start Express:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.

For development with hot reload, run:

```bash
npm run dev
```

The Vite frontend proxies `/api` to `http://127.0.0.1:3000` by default. Run both services using `npm run dev` (do not start only the Vite client). If the backend uses a different host/port, set `MILKMATE_API_TARGET` before starting Vite. If frontend and API are deployed on separate origins, set `VITE_API_BASE_URL` at build time to the API origin and configure CORS on the API server. Network failures now show a clearer message instead of only “Failed to fetch”.

## 6. Deploy online

For Render, the included `render.yaml` uses:

- Build: `npm install && npm run build`
- Start: `npm start`
- Health check: `/api/health`

Create the managed MySQL database first. Push this project to a private GitHub repository, create a Render Web Service from that repository, and add the environment variables in the Render dashboard. Set `NODE_ENV=production`, a strong `JWT_SECRET`, and the hosted database values. Add `DB_SSL=true` and `DB_SSL_CA` as required by your provider.

After deployment, verify:

- `https://YOUR-SERVICE.onrender.com/api/health` returns `{ "ok": true, "database": "connected" }`
- `https://YOUR-SERVICE.onrender.com/` loads the frontend
- login works for each role
- unauthorized role/customer requests return 401/403

## 7. API overview

- `POST /api/auth/login`, `GET /api/auth/me`
- Super Admin: `/api/dashboard`, `/api/customers`, `/api/delivery-boys`, `/api/customers/:id/assignment`, `/api/deliveries`, `/api/rates`, `/api/payments`, `/api/reports/monthly`
- Delivery Boy: `/api/delivery/overview`, `/api/delivery/customers`, `/api/delivery/complete`, `/api/delivery/deliveries`
- Customer: `/api/customer/summary`, `/api/customer/deliveries`, `/api/customer/billing`, `/api/customer/payments`, `/api/customer/qr`
- Health: `GET /api/health`

All API requests except login and health require a signed-in JWT session. Role restrictions are enforced on the server, not just hidden in the UI.


## Login troubleshooting

- Local development: run `npm run dev` from the project root. This starts Express on port 3000 and Vite on port 5173 with an `/api` proxy.
- Production-style local run: run `npm run build` then `npm start`, and open `http://localhost:3000` (not the Vite port).
- Check `http://localhost:3000/api/health`. It should return JSON with `ok: true` and `database: "connected"`. If it fails, check `.env`, MySQL status, and the backend terminal.
- If the browser shows `Failed to fetch`, open DevTools → Network and confirm the request URL is `/api/auth/login`; when using Vite, ensure port 3000 is running and reachable.
- A JSON response `Invalid email or password.` means the API is reachable but the account/password do not match. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and run `npm run create-admin`.





<!-- Open PowerShell in the project folder and run:
step-1

cd "file path"
npm install
npm run dev

Then open http://localhost:5173 in your browser. Keep the terminal open while using the app; press Ctrl+C to stop it.

Make sure MySQL is running and your database settings are configured in .env. For a production build and run instead:

step-2

npm run build
npm start

The app will be served by the backend on http://localhost:3000.

1 background command ru -->




<!-- To view the data stored in the database, use MySQL Workbench:

Open MySQL Workbench and connect to the MySQL server using the settings in your project’s .env file. Don’t share the password in that file.
Select the smart_dairy database.
Open a new SQL tab and run queries such as:

USE smart_dairy;

-- Customers
SELECT id, name, phone, address, active
FROM customers
ORDER BY name;

-- Delivery partners (does not show password data)
SELECT id, name, phone, role, active
FROM users
WHERE role = 'delivery_boy';

-- Recent deliveries
SELECT d.id, c.name AS customer, d.milk_type, d.quantity_litres,
       d.amount, d.delivered_at
FROM deliveries d
JOIN customers c ON c.id = d.customer_id
ORDER BY d.delivered_at DESC
LIMIT 100;

-- Payments
SELECT id, customer_id, amount, payment_method, paid_at
FROM payments
ORDER BY paid_at DESC
LIMIT 100;

You can also expand Schemas → smart_dairy → Tables in Workbench, then right-click a table and choose Select Rows to browse it. -->
## GitHub Codespaces

This repository includes a Codespaces development environment with Node.js and MySQL. Open the repository on GitHub, choose **Code → Codespaces → Create codespace on main**, and wait for setup to finish. The app starts automatically; open the forwarded **Dairy Farm App** port (5173).

By default, the Codespace uses its private MySQL service and initializes the schema from `database/schema.sql`. To connect the app to Aiven instead, create these GitHub Codespaces secrets for this repository: `AIVEN_DB_HOST`, `AIVEN_DB_PORT`, `AIVEN_DB_USER`, `AIVEN_DB_PASSWORD`, `AIVEN_DB_NAME` (use `smart_dairy`), and `AIVEN_DB_CA` (paste the Aiven CA certificate). Restart the Codespace after saving the secrets. The startup script uses TLS, creates the schema only when the selected database does not exist, and then starts the app. An existing incomplete database is left untouched and reported for review.

Each new database starts without customer or production records. This public repository excludes the private customer export. Create an owner account inside the Codespace by setting `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in its terminal, then run `npm run create-admin`. Use a private, access-controlled database user and unique secrets for any shared or production deployment.
