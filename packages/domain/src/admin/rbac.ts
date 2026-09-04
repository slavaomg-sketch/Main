/** Коды разрешений. Роли получают наборы разрешений; проверка — requirePermission(). */
export const PERMISSIONS = {
  'dashboard.view': 'Просмотр дашборда',
  'products.read': 'Просмотр товаров',
  'products.write': 'Создание и редактирование товаров, цен и остатков',
  'devices.read': 'Просмотр устройств',
  'devices.write': 'Редактирование устройств и характеристик',
  'compatibility.read': 'Просмотр совместимости',
  'compatibility.write': 'Подтверждение и запрет совместимости',
  'imports.read': 'Просмотр импортов',
  'imports.write': 'Запуск импортов и синхронизаций',
  'orders.read': 'Просмотр заказов',
  'orders.write': 'Изменение статусов заказов, возвраты',
  'customers.read': 'Просмотр клиентов',
  'customers.write': 'Редактирование клиентов',
  'content.read': 'Просмотр контента',
  'content.write': 'Редактирование главной, баннеров, страниц',
  'promotions.read': 'Просмотр маркетинга',
  'promotions.write': 'Промокоды, акции, комплекты',
  'users.read': 'Просмотр сотрудников',
  'users.write': 'Управление сотрудниками и ролями',
  'audit.read': 'Просмотр журнала аудита',
  'settings.write': 'Настройки магазина',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES: Record<string, { name: string; description: string; permissions: Permission[] | '*' }> = {
  owner: { name: 'Владелец', description: 'Полный доступ ко всему', permissions: '*' },
  admin: { name: 'Администратор', description: 'Всё, кроме управления владельцами', permissions: '*' },
  content_manager: { name: 'Контент-менеджер', description: 'Главная, баннеры, подборки, страницы, FAQ', permissions: ['dashboard.view', 'content.read', 'content.write', 'products.read', 'promotions.read', 'promotions.write'] },
  catalog_manager: { name: 'Менеджер каталога', description: 'Товары, устройства, совместимость, импорт', permissions: ['dashboard.view', 'products.read', 'products.write', 'devices.read', 'devices.write', 'compatibility.read', 'compatibility.write', 'imports.read', 'imports.write', 'content.read'] },
  order_manager: { name: 'Менеджер заказов', description: 'Заказы, оплаты, доставка, возвраты, клиенты', permissions: ['dashboard.view', 'orders.read', 'orders.write', 'customers.read', 'products.read'] },
  support: { name: 'Поддержка', description: 'Просмотр заказов и клиентов, комментарии', permissions: ['dashboard.view', 'orders.read', 'customers.read', 'products.read', 'devices.read', 'compatibility.read'] },
};

export function roleHasPermission(roleCode: string, permissions: string[], needed: Permission): boolean {
  const role = ROLES[roleCode];
  if (role?.permissions === '*') return true;
  return permissions.includes(needed);
}
