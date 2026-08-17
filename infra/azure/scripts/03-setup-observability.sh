#!/usr/bin/env bash
# Wire Azure Monitor / Managed Prometheus / Container Insights to AKS + Temporal metrics.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
load_outputs
ensure_az_login
require_cmd kubectl
require_cmd jq

: "${AKS_NAME:?Run 01-provision-infra.sh first}"

log "Enabling Azure Monitor metrics addon (Managed Prometheus) on AKS..."
# Best-effort: newer CLI uses --enable-azure-monitor-metrics
if az aks update \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${AKS_NAME}" \
  --enable-azure-monitor-metrics \
  --output none 2>/dev/null; then
  log "Azure Monitor metrics enabled on AKS"
else
  log "Could not enable --enable-azure-monitor-metrics (CLI/region may differ). Continuing..."
fi

AKS_ID="$(az aks show -g "${RESOURCE_GROUP}" -n "${AKS_NAME}" --query id -o tsv)"
DCR_ID="$(az resource list \
  -g "${RESOURCE_GROUP}" \
  --resource-type Microsoft.Insights/dataCollectionRules \
  --query "[?contains(name, 'dcr-prometheus')].id | [0]" -o tsv 2>/dev/null || true)"

if [[ -n "${DCR_ID}" && "${DCR_ID}" != "null" ]]; then
  log "Associating Data Collection Rule with AKS..."
  ASSOC_NAME="${NAME_PREFIX}-dcr-aks"
  az rest --method put \
    --url "https://management.azure.com${AKS_ID}/providers/Microsoft.Insights/dataCollectionRuleAssociations/${ASSOC_NAME}?api-version=2022-06-01" \
    --body "{\"properties\":{\"dataCollectionRuleId\":\"${DCR_ID}\"}}" \
    --output none 2>/dev/null || log "DCR association may already exist"
  save_output DCR_ID "${DCR_ID}"
fi

log "Applying PodMonitor-compatible scrape annotations note for Temporal..."
# Temporal chart already sets prometheus.io/* annotations when metrics.annotations.enabled=true.
# Azure Monitor managed Prometheus scrapes those via ama-metrics.
kubectl -n "${TEMPORAL_K8S_NAMESPACE:-temporal}" get pods -l app.kubernetes.io/name=temporal \
  -o wide 2>/dev/null || log "Temporal pods not found yet (deploy Helm first)"

GRAFANA_NAME="$(az resource list \
  -g "${RESOURCE_GROUP}" \
  --resource-type Microsoft.Dashboard/grafana \
  --query "[0].name" -o tsv 2>/dev/null || true)"
if [[ -n "${GRAFANA_NAME}" && "${GRAFANA_NAME}" != "null" ]]; then
  ENDPOINT="$(az grafana show -g "${RESOURCE_GROUP}" -n "${GRAFANA_NAME}" --query properties.endpoint -o tsv 2>/dev/null || true)"
  save_output GRAFANA_NAME "${GRAFANA_NAME}"
  save_output GRAFANA_ENDPOINT "${ENDPOINT}"
  log "Managed Grafana: ${ENDPOINT}"
fi

# Apply optional Prometheus scrape ConfigMap for Temporal frontend metrics port
kubectl apply -f "${AZURE_DIR}/observability/ama-metrics-temporal-config.yaml" 2>/dev/null \
  || log "Custom ama-metrics config apply skipped or already present"

log "Observability setup complete (Azure Monitor + Managed Prometheus + Managed Grafana)."
log "Temporal Web UI remains ClusterIP — use: kubectl -n temporal port-forward svc/${TEMPORAL_HELM_RELEASE:-temporal}-web 8080:8080"
