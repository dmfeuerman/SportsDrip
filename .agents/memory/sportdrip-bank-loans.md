---
name: SportDrip league loans (simple interest, server-owned)
description: How bank and peer loans accrue and are repaid since Pass 4
---

All league loans live in `leagues/{id}/loans/{loanId}` and are written only by callables (`takeBankLoan`, `repayLoan`, `requestPeerLoan`, `peerLoanAction`). Interest is **simple**: `ratePct` of *outstanding principal* per `intervalHours`, never on interest.

Interest is never written on a timer. `functions/src/lib/loanMath.ts` (byte-identical copy at `artifacts/mobile/lib/loanMath.ts`, enforced by a test) computes it as a pure function of the loan and the clock; `accruedThrough` advances by whole periods only when a repayment materialises it. Repayments go to interest first, then principal.

Loans lock the rate they were taken at; changing bank settings affects new loans only. Standings rank on net worth = tokens + receivables − debt.

The old `members.{uid}.bankLoans[]` + `useEffect([loaded])` compounding model is gone; `scripts/migrate-leagues-v2.mjs` converts legacy data.
