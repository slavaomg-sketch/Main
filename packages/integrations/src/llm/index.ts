/**
 * LLM — только вспомогательный слой: разбор свободного запроса, исправление опечаток,
 * подсказка кандидатов и формулировка объяснений. Никогда не выносит вердикт совместимости.
 */
export interface DeviceQueryHints {
  brand?: string;
  family?: string;
  model?: string;
  generation?: string;
  year?: number;
  correctedQuery?: string;
  confidence: number;
}

export interface LlmAssistant {
  readonly mode: 'disabled' | 'live';
  parseDeviceQuery(query: string): Promise<DeviceQueryHints | null>;
  polishExplanation(input: { deviceName: string; productName: string; status: string; reasons: string[]; limitations: string[] }): Promise<string | null>;
}

export class DisabledLlmAssistant implements LlmAssistant {
  readonly mode = 'disabled' as const;
  async parseDeviceQuery() {
    return null;
  }
  async polishExplanation() {
    return null;
  }
}
