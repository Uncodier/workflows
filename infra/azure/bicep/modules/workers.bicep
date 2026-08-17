param location string
param namePrefix string
param tags object
param appServiceSku string
param workerDefaultName string
param workerCriticalName string
param vnetSubnetId string
param appInsightsConnectionString string
param appInsightsInstrumentationKey string
param keyVaultUri string

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-asp'
  location: location
  tags: tags
  sku: {
    name: appServiceSku
    tier: startsWith(appServiceSku, 'P') ? 'PremiumV3' : 'Standard'
    capacity: 2
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

var commonAppSettings = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'TEMPORAL_TLS'
    value: 'false'
  }
  {
    name: 'TEMPORAL_NAMESPACE'
    value: 'default'
  }
  {
    name: 'WEBSITE_RUN_FROM_PACKAGE'
    value: '0'
  }
  {
    name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
    value: 'true'
  }
  {
    name: 'POST_BUILD_COMMAND'
    value: 'npm run build:all'
  }
  {
    name: 'WEBSITE_NODE_DEFAULT_VERSION'
    value: '~20'
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsightsConnectionString
  }
  {
    name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
    value: appInsightsInstrumentationKey
  }
  {
    name: 'KEYVAULT_URI'
    value: keyVaultUri
  }
  {
    name: 'TEMPORAL_WORKER_USE_VERSIONING'
    value: 'true'
  }
  {
    name: 'TEMPORAL_WORKER_DEPLOYMENT_NAME'
    value: 'workflows_worker'
  }
]

resource defaultWorker 'Microsoft.Web/sites@2023-12-01' = {
  name: workerDefaultName
  location: location
  tags: union(tags, { taskQueue: 'default' })
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'npm run azure:startup:compiled'
      appSettings: concat(commonAppSettings, [
        {
          name: 'WORKFLOW_TASK_QUEUE'
          value: 'default'
        }
      ])
    }
  }
}

resource criticalWorker 'Microsoft.Web/sites@2023-12-01' = {
  name: workerCriticalName
  location: location
  tags: union(tags, { taskQueue: 'critical-priority' })
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'npm run azure:startup:compiled'
      appSettings: concat(commonAppSettings, [
        {
          name: 'WORKFLOW_TASK_QUEUE'
          value: 'critical-priority'
        }
      ])
    }
  }
}

resource defaultVnetSwift 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: defaultWorker
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: vnetSubnetId
  }
}

resource criticalVnetSwift 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: criticalWorker
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: vnetSubnetId
  }
}

output planName string = plan.name
output defaultAppName string = defaultWorker.name
output criticalAppName string = criticalWorker.name
output defaultHostName string = defaultWorker.properties.defaultHostName
output criticalHostName string = criticalWorker.properties.defaultHostName
