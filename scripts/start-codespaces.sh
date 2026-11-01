#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${AIVEN_DB_HOST:-}" ]]; then
  : "${AIVEN_DB_PORT:?Set the AIVEN_DB_PORT Codespaces secret}"
  : "${AIVEN_DB_USER:?Set the AIVEN_DB_USER Codespaces secret}"
  : "${AIVEN_DB_PASSWORD:?Set the AIVEN_DB_PASSWORD Codespaces secret}"
  : "${AIVEN_DB_NAME:?Set the AIVEN_DB_NAME Codespaces secret}"
  export DB_HOST="$AIVEN_DB_HOST"
  export DB_PORT="$AIVEN_DB_PORT"
  export DB_USER="$AIVEN_DB_USER"
  export DB_PASSWORD="$AIVEN_DB_PASSWORD"
  export DB_NAME="$AIVEN_DB_NAME"
  export DB_SSL=true
  export DB_SSL_CA="${AIVEN_DB_CA:-}"
else
  export DB_HOST=db
  export DB_PORT=3306
  export DB_USER=root
  export DB_PASSWORD=codespaces-local-mysql-password
  export DB_NAME=smart_dairy
  export DB_SSL=false
fi

for attempt in {1..30}; do
  if node scripts/init-codespaces-db.js; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Could not initialize the Codespaces database after 5 minutes." >&2
    exit 1
  fi
  sleep 10
done

exec npm run dev
