# Templated Helm values for Temporal on AKS (production).
# Rendered by scripts/02-deploy-temporal-helm.sh from config.env.
#
# Placeholders:
#   __POSTGRES_FQDN__
#   __POSTGRES_USER__
#   __TEMPORAL_NAMESPACE__

server:
  replicaCount: 2
  config:
    logLevel: "info"
    persistence:
      defaultStore: default
      visibilityStore: visibility
      # Cannot be changed after initial deploy
      numHistoryShards: 512
      datastores:
        default:
          sql:
            createDatabase: false
            manageSchema: true
            pluginName: postgres12
            driverName: postgres12
            databaseName: temporal
            connectAddr: "__POSTGRES_FQDN__:5432"
            connectProtocol: tcp
            user: "__POSTGRES_USER__"
            existingSecret: temporal-db-secret
            secretKey: password
            maxConns: 20
            maxIdleConns: 20
            maxConnLifetime: "1h"
            tls:
              enabled: true
              enableHostVerification: true
              serverName: "__POSTGRES_FQDN__"
        visibility:
          sql:
            createDatabase: false
            manageSchema: true
            pluginName: postgres12
            driverName: postgres12
            databaseName: temporal_visibility
            connectAddr: "__POSTGRES_FQDN__:5432"
            connectProtocol: tcp
            user: "__POSTGRES_USER__"
            existingSecret: temporal-db-secret
            secretKey: password
            maxConns: 20
            maxIdleConns: 20
            maxConnLifetime: "1h"
            tls:
              enabled: true
              enableHostVerification: true
              serverName: "__POSTGRES_FQDN__"
    metrics:
      prometheus:
        timerType: histogram
        listenAddress: "0.0.0.0:9090"
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: "2"
      memory: 2Gi
  frontend:
    replicaCount: 2
    service:
      # Internal Azure LB so App Service workers reach Temporal over VNet
      type: LoadBalancer
      port: 7233
      annotations:
        service.beta.kubernetes.io/azure-load-balancer-internal: "true"
    metrics:
      annotations:
        enabled: true
  history:
    replicaCount: 2
  matching:
    replicaCount: 2
  worker:
    replicaCount: 2
  namespaces:
    create: true
    namespace:
      - name: __TEMPORAL_NAMESPACE__
        retention: 30d

admintools:
  enabled: true

web:
  enabled: true
  replicaCount: 1
  service:
    type: ClusterIP
    port: 8080
  ingress:
    enabled: false

schema:
  useHelmHooks: true
