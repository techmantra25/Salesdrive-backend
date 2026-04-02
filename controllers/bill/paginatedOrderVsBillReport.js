const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const moment = require("moment-timezone");

// Helper function to escape CSV values
const escapeCSVValue = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

// Updated headers - Added back Gross Amount, Scheme Discount, Special Disc Amount
const reportHeaders = [
  "DB Code",
  "DB Name",
  "Employee Code",
  "Employee Name",
  "Employee Deg",
  "Retailer UID",
  "Retailer Code",
  "Retailer Name",
  "Beat Code",
  "Beat",
  "Week",
  "Order Date",
  "Order Number",
  "Order to Bill Status",
  "Brand",
  "Sub Brand",
  "Product Category",
  "Group",
  "FG Code",
  "Product Code",
  "Product Name",
  "Size",
  "MRP",
  "RLP",
  "Original Order Qty",
  "Order Qty in BOX",
  "Order Value",
  "Order Source",
  "Gross Amount",
  "Scheme Discount",
  "Special Disc Amount",

  "Invoice Date",
  "Invoice Number",
  "Invoice Status",
  "Invoice Qty",
  "Invoice Value",
  "Sales Return Number",
  "Sales Return Date",
  "Returned Qty",
  "Returned Value",
  "Execution %",
];

const paginatedOrderVsBillReport = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      distributorIds,
      fromDate,
      toDate,
      status,
      search,
      orderSource,
    } = req.query;

    let query = {};

    if (distributorIds) {
      query.distributorId = { $in: distributorIds.split(",") };
    }

    if (status && status !== "all") {
      query.status = status;
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        const s = new Date(fromDate);
        s.setHours(0, 0, 0, 0);
        query.createdAt.$gte = s;
      }
      if (toDate) {
        const e = new Date(toDate);
        e.setHours(23, 59, 59, 999);
        query.createdAt.$lte = e;
      }
    }

    if (search) {
      query.$or = [
        { billNo: new RegExp(search, "i") },
        { orderNo: new RegExp(search, "i") },
      ];
    }

    const bills = await Bill.find(query)
      .populate([
        { path: "distributorId", select: "dbCode name" },
        {
          path: "salesmanName",
          select: "empId name desgId",
          populate: { path: "desgId", select: "name" },
        },
        {
          path: "routeId",
          select: "code name",
        },
        {
          path: "retailerId",
          select: "outletUID outletCode outletName",
        },
        {
          path: "lineItems.product",
          select:
            "product_code name size sku_group_id sku_group__name no_of_pieces_in_a_box cat_id collection_id brand product_hsn_code base_point",
          populate: [
            { path: "cat_id", select: "name" },
            { path: "collection_id", select: "name" },
            { path: "brand", select: "name" },
          ],
        },
        {
          path: "lineItems.price",
          select: "mrp_price rlp_price dlp_price",
        },
        {
          path: "orderId",
          select:
            "orderNo createdAt status orderSource lineItems retailerId routeId salesmanName orderType paymentMode",
          populate: [
            {
              path: "lineItems.product",
              select:
                "product_code name size sku_group_id sku_group__name no_of_pieces_in_a_box cat_id collection_id brand product_hsn_code base_point",
              populate: [
                { path: "cat_id", select: "name" },
                { path: "collection_id", select: "name" },
                { path: "brand", select: "name" },
              ],
            },
            {
              path: "lineItems.price",
              select: "mrp_price rlp_price dlp_price",
            },
            { path: "retailerId", select: "outletUID outletCode outletName" },
            { path: "routeId", select: "code name" },
            {
              path: "salesmanName",
              select: "empId name desgId",
              populate: { path: "desgId", select: "name" },
            },
          ],
        },
        {
          path: "salesReturnId",
          select: "salesReturnNo updatedAt lineItems billId",
          populate: [
            {
              path: "lineItems.product",
              select: "_id",
            },
          ],
        },
      ])
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const totalCount = await Bill.countDocuments(query);

    // Process rows
    const rows = bills.flatMap((bill) => {
      const order = bill.orderId;

      return bill.lineItems.map((billItem) => {
        const orderItem = order?.lineItems?.find(
          (oi) =>
            oi.product?._id?.toString() === billItem.product?._id?.toString(),
        );

        let orderQty = Number(orderItem?.oderQty || 0);
        let orderValue = Number(orderItem?.netAmt || 0);
        let grossAmount = Number(orderItem?.grossAmt || 0);
        let schemeDiscount = Number(orderItem?.schemeDisc || 0);
        let specialDiscAmount = Number(orderItem?.distributorDisc || 0);
        const invoiceQty = Number(billItem.billQty || 0);

        // 🔹 POINT 2: If invoice quantity exists but original order quantity is 0, that means those products have been added during bill creation, originally not in the order list
        // make original order quantity same as invoice quantity for correct execution calculation
        if (invoiceQty > 0 && orderQty === 0) {
          orderQty = invoiceQty;
          orderValue = Number(billItem.netAmt || 0); // Order value same as invoice value
          grossAmount = Number(billItem.grossAmt || 0); // Gross amount same as invoice gross amount
          schemeDiscount = Number(billItem.schemeDisc || 0);
          specialDiscAmount = Number(billItem.distributorDisc || 0);
        }

        // Sales Return calculation - filter by billId to ensure correct association
        const relatedSRs = (bill.salesReturnId || []).filter(
          (sr) =>
            sr.billId?.toString() === bill._id?.toString() &&
            sr.lineItems?.some(
              (li) =>
                li.product?.toString() === billItem.product?._id?.toString(),
            ),
        );

        let returnQty = 0;
        let returnAmt = 0;
        const srNumbers = [];
        const srDates = [];

        relatedSRs.forEach((sr) => {
          if (sr.salesReturnNo) srNumbers.push(sr.salesReturnNo);
          if (sr.updatedAt)
            srDates.push(moment(sr.updatedAt).format("DD-MM-YYYY"));
          sr.lineItems?.forEach((li) => {
            if (li.product?.toString() === billItem.product?._id?.toString()) {
              returnQty += Number(li.returnQty) || 0;
              returnAmt += Number(li.netAmt) || 0;
            }
          });
        });

        const executionPercentage =
          orderQty === 0 || bill.status !== "Delivered"
            ? "0"
            : (((invoiceQty - returnQty) / orderQty) * 100).toFixed(2);

        const row = {};

        // Populate row with escaped values in exact header order
        reportHeaders.forEach((header) => {
          switch (header) {
            case "DB Code":
              row[header] = escapeCSVValue(bill.distributorId?.dbCode);
              break;
            case "DB Name":
              row[header] = escapeCSVValue(bill.distributorId?.name);
              break;
            case "Employee Code":
              row[header] = escapeCSVValue(bill.salesmanName?.empId);
              break;
            case "Employee Name":
              row[header] = escapeCSVValue(bill.salesmanName?.name);
              break;
            case "Employee Deg":
              row[header] = escapeCSVValue(bill.salesmanName?.desgId?.name);
              break;
            case "Retailer UID":
              row[header] = escapeCSVValue(bill.retailerId?.outletUID);
              break;
            case "Retailer Code":
              row[header] = escapeCSVValue(bill.retailerId?.outletCode);
              break;
            case "Retailer Name":
              row[header] = escapeCSVValue(bill.retailerId?.outletName);
              break;
            case "Beat Code":
              row[header] = escapeCSVValue(bill.routeId?.code);
              break;
            case "Beat":
              row[header] = escapeCSVValue(bill.routeId?.name);
              break;
            case "Week":
              row[header] = escapeCSVValue(moment(bill.createdAt).week());
              break;
            case "Order Date":
              row[header] = escapeCSVValue(
                order ? moment(order.createdAt).format("DD-MM-YYYY") : "",
              );
              break;
            case "Order Number":
              row[header] = escapeCSVValue(order?.orderNo);
              break;
            case "Order to Bill Status":
              row[header] = escapeCSVValue(order?.status);
              break;
            case "Brand":
              row[header] = escapeCSVValue(billItem.product?.brand?.name);
              break;
            case "Sub Brand":
              row[header] = escapeCSVValue(
                billItem.product?.collection_id?.name,
              );
              break;
            case "Product Category":
              row[header] = escapeCSVValue(billItem.product?.cat_id?.name);
              break;
            case "Group":
              row[header] = escapeCSVValue(billItem.product?.sku_group__name);
              break;
            case "FG Code":
              row[header] = escapeCSVValue(billItem.product?.sku_group_id);
              break;
            case "Product Code":
              row[header] = escapeCSVValue(billItem.product?.product_code);
              break;
            case "Product Name":
              row[header] = escapeCSVValue(billItem.product?.name);
              break;
            case "Size":
              row[header] = escapeCSVValue(billItem.product?.size);
              break;
            case "MRP":
              row[header] = escapeCSVValue(billItem.price?.mrp_price);
              break;
            case "RLP":
              row[header] = escapeCSVValue(billItem.price?.rlp_price);
              break;
            case "Original Order Qty":
              row[header] = escapeCSVValue(orderQty);
              break;
            case "Order Qty in BOX":
              row[header] = escapeCSVValue(
                (
                  orderQty /
                  Number(billItem.product?.no_of_pieces_in_a_box || 1)
                ).toFixed(2),
              );
              break;
            case "Order Value":
              row[header] = escapeCSVValue(orderValue);
              break;
            case "Order Source":
              row[header] = escapeCSVValue(order?.orderSource);
              break;
            case "Gross Amount":
              row[header] = escapeCSVValue(grossAmount);
              break;
            case "Scheme Discount":
              row[header] = escapeCSVValue(schemeDiscount);
              break;
            case "Special Disc Amount":
              row[header] = escapeCSVValue(specialDiscAmount);
              break;
            case "Invoice Date":
              row[header] = escapeCSVValue(
                moment(bill.createdAt).format("DD-MM-YYYY"),
              );
              break;
            case "Invoice Number":
              row[header] = escapeCSVValue(bill.new_billno || bill.billNo);
              break;
            case "Invoice Status":
              row[header] = escapeCSVValue(bill.status);
              break;
            case "Invoice Qty":
              row[header] = escapeCSVValue(invoiceQty);
              break;
            case "Invoice Value":
              row[header] = escapeCSVValue(billItem.netAmt);
              break;
            case "Sales Return Number":
              row[header] = escapeCSVValue(srNumbers.join("|"));
              break;
            case "Sales Return Date":
              row[header] = escapeCSVValue(srDates.join("|"));
              break;
            case "Returned Qty":
              row[header] = escapeCSVValue(returnQty);
              break;
            case "Returned Value":
              row[header] = escapeCSVValue(returnAmt);
              break;
            case "Execution %":
              row[header] = escapeCSVValue(executionPercentage);
              break;
            default:
              row[header] = "";
          }
        });

        return row;
      });
    });

    return res.status(200).json({
      status: 200,
      message: "Order Vs Bill report",
      headers: reportHeaders,
      data: rows,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderVsBillReport };
