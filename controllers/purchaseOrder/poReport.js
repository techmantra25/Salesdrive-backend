const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Invoice = require("../../models/invoice.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

const poReport = asyncHandler(async (req, res) => {
  try {
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Purchase_Order_Report_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a",
    )}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${fileName}\"`,
    );

    const filter = {};

    if (req.query.distributorIds) {
      const dbIds = req.query.distributorIds.split(",");
      if (dbIds.length > 0) {
        filter.distributorId = { $in: dbIds };
      }
    }

    // NEW: Godown filter
    if (req.query.godownIds) {
      const gIds = req.query.godownIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (gIds.length > 0) {
        filter.godownId = { $in: gIds };
      }
    }

    if (req.query.startDate && req.query.endDate) {
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);

      filter.createdAt = {
        $gte: startOfDay,
        $lte: endOfDay,
      };
    } else if (req.query.startDate) {
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      filter.createdAt = { $gte: startOfDay };
    } else if (req.query.endDate) {
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt = { $lte: endOfDay };
    }

    const ConvertToBox = (orderQty, product, uom) => {
      const piecesPerBox = Number(product?.no_of_pieces_in_a_box) || 1;
      const boxQty = orderQty / piecesPerBox;
      return boxQty?.toFixed(2);
    };

    const getTotalGstAmount = (lineItem) => {
      let totalGst = 0;

      if (lineItem?.totalIGST) {
        totalGst = Number(lineItem.totalIGST);
      } else {
        totalGst =
          Number(lineItem?.totalCGST || 0) + Number(lineItem?.totalSGST || 0);
      }

      return totalGst;
    };

    const matchingPoIds = await PurchaseOrder.find(filter).distinct("_id");

    const receivedMap = {};
    if (matchingPoIds.length > 0) {
      const receivedAgg = await Invoice.aggregate([
        { $match: { purchaseOrderId: { $in: matchingPoIds } } },
        { $unwind: "$lineItems" },
        {
          $group: {
            _id: {
              purchaseOrderId: "$purchaseOrderId",
              product: "$lineItems.product",
            },
            totalQty: { $sum: { $ifNull: ["$lineItems.qty", 0] } },
          },
        },
      ]);

      for (const row of receivedAgg) {
        const key = `${String(row._id.purchaseOrderId)}_${String(
          row._id.product,
        )}`;
        receivedMap[key] = row.totalQty;
      }
    }

    const populateFields = [
      {
        path: "distributorId",
        select: "name dbCode",
      },
      {
        path: "supplierId",
        select: "supplierName supplierCode",
      },
      // NEW: populate godown
      {
        path: "godownId",
        select: "godownName godownCode",
      },
      {
        path: "lineItems.product",
        select:
          "name product_code cat_id collection_id brand no_of_pieces_in_a_box uom",
        populate: [
          { path: "cat_id", select: "name" },
          { path: "collection_id", select: "name" },
          { path: "brand", select: "name" },
        ],
      },
      {
        path: "lineItems.price",
        select: "dlp_price mrp_price",
      },
      {
        path: "lineItems.inventoryId",
        select: "availableQty intransitQty",
      },
      {
        path: "lineItems.plant",
        select: "plantName plantCode",
      },
      {
        path: "updatedBy",
        select: "name empId dbCode desgId",
        strictPopulate: false,
      },
      {
        path: "approved_by",
        select: "name empId desgId",
        strictPopulate: false,
      },
    ];

    const headers = [
      "PO No",
      "Distributor Code",
      "Distributor Name",
      "Supplier Code",
      "Supplier Name",
      "Godown Code",   // NEW
      "Godown Name",   // NEW
      "PO Created Date",
      "Expected Delivery Date",
      "Product Code",
      "Product Name",
      "UOM",
      "Order Qty (BOX)",
      "Order Qty (PCS)",
      "GRN Qty (BOX)",
      "GRN Qty (PCS)",
      "Stock Qty",
      "In-Transit Qty",
      "MRP",
      "Price",
      "Gross Amount",
      "Taxable Amount",
      "GST Amount",
      "Net Amount (Line)",
      "Total Net Amount (PO)",
      "Order Status",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    const cursor = PurchaseOrder.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .cursor();

    cursor.on("data", (po) => {
      if (!po.lineItems || po.lineItems.length === 0) {
        csvStream.write({
          "PO No": po?.purchaseOrderNo || "",
          "Distributor Code": po?.distributorId?.dbCode || "",
          "Distributor Name": po?.distributorId?.name || "",
          "Supplier Code": po?.supplierId?.supplierCode || "",
          "Supplier Name": po?.supplierId?.supplierName || "",
          "Godown Code": po?.godownId?.godownCode || "",   // NEW
          "Godown Name": po?.godownId?.godownName || "",   // NEW
          "PO Created Date":
            po?.createdAt && moment(po?.createdAt).isValid()
              ? moment(po?.createdAt).tz("Asia/Kolkata").format("YYYY-MM-DD")
              : "",
          "Expected Delivery Date": po?.expectedDeliveryDate
            ? moment(po.expectedDeliveryDate)
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD")
            : "",
          "Product Code": "",
          "Product Name": "",
          UOM: "",
          "Order Qty (BOX)": "",
          "Order Qty (PCS)": "",
          "GRN Qty (BOX)": "",
          "GRN Qty (PCS)": "",
          "Stock Qty": "",
          "In-Transit Qty": "",
          MRP: "",
          Price: "",
          "Gross Amount": "",
          "Taxable Amount": "",
          "GST Amount": "",
          "Net Amount (Line)": "",
          "Total Net Amount (PO)": po?.netAmount || 0,
          "Order Status": po?.status || "",
        });
      } else {
        po.lineItems.forEach((lineItem) => {
          const productId = lineItem?.product?._id;
          const receivedKey = `${String(po._id)}_${String(productId)}`;
          const alreadyReceived = receivedMap[receivedKey] || 0;
          const piecesPerBox =
            Number(lineItem?.product?.no_of_pieces_in_a_box) || 1;

          const grnQty = alreadyReceived;
          const grnBoxQty = Math.floor(alreadyReceived / piecesPerBox);

          csvStream.write({
            "PO No": po?.purchaseOrderNo || "",
            "Distributor Code": po?.distributorId?.dbCode || "",
            "Distributor Name": po?.distributorId?.name || "",
            "Supplier Code": po?.supplierId?.supplierCode || "",
            "Supplier Name": po?.supplierId?.supplierName || "",
            "Godown Code": po?.godownId?.godownCode || "",   // NEW
            "Godown Name": po?.godownId?.godownName || "",   // NEW
            "PO Created Date":
              po?.createdAt && moment(po?.createdAt).isValid()
                ? moment(po?.createdAt).tz("Asia/Kolkata").format("YYYY-MM-DD")
                : "",
            "Expected Delivery Date": po?.expectedDeliveryDate
              ? moment(po.expectedDeliveryDate)
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD")
              : "",
            "Product Code": lineItem?.product?.product_code || "",
            "Product Name": lineItem?.product?.name || "",
            UOM: lineItem?.product?.uom || "",
            "Order Qty (BOX)":
              lineItem?.boxOrderQty ||
              ConvertToBox(
                lineItem?.orderQty,
                lineItem?.product,
                lineItem?.lineItemUOM,
              ),
            "Order Qty (PCS)": lineItem?.orderQty || "",
            "GRN Qty (BOX)": grnBoxQty,
            "GRN Qty (PCS)": grnQty,
            "Stock Qty": lineItem?.inventoryId?.availableQty || "",
            "In-Transit Qty": lineItem?.inventoryId?.intransitQty || "",
            MRP: lineItem?.price?.mrp_price || "",
            Price: lineItem?.price?.dlp_price || "",
            "Gross Amount": lineItem?.grossAmt || "",
            "Taxable Amount": lineItem?.taxableAmt || "",
            "GST Amount": getTotalGstAmount(lineItem),
            "Net Amount (Line)": lineItem?.netAmt || "",
            "Total Net Amount (PO)": po?.netAmount || 0,
            "Order Status": po?.status || "",
          });
        });
      }
    });

    cursor.on("end", () => {
      csvStream.end();
    });

    cursor.on("error", (err) => {
      console.error("Cursor error:", err);
      csvStream.end();
      res.end();
    });
  } catch (error) {
    console.error("Report generation error:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { poReport };