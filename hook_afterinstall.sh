#!/bin/bash
set -euo pipefail

# === Color codes ===
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color
TEMP_PROJECT_PATH="/home/saas/temp-rupa-dms-backend"

PROJECT_PATH="/home/saas/app/rupa-dms-backend"
printf "live\n"
ECOSYSTEM_FILE="/home/saas/scripts/pm2StartDMSBackend.config.js"
APP_NAME="rupa-dms-backend"

echo -e "${YELLOW}************** Backend Deployment Start **************${NC}"

# === Rsync with parallelism ===
num_cpu=$(nproc)
process_cpu=$((num_cpu / 2))

if [ -z "$process_cpu" ]; then
  process_cpu=2
fi

printf "Executing - rsync --size-only with -p $process_cpu processes \n"
ls -A "$TEMP_PROJECT_PATH" | xargs -I {} -P $process_cpu -n 1 rsync -rlpgoDK \
  --size-only --exclude='.git' --delete-after \
  "$TEMP_PROJECT_PATH"/{} "$PROJECT_PATH" --out-format="%n"

printf "Executing - rsync -c with -p $process_cpu processes \n"
ls -A "$TEMP_PROJECT_PATH"/ | xargs -I {} -P $process_cpu -n 1 rsync -rlpgoDcK \
  --exclude='.git' \
  "$TEMP_PROJECT_PATH"/{} "$PROJECT_PATH" --out-format="%n"

if [ -f "$TEMP_PROJECT_PATH/.env" ]; then
  cp "$TEMP_PROJECT_PATH/.env" "$PROJECT_PATH/"
fi
cd "$PROJECT_PATH"

npm install

# === PM2 reload/start ===
if pm2 status "$APP_NAME" | grep -q "online"; then
    echo -e "${YELLOW}♻️ '$APP_NAME' is running. Reloading...${NC}"
    pm2 reload "$APP_NAME"
else
    echo -e "${YELLOW}🚀 '$APP_NAME' is not running. Starting...${NC}"
    pm2 start "$ECOSYSTEM_FILE"
    pm2 save
fi

echo -e "${GREEN}✅ PM2 status for '$APP_NAME':${NC}"
pm2 status "$APP_NAME"

echo -e "${GREEN}############# Backend Deployment End ##############${NC}"
