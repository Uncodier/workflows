#!/usr/bin/env bash
# End-to-end deploy: prereqs -> infra -> helm -> observability -> workers -> network -> search attrs.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Temporal on Azure — full deploy ==="
"${SCRIPT_DIR}/00-prereqs.sh"
"${SCRIPT_DIR}/01-provision-infra.sh"
"${SCRIPT_DIR}/02-deploy-temporal-helm.sh"
"${SCRIPT_DIR}/03-setup-observability.sh"
"${SCRIPT_DIR}/04-deploy-workers.sh"
"${SCRIPT_DIR}/05-wire-network.sh"
"${SCRIPT_DIR}/06-register-search-attributes.sh"
"${SCRIPT_DIR}/07-deploy-workers-aks.sh"
"${SCRIPT_DIR}/08-deploy-temporal-gateway.sh"
echo "=== Deploy finished. See infra/azure/.deploy-outputs.env and docs/azure/DEPLOYMENT.md ==="
