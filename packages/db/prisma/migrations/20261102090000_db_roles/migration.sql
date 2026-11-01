-- SPEC §13.6: in production the application role has no UPDATE/DELETE on "AuditLog". The retention
-- job purges rows past retention through this function, which runs with the owner's rights (the
-- migration role); the append-only trigger still refuses rows younger than 2 years.
CREATE FUNCTION purge_audit_log(older_than timestamptz) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $$
  WITH d AS (DELETE FROM "AuditLog" WHERE "createdAt" < older_than RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

REVOKE ALL ON FUNCTION purge_audit_log(timestamptz) FROM PUBLIC;

-- The application role exists only where infra/compose/postgres/init-roles.sh created it
-- (production example); in development a single role owns everything.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'accordo_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM accordo_app;
    GRANT EXECUTE ON FUNCTION purge_audit_log(timestamptz) TO accordo_app;
  END IF;
END $$;
