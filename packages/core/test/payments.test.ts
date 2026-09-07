import { describe, expect, it } from 'vitest';
import {
  FakeProvider,
  ManualTransferProvider,
  PLATFORM_FEE_BPS,
  assertPositiveAmountPaisa,
  feePaisa,
  isValidAmountPaisa,
  netPaisa,
} from '../src/payments/index';

describe('money helpers', () => {
  it('validates paisa amounts', () => {
    expect(isValidAmountPaisa(0)).toBe(true);
    expect(isValidAmountPaisa(150000)).toBe(true);
    expect(isValidAmountPaisa(-1)).toBe(false);
    expect(isValidAmountPaisa(1.5)).toBe(false);
  });

  it('asserts a strictly positive integer', () => {
    expect(() => assertPositiveAmountPaisa(1)).not.toThrow();
    expect(() => assertPositiveAmountPaisa(0)).toThrow(RangeError);
    expect(() => assertPositiveAmountPaisa(1.2)).toThrow(RangeError);
  });

  it('computes the platform fee as an integer, rounding down', () => {
    expect(PLATFORM_FEE_BPS).toBe(1000); // 10%
    expect(feePaisa(100000)).toBe(10000); // 10% of Rs 1000.00
    expect(feePaisa(199)).toBe(19); // 19.9 -> 19 (floor)
    expect(netPaisa(100000)).toBe(90000);
    expect(feePaisa(1000) + netPaisa(1000)).toBe(1000); // fee + net always == gross
  });
});

describe('ManualTransferProvider', () => {
  it('creates a pending charge carrying the configured instructions', async () => {
    const p = new ManualTransferProvider('Transfer to Acct 123, ref your order id');
    expect(p.settlement).toBe('manual');
    const charge = await p.createCharge({
      amountPaisa: 50000,
      currency: 'PKR',
      reference: 'ord-1',
    });
    expect(charge.status).toBe('pending');
    expect(charge.providerRef).toBe('ord-1');
    expect(charge.instructions).toContain('Transfer to Acct');
    // Manual settlement is not known to the provider.
    expect(await p.getCharge('ord-1')).toBeNull();
  });

  it('rejects a non-positive amount', async () => {
    const p = new ManualTransferProvider('x');
    await expect(
      p.createCharge({ amountPaisa: 0, currency: 'PKR', reference: 'r' }),
    ).rejects.toThrow(RangeError);
  });
});

describe('FakeProvider', () => {
  it('settles instantly and can be read back', async () => {
    const p = new FakeProvider();
    expect(p.settlement).toBe('automatic');
    const charge = await p.createCharge({ amountPaisa: 1000, currency: 'PKR', reference: 'ord-2' });
    expect(charge.status).toBe('settled');
    expect((await p.getCharge('ord-2'))?.status).toBe('settled');
    expect(await p.getCharge('missing')).toBeNull();
  });
});
