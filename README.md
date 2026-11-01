# Kakarla Dairy Farm

This ZIP keeps the existing application screens, styling, routes, and behavior while separating the code into `frontend` and `backend` folders.

## Project layout

- `frontend/` — React, TypeScript, Vite, and the existing user interface.
- `backend/` — Express API, authentication, database schema/migrations, and admin setup script.
- Root `package.json` — runs both workspaces together.

## Start locally

Requirements: Node.js 20 or later and MySQL 8 (or compatible MySQL).

1. Copy `backend/.env.example` to `backend/.env` and enter your database settings and a JWT secret. Do not share or commit the real `.env` file.
2. Create the database using `backend/database/schema.sql`. Apply migrations only when your database does not already contain those changes.
3. From this project’s root folder, run `npm install`.
4. Start the app with `npm run dev`.
5. Open `http://localhost:5173`. The API runs on port 3000.

For a production-style local run, use `npm run build` then `npm start`; Express serves the built frontend on port 3000.

To create the initial owner account, set `ADMIN_NAME`, `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters in `backend/.env`, then run `npm run create-admin`.
