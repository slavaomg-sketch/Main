import { ORDER_STATUS_LABEL, type OrderStatus } from '@techmatch/domain/orders';

const CLS: Record<OrderStatus, string> = {
  DRAFT: 'bg-ink-100 text-ink-600',
  PENDING_PAYMENT: 'bg-warning-100 text-warning-500',
  PAID: 'bg-success-100 text-success-500',
  PROCESSING: 'bg-brand-50 text-brand-600',
  READY_FOR_SHIPMENT: 'bg-brand-50 text-brand-600',
  SHIPPED: 'bg-brand-100 text-brand-700',
  DELIVERED: 'bg-success-100 text-success-500',
  CANCELLED: 'bg-danger-100 text-danger-500',
  REFUND_PENDING: 'bg-warning-100 text-warning-500',
  REFUNDED: 'bg-ink-100 text-ink-600',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${CLS[status]}`} data-testid="order-status">{ORDER_STATUS_LABEL[status]}</span>;
}
