interface TemporalConfig {
    serverUrl: string;
    namespace: string;
    taskQueue: string;
    apiKey?: string;
    tls?: boolean;
}
interface SupabaseConfig {
    url: string;
    key: string;
}
interface ApiConfig {
    baseUrl: string;
    apiKey: string;
}
declare const temporalConfig: TemporalConfig;
declare const supabaseConfig: SupabaseConfig;
declare const apiConfig: ApiConfig;
declare const logLevel: string;
export { temporalConfig, supabaseConfig, apiConfig, logLevel, type TemporalConfig, type SupabaseConfig, type ApiConfig };
