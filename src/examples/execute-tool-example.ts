/**
 * Ejemplo de uso del ExecuteTool Workflow
 * 
 * Este ejemplo muestra cómo usar el workflow para ejecutar
 * herramientas API de manera distribuida con Temporal.
 */

import { TemporalToolExecutor } from '../temporal/client/temporalToolExecutor';
import type { ExecuteToolInput } from '../temporal/workflows/executeToolWorkflow';

export async function executeWeatherTool() {
  const executor = new TemporalToolExecutor();
  
  const input: ExecuteToolInput = {
    toolName: 'get-weather',
    args: {
      location: 'Madrid',
      units: 'metric'
    },
    apiConfig: {
      endpoint: {
        url: 'https://api.openweathermap.org/data/2.5/weather',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        requiresAuth: true,
        authType: 'ApiKey'
      },
      responseMapping: {
        temperature: 'main.temp',
        description: 'weather[0].description',
        city: 'name',
        humidity: 'main.humidity'
      }
    }
  };
  
  try {
    console.log('🌤️  Ejecutando herramienta del clima...');
    const result = await executor.executeTool(input);
    
    if (result.success) {
      console.log('✅ Resultado exitoso:');
      console.log(`🌡️  Temperatura: ${result.data.temperature}°C`);
      console.log(`☁️  Condición: ${result.data.description}`);
      console.log(`🏙️  Ciudad: ${result.data.city}`);
      console.log(`💧 Humedad: ${result.data.humidity}%`);
    } else {
      console.log('❌ Error en la herramienta:');
      console.log(`   Mensaje: ${result.error}`);
      console.log(`   Código: ${result.statusCode}`);
    }
    
    return result;
  } catch (error: any) {
    console.error('💥 Error ejecutando la herramienta:', error.message);
    throw error;
  }
}

export async function executeLocalApiTool() {
  const executor = new TemporalToolExecutor();
  
  const input: ExecuteToolInput = {
    toolName: 'create-user',
    args: {
      name: 'Juan Pérez',
      email: 'juan@example.com',
      role: 'user'
    },
    apiConfig: {
      endpoint: {
        url: '/api/users',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        requiresAuth: true,
        authType: 'Bearer'
      },
      errors: {
        400: { message: 'error.message', code: 'BAD_REQUEST' },
        409: { message: 'error.details', code: 'CONFLICT' }
      }
    }
  };
  
  try {
    console.log('👤 Creando usuario local...');
    const result = await executor.executeTool(input);
    
    if (result.success) {
      console.log('✅ Usuario creado exitosamente:');
      console.log(`   ID: ${result.data?.id}`);
      console.log(`   URL: ${result.url}`);
    } else {
      console.log('❌ Error creando usuario:');
      console.log(`   Mensaje: ${result.error}`);
      console.log(`   Código: ${result.statusCode}`);
    }
    
    return result;
  } catch (error: any) {
    console.error('💥 Error ejecutando herramienta local:', error.message);
    throw error;
  }
}

// Ejecutar ejemplos si es llamado directamente
if (require.main === module) {
  async function runExamples() {
    console.log('🧪 Ejecutando ejemplos del ExecuteTool Workflow\n');
    
    try {
      await executeWeatherTool();
      console.log('\n' + '='.repeat(50) + '\n');
      await executeLocalApiTool();
      
      console.log('\n🎉 Ejemplos completados exitosamente!');
    } catch (error) {
      console.error('\n💥 Error en los ejemplos:', error);
      process.exit(1);
    }
  }
  
  runExamples();
} 