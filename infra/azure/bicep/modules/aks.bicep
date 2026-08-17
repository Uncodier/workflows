param location string
param namePrefix string
param tags object
param nodeCount int
param nodeVmSize string
param kubernetesVersion string
param vnetSubnetId string
param logAnalyticsWorkspaceId string

var clusterName = '${namePrefix}-aks'
var dnsPrefix = take('${namePrefix}-aks', 40)

resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: clusterName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: union(
    {
    dnsPrefix: dnsPrefix
    agentPoolProfiles: [
      {
        name: 'system'
        count: nodeCount
        vmSize: nodeVmSize
        mode: 'System'
        osType: 'Linux'
        type: 'VirtualMachineScaleSets'
        enableAutoScaling: true
        minCount: max(2, nodeCount - 1)
        maxCount: nodeCount + 2
        vnetSubnetID: vnetSubnetId
        // Availability zones omitted: some subscriptions/regions (e.g. Startup) report no supported zones.
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'azure'
      serviceCidr: '10.50.0.0/16'
      dnsServiceIP: '10.50.0.10'
      loadBalancerSku: 'standard'
    }
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
    }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId
        }
      }
      azureKeyvaultSecretsProvider: {
        enabled: true
        config: {
          enableSecretRotation: 'true'
        }
      }
    }
  },
    empty(kubernetesVersion) ? {} : { kubernetesVersion: kubernetesVersion }
  )
}

output aksName string = aks.name
output aksId string = aks.id
output aksFqdn string = aks.properties.fqdn
output aksPrincipalId string = aks.identity.principalId
