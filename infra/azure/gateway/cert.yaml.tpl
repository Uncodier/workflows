apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    email: __ACME_EMAIL__
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod-account
    solvers:
      - http01:
          ingress:
            class: nginx
            ingressTemplate:
              metadata:
                annotations:
                  nginx.ingress.kubernetes.io/ssl-redirect: "false"
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: temporal-gateway-tls
  namespace: temporal
spec:
  secretName: temporal-gateway-tls
  duration: 2160h
  renewBefore: 360h
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - __GATEWAY_HOSTNAME__
