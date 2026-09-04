import { getEnv } from '@techmatch/config';
import {
  AtolFiscalReceiptProvider,
  CdekDeliveryProvider,
  ConsoleNotificationProvider,
  DisabledLlmAssistant,
  MockDeliveryProvider,
  MockFiscalReceiptProvider,
  MockPaymentProvider,
  OzonAdapter,
  SmtpNotificationProvider,
  WildberriesAdapter,
  YandexMarketAdapter,
  YooKassaPaymentProvider,
  type DeliveryProvider,
  type FiscalReceiptProvider,
  type LlmAssistant,
  type MarketplaceAdapter,
  type NotificationProvider,
  type PaymentProvider,
} from '@techmatch/integrations';

/**
 * Реестр провайдеров. Реальный адаптер включается только при наличии ключей;
 * иначе — явно обозначенный mock. Никаких «тихих» подмен: метод describe() показывает режим.
 */
const registry: { payment?: PaymentProvider; delivery?: DeliveryProvider; notifications?: NotificationProvider; fiscal?: FiscalReceiptProvider; llm?: LlmAssistant } = {};

export function getPaymentProvider(): PaymentProvider {
  if (registry.payment) return registry.payment;
  const env = getEnv();
  if (env.PAYMENT_PROVIDER === 'yookassa' && env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY) {
    registry.payment = new YooKassaPaymentProvider({ shopId: env.YOOKASSA_SHOP_ID, secretKey: env.YOOKASSA_SECRET_KEY });
  } else {
    registry.payment = new MockPaymentProvider({ appUrl: env.APP_URL, webhookSecret: env.PAYMENT_WEBHOOK_SECRET });
  }
  return registry.payment;
}

export function getDeliveryProvider(): DeliveryProvider {
  if (registry.delivery) return registry.delivery;
  const env = getEnv();
  registry.delivery =
    env.DELIVERY_PROVIDER === 'cdek' && env.CDEK_ACCOUNT && env.CDEK_SECURE_PASSWORD
      ? new CdekDeliveryProvider({ account: env.CDEK_ACCOUNT, securePassword: env.CDEK_SECURE_PASSWORD, senderCityCode: env.CDEK_SENDER_CITY_CODE })
      : new MockDeliveryProvider();
  return registry.delivery;
}

export function getNotificationProvider(): NotificationProvider {
  if (registry.notifications) return registry.notifications;
  const env = getEnv();
  registry.notifications =
    env.NOTIFICATION_PROVIDER === 'smtp' && env.SMTP_HOST && env.SMTP_USER
      ? new SmtpNotificationProvider({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.SMTP_FROM })
      : new ConsoleNotificationProvider();
  return registry.notifications;
}

export function getFiscalProvider(): FiscalReceiptProvider {
  if (registry.fiscal) return registry.fiscal;
  const env = getEnv();
  registry.fiscal =
    env.FISCAL_PROVIDER === 'atol' && env.ATOL_LOGIN && env.ATOL_PASSWORD && env.ATOL_GROUP_CODE
      ? new AtolFiscalReceiptProvider({ login: env.ATOL_LOGIN, password: env.ATOL_PASSWORD, groupCode: env.ATOL_GROUP_CODE })
      : new MockFiscalReceiptProvider();
  return registry.fiscal;
}

export function getLlmAssistant(): LlmAssistant {
  if (registry.llm) return registry.llm;
  registry.llm = new DisabledLlmAssistant();
  return registry.llm;
}

export function getMarketplaceAdapters(): MarketplaceAdapter[] {
  const env = getEnv();
  return [new WildberriesAdapter(env.WILDBERRIES_API_TOKEN), new OzonAdapter(env.OZON_CLIENT_ID, env.OZON_API_KEY), new YandexMarketAdapter(env.YANDEX_MARKET_OAUTH_TOKEN, env.YANDEX_MARKET_CAMPAIGN_ID)];
}

export function describeProviders() {
  return {
    payment: { code: getPaymentProvider().code, mode: getPaymentProvider().mode },
    delivery: { code: getDeliveryProvider().code, mode: getDeliveryProvider().mode },
    notifications: { code: getNotificationProvider().code, mode: getNotificationProvider().mode },
    fiscal: { code: getFiscalProvider().code, mode: getFiscalProvider().mode },
    llm: { mode: getLlmAssistant().mode },
    marketplaces: getMarketplaceAdapters().map((a) => ({ code: a.code, name: a.name, configured: a.isConfigured() })),
  };
}

/** Для тестов: подменить провайдеры. */
export function overrideProviders(p: Partial<typeof registry>) {
  Object.assign(registry, p);
}
