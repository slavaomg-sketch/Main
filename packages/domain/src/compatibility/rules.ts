import type {
  CompatibilityRule,
  ConnectorType,
  DeviceSpecProfile,
  ProductSpecProfile,
  RuleOutcome,
  RuleVerdict,
  ConstraintSpec,
} from './types';

const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  USB_C: 'USB-C',
  USB_A: 'USB-A',
  LIGHTNING: 'Lightning',
  MICRO_USB: 'Micro-USB',
  USB_B: 'USB-B',
  HDMI: 'HDMI',
  DISPLAYPORT: 'DisplayPort',
  MINI_DISPLAYPORT: 'Mini DisplayPort',
  THUNDERBOLT: 'Thunderbolt',
  MAGSAFE_3: 'MagSafe 3',
  JACK_3_5: 'мини-джек 3,5 мм',
  DC_BARREL: 'круглый разъём питания',
  SD: 'SD',
  MICRO_SD: 'microSD',
  ETHERNET: 'Ethernet',
  SOCKET_12V: 'гнездо прикуривателя 12 В',
  PROPRIETARY: 'фирменный разъём',
};

export const connectorLabel = (c: ConnectorType): string => CONNECTOR_LABEL[c] ?? c;

function outcome(
  ruleCode: string,
  verdict: RuleVerdict,
  confidence: number,
  reasons: string[] = [],
  limitations: string[] = [],
  constraints: ConstraintSpec[] = [],
): RuleOutcome {
  return { ruleCode, verdict, confidence, reasons, limitations, constraints };
}

const notApplicable = (code: string) => outcome(code, 'NOT_APPLICABLE', 0);

function hasPort(device: DeviceSpecProfile, type: ConnectorType) {
  return device.ports.some((p) => p.type === type);
}

function findPort(device: DeviceSpecProfile, type: ConnectorType) {
  return device.ports.find((p) => p.type === type);
}

/** USB-C и Thunderbolt физически совместимы (Thunderbolt 3/4 используют разъём USB-C). */
function usbCLike(type: ConnectorType) {
  return type === 'USB_C' || type === 'THUNDERBOLT';
}

function deviceHasUsbC(device: DeviceSpecProfile) {
  return device.ports.some((p) => usbCLike(p.type));
}

function connectorMatches(deviceType: ConnectorType, productType: ConnectorType) {
  if (deviceType === productType) return true;
  return usbCLike(deviceType) && usbCLike(productType);
}

const DATA_SPEED_LABEL = (gbps?: number, version?: string) =>
  gbps ? `${gbps >= 1 ? `${gbps} Гбит/с` : `${Math.round(gbps * 1000)} Мбит/с`}` : version ? `USB ${version}` : 'неизвестно';

function usbGbps(version?: string, gbps?: number): number | undefined {
  if (gbps) return gbps;
  if (!version) return undefined;
  const v = version.toLowerCase();
  if (v.includes('usb4') || v.includes('4')) return 40;
  if (v.includes('3.2 gen 2x2')) return 20;
  if (v.includes('gen 2')) return 10;
  if (v.includes('3')) return 5;
  if (v.includes('2')) return 0.48;
  return undefined;
}

// ------------------------------------------------------------------
// 1. Совпадение разъёмов (кабели, переходники, хабы, док-станции, накопители)
// ------------------------------------------------------------------
export const connectorMatchRule: CompatibilityRule = {
  code: 'CONNECTOR_MATCH',
  name: 'Совпадение разъёмов',
  description: 'Товар должен подключаться к одному из портов устройства.',
  priority: 10,
  appliesTo: (p) =>
    ['CABLE', 'ADAPTER', 'HUB', 'DOCK', 'VIDEO_CABLE', 'STORAGE', 'KEYBOARD_MOUSE', 'HEADPHONES', 'PERIPHERAL', 'CAR_CHARGER', 'CAR_MOUNT'].includes(p.kind) &&
    Boolean(p.connectorA || p.connectorB || p.requiresPort),
  evaluate(device, product) {
    const code = 'CONNECTOR_MATCH';
    // Автомобильные товары: разъём проверяется только со стороны автомобиля
    if (product.kind === 'CAR_CHARGER' || product.kind === 'CAR_MOUNT') {
      if (device.categorySlug !== 'cars') return notApplicable(code);
      const need = product.requiresPort ?? 'SOCKET_12V';
      if (hasPort(device, need)) return outcome(code, 'PASS', 0.9, [`В автомобиле есть ${connectorLabel(need)}`]);
      return outcome(code, 'FAIL', 0.9, [`В автомобиле нет разъёма ${connectorLabel(need)}`]);
    }
    const candidates: ConnectorType[] = [];
    if (product.requiresPort) candidates.push(product.requiresPort);
    else {
      if (product.connectorA) candidates.push(product.connectorA);
      if (product.connectorB) candidates.push(product.connectorB);
    }
    if (candidates.length === 0) return notApplicable(code);
    if (device.ports.length === 0) {
      return outcome(code, 'UNKNOWN', 0, ['Для устройства не указаны разъёмы']);
    }
    const matched = candidates.find((c) => device.ports.some((p) => connectorMatches(p.type, c)));
    if (matched) {
      return outcome(code, 'PASS', 0.85, [
        `Подключается к порту ${connectorLabel(matched)} устройства`,
      ]);
    }
    // Особый случай: кабель USB-A ↔ USB-C и устройство с USB-C: конец USB-A идёт в зарядку/компьютер
    if (product.kind === 'CABLE' && candidates.includes('USB_A') && candidates.length === 2) {
      const other = candidates.find((c) => c !== 'USB_A');
      if (other && device.ports.some((p) => connectorMatches(p.type, other))) {
        return outcome(code, 'PASS', 0.85, [`Подключается к порту ${connectorLabel(other)} устройства`]);
      }
    }
    // Периферия и накопители с USB-A на устройстве только с USB-C: работает через переходник
    if (['STORAGE', 'PERIPHERAL', 'KEYBOARD_MOUSE', 'HEADPHONES'].includes(product.kind) && candidates.includes('USB_A') && deviceHasUsbC(device)) {
      return outcome(code, 'LIMITED', 0.85, ['У устройства нет порта USB-A'], ['Понадобится переходник USB-C → USB-A'], [
        { kind: 'REQUIRES_ADAPTER', description: 'Переходник USB-C → USB-A' },
      ]);
    }
    const devicePorts = Array.from(new Set(device.ports.map((p) => connectorLabel(p.type)))).join(', ');
    return outcome(code, 'FAIL', 0.9, [
      `Разъёмы товара (${candidates.map(connectorLabel).join(' / ')}) не совпадают с портами устройства (${devicePorts})`,
    ]);
  },
};

// ------------------------------------------------------------------
// 2. Мощность и протоколы зарядки
// ------------------------------------------------------------------
export const powerDeliveryRule: CompatibilityRule = {
  code: 'POWER_DELIVERY',
  name: 'Мощность и протокол зарядки',
  description: 'Проверяет USB PD / PPS / QC, мощность в ваттах и профили напряжения.',
  priority: 20,
  appliesTo: (p) => ['CHARGER', 'CAR_CHARGER', 'POWER_BANK', 'CABLE', 'DOCK', 'HUB'].includes(p.kind),
  evaluate(device, product) {
    const code = 'POWER_DELIVERY';
    if (device.categorySlug === 'cars') return notApplicable(code);
    const charging = device.charging;
    const isLaptop = device.categorySlug === 'laptops';
    const productWatts = product.powerWatts ?? product.outputs?.reduce((m, o) => Math.max(m, o.maxWatts ?? 0), 0);

    // --- Кабели: интересует только номинальная мощность и, для ноутбуков, наличие PD-маркировки
    if (product.kind === 'CABLE') {
      if (!charging?.viaUsb) return notApplicable(code);
      if (product.chargeOnly && product.cableRatedWatts === undefined) return notApplicable(code);
      const rated = product.cableRatedWatts;
      if (rated === undefined || !charging.maxWatts) return notApplicable(code);
      if (rated >= charging.maxWatts) {
        return outcome(code, 'PASS', 0.85, [`Кабель рассчитан на ${rated} Вт — достаточно для зарядки ${charging.maxWatts} Вт`]);
      }
      if (isLaptop && rated < (charging.minWatts ?? 30)) {
        return outcome(code, 'LIMITED', 0.85, [`Кабель рассчитан на ${rated} Вт`], [
          `Зарядка будет ограничена ${rated} Вт — медленнее максимальных ${charging.maxWatts} Вт`,
        ], [{ kind: 'REDUCED_POWER', description: `Мощность ограничена ${rated} Вт`, params: { maxWatts: rated } }]);
      }
      return outcome(code, 'LIMITED', 0.8, [`Кабель рассчитан на ${rated} Вт`], [
        `Зарядка будет медленнее максимальной: ${rated} Вт вместо ${charging.maxWatts} Вт`,
      ], [{ kind: 'REDUCED_POWER', description: `Мощность ограничена ${rated} Вт`, params: { maxWatts: rated } }]);
    }

    // --- Хабы/доки: проверяем только сквозное питание (passthrough)
    if (product.kind === 'HUB' || product.kind === 'DOCK') {
      if (!charging?.viaUsb || productWatts === undefined) return notApplicable(code);
      if (isLaptop && charging.minWatts && productWatts < charging.minWatts) {
        return outcome(code, 'LIMITED', 0.8, [`Сквозное питание ${productWatts} Вт`], [
          `Сквозной зарядки ${productWatts} Вт не хватит для полноценной зарядки ноутбука (нужно от ${charging.minWatts} Вт)`,
        ], [{ kind: 'REDUCED_POWER', description: `Сквозное питание ограничено ${productWatts} Вт` }]);
      }
      return outcome(code, 'PASS', 0.8, [`Сквозное питание до ${productWatts} Вт подходит устройству`]);
    }

    // --- Зарядные устройства, автозарядки, повербанки
    if (!charging || !charging.viaUsb) {
      return outcome(code, 'FAIL', 0.9, ['Устройство не заряжается от USB-зарядного устройства']);
    }
    const outputs = product.outputs ?? [];
    const protocols = new Set<string>([...(product.protocols ?? []), ...outputs.flatMap((o) => o.protocols ?? [])]);
    const deviceProtocols = new Set<string>(charging.protocols);
    const hasUsbC = outputs.some((o) => o.type === 'USB_C') || product.connectorA === 'USB_C';
    const onlyUsbA = outputs.length > 0 && outputs.every((o) => o.type === 'USB_A');
    const devMax = charging.maxWatts ?? 0;
    const reasons: string[] = [];
    const limitations: string[] = [];
    const constraints: ConstraintSpec[] = [];
    let verdict: RuleVerdict = 'PASS';
    let confidence = 0.85;

    // Ноутбуки требуют USB PD и достаточной мощности
    if (deviceProtocols.has('USB_PD') && !protocols.has('USB_PD')) {
      if (isLaptop) {
        return outcome(code, 'FAIL', 0.9, ['Ноутбуку требуется зарядка с поддержкой USB Power Delivery, у товара её нет']);
      }
      verdict = 'LIMITED';
      limitations.push('Без USB Power Delivery зарядка пойдёт на базовой скорости (5 В)');
      constraints.push({ kind: 'REDUCED_POWER', description: 'Нет поддержки USB PD', params: { maxWatts: 12 } });
    }

    if (isLaptop && productWatts !== undefined) {
      const minW = charging.minWatts ?? 30;
      if (productWatts < 18) {
        return outcome(code, 'FAIL', 0.9, [`Мощность ${productWatts} Вт слишком мала для ноутбука (нужно от ${minW} Вт)`]);
      }
      if (productWatts < minW) {
        verdict = 'LIMITED';
        reasons.push(`Мощность ${productWatts} Вт`);
        limitations.push(`Для уверенной зарядки ноутбука нужно от ${minW} Вт: при ${productWatts} Вт зарядка будет медленной, под нагрузкой батарея может разряжаться`);
        constraints.push({ kind: 'REDUCED_POWER', description: `Мощность ниже рекомендуемой ${minW} Вт`, params: { maxWatts: productWatts } });
      } else if (productWatts < devMax) {
        verdict = 'LIMITED';
        reasons.push(`Мощность ${productWatts} Вт (устройство поддерживает до ${devMax} Вт)`);
        limitations.push(`Зарядка будет медленнее максимальной: ${productWatts} Вт вместо ${devMax} Вт`);
        constraints.push({ kind: 'REDUCED_POWER', description: `Мощность ниже максимальной ${devMax} Вт`, params: { maxWatts: productWatts } });
      } else {
        reasons.push(`Мощность ${productWatts} Вт покрывает потребность устройства (${devMax} Вт)`);
      }
    } else if (productWatts !== undefined && devMax > 0) {
      // Смартфоны, планшеты, часы, наушники
      const basicOnly = !deviceProtocols.has('USB_PD') && !deviceProtocols.has('PPS') && !deviceProtocols.has('QC3') && !deviceProtocols.has('QC4');
      if (basicOnly) {
        if (productWatts >= devMax) reasons.push(`Устройство заряжается стандартным USB-питанием (до ${devMax} Вт) — мощности ${productWatts} Вт достаточно`);
        else {
          verdict = 'LIMITED';
          limitations.push(`Мощность ${productWatts} Вт ниже потребляемых устройством ${devMax} Вт`);
        }
      } else if (onlyUsbA && !protocols.has('QC3') && !protocols.has('QC4')) {
        verdict = 'LIMITED';
        reasons.push(`Только порт USB-A, ${productWatts} Вт`);
        limitations.push('Через USB-A без Quick Charge устройство будет заряжаться на базовой скорости (до 12 Вт)');
        constraints.push({ kind: 'REDUCED_POWER', description: 'USB-A без быстрой зарядки', params: { maxWatts: 12 } });
      } else if (deviceProtocols.has('PPS') && !protocols.has('PPS') && devMax > 25) {
        verdict = 'LIMITED';
        reasons.push(`USB PD, ${productWatts} Вт, без PPS`);
        limitations.push(`Без PPS устройство ограничит скорость: сверхбыстрая зарядка ${devMax} Вт недоступна, будет до 25 Вт`);
        constraints.push({ kind: 'REDUCED_POWER', description: 'Нет PPS', params: { maxWatts: 25 } });
      } else if (productWatts < devMax * 0.75) {
        verdict = 'LIMITED';
        reasons.push(`Мощность ${productWatts} Вт (устройство поддерживает до ${devMax} Вт)`);
        limitations.push(`Зарядка будет медленнее максимальной: ${productWatts} Вт вместо ${devMax} Вт`);
        constraints.push({ kind: 'REDUCED_POWER', description: 'Мощность ниже максимальной', params: { maxWatts: productWatts } });
      } else if (verdict === 'PASS') {
        reasons.push(`Мощность ${productWatts} Вт обеспечивает полную скорость зарядки (${devMax} Вт)`);
        if (protocols.has('PPS') && deviceProtocols.has('PPS')) reasons.push('Поддерживается PPS — сверхбыстрая зарядка');
        if (protocols.has('USB_PD') && deviceProtocols.has('USB_PD')) reasons.push('Поддерживается USB Power Delivery');
      }
    } else if (verdict === 'PASS') {
      reasons.push('Стандарт зарядки совпадает');
      confidence = 0.7;
    }

    // Профили напряжения USB PD (ноутбуки 20 В, Nintendo Switch 15 В и т.п.)
    if (charging.pdVoltages?.length && product.pdVoltages?.length && protocols.has('USB_PD')) {
      const missing = charging.pdVoltages.filter((v) => !product.pdVoltages!.includes(v));
      if (missing.length) {
        if (verdict === 'PASS') verdict = 'LIMITED';
        limitations.push(`Зарядка не поддерживает профиль ${missing.join(' / ')} В, необходимый устройству для полной мощности`);
        constraints.push({ kind: 'REDUCED_POWER', description: `Нет профиля ${missing.join('/')} В` });
      }
    }
    // Разъём зарядки и кабель
    const devicePortForCharge = device.ports.find((p) => p.pdIn || ['USB_C', 'LIGHTNING', 'MICRO_USB'].includes(p.type));
    if (devicePortForCharge && !product.connectorA && !product.connectorB) {
      const cableNote = hasUsbC
        ? `Понадобится кабель ${devicePortForCharge.type === 'USB_C' || devicePortForCharge.type === 'THUNDERBOLT' ? 'USB-C — USB-C' : `USB-C — ${connectorLabel(devicePortForCharge.type)}`}`
        : `Понадобится кабель USB-A — ${connectorLabel(devicePortForCharge.type)}`;
      constraints.push({ kind: 'REQUIRES_PRODUCT', description: cableNote, params: { connector: devicePortForCharge.type } });
    }
    return outcome(code, verdict, confidence, reasons, limitations, constraints);
  },
};

// ------------------------------------------------------------------
// 3. Беспроводная зарядка (Qi / Qi2 / MagSafe)
// ------------------------------------------------------------------
export const wirelessChargingRule: CompatibilityRule = {
  code: 'WIRELESS_CHARGING',
  name: 'Беспроводная зарядка',
  description: 'Qi, Qi2 и MagSafe: наличие стандарта у устройства и итоговая мощность.',
  priority: 20,
  appliesTo: (p) => p.kind === 'WIRELESS_CHARGER' || Boolean(p.wireless) || (p.kind === 'CAR_MOUNT' && Boolean(p.wirelessCharging)),
  evaluate(device, product) {
    const code = 'WIRELESS_CHARGING';
    const w = device.wireless;
    const pw = product.wireless ?? {};
    if (!w || (!w.qi && !w.qi2 && !w.magsafe)) {
      return outcome(code, 'FAIL', 0.9, ['Устройство не поддерживает беспроводную зарядку']);
    }
    const watts = pw.watts;
    if (pw.magsafe && w.magsafe) {
      const max = w.magsafeMaxWatts ?? 15;
      const eff = watts ? Math.min(watts, max) : max;
      return outcome(code, 'PASS', 0.9, [`Поддерживается MagSafe — магнитное крепление и зарядка до ${eff} Вт`]);
    }
    if (pw.qi2 && (w.qi2 || w.magsafe)) {
      return outcome(code, 'PASS', 0.9, [`Стандарт Qi2 с магнитным креплением, до ${Math.min(watts ?? 15, w.magsafeMaxWatts ?? 15)} Вт`]);
    }
    if ((pw.magsafe || pw.qi2) && w.qi && !w.magsafe && !w.qi2) {
      const eff = Math.min(watts ?? 15, w.qiMaxWatts ?? 7.5);
      return outcome(code, 'LIMITED', 0.85, ['Устройство поддерживает только Qi без магнитов'], [
        `Магнитное крепление работать не будет, зарядка по Qi до ${eff} Вт`,
      ], [{ kind: 'REDUCED_POWER', description: `Qi без магнитов, до ${eff} Вт`, params: { maxWatts: eff } }]);
    }
    if (pw.qi || pw.qi2 || pw.magsafe) {
      const eff = Math.min(watts ?? 10, w.qiMaxWatts ?? 10);
      if (watts && w.qiMaxWatts && watts > w.qiMaxWatts) {
        return outcome(code, 'PASS', 0.85, [`Стандарт Qi поддерживается, устройство ограничит мощность до ${eff} Вт`]);
      }
      return outcome(code, 'PASS', 0.85, [`Стандарт Qi поддерживается, зарядка до ${eff} Вт`]);
    }
    return outcome(code, 'UNKNOWN', 0, ['Для товара не указан стандарт беспроводной зарядки']);
  },
};

// ------------------------------------------------------------------
// 4. Расходные материалы (картриджи, чернила, тонер, батареи камер)
// ------------------------------------------------------------------
export const consumableMatchRule: CompatibilityRule = {
  code: 'CONSUMABLE_MATCH',
  name: 'Совпадение расходника',
  description: 'Код картриджа / чернил / батареи должен входить в список поддерживаемых устройством.',
  priority: 5,
  appliesTo: (p) => p.kind === 'CONSUMABLE' || p.kind === 'BATTERY',
  evaluate(device, product) {
    const code = 'CONSUMABLE_MATCH';
    const codes = (product.consumableCodes ?? []).map((c) => c.toUpperCase());
    if (codes.length === 0) return outcome(code, 'UNKNOWN', 0, ['Для товара не указан код расходника']);
    const cons = device.consumables;
    if (!cons) {
      return outcome(code, 'FAIL', 0.9, ['Устройство не использует расходные материалы этого типа']);
    }
    const type = product.consumableType;
    const pools: string[] = type ? (cons[type] ?? []) : [
      ...(cons.cartridges ?? []),
      ...(cons.inkBottles ?? []),
      ...(cons.toners ?? []),
      ...(cons.drums ?? []),
      ...(cons.batteries ?? []),
    ];
    const poolUpper = pools.map((c) => c.toUpperCase());
    const hit = codes.find((c) => poolUpper.includes(c));
    if (hit) {
      const reasons = [`Код ${hit} входит в список расходников устройства`];
      if (product.region && device.region && product.region !== device.region) {
        return outcome(code, 'LIMITED', 0.8, reasons, [
          `Расходник для региона ${product.region}, устройство — ${device.region}: проверьте региональную модификацию`,
        ], [{ kind: 'REGION_SPECIFIC', description: `Регион ${product.region}` }]);
      }
      return outcome(code, 'PASS', 0.95, reasons);
    }
    if (poolUpper.length === 0) {
      const anyOther = Object.entries(cons).some(([k, v]) => k !== type && Array.isArray(v) && v.length > 0);
      if (anyOther && type) {
        const typeLabel: Record<string, string> = { cartridges: 'картриджи', inkBottles: 'чернила во флаконах', toners: 'тонер-картриджи', drums: 'фотобарабаны', batteries: 'аккумуляторы' };
        return outcome(code, 'FAIL', 0.9, [`Устройство не использует ${typeLabel[type] ?? type}`]);
      }
      return outcome(code, 'UNKNOWN', 0, ['Для устройства не указаны расходники этого типа']);
    }
    return outcome(code, 'FAIL', 0.95, [
      `Устройство использует ${poolUpper.join(', ')}, а товар — ${codes.join(', ')}`,
    ]);
  },
};

// ------------------------------------------------------------------
// 5. Явный список моделей (чехлы, стёкла, накладки)
// ------------------------------------------------------------------
export const fitModelListRule: CompatibilityRule = {
  code: 'FIT_MODEL_LIST',
  name: 'Список подходящих моделей',
  description: 'Товар сделан под конкретные модели или семейство корпусов.',
  priority: 5,
  appliesTo: (p) => Boolean(p.fitsModels?.length || p.fitsCaseFamilies?.length),
  evaluate(device, product) {
    const code = 'FIT_MODEL_LIST';
    if (product.fitsModels?.includes(device.slug)) {
      return outcome(code, 'PASS', 0.98, [`Изготовлен специально для ${device.name}`]);
    }
    if (product.fitsCaseFamilies?.length && device.physical?.caseFamily) {
      if (product.fitsCaseFamilies.includes(device.physical.caseFamily)) {
        return outcome(code, 'PASS', 0.9, [`Подходит по форм-фактору корпуса (${device.name})`]);
      }
    }
    if (['CASE', 'SCREEN_PROTECTOR'].includes(product.kind)) {
      return outcome(code, 'FAIL', 0.95, [`Сделан под другие модели, размеры и вырезы ${device.name} не совпадут`]);
    }
    return outcome(code, 'FAIL', 0.85, [`Модель ${device.name} отсутствует в списке поддерживаемых`]);
  },
};

// ------------------------------------------------------------------
// 6. Видеовыход: DP Alt Mode, Thunderbolt, HDMI-версия
// ------------------------------------------------------------------
export const displayOutputRule: CompatibilityRule = {
  code: 'DISPLAY_OUTPUT',
  name: 'Видеовыход',
  description: 'Для хабов, док-станций и видеокабелей проверяет DisplayPort Alt Mode, Thunderbolt и версию HDMI.',
  priority: 30,
  appliesTo: (p) => ['HUB', 'DOCK', 'VIDEO_CABLE', 'ADAPTER'].includes(p.kind) && Boolean(p.hdmiOut || p.thunderbolt || p.hdmiVersion || p.dpAltMode),
  evaluate(device, product) {
    const code = 'DISPLAY_OUTPUT';
    // Видеокабель HDMI-HDMI: сравниваем версии
    if (product.kind === 'VIDEO_CABLE') {
      const hdmi = findPort(device, 'HDMI');
      const dp = findPort(device, 'DISPLAYPORT');
      if (product.connectorA === 'HDMI' && hdmi) {
        if (product.hdmiVersion && hdmi.hdmiVersion && parseFloat(product.hdmiVersion) < parseFloat(hdmi.hdmiVersion)) {
          return outcome(code, 'LIMITED', 0.85, [`Кабель HDMI ${product.hdmiVersion}, порт устройства HDMI ${hdmi.hdmiVersion}`], [
            `Пропускная способность будет ограничена версией кабеля HDMI ${product.hdmiVersion}`,
          ], [{ kind: 'OTHER', description: `HDMI ${product.hdmiVersion}` }]);
        }
        return outcome(code, 'PASS', 0.9, [`Порт HDMI${hdmi.hdmiVersion ? ` ${hdmi.hdmiVersion}` : ''} устройства совместим с кабелем`]);
      }
      if (product.connectorA === 'DISPLAYPORT' && dp) return outcome(code, 'PASS', 0.9, ['Есть порт DisplayPort']);
      return notApplicable(code);
    }
    const usbc = device.ports.find((p) => usbCLike(p.type));
    if (!usbc) return notApplicable(code); // CONNECTOR_MATCH уже отбросит
    if (product.thunderboltRequired && !usbc.thunderbolt) {
      return outcome(code, 'FAIL', 0.9, ['Товар требует порт Thunderbolt, у устройства только USB-C']);
    }
    if (product.thunderbolt && !usbc.thunderbolt) {
      return outcome(code, 'LIMITED', 0.85, ['Док-станция Thunderbolt подключится в режиме USB-C'], [
        'Без Thunderbolt пропускная способность и число мониторов будут ограничены',
      ], [{ kind: 'OTHER', description: 'Режим USB-C вместо Thunderbolt' }]);
    }
    if (product.hdmiOut || product.dpAltMode) {
      if (usbc.dpAltMode === false) {
        return outcome(code, 'LIMITED', 0.85, ['Порт USB-C устройства не поддерживает DisplayPort Alt Mode'], [
          'Видеовыход через этот товар работать не будет, остальные порты — будут',
        ], [{ kind: 'NO_VIDEO_OUTPUT', description: 'Нет DP Alt Mode' }]);
      }
      if (usbc.dpAltMode === undefined && !usbc.thunderbolt) {
        return outcome(code, 'UNKNOWN', 0.3, ['Поддержка DisplayPort Alt Mode у устройства не подтверждена']);
      }
      return outcome(code, 'PASS', 0.85, [
        usbc.thunderbolt ? `Порт Thunderbolt ${usbc.thunderbolt} поддерживает вывод видео` : 'Порт USB-C поддерживает DisplayPort Alt Mode — видеовыход будет работать',
      ]);
    }
    return notApplicable(code);
  },
};

// ------------------------------------------------------------------
// 7. Скорость передачи данных
// ------------------------------------------------------------------
export const dataTransferRule: CompatibilityRule = {
  code: 'DATA_TRANSFER',
  name: 'Передача данных',
  description: 'Сверяет версию USB кабеля/накопителя с портом устройства.',
  priority: 40,
  appliesTo: (p) => ['CABLE', 'STORAGE', 'HUB', 'DOCK'].includes(p.kind) && (p.usbVersion !== undefined || p.dataGbps !== undefined || p.chargeOnly === true),
  evaluate(device, product) {
    const code = 'DATA_TRANSFER';
    const port = device.ports.find((p) => usbCLike(p.type) || p.type === 'LIGHTNING' || p.type === 'USB_A' || p.type === 'MICRO_USB');
    if (!port) return notApplicable(code);
    if (product.chargeOnly) {
      return outcome(code, 'LIMITED', 0.9, ['Кабель только для зарядки'], ['Передача данных через этот кабель невозможна'], [
        { kind: 'NO_DATA_TRANSFER', description: 'Только зарядка' },
      ]);
    }
    const pGbps = usbGbps(product.usbVersion, product.dataGbps);
    const dGbps = usbGbps(port.usbVersion, port.dataGbps);
    if (pGbps === undefined || dGbps === undefined) return notApplicable(code);
    // Для хабов и док-станций ограничение отмечаем только при USB 2.0
    if ((product.kind === 'HUB' || product.kind === 'DOCK') && pGbps >= 5) {
      return outcome(code, 'PASS', 0.85, [`Порты данных ${DATA_SPEED_LABEL(pGbps, product.usbVersion)}`]);
    }
    if (pGbps < dGbps && dGbps >= 5) {
      return outcome(code, 'LIMITED', 0.85, [`Порт устройства — ${DATA_SPEED_LABEL(dGbps, port.usbVersion)}, товар — ${DATA_SPEED_LABEL(pGbps, product.usbVersion)}`], [
        `Скорость передачи данных будет ограничена: ${DATA_SPEED_LABEL(pGbps, product.usbVersion)}`,
      ], [{ kind: 'OTHER', description: `Скорость до ${DATA_SPEED_LABEL(pGbps, product.usbVersion)}` }]);
    }
    return outcome(code, 'PASS', 0.85, [`Передача данных на скорости ${DATA_SPEED_LABEL(Math.min(pGbps, dGbps))}`]);
  },
};

// ------------------------------------------------------------------
// 8. Размер ремешка
// ------------------------------------------------------------------
export const bandSizeRule: CompatibilityRule = {
  code: 'BAND_SIZE',
  name: 'Размер ремешка',
  description: 'Группа размеров корпуса часов должна совпадать с ремешком.',
  priority: 5,
  appliesTo: (p) => p.kind === 'WATCH_BAND',
  evaluate(device, product) {
    const code = 'BAND_SIZE';
    const group = device.physical?.bandGroup;
    if (!group) return outcome(code, 'FAIL', 0.85, ['Устройство не использует сменные ремешки']);
    if (!product.bandGroups?.length) return outcome(code, 'UNKNOWN', 0, ['Для ремешка не указан размер']);
    if (product.bandGroups.includes(group)) {
      return outcome(code, 'PASS', 0.95, [`Размер ремешка (${group}) совпадает с корпусом часов`]);
    }
    return outcome(code, 'FAIL', 0.95, [`Ремешок для корпуса ${product.bandGroups.join(' / ')}, у часов — ${group}`]);
  },
};

// ------------------------------------------------------------------
// 9. Физическая совместимость: подставки, крепления, диагонали, VESA
// ------------------------------------------------------------------
export const physicalFitRule: CompatibilityRule = {
  code: 'PHYSICAL_FIT',
  name: 'Физические размеры',
  description: 'Диагональ, VESA-крепление, габариты.',
  priority: 30,
  appliesTo: (p) => ['STAND', 'MOUNT', 'CAR_MOUNT'].includes(p.kind) || p.vesa !== undefined || p.screenMinInches !== undefined,
  evaluate(device, product) {
    const code = 'PHYSICAL_FIT';
    if (product.vesa?.length) {
      const dv = device.physical?.vesa;
      if (!dv?.length) return outcome(code, 'FAIL', 0.85, ['У устройства нет VESA-крепления']);
      const hit = product.vesa.find((v) => dv.includes(v));
      return hit
        ? outcome(code, 'PASS', 0.9, [`Совпадает VESA ${hit}`])
        : outcome(code, 'FAIL', 0.9, [`VESA ${dv.join('/')} устройства не совпадает с ${product.vesa.join('/')}`]);
    }
    if (product.screenMinInches !== undefined || product.screenMaxInches !== undefined) {
      const inches = device.physical?.screenInches;
      if (inches === undefined) return outcome(code, 'UNKNOWN', 0.2, ['Диагональ устройства не указана']);
      const min = product.screenMinInches ?? 0;
      const max = product.screenMaxInches ?? 99;
      if (inches >= min && inches <= max) {
        return outcome(code, 'PASS', 0.9, [`Подходит для диагонали ${inches}″ (${min}–${max}″)`]);
      }
      return outcome(code, 'FAIL', 0.9, [`Рассчитан на ${min}–${max}″, у устройства ${inches}″`]);
    }
    if (product.kind === 'CAR_MOUNT') {
      if (device.categorySlug === 'cars') return outcome(code, 'PASS', 0.85, ['Устанавливается в любой автомобиль']);
      if (device.categorySlug !== 'phones') return outcome(code, 'FAIL', 0.9, ['Автодержатель предназначен для смартфонов']);
      if (product.wireless?.magsafe && !device.wireless?.magsafe) {
        return outcome(code, 'LIMITED', 0.85, ['Магнитный держатель MagSafe'], ['Для надёжного крепления понадобится чехол с магнитным кольцом'], [
          { kind: 'REQUIRES_ADAPTER', description: 'Нужно магнитное кольцо или чехол MagSafe' },
        ]);
      }
      return outcome(code, 'PASS', 0.85, ['Подходит для смартфона']);
    }
    return notApplicable(code);
  },
};

// ------------------------------------------------------------------
// 10. Платформа / экосистема (игровые аксессуары, карты памяти, наушники)
// ------------------------------------------------------------------
export const platformMatchRule: CompatibilityRule = {
  code: 'PLATFORM_MATCH',
  name: 'Платформа',
  description: 'Геймпады и игровые аксессуары должны поддерживать платформу устройства; карты памяти — слот и объём.',
  priority: 10,
  appliesTo: (p) => ['CONTROLLER', 'GAMING_ACCESSORY', 'MEMORY_CARD', 'HEADPHONES', 'KEYBOARD_MOUSE'].includes(p.kind) || Boolean(p.platforms?.length),
  evaluate(device, product) {
    const code = 'PLATFORM_MATCH';
    if (product.kind === 'MEMORY_CARD') {
      if (product.cardType === 'MICRO_SD' && device.storage?.microSd) {
        if (product.capacityGb && device.storage.maxMicroSdGb && product.capacityGb > device.storage.maxMicroSdGb) {
          return outcome(code, 'LIMITED', 0.85, ['Есть слот microSD'], [`Устройство поддерживает карты до ${device.storage.maxMicroSdGb} ГБ`]);
        }
        return outcome(code, 'PASS', 0.9, ['Есть слот microSD, объём поддерживается']);
      }
      if (product.cardType === 'SD' && hasPort(device, 'SD')) return outcome(code, 'PASS', 0.9, ['Есть слот SD']);
      return outcome(code, 'FAIL', 0.9, ['У устройства нет подходящего слота для карты памяти']);
    }
    if (product.kind === 'HEADPHONES') {
      if (product.bluetooth && device.audio?.bluetooth) return outcome(code, 'PASS', 0.85, [`Подключение по Bluetooth ${device.audio.bluetooth}`]);
      if (product.jack35) {
        if (device.audio?.jack35) return outcome(code, 'PASS', 0.9, ['Есть разъём 3,5 мм']);
        if (deviceHasUsbC(device) || hasPort(device, 'LIGHTNING')) {
          return outcome(code, 'LIMITED', 0.85, ['У устройства нет разъёма 3,5 мм'], ['Понадобится переходник на 3,5 мм'], [
            { kind: 'REQUIRES_ADAPTER', description: 'Переходник USB-C/Lightning → 3,5 мм' },
          ]);
        }
        return outcome(code, 'FAIL', 0.85, ['Нет разъёма 3,5 мм']);
      }
      if (product.bluetooth) return outcome(code, 'FAIL', 0.8, ['Устройство без Bluetooth']);
      return notApplicable(code);
    }
    if (product.platforms?.length) {
      const eco = device.ecosystem;
      if (!eco) return outcome(code, 'UNKNOWN', 0.2, ['Платформа устройства не указана']);
      if (product.platforms.includes(eco)) return outcome(code, 'PASS', 0.9, [`Поддерживает платформу ${platformLabel(eco)}`]);
      return outcome(code, 'FAIL', 0.9, [`Товар работает с ${product.platforms.map(platformLabel).join(', ')}, а устройство — ${platformLabel(eco)}`]);
    }
    return notApplicable(code);
  },
};

export function platformLabel(e: string): string {
  const map: Record<string, string> = {
    apple: 'Apple (iOS/macOS)',
    android: 'Android',
    windows: 'Windows',
    playstation: 'PlayStation',
    xbox: 'Xbox',
    nintendo: 'Nintendo Switch',
    steam: 'Steam Deck',
    printer: 'принтер',
    camera: 'камера',
    car: 'автомобиль',
    other: 'другое',
  };
  return map[e] ?? e;
}

// ------------------------------------------------------------------
// 11. Ограничение категории: аксессуар должен вообще иметь смысл для этого типа устройства
// ------------------------------------------------------------------
export const categoryScopeRule: CompatibilityRule = {
  code: 'CATEGORY_SCOPE',
  name: 'Область применения',
  description: 'Отсекает заведомо неприменимые сочетания (например, чехол для принтера).',
  priority: 1,
  appliesTo: () => true,
  evaluate(device, product) {
    const code = 'CATEGORY_SCOPE';
    const cat = device.categorySlug;
    const kind = product.kind;
    const deny: Array<[string[], string[], string]> = [
      [['printers', 'monitors'], ['CASE', 'SCREEN_PROTECTOR', 'WATCH_BAND', 'WIRELESS_CHARGER', 'POWER_BANK', 'CAR_MOUNT', 'CHARGER', 'CAR_CHARGER', 'MEMORY_CARD', 'BATTERY', 'HEADPHONES'], 'Аксессуар этого типа не применим к устройству'],
      [['cars'], ['CASE', 'SCREEN_PROTECTOR', 'WATCH_BAND', 'WIRELESS_CHARGER', 'CHARGER', 'CONSUMABLE', 'BATTERY', 'HUB', 'DOCK', 'STAND', 'MOUNT', 'HEADPHONES', 'KEYBOARD_MOUSE', 'PERIPHERAL', 'STORAGE', 'CABLE', 'ADAPTER', 'VIDEO_CABLE'], 'Аксессуар этого типа не относится к автомобилю'],
      [['phones', 'tablets', 'laptops', 'watches', 'headphones', 'gaming', 'monitors'], ['CONSUMABLE'], 'Устройство не использует расходные материалы'],
      [['phones', 'tablets', 'laptops', 'watches', 'headphones', 'gaming', 'printers', 'monitors', 'cars'], ['BATTERY'], 'Устройство не использует сменные аккумуляторы этого типа'],
      [['phones', 'tablets', 'watches', 'headphones', 'printers', 'monitors', 'cameras', 'cars'], ['CONTROLLER', 'GAMING_ACCESSORY'], 'Игровой аксессуар не применим к устройству'],
      [['watches', 'headphones', 'printers', 'cameras', 'cars'], ['CASE', 'SCREEN_PROTECTOR'], 'Для этого устройства нет чехлов и стёкол'],
      [['phones', 'tablets', 'laptops', 'headphones', 'printers', 'monitors', 'gaming', 'cameras', 'cars'], ['WATCH_BAND'], 'Ремешки подходят только для часов'],
      [['laptops', 'printers', 'monitors', 'gaming'], ['CAR_MOUNT'], 'Автодержатель предназначен для смартфонов'],
    ];
    for (const [cats, kinds, msg] of deny) {
      if (cats.includes(cat) && kinds.includes(kind)) {
        if (kind === 'CONTROLLER' && product.platforms?.some((p) => ['android', 'apple', 'windows'].includes(p)) && ['phones', 'tablets'].includes(cat)) continue;
        if (kind === 'CAR_MOUNT' && cat === 'cars') continue;
        if (kind === 'MEMORY_CARD' && cat === 'cars') continue;
        return outcome(code, 'FAIL', 0.95, [msg]);
      }
    }
    return notApplicable(code);
  },
};

export const ALL_RULES: CompatibilityRule[] = [
  categoryScopeRule,
  consumableMatchRule,
  fitModelListRule,
  bandSizeRule,
  connectorMatchRule,
  platformMatchRule,
  powerDeliveryRule,
  wirelessChargingRule,
  displayOutputRule,
  dataTransferRule,
  physicalFitRule,
].sort((a, b) => a.priority - b.priority);
