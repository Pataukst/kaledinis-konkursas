ALTER TABLE "Gift" ADD CONSTRAINT "gift_status" CHECK (status IN ('available','allocated','archived'));
ALTER TABLE "Claim" ADD CONSTRAINT "claim_email_normalized" CHECK (email=lower(btrim(email)));
ALTER TABLE "Claim" ADD CONSTRAINT "claim_box" CHECK (box BETWEEN 1 AND 5);
ALTER TABLE "Claim" ADD CONSTRAINT "claim_consent" CHECK (length("consentText")>0 AND length("consentVersion")>0);
ALTER TABLE "DeliveryJob" ADD CONSTRAINT "delivery_status" CHECK (status IN ('pending','processing','accepted','failed'));
-- Do not permit an allocated code to re-enter the active pool, even via direct SQL.
CREATE FUNCTION protect_allocated_gift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "Claim" WHERE "giftId"=OLD.id) AND (NEW.status<>'allocated' OR NEW.code<>OLD.code) THEN
  RAISE EXCEPTION 'Paskirta dovana apsaugota';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_allocated_gift BEFORE UPDATE ON "Gift" FOR EACH ROW EXECUTE FUNCTION protect_allocated_gift();