#!/bin/sh
# Runs once, on the first start of an empty Postgres volume (docker-entrypoint-initdb.d). Creates the Face-X database with its
# two users (migrator = owner, app = read/write only) using the repository's own setup script.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db_name="$FACEX_DB_NAME" \
  -v migrator_password="$FACEX_MIGRATOR_PASSWORD" \
  -v app_password="$FACEX_APP_PASSWORD" \
  -f /facex/create-database.sql
