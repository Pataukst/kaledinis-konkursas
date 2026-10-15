# Render + Neon: protected team demo

Create a fresh Neon project/database for this demo. In Neon's Connect
dialog copy the PostgreSQL connection string with pooling enabled for
`DATABASE_URL`. Copy the connection string with pooling disabled for
`MIGRATION_DATABASE_URL`. Keep the supplied SSL parameters. These are
hosting secrets; never commit them. The local database is not transferred.

## Configure an existing Render Web Service

Select GitHub repository `Pataukst/kaledinis-konkursas`, branch `main`.

| Setting | Value |
| --- | --- |
| Language/runtime | Node (not Docker) |
| Instance | Free |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start:hosted` |

Add these in Render's Environment settings:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `24.21.0` |
| `HOSTED_DEMO` | `true` |
| `DATABASE_URL` | Neon pooled connection string |
| `MIGRATION_DATABASE_URL` | Neon direct connection string |
| `SITE_PASSWORD` | Your shared team password, at least 14 characters |
| `AUDIT_HMAC_KEY` | A separate random secret, at least 32 characters |
| `DEMO_ADMIN_USERNAME` | `demo-admin` |
| `DEMO_ADMIN_PASSWORD` | A separate admin password, 14–200 characters |
| `PURCHASE_ADAPTER` | `mock` |
| `DELIVERY_ADAPTER` | `mock` |
| `MOCK_ASSIGNMENT` | `ok` |
| `EXTERNAL_IDEMPOTENCY_CONFIRMED` | `true` |
| `WORKER_POLL_MS` | `10000` |

Generate audit/password secrets with your password manager or locally:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Use a different value for each secret. `APP_ORIGIN` defaults to Render's
`RENDER_EXTERNAL_URL`; if using a custom domain, set its exact HTTPS origin
as `APP_ORIGIN`. Do not copy the localhost APP_ORIGIN or DATABASE_URL.

Alternatively create a Render Blueprint from `render.yaml`; it generates
the three secrets and asks for the Neon connection strings. For an existing
Web Service, configure the above settings manually rather than creating a
second service. Leave the health-check path unset: all paths require auth.

## What startup does

The launcher requires protected hosted demo settings, applies migrations,
seeds 100 gifts and 100 eligible test orders, creates the demo admin if
missing, then starts the web server and assignment worker together. Either
child exiting stops the other. Seeding can repeat safely: it never resets
existing reservations or claims. Existing admin passwords are preserved;
changing DEMO_ADMIN_PASSWORD later does not reset an existing account.

Open the Render HTTPS URL. Browser login: username `team`, password
`SITE_PASSWORD`. `/admin` then requires `DEMO_ADMIN_USERNAME` and the
initial `DEMO_ADMIN_PASSWORD` as a second login.

Test with barcode `DEMO-ORDER-001` through `DEMO-ORDER-100`, purchase date
`2026-10-01`, and distinct recipient emails. See `team-test-orders.csv`.
The website displays its demo notice. It never checks real purchases,
assigns real gifts, sends email, or subscribes anyone to a mailing list.

Free Render instances sleep when inactive. The worker shares that instance
and stops while it sleeps; queued work resumes after waking. The 10-second
worker interval reduces polling but still consumes Neon compute while the
service is awake. Monitor free-plan usage. Database records and request logs
persist in Neon; files on Render are not used for durable storage. Connect
pgAdmin using Neon's direct host, port, database, user, password and SSL
settings to read `AuditEvent` and `HttpRequestLog` as before.

This configuration is for a small, private team demo, not a live contest.
