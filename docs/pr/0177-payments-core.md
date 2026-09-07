# feat(core): payment provider seam and money helpers

Block 3 (money) part 1: the vendor seam. Collecting money from a buyer goes
through a `PaymentProvider` interface in `packages/core`, never a vendor SDK from
application code (CLAUDE.md 2). Ships with two implementations and no paid
dependency; the ledger and the money tables come next, behind this seam.

## What

- `@campusos/core/payments`: the `PaymentProvider` interface (`createCharge`,
  `getCharge`; `settlement` is `manual` or `automatic`), the `Charge`/`ChargeRequest`
  types, and money helpers. Money is **PKR only, integer paisa** throughout.
- **ManualTransferProvider** (production default, no paid gateway): a charge stays
  `pending` until a platform admin confirms the bank transfer out of band; it
  carries configured transfer instructions to show the buyer (no bank detail is
  hard-coded).
- **FakeProvider** (dev/tests): settles instantly.
- **Fee math**, integer-only and rounding down so the platform never over-charges
  a rounding paisa: `PLATFORM_FEE_BPS = 1000` (10%), `feePaisa`, `netPaisa`,
  `assertPositiveAmountPaisa`, `isValidAmountPaisa`. `feePaisa + netPaisa === gross`
  always. This constant is the single TS source of truth; the money module's SQL
  uses the same rate and cites it.

## Data & migration impact

No schema change. Interface + helpers only.

## Tests

`packages/core/test/payments.test.ts`: the fee/net invariants and rounding, amount
validation, the manual provider's pending charge + instructions, and the fake
provider's instant settle. Core typecheck, test, and lint pass.

## Security & compliance notes (CLAUDE.md 2, 8)

- No paid dependency: the production default is manual bank transfer; a hosted
  gateway (Safepay/PayFast) would be a third implementation behind this same
  interface, added without touching a caller.
- Amounts are integer paisa with explicit validation; there is no float money.
- This PR is the interface only. The authoritative money movement -- an append-only
  ledger, fee/split computation, payouts, and refunds -- lands in the money module
  as SECURITY DEFINER writes and MUST have the human adversarial SQL review
  CLAUDE.md 6 requires before any production deploy.

## Follow-ups

The money module (ledger schema, the definer that records a settled payment and
writes the ledger in one statement, payouts, refunds/splits) and the platform
finance admin are the next block. No tenant enables money yet.
