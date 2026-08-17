#!/usr/bin/env bash
# Install Temporal Server via official Helm chart with Postgres dual visibility.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
load_outputs
ensure_az_login
require_cmd helm
require_cmd kubectl

: "${POSTGRES_FQDN:?Run 01-provision-infra.sh first (POSTGRES_FQDN missing)}"
: "${AKS_NAME:?Run 01-provision-infra.sh first (AKS_NAME missing)}"

log "Ensuring kubectl context for ${AKS_NAME}..."
az aks get-credentials \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${AKS_NAME}" \
  --overwrite-existing

kubectl create namespace "${TEMPORAL_K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

log "Creating temporal-db-secret..."
kubectl -n "${TEMPORAL_K8S_NAMESPACE}" create secret generic temporal-db-secret \
  --from-literal=password="${POSTGRES_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f -

RENDERED_VALUES="${AZURE_DIR}/helm/temporal-values.generated.yaml"
sed \
  -e "s|__POSTGRES_FQDN__|${POSTGRES_FQDN}|g" \
  -e "s|__POSTGRES_USER__|${POSTGRES_ADMIN_USER}|g" \
  -e "s|__TEMPORAL_NAMESPACE__|${TEMPORAL_NAMESPACE}|g" \
  "${AZURE_DIR}/helm/temporal-values.yaml.tpl" >"${RENDERED_VALUES}"

log "Adding Temporal Helm repo..."
helm repo add temporalio https://go.temporal.io/helm-charts 2>/dev/null || true
helm repo update temporalio

# Temporal visibility schema needs btree_gin on Azure Database for PostgreSQL.
PG_SERVER="$(echo "${POSTGRES_FQDN}" | cut -d. -f1)"
log "Allow-listing Postgres extensions (btree_gin) on ${PG_SERVER}..."
az postgres flexible-server parameter set \
  -g "${RESOURCE_GROUP}" -s "${PG_SERVER}" \
  -n azure.extensions \
  --value "BTREE_GIN,PGCRYPTO,UUID-OSSP" \
  --output none 2>/dev/null || log "Could not set azure.extensions (may already be set)"

log "Installing/upgrading Temporal release ${TEMPORAL_HELM_RELEASE}..."
helm upgrade --install "${TEMPORAL_HELM_RELEASE}" temporalio/temporal \
  --namespace "${TEMPORAL_K8S_NAMESPACE}" \
  --create-namespace \
  -f "${RENDERED_VALUES}" \
  --timeout 30m \
  --wait

log "Waiting for frontend service..."
for i in $(seq 1 60); do
  IP="$(kubectl -n "${TEMPORAL_K8S_NAMESPACE}" get svc "${TEMPORAL_HELM_RELEASE}-frontend" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "${IP}" ]]; then
    save_output TEMPORAL_INTERNAL_IP "${IP}"
    save_output TEMPORAL_SERVER_URL "${IP}:7233"
    log "Temporal frontend internal LB IP: ${IP}"
    break
  fi
  sleep 10
done

if [[ -z "${IP:-}" ]]; then
  log "WARNING: Internal LB IP not ready yet. Re-run 05-wire-network.sh later."
fi

log "Temporal Helm deploy complete."
kubectl -n "${TEMPORAL_K8S_NAMESPACE}" get pods,svc
