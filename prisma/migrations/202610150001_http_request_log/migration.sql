CREATE TABLE "HttpRequestLog" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "requestBody" JSONB NOT NULL,
    "responseBody" JSONB NOT NULL
);
CREATE INDEX "http_request_log_created" ON "HttpRequestLog" ("createdAt");
