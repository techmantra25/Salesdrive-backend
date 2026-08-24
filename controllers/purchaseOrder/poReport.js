const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Invoice = require("../../models/invoice.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

const poReport = asyncHandler(async (req, res) => {
  try {
    // Generate filename with Asia/Kolkata timezone
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Purchase_Order_Report_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a",
    )}.csv`;

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${fileName}\"`,
    );

    // Build filter object
    const filter = {};

    // Multiple distributor filter (dbCode)
    if (req.query.distributorIds) {
      const dbIds = req.query.distributorIds.split(",");

      if (dbIds.length > 0) {
        filter.distributorId = { $in: dbIds };
      }
    }

    // Date range filter
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

    // Fixed: was `orderQty / piecesPerBox` called with lineItem?.oderQty
    // (typo, that field doesn't exist on the schema — it's `orderQty`),
    // so boxQty was always NaN and the fallback silently produced "NaN".
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

    // ---- Precompute GRN received qty per PO+product ------------------------
    // grnQty / grnBoxQty are NOT stored on the PurchaseOrder document — they
    // have to be derived from Invoice line items (same logic as
    // getGrnPrimeryOrder / purchaseOrderExcelView). Since this endpoint
    // streams via cursor for memory efficiency, we can't join on the fly per
    // row, so: 1) grab just the _ids of POs matching the filter, 2) run a
    // single aggregation over Invoice to sum received qty per PO+product,
    // 3) build a lookup map used while streaming rows below.
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
    // -------------------------------------------------------------------------

    // Populate fields - matching purchaseOrderExcelView exactly
    const populateFields = [
      {
        path: "distributorId",
        select: "name dbCode",
      },
      {
        path: "supplierId",
        select: "supplierName supplierCode",
      },
      {
        path: "lineItems.product",
        // Added "uom" so the product's own base UOM (e.g. "bndl") is
        // available for the report, separate from lineItemUOM (the UOM
        // the order quantity was actually placed in, e.g. "box").
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

    // CSV headers
    const headers = [
      "PO No",
      "Distributor Code",
      "Distributor Name",
      "Supplier Code",
      "Supplier Name",
      "PO Created Date",
      "Expected Delivery Date",
      // "Plant",
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
      // "Quotation Status",
      // "SAP Quotation No",
      // "SAP Sales Order No",
    ];

    // Create CSV stream
    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for streaming
    const cursor = PurchaseOrder.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .cursor();

    cursor.on("data", (po) => {
      // If no line items, write one row with PO-level data
      if (!po.lineItems || po.lineItems.length === 0) {
        csvStream.write({
          "PO No": po?.purchaseOrderNo || "",
          "Distributor Code": po?.distributorId?.dbCode || "",
          "Distributor Name": po?.distributorId?.name || "",
          "Supplier Code": po?.supplierId?.supplierCode || "",
          "Supplier Name": po?.supplierId?.supplierName || "",
          "PO Created Date":
            po?.createdAt && moment(po?.createdAt).isValid()
              ? moment(po?.createdAt).tz("Asia/Kolkata").format("YYYY-MM-DD")
              : "",
          "Expected Delivery Date": po?.expectedDeliveryDate
            ? moment(po.expectedDeliveryDate)
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD")
            : "",
          // Plant: "",
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
          // "Quotation Status": po?.sapStatus || "",
          // "SAP Quotation No": po?.sapStatusData?.Vbeln || "",
          // "SAP Sales Order No": po?.sapStatusData?.Vbelnso || "",
        });
      } else {
        // Write one row per line item
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
            "PO Created Date":
              po?.createdAt && moment(po?.createdAt).isValid()
                ? moment(po?.createdAt).tz("Asia/Kolkata").format("YYYY-MM-DD")
                : "",
            "Expected Delivery Date": po?.expectedDeliveryDate
              ? moment(po.expectedDeliveryDate)
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD")
              : "",
            // Plant: lineItem?.plant?.plantName || "",
            "Product Code": lineItem?.product?.product_code || "",
            "Product Name": lineItem?.product?.name || "",
            // Fixed: now reads the product's own base UOM (e.g. "bndl")
            // instead of lineItemUOM (the order-placement UOM, e.g. "box").
            UOM: lineItem?.product?.uom || "",
            "Order Qty (BOX)":
              lineItem?.boxOrderQty ||
              ConvertToBox(
                lineItem?.orderQty,
                lineItem?.product,
                lineItem?.lineItemUOM,
              ),
            // Fixed typo: was lineItem?.oderQty (field doesn't exist on the
            // schema), which meant this column was always blank.
            "Order Qty (PCS)": lineItem?.orderQty || "",
            // Fixed: grnQty/grnBoxQty are never stored on the PurchaseOrder
            // document itself (lineItem?.grnBoxQty / grnQty were always
            // undefined -> 0 here). Now sourced from the Invoice-derived
            // receivedMap built above, same formula as getGrnPrimeryOrder.
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
            // "Quotation Status": po?.sapStatus || "",
            // "SAP Quotation No": po?.sapStatusData?.Vbeln || "",
            // "SAP Sales Order No": po?.sapStatusData?.Vbelnso || "",
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