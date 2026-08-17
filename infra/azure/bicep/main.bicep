@description('Azure region')
param location string = resourceGroup().location

@description('Short name prefix for resources')
@minLength(3)
@maxLength(20)
param namePrefix string

@description('Environment tag')
param environment string = 'prod'

@description('AKS node count')
param aksNodeCount int = 3

@description('AKS node VM size')
param aksNodeVmSize string = 'Standard_D4s_v5'

@description('Optional AKS Kubernetes version (empty = default)')
param aksKubernetesVersion string = ''

@description('PostgreSQL admin username')
param postgresAdminUser string

@secure()
@description('PostgreSQL admin password')
param postgresAdminPassword string

@description('PostgreSQL compute SKU')
param postgresSku string = 'Standard_D2s_v3'

@description('PostgreSQL storage size in GB')
param postgresStorageGb int = 128

@description('Enable zone-redundant HA for PostgreSQL')
param postgresHaEnabled bool = true

@description('PostgreSQL major version')
param postgresVersion string = '16'

@description('App Service plan SKU')
param appServiceSku string = 'P1v3'

@description('Default worker app name')
param workerDefaultName string

@description('Critical worker app name')
param workerCriticalName string

@description('Create Azure Managed Grafana')
param enableManagedGrafana bool = true

@description('Create Azure Monitor Workspace (Managed Prometheus)')
param enableManagedPrometheus bool = true

var tags = {
  environment: environment
  application: 'temporal'
  managedBy: 'bicep'
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
  }
}

module logAnalytics 'modules/logAnalytics.bicep' = {
  name: 'logAnalytics'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
  }
}

module keyVault 'modules/keyVault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
    adminUser: postgresAdminUser
    adminPassword: postgresAdminPassword
    skuName: postgresSku
    storageGb: postgresStorageGb
    haEnabled: postgresHaEnabled
    postgresVersion: postgresVersion
    delegatedSubnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: network.outputs.postgresDnsZoneId
  }
}

module aks 'modules/aks.bicep' = {
  name: 'aks'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
    nodeCount: aksNodeCount
    nodeVmSize: aksNodeVmSize
    kubernetesVersion: aksKubernetesVersion
    vnetSubnetId: network.outputs.aksSubnetId
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
  }
}

module appInsights 'modules/appInsights.bicep' = {
  name: 'appInsights'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
  }
}

module workers 'modules/workers.bicep' = {
  name: 'workers'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
    appServiceSku: appServiceSku
    workerDefaultName: workerDefaultName
    workerCriticalName: workerCriticalName
    vnetSubnetId: network.outputs.appServiceSubnetId
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    keyVaultUri: keyVault.outputs.vaultUri
  }
}

module observability 'modules/observability.bicep' = if (enableManagedGrafana || enableManagedPrometheus) {
  name: 'observability'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
    enableManagedGrafana: enableManagedGrafana
    enableManagedPrometheus: enableManagedPrometheus
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    aksClusterId: aks.outputs.aksId
  }
}

output aksName string = aks.outputs.aksName
output aksId string = aks.outputs.aksId
output postgresFqdn string = postgres.outputs.fqdn
output postgresServerName string = postgres.outputs.serverName
output keyVaultName string = keyVault.outputs.vaultName
output keyVaultUri string = keyVault.outputs.vaultUri
output logAnalyticsWorkspaceId string = logAnalytics.outputs.workspaceId
output appInsightsConnectionString string = appInsights.outputs.connectionString
output workerDefaultAppName string = workers.outputs.defaultAppName
output workerCriticalAppName string = workers.outputs.criticalAppName
output workerDefaultHostName string = workers.outputs.defaultHostName
output workerCriticalHostName string = workers.outputs.criticalHostName
output vnetName string = network.outputs.vnetName
output aksSubnetId string = network.outputs.aksSubnetId
output appServiceSubnetId string = network.outputs.appServiceSubnetId
