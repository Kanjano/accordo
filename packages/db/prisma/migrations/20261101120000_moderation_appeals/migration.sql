-- AlterTable
ALTER TABLE "ModerationAction" ADD COLUMN "appealDecidedAt" TIMESTAMP(3),
ADD COLUMN "appealReviewerId" TEXT,
ADD COLUMN "appealStatement" TEXT,
ADD COLUMN "appealText" TEXT,
ADD COLUMN "reversedAt" TIMESTAMP(3);

-- SPEC §13.6: the audit log is append-only. Rows can only be purged once past retention (2 years,
-- SPEC §14.5), by the nightly retention job. Enforced in the database, whatever the connecting role.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AuditLog is append-only';
  END IF;
  IF OLD."createdAt" > now() - interval '2 years' THEN
    RAISE EXCEPTION 'AuditLog rows younger than 2 years cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
