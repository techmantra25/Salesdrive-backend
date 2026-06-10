const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Bill = require("../models/bill.model");
const Distributor = require("../models/distributor.model");
const OutletApproved = require("../models/outletApproved.model");

const MONGO_URI =
  "mongodb://rupaAdmin:admin2025@127.0.0.1:27017/rupadms?authSource=rupadms";

const FIX_OUTPUT = path.join(__dirname, "gst_fix_report.json");
const ZERO_OUTPUT = path.join(__dirname, "gst_zero_tax_bills.json");

const fixGST = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ DB Connected\n");

    // 🔥 Load master data
    const distributors = await Distributor.find({}).lean();
    const distributorMap = {};
    distributors.forEach((d) => {
      distributorMap[d._id.toString()] = d;
    });

    const retailers = await OutletApproved.find({}).lean();
    const retailerMap = {};
    retailers.forEach((r) => {
      retailerMap[r._id.toString()] = r;
    });

    console.log("🚀 Master data loaded\n");

    const bills = await Bill.find({}).lean();

    let totalChecked = 0;
    let fixedCount = 0;
    let zeroTaxCount = 0;

    let totalIGSTRemoved = 0;
    let totalCGSTAdded = 0;
    let totalSGSTAdded = 0;

    const fixedResult = [];
    const zeroTaxResult = [];

    for (const bill of bills) {
      totalChecked++;

      const distributor = distributorMap[bill.distributorId?.toString()];
      const retailer = retailerMap[bill.retailerId?.toString()];

      if (!distributor || !retailer) continue;

      const isSameState =
        distributor.stateId?.toString() ===
        retailer.stateId?.toString();

      const cgst = Number(bill.cgst || 0);
      const sgst = Number(bill.sgst || 0);
      const igst = Number(bill.igst || 0);

      // ================================
      // ❌ CASE: ZERO TAX (NON-FIXABLE)
      // ================================
      if (isSameState && cgst === 0 && sgst === 0 && igst === 0) {
        zeroTaxCount++;

        console.log(
          `⚠️ ZERO TAX #${zeroTaxCount} | ${bill.billNo} | No GST applied`
        );

        zeroTaxResult.push({
          billId: bill._id,
          billNo: bill.billNo,
          orderNo: bill.orderNo,
          distributor: distributor.name,
          retailer: retailer.outletName,
          cgst,
          sgst,
          igst,
          issue: "No GST applied (all zero)",
        });

        continue; // skip fixing
      }

      // ================================
      // 🔧 FIX CASE
      // ================================
      if (isSameState && igst > 0) {
        fixedCount++;

        const half = Number((igst / 2).toFixed(2));

        totalIGSTRemoved += igst;
        totalCGSTAdded += half;
        totalSGSTAdded += half;

        const updatedLineItems = (bill.lineItems || []).map((item) => {
          const itemIgst = Number(item.totalIGST || 0);
          const itemHalf = Number((itemIgst / 2).toFixed(2));

          return {
            ...item,
            totalCGST: itemHalf,
            totalSGST: itemHalf,
            totalIGST: 0,
          };
        });

        console.log("\n==================================================");
        console.log(`🔧 FIXED Bill #${fixedCount}`);
        console.log(`Bill No   : ${bill.billNo}`);
        console.log(`Order No  : ${bill.orderNo}`);

        console.log(
          `OLD → IGST: ${igst}, CGST: ${cgst}, SGST: ${sgst}`
        );

        console.log(
          `NEW → IGST: 0, CGST: ${half}, SGST: ${half}`
        );

        console.log("==================================================");

        await Bill.updateOne(
          { _id: bill._id },
          {
            $set: {
              cgst: half,
              sgst: half,
              igst: 0,
              lineItems: updatedLineItems,
            },
          }
        );

        fixedResult.push({
          billId: bill._id,
          billNo: bill.billNo,
          orderNo: bill.orderNo,
          before: { igst, cgst, sgst },
          after: { igst: 0, cgst: half, sgst: half },
        });
      }

      if (totalChecked % 1000 === 0) {
        console.log(
          `🔄 Checked: ${totalChecked} | Fixed: ${fixedCount} | ZeroTax: ${zeroTaxCount}`
        );
      }
    }

    // ================================
    // 📝 EXPORT FIXED REPORT
    // ================================
    fs.writeFileSync(
      FIX_OUTPUT,
      JSON.stringify(
        {
          summary: {
            totalChecked,
            fixedCount,
            totalIGSTRemoved,
            totalCGSTAdded,
            totalSGSTAdded,
          },
          data: fixedResult,
        },
        null,
        2
      )
    );

    // ================================
    // 📝 EXPORT ZERO TAX REPORT
    // ================================
    fs.writeFileSync(
      ZERO_OUTPUT,
      JSON.stringify(
        {
          summary: {
            zeroTaxCount,
          },
          data: zeroTaxResult,
        },
        null,
        2
      )
    );

    console.log("\n📊 FINAL SUMMARY");
    console.log(`🔧 Fixed       : ${fixedCount}`);
    console.log(`⚠️ Zero Tax    : ${zeroTaxCount}`);
    console.log(`📁 Fix File    : ${FIX_OUTPUT}`);
    console.log(`📁 Zero File   : ${ZERO_OUTPUT}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ ERROR:", error);
    process.exit(1);
  }
};

fixGST();