# Contest request and response logs

GET and POST calls to `/api/contest` are saved in PostgreSQL in
`public."HttpRequestLog"`. Logging starts after migration
`202610150001_http_request_log`; earlier requests cannot be recovered.

In pgAdmin, select the `contest` database and run:

```sql
SELECT "createdAt", id, method, path, status, "durationMs",
       "requestBody", "responseBody"
FROM public."HttpRequestLog"
ORDER BY "createdAt" DESC
LIMIT 100;
```

Refresh the query after using the website. The response's `X-Request-Id`
header matches the row's `id`.

Bodies are masked summaries, not raw dumps. Credentials, identifiers,
email addresses, barcodes, and unknown strings are redacted. Headers,
cookies, query strings, and IP addresses are not stored. JSON capture is
limited to 16 KiB per body; oversized or invalid JSON bodies get an omission
marker. Admin endpoints, static pages, and external integration traffic
are outside this log's scope. There is currently no automatic deletion;
logs remain in the database until explicitly removed.

Database logging errors are reported in the server terminal and do not
change an otherwise completed API response. Existing business activity
continues to be recorded separately in `AuditEvent`.
