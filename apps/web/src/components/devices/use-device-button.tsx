'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Check, Loader2, Smartphone } from 'lucide-react';
import { setActiveDeviceAction } from '@/server/actions/cart';
import { saveDeviceAction } from '@/server/actions/account';
import { useToast } from '@/components/ui/toast';

export function UseDeviceButton({ deviceModelId, deviceVariantId, active, loggedIn }: { deviceModelId: string; deviceVariantId?: string | null; active: boolean; loggedIn: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <button
      type="button"
      disabled={pending}
      data-testid="use-device"
      onClick={() =>
        start(async () => {
          const r = await setActiveDeviceAction(active ? null : deviceModelId);
          if (!r.ok) return toast.error(r.error);
          if (!active && loggedIn) await saveDeviceAction({ deviceModelId, deviceVariantId: deviceVariantId ?? null });
          toast.success(active ? 'Устройство больше не выбрано' : loggedIn ? 'Устройство сохранено в «Мои устройства»' : 'Устройство выбрано. Войдите, чтобы сохранить его в аккаунте');
          router.refresh();
        })
      }
      className={`btn ${active ? 'btn-outline' : 'btn-primary'}`}
    >
      {pending ? <Loader2 width={16} height={16} className="animate-spin" /> : active ? <Check width={16} height={16} /> : <Smartphone width={16} height={16} />}
      {active ? 'Это моё устройство' : 'Сделать моим устройством'}
    </button>
  );
}
