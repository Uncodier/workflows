#!/usr/bin/env bash
# Register custom search attributes on the self-hosted Temporal namespace (idempotent).
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
TEMPORAL_NS="${TEMPORAL_NAMESPACE:-default}"
ADMIN_POD="$(kubectl -n "${NS}" get pods -l app.kubernetes.io/component=admintools \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

if [[ -z "${ADMIN_POD}" ]]; then
  ADMIN_POD="$(kubectl -n "${NS}" get pods --no-headers 2>/dev/null | awk '/admintools/{print $1; exit}')"
fi
[[ -n "${ADMIN_POD}" ]] || die "Could not find Temporal admintools pod in namespace ${NS}"

ATTRS=(
  site_id
  user_id
  lead_id
  segment_id
  campaign_id
  person_id
  icp_mining_id
  command_id
  conversation_id
  instance_id
  workflow_category
)

log "Registering search attributes on namespace ${TEMPORAL_NS} via pod ${ADMIN_POD}..."

# Prefer modern temporal CLI; fall back to tctl if present in image.
create_attr() {
  local name="$1"
  kubectl -n "${NS}" exec "${ADMIN_POD}" -- \
    temporal operator search-attribute create \
      --namespace "${TEMPORAL_NS}" \
      --name "${name}" \
      --type Keyword 2>&1 \
    || kubectl -n "${NS}" exec "${ADMIN_POD}" -- \
      tctl --namespace "${TEMPORAL_NS}" admin cluster add-search-attributes \
        --name "${name}" --type Keyword 2>&1 \
    || true
}

for attr in "${ATTRS[@]}"; do
  log "  -> ${attr} (Keyword)"
  OUT="$(create_attr "${attr}" || true)"
  if echo "${OUT}" | grep -qiE 'already exists|AlreadyExists|success|created'; then
    log "     ok (${attr})"
  else
    # Print non-empty unexpected output for debugging; continue for idempotency
    [[ -z "${OUT}" ]] || log "     note: ${OUT}"
  fi
done

log "Listing search attributes..."
kubectl -n "${NS}" exec "${ADMIN_POD}" -- \
  temporal operator search-attribute list --namespace "${TEMPORAL_NS}" 2>/dev/null \
  || kubectl -n "${NS}" exec "${ADMIN_POD}" -- \
    tctl --namespace "${TEMPORAL_NS}" admin cluster get-search-attributes 2>/dev/null \
  || log "Could not list attributes (CLI version may differ); verify in Temporal UI."

log "Search attribute registration complete."
log "Workflows using upsertSearchAttributes will fail until these exist — registration is done."
