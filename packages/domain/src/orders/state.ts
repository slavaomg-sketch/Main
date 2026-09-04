export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'READY_FOR_SHIPMENT'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

/** Конечный автомат статусов заказа. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED', 'REFUND_PENDING'],
  PROCESSING: ['READY_FOR_SHIPMENT', 'CANCELLED', 'REFUND_PENDING'],
  READY_FOR_SHIPMENT: ['SHIPPED', 'CANCELLED', 'REFUND_PENDING'],
  SHIPPED: ['DELIVERED', 'REFUND_PENDING'],
  DELIVERED: ['REFUND_PENDING'],
  CANCELLED: [],
  REFUND_PENDING: ['REFUNDED', 'PAID'],
  REFUNDED: [],
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: 'Черновик',
  PENDING_PAYMENT: 'Ожидает оплаты',
  PAID: 'Оплачен',
  PROCESSING: 'В обработке',
  READY_FOR_SHIPMENT: 'Готов к отправке',
  SHIPPED: 'Отправлен',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
  REFUND_PENDING: 'Ожидает возврата',
  REFUNDED: 'Возвращён',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

/** Статусы, в которых заказ ещё удерживает резерв остатков. */
export const RESERVING_STATUSES: OrderStatus[] = ['DRAFT', 'PENDING_PAYMENT'];
/** Статусы, в которых остатки уже списаны. */
export const CONSUMED_STATUSES: OrderStatus[] = ['PAID', 'PROCESSING', 'READY_FOR_SHIPMENT', 'SHIPPED', 'DELIVERED', 'REFUND_PENDING'];
export const FINAL_STATUSES: OrderStatus[] = ['CANCELLED', 'REFUNDED', 'DELIVERED'];
export const CANCELLABLE_BY_CUSTOMER: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'PROCESSING'];
