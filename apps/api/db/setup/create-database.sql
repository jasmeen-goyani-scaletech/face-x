-- Creates (or tops up) a Face-X database and its two users. Safe to run again: anything that exists is left as it is.
--
-- Run as a PostgreSQL superuser, with the passwords passed in (never written in this file):
--
--   psql -h <host> -U postgres \
--        -v db_name=facex -v migrator_password='...' -v app_password='...' \
--        -f apps/api/db/setup/create-database.sql
--
-- Optional: -v migrator_role=facex_migrator -v app_role=facex_app   (these are the defaults)
--
-- Two users, on purpose:
--   migrator  owns the database and its tables. It is used ONLY to run migrations (`db:migrate`).
--   app       is what the running API connects as. It can read and write data but cannot create or change tables, so a bug
--             or injection in the app cannot alter the schema.
-- Roles are shared by every database in a PostgreSQL server, so the same pair can serve a development database and a real
-- one. Their passwords are set only when the role is first created.

\set ON_ERROR_STOP on
\if :{?migrator_role} \else \set migrator_role facex_migrator \endif
\if :{?app_role} \else \set app_role facex_app \endif
\if :{?db_name} \else \echo 'db_name is required: -v db_name=facex' \quit \endif

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'migrator_role', :'migrator_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'migrator_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

\connect :"db_name"

-- Nobody but the owner may create objects in the public schema; the API user may use it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec

-- Tables and sequences the migrator creates (now and in future migrations) are readable and writable by the API user.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
              :'migrator_role', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
              :'migrator_role', :'app_role') \gexec

\echo 'Database ready:' :db_name '(run the migrations next, as the migrator user)'
