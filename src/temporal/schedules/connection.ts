import { temporalConfig } from '../../config/config';

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function createTemporalConnection() {
  const { Connection } = require('@temporalio/client');
  const connectionOptions: any = {
    address: temporalConfig.serverUrl,
    connectTimeout: '10s',
    rpcTimeout: '30s',
  };

  if (temporalConfig.tls) {
    connectionOptions.tls = {
      handshakeTimeout: '10s',
    };
  }

  if (temporalConfig.apiKey) {
    connectionOptions.metadata = {
      'temporal-namespace': temporalConfig.namespace,
    };
    connectionOptions.apiKey = temporalConfig.apiKey;
  }

  return withTimeout(
    Connection.connect(connectionOptions),
    15000,
    'Temporal connection'
  );
}
