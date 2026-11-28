#!/bin/sh
# Backup consistente do SQLite (seguro com o servidor rodando). Agende no cron:
#   15 * * * * alca /opt/alca-rng/deploy/backup.sh
set -eu
DB=/var/lib/alca-rng/nexus.sqlite
DIR=/var/lib/alca-rng/backups
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%d-%H%M)
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec(\"VACUUM INTO '\"+process.argv[2]+\"'\");" "$DB" "$DIR/nexus-$STAMP.sqlite"
gzip -f "$DIR/nexus-$STAMP.sqlite"
# Mantém 7 dias de backups locais. Copie também para fora da VM (S3 / Object Storage).
find "$DIR" -name 'nexus-*.sqlite.gz' -mtime +7 -delete
