export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', id ? `${entity} «${id}» не найден` : `${entity} не найден`, 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION', message, 422, details);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Недостаточно прав') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Требуется вход') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class NotConfiguredError extends DomainError {
  constructor(integration: string) {
    super('NOT_CONFIGURED', `Интеграция «${integration}» не настроена: отсутствуют ключи в окружении`, 503);
    this.name = 'NotConfiguredError';
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
