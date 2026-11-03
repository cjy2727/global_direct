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

services_raw=$(docker compose config --services)
mapfile -t services < <(printf '%s\n' "$services_raw" | sed '/^[[:space:]]*$/d')
if [[ ${#services[@]} -eq 0 ]]; then
  echo 'No compose services found.' >&2
  exit 1
fi

service=""
for s in "${services[@]}"; do
  if [[ "$s" == globaldirect ]]; then
    service="$s"
    break
  fi
done
if [[ -z "$service" ]]; then
  for s in "${services[@]}"; do
    if [[ "$s" == php ]]; then
      service="$s"
      break
    fi
  done
fi
if [[ -z "$service" ]]; then
  service=${services[0]}
fi

app_id=$(docker compose ps -q "$service")
[[ -n "$app_id" ]]
network_ids=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .NetworkID}}{{end}}' "$app_id")
mapfile -t networks < <(printf '%s\n' "$network_ids" | sed '/^[[:space:]]*$/d')
if [[ ${#networks[@]} -ne 1 ]]; then
  echo 'Expected exactly one service network; refusing to guess a firewall interface.' >&2
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

# Wait for selected service health. In this repo, healthcheck is defined on the
# main app container and includes both API and worker-local checks.
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  state=$(docker inspect --format '{{.State.Status}}' "$app_id")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$app_id")
  if [[ "$state" == running && ( -z "$health" || "$health" == healthy ) ]]; then
    ready=true
    break
  fi
  if [[ "$state" == exited || "$state" == dead ]]; then
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "Service '$service' did not become ready. Inspect: docker compose logs --tail=50 $service" >&2
  exit 1
fi
docker compose exec -T "$service" node -e 'require("node:dns").lookup("applemusic.co.kr",(e,a)=>{if(e){console.error("DNS check failed:",e.code);process.exitCode=1}else console.log("DNS OK:",a)})'
echo "Startup complete (service: $service, bridge: $bridge). Product analysis has not been tested."
