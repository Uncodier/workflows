# Configuración de Agentes

Este directorio contiene la configuración detallada para la creación de agentes durante el proceso de setup de sitios.

## Archivos de Configuración

### `agentsConfig.ts`
Contiene la configuración principal de agentes con:
- **AgentConfig**: Interface para definir un agente completo
- **AgentActivity**: Interface para las actividades de cada agente
- **defaultAgentsConfig**: Configuración por defecto con 7 agentes especializados

#### Agentes Disponibles:
1. **Growth Lead/Manager** (Marketing)
2. **Data Analyst** (Product)  
3. **Growth Marketer** (Marketing)
4. **UX Designer** (Product)
5. **Sales/CRM Specialist** (Sales)
6. **Customer Support** (Sales)
7. **Content Creator & Copywriter** (Marketing)

### `agentRolesConfig.ts`
Proporciona mapeo de roles y responsabilidades:
- **AgentRole**: Interface para definir roles
- **agentRolesConfig**: Mapeo de roles con responsabilidades y habilidades
- Funciones helper para trabajar con roles

## Uso en Workflows

```typescript
import { defaultAgentsConfig, getAgentTypes } from '../config/agentsConfig';

// En el workflow siteSetupWorkflow.ts
const agentsResult = await createAgentsActivity({
  site_id: params.site_id,
  user_id: params.user_id,
  company_name: params.company_name,
  agent_types: getAgentTypes(), // ['marketing', 'product', 'sales']
  custom_config: {
    agents_config: defaultAgentsConfig.agents,
    use_detailed_config: true
  }
});
```

## Estructura de Datos

### Agente Completo
```typescript
{
  id: "1",
  name: "Growth Lead/Manager",
  description: "Strategy integration, team coordination, budget management, KPI tracking",
  type: "marketing",
  status: "active",
  conversations: 425,
  successRate: 92,
  lastActive: "2024-01-30T12:00:00Z",
  icon: "BarChart",
  activities: [
    {
      id: "gl1",
      name: "Task Monitoring",
      description: "Track progress of assigned tasks...",
      estimatedTime: "15-20 min",
      successRate: 95,
      executions: 142,
      status: "available"
    }
    // ... más actividades
  ]
}
```

### API Payload
Cuando `use_detailed_config: true`, la actividad enviará:

```typescript
{
  site_id: "site_123",
  user_id: "user_456", 
  company_name: "Mi Empresa",
  agent_types: ["marketing", "product", "sales"],
  custom_config: {
    use_detailed_config: true,
    detailed_agents: [
      // Array completo de agentes con todas sus propiedades
    ]
  }
}
```

## Tipos de Agentes

- **Marketing**: Growth Lead/Manager, Growth Marketer, Content Creator & Copywriter
- **Product**: Data Analyst, UX Designer  
- **Sales**: Sales/CRM Specialist, Customer Support

## Funciones Helper

```typescript
// Obtener tipos de agentes únicos
getAgentTypes(): string[]

// Obtener agentes por tipo
getAgentsByType(type: string): AgentConfig[]

// Obtener nombres de agentes
getAgentNames(): string[]

// Obtener distribución por tipo
getAgentTypeDistribution(): Record<string, number>

// Validar roles
validateAgentRoles(): { valid: boolean; missingRoles: string[] }
```

## Compatibilidad

La configuración mantiene compatibilidad hacia atrás:
- Si `use_detailed_config` es `false` o no está definido, usa la configuración básica
- Los `agent_types` siguen funcionando como antes
- La API puede manejar ambos formatos 