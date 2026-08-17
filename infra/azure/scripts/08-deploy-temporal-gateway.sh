#!/usr/bin/env bash
# Public Envoy gRPC gateway: TLS + Bearer API key in front of Temporal frontend.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
load_outputs
ensure_az_login
require_cmd kubectl
require_cmd helm
require_cmd openssl

: "${AKS_NAME:?Run infra provision first}"
: "${RESOURCE_GROUP:?}"

TEMPORAL_K8S_NAMESPACE="${TEMPORAL_K8S_NAMESPACE:-temporal}"
TEMPORAL_HELM_RELEASE="${TEMPORAL_HELM_RELEASE:-temporal}"
GATEWAY_HOSTNAME="${TEMPORAL_GATEWAY_HOSTNAME:-temporal.cloud.makinari.com}"
ACME_EMAIL="${TEMPORAL_GATEWAY_ACME_EMAIL:-ops@makinari.com}"
FRONTEND_HOST="${TEMPORAL_HELM_RELEASE}-frontend.${TEMPORAL_K8S_NAMESPACE}.svc.cluster.local"
CERT_WAIT_SECONDS="${TEMPORAL_GATEWAY_CERT_WAIT_SECONDS:-600}"

az aks get-credentials -g "${RESOURCE_GROUP}" -n "${AKS_NAME}" --overwrite-existing

if [[ -z "${TEMPORAL_GATEWAY_API_KEY:-}" ]]; then
  TEMPORAL_GATEWAY_API_KEY="$(openssl rand -hex 32)"
  log "Generated TEMPORAL_GATEWAY_API_KEY (stored in .deploy-outputs.env)"
fi
save_output TEMPORAL_GATEWAY_API_KEY "${TEMPORAL_GATEWAY_API_KEY}"
save_output TEMPORAL_GATEWAY_HOSTNAME "${GATEWAY_HOSTNAME}"

if [[ -f "${CONFIG_FILE}" ]] && ! grep -q '^TEMPORAL_GATEWAY_API_KEY=' "${CONFIG_FILE}"; then
  echo "TEMPORAL_GATEWAY_API_KEY=${TEMPORAL_GATEWAY_API_KEY}" >>"${CONFIG_FILE}"
fi

log "Ensuring cert-manager..."
if ! helm status cert-manager -n cert-manager >/dev/null 2>&1; then
  helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
  helm repo update jetstack >/dev/null
  helm upgrade --install cert-manager jetstack/cert-manager \
    --namespace cert-manager \
    --create-namespace \
    --set crds.enabled=true \
    --wait --timeout 5m
else
  log "cert-manager already installed"
fi

log "Ensuring ingress-nginx (public LB on :80 + :7233)..."
if ! helm status ingress-nginx -n ingress-nginx >/dev/null 2>&1; then
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
  helm repo update ingress-nginx >/dev/null
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --create-namespace \
    -f "${AZURE_DIR}/gateway/ingress-nginx-values.yaml" \
    --wait --timeout 8m
else
  log "ingress-nginx already installed"
fi

if ! kubectl -n "${TEMPORAL_K8S_NAMESPACE}" get secret temporal-gateway-tls >/dev/null 2>&1; then
  log "Creating bootstrap self-signed TLS secret for ${GATEWAY_HOSTNAME}..."
  TMPTLS="$(mktemp -d)"
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 \
    -subj "/CN=${GATEWAY_HOSTNAME}" \
    -addext "subjectAltName=DNS:${GATEWAY_HOSTNAME}" \
    -keyout "${TMPTLS}/tls.key" \
    -out "${TMPTLS}/tls.crt" >/dev/null 2>&1
  kubectl -n "${TEMPORAL_K8S_NAMESPACE}" create secret tls temporal-gateway-tls \
    --cert="${TMPTLS}/tls.crt" \
    --key="${TMPTLS}/tls.key"
  rm -rf "${TMPTLS}"
fi

log "Rendering Envoy config secret..."
ENVOY_RENDER="$(mktemp)"
sed \
  -e "s|__GATEWAY_API_KEY__|${TEMPORAL_GATEWAY_API_KEY}|g" \
  -e "s|__TEMPORAL_FRONTEND_HOST__|${FRONTEND_HOST}|g" \
  "${AZURE_DIR}/gateway/envoy.yaml.tpl" >"${ENVOY_RENDER}"
kubectl -n "${TEMPORAL_K8S_NAMESPACE}" create secret generic temporal-gateway-envoy \
  --from-file=envoy.yaml="${ENVOY_RENDER}" \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f "${ENVOY_RENDER}"

log "Applying gateway Deployment / Service / NetworkPolicy..."
kubectl apply -f "${AZURE_DIR}/gateway/k8s-gateway.yaml"
kubectl -n "${TEMPORAL_K8S_NAMESPACE}" rollout restart deploy/temporal-grpc-gateway
kubectl -n "${TEMPORAL_K8S_NAMESPACE}" rollout status deploy/temporal-grpc-gateway --timeout=3m

log "Waiting for public LoadBalancer IP..."
PUBLIC_IP=""
for _ in $(seq 1 60); do
  PUBLIC_IP="$(kubectl -n ingress-nginx get svc ingress-nginx-controller \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  [[ -n "${PUBLIC_IP}" ]] && break
  sleep 5
done
[[ -n "${PUBLIC_IP}" ]] || die "ingress-nginx never received a public IP"
save_output TEMPORAL_GATEWAY_PUBLIC_IP "${PUBLIC_IP}"
save_output TEMPORAL_GATEWAY_URL "${GATEWAY_HOSTNAME}:7233"
log "Public IP: ${PUBLIC_IP}"
log "DNS: ${GATEWAY_HOSTNAME} -> ${PUBLIC_IP} (A record)"

CERT_RENDER="$(mktemp)"
sed \
  -e "s|__ACME_EMAIL__|${ACME_EMAIL}|g" \
  -e "s|__GATEWAY_HOSTNAME__|${GATEWAY_HOSTNAME}|g" \
  "${AZURE_DIR}/gateway/cert.yaml.tpl" >"${CERT_RENDER}"
kubectl apply -f "${CERT_RENDER}"
rm -f "${CERT_RENDER}"

log "Waiting up to ${CERT_WAIT_SECONDS}s for Let's Encrypt cert (DNS must already point here)..."
CERT_READY=false
WAITED=0
while [[ "${WAITED}" -lt "${CERT_WAIT_SECONDS}" ]]; do
  READY="$(kubectl -n "${TEMPORAL_K8S_NAMESPACE}" get certificate temporal-gateway-tls \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "${READY}" == "True" ]]; then
    CERT_READY=true
    break
  fi
  sleep 15
  WAITED=$((WAITED + 15))
done

if [[ "${CERT_READY}" == "true" ]]; then
  log "Certificate Ready. Restarting gateway to pick up Let's Encrypt cert..."
  kubectl -n "${TEMPORAL_K8S_NAMESPACE}" rollout restart deploy/temporal-grpc-gateway
  kubectl -n "${TEMPORAL_K8S_NAMESPACE}" rollout status deploy/temporal-grpc-gateway --timeout=3m
else
  log "Certificate not Ready yet. Point DNS then re-run this script."
  kubectl -n "${TEMPORAL_K8S_NAMESPACE}" describe certificate temporal-gateway-tls | tail -40 || true
fi

echo
echo "=== Temporal gRPC gateway ==="
echo "Hostname: ${GATEWAY_HOSTNAME}"
echo "Public IP: ${PUBLIC_IP}"
echo "Listen: ${GATEWAY_HOSTNAME}:7233 (TLS + Bearer)"
echo
echo "DNS: create A record ${GATEWAY_HOSTNAME} -> ${PUBLIC_IP}"
echo
echo "Vercel (API production) env:"
echo "  TEMPORAL_SERVER_URL=${GATEWAY_HOSTNAME}:7233"
echo "  TEMPORAL_NAMESPACE=${TEMPORAL_NAMESPACE:-default}"
echo "  TEMPORAL_SERVICE_API_KEY=<value in infra/azure/.deploy-outputs.env>"
echo "  TEMPORAL_CLOUD_API_KEY=<same value>"
echo
echo "Workers stay on temporal-frontend.${TEMPORAL_K8S_NAMESPACE}.svc.cluster.local:7233 (no gateway)."
