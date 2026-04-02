# Backdate Billing System - Complete Documentation

**Last Updated:** March 2026  
**Version:** 2.0  
**Status:** Production Ready

---

## Table of Contents

1. [Concept Overview](#concept-overview)
2. [Problem Statement](#problem-statement)
3. [Solution Architecture](#solution-architecture)
4. [System Components](#system-components)
5. [Code Logic & Implementation](#code-logic--implementation)
6. [Workflow Scenarios](#workflow-scenarios)
7. [Database Model](#database-model)
8. [Configuration & Settings](#configuration--settings)
9. [API Endpoints](#api-endpoints)
10. [Testing & Validation](#testing--validation)
11. [Edge Cases & Constraints](#edge-cases--constraints)

---

## Concept Overview

### What is Backdate Billing?

**Backdate Billing** is a mechanism that allows bills generated in one month to be **delivered and recorded as if they were delivered in the billing month**, rather than the actual delivery month.

**Key Insight:** When a bill is created in February but delivered in March, the backdate system records the delivery date as the **last date of February (month-end)** for accounting and multiplier calculations, while preserving the actual delivery date for audit trails.

### Primary Use Case

In RBP (Retailer Benefits Program) point calculations:

- Points earned are multiplied based on delivery month
- A bill from February delivered in March should multiply points based on **February**, not March
- Backdate billing ensures accurate RBP calculations across month boundaries

### Business Rules

| Scenario                    | Backdate Billing ON                   | Backdate Billing OFF               |
| --------------------------- | ------------------------------------- | ---------------------------------- |
| Bill in Feb, Deliver in Mar | ✅ Delivery date = Feb-28 (05:30 AM)  | ✅ Delivery date = Mar-01 (actual) |
| Bill in Mar, Deliver in Mar | ✅ No backdate (same month)           | ✅ Delivery date = Mar-01 (actual) |
| Manual delivery (any day)   | ✅ Allowed (prev month backdate only) | ✅ Allowed anytime                 |
| Auto-delivery cron (1-4th)  | ✅ Previous month bills only          | ❌ No auto-delivery                |

---

## Problem Statement

### Historical Challenge

Before backdate billing was implemented:

- Bills generated in one month but delivered in the next month would use the **next month's delivery date** for all calculations
- This caused RBP multiplier calculations to be incorrect
- Distributors earned points at wrong multiplier rates based on delivery month, not billing month

### Example

**Without Backdate Billing:**

```
Bill Generated:  Feb 15 (Multiplier 2x for Feb)
Delivered:       Mar 01 (Multiplier 1x for Mar)
Result:          Points calculated at 1x (incorrect)
```

**With Backdate Billing:**

```
Bill Generated:  Feb 15 (Multiplier 2x for Feb)
Delivered:       Mar 01
Recorded As:     Feb 28 05:30 AM (Multiplier 2x for Feb)
Result:          Points calculated at 2x (correct)
```

---

## Solution Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ BILL CREATED                                                    │
│ createdAt = Bill generation timestamp                           │
└────────────┬────────────────────────────────────────────────────┘
             │
             ├─→ Admin enables "enableBackdateBilling=true" in settings
             │   ↓
             │   ②③④ Only activates/deactivates backdate logic
             │       (does not update existing pending bills)
             │
             ├─→ Manual Delivery (Any day)
             │   ↓
             │   ⑤ calculateBackdateFields() called
             │   ↓
             │   If setting ON + previous-month bill: deliveryDate = month-end
             │   Else: deliveryDate = actual
             │
             └─→ Auto-Deliver Cron (4:05 AM on 1st-4th)
                 ↓
                 ① Check enableBackdateBilling setting
                 ↓
                 ② Filter previous-month bills by createdAt
                 ↓
                 ③ Limit: 100 bills on days 1-3, all on day 4
                 ↓
                 ④ Force backdate: deliveryDate = month-end of bill creation
                 ↓
                 ⑤ Create inventory adjustments with backdated date
                 ↓
                 ⑥ Create ledger entries using deliveryDate
                 ↓
                 ⑦ Update RBP multiplier points using backdated date
```

---

## System Components

### 1. **backdateHelper.js** - Core Calculation Engine

**Location:** `utils/backdateHelper.js`  
**Purpose:** Calculate backdate fields for any bill delivery operation

**Function:** `calculateBackdateFields(billCreatedDate, actualDeliveryDate, enableBackdateBilling, autoPendingBillCronSetAt)`

**Parameters:**

- `billCreatedDate` (Date): When bill was generated
- `actualDeliveryDate` (Date): When bill is being delivered (default: now)
- `enableBackdateBilling` (Boolean): Setting flag (default: false)
- `autoPendingBillCronSetAt` (Date): When auto-delivery cron was configured (optional)

**Returns:**

```javascript
{
  deliveryDate: Date,           // Date for multiplier calculations
  originalDeliveryDate: Date,   // Actual delivery date for audit
  enabledBackDate: Boolean      // Whether backdate was applied
}
```

**Logic Flow:**

```
1. Check if bill and delivery in DIFFERENT months
2. Check if delivery in NEXT month after billing month
3. Check if bill created AFTER auto-delivery cron was set
4. If ALL conditions true AND enableBackdateBilling=true:
   → Return month-end of billing month at 05:30 AM IST
5. Else:
   → Return actual delivery date
```

**Key Code:**

```javascript
const shouldApplyBackdate =
  enableBackdateBilling === true && // Setting enabled
  isDifferentMonth && // Different months
  isNextMonth; // Previous-month delivery window

if (shouldApplyBackdate) {
  return {
    deliveryDate: createdMoment.endOf("month").hour(5).minute(30).toDate(),
    originalDeliveryDate: actualDeliveryDate,
    enabledBackDate: true,
  };
}
```

**Important Constraint:** Backdate applies only in the previous-month delivery window. Current-month and older-than-previous-month bills use real-time delivery date.

---

### 2. **manualDeliveryValidator.js** - Manual Delivery Validation

**Location:** `utils/manualDeliveryValidator.js`  
**Purpose:** Validate when manual delivery is allowed based on backdate setting

**Key Function:** `validateManualDelivery(distributorId, billId)`

**Returns:**

```javascript
{
  allowed: Boolean,
  reason: String,
  setting: Object,
  isGracePeriod: Boolean
}
```

**Logic:**

| Backdate Setting | Bill Month at Delivery Time | Manual Delivery | Date Used                             |
| ---------------- | --------------------------- | --------------- | ------------------------------------- |
| OFF (false)      | Any                         | ✅ Allowed      | Real-time                             |
| ON (true)        | Previous month              | ✅ Allowed      | Backdated to month-end (05:30 AM IST) |
| ON (true)        | Current month               | ✅ Allowed      | Real-time                             |
| ON (true)        | Older than previous month   | ✅ Allowed      | Real-time                             |

---

### 3. **billDeliverySetting.model.js** - Data Model

**Location:** `models/billDeliverySetting.model.js`

**Key Fields:**

```javascript
{
  distributorId: ObjectId (required, unique),
  isActive: Boolean (default: true),
  enableBackdateBilling: Boolean (default: false),
  deliveryDurationDays: Number (1-30 days),
  createdBy: ObjectId (User reference),
  updatedBy: ObjectId (User reference),
  notes: String,
  createdAt: Date,
  updatedAt: Date
}
```

**enableBackdateBilling Field:**

- **Default:** `false` (backdate disabled for safety)
- **When TRUE:**
  - Auto-deliver cron processes only previous-month bills
  - Previous-month delivered bills get delivery date = month-end of creation
  - Current/older bills use real-time delivery date
  - RBP multiplier uses backdated month
- **When FALSE:**
  - NO auto-deliver cron processing (manual only)
  - Delivery date = actual delivery time
  - RBP multiplier uses actual month
  - Manual delivery allowed anytime

---

### 4. **autoPendingBillDelivery.controller.js** - Cron Processor

**Location:** `controllers/RBP-controller/bill/autoPendingBillDelivery.controller.js`

**Trigger:** Cron job runs at 04:05 AM IST daily via `autoPendingBillDeliveryCron.js`

**Entry Point:** `autoPendingBillDelivery()` function

**Cron Schedule:** `"5 0 4 * *"` = 04:05 AM every day

**Day-of-Month Logic:**

```javascript
const dayOfMonth = moment.tz("Asia/Kolkata").date();

if (dayOfMonth < 1 || dayOfMonth > 4) {
  console.log("❌ Auto-deliver only runs on 1st-4th of month");
  return;
}
```

**Batch Limiting:**

```javascript
let batchLimit = 100; // Default for days 1-3

if (dayOfMonth === 4) {
  batchLimit = Infinity; // Day 4: No limit, process all remaining
}

const bills = await Bill.find({ query }).limit(batchLimit);
```

**Previous-Month Filtering:**

```javascript
// Get first and last day of previous month (by bill creation date)
const firstDayOfPrevMonth = moment()
  .tz("Asia/Kolkata")
  .subtract(1, "month")
  .startOf("month")
  .toDate();

const lastDayOfPrevMonth = moment()
  .tz("Asia/Kolkata")
  .subtract(1, "month")
  .endOf("month")
  .toDate();

// Query only bills created in previous month
const query = {
  status: { $in: ["Pending", "Partially-Delivered"] },
  createdAt: {
    $gte: firstDayOfPrevMonth,
    $lte: lastDayOfPrevMonth,
  },
};
```

**Force-Backdate Logic:**

```javascript
if (deliverySetting.enableBackdateBilling === true) {
  const forcedBackdateDeliveryDate = moment
    .tz(bill.createdAt, "Asia/Kolkata")
    .endOf("month")
    .toDate();

  backdateFields.deliveryDate = forcedBackdateDeliveryDate;
  backdateFields.originalDeliveryDate = actualDeliveryDate;
  backdateFields.enabledBackDate = true;

  bill.dates.deliveryDate = backdateFields.deliveryDate;
  bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate;
  bill.enabledBackDate = backdateFields.enabledBackDate;
}
```

**Processing Steps for Each Bill:**

1. ✅ Skip if backdate billing disabled
2. ✅ Calculate backdate fields
3. ✅ Force-backdate to bill creation month-end
4. ✅ Adjust inventory (decrement stock)
5. ✅ Create stock ledger entries (using backdated date)
6. ✅ Create financial ledger entries (debit/credit, using backdated date)
7. ✅ Update RBP points (using backdate date)
8. ✅ Update bill status to "Delivered" or "Partially-Delivered"
9. ✅ Create transaction records (inventory, ledger, RBP)

---

### 5. **deliverBillUpdate.js** - Manual Delivery Handler

**Location:** `controllers/RBP-controller/bill/deliverBillUpdate.js`

**Purpose:** Handle manual bill delivery with backdate support

**Entry Point:** `deliverBillManually()` or `deliverSingleBill()` functions

**Key Steps:**

1. Validate manual delivery is allowed via `validateManualDelivery()`
2. Check if backdate billing enabled for distributor
3. Calculate backdate fields using `calculateBackdateFields()`
4. Adjust inventory using backdated date if applicable
5. Create ledger entries using backdated date
6. Update RBP points using backdated date
7. Mark bill as delivered

**Backdate Application:**

```javascript
const enableBackdateBilling = setting?.enableBackdateBilling === true;

const backdateFields = buildBackdateFields(
  bill,
  enableBackdateBilling,
  new Date(), // actualDeliveryDate
  autoPendingBillCronSetAt,
);

// Store for later use in transactions
bill.backdateFields = backdateFields;
bill.dates.deliveryDate = backdateFields.deliveryDate;
bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate;
bill.enabledBackDate = backdateFields.enabledBackDate;
```

---

### 6. **createSalesReturn.js** - Sales Return Handler

**Location:** `controllers/RBP-controller/salesReturn/createSalesReturn.js`

**Purpose:** Handle sales returns with backdate support

**Backdate Application:**

```javascript
const deliverySetting = await BillDeliverySetting.findOne({
  distributorId: distributor._id,
});

const enableBackdateBilling = deliverySetting?.enableBackdateBilling === true;

const backdateFields = calculateBackdateFields(
  bill.createdAt,
  new Date(), // actualReturnDate
  enableBackdateBilling,
);

if (backdateFields.enabledBackDate) {
  // Sales return date = month-end of bill creation
  salesReturnData.salesReturnDate = backdateFields.deliveryDate;
  salesReturnData.originalSalesReturnDate = backdateFields.originalDeliveryDate;
  salesReturnData.enabledBackDate = backdateFields.enabledBackDate;

  // Set timestamps to backdated date for multiplier calculations
  salesReturnData.createdAt = backdateFields.deliveryDate;
  salesReturnData.updatedAt = backdateFields.deliveryDate;
}
```

---

### 7. **adminBillDeliverySettings.js** - Settings Management

**Location:** `controllers/billDelivery/adminBillDeliverySettings.js`

**Purpose:** Admin API to configure backdate billing per distributor

**Key Endpoints:**

#### SET Single Distributor Setting

```
POST /api/v2/billDeliverySetting
Body: {
  distributorId: "xxx",
  enableBackdateBilling: true,
  isActive: true,
  deliveryDurationDays: 7,
  notes: "Enabled backdate billing"
}
```

**Action:**

1. Create or update BillDeliverySetting
2. `enableBackdateBilling` only controls whether backdate logic is active.
3. Existing pending bills are not modified here.

#### SET All Distributors Setting

```
POST /api/v2/billDeliverySetting/all
Body: {
  enableBackdateBilling: true,
  isActive: true,
  deliveryDurationDays: 7,
  notes: "Mass configuration"
}
```

**Action:**

1. Bulk upsert BillDeliverySetting for all distributors
2. `enableBackdateBilling` only controls whether backdate logic is active.
3. Existing pending bills are not modified here.

---

## Code Logic & Implementation

### Backdate Field Calculation Algorithm

```javascript
FUNCTION calculateBackdateFields(
  billCreatedDate,
  actualDeliveryDate = NOW,
  enableBackdateBilling = false,
  autoPendingBillCronSetAt = null
)

  createdMoment = CONVERT_TO_IST(billCreatedDate)
  deliveryMoment = CONVERT_TO_IST(actualDeliveryDate)

  // Condition 1: Different month?
  isDifferentMonth =
    createdMoment.YYYY-MM != deliveryMoment.YYYY-MM

  // Condition 2: Delivery in NEXT month after billing?
  nextMonthStart = createdMoment.ADD(1, month).START_OF_MONTH
  nextMonthEnd = createdMoment.ADD(1, month).END_OF_MONTH
  isNextMonth =
    deliveryMoment >= nextMonthStart AND
    deliveryMoment <= nextMonthEnd

  // DECISION LOGIC
  shouldApplyBackdate =
    enableBackdateBilling == true AND
    isDifferentMonth == true AND
    isNextMonth == true

  IF shouldApplyBackdate:
    lastDateOfBillingMonth =
      createdMoment.END_OF_MONTH.HOUR(5).MINUTE(30)

    RETURN {
      deliveryDate: lastDateOfBillingMonth,
      originalDeliveryDate: actualDeliveryDate,
      enabledBackDate: true
    }
  ELSE:
    RETURN {
      deliveryDate: actualDeliveryDate,
      originalDeliveryDate: actualDeliveryDate,
      enabledBackDate: false
    }

END FUNCTION
```

### Automatic Process Execution

**When Auto-Deliver Cron Runs:**

```
DO FOR EVERY DISTRIBUTOR WITH enableBackdateBilling=true:

  DO FOR EVERY PREVIOUS-MONTH PENDING BILL (LIMITED BY DAY):

    1. Retrieve bill
       ├─ Bill must exist in collections.Bill
       └─ createdAt must be in previous month

    2. Check delivery setting
       ├─ Get BillDeliverySetting for this distributor
       └─ Verify enableBackdateBilling = true

    3. Calculate backdate fields
       ├─ Call calculateBackdateFields()
       ├─ Force deliveryDate = month-end of bill.createdAt
       ├─ Force originalDeliveryDate = NOW
       └─ Force enabledBackDate = true

    4. Adjust inventory (Step 1)
       ├─ FOR EACH line item in bill:
       │  ├─ Find inventory record
       │  ├─ Check if available qty >= bill qty
       │  ├─ Decrement available qty
       │  ├─ Create Inventory Adjustment record
       │  └─ Record status: "completed" or "partial"
       │
       └─ If ANY item fails: RETRY UP TO 3 TIMES

    5. Create ledger entries (Step 2)
       ├─ Check if ledger entry already exists
       ├─ Calculate amounts (debit/credit)
       ├─ Create Ledger record with:
       │  ├─ transactionDate = backdateFields.deliveryDate
       │  ├─ dates: { deliveryDate, originalDeliveryDate }
       │  ├─ enabledBackDate: true
       │  └─ Amount fields
       │
       └─ For DistributorTransaction, RetailerOutletTransaction:
          ├─ Create transaction record
          ├─ Use backdateFields.deliveryDate
          └─ Update running balances

    6. Update RBP multiplier points (Step 3)
       ├─ Call updateDistributorTransactionPoints()
       ├─ Pass backdateFields.deliveryDate
       ├─ Calculate points based on backdated month
       ├─ Update DistributorTransaction balance
       └─ Update Ledger balance

    7. Update bill status
       ├─ Set bill.status = "Delivered" or "Partially-Delivered"
       ├─ Set bill.dates.deliveryDate = backdateFields.deliveryDate
       ├─ Set bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate
       ├─ Set bill.enabledBackDate = true
       └─ Save Bill

    8. Record result
       ├─ Success: Count successful bill
       ├─ Failure: Log error and retry if retriable
       └─ Partial: Track partial delivery count

END FOR

RETURN SUMMARY:
  ├─ Total processed
  ├─ Successful deliveries
  ├─ Failures
  ├─ Partial deliveries
  └─ Skipped bills
```

---

## Workflow Scenarios

### Scenario 1: Backdate Billing Enabled (Normal Case)

**Timeline:**

```
Feb 15: Bill created (bill.createdAt = Feb 15)
        Distributor has enableBackdateBilling=true ✓

Mar 02: Cron runs on 2nd (within 1-4 range) ✓
        Bill found (createdAt in Feb range) ✓
        Billing Setup Skip check enableBackdateBilling=true ✓

Current date:  Mar 02
Billing month: Feb
Delivery in:   Next month (Mar) ✓

Action:
  • deliveryDate = Feb 28, 05:30 AM
  • originalDeliveryDate = Mar 02, 10:15 AM (actual)
  • enabledBackDate = true

Result:
  • Stock inventory adjusted on Feb 28
  • RBP points calculated on Feb month
  • Ledger entries for Feb
  • Distributor bill marked as delivered (Mar 02)
  • Bill shows delivery month as Feb internally
```

**RBP Impact:**

- Bill from Feb multiplier: 2x
- Points earned: Base × 2x (calculated using Feb 28 as reference)
- Account shows delivery in Feb (for RBP purposes)
- Audit trail shows actual delivery: Mar 02

---

### Scenario 2: Backdate Disabled (Legacy Case)

**Timeline:**

```
Feb 15: Bill created (bill.createdAt = Feb 15)
        Distributor has enableBackdateBilling=false ✗

Mar 02: Cron runs on 2nd
        Bill NOT processed by cron ✗

Mar 05: Manual delivery triggered
        validateManualDelivery() called
        Response: allowed=true (no restrictions)

Action:
  • deliveryDate = Mar 05, 10:15 AM (actual)
  • originalDeliveryDate = Mar 05, 10:15 AM
  • enabledBackDate = false

Result:
  • Stock inventory adjusted on Mar 05
  • RBP points calculated on Mar month
  • Ledger entries for Mar
  • Distributor bill marked as delivered (Mar 05)
  • Bill shows delivery month as Mar
```

**RBP Impact:**

- Bill from Feb multiplier: 1x (Mar month used)
- Points earned: Base × 1x (calculated using Mar 05 as reference)
- Account shows delivery in Mar
- Lower rewards than Feb delivery would have given

---

### Scenario 3: Manual Delivery with Setting ON

**Timeline:**

```
Feb 15: Bill created and pending

Mar 02: Admin manually delivers bill
        validateManualDelivery() called
  Response: allowed=true

Action (if enableBackdateBilling=true):
  • deliveryDate = Feb 28, 05:30 AM (backdate applied)
  • originalDeliveryDate = Mar 02 (actual)
  • enabledBackDate = true

Mar 05: Admin tries to manually deliver another Feb bill
        validateManualDelivery() called
        Response: allowed=true

Action (if enableBackdateBilling=true):
  • IF bill from Feb:
    • Check: Is it? Yes (Feb bill)
    • Decision: Can deliver? Yes
    • Applied: backdate=true (logic still applies)
    • Note: Previous-month bill always uses backdate while setting is ON
```

---

### Scenario 4: Older-than-Previous-Month Bill

**Timeline:**

```
Jan 15: Bill created (bill.createdAt = Jan 15)

Mar 02: Delivery attempt happens in March
  Bill check:
  • bill month = January
  • previous month of March = February
  • Is bill from previous month? NO
  Result: Backdate logic NOT applied ✓

Action:
  • deliveryDate = Mar 02 (actual, no backdate)
  • originalDeliveryDate = Mar 02
  • enabledBackDate = false

Reason: Older-than-previous-month bills always use real-time delivery date.
```

---

## Database Model

### Bill Document Structure (Relevant Fields)

```javascript
{
  _id: ObjectId,
  billNo: String,
  new_billno: String,
  distributorId: ObjectId (ref: Distributor),
  createdAt: Date (billing date),

  // Status tracking
  status: "Pending" | "Partially-Delivered" | "Delivered",

  // Backdate fields (added by backdate logic)
  enabledBackDate: Boolean,

  dates: {
    deliveryDate: Date (used for multiplier calc),
    originalDeliveryDate: Date (actual delivery),
    ...other dates
  },

  // Line items
  lineItems: [{
    product: ObjectId,
    billQty: Number,
    inventoryId: ObjectId,
    itemBillType: String,
    ...
  }],

  // Reference to helper fields
  backdateFields: {
    deliveryDate: Date,
    originalDeliveryDate: Date,
    enabledBackDate: Boolean
  }
}
```

### BillDeliverySetting Collection

```javascript
db.billdeliverysettings.createIndex({ distributorId: 1 }, { unique: true })

{
  _id: ObjectId,
  distributorId: ObjectId (unique),
  isActive: Boolean (default: true),
  enableBackdateBilling: Boolean (default: false),
  deliveryDurationDays: Number (1-30),
  createdBy: ObjectId (User),
  updatedBy: ObjectId (User),
  notes: String,
  createdAt: Date,
  updatedAt: Date,
  __v: Number
}
```

### Key Relationships

```
┌─────────────────────────────────────────────────────────┐
│ DISTRIBUTOR                                             │
│ has unique: BillDeliverySetting.enableBackdateBilling   │
└────────────────────┬────────────────────────────────────┘
                     │ 1 (setting per distributor)
                     │
         ┌───────────┴──────────┐
         │                      │
    YES │                       │ NO
         │                      │
    [Backdate ON]          [Backdate OFF]
         │                      │
         ├─ Auto-delivery       ├─ Manual only
         │  Cron runs           │  No cron
         │  Previous month      │
         │  bills only          │
         │                      │
         ├─ Manual              ├─ Manual
         │  Any day             │  Anytime
         │  Prev month backdate │
         │  Others real-time    │
         │                      │
         └── → Bill.enabledBackDate = true
              Bill.dates.deliveryDate = month-end
              Bill.dates.originalDeliveryDate = actual
```

---

## Configuration & Settings

### How to Enable Backdate Billing

#### Method 1: API - Single Distributor

```bash
API Endpoint: POST /api/v2/billDeliverySetting

Request Body:
{
  "distributorId": "507f1f77bcf86cd799439011",
  "enableBackdateBilling": true,
  "isActive": true,
  "deliveryDurationDays": 7,
  "notes": "Enabled backdate billing for accurate RBP calculations"
}

Response:
{
  "error": false,
  "message": "Bill delivery setting created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "distributorId": "507f1f77bcf86cd799439011",
    "enableBackdateBilling": true,
    "isActive": true,
    "deliveryDurationDays": 7,
    "createdAt": "2026-03-12T10:30:00Z",
    "updatedAt": "2026-03-12T10:30:00Z"
  }
}

Side Effect:
✓ Backdate logic activation state is saved for this distributor.
✓ `enabledBackDate` remains a delivery-time tracking field on each bill.
```

#### Method 2: API - All Distributors

```bash
API Endpoint: POST /api/v2/billDeliverySetting/all

Request Body:
{
  "enableBackdateBilling": true,
  "isActive": true,
  "deliveryDurationDays": 7,
  "notes": "Mass configuration"
}

Response:
{
  "error": false,
  "message": "Bill delivery settings applied to all distributors",
  "data": {
    "total": 450,
    "configured": 450,
    "matched": 250,
    "modified": 250,
    "upserted": 200
  }
}

Side Effect:
✓ Backdate logic activation state is saved across all distributors.
✓ `enabledBackDate` remains a delivery-time tracking field on each bill.
```

#### Method 3: Get Current Settings

```bash
GET /api/v2/billDeliverySetting/{distributorId}

Response:
{
  "error": false,
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "distributorId": {
      "_id": "507f1f77bcf86cd799439011",
      "name": "ABC Distributor",
      "dbCode": "ABC001"
    },
    "enableBackdateBilling": true,
    "isActive": true,
    "deliveryDurationDays": 7,
    "createdAt": "2026-03-12T10:30:00Z",
    "updatedAt": "2026-03-12T10:30:00Z"
  }
}
```

---

## API Endpoints

### Bill Delivery Settings Management

| Method | Endpoint                                      | Purpose                                  |
| ------ | --------------------------------------------- | ---------------------------------------- |
| POST   | `/api/v2/billDeliverySetting`                 | Create/update single distributor setting |
| GET    | `/api/v2/billDeliverySetting/{distributorId}` | Get setting for one distributor          |
| GET    | `/api/v2/billDeliverySetting`                 | Get all settings                         |
| POST   | `/api/v2/billDeliverySetting/all`             | Bulk apply setting to all distributors   |
| DELETE | `/api/v2/billDeliverySetting/{distributorId}` | Delete setting                           |

### Bill Delivery Operations

| Method | Endpoint                                  | Purpose             | Backdate Support |
| ------ | ----------------------------------------- | ------------------- | ---------------- |
| POST   | `/api/v2/bill/deliver`                    | Manual delivery     | ✅ Yes           |
| POST   | `/api/v2/bill/auto-deliver-pending-bills` | Auto-deliver cron   | ✅ Yes           |
| POST   | `/api/v2/bill/{billId}/deliver`           | Deliver single bill | ✅ Yes           |
| POST   | `/api/v2/salesReturn`                     | Create sales return | ✅ Yes           |

---

## Testing & Validation

### Test Scenario 1: Basic Backdate Calculation

```javascript
const { calculateBackdateFields } = require("utils/backdateHelper");
const moment = require("moment-timezone");

// Test: Feb bill, Mar delivery
const billCreatedDate = new Date("2026-02-15");
const actualDeliveryDate = new Date("2026-03-02");

const result = calculateBackdateFields(
  billCreatedDate,
  actualDeliveryDate,
  true, // enableBackdateBilling
);

assert.equal(result.enabledBackDate, true);
assert.equal(moment(result.deliveryDate).format("YYYY-MM-DD"), "2026-02-28");
assert.equal(
  moment(result.originalDeliveryDate).format("YYYY-MM-DD"),
  "2026-03-02",
);
```

### Test Scenario 2: Same Month (No Backdate)

```javascript
// Test: Feb bill, Feb delivery (same month)
const result = calculateBackdateFields(
  new Date("2026-02-15"),
  new Date("2026-02-28"),
  true, // enableBackdateBilling enabled but same month
);

assert.equal(result.enabledBackDate, false);
assert.equal(moment(result.deliveryDate).format("YYYY-MM-DD"), "2026-02-28");
```

### Test Scenario 3: Disabled Setting

```javascript
// Test: Backdate disabled
const result = calculateBackdateFields(
  new Date("2026-02-15"),
  new Date("2026-03-02"),
  false, // enableBackdateBilling disabled
);

assert.equal(result.enabledBackDate, false);
assert.equal(moment(result.deliveryDate).format("YYYY-MM-DD"), "2026-03-02");
```

### Test Scenario 4: Older-than-Previous-Month (No Backdate)

```javascript
// Test: Bill created older than previous month
const billCreatedDate = new Date("2026-01-15");

const result = calculateBackdateFields(
  billCreatedDate,
  new Date("2026-03-02"),
  true, // enableBackdateBilling
);

// Should NOT apply backdate (older than previous month)
assert.equal(result.enabledBackDate, false);
```

### Integration Test: Cron Delivery

```javascript
// Setup
await BillDeliverySetting.create({
  distributorId: distId,
  enableBackdateBilling: true,
  isActive: true
});

const bill = await Bill.create({
  billNo: "TEST001",
  distributorId: distId,
  status: "Pending",
  createdAt: new Date("2026-02-15"),  // Previous month
  lineItems: [...]
});

// Run cron
const result = await autoPendingBillDelivery();

// Verify
const updatedBill = await Bill.findById(bill._id);
assert.equal(updatedBill.status, "Delivered");
assert.equal(updatedBill.enabledBackDate, true);
assert.equal(
  moment(updatedBill.dates.deliveryDate).format("YYYY-MM-DD"),
  "2026-02-28"
);

// Verify ledger entries used backdated date
const ledger = await Ledger.findOne({
  billId: bill._id
});
assert.equal(
  moment(ledger.transactionDate).format("YYYY-MM-DD"),
  "2026-02-28"
);
```

---

## Edge Cases & Constraints

### 1. Timezone Handling

**Constraint:** All backdate calculations use `moment.tz("Asia/Kolkata")`

**Issue:** Different timezones might interpret "end of month" differently
**Solution:** Hardcoded IST (UTC+5:30) for all calculations
**Code:**

```javascript
const moment = require("moment-timezone");
const backdateDate = moment
  .tz(billCreatedDate, "Asia/Kolkata")
  .endOf("month")
  .hour(5)
  .minute(30)
  .toDate();
```

---

### 2. Batch Delivery Limits

**Constraint:** Days 1-3 process maximum 100 bills, Day 4 processes all remaining

**Scenario:** 500 pending bills exist for a distributor

```
Mar 01 (Day 1): Process 100 bills → 400 remaining
Mar 02 (Day 2): Process 100 bills → 300 remaining
Mar 03 (Day 3): Process 100 bills → 200 remaining
Mar 04 (Day 4): Process 200 bills → 0 remaining ✓
```

**Implementation:**

```javascript
const dayOfMonth = moment.tz("Asia/Kolkata").date();
let batchLimit = (dayOfMonth >= 1 && dayOfMonth <= 3) ? 100 : Infinity;
const bills = await Bill.find({...}).limit(batchLimit);
```

---

### 3. Duplicate Delivery Prevention

**Risk:** Same bill delivered twice (idempotency issue)

**Control 1: Status Check**

```javascript
if (bill.status === "Delivered") {
  console.log("Bill already delivered");
  return; // Skip
}
```

**Control 2: Ledger Existence Check**

```javascript
const exists = await Ledger.exists({
  billId: bill._id,
  dbId: userId,
  transactionFor: "Sales",
});
if (exists) {
  console.log("Ledger entry already exists");
  return; // Skip
}
```

**Control 3: Unique Constraint on Inventory Adjustment**

```javascript
const adjustmentExists = await InventoryAdjustment.exists({
  billId: bill._id,
  lineItemId: lineItem._id,
  type: "Bill Delivery",
});
```

---

### 4. Previous-Month Window Guard

**Risk:** Incorrectly backdating current-month or very old bills

**Control:**

```javascript
const shouldApplyBackdate =
  enableBackdateBilling === true && isDifferentMonth && isNextMonth; // immediate next month only
```

**Rationale:** Only previous-month bills are backdated; current/older bills stay real-time.

---

### 5. Partial Delivery Handling

**Scenario:** Bill with 10 line items, only 6 delivered

```javascript
Bill Status: "Partially-Delivered"
items[0-5]: Delivered (status: "completed")
items[6-9]: Pending (status: "pending")

On Next Delivery:
- Only items[6-9] processed
- Same backdate fields applied
- Status updated based on remaining items
```

**Code:**

```javascript
const adjustableItems = bill.lineItems.filter(
  (item) => item.itemBillType !== "Item Removed" && item.billQty > 0,
);

const deliveredItems = adjustableItems.filter(
  (item) => item.deliveryStatus === "completed",
);

if (deliveredItems.length === adjustableItems.length) {
  bill.status = "Delivered";
} else if (deliveredItems.length > 0) {
  bill.status = "Partially-Delivered";
} else {
  bill.status = "Pending";
}
```

---

### 6. Non-Adjustable Items

**Definition:** Items that should NOT trigger inventory adjustment

- `itemBillType === "Item Removed"`
- `itemBillType === "Stock out"`
- `billQty <= 0`

**Code:**

```javascript
const isNonAdjustableItem = (item) =>
  item.itemBillType === "Item Removed" ||
  item.itemBillType === "Stock out" ||
  Number(item.billQty) <= 0;

const adjustableItems = bill.lineItems.filter(
  (item) => !isNonAdjustableItem(item),
);
```

---

### 7. Transaction Ordering & Consistency

**Issue:** If cron stops mid-process, what happens to partial updates?

**Control: Step-based Processing**

1. **Inventory Adjustment** - Record FIRST (if fails, retry)
2. **Ledger Entry Creation** - Record SECOND (uses adjusted data)
3. **RBP Points Update** - Record THIRD (uses ledger data)
4. **Bill Status Update** - Record LAST (marks complete)

**Atomicity:**

- Each step is wrapped in try-catch
- Failed steps trigger retry logic (up to 3 times)
- Non-retriable errors logged, process continues for other bills
- Each success marks progress (prevents re-processing)

---

### 8. Multiplier Calculation Timing

**Critical:** RBP multiplier uses the `deliveryDate` field

```javascript
// In multiplier calculation function
const multiplierMonth = moment(bill.dates.deliveryDate).month();

// If bill backdated to Feb 28:
// multiplierMonth = FEBRUARY
// Result: Points multiplied by Feb multiplier (e.g., 2x)

// If NOT backdated and delivery on Mar 02:
// multiplierMonth = MARCH
// Result: Points multiplied by Mar multiplier (e.g., 1x)
```

**Ensure:** All transactions created with `backdateFields.deliveryDate`

---

### 9. Month-Window Boundary Case

**Edge Case:** What happens at midnight month-end when setting is ON?

```javascript
Now: Feb 28, 11:59 PM IST
Bill created in Feb, delivered in Mar
Result: Previous-month condition is true, backdate applies ✓

Now: Mar 01, 00:05 AM IST
Bill created in Mar, delivered in Mar
Result: Same-month condition, no backdate (real-time) ✓

Now: Apr 10, 12:00 AM IST
Bill created in Jan, delivered in Apr
Result: Older-than-previous-month condition, no backdate (real-time) ✓
```

---

### 10. Toggle Consistency

`enableBackdateBilling` is configuration only.

`enabledBackDate` is a bill-level delivery result field and is set while processing each delivery.

---

## Summary

### Key Takeaways

1. **Backdate Billing** = Recording cross-month bills as if they were delivered in the billing month
2. **Conditions for Application:**
   - Setting enabled: `enableBackdateBilling = true`

- Bill must be from previous month at delivery time
- Current-month and older bills are delivered in real-time

3. **Automation:** Runs on 1st-4th of month via cron (100 bills/day days 1-3, unlimited day 4)
4. **Manual Delivery:** Allowed anytime; backdate is applied only for previous-month bills when setting is ON
5. **Impact:** RBP multiplier calculated using backdated month, not delivery month
6. **Safety:** Multiple controls prevent double-delivery, retroactive changes, data corruption

### Files Involved

- **backdateHelper.js** - Calculation logic
- **manualDeliveryValidator.js** - Permission rules
- **billDeliverySetting.model.js** - Configuration schema
- **autoPendingBillDelivery.controller.js** - Auto-delivery cron
- **deliverBillUpdate.js** - Manual delivery
- **createSalesReturn.js** - Sales return handling
- **adminBillDeliverySettings.js** - Admin configuration API

### Configuration

- Enable per distributor via API: `POST /api/v2/billDeliverySetting`
- Enable for all distributors via API: `POST /api/v2/billDeliverySetting/all`
- Toggle only controls whether backdate logic is active
- `enabledBackDate` is set during delivery processing, not by settings update
- Independent of `isActive` flag (both operate independently)

---

**Document Version:** 2.0  
**Last Updated:** March 12, 2026  
**Author:** Development Team  
**Status:** Production Ready for Implementation
