# E2E Test Infra: ORHIDEEA (FoxPro 2005) Parity Project

## Test Philosophy
- Opaque-box, requirement-driven testing derived from `ORIGINAL_REQUEST.md` and user-facing specifications.
- Completely independent of internal implementation details; communicates strictly through public CLI/scripts, database states, and HTTP API endpoints.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Monthly Lifecycle Testing.

## Feature Inventory & Test Coverage Goals
| # | Feature | Source (Requirement) | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Pairwise) |
|---|---------|----------------------|:-----------------:|:-----------------:|:-----------------:|
| 1 | DB Schema & Snapshots | R1 / §4.0, §4.1 | 5 | 5 | ✓ |
| 2 | Full DBF Importer & Ledger Reconciliation | R1 / §4.9 | 5 | 5 | ✓ |
| 3 | TCE Reduction Expiration | R2 / §4.2.0 | 5 | 5 | ✓ |
| 4 | CRE Allocator Calculation | R2 / §4.2.4 | 5 | 5 | ✓ |
| 5 | SUM Calculation Engine | R2 / §4.2 | 10 | 10 | ✓ |
| 6 | 0-Person Expense Handling | R2 / G14 | 5 | 5 | ✓ |
| 7 | Difference Modes (APT, CNS, PER, SL, SET) | R2 / §4.2 | 6 | 6 | ✓ |
| 8 | Golden-Month Parity (±0.01 lei) | Acceptance Criteria | 5 | 5 | ✓ |
| 9 | Month Publishing (TRE) | R3 / §4.3.8 | 5 | 5 | ✓ |
| 10 | Month Unpublishing Guard (GOL) | R3 / §4.3.8 | 5 | 5 | ✓ |
| 11 | Penalty Engine (pen / Lpenal) | R3 / §4.4 | 6 | 6 | ✓ |
| 12 | Cashier Individual (CHI) & Allocation (P->A->F->R) | R3 / §4.5 | 6 | 6 | ✓ |
| 13 | Cashier Collective (CHO) | R3 / §4.5 | 5 | 5 | ✓ |
| 14 | Receipt Cancellation & Reversal | R3 / §4.5 | 5 | 5 | ✓ |
| 15 | Daily Cash Register Journaling (CASA) | R3 / §4.3.9 | 5 | 5 | ✓ |
| 16 | Month Close (SLU) & Reopen | R3 / §4.6 | 6 | 6 | ✓ |
| 17 | Data Entry Screens (Actualizare A-R) | R4 / §4.3 | 8 | 5 | ✓ |
| 18 | Auth, Middleware & GDPR Masking | R4 / G11 | 6 | 6 | ✓ |
| 19 | Listare Reports (16 endpoints) | R4 / §5 | 16 | 5 | ✓ |
| 20 | Situații Reports (17 endpoints) | R4 / §5 | 17 | 5 | ✓ |
| 21 | Centralizare Reports (IN1, IN2) | R4 / §5 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Node.js native test runner (`node --test tests/e2e/**/*.test.js`) or standalone runner script `node tests/run_all_tests.js`.
- **Pass/Fail Semantics**: All test suites must pass with exit code `0`. Any assertion failure, uncaught exception, or timeout exits with non-zero code.
- **Test Case Format**: Structured assertions verifying HTTP response status codes, payload schemas, arithmetic parity checks against golden DBF vectors, and database ledger reconciliations.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full Monthly Accounting Cycle | F1, F3, F5, F6, F9, F11, F12, F15, F16 | High |
| 2 | Golden Month September 2026 Import & Reconciliation | F1, F2, F8 | High |
| 3 | Winter Heating Month Parity (2006\IANUARIE) | F4, F5, F7, F8 | High |
| 4 | Multi-Tenant Cashier Session & Receipt Rollback | F11, F12, F13, F14, F15 | High |
| 5 | Security & Role-Based Access Guardrails | F18, F19, F20, F21 | Medium |
| 6 | Unpublish Guard & Ledger Integrity Stress Test | F9, F10, F12, F14 | High |

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: $\ge 120$ test cases across all 21 feature areas.
- **Tier 2 (Boundary & Corner Cases)**: $\ge 105$ test cases covering zero persons, negative balances, leap years, maximum allocators, single-cent rounding, and null/empty inputs.
- **Tier 3 (Cross-Feature Combinations)**: $\ge 25$ pairwise combination suites (e.g. meter modes $\times$ difference modes, partial payments $\times$ penalty calculations).
- **Tier 4 (Real-World Scenarios)**: $\ge 6$ comprehensive end-to-end integration workflows.
- **Total Minimum Test Cases**: $\ge 256$ automated test assertions.
