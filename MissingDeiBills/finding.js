const mongoose = require("mongoose");
const fs = require("fs");
const Bill = require("../models/bill.model"); // adjust path if needed

async function findDeliveredBillsWithNullDeliveryDate() {
  try {
    await mongoose.connect(
      "",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );

    const bills = await Bill.find({
      status: "Delivered",
      $or: [
        { "dates.deliveryDate": null },
        { "dates.deliveryDate": { $exists: false } }
      ]
    }, { _id: 1, billNo: 1, dates: 1, updatedAt: 1 });

    console.log(`Found ${bills.length} bills`);

    // Write bills to JSON file
    fs.writeFileSync('./billsjson.json', JSON.stringify(bills, null, 2));
    console.log('Bills written to billsjson.json');

  } catch (error) {
    console.error("Error fetching bills:", error);
  } finally {
    await mongoose.disconnect();
  }
}

findDeliveredBillsWithNullDeliveryDate();
