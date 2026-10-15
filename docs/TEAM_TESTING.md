# Password-protected team testing

Open the website and enter username `team` and the password configured in
the server's `SITE_PASSWORD` environment variable. The browser remembers
these HTTP Basic credentials for the session. Close the browser completely
or use a new private window to test a different password.

The gate covers pages, API endpoints, and downloadable assets. The admin
area still requires its separate administrator login. Production startup
without `SITE_PASSWORD` returns 503 instead of exposing the website.
Use HTTPS when hosting the app for the team. Changing `SITE_PASSWORD`
and restarting the server revokes the old shared password.

Local credentials are stored in ignored `.tools/team-access.txt`; do not
commit that file or `.env`. Configure a separate shared password in your
hosting provider's environment settings when deploying.

## Test inventory and purchases

Run `npm run db:migrate` then `npm run seed:team` in the development mock
environment. The seed adds 100 extra gifts and 100 demo orders, preserves
existing records, and can be rerun without creating duplicates. It never
resets already used gifts or orders.

See `team-test-orders.csv` for the full list. Enter:

- Barcode: `DEMO-ORDER-001` through `DEMO-ORDER-100`.
- Purchase date: `2026-10-01` (must match the order).
- Recipient: a distinct test email, such as `test001@example.com`.

These are simulated eligible purchases, not completed contest submissions.
You can use them to test the form yourself. The listed product belongs to
the demo purchase; the contest gift is randomly chosen from available
inventory and is not determined by that purchased product or selected box.
No real purchases are checked and no emails are sent.

For hosted demo participation and worker setup, follow `RENDER_NEON.md`.
Production mocks require explicit protected hosted-demo configuration.
