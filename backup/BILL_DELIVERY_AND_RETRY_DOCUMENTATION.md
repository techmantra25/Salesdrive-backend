# Bill Delivery & Retry Partial Bill - Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Key Concepts](#key-concepts)
4. [Bill Delivery System](#bill-delivery-system)
5. [Retry Partial Bill Mechanism](#retry-partial-bill-mechanism)
6. [RBP-Controller Components](#rbp-controller-components)
7. [Database Schema](#database-schema)
8. [API Endpoints](#api-endpoints)
9. [Error Handling](#error-handling)
10. [Workflows & Examples](#workflows--examples)
11. [Troubleshooting](#troubleshooting)
12. [Best Practices](#best-practices)

---

## Overview

The **Bill Delivery & Retry System** is an automated mechanism in the Rupa DMS backend that:

- **Tracks bill delivery status** across distributors and retailers
- **Identifies partially-delivered bills** that fail initial delivery attempts
- **Automatically retries failed items** using cron jobs
- **Manages inventory adjustments** and financial transactions
- **Ensures data consistency** across ledgers and transaction logs
- **Handles backdate billing** for compliance with business rules

### Core Purpose

Bills must be fully delivered to complete the transaction lifecycle. When bills have items that cannot be delivered due to inventory or validation issues, the system:

1. Marks the bill as `Partially-Delivered`
2. Queues failed items for retry
3. Automatically retries using scheduled cron jobs
4. Tracks all attempts and updates state accordingly

### Business Impact

- **Revenue Recognition**: Ensures all transactions are properly recorded
- **Inventory Accuracy**: Maintains accurate stock levels across distribution chain
- **Financial Compliance**: Proper ledger entries for all deliveries
- **Distributor Accountability**: Enforces timely delivery of bills

---

## System Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│          BILL DELIVERY & RETRY SYSTEM                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────┐      ┌──────────────────────┐      │
│  │  Bill Management     │      │  RBP-Controller      │      │
│  │  ─────────────────   │      │  ─────────────────   │      │
│  │  - Create Bill       │      │  - Auto Delivery     │      │
│  │  - Update Status     │      │  - Bulk Retry        │      │
│  │  - Track Items       │      │  - Partial Delivery  │      │
│  └──────────────────────┘      └──────────────────────┘      │
│                                                               │
│  ┌──────────────────────┐      ┌──────────────────────┐      │
│  │  Transaction Layer   │      │  Ledger & Finance    │      │
│  │  ─────────────────   │      │  ─────────────────   │      │
│  │  - Inventory Adjust  │      │  - Credit Balance    │      │
│  │  - Stock Ledger      │      │  - Debit Balance     │      │
│  │  - Reward Transfer   │      │  - Transaction Log   │      │
│  └──────────────────────┘      └──────────────────────┘      │
│                                                               │
│  ┌──────────────────────┐      ┌──────────────────────┐      │
│  │  Cron Jobs           │      │  Backdate Helper     │      │
│  │  ─────────────────   │      │  ─────────────────   │      │
│  │  - Schedule Retries  │      │  - Calculate Dates   │      │
│  │  - Batch Processing  │      │  - Validate Rules    │      │
│  └──────────────────────┘      └──────────────────────┘      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. BILL CREATION
   ↓
   Invoice → Bill Record → Line Items

2. DELIVERY ATTEMPT
   ↓
   Validate Items → Adjust Inventory → Create Transactions → Update Ledger
   ↓
   Success? → Bill Status = "Delivered"
   ↓
   Partially? → Bill Status = "Partially-Delivered" → Queue for Retry

3. RETRY CYCLE (CRON)
   ↓
   Find Partially-Delivered Bills → Retry Failed Items → Update Status
   ↓
   All Items Delivered? → Mark "Delivered"
   ↓
   Still Failing? → Keep Retrying until Success/Threshold

4. COMPLETION
   ↓
   Update Ledger → Transfer Rewards → Archive Bill
```

---

## Key Concepts

### Bill Status States

| Status                  | Meaning                           | Next Steps           |
| ----------------------- | --------------------------------- | -------------------- |
| **Pending**             | Bill created, awaiting delivery   | Deliver to inventory |
| **Partially-Delivered** | Some items delivered, some failed | Retry failed items   |
| **Delivered**           | All items delivered successfully  | Archive & settle     |
| **Cancelled**           | Bill cancelled by admin           | No further action    |

### Delivery Mechanisms

#### 1. **Manual Delivery**

- Triggered manually by distributor or admin
- Validates all line items before delivery
- Creates transactions immediately
- Returns success/failure status

#### 2. **Auto Delivery (Cron)**

- Scheduled automatic delivery for pending bills
- Runs at configured intervals
- Processes eligible bills without manual intervention
- Updates status autonomously

#### 3. **Bulk Retry (Cron)**

- Targets **Partially-Delivered** bills only
- Retries **non-adjustable items** (Stock Out, Item Removed)
- Retries with `forceRetry=true` flag
- Handles inventory restock scenarios

### Backdate Billing

When `enableBackdateBilling = true`:

- Delivery date can be antedated to order creation date
- Supports business scenarios requiring historical deliveries
- Affects reward calculations and target achievement
- Validates date ranges (min: order date, max: current date)

---

## Bill Delivery System

### Overview

The bill delivery system manages the complete lifecycle of delivering bills from distributors to retailers. It handles inventory adjustments, financial transactions, and reward point calculations.

### Delivery Settings Model

```javascript
BillDeliverySetting {
  _id: ObjectId,
  distributorId: ObjectId,           // Reference to distributor
  deliveryDurationDays: Number,      // How many days to deliver (1-30)
  notes: String,                     // Admin notes
  isActive: Boolean,                 // Enable/disable delivery tracking
  enableBackdateBilling: Boolean,    // Allow antedated deliveries
  updatedBy: ObjectId,               // Admin user who last updated
  createdAt: Date,
  updatedAt: Date
}
```

### Delivery Configuration Controller

**File**: `controllers/billDelivery/adminBillDeliverySettings.js`

#### Endpoint: `setBillDeliverySetting`

Sets or updates bill delivery settings for a distributor.

**Request Body**:

```json
{
  "distributorId": "6789abcdef012345",
  "deliveryDurationDays": 7,
  "notes": "Standard delivery window",
  "isActive": true,
  "enableBackdateBilling": false
}
```

**Validation Rules**:

- `distributorId` is required
- If `isActive = true`:
  - `deliveryDurationDays` must be 1-30
  - All required fields must be present
- If `isActive = false`:
  - Distributor portal is unlocked
  - `portalLockReason` is set
  - No delivery enforcement applies

**Response**:

```json
{
  "error": false,
  "message": "Setting saved successfully",
  "data": {
    "_id": "...",
    "distributorId": "...",
    "deliveryDurationDays": 7,
    "isActive": true,
    "enableBackdateBilling": false
  }
}
```

#### Portal Locking Integration

When delivery settings are updated:

1. If `isActive = false`:
   - Distributor portal is **unlocked**
   - `portalLockReason` cleared
   - All bills released from delivery tracking
2. If `isActive = true`:
   - Existing overdue bills trigger lock automatically
   - Distributor cannot place orders until bills delivered
   - Lock released when all bills delivered within deadline

---

## Retry Partial Bill Mechanism

### Overview

The retry system handles the automatic and manual retrying of partially-delivered bills. When a bill delivery fails for some items, those items are queued for retry until successful or threshold reached.

### Non-Adjustable vs Adjustable Items

#### Non-Adjustable Items (Cannot Retry)

These items remain as status quo and skip the delivery process:

- **Item Removed**: Previously removed from bill by admin
- **Stock Out**: Inventory unavailable on delivery attempt
- **billQty ≤ 0**: Zero or negative quantity

These items:

- Are NOT included in retry operations
- Do NOT create inventory transactions
- Are reported separately in responses
- May be manually handled by admin

#### Adjustable Items (Can Retry)

All other line items that:

- Have valid product reference
- Have valid inventory reference
- Have positive quantity
- Have standard bill type

### Retry Mechanism: `billBulkRetry`

**File**: `controllers/RBP-controller/bill/billBulkRetry.js`

#### Purpose

Cron job that automatically retries all partially-delivered bills by attempting to deliver failed items.

#### Trigger

- Scheduled cron job (frequency configurable)
- Called manually via endpoint with explicit bill IDs
- Processes bills in batch

#### Request Body

```json
{
  "billIds": ["bill_id_1", "bill_id_2"], // Optional: specific bills
  "limit": 100 // Max bills per run (default: 100)
}
```

#### Processing Flow

```
1. QUERY PHASE
   └─ Find bills with status = "Partially-Delivered"
      └─ Filter by billIds (if provided)
      └─ Sort by updatedAt (oldest first)
      └─ Limit to specified batch size

2. BACKDATE CALCULATION
   └─ Load delivery settings for distributor
   └─ Calculate backdate fields
   └─ Determine delivery vs billing dates

3. FOR EACH BILL
   ├─ Extract adjustable items (skip non-adjustable)
   ├─ Attempt delivery of each item
   │  ├─ Adjust inventory
   │  ├─ Create transaction
   │  ├─ Update ledger
   │  └─ Handle errors per item
   ├─ Update bill status
   └─ Summary tracking

4. SUMMARY REPORTING
   └─ Total bills processed
   └─ Fully delivered count
   └─ Still partial count
   └─ Items retried/succeeded/failed
   └─ Rewards transferred
   └─ Error summary
```

#### Response Example

```json
{
  "error": false,
  "message": "Bulk retry completed",
  "summary": {
    "totalBills": 25,
    "delivered": 18,
    "stillPartial": 7,
    "itemsRetried": 45,
    "itemsSucceeded": 42,
    "itemsFailed": 3,
    "distributorRewardsTransferred": 18,
    "retailerRewardsTransferred": 18,
    "rewardsFailed": 0,
    "lowBalanceErrors": 0
  },
  "details": [
    {
      "billNo": "BL20240101001",
      "status": "Delivered",
      "itemsSucceeded": 8,
      "itemsFailed": 0
    }
  ]
}
```

#### Key Features

**Smart Item Filtering**:

- Automatically filters non-adjustable items
- Only retries items that can succeed
- Avoids redundant retry attempts

**Error Recovery**:

- Per-item error handling
- Non-retriable errors marked
- Continues processing despite individual failures
- Detailed error reporting

**Reward Management**:

- Calculates and transfers reward points
- Handles low balance scenarios
- Tracks failed reward transfers
- Updates distributor/retailer balance

**Backdate Support**:

- Calculates correct dates for historical deliveries
- Updates target achievements appropriately
- Validates backdate rules

---

## RBP-Controller Components

### File Structure

```
controllers/RBP-controller/
├── bill/
│   ├── autoPendingBillDelivery.controller.js
│   ├── billBulkRetry.js
│   └── deliverBillUpdate.js
├── distributorTransaction/
├── retailerMultiplier/
└── salesReturn/
```

### Component 1: `autoPendingBillDelivery.controller.js`

**Purpose**: Auto-delivery of pending bills via scheduled cron

**Main Function**: `autoPendingBillDelivery(req, res)`

```javascript
// Request body
{
  "billIds": [],    // Optional: target specific bills
  "limit": 100      // Max bills to process
}

// Selects bills with status = "Pending"
// Attempts delivery for all items
// Updates status to "Delivered" or "Partially-Delivered"
// Creates necessary transactions and ledger entries
```

#### Processing Logic

1. **Query existing pending bills** (sorted by createdAt)
2. **For each bill**:
   - Load related data (products, inventory)
   - Validate bill items
   - Adjust inventory for successful items
   - Handle failures for problematic items
3. **Create transactions**:
   - Inventory adjustments
   - Ledger entries (debit/credit)
   - Reward point transfers
4. **Update bill status**:
   - If all items delivered: `status = "Delivered"`
   - If some items failed: `status = "Partially-Delivered"`
   - Track failed items for bulk retry

#### Response Structure

```json
{
  "error": false,
  "message": "Auto delivery completed",
  "summary": {
    "totalBills": 50,
    "deliveredFully": 45,
    "deliveredPartially": 5,
    "failedCompletely": 0,
    "totalItemsProcessed": 250,
    "itemsSucceeded": 245,
    "itemsFailed": 5
  }
}
```

### Component 2: `billBulkRetry.js`

**Purpose**: Automatic retry of partially-delivered bills

(Already detailed in "Retry Mechanism" section above)

**Key Differences from Auto-Delivery**:

- Targets `Partially-Delivered` bills only
- Uses `forceRetry = true` for adjustments
- Handles previously-failed items
- More aggressive retry logic
- Includes state verification checks

### Component 3: `deliverBillUpdate.js`

**Purpose**: Core delivery logic and transaction creation

**Main Exports**:

#### Function: `adjustSingleLineItem(item, billId, billNo, userId, options)`

Adjusts inventory and creates transaction for a single line item.

```javascript
// Parameters
item           // Line item object with product/inventory refs
billId         // Bill's MongoDB ID
billNo         // Bill number (string)
userId         // Distributor ID
options: {
  forceRetry: false,           // Override "already adjusted" check
  deliveryDate: null,          // Custom delivery date
  backdateFields: null         // Pre-calculated backdate data
}

// Returns
{
  success: true,
  transactionId: "...",
  updatedInventory: {...},
  error: null
}
```

**Process**:

1. Validate product & inventory existence
2. Check if already adjusted (unless forceRetry)
3. Compute adjusted quantity
4. Update inventory stock
5. Create transaction record
6. Handle errors gracefully

#### Function: `createLedgerEntries(bill, userId, backdateFields)`

Creates financial ledger entries for a delivered bill.

```javascript
// Creates debit entry for bill amount
// Records against specific retailer
// Calculates cumulative balance
// Updates credit status

// Only called once per bill (checked via billId + userId)
```

**Financial Impact**:

- Deducts `bill.netAmount` from balance
- Creates journal entries for audit
- Tracks payment status
- Supports credit management

#### Function: `createSalesRewardPoints(bill, userId)`

Generates reward points for distributor on bill delivery.

Calculates based on:

- Bill amount
- Product reward percentages
- Distributor tier/category
- Special promotions

#### Function: `createDistributorRewardTransaction(bill, userId, rewardPoints)`

Transfers reward points to distributor account.

```javascript
// Updates distributor reward balance
// Creates transaction record
// Validates sufficient points available
// Handles overflow scenarios
```

#### Function: `createRetailerRewardTransaction(bill, retailerId, rewardPoints)`

Transfers reward points to retailer/outlet account.

```javascript
// Updates retailer reward balance
// Tracks redemption eligibility
// Integrates with reward catalog
```

---

## Database Schema

### Bill Model

```javascript
Bill {
  _id: ObjectId,
  billNo: String,                 // Unique bill number (legacy)
  new_billno: String,             // New bill numbering (if applicable)
  status: String,                 // "Pending", "Partially-Delivered", "Delivered"
  distributorId: ObjectId,        // Distributor reference
  retailerId: ObjectId,           // Retailer reference
  orderId: ObjectId,              // Reference to order

  // Financial
  grossAmount: Number,
  discountAmount: Number,
  netAmount: Number,
  creditAmount: Number,

  // Line Items
  lineItems: [{
    _id: ObjectId,
    product: ObjectId,            // Product reference
    inventoryId: ObjectId,        // Inventory reference
    billQty: Number,              // Quantity to deliver
    batchNumber: String,
    itemBillType: String,         // "Item Removed", "Stock out", etc.
    price: Number,
    amount: Number,
    adjustmentStatus: String,     // "Pending", "Adjusted", "Failed"
  }],

  // Timestamps
  createdAt: Date,
  updatedAt: Date,
  deliveredAt: Date
}
```

### BillDeliverySetting Model

```javascript
BillDeliverySetting {
  _id: ObjectId,
  distributorId: ObjectId,
  deliveryDurationDays: Number,   // 1-30 days
  notes: String,
  isActive: Boolean,
  enableBackdateBilling: Boolean,
  updatedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

### Transaction Model

```javascript
Transaction {
  _id: ObjectId,
  transactionCode: String,        // Unique code: "TXN-..."
  billId: ObjectId,
  billLineItemId: ObjectId,
  distributorId: ObjectId,
  productId: ObjectId,
  inventoryId: ObjectId,

  // Stock Adjustment
  adjustedQty: Number,            // Items added to inventory
  adjustmentType: String,         // "Inbound" (receival from distributor)
  transactionType: String,        // Details of transaction

  reference: {
    billNo: String,
    batchNumber: String,
    location: String
  },

  notes: String,
  createdAt: Date
}
```

### Ledger Model

```javascript
Ledger {
  _id: ObjectId,
  transactionId: String,          // Reference to transaction code
  dbId: ObjectId,                 // Distributor ID
  retailerId: ObjectId,           // Retailer ID
  billId: ObjectId,
  transactionFor: String,         // "Sales", "Return", etc.

  // Financial
  amount: Number,                 // Debit amount
  balance: Number,                // Running balance

  createdAt: Date,
  updatedAt: Date
}
```

### DistributorTransaction Model

```javascript
DistributorTransaction {
  _id: ObjectId,
  transactionCode: String,
  distributorId: ObjectId,
  billId: ObjectId,

  transactionType: String,        // "Reward", "Reversal", etc.
  amount: Number,                 // Points or currency
  balance: Number,                // Distributor running balance

  createdAt: Date
}
```

---

## API Endpoints

### Bill Delivery Settings

#### 1. **Set/Update Delivery Settings**

```
POST /api/admin/bill-delivery-settings
Content-Type: application/json
Authorization: Bearer <token>

Body:
{
  "distributorId": "507f1f77bcf86cd799439011",
  "deliveryDurationDays": 7,
  "notes": "Standard delivery window",
  "isActive": true,
  "enableBackdateBilling": false
}

Response (200):
{
  "error": false,
  "message": "Setting saved successfully",
  "data": { ... }
}
```

#### 2. **Get Delivery Settings**

```
GET /api/admin/bill-delivery-settings/:distributorId
Authorization: Bearer <token>

Response (200):
{
  "error": false,
  "data": {
    "_id": "...",
    "distributorId": "...",
    "deliveryDurationDays": 7,
    "isActive": true,
    "enableBackdateBilling": false,
    "updatedBy": "..."
  }
}
```

### Bill Delivery Operations

#### 3. **Auto Pending Bill Delivery** (Cron)

```
POST /api/rbp/bill/auto-delivery
Content-Type: application/json
Authorization: Bearer <cron-token>

Body:
{
  "billIds": [],    // Optional
  "limit": 100
}

Response (200):
{
  "error": false,
  "message": "Auto delivery completed",
  "summary": {
    "totalBills": 50,
    "deliveredFully": 45,
    "deliveredPartially": 5,
    "totalItemsProcessed": 250,
    "itemsSucceeded": 245,
    "itemsFailed": 5
  }
}
```

#### 4. **Bulk Retry Partial Bills** (Cron)

```
POST /api/rbp/bill/bulk-retry
Content-Type: application/json
Authorization: Bearer <cron-token>

Body:
{
  "billIds": [],    // Optional: specific bills
  "limit": 100      // Optional: batch size
}

Response (200):
{
  "error": false,
  "message": "Bulk retry completed",
  "summary": {
    "totalBills": 25,
    "delivered": 18,
    "stillPartial": 7,
    "itemsRetried": 45,
    "itemsSucceeded": 42,
    "itemsFailed": 3,
    "distributorRewardsTransferred": 18,
    "retailerRewardsTransferred": 18,
    "rewardsFailed": 0,
    "lowBalanceErrors": 0
  },
  "details": [
    {
      "billNo": "BL20240101001",
      "status": "Delivered",
      "itemsSucceeded": 8,
      "itemsFailed": 0
    }
  ]
}
```

---

## Error Handling

### Error Classes

#### AdjustmentError

```javascript
class AdjustmentError extends Error {
  constructor(message, nonRetriable = false) {
    super(message);
    this.nonRetriable = !!nonRetriable;
  }
}
```

**Usage**:

- `nonRetriable = true`: Item cannot be retried (skip future attempts)
- `nonRetriable = false`: Item can be retried later

### Common Errors

| Error                            | Cause                  | Recovery                     | Retriable |
| -------------------------------- | ---------------------- | ---------------------------- | --------- |
| **Missing billId or billNo**     | Data corruption        | Skip bill                    | No        |
| **Invalid product or inventory** | Invalid references     | Mark item as failed          | No        |
| **Insufficient inventory**       | Stock unavailable      | Retry when stock replenished | Yes       |
| **Already adjusted**             | Item delivered before  | Skip (unless forceRetry)     | No        |
| **Low ledger balance**           | Insufficient credit    | Retry after payment          | Yes       |
| **Database write failed**        | System error           | Retry operation              | Yes       |
| **Invalid backdate**             | Date validation failed | Manual intervention          | No        |

### Error Response Format

```json
{
  "error": true,
  "message": "Description of what failed",
  "code": "ERROR_CODE",
  "details": {
    "billNo": "BL123456",
    "itemId": "item_123",
    "reason": "Inventory unavailable",
    "retriable": true
  }
}
```

### Retry Strategy

**Automatic Retries**:

1. First failure → Queue for next cron cycle
2. Second failure → Flag for potential stock restock
3. Multiple failures → Escalate for admin review

**Manual Intervention**:

- Admin can force retry items
- Admin can mark items as undeliverable
- Admin can adjust inventory manually

---

## Workflows & Examples

### Workflow 1: Complete Delivery Path

```
SCENARIO: Distributor delivers complete bill

1. BILL CREATION
   ├─ Distributor places order
   ├─ System generates Bill object
   ├─ Creates LineItems array
   └─ Status: "Pending"

2. DELIVERY ATTEMPT
   ├─ Distributor initiates delivery (or auto-delivery cron)
   ├─ For each item:
   │  ├─ Validate product exists
   │  ├─ Check inventory available
   │  ├─ Adjust inventory quantity
   │  ├─ Create transaction
   │  └─ Item status: "Adjusted"
   ├─ Calculate sales rewards
   ├─ Create ledger entries
   └─ Transfer reward points

3. BILL UPDATE
   ├─ All items adjusted successfully
   ├─ Status updated: "Pending" → "Delivered"
   ├─ Set deliveredAt timestamp
   └─ Archive for settlement

4. COMPLETION
   ├─ Bill fully settled
   ├─ Rewards transferred
   └─ Distributor can place next order freely
```

### Workflow 2: Partial Delivery With Retry

```
SCENARIO: Some items fail, triggering bulk retry later

1. INITIAL DELIVERY ATTEMPT
   ├─ Bill status: "Pending"
   ├─ Item 1: ✓ Adjusted (stock available)
   ├─ Item 2: ✓ Adjusted (stock available)
   ├─ Item 3: ✗ Failed (marked as "Stock out")
   ├─ Item 4: ✗ Failed (invalid inventory reference)
   └─ Result: Status = "Partially-Delivered"

2. WAIT & MONITOR
   ├─ Bill queued for bulk retry
   ├─ Admin monitors failed items
   ├─ Maybe restocks inventory
   └─ Cron job scheduled to retry

3. BULK RETRY CYCLE
   ├─ Cron finds bill (status = "Partially-Delivered")
   ├─ Examines failed items
   ├─ Item 3: ✓ Now has stock → Adjusted (forceRetry)
   ├─ Item 4: ✗ Still invalid → Reported as non-retriable
   └─ Result: Status = "Delivered" (missing item flagged)

4. COMPLETION
   ├─ 3 of 4 items delivered
   ├─ Item 4 requires manual intervention
   ├─ Admin manually adjusts inventory or marks as removed
   └─ Bill can then be fully settled
```

### Workflow 3: Backdate Billing

```
SCENARIO: Deliver bill with antedated delivery date

1. BILL SETUP
   ├─ Order created: Jan 1, 2024
   ├─ Bill created: Jan 15, 2024
   ├─ Delivery setting: enableBackdateBilling = true
   └─ Request includes: deliveryDate = Jan 5, 2024

2. DELIVERY REQUEST
   ├─ POST /api/rbp/bill/deliver-bill
   ├─ Body: { billId, deliveryDate: "2024-01-05" }
   ├─ System validates:
   │  ├─ Check: Jan 5 >= Jan 1 (order date) ✓
   │  ├─ Check: Jan 5 <= Jan 15 (today) ✓
   │  └─ Validation passed
   └─ backdateFields = calculateBackdateFields(orderDate, deliveryDate, true)

3. TRANSACTION CREATION
   ├─ All transactions use calculated backdateFields
   ├─ Ledger entries record delivery date (Jan 5)
   ├─ Rewards calculated based on Jan 5 date
   ├─ Target achievement updated for Jan 5
   └─ Historical data properly recorded

4. COMPLETION
   ├─ Bill appears as delivered on Jan 5 (retroactively)
   ├─ Supports business requirements for historical reconciliation
   ├─ Maintains audit trail with actual delivery timestamp
   └─ Financial reporting uses delivery date (Jan 5)
```

### Example Request/Response

#### Example: Deliver a Bill Manually

```javascript
// Request
POST /api/distributor/deliver-bill
Headers: {
  "Authorization": "Bearer distributor_token",
  "Content-Type": "application/json"
}
Body: {
  "billId": "63f7a1b2c3d4e5f6g7h8i9j0",
  "deliveryDate": "2024-03-05"  // Optional: for backdate
}

// Success Response
{
  "error": false,
  "message": "Bill delivered successfully",
  "data": {
    "billId": "63f7a1b2c3d4e5f6g7h8i9j0",
    "billNo": "BL20240301001",
    "status": "Delivered",
    "itemsDelivered": 8,
    "itemsFailed": 0,
    "rewardsPoints": 250,
    "deliveredAt": "2024-03-05T10:30:00Z"
  }
}

// Partial Failure Response
{
  "error": false,
  "message": "Bill partially delivered",
  "data": {
    "billId": "63f7a1b2c3d4e5f6g7h8i9j0",
    "billNo": "BL20240301001",
    "status": "Partially-Delivered",
    "itemsDelivered": 6,
    "itemsFailed": 2,
    "failedItems": [
      {
        "lineItemId": "item_1",
        "productName": "Product A",
        "reason": "Inventory unavailable",
        "retriable": true
      },
      {
        "lineItemId": "item_2",
        "productName": "Product B",
        "reason": "Invalid inventory reference",
        "retriable": false
      }
    ]
  }
}
```

---

## Troubleshooting

### Common Issues

#### Issue 1: Bill Stuck in "Partially-Delivered"

**Symptoms**:

- Bill status not changing despite retries
- Same items failing repeatedly
- Distributor cannot proceed

**Root Causes**:

1. Inventory reference corrupted
2. Product doesn't exist anymore
3. Insufficient credit balance
4. Database connection timeout

**Resolution**:

```
1. Check inventory references:
   db.collection('bills').findOne({ billNo: "BL123456" })
   → Verify product and inventoryId exist

2. Check product existence:
   db.collection('products').findOne({ _id: ObjectId(...) })

3. Verify ledger balance:
   db.collection('ledgers').findOne({
     dbId: distributorId
   }).sort({ createdAt: -1 }).limit(1)

4. Manual fix:
   - Mark problematic items as "Item Removed"
   - Update bill status to "Delivered"
   - Create manual transaction record
   - Notify admin of adjustment
```

#### Issue 2: Reward Points Not Transferred

**Symptoms**:

- Bill delivered but rewards not added
- Distributor complains about missing points
- Transaction created but no ledger entry

**Root Causes**:

1. Low distributor balance
2. Reward calculation error
3. Failed database write

**Resolution**:

```
1. Check transaction record:
   db.collection('distributorTransactions').findOne({
     billId: billObjectId
   })

2. Check ledger entry:
   db.collection('ledgers').findOne({
     billId: billObjectId
   })

3. If missing, manually create:
   - Execute createSalesRewardPoints() again
   - Log transaction with reason code
   - Notify distributor

4. Verify credit balance:
   If insufficient, wait for payment before retry
```

#### Issue 3: Backdate Validation Fails

**Symptoms**:

- Backdate delivery rejected
- Error: "Invalid delivery date"
- Bills cannot be antedated

**Root Causes**:

1. Delivery date before order date
2. Delivery date in future
3. Exceeds maximum backdate window

**Resolution**:

```
1. Verify order creation date:
   db.collection('bills').findOne({ _id: ObjectId(...) })
   → Check orderId.createdAt or bill.createdAt

2. Validate date range:
   - Minimum: Order creation date
   - Maximum: Current date
   - Check system timezone

3. Check business rules:
   - Some territories have limited backdate windows
   - Check distributor's region settings
   - Verify backdate enabled in settings

4. Manual override:
   - Admin can bypass validation if needed
   - Audit trail should be logged
   - Notification sent to compliance
```

### Debug Logging

Enable detailed logging for troubleshooting:

```javascript
// In controller
console.log(`[BILL_DELIVERY] Bill: ${billNo}`);
console.log(`[BILL_DELIVERY] Status: ${bill.status}`);
console.log(`[BILL_DELIVERY] Items: ${bill.lineItems.length}`);
console.log(`[INVENTORY] Before: ${currentStock}, After: ${newStock}`);
console.log(`[TRANSACTION] Created: ${transactionId}`);
console.log(`[REWARD] Points calculated: ${points}`);
console.log(`[LEDGER] Balance: ${newBalance}`);
```

### Monitoring Queries

```javascript
// Find all partially-delivered bills
db.bills.find({ status: "Partially-Delivered" }).count();

// Bills stuck longer than 24 hours
db.bills
  .find({
    status: "Partially-Delivered",
    updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  })
  .count();

// Failed items by product
db.bills.aggregate([
  { $match: { status: "Partially-Delivered" } },
  { $unwind: "$lineItems" },
  { $match: { "lineItems.adjustmentStatus": "Failed" } },
  { $group: { _id: "$lineItems.productId", count: { $sum: 1 } } },
]);

// Reward transfer failures
db.distributorTransactions
  .find({
    error: { $exists: true },
  })
  .sort({ createdAt: -1 })
  .limit(10);
```

---

## Best Practices

### For Administrators

1. **Delivery Settings**
   - Set realistic delivery windows (5-7 days typical)
   - Enable backdate billing only if business requires
   - Test settings with small user group first
   - Document special cases in notes field

2. **Monitoring**
   - Check stuck bills daily
   - Review failed items weekly
   - Monitor reward transfer success rate (target: >99%)
   - Set up alerts for >5% failure rate

3. **Manual Interventions**
   - Document reason for every manual override
   - Mark items as "Item Removed" only if confirmed
   - Force retry only after investigating cause
   - Notify distributor of changes

4. **Portal Locking**
   - Use in conjunction with delivery settings
   - Never lock without clear deadline communication
   - Provide unlock path for overdue bills
   - Monitor locked distributor count

### For Developers

1. **Error Handling**
   - Always distinguish retriable vs non-retriable errors
   - Log full context for debugging
   - Include billNo and item IDs in errors
   - Track error patterns for proactive fixes

2. **Transaction Safety**
   - Use database transactions for multi-step operations
   - Validate all references before creation
   - Handle partial failures gracefully
   - Maintain audit trail

3. **Performance**
   - Batch cron operations (don't process all at once)
   - Use indexes on status, distributorId, updatedAt
   - Cache delivery settings locally
   - Monitor query performance

4. **Testing**
   - Test with partial failures (at least 1 good, 1 bad item)
   - Test with edge dates (backdate scenarios)
   - Test low balance conditions
   - Test concurrent delivery attempts
   - Load test with large bill batches

### For Distributors

1. **Delivery Compliance**
   - Check delivery duration in settings
   - Deliver bills before deadline to avoid locks
   - Monitor bill status in real-time
   - Request extensions if needed (contact admin)

2. **Partial Delivery Handling**
   - If delivery fails, check item details
   - Verify stock with warehouse before retrying
   - Contact admin if items permanently unavailable
   - Review failed items in next cycle

3. **Reward Optimization**
   - Deliver complete bills for reward points
   - Points credited immediately on full delivery
   - Monitor reward balance in dashboard
   - Plan purchases according to reward availability

---

## Appendix: Related Documentation

- **Portal Locking**: See `PORTAL_LOCKING_DOCUMENTATION.md`
- **Bill Management**: See `controllers/bill/`
- **Inventory System**: See `controllers/inventory/`
- **Transaction Tracking**: See `controllers/transction/`
- **Ledger Management**: See `controllers/ledger/`

---

## Document Information

- **Last Updated**: March 5, 2026
- **Version**: 1.0
- **Scope**: Rupa DMS Backend
- **Author**:  Anuradha Adhikari (Development Team)  
- **Status**: Production

### Change Log

| Date       | Version | Changes                             |
| ---------- | ------- | ----------------------------------- |
| 2026-03-05 | 1.0     | Initial comprehensive documentation |

---

**For questions or updates to this documentation, please contact the Backend Development Team.**
