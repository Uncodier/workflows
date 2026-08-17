param location string
param namePrefix string
param tags object
param enableManagedGrafana bool
param enableManagedPrometheus bool
param logAnalyticsWorkspaceId string
param aksClusterId string

// DCR association to AKS is applied by scripts/03-setup-observability.sh
// after the cluster exists (Bicep scope on external IDs is brittle across modules).

resource monitorWorkspace 'Microsoft.Monitor/accounts@2023-04-03' = if (enableManagedPrometheus) {
  name: take('${namePrefix}-amw', 63)
  location: location
  tags: tags
}

resource dataCollectionEndpoint 'Microsoft.Insights/dataCollectionEndpoints@2022-06-01' = if (enableManagedPrometheus) {
  name: '${namePrefix}-dce'
  location: location
  tags: tags
  properties: {
    networkAcls: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource dataCollectionRule 'Microsoft.Insights/dataCollectionRules@2022-06-01' = if (enableManagedPrometheus) {
  name: '${namePrefix}-dcr-prometheus'
  location: location
  tags: tags
  properties: {
    dataCollectionEndpointId: dataCollectionEndpoint.id
    dataSources: {
      prometheusForwarder: [
        {
          name: 'PrometheusDataSource'
          streams: [
            'Microsoft-PrometheusMetrics'
          ]
        }
      ]
    }
    destinations: {
      monitoringAccounts: [
        {
          accountResourceId: monitorWorkspace.id
          name: 'MonitoringAccount'
        }
      ]
    }
    dataFlows: [
      {
        streams: [
          'Microsoft-PrometheusMetrics'
        ]
        destinations: [
          'MonitoringAccount'
        ]
      }
    ]
  }
}

resource grafana 'Microsoft.Dashboard/grafana@2023-09-01' = if (enableManagedGrafana) {
  name: take('${namePrefix}-grafana', 23)
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    apiKey: 'Enabled'
    publicNetworkAccess: 'Enabled'
    grafanaMajorVersion: '12'
    zoneRedundancy: 'Disabled'
  }
}

output monitorWorkspaceId string = enableManagedPrometheus ? monitorWorkspace!.id : ''
output dataCollectionRuleId string = enableManagedPrometheus ? dataCollectionRule!.id : ''
output grafanaName string = enableManagedGrafana ? grafana!.name : ''
output grafanaEndpoint string = enableManagedGrafana ? grafana!.properties.endpoint : ''
output logAnalyticsWorkspaceId string = logAnalyticsWorkspaceId
output aksClusterIdForAssociation string = aksClusterId
