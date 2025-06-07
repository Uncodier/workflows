# Scripts de Borrado en Cascada para Commands

Este directorio contiene scripts para borrar un `command` y todos sus objetos relacionados cuando el CASCADE automático de la base de datos no esté funcionando correctamente.

## Problema

Cuando se borra un `command` de la tabla `commands`, se espera que todos los objetos relacionados (que tienen `command_id` como foreign key) también se borren automáticamente mediante CASCADE. Sin embargo, si esto no está funcionando, estos scripts proporcionan una solución manual.

## Archivos Incluidos

### 1. `delete_command_cascade.sql`
Script SQL que crea funciones en PostgreSQL para borrar commands y objetos relacionados.

### 2. `deleteCommandCascade.ts`
Script en TypeScript que usa Supabase para realizar el borrado desde una aplicación Node.js.

## Uso

### Opción 1: Función SQL (Recomendada)

Primero ejecuta el script SQL para crear las funciones en tu base de datos:

```bash
psql -d tu_database -f scripts/delete_command_cascade.sql
```

Luego usa una de estas funciones:

```sql
-- Función completa que retorna detalles del borrado
SELECT delete_command_cascade('12345678-1234-1234-1234-123456789012');

-- Función simple que retorna TRUE/FALSE
SELECT delete_command_simple('12345678-1234-1234-1234-123456789012');
```

### Opción 2: Script TypeScript

Para usar desde tu aplicación Node.js:

```typescript
import { deleteCommandCascade, CommandCascadeDeleter } from './scripts/deleteCommandCascade';

// Opción 1: Función directa
const result = await deleteCommandCascade(
  'command-id-here',
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

console.log('Resultado:', result);

// Opción 2: Usando la clase
const deleter = new CommandCascadeDeleter(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const success = await deleter.deleteCommandSimple('command-id-here');
console.log('Éxito:', success);

// Opción 3: Ver qué se va a borrar antes de hacerlo
const counts = await deleter.getCommandRelatedCounts('command-id-here');
console.log('Objetos relacionados:', counts);
```

### Opción 3: Desde línea de comandos

Puedes ejecutar el script directamente desde la terminal:

```bash
# Asegúrate de tener las variables de entorno configuradas
export SUPABASE_URL="tu-supabase-url"
export SUPABASE_ANON_KEY="tu-supabase-key"

# Ejecutar el script
npx tsx scripts/deleteCommandCascade.ts "command-id-aqui"
```

## Tablas Afectadas

El script borrará registros de estas tablas que tengan `command_id` referenciando al command:

- `agent_assets`
- `agent_memories`
- `agents`
- `analysis`
- `assets`
- `billing`
- `campaign_requirements`
- `campaign_segments`
- `campaign_subtasks`
- `campaigns`
- `content`
- `conversations`
- `debug_logs`
- `experiment_segments`
- `experiments`
- `external_resources`
- `kpis`
- `leads`
- `messages`
- `notifications`
- `payments`
- `profiles`
- `requirement_segments`
- `requirements`
- `sales`
- `segments`
- `session_events`
- `settings`
- `sites`
- `tasks`
- `transactions`
- `visitor_sessions`
- `visitors`
- `commands` (el registro principal)

## Resultado del Script TypeScript

La función `deleteCommandCascade` retorna un objeto con:

```typescript
{
  success: boolean;           // Si el borrado fue exitoso
  deletedCounts: {           // Cantidad borrada por tabla
    "content": 5,
    "campaigns": 2,
    "commands": 1,
    // ... más tablas
  };
  errors: string[];          // Lista de errores si los hay
  commandId: string;         // ID del command procesado
}
```

## Precauciones

⚠️ **IMPORTANTE**: Estos scripts realizan borrados permanentes. Asegúrate de:

1. **Hacer backup** de tu base de datos antes de usar en producción
2. **Probar primero** en un ambiente de desarrollo
3. **Verificar el command ID** antes de ejecutar
4. **Revisar los conteos** usando `getCommandRelatedCounts()` antes del borrado

## Ejemplo de Uso Seguro

```typescript
// 1. Verificar qué se va a borrar
const deleter = new CommandCascadeDeleter(supabaseUrl, supabaseKey);
const counts = await deleter.getCommandRelatedCounts(commandId);

console.log('Se van a borrar:');
Object.entries(counts).forEach(([table, count]) => {
  if (count > 0) {
    console.log(`  - ${table}: ${count} registros`);
  }
});

// 2. Confirmar con el usuario
const confirm = prompt('¿Continuar con el borrado? (si/no)');
if (confirm === 'si') {
  // 3. Ejecutar el borrado
  const result = await deleter.deleteCommandCascade(commandId);
  
  if (result.success) {
    console.log('✅ Borrado completado');
  } else {
    console.error('❌ Errores en el borrado:', result.errors);
  }
}
```

## Solución a Largo Plazo

Para evitar necesitar estos scripts en el futuro, considera agregar CASCADE a las foreign keys:

```sql
-- Ejemplo de cómo debería ser la foreign key
ALTER TABLE content 
DROP CONSTRAINT IF EXISTS content_command_id_fkey,
ADD CONSTRAINT content_command_id_fkey 
  FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE;
```

Esto haría que el borrado automático funcione correctamente sin necesidad de scripts manuales. 