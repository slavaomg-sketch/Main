import { describe, expect, it } from 'vitest';
import { normalizeDeviceQuery, normalizeIdentifier } from '../../shared/normalize';

describe('normalizeDeviceQuery', () => {
  it('русские написания брендов', () => {
    expect(normalizeDeviceQuery('Айфон 15 про')).toBe('iphone 15 pro');
    expect(normalizeDeviceQuery('макбук эйр м2')).toBe('macbook air m 2');
    expect(normalizeDeviceQuery('самсунг галакси с25')).toBe('samsung galaxy s 25');
    expect(normalizeDeviceQuery('плойка 5')).toBe('playstation 5');
  });
  it('разделяет буквы и цифры, чистит пунктуацию', () => {
    expect(normalizeDeviceQuery('iPhone15Pro')).toBe('iphone 15 pro');
    expect(normalizeDeviceQuery('MacBook Air (M2, 2022)')).toBe('macbook air m 2 2022');
    expect(normalizeDeviceQuery('Canon PIXMA G-3410')).toBe('canon pixma g 3410');
  });
  it('транслитерирует прочую кириллицу', () => {
    expect(normalizeDeviceQuery('Хуавей мейт')).toBe('huawei meyt');
  });
  it('идентификаторы', () => {
    expect(normalizeIdentifier('A-2848')).toBe('a2848');
    expect(normalizeIdentifier('MQ9E3RU/A')).toBe('mq9e3rua');
  });
});
