const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const distributorGiftApproval = require("../../models/distributorGiftApproval");

const detailGiftOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const giftOrder = await GiftOrder.findById(id)
    .populate({
      path: "retailer",
      select: "outletApprovedId",
      populate: {
        path: "outletApprovedId",
        select:
          "outletCode outletName outletUID currentPointBalance city panImage aadharImage panNumber aadharNumber gstin shipToPincode shipToAddress ownerName mobile1 whatsappNumber email address1 pin outletImage",
      },
    })
    .populate({
      path: "cartId",
      select: "status createdAt",
    })
    .populate({
      path: "orderItems.cartItemId",
      select: "quantity",
      populate: {
        path: "productId",
        select: "description",
      },
    });

  if (!giftOrder) {
    return res.status(404).json({
      status: 404,
      message: "Gift order not found",
    });
  }

  // 2️⃣ Distributor Approvals for this Gift Order
  const distributorApprovals = await distributorGiftApproval
    .find({
      giftOrderId: giftOrder._id,
    })
    .populate({
      path: "distributorId",
      select: "name dbCode",
    })
    .sort({ createdAt: 1 });

  return res.status(200).json({
    status: 200,
    message: "Gift order details fetched successfully",
    data: giftOrder,
    distributorApprovals,
  });
});

module.exports = detailGiftOrder;
