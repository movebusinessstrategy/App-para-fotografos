#!/bin/sh
# Gate da migration 083 num Postgres local descartável (nada toca o Supabase).
# Uso: sh scripts/followup-migration-gate.sh <pasta>
#   Sobe um cluster em <pasta>/pgdata, aplica stubs, a 083 duas vezes (idempotência)
#   e as fixtures com ASSERT. Termina com 'gate 083 ok' ou sai com erro.
# Variáveis opcionais: PG_BIN (padrão /opt/homebrew/bin) e GATE_PORT (padrão 55433).
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "uso: sh scripts/followup-migration-gate.sh <pasta>" >&2
  exit 2
fi

PG="${PG_BIN:-/opt/homebrew/bin}"
PORT="${GATE_PORT:-55433}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$1"
DIR="$(cd "$1" && pwd)"
DATA="$DIR/pgdata"
export LC_ALL=C LANG=C

# O socket Unix tem teto de ~100 caracteres no macOS; com uma pasta de caminho longo
# ele vai para um diretório curto temporário.
SOCK="$DIR"
TMP_SOCK=""
if [ "${#DIR}" -gt 80 ]; then
  TMP_SOCK="$(mktemp -d /tmp/fg083.XXXXXX)"
  SOCK="$TMP_SOCK"
fi

cleanup() {
  "$PG/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  if [ -n "$TMP_SOCK" ]; then rm -rf "$TMP_SOCK"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rm -rf "$DATA"
"$PG/initdb" -D "$DATA" -U postgres --auth=trust >"$DIR/initdb.log" 2>&1
"$PG/pg_ctl" -D "$DATA" -w -l "$DIR/postgres.log" -o "-p $PORT -k $SOCK -c listen_addresses=''" start >/dev/null

run_sql() {
  echo "-> $1"
  "$PG/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$1"
}

run_sql "$ROOT/scripts/followup-migration-gate-stubs.sql"
run_sql "$ROOT/migrations/083_followup_cadence.sql"
run_sql "$ROOT/migrations/083_followup_cadence.sql"
run_sql "$ROOT/scripts/followup-migration-gate-fixtures.sql"

echo 'gate 083 ok'
