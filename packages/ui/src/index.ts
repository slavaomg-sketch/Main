/**
 * @techmatch/ui — дизайн-токены и справочник состояний.
 * Сами React-компоненты живут в apps/web/src/components (они зависят от next/link, next/image).
 */
export const tokens = {
  colors: {
    brand: { 50: '#eaf2ff', 100: '#d6e4ff', 200: '#b3ccff', 500: '#1a73e8', 600: '#1565d8', 700: '#0f56b8', 900: '#0b3f8a' },
    ink: { 900: '#0f172a', 800: '#1e293b', 700: '#334155', 500: '#64748b', 400: '#94a3b8', 300: '#cbd5e1', 200: '#e2e8f0', 100: '#f1f5f9', 50: '#f8fafc' },
    surface: '#ffffff',
    canvas: '#f5f7fa',
    hero: '#eef2f7',
    tint: { blue: '#e8f0fb', mint: '#e6f5ef', peach: '#fdeee2', sky: '#e9f1fb' },
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    star: '#f59e0b',
  },
  radius: { xs: 6, sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  container: 1240,
  breakpoints: { xs: 380, sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 },
  /** Минимальный размер интерактивного элемента на касание */
  touchTarget: 44,
} as const;

export type Tokens = typeof tokens;
