import { z } from 'zod';

/** Общие схемы форм — используются в server actions витрины и в тестах. */
export const emailSchema = z.email('Укажите корректный email');
export const phoneSchema = z.string().trim().min(10, 'Укажите телефон').max(30);
export const passwordSchema = z.string().min(8, 'Пароль не короче 8 символов').max(200);

export const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите имя и фамилию').max(120),
  phone: phoneSchema,
  email: emailSchema,
  city: z.string().trim().min(2, 'Укажите город').max(100),
  street: z.string().trim().min(2, 'Укажите улицу').max(160),
  building: z.string().trim().min(1, 'Укажите дом').max(30),
  apartment: z.string().trim().max(30).optional().or(z.literal('')),
  postalCode: z.string().trim().max(12).optional().or(z.literal('')),
  region: z.string().trim().max(100).optional().or(z.literal('')),
});
export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Введите пароль'), next: z.string().optional() });
export const registerSchema = z.object({ email: emailSchema, password: passwordSchema, firstName: z.string().trim().min(1, 'Укажите имя').max(60), phone: z.string().max(30).optional(), next: z.string().optional() });
export const couponCodeSchema = z.string().trim().toUpperCase().min(3).max(30);
export const newsletterSchema = z.object({ email: emailSchema, name: z.string().max(80).optional() });
export const idempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/, 'Некорректный ключ');
