#!/usr/bin/env bash
# Resolve Temporal internal LB IP and wire TEMPORAL_SERVER_URL into App Service workers.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
load_outputs
ensure_az_login
require_cmd kubectl

: "${AKS_NAME:?Run 01-provision-infra.sh first}"

az aks get-credentials \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${AKS_NAME}" \
  --overwrite-existing

NS="${TEMPORAL_K8S_NAMESPACE:-temporal}"
RELEASE="${TEMPORAL_HELM_RELEASE:-temporal}"

log "Resolving Temporal frontend internal LoadBalancer IP..."
IP=""
for i in $(seq 1 36); do
  IP="$(kubectl -n "${NS}" get svc "${RELEASE}-frontend" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "${IP}" ]]; then
    break
  fi
  log "Waiting for internal LB IP... (${i}/36)"
  sleep 10
done

[[ -n "${IP}" ]] || die "Temporal frontend has no LoadBalancer IP. Check: kubectl -n ${NS} get svc ${RELEASE}-frontend"

TEMPORAL_URL="${IP}:7233"
save_output TEMPORAL_INTERNAL_IP "${IP}"
save_output TEMPORAL_SERVER_URL "${TEMPORAL_URL}"

DEFAULT_APP="${WORKER_DEFAULT_APP_NAME:-$WORKER_DEFAULT_NAME}"
CRITICAL_APP="${WORKER_CRITICAL_APP_NAME:-$WORKER_CRITICAL_NAME}"

for app in "${DEFAULT_APP}" "${CRITICAL_APP}"; do
  log "Setting TEMPORAL_SERVER_URL=${TEMPORAL_URL} on ${app}..."
  az webapp config appsettings set \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${app}" \
    --settings \
      "TEMPORAL_SERVER_URL=${TEMPORAL_URL}" \
      "TEMPORAL_NAMESPACE=${TEMPORAL_NAMESPACE:-default}" \
      "TEMPORAL_TLS=false" \
    --output none

  # Restart so workers reconnect
  az webapp restart --resource-group "${RESOURCE_GROUP}" --name "${app}" --output none
done

log "Network wiring complete."
log "  TEMPORAL_SERVER_URL=${TEMPORAL_URL}"
log "  Workers restarted on both queues."
log ""
log "Connectivity check from a worker (Kudu SSH / console):"
log "  nc -vz ${IP} 7233"
log "Or from AKS:"
log "  kubectl -n ${NS} run tmp --rm -it --image=busybox --restart=Never -- nc -zv ${IP} 7233"
