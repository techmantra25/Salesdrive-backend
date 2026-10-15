const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const OrderEntry = require("../../models/orderEntry.model");
const Godown = require("../../models/godown.model");       // adjust path
const Inventory = require("../../models/inventory.model");  // adjust path
const { orderNumberGenerator } = require("../../utils/codeGenerator");

const convertOrderEnquiryToOrderEntry = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { godownId } = req.body;

  const orderEnquiry = await OrderEnquiry.findById(id);
  if (!orderEnquiry) {
    return res.status(404).json({ status: 404, message: "Order Enquiry not found" });
  }

  if (String(orderEnquiry.distributorId) !== String(req.user.id)) {
    return res.status(403).json({ status: 403, message: "You are not allowed to convert this Order Enquiry" });
  }

  if (orderEnquiry.status === "Converted" || orderEnquiry.convertedOrderEntryId) {
    return res.status(400).json({
      status: 400,
      message: "Order Enquiry is already converted",
      data: { convertedOrderEntryId: orderEnquiry.convertedOrderEntryId },
    });
  }

  if (orderEnquiry.status === "Cancelled") {
    return res.status(400).json({ status: 400, message: "Cancelled Order Enquiry cannot be converted" });
  }

  // 1. Validate selected godown
  if (!godownId || !mongoose.Types.ObjectId.isValid(godownId)) {
    return res.status(400).json({ status: 400, message: "Godown is required" });
  }

  const godown = await Godown.findOne({
    _id: godownId,
    distributorId: orderEnquiry.distributorId,
    isActive: true,
  });
  if (!godown) {
    return res.status(400).json({ status: 400, message: "Invalid or inactive Godown" });
  }

  const source = orderEnquiry.toObject();

  // 2. Get inventory of the selected godown for all products in the enquiry
  const productIds = source.lineItems.map((li) => li.product);
  const inventories = await Inventory.find({
    distributorId: source.distributorId,
    godownId: godown._id,
    productId: { $in: productIds },
  });
  const invByProduct = new Map(inventories.map((inv) => [String(inv.productId), inv]));

  // 3. Replace inventoryId on every line item with the selected godown's inventory
  const missing = [];
  const lineItems = source.lineItems.map((li) => {
    const inv = invByProduct.get(String(li.product));
    if (!inv) {
      missing.push(String(li.product));
      return li;
    }
    return { ...li, inventoryId: inv._id };
  });

  if (missing.length) {
    return res.status(400).json({
      status: 400,
      message: `Stock not found in ${godown.godownName} for ${missing.length} product(s)`,
      data: { productIds: missing },
    });
  }

  // 4. Create the order with the selected godown + updated line items
  const orderNumber = await orderNumberGenerator("DBO");

  const newOrderEntry = await OrderEntry.create({
    distributorId: source.distributorId,
    orderNo: orderNumber,
    salesmanName: source.salesmanName,
    routeId: source.routeId,
    retailerId: source.retailerId,
    godownId: godown._id,              // selected godown
    orderType: source.orderType,
    orderSource: source.orderSource,
    paymentMode: source.paymentMode,
    lineItems,                         // inventoryId now points to selected godown
    totalLines: source.totalLines,
    totalBasePoints: source.totalBasePoints,
    grossAmount: source.grossAmount,
    schemeDiscount: source.schemeDiscount,
    manualDate: source.manualDate,
    distributorDiscount: source.distributorDiscount,
    taxableAmount: source.taxableAmount,
    cgst: source.cgst,
    sgst: source.sgst,
    igst: source.igst,
    invoiceAmount: source.invoiceAmount,
    roundOffAmount: source.roundOffAmount,
    freightCharges: source.freightCharges || 0,
    handlingCharges: source.handlingCharges || 0,
    cashDiscount: source.cashDiscount,
    cashDiscountApplied: source.cashDiscountApplied,
    cashDiscountType: source.cashDiscountType,
    cashDiscountValue: source.cashDiscountValue,
    creditAmount: source.creditAmount,
    netAmount: source.netAmount,
    adjustedCreditNoteIds: source.adjustedCreditNoteIds,
    remark: source.remark,
    orderEnquiryId: source._id,
  });

  // 5. Mark enquiry as converted (and record the godown used)
  orderEnquiry.status = "Converted";
  orderEnquiry.godownId = godown._id;
  orderEnquiry.convertedOrderEntryId = newOrderEntry._id;
  orderEnquiry.convertedAt = new Date();
  await orderEnquiry.save();

  return res.status(200).json({
    status: 200,
    message: "Order Enquiry converted to Order Entry successfully",
    data: { orderEnquiry, orderEntry: newOrderEntry },
  });
});

module.exports = { convertOrderEnquiryToOrderEntry };