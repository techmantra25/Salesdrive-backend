# Portal Locking System Documentation

## 1. Overview

The portal locking system restricts distributor access when bill deliveries are overdue beyond the configured grace period.

It combines:

- Distributor-level lock state fields
- Overdue bill evaluation logic (IST day-based)
- Request-time enforcement middleware
- Scheduled lock-check cron job
- Event-driven lock refresh after bill delivery/cancellation
- Auto-pending-bill cron level lock reconciliation on 1st-4th runs
- Admin APIs for configuration and manual unlock

Primary goal:

- Force distributors to clear overdue pending bills before using restricted APIs.

## 2. Data Model

### 2.1 Distributor lock fields

Defined in the Distributor model:

- `isPortalLocked` (Boolean, default `false`)
- `portalLockReason` (String, default `null`)
- `portalLockedAt` (Date, default `null`)
- `portalLockedBy` (Enum: `system`, `admin`, default `null`)
- `pendingBillDeliveries` (Array of overdue bill snapshots)
  - `billId`
  - `billNo`
  - `createdAt`
  - `deliveryDeadline`
  - `invoiceAmount`
- `lastPortalLockCheck` (Date, default `null`)

### 2.2 Bill delivery setting model

Per distributor lock behavior is governed by `BillDeliverySetting`:

- `distributorId` (unique)
- `deliveryDurationDays` (1-30, default 7, required when active)
- `isActive` (default true)
- `enableBackdateBilling` (separate billing behavior toggle; not a direct lock rule)
- audit fields and notes

### 2.3 System cron config model

Portal lock scheduler configuration is persisted in `SystemConfig`:

- `job` (unique key)
- `cronTime`
- `isActive`

Portal lock cron key:

- `job = "portalLockCheck"`

## 3. Lock Decision Rules

### 3.1 Eligible bill statuses

A bill is treated as pending if status is one of:

- `Pending`
- `Vehicle Allocated`
- `Partially-Delivered`

### 3.2 Overdue calculation

Timezone: `Asia/Kolkata`

For each pending bill:

1. Compute deadline day:
   - `deadlineDay = startOfDay(createdAt in IST + deliveryDurationDays)`
2. Bill is overdue only when:
   - `currentDayStart > deadlineDay`

This means:

- Remaining days equal to 0 is still deliverable on the same day.
- Lock starts from next day after deadline day.

### 3.3 Lock / unlock outcomes

- If overdue bills exist:
  - `isPortalLocked = true`
  - `portalLockedBy = "system"`
  - `portalLockedAt = now` (when entering locked state)
  - `portalLockReason` set with overdue context
  - `pendingBillDeliveries` updated to overdue list
- If no overdue bills:
  - `isPortalLocked = false`
  - lock metadata cleared
  - `pendingBillDeliveries = []`

Special unlock conditions:

- If no pending bills at all: unlock
- If delivery setting missing or inactive (utility path): unlock
- If admin disables setting via admin API: force unlock
- If admin manually unlocks: force unlock and reason updated

## 4. Core Components

### 4.1 Scheduled checker job

File: `jobs/checkPortalLock.js`

Behavior:

- Fetches all active `BillDeliverySetting` records.
- Processes each configured distributor.
- Evaluates pending and overdue bills.
- Applies lock/unlock transitions.
- Logs counts: locked/unlocked/skipped.

Notes:

- If there are no active settings, job exits early.
- In that early-exit case, no unlock sweep is executed by this job itself.

### 4.2 Single distributor utility

File: `utils/checkPortalLock.js`

Behavior:

- Recomputes lock state for one distributor.
- Called after bill operations (delivery/cancellation and auto-delivery).
- Also unlocks if setting is missing or inactive.

This is the near-real-time correction path between scheduled runs.

### 4.3 Enforcement middleware

File: `middlewares/protectDisRoute.js`

Behavior:

- Authenticates distributor from cookie token (`DBToken`) or Bearer token.
- Blocks locked distributors with HTTP 403 unless route is allowlisted.
- Bypasses lock for admin-context distributor logins:
  - `role === "admin"` OR `createdBy` exists.

403 response includes:

- `isPortalLocked`
- lock reason/time/by
- `pendingBillDeliveries`
- action guidance

Allowlisted paths while locked:

- `/api/v1/distributor/portal-status`
- `/api/v1/distributor/pending-bills`
- `/api/v1/distributor/overdue-bills-count`
- `/api/v2/distributor/portal-status`
- `/api/v2/distributor/pending-bills`
- `/api/v2/distributor/overdue-bills-count`
- `/api/v1/bill/deliver`
- `/api/v2/bill/deliver`
- `/api/v1/bill/detail`
- `/api/v1/bill/bill_update`
- `/api/v1/reason/list-by-module`
- `/api/v1/reason/module`

### 4.4 Cron scheduler wrapper

File: `jobs/crons/portalLockCheckCron.js`

Behavior:

- Job key: `portalLockCheck`
- Default schedule: `0 23 * * *` (11:00 PM IST daily)
- Ensures config exists in `SystemConfig`.
- Validates cron expression.
- Starts/stops scheduler based on config.
- Exposes metadata helpers.

### 4.5 App bootstrap integration

File: `index.js`

Behavior:

- Calls `startPortalLockCheckCron()` during server bootstrap.

## 5. Trigger Points That Recalculate Lock State

### 5.1 Manual bill delivery

File: `controllers/RBP-controller/bill/deliverBillUpdate.js`

After bill processing, system calls:

- `checkAndUpdatePortalLock(userId)`

### 5.2 Auto pending bill delivery controller flow

File: `controllers/RBP-controller/bill/autoPendingBillDelivery.controller.js`

After processing each bill/distributor batch, system calls:

- `checkAndUpdatePortalLock(userId)`

### 5.3 Auto pending bill cron-level reconciliation (recent implementation)

File: `jobs/crons/autoPendingBillDeliveryCron.js`

During each auto pending bill cron execution, after auto-delivery payload handling, system calls:

- `checkAndLockDistributorPortals()`

This ensures portal lock state is globally reconciled immediately after the 1st-4th monthly auto-delivery run.

### 5.4 Bill cancellation

File: `controllers/bill/cancelBillUpdate.js`

After cancellations, for impacted distributors system calls:

- `checkAndUpdatePortalLock(distributorId)`

## 6. API Surface

## 6.1 Distributor-facing endpoints

Route file: `routes/v1Routes/distributorBillDelivery.routes.js`
Base mount: `/api/v1/distributor`

- `GET /pending-bills`
  - Returns pending bills, deadline metadata, overdue split, counts.
- `GET /portal-status`
  - Returns lock state and pending overdue snapshots.
- `GET /overdue-bills-count`
  - Returns quick overdue count.

Controller file:

- `controllers/billDelivery/distributorPendingBills.js`

## 6.2 Admin bill-delivery + portal lock endpoints

Route file: `routes/v1Routes/adminBillDelivery.routes.js`
Base mount: `/api/v1/admin`

- `POST /bill-delivery-settings`
- `POST /bill-delivery-settings/bulk`
- `GET /bill-delivery-settings`
- `GET /bill-delivery-settings/:distributorId`
- `DELETE /bill-delivery-settings/:distributorId`
- `POST /unlock-distributor-portal`
- `GET /locked-distributors`

Controller file:

- `controllers/billDelivery/adminBillDeliverySettings.js`

Important admin behaviors:

- Setting `isActive=false` forces unlock and clears pending overdue snapshots.
- Manual unlock clears lock state and sets reason:
  - `Manually unlocked by admin. <optional reason>`

## 6.3 Cron configuration endpoint

Route file: `routes/v1Routes/config.routes.js`
Base mount: `/api/v1/config`

- `GET /portal-lock-check-cron`
- `PATCH /portal-lock-check-cron`

Controller file:

- `controllers/jobControl/portalLockCheckCronConfig.js`

## 7. Request Lifecycle When Distributor Is Locked

1. Distributor calls protected endpoint.
2. `protectDisRoute` authenticates distributor.
3. Middleware checks lock flag and allowlist.
4. If locked and route is not allowlisted and user is not admin-context:
   - returns `403` with lock metadata.
5. Distributor can still access allowlisted endpoints to view status and deliver bills.
6. After deliveries/cancellations, utility recalculates lock and may unlock.

## 8. Operational Notes

### 8.1 Timezone is fixed to IST

All overdue calculations use `Asia/Kolkata` and day boundaries (`startOf("day")`).

### 8.2 Login response exposes lock state for distributor login only

Distributor login response includes:

- `isPortalLocked`
- `portalLockReason`
- `portalLockedAt`

Admin-context login (via `genPassword`) is allowed to bypass lock restrictions.

### 8.3 Potential route consistency observation

Middleware allowlist includes v2 distributor lock-status routes:

- `/api/v2/distributor/portal-status`
- `/api/v2/distributor/pending-bills`
- `/api/v2/distributor/overdue-bills-count`

Current v2 router wiring does not mount distributor bill-delivery routes, only:

- `/api/v2/sales-return`
- `/api/v2/bill`
- `/api/v2/retailer-transaction`
- `/api/v2/db-transaction`

So those v2 distributor allowlist entries appear currently unused.

### 8.4 Scheduler and event-driven checks complement each other

- Scheduler enforces periodic consistency across active settings.
- Event-driven utility updates reduce lock-state lag after bill actions.
- Auto pending bill cron now triggers an immediate global lock reconciliation on its own run.

### 8.5 Monthly 1st-4th behavior

Auto pending bill delivery cron schedule is:

- `5 0 1-4 * *` (IST)

Because cron-level reconciliation is executed inside this job, this specific extra reconciliation path runs only on the 1st-4th of each month.

## 9. End-to-End Control Matrix

- Lock state storage: Distributor document fields
- Rule source: BillDeliverySetting per distributor
- Overdue evaluator: `jobs/checkPortalLock.js` and `utils/checkPortalLock.js`
- Runtime gatekeeper: `middlewares/protectDisRoute.js`
- Background execution: `jobs/crons/portalLockCheckCron.js`
- Monthly auto-delivery reconciliation hook: `jobs/crons/autoPendingBillDeliveryCron.js`
- Runtime configuration: `/api/v1/config/portal-lock-check-cron`
- Manual admin override: `/api/v1/admin/unlock-distributor-portal`
- Status visibility for distributors: `/api/v1/distributor/portal-status`

## 10. Quick Validation Checklist

1. Configure active bill-delivery setting for a distributor.
2. Create pending bill(s) and age one beyond configured days.
3. Run portal lock check cron (or wait schedule) and verify:
   - distributor becomes locked
   - reason and pending overdue list are populated
4. Run auto pending bill cron window flow (1st-4th) and verify post-run lock reconciliation updates unlock/lock states.
5. Call a non-allowlisted distributor endpoint and verify 403 lock response.
6. Deliver overdue bill(s) and verify lock recalculation triggers unlock.
7. Disable setting and verify forced unlock.
8. Use admin unlock endpoint and verify lock clears immediately.

---

Prepared after reviewing lock model fields, scheduler, middleware, trigger points, and route wiring in the current codebase.
