# Temporal on Azure (AKS Server + App Service Workers)

Production-oriented self-hosted Temporal:

- **Temporal Server** on **AKS** (official Helm chart) + **Azure Database for PostgreSQL** (dual DB: `temporal` + `temporal_visibility`)
- **Workers** (`default` + `critical-priority`) on **Azure App Service** deployed **from Git** (same start command as Render)
- **Observability** via Microsoft stack: Azure Monitor, Managed Prometheus, Managed Grafana, Log Analytics, Application Insights
- **Search attributes** bootstrap script (same list as Cloud)

Estimated cost (Tier B): ~$1,200–2,200 USD/month. See [docs/azure/DEPLOYMENT.md](../../docs/azure/DEPLOYMENT.md).

## Quick start

```bash
# 1) Tools: az, helm, kubectl, jq
# 2) Login
az login
az account set --subscription "<subscription-id>"

# 3) Config
cd infra/azure
cp config.env.example config.env
# edit config.env (passwords, names, GitHub repo, Supabase secrets)

# 4) Full deploy
chmod +x scripts/*.sh
./scripts/deploy-all.sh
```

Or run steps individually:

| Script | Purpose |
|--------|---------|
| `00-prereqs.sh` | Login + provider registration |
| `01-provision-infra.sh` | Bicep: VNet, AKS, Postgres, Key Vault, App Services, Monitor |
| `02-deploy-temporal-helm.sh` | Helm Temporal + DB secret |
| `03-setup-observability.sh` | Managed Prometheus / Grafana wiring |
| `04-deploy-workers.sh` | App settings + optional Git source |
| `05-wire-network.sh` | Internal LB IP → `TEMPORAL_SERVER_URL` on workers |
| `06-register-search-attributes.sh` | Custom Keyword attrs |
| `07-deploy-workers-aks.sh` | ACR image + AKS worker Deployments |
| `08-deploy-temporal-gateway.sh` | Public Envoy gRPC gateway (TLS + Bearer) |

## Layout

```
infra/azure/
  bicep/                 # Azure resources
  helm/                  # Temporal values template
  observability/         # ama-metrics scrape config
  workers/               # Worker inventory (queues)
  gateway/               # Envoy gRPC gateway (TLS + API key)
  scripts/               # Deploy orchestration
  config.env.example
```

## Workers

Same commands as [render.yaml](../../render.yaml):

- Build: `npm run build:all`
- Start: `npm run azure:startup:compiled` (health HTTP + same worker bootstrap as Render)
- Queues: `default` and `critical-priority`

CI: [.github/workflows/azure-workers-deploy.yml](../../.github/workflows/azure-workers-deploy.yml)
