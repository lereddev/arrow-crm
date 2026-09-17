#!/usr/bin/env bash
# Applique les migrations sur une base Postgres neuve, puis exécute les
# tests de sécurité. Repart de zéro à chaque exécution : un test qui
# dépend de l'état laissé par le précédent ne prouve rien.
#
#   ./scripts/test-db.sh
#
# Requiert un Postgres 16 local. Variables surchargeables :
#   PGHOST PGPORT PGUSER PGDATABASE
set -euo pipefail

PGHOST="${PGHOST:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-arrow_test}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q -c "set client_min_messages = warning;" -f /dev/null)
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)

echo "→ base neuve : $PGDATABASE"
"${PSQL[@]}" -d postgres -c "drop database if exists $PGDATABASE;" >/dev/null
"${PSQL[@]}" -d postgres -c "create database $PGDATABASE;" >/dev/null

echo "→ harnais (équivalent local de Supabase)"
"${PSQL[@]}" -d "$PGDATABASE" -f "$ROOT/supabase/tests/00_harness.sql" >/dev/null

echo "→ migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  "${PSQL[@]}" -d "$PGDATABASE" -f "$f" >/dev/null
done

echo "→ tests de sécurité"
"${PSQL[@]}" -d "$PGDATABASE" -f "$ROOT/supabase/tests/01_rls.sql"
"${PSQL[@]}" -d "$PGDATABASE" -f "$ROOT/supabase/tests/02_explorer.sql"
"${PSQL[@]}" -d "$PGDATABASE" -f "$ROOT/supabase/tests/03_legacy_lockdown.sql"
