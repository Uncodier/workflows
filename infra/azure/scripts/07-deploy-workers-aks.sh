#!/usr/bin/env bash
# Build worker image in ACR and deploy default + critical workers into AKS.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
load_outputs
ensure_az_login
require_cmd kubectl

: "${AKS_NAME:?Run infra provision first}"
: "${RESOURCE_GROUP:?}"

ACR_NAME="${ACR_NAME:-uncodietmpacr}"
# ACR names: 5-50 alphanumeric
ACR_NAME="$(echo "${ACR_NAME}" | tr -cd 'a-z0-9' | cut -c1-50)"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"

log "Ensuring ACR ${ACR_NAME}..."
if ! az acr show -g "${RESOURCE_GROUP}" -n "${ACR_NAME}" >/dev/null 2>&1; then
  az acr create -g "${RESOURCE_GROUP}" -n "${ACR_NAME}" --sku Basic --admin-enabled false -o none
fi

log "Attaching ACR to AKS..."
az aks update -g "${RESOURCE_GROUP}" -n "${AKS_NAME}" --attach-acr "${ACR_NAME}" -o none

az aks get-credentials -g "${RESOURCE_GROUP}" -n "${AKS_NAME}" --overwrite-existing

# Stage build context with required uncommitted worker entrypoint
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
rsync -a \
  --exclude node_modules --exclude .git --exclude .next --exclude dist \
  --exclude infra/azure/config.env --exclude infra/azure/.deploy-outputs.env \
  --exclude '*.pem' --exclude .env.local \
  "${REPO_ROOT}/" "${STAGE}/"
cp "${AZURE_DIR}/workers/Dockerfile" "${STAGE}/Dockerfile"
cp "${AZURE_DIR}/workers/.dockerignore" "${STAGE}/.dockerignore"
[[ -f "${STAGE}/Dockerfile" ]] || die "Dockerfile missing in build stage"
[[ -f "${STAGE}/src/scripts/azure-worker-startup.ts" ]] || die "azure-worker-startup.ts missing in build stage"

log "Building image in ACR (cloud build)..."
# -f must be relative to the uploaded context directory
(
  cd "${STAGE}"
  az acr build \
    -r "${ACR_NAME}" \
    -t "temporal-worker:${IMAGE_TAG}" \
    -t "temporal-worker:latest" \
    -f Dockerfile \
    .
)

LOGIN_SERVER="$(az acr show -n "${ACR_NAME}" --query loginServer -o tsv)"
WORKER_IMAGE="${LOGIN_SERVER}/temporal-worker:${IMAGE_TAG}"
log "Image: ${WORKER_IMAGE}"

MANIFEST="$(mktemp)"
sed \
  -e "s|__WORKER_IMAGE__|${WORKER_IMAGE}|g" \
  -e "s|__API_BASE_URL__|${API_BASE_URL:-}|g" \
  -e "s|__API_KEY__|${API_KEY:-}|g" \
  -e "s|__SUPABASE_URL__|${SUPABASE_URL:-}|g" \
  -e "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY:-}|g" \
  -e "s|__SUPABASE_SERVICE_ROLE_KEY__|${SUPABASE_SERVICE_ROLE_KEY:-}|g" \
  -e "s|__REOON_API_KEY__|${REOON_API_KEY:-}|g" \
  "${AZURE_DIR}/workers/k8s-workers.yaml" >"${MANIFEST}"

log "Applying worker deployments..."
kubectl apply -f "${MANIFEST}"
for deploy in temporal-worker-default temporal-worker-critical temporal-worker-high temporal-worker-low temporal-worker-background; do
  kubectl -n temporal-workers rollout status "deploy/${deploy}" --timeout=5m
done

log "Workers:"
kubectl -n temporal-workers get pods -o wide
save_output WORKER_IMAGE "${WORKER_IMAGE}"
save_output ACR_NAME "${ACR_NAME}"
log "AKS workers deployed (queues: default, critical-priority, high, low-priority, background-priority)."
log "Temporal address inside cluster: temporal-frontend.temporal.svc.cluster.local:7233"
