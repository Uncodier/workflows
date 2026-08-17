#!/usr/bin/env bash
# Shared helpers for Azure Temporal deploy scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AZURE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${AZURE_DIR}/../.." && pwd)"
CONFIG_FILE="${AZURE_DIR}/config.env"
OUTPUTS_FILE="${AZURE_DIR}/.deploy-outputs.env"

log() { echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

load_config() {
  [[ -f "${CONFIG_FILE}" ]] || die "Missing ${CONFIG_FILE}. Copy config.env.example and fill values."
  # shellcheck disable=SC1090
  set -a
  source "${CONFIG_FILE}"
  set +a

  : "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is required}"
  : "${AZURE_LOCATION:?AZURE_LOCATION is required}"
  : "${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
  : "${NAME_PREFIX:?NAME_PREFIX is required}"
  : "${POSTGRES_ADMIN_USER:?POSTGRES_ADMIN_USER is required}"
  : "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD is required}"
  : "${WORKER_DEFAULT_NAME:?WORKER_DEFAULT_NAME is required}"
  : "${WORKER_CRITICAL_NAME:?WORKER_CRITICAL_NAME is required}"

  TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
  TEMPORAL_HELM_RELEASE="${TEMPORAL_HELM_RELEASE:-temporal}"
  TEMPORAL_K8S_NAMESPACE="${TEMPORAL_K8S_NAMESPACE:-temporal}"
  AKS_NODE_COUNT="${AKS_NODE_COUNT:-3}"
  AKS_NODE_VM_SIZE="${AKS_NODE_VM_SIZE:-Standard_D4s_v5}"
  POSTGRES_SKU="${POSTGRES_SKU:-Standard_D2s_v3}"
  POSTGRES_STORAGE_GB="${POSTGRES_STORAGE_GB:-128}"
  POSTGRES_HA_ENABLED="${POSTGRES_HA_ENABLED:-true}"
  POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
  APP_SERVICE_SKU="${APP_SERVICE_SKU:-P1v3}"
  ENABLE_MANAGED_GRAFANA="${ENABLE_MANAGED_GRAFANA:-true}"
  ENABLE_MANAGED_PROMETHEUS="${ENABLE_MANAGED_PROMETHEUS:-true}"
  ENVIRONMENT="${ENVIRONMENT:-prod}"
}

ensure_az_login() {
  require_cmd az
  if ! az account show >/dev/null 2>&1; then
    log "Not logged in. Running az login..."
    az login
  fi
  az account set --subscription "${AZURE_SUBSCRIPTION_ID}"
  log "Using subscription: $(az account show --query name -o tsv)"
}

save_output() {
  local key="$1"
  local value="$2"
  touch "${OUTPUTS_FILE}"
  if grep -q "^${key}=" "${OUTPUTS_FILE}" 2>/dev/null; then
    # portable in-place update
    local tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "${OUTPUTS_FILE}" >"${tmp}" || true
    echo "${key}=${value}" >>"${tmp}"
    mv "${tmp}" "${OUTPUTS_FILE}"
  else
    echo "${key}=${value}" >>"${OUTPUTS_FILE}"
  fi
}

load_outputs() {
  if [[ -f "${OUTPUTS_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "${OUTPUTS_FILE}"
    set +a
  fi
}
