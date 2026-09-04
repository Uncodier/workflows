#!/bin/bash
# Emergency local fallback. Daily deploys go through GitHub Actions.
set -euo pipefail

ACR_NAME="uncodietmpacr"
AKS_NAME="uncodie-tmp-aks"
RG_NAME="rg-temporal-prod"
COMMIT_HASH="$(git rev-parse HEAD)"

echo "Starting Azure worker fallback deploy (commit ${COMMIT_HASH})..."

echo "Step 1: Building image in ACR..."
az acr build \
  -r "${ACR_NAME}" \
  -t "temporal-worker:${COMMIT_HASH}" \
  -t "temporal-worker:latest" \
  -f infra/azure/workers/Dockerfile \
  .

echo "Step 2: Getting AKS credentials..."
az aks get-credentials \
  -g "${RG_NAME}" \
  -n "${AKS_NAME}" \
  --overwrite-existing
if command -v kubelogin >/dev/null 2>&1; then
  kubelogin convert-kubeconfig -l azurecli
fi

LOGIN_SERVER="$(az acr show -n "${ACR_NAME}" --query loginServer -o tsv)"
IMAGE="${LOGIN_SERVER}/temporal-worker:${COMMIT_HASH}"
echo "Step 3: Deploying ${IMAGE}"

DEPLOYS=(
  temporal-worker-default
  temporal-worker-critical
  temporal-worker-high
  temporal-worker-low
  temporal-worker-background
  temporal-worker-validation
)

for deploy in "${DEPLOYS[@]}"; do
  kubectl -n temporal-workers get "deploy/${deploy}" >/dev/null
  echo "Setting image for ${deploy}..."
  kubectl -n temporal-workers set image "deploy/${deploy}" "worker=${IMAGE}"
done

echo "Waiting for rollouts..."
pids=()
for deploy in "${DEPLOYS[@]}"; do
  kubectl -n temporal-workers rollout status "deploy/${deploy}" --timeout=5m &
  pids+=("$!")
done

fail=0
for pid in "${pids[@]}"; do
  if ! wait "${pid}"; then
    fail=1
  fi
done
if [ "${fail}" -ne 0 ]; then
  echo "One or more worker rollouts failed"
  kubectl -n temporal-workers get pods -o wide
  exit 1
fi

echo "Deployment completed successfully."
kubectl -n temporal-workers get pods -o wide
