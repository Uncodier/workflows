param location string
param namePrefix string
param tags object

var vnetName = '${namePrefix}-vnet'
var aksSubnetName = 'snet-aks'
var postgresSubnetName = 'snet-postgres'
var appServiceSubnetName = 'snet-appservice'
var dnsZoneName = 'privatelink.postgres.database.azure.com'

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.40.0.0/16'
      ]
    }
    subnets: [
      {
        name: aksSubnetName
        properties: {
          addressPrefix: '10.40.0.0/20'
        }
      }
      {
        name: postgresSubnetName
        properties: {
          addressPrefix: '10.40.16.0/24'
          delegations: [
            {
              name: 'postgresDelegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: appServiceSubnetName
        properties: {
          addressPrefix: '10.40.17.0/24'
          delegations: [
            {
              name: 'appServiceDelegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
    ]
  }
}

resource postgresDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: dnsZoneName
  location: 'global'
  tags: tags
}

resource dnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: postgresDnsZone
  name: '${namePrefix}-pg-dns-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

output vnetName string = vnet.name
output vnetId string = vnet.id
output aksSubnetId string = '${vnet.id}/subnets/${aksSubnetName}'
output postgresSubnetId string = '${vnet.id}/subnets/${postgresSubnetName}'
output appServiceSubnetId string = '${vnet.id}/subnets/${appServiceSubnetName}'
output postgresDnsZoneId string = postgresDnsZone.id
