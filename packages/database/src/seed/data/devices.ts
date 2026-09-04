/**
 * Демо-устройства. Характеристики — публичные данные производителей.
 * Значения, которые не удалось подтвердить точно, помечены demo: true (specsAreDemo).
 */
export interface DeviceSeed {
  slug: string;
  name: string;
  fullName: string;
  brand: string;
  category: string;
  family?: string;
  generation?: string;
  year?: number;
  modelNumber?: string;
  image?: string; // ключ из seed-assets/images
  popularity?: number;
  demo?: boolean;
  description?: string;
  aliases: string[];
  identifiers?: Array<{ type: 'MODEL_NUMBER' | 'PART_NUMBER' | 'MARKETING_CODE'; value: string; region?: string }>;
  specs: Record<string, unknown>;
  variants?: Array<{ slug: string; name: string; specs?: Record<string, unknown>; aliases?: string[] }>;
}

export const DEVICE_CATEGORIES = [
  { slug: 'phones', name: 'Телефоны и смартфоны', namePlural: 'Смартфоны', icon: 'smartphone', sortOrder: 1 },
  { slug: 'laptops', name: 'Ноутбуки', namePlural: 'Ноутбуки', icon: 'laptop', sortOrder: 2 },
  { slug: 'tablets', name: 'Планшеты', namePlural: 'Планшеты', icon: 'tablet', sortOrder: 3 },
  { slug: 'watches', name: 'Смарт-часы', namePlural: 'Смарт-часы', icon: 'watch', sortOrder: 4 },
  { slug: 'headphones', name: 'Наушники', namePlural: 'Наушники', icon: 'headphones', sortOrder: 5 },
  { slug: 'printers', name: 'Принтеры', namePlural: 'Принтеры', icon: 'printer', sortOrder: 6 },
  { slug: 'monitors', name: 'Мониторы', namePlural: 'Мониторы', icon: 'monitor', sortOrder: 7 },
  { slug: 'gaming', name: 'Игровые устройства', namePlural: 'Игровые устройства', icon: 'gamepad-2', sortOrder: 8 },
  { slug: 'cameras', name: 'Камеры', namePlural: 'Камеры', icon: 'camera', sortOrder: 9 },
  { slug: 'cars', name: 'Автоаксессуары', namePlural: 'Автомобили', icon: 'car', sortOrder: 10 },
  { slug: 'other', name: 'Другие устройства', namePlural: 'Другие устройства', icon: 'layout-grid', sortOrder: 11 },
];

export const DEVICE_BRANDS = ['Apple', 'Samsung', 'Google', 'Xiaomi', 'Dell', 'Lenovo', 'Sony', 'Bose', 'Canon', 'Epson', 'HP', 'Brother', 'LG', 'Microsoft', 'Nintendo', 'Valve', 'GoPro', 'Tesla', '70mai', 'Универсальные'];

const applePhonePorts = (usb: 'LIGHTNING' | 'USB_C', gbps: number, usbVersion: string) => [{ type: usb, usbVersion, dataGbps: gbps, dpAltMode: usb === 'USB_C', pdIn: true }];

export const DEVICES: DeviceSeed[] = [
  // ---------------- Смартфоны ----------------
  {
    slug: 'apple-iphone-15-pro', name: 'iPhone 15 Pro', fullName: 'Apple iPhone 15 Pro (2023)', brand: 'Apple', category: 'phones', family: 'iPhone', generation: '15', year: 2023, modelNumber: 'A3102', image: 'dev-iphone-15-pro', popularity: 1000,
    aliases: ['iphone 15 pro', 'айфон 15 про', 'iphone15pro', '15 pro', 'iPhone 15 Pro титановый'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A3102', region: 'Global' }, { type: 'MODEL_NUMBER', value: 'A2848', region: 'US' }, { type: 'MODEL_NUMBER', value: 'A3101', region: 'Canada/Japan' }],
    specs: { ecosystem: 'apple', ports: applePhonePorts('USB_C', 10, '3.2 Gen 2'), charging: { protocols: ['USB_PD'], maxWatts: 27, viaUsb: true }, wireless: { qi: true, qi2: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 }, physical: { caseFamily: 'iphone-15-pro', screenInches: 6.1 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'apple-iphone-15', name: 'iPhone 15', fullName: 'Apple iPhone 15 (2023)', brand: 'Apple', category: 'phones', family: 'iPhone', generation: '15', year: 2023, modelNumber: 'A3090', image: 'dev-iphone-15', popularity: 900,
    aliases: ['iphone 15', 'айфон 15', 'iphone15'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A3090', region: 'Global' }, { type: 'MODEL_NUMBER', value: 'A2846', region: 'US' }],
    specs: { ecosystem: 'apple', ports: applePhonePorts('USB_C', 0.48, '2.0'), charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, wireless: { qi: true, qi2: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 }, physical: { caseFamily: 'iphone-15', screenInches: 6.1 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'apple-iphone-16-pro', name: 'iPhone 16 Pro', fullName: 'Apple iPhone 16 Pro (2024)', brand: 'Apple', category: 'phones', family: 'iPhone', generation: '16', year: 2024, modelNumber: 'A3083', image: 'dev-iphone-16-pro', popularity: 950,
    aliases: ['iphone 16 pro', 'айфон 16 про', 'iphone16pro', '16 pro'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A3083', region: 'Global' }, { type: 'MODEL_NUMBER', value: 'A3293', region: 'US' }],
    specs: { ecosystem: 'apple', ports: applePhonePorts('USB_C', 10, '3.2 Gen 2'), charging: { protocols: ['USB_PD'], maxWatts: 30, viaUsb: true }, wireless: { qi: true, qi2: true, magsafe: true, magsafeMaxWatts: 25, qiMaxWatts: 15 }, physical: { caseFamily: 'iphone-16-pro', screenInches: 6.3 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'apple-iphone-14', name: 'iPhone 14', fullName: 'Apple iPhone 14 (2022)', brand: 'Apple', category: 'phones', family: 'iPhone', generation: '14', year: 2022, modelNumber: 'A2882', image: 'dev-iphone-14', popularity: 800,
    aliases: ['iphone 14', 'айфон 14', 'iphone14'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2882', region: 'Global' }, { type: 'MODEL_NUMBER', value: 'A2649', region: 'US' }],
    specs: { ecosystem: 'apple', ports: applePhonePorts('LIGHTNING', 0.48, '2.0'), charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, wireless: { qi: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 }, physical: { caseFamily: 'iphone-14', screenInches: 6.1 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'apple-iphone-13', name: 'iPhone 13', fullName: 'Apple iPhone 13 (2021)', brand: 'Apple', category: 'phones', family: 'iPhone', generation: '13', year: 2021, modelNumber: 'A2633', image: 'dev-iphone-13', popularity: 700,
    aliases: ['iphone 13', 'айфон 13', 'iphone13'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2633', region: 'Global' }, { type: 'MODEL_NUMBER', value: 'A2482', region: 'US' }],
    specs: { ecosystem: 'apple', ports: applePhonePorts('LIGHTNING', 0.48, '2.0'), charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, wireless: { qi: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 }, physical: { caseFamily: 'iphone-13', screenInches: 6.1 }, audio: { bluetooth: '5.0', jack35: false } },
  },
  {
    slug: 'samsung-galaxy-s25', name: 'Galaxy S25', fullName: 'Samsung Galaxy S25 (2025)', brand: 'Samsung', category: 'phones', family: 'Galaxy S', generation: 'S25', year: 2025, modelNumber: 'SM-S931B', image: 'dev-galaxy-s25', popularity: 850,
    aliases: ['galaxy s25', 'самсунг с25', 'samsung s25', 'galaxy s 25', 's25'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'SM-S931B', region: 'Global' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 1', dataGbps: 5, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 25, viaUsb: true }, wireless: { qi: true, qiMaxWatts: 15 }, physical: { caseFamily: 'galaxy-s25', screenInches: 6.2 }, audio: { bluetooth: '5.4', jack35: false } },
  },
  {
    slug: 'samsung-galaxy-s25-ultra', name: 'Galaxy S25 Ultra', fullName: 'Samsung Galaxy S25 Ultra (2025)', brand: 'Samsung', category: 'phones', family: 'Galaxy S', generation: 'S25', year: 2025, modelNumber: 'SM-S938B', image: 'dev-galaxy-s25', popularity: 840,
    aliases: ['galaxy s25 ultra', 'самсунг с25 ультра', 's25 ultra', 'galaxy s 25 ultra'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'SM-S938B', region: 'Global' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 1', dataGbps: 5, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 45, viaUsb: true }, wireless: { qi: true, qiMaxWatts: 15 }, physical: { caseFamily: 'galaxy-s25-ultra', screenInches: 6.9 }, audio: { bluetooth: '5.4', jack35: false } },
  },
  {
    slug: 'samsung-galaxy-s24', name: 'Galaxy S24', fullName: 'Samsung Galaxy S24 (2024)', brand: 'Samsung', category: 'phones', family: 'Galaxy S', generation: 'S24', year: 2024, modelNumber: 'SM-S921B', image: 'dev-galaxy-s24', popularity: 780,
    aliases: ['galaxy s24', 'самсунг с24', 'samsung s24', 's24'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'SM-S921B', region: 'Global' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 1', dataGbps: 5, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 25, viaUsb: true }, wireless: { qi: true, qiMaxWatts: 15 }, physical: { caseFamily: 'galaxy-s24', screenInches: 6.2 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'samsung-galaxy-a55', name: 'Galaxy A55', fullName: 'Samsung Galaxy A55 5G (2024)', brand: 'Samsung', category: 'phones', family: 'Galaxy A', generation: 'A55', year: 2024, modelNumber: 'SM-A556E', image: 'dev-galaxy-a55', popularity: 600,
    aliases: ['galaxy a55', 'самсунг а55', 'samsung a55', 'a55'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'SM-A556E', region: 'Global' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '2.0', dataGbps: 0.48, dpAltMode: false, pdIn: true }], charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 25, viaUsb: true }, physical: { caseFamily: 'galaxy-a55', screenInches: 6.6 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'google-pixel-8', name: 'Pixel 8', fullName: 'Google Pixel 8 (2023)', brand: 'Google', category: 'phones', family: 'Pixel', generation: '8', year: 2023, modelNumber: 'GKWS6', image: 'dev-pixel-8', popularity: 500,
    aliases: ['pixel 8', 'пиксель 8', 'google pixel 8'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'GKWS6' }, { type: 'MODEL_NUMBER', value: 'G9BQD', region: 'Global' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 27, viaUsb: true }, wireless: { qi: true, qiMaxWatts: 12 }, physical: { caseFamily: 'pixel-8', screenInches: 6.2 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'xiaomi-14', name: 'Xiaomi 14', fullName: 'Xiaomi 14 (2024)', brand: 'Xiaomi', category: 'phones', family: 'Xiaomi', generation: '14', year: 2024, modelNumber: '23127PN0CG', image: 'dev-xiaomi-14', popularity: 550, demo: true,
    aliases: ['xiaomi 14', 'сяоми 14', 'ксиаоми 14', 'mi 14'],
    identifiers: [{ type: 'MODEL_NUMBER', value: '23127PN0CG', region: 'Global' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: true, pdIn: true }], charging: { protocols: ['PROPRIETARY', 'USB_PD', 'QC4'], maxWatts: 90, viaUsb: true }, wireless: { qi: true, qiMaxWatts: 50 }, physical: { caseFamily: 'xiaomi-14', screenInches: 6.36 }, audio: { bluetooth: '5.4', jack35: false } },
  },
  // ---------------- Ноутбуки ----------------
  {
    slug: 'apple-macbook-air-m1', name: 'MacBook Air M1', fullName: 'Apple MacBook Air 13″ M1 (2020)', brand: 'Apple', category: 'laptops', family: 'MacBook Air', generation: 'M1', year: 2020, modelNumber: 'A2337', image: 'dev-macbook-air-m1', popularity: 700,
    aliases: ['macbook air m1', 'макбук эйр м1', 'macbook air 2020', 'air m1'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2337' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'THUNDERBOLT', count: 2, thunderbolt: 3, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 30, minWatts: 30, pdVoltages: [20], viaUsb: true }, physical: { screenInches: 13.3, caseFamily: 'macbook-air-13-2020' }, display: { maxExternalDisplays: 1 }, audio: { bluetooth: '5.0', jack35: true } },
  },
  {
    slug: 'apple-macbook-air-m2-13', name: 'MacBook Air 13″ M2', fullName: 'Apple MacBook Air 13″ M2 (2022)', brand: 'Apple', category: 'laptops', family: 'MacBook Air', generation: 'M2', year: 2022, modelNumber: 'A2681', image: 'dev-macbook-air-m2-13', popularity: 900,
    aliases: ['macbook air m2', 'макбук эйр м2', 'macbook air 2022', 'macbook air 13 m2', 'air m2', 'macbook air m2 13'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2681' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'THUNDERBOLT', count: 2, thunderbolt: 3, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }, { type: 'MAGSAFE_3' }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 67, minWatts: 30, pdVoltages: [20], viaUsb: true }, physical: { screenInches: 13.6, caseFamily: 'macbook-air-13-m2' }, display: { maxExternalDisplays: 1 }, audio: { bluetooth: '5.3', jack35: true } },
  },
  {
    slug: 'apple-macbook-air-m3-15', name: 'MacBook Air 15″ M3', fullName: 'Apple MacBook Air 15″ M3 (2024)', brand: 'Apple', category: 'laptops', family: 'MacBook Air', generation: 'M3', year: 2024, modelNumber: 'A3114', image: 'dev-macbook-air-m3-15', popularity: 750,
    aliases: ['macbook air m3', 'макбук эйр м3', 'macbook air 15', 'macbook air 2024', 'air m3', 'macbook air 15 m3'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A3114' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'THUNDERBOLT', count: 2, thunderbolt: 3, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }, { type: 'MAGSAFE_3' }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 70, minWatts: 30, pdVoltages: [20], viaUsb: true }, physical: { screenInches: 15.3, caseFamily: 'macbook-air-15' }, display: { maxExternalDisplays: 2 }, audio: { bluetooth: '5.3', jack35: true } },
  },
  {
    slug: 'apple-macbook-pro-14-m3-pro', name: 'MacBook Pro 14″ M3 Pro', fullName: 'Apple MacBook Pro 14″ M3 Pro (2023)', brand: 'Apple', category: 'laptops', family: 'MacBook Pro', generation: 'M3 Pro', year: 2023, modelNumber: 'A2918', image: 'dev-macbook-pro-14-m3', popularity: 650,
    aliases: ['macbook pro 14', 'макбук про 14', 'macbook pro m3', 'macbook pro 14 m3', 'mbp 14'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2918' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'THUNDERBOLT', count: 3, thunderbolt: 4, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }, { type: 'HDMI', hdmiVersion: '2.1' }, { type: 'SD' }, { type: 'MAGSAFE_3' }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 96, minWatts: 60, pdVoltages: [20], viaUsb: true }, physical: { screenInches: 14.2, caseFamily: 'macbook-pro-14' }, display: { maxExternalDisplays: 2 }, audio: { bluetooth: '5.3', jack35: true } },
  },
  {
    slug: 'dell-xps-13-9315', name: 'Dell XPS 13 (9315)', fullName: 'Dell XPS 13 9315 (2022)', brand: 'Dell', category: 'laptops', family: 'XPS', generation: '9315', year: 2022, modelNumber: '9315', image: 'dev-dell-xps-13', popularity: 400,
    aliases: ['dell xps 13', 'делл xps 13', 'xps 13', 'xps 9315'],
    identifiers: [{ type: 'MODEL_NUMBER', value: '9315' }],
    specs: { ecosystem: 'windows', ports: [{ type: 'THUNDERBOLT', count: 2, thunderbolt: 4, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD'], maxWatts: 60, minWatts: 45, pdVoltages: [20], viaUsb: true }, physical: { screenInches: 13.4 }, audio: { bluetooth: '5.2', jack35: false } },
  },
  {
    slug: 'lenovo-thinkpad-x1-carbon-gen-11', name: 'ThinkPad X1 Carbon Gen 11', fullName: 'Lenovo ThinkPad X1 Carbon Gen 11 (2023)', brand: 'Lenovo', category: 'laptops', family: 'ThinkPad X1', generation: 'Gen 11', year: 2023, modelNumber: '21HM', image: 'dev-thinkpad-x1', popularity: 420,
    aliases: ['thinkpad x1 carbon', 'тинкпад x1', 'x1 carbon gen 11', 'x1 carbon'],
    identifiers: [{ type: 'MODEL_NUMBER', value: '21HM' }],
    specs: { ecosystem: 'windows', ports: [{ type: 'THUNDERBOLT', count: 2, thunderbolt: 4, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }, { type: 'USB_A', count: 2, usbVersion: '3.2 Gen 1', dataGbps: 5 }, { type: 'HDMI', hdmiVersion: '2.0' }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 65, minWatts: 45, pdVoltages: [20], viaUsb: true }, physical: { screenInches: 14 }, audio: { bluetooth: '5.1', jack35: true } },
  },
  // ---------------- Планшеты ----------------
  {
    slug: 'apple-ipad-pro-11-m4', name: 'iPad Pro 11″ M4', fullName: 'Apple iPad Pro 11″ M4 (2024)', brand: 'Apple', category: 'tablets', family: 'iPad Pro', generation: 'M4', year: 2024, modelNumber: 'A2836', image: 'dev-ipad-pro-11-m4', popularity: 600,
    aliases: ['ipad pro 11', 'айпад про 11', 'ipad pro m4', 'ipad pro 2024'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2836' }, { type: 'MODEL_NUMBER', value: 'A2837', region: 'Cellular' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'THUNDERBOLT', thunderbolt: 4, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD'], maxWatts: 30, viaUsb: true }, physical: { caseFamily: 'ipad-pro-11-m4', screenInches: 11 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'apple-ipad-10', name: 'iPad (10-го поколения)', fullName: 'Apple iPad 10,9″ 10-го поколения (2022)', brand: 'Apple', category: 'tablets', family: 'iPad', generation: '10', year: 2022, modelNumber: 'A2696', image: 'dev-ipad-10', popularity: 650,
    aliases: ['ipad 10', 'айпад 10', 'ipad 2022', 'ipad 10th gen', 'ipad 10 поколения'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2696' }, { type: 'MODEL_NUMBER', value: 'A2757', region: 'Cellular' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'USB_C', usbVersion: '2.0', dataGbps: 0.48, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, physical: { caseFamily: 'ipad-10', screenInches: 10.9 }, audio: { bluetooth: '5.2', jack35: false } },
  },
  {
    slug: 'apple-ipad-9', name: 'iPad (9-го поколения)', fullName: 'Apple iPad 10,2″ 9-го поколения (2021)', brand: 'Apple', category: 'tablets', family: 'iPad', generation: '9', year: 2021, modelNumber: 'A2602', image: 'dev-ipad-9', popularity: 500,
    aliases: ['ipad 9', 'айпад 9', 'ipad 2021', 'ipad 9th gen'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2602' }, { type: 'MODEL_NUMBER', value: 'A2604', region: 'Cellular' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'LIGHTNING', usbVersion: '2.0', dataGbps: 0.48, pdIn: true }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, physical: { caseFamily: 'ipad-9', screenInches: 10.2 }, audio: { bluetooth: '4.2', jack35: true } },
  },
  {
    slug: 'samsung-galaxy-tab-s9', name: 'Galaxy Tab S9', fullName: 'Samsung Galaxy Tab S9 11″ (2023)', brand: 'Samsung', category: 'tablets', family: 'Galaxy Tab S', generation: 'S9', year: 2023, modelNumber: 'SM-X710', image: 'dev-galaxy-tab-s9', popularity: 450,
    aliases: ['galaxy tab s9', 'самсунг таб с9', 'tab s9'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'SM-X710' }],
    specs: { ecosystem: 'android', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 1', dataGbps: 5, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 45, viaUsb: true }, storage: { microSd: true, maxMicroSdGb: 1024 }, physical: { caseFamily: 'galaxy-tab-s9', screenInches: 11 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  // ---------------- Смарт-часы ----------------
  {
    slug: 'apple-watch-series-10', name: 'Apple Watch Series 10', fullName: 'Apple Watch Series 10 (2024)', brand: 'Apple', category: 'watches', family: 'Apple Watch', generation: 'Series 10', year: 2024, image: 'dev-apple-watch-s10', popularity: 700,
    aliases: ['apple watch series 10', 'apple watch 10', 'эпл вотч 10', 'watch series 10', 'apple watch s10'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2997', region: '42 мм GPS' }, { type: 'MODEL_NUMBER', value: 'A2999', region: '46 мм GPS' }],
    specs: { ecosystem: 'apple', ports: [], charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, wireless: { qi: false }, audio: { bluetooth: '5.3' } },
    variants: [
      { slug: '42mm', name: '42 мм', specs: { physical: { bandGroup: 'apple-small' } }, aliases: ['apple watch series 10 42', 'apple watch 10 42mm'] },
      { slug: '46mm', name: '46 мм', specs: { physical: { bandGroup: 'apple-large' } }, aliases: ['apple watch series 10 46', 'apple watch 10 46mm'] },
    ],
  },
  {
    slug: 'apple-watch-series-9', name: 'Apple Watch Series 9', fullName: 'Apple Watch Series 9 (2023)', brand: 'Apple', category: 'watches', family: 'Apple Watch', generation: 'Series 9', year: 2023, image: 'dev-apple-watch-s9', popularity: 650,
    aliases: ['apple watch series 9', 'apple watch 9', 'эпл вотч 9', 'watch series 9'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2978', region: '41 мм GPS' }, { type: 'MODEL_NUMBER', value: 'A2980', region: '45 мм GPS' }],
    specs: { ecosystem: 'apple', ports: [], charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, audio: { bluetooth: '5.3' } },
    variants: [
      { slug: '41mm', name: '41 мм', specs: { physical: { bandGroup: 'apple-small' } }, aliases: ['apple watch 9 41'] },
      { slug: '45mm', name: '45 мм', specs: { physical: { bandGroup: 'apple-large' } }, aliases: ['apple watch 9 45'] },
    ],
  },
  {
    slug: 'apple-watch-ultra-2', name: 'Apple Watch Ultra 2', fullName: 'Apple Watch Ultra 2 (2023)', brand: 'Apple', category: 'watches', family: 'Apple Watch', generation: 'Ultra 2', year: 2023, modelNumber: 'A2986', image: 'dev-apple-watch-ultra-2', popularity: 500,
    aliases: ['apple watch ultra 2', 'apple watch ultra', 'эпл вотч ультра', 'watch ultra 2'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A2986' }],
    specs: { ecosystem: 'apple', ports: [], charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, physical: { bandGroup: 'apple-large' }, audio: { bluetooth: '5.3' } },
  },
  {
    slug: 'samsung-galaxy-watch-6', name: 'Galaxy Watch6', fullName: 'Samsung Galaxy Watch6 (2023)', brand: 'Samsung', category: 'watches', family: 'Galaxy Watch', generation: '6', year: 2023, image: 'dev-galaxy-watch-6', popularity: 450,
    aliases: ['galaxy watch 6', 'галакси вотч 6', 'samsung watch 6', 'galaxy watch6'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'SM-R930', region: '40 мм' }, { type: 'MODEL_NUMBER', value: 'SM-R940', region: '44 мм' }],
    specs: { ecosystem: 'android', ports: [], charging: { protocols: ['USB_BC'], maxWatts: 10, viaUsb: true }, wireless: { qi: true, qiMaxWatts: 10 }, physical: { bandGroup: 'lug-20mm' }, audio: { bluetooth: '5.3' } },
    variants: [{ slug: '40mm', name: '40 мм' }, { slug: '44mm', name: '44 мм' }],
  },
  // ---------------- Наушники ----------------
  {
    slug: 'apple-airpods-pro-2', name: 'AirPods Pro 2 (USB-C)', fullName: 'Apple AirPods Pro 2-го поколения с USB-C (2023)', brand: 'Apple', category: 'headphones', family: 'AirPods', generation: 'Pro 2', year: 2023, modelNumber: 'A3048', image: 'dev-airpods-pro-2', popularity: 800,
    aliases: ['airpods pro 2', 'аирподс про 2', 'эйрподс про', 'airpods pro'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'A3048', region: 'кейс USB-C' }, { type: 'MODEL_NUMBER', value: 'A3047', region: 'наушник' }],
    specs: { ecosystem: 'apple', ports: [{ type: 'USB_C', usbVersion: '2.0', pdIn: true }], charging: { protocols: ['USB_BC'], maxWatts: 5, viaUsb: true }, wireless: { qi: true, magsafe: true, magsafeMaxWatts: 5, qiMaxWatts: 5 }, audio: { bluetooth: '5.3', jack35: false } },
  },
  {
    slug: 'sony-wh-1000xm5', name: 'Sony WH-1000XM5', fullName: 'Sony WH-1000XM5 (2022)', brand: 'Sony', category: 'headphones', family: 'WH-1000X', generation: 'XM5', year: 2022, modelNumber: 'WH-1000XM5', image: 'dev-sony-wh1000xm5', popularity: 600,
    aliases: ['sony wh-1000xm5', 'сони xm5', 'wh 1000 xm 5', 'xm5', 'сони 1000xm5'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'WH-1000XM5' }],
    specs: { ecosystem: 'other', ports: [{ type: 'USB_C', usbVersion: '2.0', pdIn: true }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_BC'], maxWatts: 5, viaUsb: true }, audio: { bluetooth: '5.2', jack35: true } },
  },
  {
    slug: 'bose-quietcomfort-45', name: 'Bose QuietComfort 45', fullName: 'Bose QuietComfort 45 (2021)', brand: 'Bose', category: 'headphones', family: 'QuietComfort', generation: '45', year: 2021, image: 'dev-bose-qc45', popularity: 400,
    aliases: ['bose qc45', 'bose quietcomfort 45', 'бозе qc45', 'qc 45'],
    specs: { ecosystem: 'other', ports: [{ type: 'USB_C', usbVersion: '2.0', pdIn: true }], charging: { protocols: ['USB_BC'], maxWatts: 5, viaUsb: true }, audio: { bluetooth: '5.1', jack35: false } },
  },
  // ---------------- Принтеры ----------------
  {
    slug: 'canon-pixma-g3410', name: 'Canon PIXMA G3410', fullName: 'Canon PIXMA G3410 (МФУ с СНПЧ, 2018)', brand: 'Canon', category: 'printers', family: 'PIXMA G', generation: 'G3410', year: 2018, modelNumber: 'G3410', image: 'dev-canon-g3410', popularity: 700,
    description: 'МФУ с встроенной системой непрерывной подачи чернил. Российская/европейская модификация использует чернила GI-490.',
    aliases: ['canon pixma g3410', 'кэнон g3410', 'canon g3410', 'pixma g3410', 'g3410', 'canon pixma g 3410'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'G3410', region: 'RU/EU' }, { type: 'MARKETING_CODE', value: '2315C009' }],
    specs: { ecosystem: 'printer', region: 'RU/EU', ports: [{ type: 'USB_B', usbVersion: '2.0' }], consumables: { inkBottles: ['GI-490BK', 'GI-490C', 'GI-490M', 'GI-490Y'], regionNote: 'В Азии — GI-790, в Латинской Америке — GI-190' } },
  },
  {
    slug: 'canon-pixma-g3420', name: 'Canon PIXMA G3420', fullName: 'Canon PIXMA G3420 (МФУ с СНПЧ, 2020)', brand: 'Canon', category: 'printers', family: 'PIXMA G', generation: 'G3420', year: 2020, modelNumber: 'G3420', image: 'dev-canon-g3410', popularity: 600,
    aliases: ['canon pixma g3420', 'кэнон g3420', 'canon g3420', 'g3420'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'G3420', region: 'RU/EU' }, { type: 'MARKETING_CODE', value: '4467C009' }],
    specs: { ecosystem: 'printer', region: 'RU/EU', ports: [{ type: 'USB_B', usbVersion: '2.0' }], consumables: { inkBottles: ['GI-41BK', 'GI-41C', 'GI-41M', 'GI-41Y'] } },
  },
  {
    slug: 'canon-pixma-ts3340', name: 'Canon PIXMA TS3340', fullName: 'Canon PIXMA TS3340 (2019)', brand: 'Canon', category: 'printers', family: 'PIXMA TS', generation: 'TS3340', year: 2019, modelNumber: 'TS3340', image: 'dev-canon-ts3340', popularity: 450,
    aliases: ['canon pixma ts3340', 'canon ts3340', 'ts3340', 'кэнон ts3340'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'TS3340', region: 'RU/EU' }],
    specs: { ecosystem: 'printer', region: 'RU/EU', ports: [{ type: 'USB_B', usbVersion: '2.0' }], consumables: { cartridges: ['PG-445', 'CL-446', 'PG-445XL', 'CL-446XL'], regionNote: 'В США — PG-245/CL-246' } },
  },
  {
    slug: 'epson-l3250', name: 'Epson L3250', fullName: 'Epson EcoTank L3250 (2021)', brand: 'Epson', category: 'printers', family: 'EcoTank L', generation: 'L3250', year: 2021, modelNumber: 'L3250', image: 'dev-epson-l3250', popularity: 650,
    aliases: ['epson l3250', 'эпсон l3250', 'l3250', 'epson ecotank l3250'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'C11CJ67405' }],
    specs: { ecosystem: 'printer', region: 'RU/CIS', ports: [{ type: 'USB_B', usbVersion: '2.0' }], consumables: { inkBottles: ['103BK', '103C', '103M', '103Y'], regionNote: 'В Европе — чернила 104' } },
  },
  {
    slug: 'hp-laserjet-m111w', name: 'HP LaserJet M111w', fullName: 'HP LaserJet M111w (2021)', brand: 'HP', category: 'printers', family: 'LaserJet', generation: 'M111w', year: 2021, modelNumber: '7MD68A', image: 'dev-hp-m111w', popularity: 500,
    aliases: ['hp laserjet m111w', 'hp m111w', 'laserjet m111', 'm111w'],
    identifiers: [{ type: 'MODEL_NUMBER', value: '7MD68A' }],
    specs: { ecosystem: 'printer', ports: [{ type: 'USB_B', usbVersion: '2.0' }], consumables: { toners: ['W1500A', '150A'] } },
  },
  {
    slug: 'brother-hl-l2340dw', name: 'Brother HL-L2340DW', fullName: 'Brother HL-L2340DW (2014)', brand: 'Brother', category: 'printers', family: 'HL-L2', generation: 'L2340DW', year: 2014, modelNumber: 'HL-L2340DW', image: 'dev-brother-hl-l2340', popularity: 350,
    aliases: ['brother hl-l2340dw', 'brother l2340', 'hl l2340dw', 'бразер l2340'],
    specs: { ecosystem: 'printer', region: 'RU/CIS', ports: [{ type: 'USB_B', usbVersion: '2.0' }], consumables: { toners: ['TN-2375', 'TN-2335'], drums: ['DR-2335'], regionNote: 'В Европе — TN-2320' } },
  },
  // ---------------- Мониторы ----------------
  {
    slug: 'dell-u2723qe', name: 'Dell UltraSharp U2723QE', fullName: 'Dell UltraSharp U2723QE 27″ 4K (2022)', brand: 'Dell', category: 'monitors', family: 'UltraSharp', generation: 'U2723QE', year: 2022, modelNumber: 'U2723QE', image: 'dev-dell-u2723qe', popularity: 400,
    aliases: ['dell u2723qe', 'dell ultrasharp 27', 'u2723qe', 'делл u2723qe'],
    specs: { ecosystem: 'other', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: true, pdOut: true }, { type: 'HDMI', hdmiVersion: '2.0' }, { type: 'DISPLAYPORT' }, { type: 'USB_A', count: 4, usbVersion: '3.2 Gen 2' }, { type: 'ETHERNET' }], physical: { vesa: ['100x100'], screenInches: 27, weightGrams: 6600 } },
  },
  {
    slug: 'lg-27gp850-b', name: 'LG UltraGear 27GP850-B', fullName: 'LG UltraGear 27GP850-B 27″ QHD 165 Гц (2021)', brand: 'LG', category: 'monitors', family: 'UltraGear', generation: '27GP850', year: 2021, modelNumber: '27GP850-B', image: 'dev-lg-27gp850', popularity: 380,
    aliases: ['lg 27gp850', 'lg ultragear 27', '27gp850', 'лджи 27gp850'],
    specs: { ecosystem: 'other', ports: [{ type: 'HDMI', count: 2, hdmiVersion: '2.0' }, { type: 'DISPLAYPORT' }, { type: 'USB_A', count: 2, usbVersion: '3.0' }, { type: 'JACK_3_5' }], physical: { vesa: ['100x100'], screenInches: 27, weightGrams: 6300 } },
  },
  // ---------------- Игровые устройства ----------------
  {
    slug: 'sony-playstation-5', name: 'PlayStation 5', fullName: 'Sony PlayStation 5 (2020)', brand: 'Sony', category: 'gaming', family: 'PlayStation', generation: '5', year: 2020, modelNumber: 'CFI-1208A', image: 'dev-ps5', popularity: 900,
    aliases: ['playstation 5', 'ps5', 'пс5', 'плейстейшн 5', 'плойка 5', 'sony ps5', 'ps 5'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'CFI-1208A' }, { type: 'MODEL_NUMBER', value: 'CFI-2016A', region: 'Slim' }],
    specs: { ecosystem: 'playstation', ports: [{ type: 'USB_A', count: 3, usbVersion: '3.2 Gen 2', dataGbps: 10 }, { type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: false }, { type: 'HDMI', hdmiVersion: '2.1' }, { type: 'ETHERNET' }], audio: { bluetooth: '5.1' } },
  },
  {
    slug: 'microsoft-xbox-series-x', name: 'Xbox Series X', fullName: 'Microsoft Xbox Series X (2020)', brand: 'Microsoft', category: 'gaming', family: 'Xbox', generation: 'Series X', year: 2020, modelNumber: '1882', image: 'dev-xbox-series-x', popularity: 600,
    aliases: ['xbox series x', 'иксбокс series x', 'хбокс x', 'series x', 'xbox x'],
    identifiers: [{ type: 'MODEL_NUMBER', value: '1882' }],
    specs: { ecosystem: 'xbox', ports: [{ type: 'USB_A', count: 3, usbVersion: '3.1', dataGbps: 10 }, { type: 'HDMI', hdmiVersion: '2.1' }, { type: 'ETHERNET' }], audio: { bluetooth: undefined } },
  },
  {
    slug: 'nintendo-switch-oled', name: 'Nintendo Switch OLED', fullName: 'Nintendo Switch OLED (2021)', brand: 'Nintendo', category: 'gaming', family: 'Switch', generation: 'OLED', year: 2021, modelNumber: 'HEG-001', image: 'dev-switch-oled', popularity: 700,
    aliases: ['nintendo switch oled', 'свитч олед', 'switch oled', 'нинтендо свитч', 'switch'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'HEG-001' }],
    specs: { ecosystem: 'nintendo', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 1', dataGbps: 5, dpAltMode: false, pdIn: true }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 39, pdVoltages: [15], viaUsb: true }, storage: { microSd: true, maxMicroSdGb: 2048 }, physical: { screenInches: 7 }, audio: { bluetooth: '4.1', jack35: true } },
  },
  {
    slug: 'valve-steam-deck-oled', name: 'Steam Deck OLED', fullName: 'Valve Steam Deck OLED (2023)', brand: 'Valve', category: 'gaming', family: 'Steam Deck', generation: 'OLED', year: 2023, modelNumber: '1030', image: 'dev-steam-deck', popularity: 500,
    aliases: ['steam deck oled', 'стим дек', 'steam deck', 'steamdeck'],
    identifiers: [{ type: 'MODEL_NUMBER', value: '1030' }],
    specs: { ecosystem: 'steam', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: true, pdIn: true }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 45, pdVoltages: [15], viaUsb: true }, storage: { microSd: true, maxMicroSdGb: 2048 }, physical: { screenInches: 7.4 }, audio: { bluetooth: '5.3', jack35: true } },
  },
  // ---------------- Камеры ----------------
  {
    slug: 'canon-eos-r50', name: 'Canon EOS R50', fullName: 'Canon EOS R50 (2023)', brand: 'Canon', category: 'cameras', family: 'EOS R', generation: 'R50', year: 2023, modelNumber: 'EOS R50', image: 'dev-canon-r50', popularity: 450, demo: true,
    aliases: ['canon eos r50', 'кэнон r50', 'eos r50', 'r50'],
    specs: { ecosystem: 'camera', ports: [{ type: 'USB_C', usbVersion: '2.0', pdIn: true }, { type: 'SD' }], charging: { protocols: ['USB_PD'], maxWatts: 15, viaUsb: true }, consumables: { batteries: ['LP-E17'] }, audio: { bluetooth: '4.2' } },
  },
  {
    slug: 'sony-alpha-7-iv', name: 'Sony Alpha 7 IV', fullName: 'Sony Alpha 7 IV (ILCE-7M4, 2021)', brand: 'Sony', category: 'cameras', family: 'Alpha 7', generation: 'IV', year: 2021, modelNumber: 'ILCE-7M4', image: 'dev-sony-a7iv', popularity: 400,
    aliases: ['sony a7 iv', 'sony a7iv', 'сони а7 4', 'a7 iv', 'alpha 7 iv', 'ilce-7m4'],
    identifiers: [{ type: 'MODEL_NUMBER', value: 'ILCE-7M4' }],
    specs: { ecosystem: 'camera', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, pdIn: true }, { type: 'HDMI', hdmiVersion: '2.0' }, { type: 'SD', count: 2 }, { type: 'JACK_3_5' }], charging: { protocols: ['USB_PD'], maxWatts: 27, viaUsb: true }, consumables: { batteries: ['NP-FZ100'] }, audio: { bluetooth: '4.2' } },
  },
  {
    slug: 'gopro-hero-12', name: 'GoPro HERO12 Black', fullName: 'GoPro HERO12 Black (2023)', brand: 'GoPro', category: 'cameras', family: 'HERO', generation: '12', year: 2023, image: 'dev-gopro-12', popularity: 420, demo: true,
    aliases: ['gopro hero 12', 'гопро 12', 'hero12', 'gopro 12'],
    specs: { ecosystem: 'camera', ports: [{ type: 'USB_C', usbVersion: '2.0', pdIn: true }], charging: { protocols: ['USB_BC'], maxWatts: 10, viaUsb: true }, storage: { microSd: true, maxMicroSdGb: 512 }, consumables: { batteries: ['Enduro'] }, audio: { bluetooth: '5.0' } },
  },
  {
    slug: '70mai-dash-cam-a800s', name: '70mai Dash Cam A800S', fullName: '70mai Dash Cam 4K A800S (2021)', brand: '70mai', category: 'cameras', family: 'Dash Cam', generation: 'A800S', year: 2021, image: 'dev-70mai-a800s', popularity: 300, demo: true,
    aliases: ['70mai a800s', '70mai dash cam', 'видеорегистратор 70mai', 'a800s'],
    specs: { ecosystem: 'camera', ports: [{ type: 'MICRO_USB', usbVersion: '2.0', pdIn: true }], charging: { protocols: ['USB_BC'], maxWatts: 10, viaUsb: true }, storage: { microSd: true, maxMicroSdGb: 128 } },
  },
  // ---------------- Автомобили ----------------
  {
    slug: 'tesla-model-3-2024', name: 'Tesla Model 3 (2024)', fullName: 'Tesla Model 3 Highland (2024)', brand: 'Tesla', category: 'cars', family: 'Model 3', generation: 'Highland', year: 2024, image: 'dev-tesla-model-3', popularity: 300, demo: true,
    aliases: ['tesla model 3', 'тесла модел 3', 'тесла 3', 'model 3'],
    specs: { ecosystem: 'car', ports: [{ type: 'USB_C', count: 4, usbVersion: '2.0', pdOut: true }, { type: 'SOCKET_12V' }], wireless: { qi: true, qiMaxWatts: 15 } },
  },
  {
    slug: 'generic-car-12v-usb', name: 'Автомобиль с гнездом 12 В', fullName: 'Любой автомобиль с гнездом прикуривателя 12 В', brand: 'Универсальные', category: 'cars', image: 'dev-car-12v', popularity: 350,
    description: 'Универсальный профиль для подбора автомобильных зарядок, держателей и адаптеров под стандартное гнездо 12 В.',
    aliases: ['автомобиль', 'машина', 'авто', 'прикуриватель', 'car', 'автомобиль 12v'],
    specs: { ecosystem: 'car', ports: [{ type: 'SOCKET_12V' }, { type: 'USB_A', usbVersion: '2.0' }] },
  },
];
