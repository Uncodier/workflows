# Agent Creation with Supabase

Documentación completa sobre la creación de agentes directamente en Supabase usando el `createAgentsActivity`.

## Descripción

El `createAgentsActivity` ha sido actualizado para crear agentes de IA directamente en la base de datos Supabase, eliminando la dependencia de endpoints API externos. Esta implementación es más eficiente, robusta y proporciona control directo sobre los datos.

## Características

### ✅ Implementación Directa
- Conexión directa a Supabase
- Sin dependencias de APIs externas
- Transacciones atómicas para cada agente

### ✅ Configuración Flexible
- **Modo Básico**: Tipos de agentes simples (customer_support, sales, general)
- **Modo Avanzado**: Configuración detallada con agentes predefinidos

### ✅ Datos Completos
- UUID únicos generados automáticamente
- Campos completos según esquema de base de datos
- Metadatos de configuración personalizados

## Estructura de Datos

### Tabla `agents` en Supabase

```sql
CREATE TABLE agents (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  type text NOT NULL,
  status text NOT NULL,
  site_id uuid REFERENCES sites(id),
  user_id uuid REFERENCES users(id),
  conversations integer DEFAULT 0,
  success_rate integer DEFAULT 0,
  role text,
  activities jsonb,
  configuration jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_active timestamp with time zone,
  tools jsonb DEFAULT '[]'::jsonb,
  integrations jsonb DEFAULT '{}'::jsonb,
  backstory text,
  prompt text,
  supervisor uuid REFERENCES agents(id),
  command_id uuid REFERENCES commands(id)
);
```

## Uso

### 1. Configuración Básica

```typescript
const params = {
  site_id: 'uuid-del-sitio',
  user_id: 'uuid-del-usuario',
  company_name: 'Mi Empresa',
  agent_types: ['customer_support', 'sales', 'general']
};

const result = await createAgentsActivity(params);
```

### 2. Configuración Avanzada

```typescript
import { defaultAgentsConfig } from '../config/agentsConfig';

const params = {
  site_id: 'uuid-del-sitio',
  user_id: 'uuid-del-usuario',
  company_name: 'Mi Empresa',
  custom_config: {
    use_detailed_config: true,
    agents_config: defaultAgentsConfig.agents.slice(0, 5) // Primeros 5 agentes
  }
};

const result = await createAgentsActivity(params);
```

### 3. Resultado

```typescript
interface CreateAgentsResult {
  success: boolean;
  agents: Array<{
    agent_id: string;
    type: string;
    name: string;
    status: string;
    description?: string;
    icon?: string;
    activities?: Array<{
      id: string;
      name: string;
      description: string;
      estimatedTime: string;
      successRate: number;
    }>;
  }>;
  total_created: number;
}
```

## Agentes Predefinidos

El sistema incluye 7 agentes predefinidos con actividades específicas:

1. **Growth Lead/Manager** (marketing)
   - Task Monitoring, Stakeholder Coordination, Vendor Management, etc.

2. **Data Analyst** (product)
   - User Behavior Analysis, Sales Trend Analysis, Cohort Health Monitoring, etc.

3. **Growth Marketer** (marketing)
   - Marketing Campaigns, SEO Optimization, A/B Testing, etc.

4. **UX Designer** (product)
   - Website Analysis, Application Analysis, Product Requirements, etc.

5. **Sales/CRM Specialist** (sales)
   - Lead Management, Appointment Generation, Sales Orders, etc.

6. **Customer Support** (sales)
   - Knowledge Base Management, FAQ Development, Escalation Management

7. **Content Creator & Copywriter** (marketing)
   - Content Calendar, Email Sequences, Landing Page Copy, etc.

## Testing

### Ejecutar Tests

```bash
# Test completo de creación de agentes
npm run test:create-agents

# Test desde TypeScript directo
npx ts-node src/scripts/test-create-agents.ts
```

### Test Script

El script de prueba (`test-create-agents.ts`) incluye:
- Test de agentes básicos
- Test de agentes con configuración avanzada
- Validación de datos creados
- Manejo de errores

## Variables de Entorno

Asegúrate de tener configuradas las variables de Supabase:

```env
SUPABASE_URL=tu-url-de-supabase
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
# o
SUPABASE_ANON_KEY=tu-anon-key
```

## Logs y Monitoreo

El activity genera logs detallados:

```
🤖 Creating agents for site: { site_id: '...', user_id: '...', ... }
📋 Using detailed agents configuration...
   • Creating agent: Growth Lead/Manager (marketing)
   ✅ Agent Growth Lead/Manager created with ID: uuid-generado
✅ Successfully created 7 agents with detailed configuration
```

## Manejo de Errores

- **Conexión a Supabase**: Verifica conexión antes de crear agentes
- **Validación de datos**: Campos requeridos validados automáticamente
- **Rollback**: Cada agente se crea independientemente
- **Logging**: Errores detallados con contexto específico

## Migración desde API

La migración desde el endpoint API fue seamless:
- ✅ Misma interfaz de entrada y salida
- ✅ Compatibilidad total con workflows existentes
- ✅ Mejor rendimiento y confiabilidad
- ✅ Sin dependencias externas

## Próximos Pasos

1. **Batch Creation**: Implementar creación en lotes para mejor rendimiento
2. **Agent Validation**: Validaciones avanzadas de configuración
3. **Activity Creation**: Crear actividades específicas para cada agente
4. **Analytics**: Métricas de creación y uso de agentes 