/**
 * Script para borrar command y todos sus objetos relacionados
 * Usar cuando CASCADE no esté funcionando correctamente en la base de datos
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface DeleteCommandResult {
  success: boolean;
  deletedCounts: Record<string, number>;
  errors: string[];
  commandId: string;
}

interface DeletedCounts {
  [tableName: string]: number;
}

/**
 * Tablas que tienen foreign key hacia commands.id
 */
const RELATED_TABLES = [
  'agent_assets',
  'agent_memories', 
  'agents',
  'analysis',
  'assets',
  'billing',
  'campaign_requirements',
  'campaign_segments',
  'campaign_subtasks',
  'campaigns',
  'content',
  'conversations',
  'debug_logs',
  'experiment_segments',
  'experiments',
  'external_resources',
  'kpis',
  'leads',
  'messages',
  'notifications',
  'payments',
  'profiles',
  'requirement_segments',
  'requirements',
  'sales',
  'segments',
  'session_events',
  'settings',
  'sites',
  'tasks',
  'transactions',
  'visitor_sessions',
  'visitors'
];

/**
 * Clase para manejar el borrado en cascada de commands
 */
export class CommandCascadeDeleter {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Borra un command y todos sus objetos relacionados
   */
  async deleteCommandCascade(commandId: string): Promise<DeleteCommandResult> {
    const deletedCounts: DeletedCounts = {};
    const errors: string[] = [];

    console.log(`🗑️  Iniciando borrado en cascada para command: ${commandId}`);

    try {
      // Primero verificar que el command existe
      const { data: command, error: commandError } = await this.supabase
        .from('commands')
        .select('id, task')
        .eq('id', commandId)
        .single();

      if (commandError || !command) {
        console.error(`❌ Command no encontrado: ${commandId}`);
        return {
          success: false,
          deletedCounts: {},
          errors: [`Command no encontrado: ${commandId}`],
          commandId
        };
      }

      console.log(`✅ Command encontrado: ${command.task || 'Sin título'}`);

      // Borrar de todas las tablas relacionadas
      for (const tableName of RELATED_TABLES) {
        try {
          console.log(`🔄 Borrando de tabla: ${tableName}`);
          
          const { data, error } = await this.supabase
            .from(tableName)
            .delete()
            .eq('command_id', commandId)
            .select('id');

          if (error) {
            console.warn(`⚠️  Error al borrar de ${tableName}:`, error.message);
            errors.push(`Error en ${tableName}: ${error.message}`);
            deletedCounts[tableName] = 0;
          } else {
            const count = data?.length || 0;
            deletedCounts[tableName] = count;
            if (count > 0) {
              console.log(`✅ Borrados ${count} registros de ${tableName}`);
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️  Error inesperado en ${tableName}:`, errorMessage);
          errors.push(`Error inesperado en ${tableName}: ${errorMessage}`);
          deletedCounts[tableName] = 0;
        }
      }

      // Finalmente borrar el command
      console.log(`🔄 Borrando command principal...`);
      const { data: deletedCommand, error: deleteError } = await this.supabase
        .from('commands')
        .delete()
        .eq('id', commandId)
        .select('id');

      if (deleteError) {
        console.error(`❌ Error al borrar command principal:`, deleteError.message);
        errors.push(`Error al borrar command: ${deleteError.message}`);
        deletedCounts['commands'] = 0;
      } else {
        const count = deletedCommand?.length || 0;
        deletedCounts['commands'] = count;
        console.log(`✅ Command principal borrado: ${count} registro(s)`);
      }

      // Calcular totales
      const totalDeleted = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0);
      const hasErrors = errors.length > 0;

      console.log(`🎯 Resumen del borrado:`);
      console.log(`   - Total registros borrados: ${totalDeleted}`);
      console.log(`   - Tablas afectadas: ${Object.keys(deletedCounts).filter(k => deletedCounts[k] > 0).length}`);
      console.log(`   - Errores: ${errors.length}`);

      if (hasErrors) {
        console.warn(`⚠️  Borrado completado con errores`);
      } else {
        console.log(`✅ Borrado completado exitosamente`);
      }

      return {
        success: !hasErrors,
        deletedCounts,
        errors,
        commandId
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error general en borrado en cascada:`, errorMessage);
      
      return {
        success: false,
        deletedCounts,
        errors: [`Error general: ${errorMessage}`],
        commandId
      };
    }
  }

  /**
   * Versión simplificada que solo retorna éxito/fallo
   */
  async deleteCommandSimple(commandId: string): Promise<boolean> {
    const result = await this.deleteCommandCascade(commandId);
    return result.success;
  }

  /**
   * Obtiene un resumen de objetos relacionados antes del borrado
   */
  async getCommandRelatedCounts(commandId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (const tableName of RELATED_TABLES) {
      try {
        const { count, error } = await this.supabase
          .from(tableName)
          .select('id', { count: 'exact', head: true })
          .eq('command_id', commandId);

        if (!error) {
          counts[tableName] = count || 0;
        }
      } catch {
        counts[tableName] = 0;
      }
    }

    return counts;
  }
}

/**
 * Función de utilidad para usar directamente
 */
export async function deleteCommandCascade(
  commandId: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<DeleteCommandResult> {
  const deleter = new CommandCascadeDeleter(supabaseUrl, supabaseKey);
  return deleter.deleteCommandCascade(commandId);
}

/**
 * Función simplificada para usar directamente
 */
export async function deleteCommandSimple(
  commandId: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<boolean> {
  const deleter = new CommandCascadeDeleter(supabaseUrl, supabaseKey);
  return deleter.deleteCommandSimple(commandId);
}

// Ejemplo de uso si se ejecuta directamente
if (require.main === module) {
  const commandId = process.argv[2];
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!commandId) {
    console.error('❌ Uso: npm run delete-command <command-id>');
    process.exit(1);
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY requeridas');
    process.exit(1);
  }

  (async () => {
    try {
      console.log(`🚀 Iniciando borrado de command: ${commandId}`);
      const result = await deleteCommandCascade(commandId, supabaseUrl, supabaseKey);
      
      if (result.success) {
        console.log('✅ Borrado completado exitosamente');
        process.exit(0);
      } else {
        console.error('❌ Borrado falló:', result.errors);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error inesperado:', error);
      process.exit(1);
    }
  })();
} 