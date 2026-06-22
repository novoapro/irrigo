#!/usr/bin/env bash
#
# Deploy the scheduled-execution fix to home-server and verify it.
# Run this from the repo root on the machine whose docker context points at the
# target server (e.g. after: docker context use home-server-docker).
#
# It is safe to re-run. It does NOT trigger watering — it only builds, deploys,
# and reads state. The final confirmation happens on the next real scheduled cycle.
#
set -uo pipefail

COMPOSE="docker-compose"               # this repo uses docker-compose (v1-style binary)
MONGO_DB="my_lawn_monitor"
LOG=/tmp/irrigo-deploy.log
: > "$LOG"
say() { echo "==> $*" | tee -a "$LOG"; }

# Resolve the running mongo container name on the active context (best-effort).
MONGO_CT="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i mongo | head -1)"
mongo_eval() { docker exec "$MONGO_CT" mongosh --quiet --eval "$1" 2>>"$LOG"; }

say "Target docker context: $(docker context show 2>/dev/null)"
say "Mongo container: ${MONGO_CT:-<none found>}"

# 1) Ensure the external network the compose file requires exists.
say "Ensuring external 'mongodb' network exists"
docker network create mongodb >/dev/null 2>&1 && say "  created" || say "  already present"

# 2) Build ONLY the backend (the fix is backend-only) with the now-reproducible Dockerfile.
say "Building backend (npm ci, --no-cache)…"
if ! $COMPOSE build --no-cache backend 2>&1 | tee -a "$LOG" | tail -5; then
  say "BUILD FAILED — see $LOG (share the tail)"; exit 1
fi

# 3) Pre-deploy safety: refuse to restart while a run is active.
if [ -n "$MONGO_CT" ]; then
  ACTIVE="$(mongo_eval "print(db.getSiblingDB(\"$MONGO_DB\").sequentialruns.countDocuments({status:{\$in:[\"running\",\"deferred\"]}}))" | tr -dc '0-9')"
  say "Active runs right now: ${ACTIVE:-?}"
  if [ "${ACTIVE:-0}" != "0" ]; then
    say "A run is active — NOT restarting. Re-run when idle."; exit 1
  fi
fi

# 4) Deploy.
say "Recreating backend container…"
$COMPOSE up -d backend 2>&1 | tee -a "$LOG" | tail -5

# 5) Health check.
BACKEND_CT="$(docker ps --format '{{.Names}}' | grep -i backend | head -1)"
say "Backend container: ${BACKEND_CT:-<none>}"
sleep 4
docker logs --tail 15 "$BACKEND_CT" 2>&1 | tee -a "$LOG" | grep -Ei "listening|connected|started|error" || true

# 6) Verify the fix shipped (enum widened) inside the running image.
if docker exec "$BACKEND_CT" sh -c 'grep -q ai-schedule dist/models/IrrigationEvent.js' 2>/dev/null; then
  say "FIX CONFIRMED in deployed image (IrrigationEvent enum includes ai-schedule)"
else
  say "WARNING: deployed image does not contain the enum fix — wrong build?"
fi

# 7) Remediation check: a zone whose LAST event is 'on' would make the next
#    scheduled run fail with 'Zone is already on'. Report any so they can be cleared.
if [ -n "$MONGO_CT" ]; then
  say "Checking for stale 'on' zone state (would block the next run)…"
  mongo_eval '
    const d=db.getSiblingDB("'"$MONGO_DB"'");
    const zones=d.zones.find({},{zoneId:1,_id:0}).toArray().map(z=>z.zoneId);
    let stale=0;
    zones.forEach(z=>{const e=d.irrigationevents.find({zone:z}).sort({createdAt:-1}).limit(1).toArray()[0];
      if(e&&e.action==="on"){stale++;print("  STALE ON: "+z+" (last event on @ "+e.createdAt+") — send an off before next run");}});
    if(!stale)print("  OK: no zone is stuck on");
  ' | tee -a "$LOG"

  say "Baseline (should become >0 after the next scheduled cycle):"
  mongo_eval 'print("  scheduled events recorded: "+db.getSiblingDB("'"$MONGO_DB"'").irrigationevents.countDocuments({source:{$in:["program","ai-schedule"]}}))' | tee -a "$LOG"
fi

say "Done. Full log: $LOG"
say "After the next scheduled run, re-check: scheduled events >0 and the latest ai-schedule sequentialrun = completed with full durations."
