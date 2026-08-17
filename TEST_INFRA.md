# E2E Test Infra: WhatsApp Automation Commercial Desktop Edition

## Test Philosophy
- Opaque-box, requirement-driven, and empirical regression hardening.
- Dual validation: Automated test runners (`node tests/runner.js`, `node backend/challenger_stress_harness.js`, `node backend/test_saas_seats.js`) and live desktop runtime verification.

## Feature Inventory & Test Coverage Matrix
| # | Feature | Source (Requirement) | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Workload) |
|---|---------|----------------------|:----------------:|:-----------------:|:-----------------:|:-----------------:|
| 1 | Hardware Node-Locking | R2: Machine Fingerprinting | 5 | 5 | ✓ | ✓ |
| 2 | Ed25519 Cryptographic Licensing | R2: License Verification | 5 | 5 | ✓ | ✓ |
| 3 | AES-256-GCM DB Encryption | R2: Database Security | 5 | 5 | ✓ | ✓ |
| 4 | Zero Hardcoded Pricing | R1: Packaging & Pricing | 5 | 5 | ✓ | ✓ |
| 5 | Anti-Ban & Quiet Hours | R3: Bug Audit & Runtime | 5 | 5 | ✓ | ✓ |
| 6 | Spintax Engine & Variable Substitution | R3: Campaign Queue | 5 | 5 | ✓ | ✓ |
| 7 | Session Lifecycle & Reconnect | R3: WhatsApp Connection | 5 | 5 | ✓ | ✓ |
| 8 | Campaign Queue & Concurrency | R3: Campaign Queue | 5 | 5 | ✓ | ✓ |
| 9 | Standalone Electron & IPC Bridges | R1: Desktop Packaging | 5 | 5 | ✓ | ✓ |
| 10| Council Head Final Compliance | R4: Final Audit | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Master Test Runner**: `node tests/runner.js` (executes Tiers 1-4, M2, and M3 test suites with clean reporting).
- **Adversarial Stress Harness**: `node backend/challenger_stress_harness.js` (18 empirical stress tests).
- **Tenant / Seat Quota Harness**: `node backend/test_saas_seats.js` (Commercial seat & quota validation).
- **Challenger Harnesses**: `node tests/emp_challenger_m2_2.js`, `node tests/m3_challenger_test.js`.
- **Frontend Production Build**: `npm --prefix frontend run build`.
- **Packaging Verification**: `npm run build:electron` / `WhatsAppAutomationSetup.exe` build check.

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 test cases per feature (Happy-path isolation).
- **Tier 2 (Boundary & Corner Cases)**: ≥5 test cases per feature (Empty strings, expired licenses, invalid signatures, malformed Spintax, extreme clock skews, corrupted encrypted fields).
- **Tier 3 (Cross-Feature Combinations)**: Node-lock + licensing + DB encryption + campaign execution pairwise interactions.
- **Tier 4 (Real-World Workloads)**: End-to-end desktop launch, license activation, contact import, multi-account rotation, Spintax generation, and anti-ban delay enforcement.
- **Passing Criterion**: 100% test pass rate across ALL test suites with zero failures.
