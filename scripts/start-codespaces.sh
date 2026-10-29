#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Startup failed at line $LINENO. Containers and existing rules were preserved." >&2' ERR

cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null
command -v iptables-legacy >/dev/null
sudo_cmd=()
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null
  sudo_cmd=(sudo)
fi

# Check access before starting containers. Do not create or flush firewall chains.
"${sudo_cmd[@]}" iptables-legacy -w -S DOCKER-USER >/dev/null
docker compose up -d

php_id=$(docker compose ps -q php)
[[ -n "$php_id" ]]
network_ids=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .NetworkID}}{{end}}' "$php_id")
mapfile -t networks < <(printf '%s\n' "$network_ids" | sed '/^[[:space:]]*$/d')
if [[ ${#networks[@]} -ne 1 ]]; then
  echo 'Expected exactly one PHP network; refusing to guess a firewall interface.' >&2
  exit 1
fi
network_id=${networks[0]}
driver=$(docker network inspect --format '{{.Driver}}' "$network_id")
[[ "$driver" == bridge ]]
bridge=$(docker network inspect --format '{{index .Options "com.docker.network.bridge.name"}}' "$network_id")
if [[ -z "$bridge" || "$bridge" == '<no value>' ]]; then
  bridge="br-${network_id:0:12}"
fi
[[ "$bridge" =~ ^[a-zA-Z0-9_.-]+$ && -d "/sys/class/net/$bridge/bridge" ]]

ensure_rule() {
  local status
  if "${sudo_cmd[@]}" iptables-legacy -w -C DOCKER-USER "$@"; then
    echo "Rule already present: $*"
  else
    status=$?
    if [[ $status -ne 1 ]]; then
      echo "Unable to inspect firewall rule (exit $status)." >&2
      return "$status"
    fi
    "${sudo_cmd[@]}" iptables-legacy -w -I DOCKER-USER 1 "$@"
    echo "Added rule: $*"
  fi
}

ensure_rule -i "$bridge" -j ACCEPT
ensure_rule -o "$bridge" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# The worker healthcheck is local and does not contact a shop.
worker_id=$(docker compose ps -q playwright)
[[ -n "$worker_id" ]]
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  state=$(docker inspect --format '{{.State.Status}}' "$worker_id")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$worker_id")
  if [[ "$state" == running && "$health" == healthy ]]; then
    ready=true
    break
  fi
  if [[ "$state" == exited || "$state" == dead ]]; then
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo 'Worker did not become healthy. Inspect: docker compose logs --tail=50 playwright' >&2
  exit 1
fi
docker compose exec -T playwright node -e 'require("node:dns").lookup("applemusic.co.kr",(e,a)=>{if(e){console.error("DNS check failed:",e.code);process.exitCode=1}else console.log("DNS OK:",a)})'
echo "Startup complete (bridge: $bridge). Product analysis has not been tested."
