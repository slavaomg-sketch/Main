import { z } from 'zod';
import { loadDotEnv, REPO_ROOT } from './load';
export { REPO_ROOT };

loadDotEnv();

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),

  QUEUE_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-please-change-me'),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  CUSTOMER_SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  CART_COOKIE_SECRET: z.string().min(16).default('dev-only-cart-secret-please-change-me'),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().positive().default(60),

  MEDIA_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_LOCAL_DIR: z.string().default('./storage/media'),
  MEDIA_PUBLIC_BASE_URL: z.string().default('/media'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().optional().default('ru-central1'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_PUBLIC_BASE_URL: z.string().optional().default(''),
  UPLOAD_MAX_IMAGE_MB: z.coerce.number().positive().default(8),
  /** Приводить загружаемые фото товаров и устройств к единому стандарту (квадрат 1:1, объект по центру, единые поля). */
  IMAGE_NORMALIZE: z.enum(['true', 'false']).default('true'),
  /** Внешняя команда удаления фона, например: rembg i -m isnet-general-use {input} {output}. Пусто — фон не удаляется. */
  IMAGE_CUTOUT_COMMAND: z.string().optional().default(''),

  PAYMENT_PROVIDER: z.enum(['mock', 'yookassa']).default('mock'),
  YOOKASSA_SHOP_ID: z.string().optional().default(''),
  YOOKASSA_SECRET_KEY: z.string().optional().default(''),
  PAYMENT_WEBHOOK_SECRET: z.string().min(8).default('dev-only-webhook-secret'),
  ORDER_RESERVATION_TTL_MINUTES: z.coerce.number().positive().default(30),

  DELIVERY_PROVIDER: z.enum(['mock', 'cdek']).default('mock'),
  CDEK_ACCOUNT: z.string().optional().default(''),
  CDEK_SECURE_PASSWORD: z.string().optional().default(''),
  CDEK_SENDER_CITY_CODE: z.coerce.number().default(44),

  NOTIFICATION_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('TechMatch <noreply@techmatch.local>'),

  FISCAL_PROVIDER: z.enum(['mock', 'atol']).default('mock'),
  ATOL_LOGIN: z.string().optional().default(''),
  ATOL_PASSWORD: z.string().optional().default(''),
  ATOL_GROUP_CODE: z.string().optional().default(''),

  WILDBERRIES_API_TOKEN: z.string().optional().default(''),
  OZON_CLIENT_ID: z.string().optional().default(''),
  OZON_API_KEY: z.string().optional().default(''),
  YANDEX_MARKET_OAUTH_TOKEN: z.string().optional().default(''),
  YANDEX_MARKET_CAMPAIGN_ID: z.string().optional().default(''),

  LLM_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),

  SEED_ADMIN_EMAIL: z.string().default('admin@techmatch.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin12345!'),
  SEED_CUSTOMER_EMAIL: z.string().default('customer@techmatch.local'),
  SEED_CUSTOMER_PASSWORD: z.string().default('Customer12345!'),

  SEO_INDEXING_ENABLED: bool.default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Валидированное окружение. Бросает понятную ошибку при отсутствии обязательных переменных. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
export const isTest = (): boolean => getEnv().NODE_ENV === 'test';

/** Какие интеграции реально сконфигурированы ключами (иначе — mock/sandbox). */
export function integrationStatus() {
  const env = getEnv();
  return {
    payment: {
      provider: env.PAYMENT_PROVIDER,
      configured: env.PAYMENT_PROVIDER === 'mock' || Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY),
      mode: env.PAYMENT_PROVIDER === 'mock' ? 'mock' : 'live',
    },
    delivery: {
      provider: env.DELIVERY_PROVIDER,
      configured: env.DELIVERY_PROVIDER === 'mock' || Boolean(env.CDEK_ACCOUNT && env.CDEK_SECURE_PASSWORD),
      mode: env.DELIVERY_PROVIDER === 'mock' ? 'mock' : 'live',
    },
    notifications: {
      provider: env.NOTIFICATION_PROVIDER,
      configured: env.NOTIFICATION_PROVIDER === 'console' || Boolean(env.SMTP_HOST && env.SMTP_USER),
      mode: env.NOTIFICATION_PROVIDER === 'console' ? 'mock' : 'live',
    },
    fiscal: {
      provider: env.FISCAL_PROVIDER,
      configured: env.FISCAL_PROVIDER === 'mock' || Boolean(env.ATOL_LOGIN && env.ATOL_PASSWORD),
      mode: env.FISCAL_PROVIDER === 'mock' ? 'mock' : 'live',
    },
    marketplaces: {
      wildberries: Boolean(env.WILDBERRIES_API_TOKEN),
      ozon: Boolean(env.OZON_CLIENT_ID && env.OZON_API_KEY),
      yandexMarket: Boolean(env.YANDEX_MARKET_OAUTH_TOKEN && env.YANDEX_MARKET_CAMPAIGN_ID),
    },
    llm: { provider: env.LLM_PROVIDER, configured: env.LLM_PROVIDER === 'anthropic' && Boolean(env.ANTHROPIC_API_KEY) },
    media: { driver: env.MEDIA_DRIVER, configured: env.MEDIA_DRIVER === 'local' || Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID) },
  } as const;
}
