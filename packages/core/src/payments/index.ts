/**
 * Payment seam.
 *
 * Collecting money from a buyer goes through this interface, never a vendor SDK
 * imported from application code (CLAUDE.md 2). The product ships with two
 * implementations and no paid dependency:
 *
 *  - ManualTransferProvider: the buyer transfers to the platform's account and
 *    submits a reference/receipt; a platform admin confirms it out of band. This
 *    is the production default (no paid gateway is required).
 *  - FakeProvider: settles instantly, for development and tests.
 *
 * A hosted gateway (Safepay, PayFast) would be a third implementation behind the
 * same interface (settlement 'automatic', confirmed by a webhook) without touching
 * a caller. Money is PKR only and integer paisa throughout; there are no floats.
 * The ledger, fees, payouts and refunds are the money module's concern -- this
 * seam is only "get the buyer to pay, and tell us when it has settled".
 */

export type Currency = 'PKR';

/** 'manual' settles when a human confirms; 'automatic' settles by the provider. */
export type SettlementMode = 'manual' | 'automatic';

export type ChargeStatus = 'pending' | 'settled' | 'failed';

export interface ChargeRequest {
  /** Amount to collect, integer paisa, > 0. */
  amountPaisa: number;
  currency: Currency;
  /** Our own reference for this charge (e.g. an order id); the provider echoes it. */
  reference: string;
  /** Opaque key/values the provider stores and returns (tenant, buyer, order). */
  metadata?: Record<string, string>;
}

export interface Charge {
  providerId: string;
  /** The provider's id for this charge (for manual, our own reference). */
  providerRef: string;
  amountPaisa: number;
  currency: Currency;
  status: ChargeStatus;
  /** Manual only: human-readable transfer instructions to show the buyer. */
  instructions?: string;
  /** Hosted-gateway only: where to send the buyer to pay. */
  redirectUrl?: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly settlement: SettlementMode;
  /** Begin collecting `req.amountPaisa`. Validates the amount is a positive integer. */
  createCharge(req: ChargeRequest): Promise<Charge>;
  /**
   * The charge as the provider currently sees it, or null if unknown. For a manual
   * provider this is best-effort (settlement is recorded by the platform out of
   * band, not by the provider), so callers rely on their own ledger, not this.
   */
  getCharge(providerRef: string): Promise<Charge | null>;
}

/** The platform fee, in basis points. 1000 bps = 10%. The single TS source of
 *  truth; the money module's SQL uses the same rate and cites this constant. */
export const PLATFORM_FEE_BPS = 1000;

/** True when `v` is a whole number of paisa that can be a money amount. */
export function isValidAmountPaisa(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
}

/** Assert a strictly-positive integer paisa amount, or throw. */
export function assertPositiveAmountPaisa(v: number): void {
  if (!Number.isInteger(v) || v <= 0) {
    throw new RangeError(`amount must be a positive integer paisa, got ${v}`);
  }
}

/**
 * The platform fee on `amountPaisa`, in paisa, rounded down (the platform never
 * over-charges by a rounding paisa; the seller keeps the remainder). Integer math
 * only. Must match the money module's SQL fee computation.
 */
export function feePaisa(amountPaisa: number, bps: number = PLATFORM_FEE_BPS): number {
  assertPositiveAmountPaisa(amountPaisa);
  return Math.floor((amountPaisa * bps) / 10000);
}

/** What the seller receives after the platform fee, in paisa. */
export function netPaisa(amountPaisa: number, bps: number = PLATFORM_FEE_BPS): number {
  return amountPaisa - feePaisa(amountPaisa, bps);
}

/**
 * The manual bank-transfer provider: the production default. It never settles by
 * itself -- a charge stays 'pending' until a platform admin confirms the transfer
 * (recorded in the ledger, not here). It carries the instructions to show the
 * buyer, supplied by configuration so no bank detail is hard-coded.
 */
export class ManualTransferProvider implements PaymentProvider {
  readonly id = 'manual';
  readonly displayName = 'Bank transfer';
  readonly settlement: SettlementMode = 'manual';

  constructor(private readonly instructions: string) {}

  async createCharge(req: ChargeRequest): Promise<Charge> {
    assertPositiveAmountPaisa(req.amountPaisa);
    return {
      providerId: this.id,
      providerRef: req.reference,
      amountPaisa: req.amountPaisa,
      currency: req.currency,
      status: 'pending',
      instructions: this.instructions,
    };
  }

  async getCharge(): Promise<Charge | null> {
    // Manual settlement is recorded by the platform, not the provider.
    return null;
  }
}

/**
 * A provider that settles instantly. Development and tests only; never selected in
 * production. Keeps charges in memory so getCharge can report them back.
 */
export class FakeProvider implements PaymentProvider {
  readonly id = 'fake';
  readonly displayName = 'Test payments';
  readonly settlement: SettlementMode = 'automatic';
  private readonly charges = new Map<string, Charge>();

  async createCharge(req: ChargeRequest): Promise<Charge> {
    assertPositiveAmountPaisa(req.amountPaisa);
    const charge: Charge = {
      providerId: this.id,
      providerRef: req.reference,
      amountPaisa: req.amountPaisa,
      currency: req.currency,
      status: 'settled',
    };
    this.charges.set(charge.providerRef, charge);
    return charge;
  }

  async getCharge(providerRef: string): Promise<Charge | null> {
    return this.charges.get(providerRef) ?? null;
  }
}
