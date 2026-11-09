# Deploying the owner dashboard

Neon holds the data. Vercel runs the site. Everything below uses your own accounts. No secret goes in the code.

You need Node 22.18 or newer on this computer. Run the commands inside the `dashboard` folder, after `npm install`.

## 1. Create the Neon project

1. Sign in at neon.com and create a project. Pick the region closest to Saudi Arabia that Neon offers.
2. Open **Connect**. You need two strings:
   - **Direct** (the host has no `-pooler`). This goes in `DATABASE_URL_UNPOOLED`, on this computer only.
   - **Pooled** (the host has `-pooler`). You use this host for the Vercel settings in step 5.

If you add Neon through the Vercel Marketplace, Vercel adds its own `DATABASE_URL` values. Those log in as the database owner. The app does not read them, and it refuses to start if an owner login is put in one of its own settings.

## 2. Make your local settings

Copy `.env.example` to `.env.local` and fill in the "This computer only" part. Make three different long random passwords:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## 3. Create the tables and roles

```bash
npm run db:migrate
```

This creates the schemas `dash_auth`, `cloud`, `backup`, `sync`, `readmodel` and `demo`, and three login roles:

| Role | Can do |
|---|---|
| `dashboard_app` | Read real figures. Keep its own login sessions. Cannot see backups |
| `dashboard_demo` | Read demo figures only. Cannot see real figures or backups |
| `device_api` | Used only by the till's routes: write backups and figures. Cannot see logins |

## 4. Load the made-up demo shop

Set `DEMO_ADMIN_PASSWORD` in `.env.local`. It is a test password. Do not reuse it anywhere. Then:

```bash
npm run demo:seed
```

The demo login is the username `demo` with that password. Run the command again to reload the demo.

## 5. Connect the repository to Vercel

1. In Vercel, choose **Add New → Project** and import the GitHub repository.
2. Set **Root Directory** to `dashboard`. Leave the build and install commands as detected (`next build`, `npm install`).
3. Add these under **Settings → Environment Variables**. Take the pooled host from step 1. Swap in the role and its password.

| Name | Production | Preview | Value |
|---|---|---|---|
| `DASHBOARD_DEMO_MODE` | `true` while testing | `true` | `true` or `false` |
| `DASHBOARD_DEMO_DATABASE_URL` | while testing | yes | `postgresql://dashboard_demo:PASSWORD@POOLED-HOST/neondb?sslmode=require` |
| `DASHBOARD_DATABASE_URL` | when the real store connects | no | `postgresql://dashboard_app:PASSWORD@POOLED-HOST/neondb?sslmode=require` |
| `DEVICE_API_DATABASE_URL` | when the real store connects | no | `postgresql://device_api:PASSWORD@POOLED-HOST/neondb?sslmode=require` |

Never add `DATABASE_URL_UNPOOLED`, the role passwords or `DEMO_ADMIN_PASSWORD` to Vercel. Never start any name with `NEXT_PUBLIC_`.

If a password has unusual characters, put it through URL encoding first. The generator above needs none.

## 6. Deploy and test

Deploy from Vercel. The site address appears when the build finishes.

1. Open `/api/health`. It should say `"ok": true` and `"demo": "ok"`.
2. Open the site on a phone. Every screen should say **DEMO DATA**.
3. Log in as `demo`. A wrong password five times locks that login for 15 minutes.
4. Check **Overview, Sales, Profit, Stock**, then **More → Customers and suppliers** and **More → Till connection**.
5. Choose **Custom** with dates from long ago. Figures must say **Not available**, not zero.
6. Log out, and check the pages send you back to the login.

## 7. Turn demo mode off

Set `DASHBOARD_DEMO_MODE` to `false` and redeploy. The demo login and all demo sessions stop working. To remove the demo data as well, clear `demo.snapshots` and `demo.status` in Neon's SQL editor.

## 8. Connect the real till (later)

Only do this when you are ready to send real figures. Real records must never be loaded into the demo.

1. Add `DEVICE_API_DATABASE_URL` and `DASHBOARD_DATABASE_URL` on Vercel, then redeploy.
2. On this computer:

   ```bash
   npm run store:create -- "Your store name"
   ```

   It prints the store identity and a one-time code. The code lasts 7 days and works once. Keep the store identity with the paper recovery code.
3. Set `OWNER_USERNAME`, `OWNER_PASSWORD` and `STORE_ID` in `.env.local`, then:

   ```bash
   npm run owner:create
   ```

4. On the till: **Admin → Backup → Set up backup key**, and write the recovery code on paper. Then **Admin → Cloud Backup & Recovery**, enter the site address and the one-time code, and press **Connect**.

Vercel's own password protection or a custom domain are optional. Neither is needed for the login to work.

## Trying it on this computer with no account

```bash
node scripts/dev-sql-server.ts
npm run dev
```

Run them in two windows. `scripts/dev-sql-server.ts` lists the `.env.local` lines it needs at the top of the file. Its database lives in memory and is gone when it stops. The demo password defaults to the test value in that file unless you set `DEMO_ADMIN_PASSWORD`.

## Storage cost

Neon's Free plan is 1 GB per project and 5 GB of transfer a month at the time of writing. Check neon.com/pricing. Backups are compressed and old ones are removed, but a large store may need a paid plan. If the free limit is reached, Neon suspends the project until the next period, so the dashboard and uploads stop. The till keeps selling, and keeps its local backups.

## Troubleshooting

| You see | Do this |
|---|---|
| `/api/health` says `"error": "settings"` | A setting is wrong. A URL may be logging in as the wrong role, or demo mode is on with no demo URL |
| `"real": "down"` or `"demo": "down"` | Check the pooled host and that role's password |
| "This page could not load" | Same checks. The site shows nothing rather than wrong figures |
| Login says the service is not reachable | Neon may be suspended or the URL wrong |
