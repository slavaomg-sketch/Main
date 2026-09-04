import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS, allowedTransitions, canTransition } from '../state';

describe('order state machine', () => {
  it('основной путь', () => {
    expect(canTransition('DRAFT', 'PENDING_PAYMENT')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('PAID', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'READY_FOR_SHIPMENT')).toBe(true);
    expect(canTransition('READY_FOR_SHIPMENT', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });
  it('запрещённые переходы', () => {
    expect(canTransition('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransition('CANCELLED', 'PAID')).toBe(false);
    expect(canTransition('REFUNDED', 'PROCESSING')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });
  it('возврат', () => {
    expect(canTransition('DELIVERED', 'REFUND_PENDING')).toBe(true);
    expect(canTransition('REFUND_PENDING', 'REFUNDED')).toBe(true);
    expect(allowedTransitions('REFUNDED')).toEqual([]);
  });
  it('все статусы описаны', () => {
    expect(Object.keys(ORDER_TRANSITIONS)).toHaveLength(10);
  });
});
