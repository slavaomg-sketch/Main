'use client';

import { useState } from 'react';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@techmatch/domain/orders/state';
import { ActionButton, ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import { completeRefundAction, createShipmentAction, orderNotesAction, orderTransitionAction, refundAction } from '@/server/actions/admin/orders';

export function OrderActions({ orderId, status, allowed, notes, hasSuccessfulPayment, hasShipment, totalRub }: { orderId: string; status: OrderStatus; allowed: OrderStatus[]; notes: string; hasSuccessfulPayment: boolean; hasShipment: boolean; totalRub: number }) {
  const [comment, setComment] = useState('');
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="mb-2 text-[15px] font-bold">Смена статуса</h2>
        <p className="mb-3 text-[12px] text-ink-500">Текущий: <b>{ORDER_STATUS_LABEL[status]}</b>. Доступные переходы по конечному автомату:</p>
        <input className="input mb-3 min-h-9" placeholder="Комментарий (виден покупателю в истории)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Комментарий" />
        <div className="flex flex-wrap gap-2">
          {allowed.filter((s) => s !== 'REFUND_PENDING').map((s) => (
            <ActionButton key={s} action={() => orderTransitionAction(orderId, s, comment || undefined)} confirm={s === 'CANCELLED' ? 'Отменить заказ? Остатки вернутся на склад.' : undefined} className={`btn btn-sm ${s === 'CANCELLED' ? 'btn-outline text-danger-500' : 'btn-primary'}`}>
              → {ORDER_STATUS_LABEL[s]}
            </ActionButton>
          ))}
          {allowed.length === 0 && <span className="text-[13px] text-ink-500">Конечный статус</span>}
        </div>
        {status === 'READY_FOR_SHIPMENT' && !hasShipment && (
          <div className="mt-3"><ActionButton action={() => createShipmentAction(orderId)} className="btn btn-dark btn-sm">Создать отправление у провайдера</ActionButton></div>
        )}
      </section>
      {hasSuccessfulPayment && ['PAID', 'PROCESSING', 'READY_FOR_SHIPMENT', 'SHIPPED', 'DELIVERED'].includes(status) && (
        <section className="card p-5">
          <h2 className="mb-2 text-[15px] font-bold">Возврат</h2>
          <ActionForm action={(fd) => refundAction(orderId, fd)} submitLabel="Запросить возврат" variant="outline">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Сумма, ₽ (пусто — полный)"><input name="amountRub" type="number" step="0.01" min={0} max={totalRub} className="input min-h-9" /></Field>
              <Field label="Причина"><input name="reason" className="input min-h-9" /></Field>
            </div>
          </ActionForm>
        </section>
      )}
      {status === 'REFUND_PENDING' && (
        <section className="card p-5">
          <h2 className="mb-2 text-[15px] font-bold">Возврат в процессе</h2>
          <p className="mb-3 text-[12px] text-ink-500">Для реального провайдера возврат подтверждается webhook. В mock-режиме подтвердите вручную.</p>
          <ActionButton action={() => completeRefundAction(orderId)} confirm="Подтвердить возврат денег и вернуть товар на склад?" className="btn btn-dark btn-sm">Подтвердить возврат</ActionButton>
        </section>
      )}
      <section className="card p-5">
        <h2 className="mb-2 text-[15px] font-bold">Комментарий менеджера</h2>
        <ActionForm action={(fd) => orderNotesAction(orderId, fd)} submitLabel="Сохранить" variant="outline">
          <textarea name="managerNotes" className="input min-h-20 py-2" defaultValue={notes} />
        </ActionForm>
      </section>
    </div>
  );
}
