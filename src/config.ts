export type Config = {
  port: number;
  host: string;
  llm: {
    apiKey: string | undefined;
    baseUrl: string;
    /** First is the primary model; the rest are fallbacks, in order. */
    models: string[];
    temperature: number;
    timeoutMs: number;
    appUrl: string;
    appName: string;
  };
};

// Free OpenRouter models come and go; override with OPENROUTER_MODELS when these disappear.
const DEFAULT_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-31b-it:free',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const models = (env.OPENROUTER_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    llm: {
      apiKey: env.OPENROUTER_API_KEY || undefined,
      baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      models: models.length ? models : DEFAULT_MODELS,
      temperature: Number(env.LLM_TEMPERATURE ?? 0),
      timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 30_000),
      appUrl: env.APP_URL ?? 'https://github.com/wsqreis/restaurant-booking-agent',
      appName: env.APP_NAME ?? 'restaurant-booking-agent',
    },
  };
}
