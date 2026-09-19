import { sanitizeExecuteToolInput } from '../src/temporal/workflows/executeToolWorkflow';
import { redactSensitiveHeaders } from '../src/temporal/services/headerSecurity';
import { ApiService } from '../src/temporal/services/apiService';
import { readFileSync } from 'fs';
import path from 'path';

describe('execute tool input security', () => {
  it('removes legacy environment values before workflow serialization', () => {
    const input = {
      toolName: 'safe-tool',
      args: {},
      apiConfig: {
        endpoint: {
          url: '/api/safe',
          method: 'GET' as const,
          headers: {},
        },
      },
      environment: {
        SERVICE_API_KEY: 'must-not-reach-temporal-history',
      },
    };

    expect(sanitizeExecuteToolInput(input)).not.toHaveProperty('environment');
  });

  it('rejects literal credentials before they can enter Temporal history', () => {
    const input = {
      toolName: 'unsafe-tool',
      args: {},
      apiConfig: {
        endpoint: {
          url: '/api/unsafe',
          method: 'GET' as const,
          headers: {
            Authorization: 'Bearer literal-secret',
            'x-api-key': 'another-literal-secret',
          },
        },
      },
    };

    expect(() => sanitizeExecuteToolInput(input)).toThrow(
      'Sensitive header "Authorization" must use an approved worker secret placeholder'
    );
  });

  it('allows worker-side secret placeholders in sensitive headers', () => {
    const input = {
      toolName: 'safe-authenticated-tool',
      args: {},
      apiConfig: {
        endpoint: {
          url: '/api/safe',
          method: 'GET' as const,
          headers: {
            Authorization: 'Bearer {{SERVICE_API_KEY}}',
            'x-api-key': '{{WEATHER_API_KEY}}',
          },
        },
      },
    };

    expect(sanitizeExecuteToolInput(input).apiConfig.endpoint.headers).toEqual(
      input.apiConfig.endpoint.headers
    );
  });

  it('redacts credentials while preserving non-sensitive request headers', () => {
    expect(
      redactSensitiveHeaders({
        Authorization: 'Bearer top-secret',
        'x-api-key': 'api-secret',
        'x-client-token': 'client-secret',
        'X-Credential': 'credential-secret',
        'X-Signature': 'signature-secret',
        'X-Password': 'password-secret',
        Accept: 'application/json',
      })
    ).toEqual({
      Authorization: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      'x-client-token': '[REDACTED]',
      'X-Credential': '[REDACTED]',
      'X-Signature': '[REDACTED]',
      'X-Password': '[REDACTED]',
      Accept: 'application/json',
    });
  });

  it('rejects literal credentials in broadly named secret headers', () => {
    for (const headerName of ['X-Credential', 'X-Signature', 'X-Password']) {
      const input = {
        toolName: 'unsafe-tool',
        args: {},
        apiConfig: {
          endpoint: {
            url: '/api/unsafe',
            method: 'GET' as const,
            headers: { [headerName]: 'literal-secret' },
          },
        },
      };

      expect(() => sanitizeExecuteToolInput(input)).toThrow(
        `Sensitive header "${headerName}" must use an approved worker secret placeholder`
      );
    }
  });

  it('does not expose request or response values in apiService logs', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ token: 'response-secret' }),
    } as Response);

    try {
      const service = new ApiService('https://example.com', 'default-secret');
      await service.post('/secure?token=query-secret', {
        password: 'body-secret',
      }, {
        Authorization: 'Bearer authorization-secret',
        'X-Credential': 'request-credential-secret',
        'X-Signature': 'request-signature-secret',
        Accept: 'application/json',
      });

      const serializedLogs = JSON.stringify([
        ...logSpy.mock.calls,
        ...errorSpy.mock.calls,
      ]);
      expect(serializedLogs).not.toContain('authorization-secret');
      expect(serializedLogs).not.toContain('request-credential-secret');
      expect(serializedLogs).not.toContain('request-signature-secret');
      expect(serializedLogs).not.toContain('query-secret');
      expect(serializedLogs).not.toContain('body-secret');
      expect(serializedLogs).not.toContain('response-secret');
      expect(serializedLogs).toContain('[REDACTED]');
      expect(serializedLogs).toContain('application/json');
    } finally {
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('does not let the external gateway credential start workflows', () => {
    const gatewayTemplate = readFileSync(
      path.join(
        process.cwd(),
        'infra/azure/gateway/envoy.yaml.tpl'
      ),
      'utf8'
    );

    expect(gatewayTemplate).toContain('auth == service_auth');
    expect(gatewayTemplate).toContain(
      'auth == read_only_auth and read_only_methods[method] == true'
    );
    expect(gatewayTemplate).not.toContain('StartWorkflowExecution = true');
    expect(gatewayTemplate).not.toContain('SignalWithStartWorkflowExecution = true');
  });
});
