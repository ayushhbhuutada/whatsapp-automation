# Project: WhatsApp Automation Suite Comprehensive Audit & Resolution

## Architecture
- **Backend Core**: Express.js REST API with Node 22 `DatabaseSync` (`backend/database.js`, `backend/routes.js`, `backend/server.js`).
- **Automation Execution Engine**: Multi-worker concurrent dispatching, queue claiming, pause/resume/stop lifecycle, scheduler, and error recovery (`backend/services/automationRunner.js`).
- **WhatsApp Web & Session Lifecycle**: OpenWA / `whatsapp-web.js` native integration with multi-session management, LocalAuth caching, QR code streams, and event handlers (`backend/services/openwaService.js`).
- **Anti-Ban Protection Suite**: Smart rate limiting, Spintax variation, human typing emulation, sleep windows, warmup ramp-up, reputation scoring, and blacklisting (`backend/services/antiBanService.js`).
- **Frontend SPA**: React 19, TailwindCSS, Lucide icons, Vite bundling (`frontend/src/App.jsx`, `frontend/src/components/*`).
- **Testing & Quality Assurance**: Custom Node.js test harnesses, integration runners, adversarial suites, and frontend production build pipeline.

## Feature & Bug Inventory
| # | Feature / Bug Item | Description | Milestone | Source |
|---|-------------------|-------------|-----------|--------|
| 1 | SQLite Busy Timeout & Indexing | Add `PRAGMA busy_timeout = 5000` and `idx_contacts_campaign_status` composite index | M1 | Survey |
| 2 | JWT Blacklist Enforcement | Query `token_blacklist` in `authMiddleware` to enforce token revocation on logout | M1 | Survey |
| 3 | Auth Privilege Escalation Fix | Return 401 Unauthorized instead of defaulting to Admin User when JWT is invalid | M1 | Survey |
| 4 | SaaS Org Invite IDOR Fix | Enforce owner/admin role verification on `DELETE /saas/organization/invites/:inviteId` | M1 | Survey |
| 5 | SaaS Seat Invite Email Verification | Validate `req.user.email === invite.email` in `POST /saas/organization/accept-invite` | M1 | Survey |
| 6 | Contact Phone Null Pointer Fix | Guard against null `existing.phone` in phone formatting endpoint | M1 | Survey |
| 7 | Excel Upload File Leak Fix | Wrap spreadsheet parsing in try/finally to unlink temp files on parse errors | M1 | Survey |
| 8 | API 404 JSON Handler | Provide structured JSON 404 responses for unmatched `/api/*` routes | M1 | Survey |
| 9 | In-Flight Contact Rollback on Pause/Stop | Rollback in-flight contacts to `Pending` instead of marking as `Failed` when campaign pauses/stops | M2 | Survey |
| 10 | Worker Queue Burn Prevention on Disconnect | Terminate session worker when its socket disconnects instead of burning remaining queue contacts | M2 | Survey |
| 11 | Scheduler Orphan Prevention | Guard status transitions so scheduled campaigns are not orphaned if runner is busy | M2 | Survey |
| 12 | Stranded Sending Contact Recovery | Auto-recover stranded `'Sending'` contacts to `'Pending'` upon campaign launch or server restart | M2 | Survey |
| 13 | Accurate Campaign Completion Check | Count both `Pending` and `Sending` contacts before declaring campaign `Completed` | M2 | Survey |
| 14 | Post-Reboot Campaign Resume Support | Allow `resumeCampaign` to initialize and launch when runner status is `Idle` | M2 | Survey |
| 15 | Anti-Ban Breaker Finalizer Execution | Execute duration calculations, stats updates, and Excel generation when safety breaker fires | M2 | Survey |
| 16 | Session-Scoped Logout Teardown | Prevent `logoutSession` from killing campaigns running on other active sessions | M2 | Survey |
| 17 | Resume Re-Entrancy Mutex | Prevent concurrent `resumeCampaign` calls from launching duplicate execution loops | M2 | Survey |
| 18 | Auth Directory Path Consistency | Ensure all disconnect and delete operations use `getSessionsDir()` consistently | M2 | Survey |
| 19 | Prevent Destructive Auth Wipe on Transient Drop | Preserve session auth directory on transient socket disconnects for seamless auto-reconnect | M2 | Survey |
| 20 | In-Flight `createSession` Deduplication | Prevent duplicate Puppeteer instances when `createSession` is invoked concurrently | M2 | Survey |
| 21 | QR Timer Memory Leak Cleanup | Clear QR timers on session disconnect/delete to avoid resurrecting deleted session state | M2 | Survey |
| 22 | Windows EBUSY Delete Retry | Implement exponential backoff retry on session folder cleanup during Chromium shutdown | M2 | Survey |
| 23 | Group / Broadcast Message Filter | Filter out `@g.us` and `broadcast` messages from blacklist and engagement tracking | M2 | Survey |
| 24 | Send Window Local Date Alignment | Align date string formatting with local time to avoid midnight timezone desynchronization | M2 | Survey |
| 25 | Multi-Session Warmup Separation | Key warmup quotas by both user ID and session name for independent multi-number scaling | M2 | Survey |
| 26 | Spintax Whitespace Preservation | Preserve intentional leading/trailing whitespace in Spintax options | M2 | Survey |
| 27 | Exact Blacklist Phone Matching | Prevent broad partial matching in blacklist queries | M2 | Survey |
| 28 | React Error Boundary Implementation | Wrap application and views in React ErrorBoundary to prevent blank white screen crashes | M3 | Survey |
| 29 | Auth Token Persistence on Refresh | Initialize auth state from `localStorage` so sessions and JWTs survive page refresh | M3 | Survey |
| 30 | Settings & AntiBan View State Sync | Unify settings state to prevent `SettingsView` and `AntiBanSuiteView` from clobbering each other | M3 | Survey |
| 31 | Tag/Session Selection Preservation | Prevent background polling from resetting user-selected audience tags and session lists | M3 | Survey |
| 32 | Single Session Default Mode Fix | Ensure Single Number mode populates with active session name instead of `'auto_split'` | M3 | Survey |
| 33 | Modal Error Positioning & Visibility | Move error banners inside modal containers so they are not obscured by dark backdrops | M3 | Survey |
| 34 | Dead Component Removal | Clean up 406 lines of unused `WhatsAppSessionView` and unused state variables | M3 | Survey |
| 35 | SessionManager Callback Wiring & Polish | Wire `onSelectSession` prop and eliminate 4-second loading flash on interval polling | M3 | Survey |
| 36 | Network Error Catch Feedback & Debounce | Add user error alerts on network failure and debounce search inputs | M3 | Survey |
| 37 | Automated Integration & Concurrency Test Suite | Implement comprehensive tests for backend API, concurrency, and engine lifecycle | M4 | Survey |
| 38 | Final Acceptance Verification & Hardening | Run all E2E test suites, adversarial stress tests, frontend build, and forensic integrity audit | M5 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Database Schema, Concurrency & Backend Core Auth/Security | Items 1–8: SQLite timeout, composite index, JWT blacklist, auth 401, SaaS IDOR/email, phone null guard, upload leak, 404 handler | none | DONE |
| M2 | Automation Runner, Concurrency, OpenWA & Anti-Ban Engines | Items 9–27: In-flight rollback, worker disconnect exit, scheduler fix, stranded contact recovery, reboot resume, auth path sync, session lock, group filter, anti-ban time sync | M1 | DONE |
| M3 | Frontend React UI, State Synchronization & Error Boundaries | Items 28–36: ErrorBoundary, auth persistence, settings state unification, selection retention, single session fix, modal error fix, dead code removal, SessionManager polish | M1 | IN_PROGRESS |
| M4 | Comprehensive Automated Verification & Concurrency Suites | Item 37: Automated test harnesses for all backend endpoints, concurrency loops, anti-ban modes, and integration | M2, M3 | PLANNED |
| M5 | Final E2E Test Suite Pass, Adversarial Hardening & Forensic Audit | Item 38: Run master runner, Tier 1-4 E2E tests, Tier 5 adversarial stress tests, production build, and forensic integrity audit | M4 | PLANNED |

## Interface Contracts
### Database ↔ Backend Services
- SQLite WAL mode with `PRAGMA busy_timeout = 5000`.
- All batch updates wrapped in explicit transactions.
- Contacts table indexed on `(campaign_id, status)`.

### Authentication ↔ Middleware
- `authMiddleware` queries `token_blacklist` table.
- Expired / forged / malformed tokens return HTTP 401 with `{ error: 'Invalid or expired token' }`.
- Missing token with no auth header uses default user (in dev mode) or returns 401 as configured.

### Automation Runner ↔ OpenWA Service
- `openwaService.getSessionStatus(sessionId)` returns `{ success: boolean, connected: boolean, status: string }`.
- In-flight session initialization promises deduplicated in `openwaService.initializingSessions` map.
- Workers monitor `getSessionStatus` and gracefully break on disconnect without consuming remaining contacts.

### Frontend State ↔ Backend API
- Settings updates synchronized across `SettingsView` and `AntiBanSuiteView`.
- Campaign creator sends valid `sessionMode` and active `sessionName`.
- Auth state synced with `localStorage` tokens.

## Code Layout
- `backend/database.js`: SQLite DatabaseSync setup, migrations, table definitions, indexes.
- `backend/routes.js`: Express router, auth middleware, SaaS org endpoints, campaigns, contacts, anti-ban settings.
- `backend/server.js`: Express app initialization, static assets, 404 handler, error middleware.
- `backend/services/automationRunner.js`: Campaign execution engine, worker loops, scheduler, resume/pause state machine.
- `backend/services/openwaService.js`: WhatsApp Web Puppeteer client, session lifecycle, message sending, QR generation.
- `backend/services/antiBanService.js`: Anti-ban controls, send windows, spintax, human emulation, warmup tracking.
- `frontend/src/main.jsx`: React root mount with ErrorBoundary.
- `frontend/src/App.jsx`: Main SPA application, tabs, state management, modal controllers.
- `frontend/src/components/ErrorBoundary.jsx`: Component error boundary for graceful crash handling.
- `frontend/src/components/SessionManager.jsx`: Multi-session WhatsApp profile management card.
- `tests/`: Automated test harnesses, integration tests, adversarial stress tests, and runner.
