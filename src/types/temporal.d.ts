import { ScheduleClient } from '@temporalio/client';

/**
 * Nota: Este archivo contiene definiciones de tipos para complementar las definiciones de la biblioteca Temporal.
 * 
 * Aunque estos métodos existen en la API de Temporal (delete, describe, update), pueden no estar correctamente 
 * tipados en la versión actual de la biblioteca @temporalio/client.
 * 
 * Como alternativa a estas definiciones de tipos, también estamos usando "as any" en los archivos donde
 * se utilizan estos métodos.
 * 
 * En una versión futura de Temporal, estos métodos podrían estar completamente tipados y estas definiciones 
 * o aserciones de tipo podrían eliminarse.
 */
declare module '@temporalio/client' {
  interface ScheduleClient {
    delete(scheduleId: string): Promise<void>;
    describe(scheduleId: string): Promise<any>;
    update(scheduleId: string, options: any): Promise<void>;
  }
} 