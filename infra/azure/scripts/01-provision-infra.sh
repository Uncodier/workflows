#!/usr/bin/env bash
# Provision Azure resources (AKS, PostgreSQL, App Service workers, Monitor, Key Vault).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
ensure_az_login
require_cmd jq

log "Ensuring resource group ${RESOURCE_GROUP} in ${AZURE_LOCATION}..."
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${AZURE_LOCATION}" \
  --tags environment="${ENVIRONMENT}" application=temporal \
  --output none

DEPLOYMENT_NAME="temporal-infra-$(date +%Y%m%d%H%M%S)"
BICEP_FILE="${AZURE_DIR}/bicep/main.bicep"

log "Deploying Bicep template (${DEPLOYMENT_NAME})..."
az deployment group create \
  --name "${DEPLOYMENT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --template-file "${BICEP_FILE}" \
  --parameters \
    namePrefix="${NAME_PREFIX}" \
    environment="${ENVIRONMENT}" \
    aksNodeCount="${AKS_NODE_COUNT}" \
    aksNodeVmSize="${AKS_NODE_VM_SIZE}" \
    aksKubernetesVersion="${AKS_KUBERNETES_VERSION:-}" \
    postgresAdminUser="${POSTGRES_ADMIN_USER}" \
    postgresAdminPassword="${POSTGRES_ADMIN_PASSWORD}" \
    postgresSku="${POSTGRES_SKU}" \
    postgresStorageGb="${POSTGRES_STORAGE_GB}" \
    postgresHaEnabled="${POSTGRES_HA_ENABLED}" \
    postgresVersion="${POSTGRES_VERSION}" \
    appServiceSku="${APP_SERVICE_SKU}" \
    workerDefaultName="${WORKER_DEFAULT_NAME}" \
    workerCriticalName="${WORKER_CRITICAL_NAME}" \
    enableManagedGrafana="${ENABLE_MANAGED_GRAFANA}" \
    enableManagedPrometheus="${ENABLE_MANAGED_PROMETHEUS}" \
  --output json >"${AZURE_DIR}/.last-deployment.json"

OUTS="$(az deployment group show \
  --name "${DEPLOYMENT_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query properties.outputs -o json)"

AKS_NAME="$(echo "${OUTS}" | jq -r '.aksName.value')"
POSTGRES_FQDN="$(echo "${OUTS}" | jq -r '.postgresFqdn.value')"
KEY_VAULT_NAME="$(echo "${OUTS}" | jq -r '.keyVaultName.value')"
APP_INSIGHTS_CS="$(echo "${OUTS}" | jq -r '.appInsightsConnectionString.value')"
WORKER_DEFAULT="$(echo "${OUTS}" | jq -r '.workerDefaultAppName.value')"
WORKER_CRITICAL="$(echo "${OUTS}" | jq -r '.workerCriticalAppName.value')"

save_output AKS_NAME "${AKS_NAME}"
save_output POSTGRES_FQDN "${POSTGRES_FQDN}"
save_output KEY_VAULT_NAME "${KEY_VAULT_NAME}"
save_output APP_INSIGHTS_CONNECTION_STRING "${APP_INSIGHTS_CS}"
save_output WORKER_DEFAULT_APP_NAME "${WORKER_DEFAULT}"
save_output WORKER_CRITICAL_APP_NAME "${WORKER_CRITICAL}"
save_output RESOURCE_GROUP "${RESOURCE_GROUP}"

# RBAC Key Vaults require role assignment BEFORE writing secrets.
USER_OID="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)"
KV_ID="$(az keyvault show --name "${KEY_VAULT_NAME}" --query id -o tsv)"
if [[ -n "${USER_OID}" ]]; then
  log "Granting Key Vault Secrets Officer to current user..."
  az role assignment create \
    --role "Key Vault Secrets Officer" \
    --assignee-object-id "${USER_OID}" \
    --assignee-principal-type User \
    --scope "${KV_ID}" \
    --output none 2>/dev/null || log "Key Vault role assignment may already exist"
  # RBAC propagation can take a short while
  sleep 30
fi

log "Storing Postgres password in Key Vault..."
az keyvault secret set \
  --vault-name "${KEY_VAULT_NAME}" \
  --name temporal-postgres-password \
  --value "${POSTGRES_ADMIN_PASSWORD}" \
  --output none

log "Fetching AKS credentials..."
az aks get-credentials \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${AKS_NAME}" \
  --overwrite-existing

log "Infra provisioned."
log "  AKS: ${AKS_NAME}"
log "  Postgres: ${POSTGRES_FQDN}"
log "  Workers: ${WORKER_DEFAULT}, ${WORKER_CRITICAL}"
log "Outputs saved to ${OUTPUTS_FILE}"
