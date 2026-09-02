#!/bin/bash
set -e

ACR_NAME="uncodietmpacr"
AKS_NAME="uncodie-tmp-aks"
RG_NAME="rg-temporal-prod"

echo "🚀 Starting Azure deployment for Temporal Workers..."

echo "📦 Step 1: Building image in ACR..."
az acr build \
  -r "${ACR_NAME}" \
  -t "temporal-worker:$(git rev-parse HEAD)" \
  -t "temporal-worker:latest" \
  -f infra/azure/workers/Dockerfile \
  .

echo "🔐 Step 2: Getting AKS credentials..."
az aks get-credentials \
  -g "${RG_NAME}" \
  -n "${AKS_NAME}" \
  --overwrite-existing

echo "🚢 Step 3: Rolling out updates to AKS..."
LOGIN_SERVER="$(az acr show -n "${ACR_NAME}" --query loginServer -o tsv)"
IMAGE="${LOGIN_SERVER}/temporal-worker:$(git rev-parse HEAD)"
echo "Deploying image: ${IMAGE}"

for deploy in temporal-worker-default temporal-worker-critical temporal-worker-high temporal-worker-low temporal-worker-background temporal-worker-validation; do
  echo "Updating ${deploy}..."
  kubectl -n temporal-workers set image "deploy/${deploy}" "worker=${IMAGE}"
  kubectl -n temporal-workers rollout status "deploy/${deploy}" --timeout=5m
done

echo "✅ Deployment completed successfully!"
