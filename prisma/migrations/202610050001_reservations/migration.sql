ALTER TABLE "Gift" ADD COLUMN "externalGiftId" TEXT;
UPDATE "Gift" SET "externalGiftId"='LOCAL-'||id;
ALTER TABLE "Gift" ALTER COLUMN "externalGiftId" SET NOT NULL;
CREATE UNIQUE INDEX "Gift_externalGiftId_key" ON "Gift" ("externalGiftId");
ALTER TABLE "Gift" ADD COLUMN "reservationExpiresAt" TIMESTAMPTZ(3), ADD COLUMN "activeReservationId" TEXT;
CREATE UNIQUE INDEX "Gift_activeReservationId_key" ON "Gift" ("activeReservationId");
ALTER TABLE "Gift" DROP CONSTRAINT gift_status;
ALTER TABLE "Gift" ADD CONSTRAINT gift_status CHECK(status IN ('available','allocated','archived','reserved','pending','assigned'));
CREATE TABLE "Flow" (
 id TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES "Visitor"(id),
 version INTEGER NOT NULL DEFAULT 0, "validationId" TEXT, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE("sessionId")
);
CREATE TABLE "PurchaseValidation" (
 id TEXT PRIMARY KEY, "flowId" TEXT NOT NULL REFERENCES "Flow"(id), version INTEGER NOT NULL,
 barcode TEXT NOT NULL, "activationDate" TEXT NOT NULL, "customerGuid" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE "Reservation" (
 id TEXT PRIMARY KEY, "giftId" TEXT NOT NULL REFERENCES "Gift"(id),
 "validationId" TEXT NOT NULL REFERENCES "PurchaseValidation"(id),
 "flowId" TEXT NOT NULL REFERENCES "Flow"(id), "sessionId" TEXT NOT NULL REFERENCES "Visitor"(id),
 barcode TEXT NOT NULL, "activationDate" TEXT NOT NULL, "customerGuid" TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('RESERVED','EXPIRED','RELEASED','PENDING_ASSIGNMENT','ASSIGNED')),
 "reservedAt" TIMESTAMPTZ NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
 CHECK("expiresAt"="reservedAt"+INTERVAL '12 hours')
);
CREATE UNIQUE INDEX reservation_active_gift ON "Reservation"("giftId") WHERE status IN ('RESERVED','PENDING_ASSIGNMENT','ASSIGNED');
CREATE UNIQUE INDEX reservation_active_barcode ON "Reservation"(barcode) WHERE status IN ('RESERVED','PENDING_ASSIGNMENT','ASSIGNED');
CREATE UNIQUE INDEX reservation_active_session ON "Reservation"("sessionId") WHERE status IN ('RESERVED','PENDING_ASSIGNMENT');
CREATE TABLE "AssignmentClaim" (
 id TEXT PRIMARY KEY, "reservationId" TEXT NOT NULL REFERENCES "Reservation"(id),
 "sessionId" TEXT NOT NULL REFERENCES "Visitor"(id), "giftId" TEXT NOT NULL REFERENCES "Gift"(id),
 barcode TEXT NOT NULL, email TEXT NOT NULL CHECK(email=lower(btrim(email))),
 "customerGuid" TEXT NOT NULL, "externalGiftId" TEXT NOT NULL,
 box INTEGER NOT NULL CHECK(box BETWEEN 1 AND 5),
 "consentText" TEXT NOT NULL, "consentVersion" TEXT NOT NULL, "consentAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING_ASSIGNMENT','ASSIGNED','REJECTED')),
 "assignedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE("sessionId","requestKey")
);
CREATE UNIQUE INDEX assignment_email ON "AssignmentClaim"(email) WHERE status<>'REJECTED';
CREATE UNIQUE INDEX assignment_barcode ON "AssignmentClaim"(barcode) WHERE status<>'REJECTED';
CREATE UNIQUE INDEX assignment_gift ON "AssignmentClaim"("giftId") WHERE status<>'REJECTED';
CREATE TABLE "AssignmentJob" (
 id TEXT PRIMARY KEY, "claimId" TEXT NOT NULL UNIQUE REFERENCES "AssignmentClaim"(id),
 "idempotencyKey" TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "leaseUntil" TIMESTAMPTZ, "leaseToken" TEXT, "safeError" TEXT
);
CREATE TABLE "AuditEvent" (
 id BIGSERIAL PRIMARY KEY, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "eventType" TEXT NOT NULL, "correlationId" TEXT NOT NULL, metadata JSONB NOT NULL
);
CREATE FUNCTION immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audito istorija nekeiciama'; END; $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION immutable_audit();
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM PUBLIC;
CREATE TABLE "MockAssignment" (
 key TEXT PRIMARY KEY, payload TEXT NOT NULL, response JSONB NOT NULL, "giftId" TEXT UNIQUE
);
ALTER TABLE "Gift" ADD CONSTRAINT active_reservation FOREIGN KEY("activeReservationId") REFERENCES "Reservation"(id);
CREATE FUNCTION protect_new_gift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status IN ('reserved','pending','assigned','allocated') OR EXISTS(SELECT 1 FROM "Claim" WHERE "giftId"=OLD.id) THEN RAISE EXCEPTION 'Dovana apsaugota'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.status IN ('assigned','allocated') AND (NEW.status<>OLD.status OR NEW.code<>OLD.code OR NEW."externalGiftId"<>OLD."externalGiftId") THEN RAISE EXCEPTION 'Dovana apsaugota'; END IF;
 IF OLD.status IN ('reserved','pending') AND (NEW.code<>OLD.code OR NEW."externalGiftId"<>OLD."externalGiftId" OR NEW.status='archived') THEN RAISE EXCEPTION 'Dovana apsaugota'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_new_gift BEFORE UPDATE OR DELETE ON "Gift" FOR EACH ROW EXECUTE FUNCTION protect_new_gift();
