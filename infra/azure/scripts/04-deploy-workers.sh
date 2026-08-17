#!/usr/bin/env bash
# Configure App Service workers (default + critical) and deploy from Git when configured.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_config
load_outputs
ensure_az_login

DEFAULT_APP="${WORKER_DEFAULT_APP_NAME:-$WORKER_DEFAULT_NAME}"
CRITICAL_APP="${WORKER_CRITICAL_APP_NAME:-$WORKER_CRITICAL_NAME}"
TEMPORAL_URL="${TEMPORAL_SERVER_URL:-}"
TEMPORAL_NS="${TEMPORAL_NAMESPACE:-default}"

set_worker_settings() {
  local app="$1"
  local queue="$2"

  log "Configuring app settings for ${app} (queue=${queue})..."
  local settings=(
    "NODE_ENV=production"
    "WORKFLOW_TASK_QUEUE=${queue}"
    "TEMPORAL_NAMESPACE=${TEMPORAL_NS}"
    "TEMPORAL_TLS=${TEMPORAL_TLS:-false}"
    "TEMPORAL_WORKER_USE_VERSIONING=true"
    "TEMPORAL_WORKER_DEPLOYMENT_NAME=workflows_worker"
    "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
  )

  if [[ -n "${TEMPORAL_URL}" ]]; then
    settings+=("TEMPORAL_SERVER_URL=${TEMPORAL_URL}")
  fi
  if [[ -n "${APP_INSIGHTS_CONNECTION_STRING:-}" ]]; then
    settings+=("APPLICATIONINSIGHTS_CONNECTION_STRING=${APP_INSIGHTS_CONNECTION_STRING}")
  fi
  if [[ -n "${SUPABASE_URL:-}" ]]; then
    settings+=("SUPABASE_URL=${SUPABASE_URL}")
  fi
  if [[ -n "${SUPABASE_ANON_KEY:-}" ]]; then
    settings+=("SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}")
  fi
  if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    settings+=("SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}")
  fi

  az webapp config appsettings set \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${app}" \
    --settings "${settings[@]}" \
    --output none

  az webapp config set \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${app}" \
    --always-on true \
    --linux-fx-version "NODE|20-lts" \
      --startup-file "npm run azure:startup:compiled" \
    --output none
}

set_worker_settings "${DEFAULT_APP}" "default"
set_worker_settings "${CRITICAL_APP}" "critical-priority"

deploy_from_git() {
  local app="$1"
  if [[ -z "${GITHUB_REPO_URL:-}" ]]; then
    log "GITHUB_REPO_URL not set — skip source deploy for ${app}. Configure in Azure Portal or re-run with token."
    return 0
  fi

  log "Configuring continuous deployment from Git for ${app}..."
  # Local git deploy via zip is more reliable without interactive OAuth; prefer GitHub Actions.
  # If GITHUB_TOKEN is set, use az webapp deployment source config with git.
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    az webapp deployment source config \
      --resource-group "${RESOURCE_GROUP}" \
      --name "${app}" \
      --repo-url "${GITHUB_REPO_URL}" \
      --branch "${GITHUB_BRANCH:-main}" \
      --git-token "${GITHUB_TOKEN}" \
      --manual-integration \
      --output none || log "Git source config failed for ${app}; use GitHub Actions workflow instead."
  else
    log "No GITHUB_TOKEN — App Service apps are ready; deploy with GitHub Actions (see workers/github-actions-deploy.yml)."
  fi
}

deploy_from_git "${DEFAULT_APP}"
deploy_from_git "${CRITICAL_APP}"

log "Workers configured."
log "  Default:  https://$(az webapp show -g "${RESOURCE_GROUP}" -n "${DEFAULT_APP}" --query defaultHostName -o tsv)"
log "  Critical: https://$(az webapp show -g "${RESOURCE_GROUP}" -n "${CRITICAL_APP}" --query defaultHostName -o tsv)"
log "Build command on Azure (Oryx): npm run build:all"
log "Start command: npm run azure:startup:compiled"
