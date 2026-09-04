# Deploy Temporal to Azure (AKS Workers)

This guide implements the production plan: Temporal Server and Workers on AKS, Microsoft observability, and search-attribute bootstrap.

## Prerequisites

1. Azure subscription with Owner or Contributor (+ role assignment rights for Key Vault RBAC).
2. Local tools: `az`, `helm`, `kubectl`, `jq`.
3. Interactive login:

```bash
az login
az account set --subscription "<subscription-id-or-name>"
az account show
```

## Configuration

```bash
cd infra/azure
cp config.env.example config.env
```

Set at least:

- `AZURE_SUBSCRIPTION_ID`, `AZURE_LOCATION`, `RESOURCE_GROUP`, `NAME_PREFIX`
- `POSTGRES_ADMIN_PASSWORD` (strong secret)
- `WORKER_DEFAULT_NAME`, `WORKER_CRITICAL_NAME` (globally unique App Service names)
- Supabase / app secrets used by workers today on Render
- Optional: `GITHUB_REPO_URL`, `GITHUB_TOKEN` (legacy App Service deployment only)
- Optional: `TEMPORAL_GATEWAY_HOSTNAME` (must include `temporal.cloud`), `TEMPORAL_GATEWAY_API_KEY`

Do **not** commit `config.env` or `.deploy-outputs.env`.

## Deploy

```bash
chmod +x infra/azure/scripts/*.sh
./infra/azure/scripts/deploy-all.sh
```

### What gets created

| Resource | Purpose |
|----------|---------|
| VNet + subnets | AKS, Postgres delegated subnet, App Service integration |
| AKS (3 nodes, HA zones) | Temporal Server pods |
| PostgreSQL Flexible (HA optional) | DBs `temporal` + `temporal_visibility` |
| Key Vault | Stores Postgres password |
| Log Analytics + App Insights | Logs / worker telemetry |
| Monitor Workspace + Managed Grafana | Metrics / dashboards |
| 2× App Service (Always On) | Workers for `default` and `critical-priority` (Legacy) |
| Internal Load Balancer | Temporal frontend reachable on VNet (`*:7233`) |

### After deploy

1. Confirm Temporal pods: `kubectl -n temporal get pods`
2. Port-forward UI: `kubectl -n temporal port-forward svc/temporal-web 8080:8080`
3. Confirm workers have `TEMPORAL_SERVER_URL=<internal-ip>:7233`
4. Confirm search attributes exist (script `06` or UI query `site_id = "test"`)
5. Push to `main` to deploy AKS workers via GitHub Actions.

### CI/CD for Workers (GitHub Actions)

Worker deployments run automatically on pushes to `main`. The workflow uses `docker buildx` with cache and updates the AKS deployments in parallel. 

**Setup required in GitHub Repository Settings → Secrets and Variables → Actions**:

*   `AZURE_CREDENTIALS`: A JSON string representing a Service Principal.

The Service Principal needs the following roles in Azure:
1.  **AcrPush** on the `uncodietmpacr` Azure Container Registry (ACR).
2.  **Azure Kubernetes Service Cluster User Role** on the `uncodie-tmp-aks` cluster.
3.  **RBAC permissions** to update deployments in the `temporal-workers` namespace.

If `AZURE_CREDENTIALS` is missing, the workflow will fail immediately at the Azure Login step.

## Search attributes

Registered by `06-register-search-attributes.sh` (all `Keyword`):

`site_id`, `user_id`, `lead_id`, `segment_id`, `campaign_id`, `person_id`, `icp_mining_id`, `command_id`, `conversation_id`, `instance_id`, `workflow_category`

Same list as [SEARCH_ATTRIBUTES_SETUP.md](../SEARCH_ATTRIBUTES_SETUP.md). **Must exist before workflows call `upsertSearchAttributes`.**

## Networking model

```
  Internal LB IP:7233  -->  temporal-frontend (AKS)
        |
        v
  Azure PostgreSQL (private VNet)
```

- `TEMPORAL_TLS=false` for internal LB (add mTLS later if required).
- Temporal Web UI stays ClusterIP (private); do not expose publicly without auth.

## Observability (Microsoft)

- Container Insights on AKS
- Azure Monitor managed Prometheus (scrape Temporal `prometheus.io/*` annotations)
- Azure Managed Grafana
- Application Insights on worker App Services (if still used)
- Log Analytics workspace

Custom scrape helper: `infra/azure/observability/ama-metrics-temporal-config.yaml`

## Cost (order of magnitude)

Plan Tier B (recommended): **~$1,200–2,200 USD/month** (East US PAYG).

Validate with [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/).

## Public gRPC gateway (Vercel / API)

The Temporal frontend stays on an **internal** LoadBalancer. Vercel has no static IPs, so a public **Envoy gateway** terminates TLS and requires `Authorization: Bearer <key>` — the same metadata the API already sends for Temporal Cloud.

Hostname is **`temporal.cloud.makinari.com`** so `serverUrl.includes('temporal.cloud')` in the API client stays on the Cloud auth path. **Do not change market-fit or API code.**

```
market-fit  --HTTP-->  API (Vercel)
                         |
                         | gRPC TLS + Bearer
                         v
              Envoy gateway :7233 (public)
                         |
                         | gRPC, no auth
                         v
              temporal-frontend (ClusterIP / internal LB)
                         ^
                         | poll (no gateway)
              AKS workers
```

```bash
./infra/azure/scripts/08-deploy-temporal-gateway.sh
```

Then:

1. Create DNS **A** record `temporal.cloud.makinari.com` → public IP printed by the script (also in `.deploy-outputs.env` as `TEMPORAL_GATEWAY_PUBLIC_IP`).
2. Re-run the script if the Let's Encrypt certificate was not Ready yet.
3. In **API** Vercel production env:

```
TEMPORAL_SERVER_URL=temporal.cloud.makinari.com:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_SERVICE_API_KEY=<TEMPORAL_GATEWAY_API_KEY>
TEMPORAL_CLOUD_API_KEY=<same gateway key>
```

Workers keep `TEMPORAL_SERVER_URL=temporal-frontend.temporal.svc.cluster.local:7233` with `TEMPORAL_TLS=false` and no API key.

Without a valid Bearer token the gateway returns gRPC `UNAUTHENTICATED` (16). Temporal Web UI is not exposed on this path.

## Migrating off Temporal Cloud

This stack does **not** import Cloud history. Use drain / dual-client / schedule cutover. Export closed histories from Cloud separately if needed for audit.

## Troubleshooting

| Issue | Check |
|-------|--------|
| Helm schema job fails | Postgres firewall/VNet, password secret, DB names |
| Workers cannot connect | Run `05-wire-network.sh`; verify VNet integration; `nc -vz <ip> 7233` |
| Search attr errors | Re-run `06-register-search-attributes.sh` |
| App Service build fails | App Services are legacy; use AKS workers via GitHub Actions |
| No LB IP | `kubectl -n temporal describe svc temporal-frontend` |
| Gateway 401 / UNAUTHENTICATED | Bearer in Vercel must match `TEMPORAL_GATEWAY_API_KEY` |
| Let's Encrypt not Ready | DNS A record must point at `TEMPORAL_GATEWAY_PUBLIC_IP`; re-run `08` |
| API still hits Temporal Cloud | Confirm `TEMPORAL_SERVER_URL` contains `temporal.cloud` and port `7233` |
