@description('Optional Azure Monitor metric alerts for Temporal workers. Deploy after App Insights exists.')
param location string = resourceGroup().location
param namePrefix string
param appInsightsId string
param workerDefaultAppId string
param workerCriticalAppId string
param actionGroupId string = ''

resource workerDefaultDown 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-alert-worker-default-http'
  location: 'global'
  properties: {
    description: 'Default worker App Service availability drop'
    severity: 2
    enabled: true
    scopes: [
      workerDefaultAppId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xx'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: empty(actionGroupId)
      ? []
      : [
          {
            actionGroupId: actionGroupId
          }
        ]
  }
}

resource workerCriticalDown 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-alert-worker-critical-http'
  location: 'global'
  properties: {
    description: 'Critical worker App Service availability drop'
    severity: 1
    enabled: true
    scopes: [
      workerCriticalAppId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xx'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: empty(actionGroupId)
      ? []
      : [
          {
            actionGroupId: actionGroupId
          }
        ]
  }
}

output defaultAlertId string = workerDefaultDown.id
output criticalAlertId string = workerCriticalDown.id
output appInsightsIdPassthrough string = appInsightsId
output locationPassthrough string = location
