#!/usr/bin/env bash
# Verify local tooling and Azure login before provisioning.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
require_cmd az
require_cmd helm
require_cmd kubectl
require_cmd jq

ensure_az_login

log "Checking Azure providers..."
for ns in Microsoft.ContainerService Microsoft.ContainerRegistry \
          Microsoft.DBforPostgreSQL Microsoft.Web \
          Microsoft.OperationalInsights Microsoft.OperationsManagement \
          Microsoft.Insights Microsoft.Monitor \
          Microsoft.Dashboard Microsoft.KeyVault Microsoft.Network; do
  state="$(az provider show -n "${ns}" --query registrationState -o tsv 2>/dev/null || echo Unknown)"
  if [[ "${state}" != "Registered" ]]; then
    log "Registering provider ${ns}..."
    az provider register --namespace "${ns}" --wait
  else
    log "Provider ${ns}: Registered"
  fi
done

log "Checking AKS versions in ${AZURE_LOCATION}..."
az aks get-versions --location "${AZURE_LOCATION}" --query "values[0].version" -o tsv >/dev/null

log "Prerequisites OK."
