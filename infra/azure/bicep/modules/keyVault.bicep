param location string
param namePrefix string
param tags object

// Key Vault names must be globally unique and 3-24 chars.
// Include a short unique suffix so soft-deleted vaults from prior failed deploys do not collide.
var vaultName = take('${take(replace(namePrefix, '-', ''), 12)}${uniqueString(resourceGroup().id)}kv', 24)

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enabledForDeployment: false
    enabledForTemplateDeployment: true
    publicNetworkAccess: 'Enabled'
  }
}

output vaultName string = keyVault.name
output vaultUri string = keyVault.properties.vaultUri
output vaultId string = keyVault.id
