export function loadConfig(env = process.env) {
  const bool = (key, fallback) => {
    const v = env[key];
    if (v == null || v === '') return fallback;
    if (!['true', 'false'].includes(v)) throw new Error(`Invalid setting: ${key}`);
    return v === 'true';
  };
  const num = (key, fallback, min, max) => {
    const v = env[key] == null || env[key] === '' ? fallback : Number(env[key]);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid setting: ${key}`);
    return v;
  };
  const integer = (key, fallback, min, max) => {
    const v = num(key, fallback, min, max);
    if (!Number.isInteger(v)) throw new Error(`Invalid setting: ${key}`);
    return v;
  };
  return {
    aiEnabled: bool('AI_ENABLED', false), provider: env.AI_PROVIDER || 'openai',
    model: env.AI_MODEL || '', baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.AI_API_KEY || '', maxOutput: integer('AI_MAX_OUTPUT_TOKENS', 2000, 256, 16000),
    aiConcurrency: integer('AI_CONCURRENCY', 1, 1, 16), aiTimeout: integer('AI_TIMEOUT_SECONDS', 20, 1, 120) * 1000,
    browserSteps: integer('AI_BROWSER_MAX_STEPS', 8, 1, 30),
    browserTimeout: integer('AI_BROWSER_TIMEOUT_SECONDS', 40, 1, 120) * 1000,
    dailyRequests: integer('AI_DAILY_REQUEST_LIMIT', 100, 0, 1000000),
    dailyBudget: num('AI_DAILY_BUDGET', 1, 0, 100000),
    inputPrice: num('AI_INPUT_USD_PER_MILLION', 0, 0, 100000),
    outputPrice: num('AI_OUTPUT_USD_PER_MILLION', 0, 0, 100000),
    concurrency: integer('ANALYSIS_CONCURRENCY', 1, 1, 16),
    timeout: integer('ANALYSIS_TIMEOUT_SECONDS', 60, 5, 120) * 1000,
    queueMax: integer('QUEUE_MAX_LENGTH', 20, 0, 10000),
    queueWait: integer('QUEUE_WAIT_TIMEOUT_SECONDS', 30, 1, 120) * 1000,
    rateEnabled: bool('RATE_LIMIT_ENABLED', true),
    perIp: integer('RATE_LIMIT_PER_IP_PER_MINUTE', 10, 1, 10000),
    perUser: integer('RATE_LIMIT_PER_USER_PER_MINUTE', 10, 1, 10000),
    cacheEnabled: bool('CACHE_ENABLED', true), cacheTtl: integer('CACHE_TTL_SECONDS', 300, 1, 86400) * 1000,
    resultTtl: integer('JOB_RESULT_TTL_SECONDS', 600, 10, 86400) * 1000,
    retainedMax: integer('RESULT_MAX_ENTRIES', 500, 1, 10000),
    stateFile: env.AI_USAGE_FILE || '/app/state/ai-usage.json',
  };
}
