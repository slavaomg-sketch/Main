import type { ChargingProtocol, ConnectorType, DevicePort, DeviceSpecProfile, Ecosystem, ProductKind, ProductSpecProfile } from './types.js';

/**
 * Построение профилей из строк БД.
 * DeviceSpecification: key → value (Json). Ключи с точкой раскрываются во вложенные объекты.
 * ProductAttribute: attribute.code → value.
 */

export interface DeviceSpecRow {
  key: string;
  value: unknown;
  variantId?: string | null;
}

export interface DeviceRowForProfile {
  slug: string;
  name: string;
  releaseYear?: number | null;
  category: { slug: string };
  specifications: DeviceSpecRow[];
  specsAreDemo?: boolean;
}

function setDeep(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i] as string;
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
}

/** Собирает профиль устройства; спецификации варианта перекрывают спецификации модели. */
export function buildDeviceProfile(row: DeviceRowForProfile, variantId?: string | null): DeviceSpecProfile {
  const merged: Record<string, unknown> = {};
  const modelSpecs = row.specifications.filter((s) => !s.variantId);
  const variantSpecs = variantId ? row.specifications.filter((s) => s.variantId === variantId) : [];
  for (const s of [...modelSpecs, ...variantSpecs]) setDeep(merged, s.key, s.value);
  const ports = Array.isArray(merged.ports) ? (merged.ports as DevicePort[]) : [];
  return {
    slug: row.slug,
    name: row.name,
    categorySlug: row.category.slug,
    releaseYear: row.releaseYear ?? undefined,
    ecosystem: merged.ecosystem as Ecosystem | undefined,
    region: merged.region as string | undefined,
    ports,
    charging: merged.charging as DeviceSpecProfile['charging'],
    wireless: merged.wireless as DeviceSpecProfile['wireless'],
    consumables: merged.consumables as DeviceSpecProfile['consumables'],
    physical: merged.physical as DeviceSpecProfile['physical'],
    display: merged.display as DeviceSpecProfile['display'],
    storage: merged.storage as DeviceSpecProfile['storage'],
    audio: merged.audio as DeviceSpecProfile['audio'],
    isDemo: row.specsAreDemo ?? false,
  };
}

export interface ProductAttributeRow {
  attribute: { code: string };
  value: unknown;
  variantId?: string | null;
}

export interface ProductRowForProfile {
  id: string;
  slug: string;
  name: string;
  category: { slug: string };
  attributes: ProductAttributeRow[];
}

const asStr = (v: unknown) => (typeof v === 'string' ? v : undefined);
const asNum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const asBool = (v: unknown) => (typeof v === 'boolean' ? v : typeof v === 'string' ? ['true', '1', 'yes', 'да'].includes(v.toLowerCase()) : undefined);
const asList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean) : undefined);

/** Собирает профиль товара из атрибутов (атрибуты варианта перекрывают атрибуты товара). */
export function buildProductProfile(row: ProductRowForProfile, variantId?: string | null): ProductSpecProfile {
  const attrs: Record<string, unknown> = {};
  for (const a of row.attributes.filter((x) => !x.variantId)) attrs[a.attribute.code] = a.value;
  if (variantId) for (const a of row.attributes.filter((x) => x.variantId === variantId)) attrs[a.attribute.code] = a.value;

  const kind = (asStr(attrs.kind) as ProductKind | undefined) ?? 'OTHER';
  const outputsRaw = attrs.outputs;
  const outputs = Array.isArray(outputsRaw)
    ? (outputsRaw as Array<Record<string, unknown>>).map((o) => ({
        type: asStr(o.type) as ConnectorType,
        maxWatts: asNum(o.maxWatts),
        protocols: asList(o.protocols) as ChargingProtocol[] | undefined,
      }))
    : undefined;
  const wireless = attrs.wireless && typeof attrs.wireless === 'object'
    ? (attrs.wireless as ProductSpecProfile['wireless'])
    : asBool(attrs.qi) || asBool(attrs.magsafe) || asBool(attrs.qi2)
      ? { qi: asBool(attrs.qi), qi2: asBool(attrs.qi2), magsafe: asBool(attrs.magsafe), watts: asNum(attrs.wireless_watts) }
      : undefined;

  const profile: ProductSpecProfile = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind,
    categorySlug: row.category.slug,
    connectorA: asStr(attrs.connector_a) as ConnectorType | undefined,
    connectorB: asStr(attrs.connector_b) as ConnectorType | undefined,
    outputs,
    powerWatts: asNum(attrs.power_watts),
    protocols: asList(attrs.protocols) as ChargingProtocol[] | undefined,
    pdVoltages: Array.isArray(attrs.pd_voltages) ? (attrs.pd_voltages as number[]) : asList(attrs.pd_voltages)?.map(Number),
    cableRatedWatts: asNum(attrs.cable_rated_watts),
    usbVersion: asStr(attrs.usb_version),
    dataGbps: asNum(attrs.data_gbps),
    chargeOnly: asBool(attrs.charge_only),
    dpAltMode: asBool(attrs.dp_alt_mode),
    thunderbolt: asNum(attrs.thunderbolt) as 3 | 4 | 5 | undefined,
    thunderboltRequired: asBool(attrs.thunderbolt_required),
    hdmiVersion: asStr(attrs.hdmi_version),
    hdmiOut: asBool(attrs.hdmi_out),
    wireless,
    fitsModels: asList(attrs.fits_models),
    fitsCaseFamilies: asList(attrs.fits_case_families),
    consumableType: asStr(attrs.consumable_type) as ProductSpecProfile['consumableType'],
    consumableCodes: asList(attrs.consumable_codes),
    region: asStr(attrs.region),
    bandGroups: asList(attrs.band_groups),
    platforms: asList(attrs.platforms) as Ecosystem[] | undefined,
    vesa: asList(attrs.vesa),
    screenMinInches: asNum(attrs.screen_min_inches),
    screenMaxInches: asNum(attrs.screen_max_inches),
    cardType: asStr(attrs.card_type) as ProductSpecProfile['cardType'],
    capacityGb: asNum(attrs.capacity_gb),
    requiresPort: asStr(attrs.requires_port) as ConnectorType | undefined,
    bluetooth: asBool(attrs.bluetooth),
    jack35: asBool(attrs.jack_35),
    wirelessCharging: asBool(attrs.wireless_charging),
  };
  return profile;
}
