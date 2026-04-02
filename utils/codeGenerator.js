const BillSeries = require("../models/billSeries.model");
const Counter = require("../models/counter.model");
const Distributor = require("../models/distributor.model");
const { acquireLock, releaseLock } = require("../models/lock.model");
const {
  acquireOrderLock,
  releaseOrderLock,
} = require("../models/orderLockSchema");
const new_billSeries = require('../models/new_billseries.model');
const SalesReturnModel = require("../models/salesReturn.model");

const generateCode = async (prefix) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const code = `${prefix}-${counter.seq.toString().padStart(3, "0")}`;
  return code;
};

const generateCodeForSalesReturn = async (prefix, distributorId) => {
  const last = await SalesReturnModel
    .findOne({ distributorId }) // ✅ filter per distributor
    .sort({ createdAt: -1 })
    .select("salesReturnNo")
    .lean();

  let next = 1;

  if (last?.salesReturnNo) {
    const lastNumber = parseInt(
      last.salesReturnNo.replace(`${prefix}-`, "")
    );
    next = lastNumber + 1;
  }

  return `${prefix}-${String(next).padStart(3, "0")}`;
};



const generateCodesInBatch = async (prefix, count) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix },
    { $inc: { seq: count } },
    { new: true, upsert: true }
  );
  const start = counter.seq - count + 1;
  return Array.from(
    { length: count },
    (_, i) => `${prefix}-${(start + i).toString().padStart(3, "0")}`
  );
};

const outletImpCode = async (prefix) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const code = `${prefix}`;
  return code;
};

const transactionCode = async (prefix) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const code = `${prefix}-${counter.seq.toString().padStart(2, "0")}`;
  return code;
};

// Dedicated code generator for Retailer Outlet Transactions to isolate counter namespace
const retailerOutletTransactionCode = async (prefix = "RTO") => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: `RETAILER_OUTLET_TXN_${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // Use larger padding to avoid short-width issues
  const code = `${prefix}-${counter.seq.toString().padStart(6, "0")}`;
  return code;
};

const invoiceNumberGenerator = async (prefix, distributorId) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix, distributorId: distributorId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const code = `${prefix}-${counter.seq.toString().padStart(6, "0")}`;
  return code;
};

const deliveryBoyCodeGenerator = async (prefix) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const code = `${prefix}-${counter.seq.toString().padStart(6, "0")}`;
  return code;
};

// old order number generator function with lock mechanism

const orderNumberGenerator = async (prefix) => {
  const currentYear = new Date().getFullYear().toString().slice(-2);
  const nextYear = (parseInt(currentYear) + 1).toString().padStart(2, "0");
  const yearRange = `${currentYear}-${nextYear}`;

  const lockName = `order-counter-${prefix}-${yearRange}`;

  // Try to acquire lock with retry mechanism
  let lockAcquired = false;
  let retries = 10; // Max 10 retries (about 5-10 seconds total wait)

  while (!lockAcquired && retries > 0) {
    lockAcquired = await acquireLock(lockName);

    if (!lockAcquired) {
      // Wait with exponential backoff
      const delay = (11 - retries) * 100 + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delay));
      retries--;
    }
  }

  if (!lockAcquired) {
    throw new Error(
      `Could not acquire lock for order number generation: ${lockName}`
    );
  }

  try {
    const counter = await Counter.findOneAndUpdate(
      { codeType: prefix, yearRange: yearRange },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const code = `${prefix}-${yearRange}-${counter.seq
      .toString()
      .padStart(4, "0")}`;

    return code;
  } finally {
    // Always release the lock
    await releaseLock(lockName);
  }
};

const orderNumberGeneratorNew = async (prefix) => {
  const currentYear = new Date().getFullYear().toString().slice(-2);
  const nextYear = (parseInt(currentYear) + 1).toString().padStart(2, "0");
  const yearRange = `${currentYear}-${nextYear}`;

  const lockName = `order-counter-${prefix}-${yearRange}`;

  // Try to acquire lock with retry mechanism
  let lockAcquired = false;
  let retries = 20; // Increased for production stability

  while (!lockAcquired && retries > 0) {
    lockAcquired = await acquireOrderLock(lockName, 25000); // 25 second timeout

    if (!lockAcquired) {
      // Exponential backoff with jitter
      const baseDelay = Math.min(1500, (21 - retries) * 100);
      const jitter = Math.random() * 400;
      const delay = baseDelay + jitter;

      // console.log(
      //   `[${new Date().toISOString()}] Retrying lock acquisition for ${lockName}, attempts left: ${retries}`
      // );
      await new Promise((resolve) => setTimeout(resolve, delay));
      retries--;
    }
  }

  if (!lockAcquired) {
    const errorMsg = `Could not acquire lock for order number generation: ${lockName} after 20 attempts`;
    // console.error(`[${new Date().toISOString()}] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    console.log(`[${new Date().toISOString()}] Lock acquired for ${lockName}`);

    // Use findOneAndUpdate with atomic increment for better concurrency
    let counter = await Counter.findOneAndUpdate(
      { codeType: prefix, yearRange: yearRange },
      { $inc: { seq: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: { codeType: prefix, yearRange: yearRange, seq: 1 },
      }
    );

    // Generate the order code
    const code = `${prefix}-${yearRange}-${counter.seq
      .toString()
      .padStart(4, "0")}`;

    console.log(
      `[${new Date().toISOString()}] Generated order number: ${code} (sequence: ${
        counter.seq
      }) for lock: ${lockName}`
    );

    return code;
  } catch (error) {
    // console.error(
    //   `[${new Date().toISOString()}] Error in order number generation for ${lockName}:`,
    //   error.message
    // );
    throw error;
  } finally {
    // Always release the lock
    console.log(`[${new Date().toISOString()}] Releasing lock for ${lockName}`);
    await releaseOrderLock(lockName);
  }
};

const purchaseOrderNumberGenerator = async (prefix) => {
  // Get the current year and the next year dynamically
  const currentYear = new Date().getFullYear().toString().slice(-2); // Last two digits of the current year
  const nextYear = (parseInt(currentYear) + 1).toString().padStart(2, "0"); // Next year with two digits

  // Combine the years in the format YY-YY
  const yearRange = `${currentYear}-${nextYear}`;

  // Find and update the counter based on the prefix and year range
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix, yearRange: yearRange },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // Generate the order number with a padded sequence
  const code = `${prefix}-${yearRange}-${counter.seq
    .toString()
    .padStart(3, "0")}`;

  return code;
};

const generateBillNo = async (prefix, distributorId) => {
  // Fetch the distributor to get the dbCode
  const distributor = await Distributor.findById(distributorId);
  
  if (!distributor) {
    throw new Error("Distributor not found");
  }
  
  const dbCode = distributor.dbCode || ""; 
  const newdbcode = dbCode.slice(0,4);// Get dbCode or empty string if not found
  
  // Try to get the current count, default to 0 if not found or invalid
  const getCount = await BillSeries.findOne({ distributorId: distributorId });
  let count = 1;
  if (
    getCount &&
    typeof getCount.count === "number" &&
    !isNaN(getCount.count)
  ) {
    count = getCount.count + 1;
  }
  
  // Generate bill number with dbCode included
  // const billNo = `${newdbcode}${new Date().getFullYear().toString().slice(-2)}-${
  //   parseInt(new Date().getFullYear().toString().slice(-2)) + 1
  // }-${String(count).padStart(6, "0")}`;

  const billNo = `${newdbcode}${String(count).padStart(10, "0")}`;
  
  // Use upsert to create the document if it doesn't exist
  await BillSeries.findOneAndUpdate(
    { distributorId: distributorId },
    { count: count },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  
  return billNo;
};

//generate the new billnumber

// const generateNextBillNumber = async(billSeriesId) => {
//   if(!billSeriesId){
//     throw new Error("Bill series ID is required");
//   }

//   const billSeries = await new_billSeries.findOneAndUpdate(
//     {_id: billSeriesId},
//     {$inc: {currentNumber: 1}},
//     {new: true}
//   );
  
//   if(!billSeries){
//     throw new Error("Active bill series not found");
//   }
  
//   // ✅ CHANGED: Pad currentNumber to match series_number length
//   const paddedNumber = String(billSeries.currentNumber).padStart(
//     billSeries.series_number.length, 
//     '0'
//   );
  
//   const billNo = `${billSeries.prefix}${paddedNumber}`;
  
//   if(billNo.length > 16){
//     throw new Error("Generated bill number exceeds 16 character limit");
//   }
  
//   return billNo;
// }

const generateNextBillNumber = async(billSeriesId, maxRetries = 3) => {
  if(!billSeriesId){
    throw new Error("Bill series ID is required");
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // ✅ READ current state first
    const currentSeries = await new_billSeries.findById(billSeriesId);
    
    if(!currentSeries){
      throw new Error("Active bill series not found");
    }
    
    const nextNumber = currentSeries.currentNumber + 1;
    
    // ✅ UPDATE only if currentNumber hasn't changed (optimistic locking)
    const billSeries = await new_billSeries.findOneAndUpdate(
      {
        _id: billSeriesId,
        currentNumber: currentSeries.currentNumber  // ← KEY: Only update if unchanged
      },
      {
        $set: { currentNumber: nextNumber }
      },
      { new: true }
    );
    
    // ✅ If update succeeded, proceed
    if(billSeries){
      const paddedNumber = String(nextNumber).padStart(
        billSeries.series_number.length, 
        '0'
      );
      
      const billNo = `${billSeries.prefix}${paddedNumber}`;
      
      if(billNo.length > 16){
        throw new Error("Generated bill number exceeds 16 character limit");
      }
      
      return billNo;
    }
    
    // ✅ If update failed (number changed), retry
    console.log(`Bill number generation conflict on attempt ${attempt + 1}, retrying...`);
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1))); // Exponential backoff
  }
  
  throw new Error("Failed to generate bill number after multiple attempts due to concurrent access");
}



const ledgerTransactionCode = async (prefix, distributorId) => {
  const counter = await Counter.findOneAndUpdate(
    { distributorId: distributorId, codeType: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const distributor = await Distributor.findById(distributorId);

  const code = `${prefix}-${distributor?.dbCode}-${counter.seq
    .toString()
    .padStart(6, "0")}`;
  return code;
};

const generatePurchaseReturnCode = async (prefix, distributorId) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix, distributorId: distributorId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const code = `${prefix}-${counter.seq.toString().padStart(6, "0")}`;
  return code;
};

const generateUniversalOutletUID = async () => {
  const prefix = "RMS";
  const counter = await Counter.findOneAndUpdate(
    { codeType: "UNIVERSAL_OUTLET_UID" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // Dynamic padding based on sequence length
  const seqStr = counter.seq.toString();
  const padding = Math.max(3, seqStr.length + 1); // Minimum 3 digits, increase padding as number grows
  const code = `${prefix}-${seqStr.padStart(padding, "0")}`;
  return code;
};

const giftProductCodeGenerator = async (prefix) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: `GIFT_PRODUCT_${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // Use larger padding to avoid short-width issues
  const code = `${prefix}-${counter.seq.toString().padStart(6, "0")}`;
  return code;
};

const giftOrderCodegerator = async (prefix = "SDREWARD") => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: `RETAILER_GIFT_ORDER_${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // Use larger padding to avoid short-width issues
  const code = `${prefix}${counter.seq.toString().padStart(6, "0")}`;
  return code;
};

module.exports = {
  generateCode,
  generateCodeForSalesReturn,
  generateCodesInBatch,
  outletImpCode,
  transactionCode,
  retailerOutletTransactionCode,
  invoiceNumberGenerator,
  deliveryBoyCodeGenerator,
  orderNumberGenerator,
  generateBillNo,
  ledgerTransactionCode,
  generatePurchaseReturnCode,
  purchaseOrderNumberGenerator,
  orderNumberGeneratorNew,
  generateUniversalOutletUID,
  giftProductCodeGenerator,
  giftOrderCodegerator,
  generateNextBillNumber
};
