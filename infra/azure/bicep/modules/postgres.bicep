param location string
param namePrefix string
param tags object
param adminUser string
@secure()
param adminPassword string
param skuName string
param storageGb int
param haEnabled bool
param postgresVersion string
param delegatedSubnetId string
param privateDnsZoneId string

var serverName = take('${namePrefix}-pg', 63)

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: 'GeneralPurpose'
  }
  properties: {
    version: postgresVersion
    administratorLogin: adminUser
    administratorLoginPassword: adminPassword
    storage: {
      storageSizeGB: storageGb
    }
    backup: {
      backupRetentionDays: 14
      geoRedundantBackup: 'Disabled'
    }
    // ZoneRedundant HA needs AZ support; Startup/some regions may not have zones.
    highAvailability: {
      mode: haEnabled ? 'SameZone' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    }
  }
}

resource dbTemporal 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'temporal'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource dbVisibility 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'temporal_visibility'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

output serverName string = postgres.name
output fqdn string = postgres.properties.fullyQualifiedDomainName
output temporalDbName string = dbTemporal.name
output visibilityDbName string = dbVisibility.name
