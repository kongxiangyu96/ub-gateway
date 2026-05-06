import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  RAG_CORE_BASE_URL: z.url(),
  RAG_CORE_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  RAG_CORE_TOP_K: z.coerce.number().int().positive().default(5),
  RAG_CORE_CHAT_PREPARE_PATH: z.string().min(1).default('/chat/prepare'),
  RAG_CORE_INDEX_JOBS_PATH: z.string().min(1).default('/index-jobs'),

  LLM_PROVIDER: z.enum(['openai']).default('openai'),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1024),

  PROMPT_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(6000),

  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default('userbank-knowledge'),
  MINIO_USE_SSL: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),
  MINIO_REGION: z.string().min(1).optional(),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(50),

  AUTH_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = {
  env: 'development' | 'production' | 'test';
  http: {
    port: number;
    host: string;
    logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  };
  ragCore: {
    baseUrl: string;
    timeoutMs: number;
    topK: number;
    chatPreparePath: string;
    indexJobsPath: string;
  };
  llm: {
    provider: 'openai';
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    temperature: number;
    maxTokens: number;
  };
  prompt: {
    maxContextChars: number;
  };
  minio: {
    endPoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    useSSL: boolean;
    region?: string;
  };
  upload: {
    maxFileSizeBytes: number;
  };
  features: {
    authEnabled: boolean;
  };
};

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  cached = {
    env: env.NODE_ENV,
    http: {
      port: env.PORT,
      host: env.HOST,
      logLevel: env.LOG_LEVEL,
    },
    ragCore: {
      baseUrl: env.RAG_CORE_BASE_URL.replace(/\/+$/, ''),
      timeoutMs: env.RAG_CORE_TIMEOUT_MS,
      topK: env.RAG_CORE_TOP_K,
      chatPreparePath: normalizePath(env.RAG_CORE_CHAT_PREPARE_PATH),
      indexJobsPath: normalizePath(env.RAG_CORE_INDEX_JOBS_PATH),
    },
    llm: {
      provider: env.LLM_PROVIDER,
      baseUrl: env.LLM_BASE_URL.replace(/\/+$/, ''),
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      temperature: env.LLM_TEMPERATURE,
      maxTokens: env.LLM_MAX_TOKENS,
    },
    prompt: {
      maxContextChars: env.PROMPT_MAX_CONTEXT_CHARS,
    },
    minio: {
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      bucket: env.MINIO_BUCKET,
      useSSL: env.MINIO_USE_SSL,
      region: env.MINIO_REGION,
    },
    upload: {
      maxFileSizeBytes: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    },
    features: {
      authEnabled: env.AUTH_ENABLED,
    },
  };
  return cached;
}

function normalizePath(path: string): string {
  return `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}
