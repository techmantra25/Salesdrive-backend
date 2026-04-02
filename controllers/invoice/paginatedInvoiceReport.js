const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const Product = require("../../models/product.model"); 
const { format } = require("fast-csv");
const moment = require("moment-timezone");

const paginatedInvoiceReport = asyncHandler(async (req, res) => {
  try {
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Primary_Invoice_Report_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a"
    )}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${fileName}\"`
    );

    const filter = {};

    // Distributor filter
    if (req.query.distributorId) {
      filter.distributorId = req.query.distributorId;
    }

    if (req.query.distributorIds) {
      const distributorIds = req.query.distributorIds.split(",");
      if (distributorIds.length > 0) {
        filter.distributorId = { $in: distributorIds };
      }
    }

    if (req.query.startDate && req.query.endDate) {
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
    } else if (req.query.startDate) {
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      filter.date = { $gte: startOfDay };
    } else if (req.query.endDate) {
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $lte: endOfDay };
    }

    // GRN date filter validation and implementation
    if (req.query.grnStartDate || req.query.grnEndDate) {
      if (req.query.status !== "Confirmed") {
        res.status(400);
        throw new Error(
          "GRN date filter can only be applied when status is 'Confirmed'"
        );
      }

      if (req.query.grnStartDate && req.query.grnEndDate) {
        const grnStartOfDay = new Date(req.query.grnStartDate);
        grnStartOfDay.setHours(0, 0, 0, 0);
        const grnEndOfDay = new Date(req.query.grnEndDate);
        grnEndOfDay.setHours(23, 59, 59, 999);
        filter.grnDate = { $gte: grnStartOfDay, $lte: grnEndOfDay };
      } else if (req.query.grnStartDate) {
        const grnStartOfDay = new Date(req.query.grnStartDate);
        grnStartOfDay.setHours(0, 0, 0, 0);
        filter.grnDate = { $gte: grnStartOfDay };
      } else if (req.query.grnEndDate) {
        const grnEndOfDay = new Date(req.query.grnEndDate);
        grnEndOfDay.setHours(23, 59, 59, 999);
        filter.grnDate = { $lte: grnEndOfDay };
      }
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.invoiceNo) {
      filter.invoiceNo = { $regex: req.query.invoiceNo, $options: "i" };
    }

    let brandProductIds = [];

    if (req.query.brandIds) {
      const brandIds = req.query.brandIds.split(",");

      if (brandIds.length > 0) {
        brandProductIds = await Product.find({
          brand: { $in: brandIds },
        }).distinct("_id");

        brandProductIds = brandProductIds.map((id) => id.toString());

        filter["lineItems.product"] = { $in: brandProductIds };
      }
    }

    const populateFields = [
      {
        path: "distributorId",
        select: "dbCode name RBPSchemeMapped city stateId",
        populate: {
          path: "stateId",
          select: "name zoneId",
          populate: {
            path: "zoneId",
            select: "name",
          },
        },
      },
      {
        path: "lineItems.product",
        select: "product_code name brand subBrand uom base_point",
        populate: [
          { path: "brand", select: "name code desc" },
          { path: "subBrand", select: "name" },
        ],
      },
      { path: "lineItems.plant", select: "" },
    ];

    const headers = [
      "Distributor Code",
      "Distributor Name",
      "Distributor's Zone",
      "Distributor's State",
      "Distributor's City",
      "Invoice No",
      "Invoice Date",
      "PO No",
      "Status",
      "GRN No",
      "GRN Date",
      "Product Code",
      "Product Name",
      "Brand",
      "Sub Brand",
      "Plant Code",
      "Plant Name",
      "Goods Type",
      "Price",
      "UOM",
      "Qty",
      "Received Qty",
      "Shortage Qty",
      "Shortage UOM",
      "Damage Qty",
      "Damage UOM",
      "Gross Amount",
      "Trade Discount",
      "Special Discount ",
      "Taxable Amount",
      "CGST",
      "SGST",
      "IGST",
      "Net Amount",
      "Base Point",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    const cursor = Invoice.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .cursor();

    cursor.on("data", (invoice) => {
      invoice.lineItems.forEach((item) => {
        const productId = item?.product?._id?.toString();

        if (
          brandProductIds.length > 0 &&
          !brandProductIds.includes(productId)
        ) {
          return;
        }

        const isRBPSchemed =
          invoice?.distributorId?.RBPSchemeMapped === "yes";

        const basePoint = isRBPSchemed
          ? Number(
            Number(item?.usedBasePoint ?? item?.product?.base_point ?? 0) *
            Number(item?.receivedQty ?? 0)
          )
          : 0;

        csvStream.write({
          "Distributor Code": invoice?.distributorId?.dbCode || "",
          "Distributor Name": invoice?.distributorId?.name || "",
          "Distributor's Zone": invoice?.distributorId?.stateId?.zoneId?.name || "",
          "Distributor's State": invoice?.distributorId?.stateId?.name || "",
          "Distributor's City": invoice?.distributorId?.city || "",
          "Invoice No": invoice?.invoiceNo || "",
          "Invoice Date": invoice?.date
            ? moment(invoice.date).tz("Asia/Kolkata").format("DD-MM-YYYY")
            : "",
          "PO No": item?.poNumber || "",
          Status: invoice?.status || "",
          "GRN No": invoice?.grnNumber || "",
          "GRN Date": invoice?.grnDate
            ? moment(invoice.grnDate).tz("Asia/Kolkata").format("DD-MM-YYYY")
            : "",
          "Product Code": item?.product?.product_code || "",
          "Product Name": item?.product?.name || "",
          "Brand": item?.product?.brand
            ? `${item.product.brand.code} - ${item.product.brand.desc}`
            : "",
          "Sub Brand": item?.product?.subBrand?.name || "",
          "Plant Code": item?.plant?.plantCode || "",
          "Plant Name": item?.plant?.plantShortName || "",
          "Goods Type": item?.goodsType || "",
          Price: item?.mrp || 0,
          UOM: item?.product?.uom || "",
          Qty: item?.qty || 0,
          "Received Qty": item?.receivedQty || 0,
          "Shortage Qty": item?.shortageQty || 0,
          "Shortage UOM": item?.shortageUom || "",
          "Damage Qty": item?.damageQty || 0,
          "Damage UOM": item?.damageUom || "",
          "Gross Amount": item?.grossAmount || 0,
          "Trade Discount": item?.discountAmount || 0,
          "Special Discount": item?.specialDiscountAmount || 0,
          "Taxable Amount": item?.taxableAmount || 0,
          CGST: item?.cgst || 0,
          SGST: item?.sgst || 0,
          IGST: item?.igst || 0,
          "Net Amount": item?.netAmount || 0,
          "Base Point": basePoint,
        });
      });
    });

    cursor.on("end", () => {
      csvStream.end();
    });

    cursor.on("error", (err) => {
      csvStream.end();
      res.end();
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { paginatedInvoiceReport };