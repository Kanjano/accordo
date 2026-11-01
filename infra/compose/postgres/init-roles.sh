#!/bin/sh
# First start of the production database (SPEC §13.6): a migration role that owns the schema and an
# application role with data privileges only. The migration 20261102090000_db_roles then removes
# UPDATE/DELETE on "AuditLog" from the application role.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE accordo_migrator LOGIN PASSWORD '${MIGRATOR_PASSWORD}';
CREATE ROLE accordo_app LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE accordo OWNER accordo_migrator;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname accordo <<SQL
ALTER SCHEMA public OWNER TO accordo_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO accordo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE accordo_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO accordo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE accordo_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO accordo_app;
SQL
