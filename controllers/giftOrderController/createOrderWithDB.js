const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const Cart = require("../../models/cart.model");
const CartGiftProduct = require("../../models/cartGiftProduct.model");
const RetailerLogin = require("../../models/retailerLogin.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");
const Beat = require("../../models/beat.model");
const Distributor = require("../../models/distributor.model");
const {
  giftOrderCodegerator,
  transactionCode,
} = require("../../utils/codeGenerator");
const notificationQueue = require("../../queues/notificationQueue");
// const smsQueue = require("../../queues/smsQueue"); // Commented out - SMS queue disabled

/**
 * CREATE GIFT ORDER - Production-ready
 */
const createOrderWithDB = asyncHandler(async (req, res) => {
  try {
    const outletApprovedId = req.user;

    // ✅ Fetch approved retailer
    const approvedRetailer = await OutletApproved.findById(outletApprovedId);
    if (!approvedRetailer) {
      return res
        .status(404)
        .json({ status: 404, message: "Retailer not found" });
    }

    // ✅ Retailer login check
    const retailerLogin = await RetailerLogin.findOne({
      outletApprovedId,
      status: true,
    });
    if (!retailerLogin) {
      return res
        .status(401)
        .json({ status: 401, message: "Retailer not logged in" });
    }

    // ✅ Active cart
    const cart = await Cart.findOne({
      retailer: retailerLogin._id,
      status: true,
    });
    if (!cart || cart.totalQuantity === 0) {
      return res.status(400).json({ status: 400, message: "Cart is empty" });
    }

    const cartItems = await CartGiftProduct.find({
      cartId: cart._id,
      status: true,
    }).populate("productId");
    if (!cartItems.length) {
      return res
        .status(400)
        .json({ status: 400, message: "No cart items found" });
    }

    const {
      shipping_address,
      shipping_landmark,
      shipping_city,
      shipping_state,
      shipping_country,
      shipping_pin,
    } = req.body;
    if (
      !shipping_address ||
      !shipping_city ||
      !shipping_state ||
      !shipping_country ||
      !shipping_pin
    ) {
      return res.status(400).json({
        status: 400,
        message: "Complete shipping address is required",
      });
    }

    // ✅ Check point balance
    if (approvedRetailer.currentPointBalance < cart.totalPoints) {
      return res.status(400).json({
        status: 400,
        message: `Insufficient points. Required: ${cart.totalPoints}, Available: ${approvedRetailer.currentPointBalance}`,
      });
    }

    // ✅ Snapshot cart items
    const orderItems = cartItems.map((item) => ({
      cartItemId: item._id,
      productId: item.productId._id,
      productName: item.productId.name,
      productImage: item.productId.image || [],
      pointsPerUnit: item.points / item.quantity,
      quantity: item.quantity,
      totalPoints: item.points,
    }));

    // ✅ Deduct points atomically
    await OutletApproved.updateOne(
      { _id: outletApprovedId },
      { $inc: { currentPointBalance: -cart.totalPoints } },
    );

    const giftOrderNo = await giftOrderCodegerator();

    // ✅ Create gift order
    const giftOrder = await GiftOrder.create({
      retailer: retailerLogin._id,
      retatilerRealId: outletApprovedId,
      orderId: giftOrderNo,
      cartId: cart._id,
      orderItems,
      totalQuantity: cart.totalQuantity,
      totalRedemptionPoints: cart.totalPoints,
      status: "Waiting for NOC",
      shippingInfo: {
        userId: retailerLogin._id,
        shippingAddress: shipping_address,
        shippingLandmark: shipping_landmark,
        shippingCity: shipping_city,
        shippingState: shipping_state,
        shippingCountry: shipping_country,
        shippingPin: shipping_pin,
      },
    });

    // ✅ Retailer transaction
    await RetailerOutletTransaction.create({
      retailerId: outletApprovedId,
      giftRedemptionId: giftOrder._id,
      transactionId: await transactionCode("RTO"),
      transactionType: "debit",
      transactionFor: "Gift Redemption",
      point: cart.totalPoints,
      balance: approvedRetailer.currentPointBalance - cart.totalPoints,
      status: "Success",
      remark: `Points deducted for Gift Order ${giftOrderNo}`,
    });

    // ✅ Clear cart
    await CartGiftProduct.updateMany(
      { cartId: cart._id },
      { $set: { status: false } },
    );
    cart.status = false;
    await cart.save();

    // 1️⃣3️⃣ Distributor sales credits
    const { distributors, source } =
      await getOldestSalesCreditTransactions(outletApprovedId);

    // 1️⃣4️⃣ Distributor approval trail
    const distributorApprovals =
      await createDistributorApprovalTrail(
        giftOrder,
        distributors,
        source
      );

    // -------------------------
    // 🔔 Push Notifications using queue
    // -------------------------
    const adminMessage = `New Gift Order #${giftOrderNo} from ${approvedRetailer.outletName} - Awaiting Processing`;
    const retailerMessage = `Your Gift Order #${giftOrderNo} has been successfully created and is pending approval`;

    // Admin notification (role-based broadcast)
    await notificationQueue.add("newGiftOrder", {
      type: "giftOrder",
      data: {
        message: adminMessage,
        orderId: giftOrder._id,
        title: "New Gift Order Received",
      },
      userType: "User",
      room: "role:admin",
    });

    // Retailer notification (user-specific)
    await notificationQueue.add("giftOrderStatus", {
      type: "giftOrder",
      data: {
        message: retailerMessage,
        orderId: giftOrder._id,
        title: "Order Confirmation",
        status: "Waiting for NOC",
      },
      userId: outletApprovedId,
      userType: "OutletApproved",
    });

    // await smsQueue.add("sendGiftOrderSMS", {
    //   contact: approvedRetailer.mobile1,
    //   message: `Your Gift Order ${giftOrderNo} has been successfully created and is pending approval.`,
    // });

    // Distributor notifications (user-specific)
    for (const approval of distributorApprovals) {
      await notificationQueue.add("giftOrderApproval", {
        type: "giftOrder",
        data: {
          message: `Action Required: Gift Order #${giftOrderNo} is awaiting your approval`,
          orderId: giftOrder._id,
          approvalId: approval._id,
          title: "Approval Request",
          actionRequired: true,
        },
        userId: approval.distributorId,
        userType: "Distributor",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Gift order created successfully",
      data: {
        giftOrder,
        totalRedemptionPoints: cart.totalPoints,
        remainingPoints:
          approvedRetailer.currentPointBalance - cart.totalPoints,
        distributorApprovals,
      },
    });
  } catch (error) {
    console.error("Error creating gift order:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * 🔹 Oldest SALES credit transactions by distributor
 * If no transactions found, fallback to beat-distributor mapping
 */
const getOldestSalesCreditTransactions = async (retailerId) => {
  const transactions = await DistributorTransaction.find({
    retailerId,
    transactionType: "debit",
    transactionFor: "SALES",
    status: "Success",
  })
    .sort({ createdAt: 1 })
    .populate("distributorId", "name dbCode");

  const grouped = {};
  let source = "transaction";

  for (const tx of transactions) {
    const distributorId = tx.distributorId._id.toString();
    if (!grouped[distributorId]) {
      grouped[distributorId] = {
        distributor: {
          _id: distributorId,
          name: tx.distributorId.name,
          code: tx.distributorId.dbCode,
        },
        totalPoints: 0,
        transactions: [],
      };
    }
    grouped[distributorId].totalPoints += tx.point || 0;
    grouped[distributorId].transactions.push(tx._id);
  }

  // If no transactions found, fallback to beat-distributor mapping
  if (Object.keys(grouped).length === 0) {
    source = "beatMapping";

    const outlet = await OutletApproved.findById(retailerId).populate({
      path: "beatId",
      populate: { path: "distributorId", select: "name dbCode" },
    });

    if (outlet?.beatId) {
      const beats = Array.isArray(outlet.beatId)
        ? outlet.beatId
        : [outlet.beatId];

      const distributorMap = new Map();

      beats.forEach((beat) => {
        if (Array.isArray(beat?.distributorId)) {
          beat.distributorId.forEach((dist) => {
            if (dist?._id && dist?.name) {
              distributorMap.set(dist._id.toString(), {
                _id: dist._id.toString(),
                name: dist.name,
                code: dist.dbCode,
              });
            }
          });
        } else if (beat?.distributorId && beat.distributorId._id) {
          // Handle case where distributorId is a single object or ObjectId
          const dist = beat.distributorId;
          if (dist._id && dist.name) {
            distributorMap.set(dist._id.toString(), {
              _id: dist._id.toString(),
              name: dist.name,
              code: dist.dbCode,
            });
          }
        }
      });

      // Create mock entries for mapped distributors (no transaction history)
      for (const [distId, distInfo] of distributorMap.entries()) {
        grouped[distId] = {
          distributor: distInfo,
          totalPoints: 0,
          transactions: [],
        };
      }
    }
  }

  return { distributors: Object.values(grouped), source };
};

// -------------------------
// Helper: Create distributor approval trail
// -------------------------
const createDistributorApprovalTrail = async (
  giftOrder,
  distributors,
  source
) => {
  let remainingPoints = giftOrder.totalRedemptionPoints;
  const approvals = [];

  if (distributors.length > 0) {
    for (const dist of distributors) {
      if (remainingPoints <= 0) break;

      const pointsToRequest = dist.totalPoints > 0
        ? Math.min(remainingPoints, dist.totalPoints)
        : Math.ceil(remainingPoints / (distributors.length - distributors.indexOf(dist)));

      if (pointsToRequest > 0) {
        const approval = await DistributorGiftApproval.create({
          giftOrderId: giftOrder._id,
          distributorId: dist.distributor._id,
          requestedPoints: pointsToRequest,
          status: "Pending",
          source: source,
        });

        approvals.push(approval);
        remainingPoints -= pointsToRequest;
      }
    }
  }

  return approvals;
};

module.exports = createOrderWithDB;
