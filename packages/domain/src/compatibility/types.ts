/**
 * Compatibility Engine — доменные типы.
 * Профили устройства и товара строятся из DeviceSpecification и ProductAttribute,
 * правила чистые (без БД), вердикт всегда вычисляется на сервере.
 */

export type CompatibilityStatus =
  | 'VERIFIED'
  | 'COMPATIBLE'
  | 'COMPATIBLE_WITH_LIMITATIONS'
  | 'UNKNOWN'
  | 'INCOMPATIBLE';

export type CompatibilitySource = 'EXPLICIT' | 'RULE' | 'IMPORT' | 'MANUFACTURER' | 'ADMIN_OVERRIDE';

export type ConnectorType =
  | 'USB_C'
  | 'USB_A'
  | 'LIGHTNING'
  | 'MICRO_USB'
  | 'USB_B'
  | 'HDMI'
  | 'DISPLAYPORT'
  | 'MINI_DISPLAYPORT'
  | 'THUNDERBOLT'
  | 'MAGSAFE_3'
  | 'JACK_3_5'
  | 'DC_BARREL'
  | 'SD'
  | 'MICRO_SD'
  | 'ETHERNET'
  | 'PROPRIETARY';

export type ChargingProtocol = 'USB_PD' | 'PPS' | 'QC3' | 'QC4' | 'AFC' | 'SUPERVOOC' | 'PROPRIETARY' | 'USB_BC';

export type Ecosystem =
  | 'apple'
  | 'android'
  | 'windows'
  | 'playstation'
  | 'xbox'
  | 'nintendo'
  | 'steam'
  | 'printer'
  | 'camera'
  | 'car'
  | 'other';

export interface DevicePort {
  type: ConnectorType;
  count?: number;
  usbVersion?: string; // "2.0", "3.2 Gen 1", "3.2 Gen 2", "USB4"
  dataGbps?: number;
  dpAltMode?: boolean;
  thunderbolt?: 3 | 4 | 5;
  pdIn?: boolean; // принимает питание по PD
  pdOut?: boolean;
  hdmiVersion?: string;
  note?: string;
}

export interface DeviceSpecProfile {
  slug: string;
  name: string;
  categorySlug: string;
  ecosystem?: Ecosystem;
  releaseYear?: number;
  region?: string;
  ports: DevicePort[];
  charging?: {
    protocols: ChargingProtocol[];
    maxWatts?: number; // максимальная мощность зарядки устройства
    minWatts?: number; // минимально рекомендуемая (ноутбуки)
    pdVoltages?: number[]; // требуемые профили напряжения, например [20]
    viaUsb?: boolean; // заряжается ли по USB вообще
  };
  wireless?: {
    qi?: boolean;
    qi2?: boolean;
    magsafe?: boolean;
    qiMaxWatts?: number;
    magsafeMaxWatts?: number;
  };
  consumables?: {
    cartridges?: string[];
    inkBottles?: string[];
    toners?: string[];
    drums?: string[];
    batteries?: string[];
    regionNote?: string;
  };
  physical?: {
    caseFamily?: string; // общий форм-фактор корпуса для чехлов/стёкол
    screenInches?: number;
    bandGroup?: string; // apple: "41", "45" ; galaxy: "20mm"
    vesa?: string[];
    weightGrams?: number;
  };
  display?: {
    maxExternalDisplays?: number;
    maxExternalResolution?: string;
  };
  storage?: {
    microSd?: boolean;
    maxMicroSdGb?: number;
  };
  audio?: {
    jack35?: boolean;
    bluetooth?: string;
  };
  isDemo?: boolean;
}

export type ProductKind =
  | 'CHARGER'
  | 'CAR_CHARGER'
  | 'POWER_BANK'
  | 'CABLE'
  | 'ADAPTER'
  | 'WIRELESS_CHARGER'
  | 'HUB'
  | 'DOCK'
  | 'VIDEO_CABLE'
  | 'CASE'
  | 'SCREEN_PROTECTOR'
  | 'WATCH_BAND'
  | 'CONSUMABLE'
  | 'BATTERY'
  | 'STORAGE'
  | 'MEMORY_CARD'
  | 'CONTROLLER'
  | 'GAMING_ACCESSORY'
  | 'MOUNT'
  | 'STAND'
  | 'HEADPHONES'
  | 'CAR_MOUNT'
  | 'KEYBOARD_MOUSE'
  | 'OTHER';

export interface ProductOutput {
  type: ConnectorType;
  maxWatts?: number;
  protocols?: ChargingProtocol[];
}

export interface ProductSpecProfile {
  id: string;
  slug: string;
  name: string;
  kind: ProductKind;
  categorySlug?: string;
  connectorA?: ConnectorType;
  connectorB?: ConnectorType;
  outputs?: ProductOutput[];
  powerWatts?: number;
  protocols?: ChargingProtocol[];
  pdVoltages?: number[];
  cableRatedWatts?: number;
  usbVersion?: string;
  dataGbps?: number;
  chargeOnly?: boolean;
  dpAltMode?: boolean;
  thunderbolt?: 3 | 4 | 5;
  thunderboltRequired?: boolean;
  hdmiVersion?: string;
  hdmiOut?: boolean;
  wireless?: { qi?: boolean; qi2?: boolean; magsafe?: boolean; watts?: number };
  fitsModels?: string[]; // slug устройств / вариантов
  fitsCaseFamilies?: string[];
  consumableType?: 'cartridges' | 'inkBottles' | 'toners' | 'drums' | 'batteries';
  consumableCodes?: string[];
  region?: string;
  bandGroups?: string[];
  platforms?: Ecosystem[];
  vesa?: string[];
  screenMinInches?: number;
  screenMaxInches?: number;
  cardType?: 'MICRO_SD' | 'SD';
  capacityGb?: number;
  requiresPort?: ConnectorType; // порт устройства, необходимый для подключения
  bluetooth?: boolean;
  jack35?: boolean;
  wirelessCharging?: boolean;
}

export type RuleVerdict = 'PASS' | 'LIMITED' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface ConstraintSpec {
  kind:
    | 'REQUIRES_ADAPTER'
    | 'REDUCED_POWER'
    | 'ONLY_VARIANT'
    | 'REGION_SPECIFIC'
    | 'REQUIRES_PRODUCT'
    | 'NO_DATA_TRANSFER'
    | 'NO_VIDEO_OUTPUT'
    | 'OTHER';
  description: string;
  params?: Record<string, unknown>;
}

export interface RuleOutcome {
  ruleCode: string;
  verdict: RuleVerdict;
  confidence: number; // 0..1
  reasons: string[];
  limitations: string[];
  constraints: ConstraintSpec[];
}

export interface CompatibilityRule {
  code: string;
  name: string;
  description: string;
  priority: number;
  appliesTo(product: ProductSpecProfile): boolean;
  evaluate(device: DeviceSpecProfile, product: ProductSpecProfile): RuleOutcome;
}

export interface CompatibilityResult {
  status: CompatibilityStatus;
  confidence: number;
  source: CompatibilitySource;
  reasons: string[];
  limitations: string[];
  constraints: ConstraintSpec[];
  rulesApplied: string[];
  explanation: string;
  verifiedAt?: Date | null;
  evidence?: Array<{ type: string; url?: string | null; note?: string | null }>;
}

export interface ExplicitRelationInput {
  status: CompatibilityStatus;
  source: CompatibilitySource;
  confidence?: number;
  reasons?: string[];
  limitations?: string[];
  constraints?: ConstraintSpec[];
  verifiedAt?: Date | null;
  evidence?: Array<{ type: string; url?: string | null; note?: string | null }>;
}

export interface OverrideInput {
  status: CompatibilityStatus;
  reason: string;
}

export const ENGINE_VERSION = 3;
