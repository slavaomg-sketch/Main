import { ALL_RULES } from './rules';
import type {
  CompatibilityResult,
  CompatibilityRule,
  CompatibilityStatus,
  ConstraintSpec,
  DeviceSpecProfile,
  ExplicitRelationInput,
  OverrideInput,
  ProductSpecProfile,
  RuleOutcome,
} from './types';

export interface EvaluateOptions {
  rules?: CompatibilityRule[];
  explicit?: ExplicitRelationInput | null;
  override?: OverrideInput | null;
}

const STATUS_RANK: Record<CompatibilityStatus, number> = {
  INCOMPATIBLE: 0,
  UNKNOWN: 1,
  COMPATIBLE_WITH_LIMITATIONS: 2,
  COMPATIBLE: 3,
  VERIFIED: 4,
};

export function statusRank(status: CompatibilityStatus): number {
  return STATUS_RANK[status];
}

export function isPositiveStatus(status: CompatibilityStatus): boolean {
  return status === 'VERIFIED' || status === 'COMPATIBLE' || status === 'COMPATIBLE_WITH_LIMITATIONS';
}

/**
 * Чистая функция: вычисляет вердикт по правилам, затем накладывает явную связь и административный override.
 * Приоритет: override > явная связь (EXPLICIT/MANUFACTURER) > правила.
 */
export function evaluateCompatibility(
  device: DeviceSpecProfile,
  product: ProductSpecProfile,
  options: EvaluateOptions = {},
): CompatibilityResult {
  const rules = options.rules ?? ALL_RULES;
  const outcomes: RuleOutcome[] = [];
  for (const rule of rules) {
    if (!rule.appliesTo(product)) continue;
    const out = rule.evaluate(device, product);
    if (out.verdict === 'NOT_APPLICABLE') continue;
    outcomes.push(out);
    // Жёсткий отказ на раннем правиле — дальше считать бессмысленно
    if (out.verdict === 'FAIL' && rule.priority <= 10) break;
  }
  const ruleResult = combineOutcomes(outcomes, device, product);

  let result = ruleResult;
  if (options.explicit && options.explicit.status !== 'UNKNOWN') {
    result = mergeExplicit(ruleResult, options.explicit, device, product);
  }
  if (options.override) {
    result = {
      ...result,
      status: options.override.status,
      confidence: 1,
      source: 'ADMIN_OVERRIDE',
      reasons: [options.override.reason, ...result.reasons],
      limitations: options.override.status === 'COMPATIBLE_WITH_LIMITATIONS' ? result.limitations : [],
      explanation: buildExplanation(options.override.status, [options.override.reason], result.limitations, device, product),
    };
  }
  return result;
}

function combineOutcomes(outcomes: RuleOutcome[], device: DeviceSpecProfile, product: ProductSpecProfile): CompatibilityResult {
  const rulesApplied = outcomes.map((o) => o.ruleCode);
  const reasons = uniq(outcomes.flatMap((o) => o.reasons));
  const limitations = uniq(outcomes.flatMap((o) => o.limitations));
  const constraints = dedupeConstraints(outcomes.flatMap((o) => o.constraints));

  let status: CompatibilityStatus;
  let confidence: number;
  const fails = outcomes.filter((o) => o.verdict === 'FAIL');
  const limited = outcomes.filter((o) => o.verdict === 'LIMITED');
  const passes = outcomes.filter((o) => o.verdict === 'PASS');
  const unknowns = outcomes.filter((o) => o.verdict === 'UNKNOWN');

  if (fails.length > 0) {
    status = 'INCOMPATIBLE';
    confidence = Math.max(...fails.map((f) => f.confidence));
    // При отказе показываем только причины отказа
    return {
      status,
      confidence,
      source: 'RULE',
      reasons: uniq(fails.flatMap((f) => f.reasons)),
      limitations: [],
      constraints: [],
      rulesApplied,
      explanation: buildExplanation(status, uniq(fails.flatMap((f) => f.reasons)), [], device, product),
    };
  }
  if (passes.length === 0 && limited.length === 0) {
    status = 'UNKNOWN';
    confidence = 0;
  } else if (limited.length > 0) {
    status = 'COMPATIBLE_WITH_LIMITATIONS';
    confidence = Math.min(...[...limited, ...passes].map((o) => o.confidence));
  } else {
    status = 'COMPATIBLE';
    confidence = Math.min(...passes.map((o) => o.confidence));
    if (unknowns.length > 0) confidence = Math.min(confidence, 0.6);
  }
  const explicitFit = passes.some((p) => p.ruleCode === 'FIT_MODEL_LIST' || p.ruleCode === 'CONSUMABLE_MATCH');
  if (status === 'COMPATIBLE' && explicitFit && unknowns.length === 0) {
    confidence = Math.max(confidence, 0.95);
  }
  const explanation = buildExplanation(status, reasons, limitations, device, product);
  return { status, confidence: round2(confidence), source: 'RULE', reasons, limitations, constraints, rulesApplied, explanation };
}

function mergeExplicit(ruleResult: CompatibilityResult, explicit: ExplicitRelationInput, device: DeviceSpecProfile, product: ProductSpecProfile): CompatibilityResult {
  const reasons = uniq([...(explicit.reasons ?? []), ...ruleResult.reasons]);
  const limitations = explicit.status === 'COMPATIBLE_WITH_LIMITATIONS'
    ? uniq([...(explicit.limitations ?? []), ...ruleResult.limitations])
    : explicit.status === 'VERIFIED' || explicit.status === 'COMPATIBLE'
      ? ruleResult.status === 'COMPATIBLE_WITH_LIMITATIONS' ? ruleResult.limitations : []
      : [];
  // Явная VERIFIED-связь не может скрыть ограничение, найденное правилами: показываем как VERIFIED с примечаниями
  let status = explicit.status;
  if (explicit.status === 'VERIFIED' && ruleResult.status === 'COMPATIBLE_WITH_LIMITATIONS') status = 'COMPATIBLE_WITH_LIMITATIONS';
  return {
    status,
    confidence: explicit.confidence ?? (explicit.status === 'VERIFIED' ? 1 : 0.9),
    source: explicit.source,
    reasons,
    limitations,
    constraints: dedupeConstraints([...(explicit.constraints ?? []), ...ruleResult.constraints]),
    rulesApplied: ruleResult.rulesApplied,
    explanation: buildExplanation(status, reasons, limitations, device, product),
    verifiedAt: explicit.verifiedAt ?? null,
    evidence: explicit.evidence ?? [],
  };
}

export function buildExplanation(
  status: CompatibilityStatus,
  reasons: string[],
  limitations: string[],
  device: DeviceSpecProfile,
  product: ProductSpecProfile,
): string {
  const head: Record<CompatibilityStatus, string> = {
    VERIFIED: `Совместимость с ${device.name} подтверждена.`,
    COMPATIBLE: `Полностью совместимо с ${device.name}.`,
    COMPATIBLE_WITH_LIMITATIONS: `Совместимо с ${device.name}, но с ограничениями.`,
    UNKNOWN: `Совместимость с ${device.name} не подтверждена.`,
    INCOMPATIBLE: `Не совместимо с ${device.name}.`,
  };
  const parts = [head[status]];
  if (reasons.length) parts.push(reasons.slice(0, 3).join('. ') + '.');
  if (limitations.length) parts.push(limitations.slice(0, 2).join('. ') + '.');
  void product;
  return parts.join(' ');
}

export function statusLabel(status: CompatibilityStatus): string {
  const map: Record<CompatibilityStatus, string> = {
    VERIFIED: 'Проверено',
    COMPATIBLE: 'Полностью совместимо',
    COMPATIBLE_WITH_LIMITATIONS: 'Совместимо с ограничениями',
    UNKNOWN: 'Совместимость не подтверждена',
    INCOMPATIBLE: 'Не совместимо',
  };
  return map[status];
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function dedupeConstraints(list: ConstraintSpec[]): ConstraintSpec[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = `${c.kind}:${c.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
