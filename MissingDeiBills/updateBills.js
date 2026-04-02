const fs = require("fs");
const mongoose = require("mongoose");

const Bill = require("../models/bill.model");
const DistributorTransaction = require("../models/distributorTransaction.model");

async function updateDeliveryDateFromSalesTx() {
  await mongoose.connect(
    "",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  );

  // 1️⃣ Read bill IDs from JSON
  const bills = JSON.parse(fs.readFileSync("./billsjson.json", "utf8"));
  const billIds = bills.map(b => new mongoose.Types.ObjectId(b._id));

  // 2️⃣ Fetch SALES transactions for these bills
  const salesTx = await DistributorTransaction.find({
    billId: { $in: billIds },
    transactionFor: "SALES",
    status: "Success",
  }).select("billId createdAt");

  // 3️⃣ Map billId → earliest SALES createdAt
  const billDateMap = new Map();

  for (const tx of salesTx) {
    const billId = tx.billId.toString();

    if (
      !billDateMap.has(billId) ||
      tx.createdAt < billDateMap.get(billId)
    ) {
      billDateMap.set(billId, tx.createdAt);
    }
  }

  // 4️⃣ Fetch bills missing deliveryDate (for fallback)
  const billsMissingDate = await Bill.find({
    _id: { $in: billIds },
    $or: [
      { "dates.deliveryDate": null },
      { "dates.deliveryDate": { $exists: false } },
    ],
  }).select("_id updatedAt");

  let updated = 0;

  // 5️⃣ Update logic (SALES tx → fallback updatedAt)
  for (const bill of billsMissingDate) {
    const billId = bill._id.toString();

    const deliveryDate =
      billDateMap.get(billId) || bill.updatedAt;

    const res = await Bill.updateOne(
      {
        _id: bill._id,
        "dates.deliveryDate": null,
      },
      {
        $set: {
          "dates.deliveryDate": deliveryDate,
        },
      }
    );

    if (res.modifiedCount === 1) updated++;
  }

  console.log(`✅ Updated ${updated} bills (SALES tx or bill.updatedAt fallback)`);

  await mongoose.disconnect();
}

updateDeliveryDateFromSalesTx();
