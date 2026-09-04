export interface NotificationMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  template?: string;
  data?: Record<string, unknown>;
}

export interface NotificationProvider {
  readonly code: string;
  readonly mode: 'mock' | 'live';
  send(message: NotificationMessage): Promise<{ delivered: boolean; providerMessageId?: string }>;
}

/** Пишет письма в лог и в память (для тестов). Ничего никуда не отправляет. */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly code = 'console';
  readonly mode = 'mock' as const;
  readonly sent: NotificationMessage[] = [];
  constructor(private readonly log: (line: string) => void = (l) => console.info(l)) {}
  async send(message: NotificationMessage) {
    this.sent.push(message);
    this.log(`[notification:mock] → ${message.to} | ${message.subject}\n${message.text}`);
    return { delivered: false, providerMessageId: `console_${this.sent.length}` };
  }
}

/**
 * SMTP-провайдер: заготовка. Реальная отправка требует SMTP_HOST/USER/PASSWORD и библиотеки nodemailer,
 * которая подключается на этапе production-настройки. До этого фабрика возвращает ConsoleNotificationProvider.
 */
export class SmtpNotificationProvider implements NotificationProvider {
  readonly code = 'smtp';
  readonly mode = 'live' as const;
  constructor(private readonly opts: { host: string; port: number; user: string; password: string; from: string }) {
    if (!opts.host || !opts.user) throw new Error('SMTP: не заданы параметры');
  }
  async send(message: NotificationMessage): Promise<{ delivered: boolean; providerMessageId?: string }> {
    throw new Error(`SMTP-транспорт не подключён (host=${this.opts.host}). Установите nodemailer и реализуйте отправку для ${message.to}.`);
  }
}
