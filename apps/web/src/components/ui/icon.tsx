import {
  Award, Battery, BatteryCharging, BatteryFull, Cable, Camera, Car, Gamepad2, HardDrive, Headphones, Headset, Keyboard, Laptop, LayoutGrid, Monitor, Package, Plug, PlugZap, Printer, Server, Shield, ShieldCheck, Smartphone, Tablet, Truck, Usb, Watch, type LucideIcon, type LucideProps,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  smartphone: Smartphone, laptop: Laptop, tablet: Tablet, watch: Watch, headphones: Headphones, printer: Printer, monitor: Monitor, 'gamepad-2': Gamepad2, camera: Camera, car: Car, 'layout-grid': LayoutGrid,
  'shield-check': ShieldCheck, shield: Shield, truck: Truck, award: Award, package: Package, headset: Headset, 'plug-zap': PlugZap, plug: Plug, cable: Cable, usb: Usb, server: Server, 'battery-charging': BatteryCharging, 'battery-full': BatteryFull, battery: Battery, 'hard-drive': HardDrive, keyboard: Keyboard,
};

/** Иконка из единого набора lucide по коду (коды хранятся в БД: категории, преимущества). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = MAP[name] ?? LayoutGrid;
  return <Cmp aria-hidden="true" {...props} />;
}
