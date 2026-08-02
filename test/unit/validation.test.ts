import { describe, expect, it } from 'vitest';

import {
  indianPhoneSchema,
  macrosSchema,
  paginationQuerySchema,
} from '../../src/shared/validation/common.js';

describe('indianPhoneSchema', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['098765 43210', '+919876543210'],
    ['  6123456789  ', '+916123456789'],
  ])('normalises %s to E.164', (input, expected) => {
    expect(indianPhoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    ['too short', '98765'],
    ['too long', '98765432101'],
    ['invalid leading digit', '1234567890'],
    ['letters', '98765abcde'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(indianPhoneSchema.safeParse(input).success).toBe(false);
  });
});

describe('macrosSchema', () => {
  it('accepts a plausible meal', () => {
    expect(macrosSchema.parse({ kcal: 540, proteinG: 42, carbsG: 52, fatG: 14 }).kcal).toBe(540);
  });

  it('rejects negative and absurd values', () => {
    expect(macrosSchema.safeParse({ kcal: -1, proteinG: 0, carbsG: 0, fatG: 0 }).success).toBe(false);
    expect(macrosSchema.safeParse({ kcal: 99_999, proteinG: 0, carbsG: 0, fatG: 0 }).success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('applies the default page size', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(20);
  });

  it('coerces a string limit from the query string', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejects a limit above the maximum', () => {
    expect(paginationQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
