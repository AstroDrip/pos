# Deploying the online store

Nothing has been deployed yet. These steps are written from the local setup and have not been run on a real host.

## 1. Database

1. Create a **new** Neon project. Do not reuse the owner dashboard's project.
2. Choose the region only after the legal check in `docs/ecommerce/OPEN_DECISIONS.md`. It cannot be changed later.
3. Copy `.env.example` to `.env.local` on your computer and fill in the owner connection and two role passwords.
4. Run:

```bash
npm run db:migrate
```

5. Create the first staff login. Set the `STAFF_` values first.

```bash
npm run staff:create
```

## 2. Host (Vercel)

1. New project from this repository.
2. Root Directory: `store`.
3. Turn **on** "Include files outside the root directory". The build needs `src/core` and two small files from `dashboard/`.
4. Environment variables, for the host only: `STORE_APP_DATABASE_URL`, `STORE_DEVICE_DATABASE_URL`, `STORE_DISPLAY_NAME`. Use pooled connections.
5. Never put `DATABASE_URL_UNPOOLED` or `NEON_LOCAL_ENDPOINT` on the host.
6. Commercial use needs a paid Vercel plan.

## 3. Check it

Open `/api/health`. It should show `"ok": true`. Then sign in at `/admin/login`.

## 4. Connect the POS

Make a one-time code:

```bash
npm run device:code
```

Then in the POS, go to Admin, Online store. Enter the store's address and the code, and press Connect. Products arrive unpublished. Nothing shows in the shop until staff publish it.

## Try it locally with no account

In two windows, from `store/`, with the local values from `.env.example` in `.env.local`:

```bash
npm run dev:sql
```

```bash
npm run dev
```

`dev:sql` prints a fresh test password for each local staff login. All data is made up and vanishes when it stops.
