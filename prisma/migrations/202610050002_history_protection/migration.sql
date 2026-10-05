CREATE INDEX reservation_expiry ON "Reservation" ("expiresAt") WHERE status='RESERVED';
CREATE INDEX assignment_job_ready ON "AssignmentJob" (status,"nextAttemptAt");
CREATE INDEX audit_created ON "AuditEvent" ("createdAt");
ALTER TABLE "AssignmentClaim" ADD CONSTRAINT assignment_consent CHECK(length("consentText")>0 AND length("consentVersion")>0);
ALTER TABLE "AssignmentJob" ADD CONSTRAINT assignment_job_status CHECK(status IN ('pending','processing','accepted','rejected','review'));
CREATE FUNCTION protect_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Registracijos istorija apsaugota'; END IF;
 IF (to_jsonb(NEW)-'status'-'assignedAt') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'assignedAt')
 OR OLD.status IN ('ASSIGNED','REJECTED') THEN RAISE EXCEPTION 'Registracijos istorija apsaugota'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_assignment_history BEFORE UPDATE OR DELETE ON "AssignmentClaim" FOR EACH ROW EXECUTE FUNCTION protect_assignment_history();
CREATE TRIGGER immutable_validation BEFORE UPDATE OR DELETE ON "PurchaseValidation" FOR EACH ROW EXECUTE FUNCTION immutable_audit();
CREATE FUNCTION protect_reservation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Rezervacijos istorija apsaugota'; END IF;
 IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
 OR OLD.status IN ('ASSIGNED','EXPIRED','RELEASED') THEN RAISE EXCEPTION 'Rezervacijos istorija apsaugota'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_reservation_history BEFORE UPDATE OR DELETE ON "Reservation" FOR EACH ROW EXECUTE FUNCTION protect_reservation_history();
CREATE FUNCTION check_gift_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('reserved','pending') AND NOT EXISTS (
  SELECT 1 FROM "Reservation" r WHERE r.id=NEW."activeReservationId" AND r."giftId"=NEW.id
  AND r."expiresAt"=NEW."reservationExpiresAt"
  AND r.status=CASE WHEN NEW.status='reserved' THEN 'RESERVED' ELSE 'PENDING_ASSIGNMENT' END
 ) THEN RAISE EXCEPTION 'Dovanos rezervacijos grandine nesutampa'; END IF;
 IF NEW.status IN ('available','archived','assigned') AND
 (NEW."activeReservationId" IS NOT NULL OR NEW."reservationExpiresAt" IS NOT NULL) THEN RAISE EXCEPTION 'Aktyvi rezervacija neisvalyta'; END IF;
 IF OLD.status IN ('reserved','pending') AND NEW.status IN ('available','archived') AND EXISTS(
  SELECT 1 FROM "Reservation" WHERE id=OLD."activeReservationId" AND status IN ('RESERVED','PENDING_ASSIGNMENT','ASSIGNED')
 ) THEN RAISE EXCEPTION 'Aktyvi dovana apsaugota'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER check_gift_reservation BEFORE UPDATE ON "Gift" FOR EACH ROW EXECUTE FUNCTION check_gift_reservation();
