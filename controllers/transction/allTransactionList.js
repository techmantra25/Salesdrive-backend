const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");
const Product = require("../../models/product.model");
const mongoose = require("mongoose");
const Bill = require("../../models/bill.model");
// ASSUMPTION: the retailer/outlet model is the OutletApproved model shown in your
// message, and Bill has a `retailerId` field that refs it. Adjust the require path
// and the ref name below if your project names it differently (e.g. "Retailer").
const OutletApproved = require("../../models/outletApproved.model");
const moment = require("moment-timezone");

const allTransactionList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      searchTerm,
      type,
      stockType,
      toDate,
      fromDate,
      transactionFor,
      productId,
      partyIds, // NEW: comma-separated list. "self" = the distributor, or a retailer (OutletApproved) _id
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build the match stage for filtering
    const matchStage = {
      distributorId: new mongoose.Types.ObjectId(req.user?._id),
    };

    if (req.query.invoiceId) {
      matchStage.invoiceId = req.query.invoiceId;
    }

    // Accept timezone from client or default to Asia/Kolkata
    const USER_TZ = req.query.timezone || "Asia/Kolkata";

    if (fromDate || toDate) {
      matchStage.createdAt = {};

      if (fromDate) {
        const [year, month, day] = fromDate.split("-");
        const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        start.setUTCHours(start.getUTCHours() - 5);
        start.setUTCMinutes(start.getUTCMinutes() - 30);
        matchStage.createdAt.$gte = start;
      }

      if (toDate) {
        const [year, month, day] = toDate.split("-");
        const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        end.setUTCHours(end.getUTCHours() - 5);
        end.setUTCMinutes(end.getUTCMinutes() - 30);
        matchStage.createdAt.$lte = end;
      }
    }

    // Filter by transaction type
    if (type && type !== "all") {
      matchStage.type = type;
    }

    // stock type filter
    if (stockType && stockType !== "all") {
      matchStage.stockType = stockType;
    }

    // product filter
    if (req.query.productIds) {
      const ids = req.query.productIds
        .split(",")
        .map((id) => new mongoose.Types.ObjectId(id));

      matchStage.productId = { $in: ids };
    }

    // transaction type filter
    if (transactionFor && transactionFor !== "all") {
      matchStage.transactionType = transactionFor;
    }

    // ---------------------------------------------------------------------
    // NEW: Party filter
    // A "party" is either:
    //  - "self"      -> the logged-in distributor (relevant to "invoice" rows,
    //                    where stock comes IN from the distributor's own account)
    //  - a retailer's OutletApproved _id -> relevant to "delivery" / "salesreturn"
    //                    rows, which are always tied to a Bill, and the Bill
    //                    carries the retailerId.
    // ---------------------------------------------------------------------
    let partyOrConditions = null;

    if (partyIds) {
      const partyIdList = partyIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      const includesSelf = partyIdList.includes("self");
      const retailerIds = partyIdList
        .filter((id) => id !== "self" && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      partyOrConditions = [];

      if (includesSelf) {
        partyOrConditions.push({ transactionType: "invoice" });
      }

      if (retailerIds.length > 0) {
        const matchingBills = await Bill.find({
          retailerId: { $in: retailerIds },
        }).select("_id");
        const billIds = matchingBills.map((b) => b._id);

        partyOrConditions.push({
          billId: { $in: billIds },
          transactionType: { $in: ["delivery", "salesreturn"] },
        });
      }

      if (partyOrConditions.length === 0) {
        // Selected values didn't resolve to anything valid -> return no rows
        // rather than silently ignoring the filter.
        partyOrConditions = [{ _id: null }];
      }
    }

    // Enhanced search logic: If searchTerm is provided, check if it matches product codes
    let searchOrConditions = null;
    if (searchTerm) {
      const tokens = searchTerm.trim().split(/\s+/).filter(Boolean);

      const tokenConditions = (fields) =>
        tokens.map((token) => ({
          $or: fields.map((field) => ({
            [field]: { $regex: token, $options: "i" },
          })),
        }));

      // First, find products that match the search term (all tokens must match)
      const matchingProducts = await Product.find({
        $and: tokenConditions(["product_code", "name"]),
      }).select("_id");

      const matchingBills = await Bill.find({
        $and: tokenConditions(["billNo", "new_billno"]),
      }).select("_id");

      const productIds = matchingProducts.map((p) => p._id);
      const billIds = matchingBills.map((b) => b._id);

      const transactionTokenMatch = {
        $and: tokenConditions(["transactionId", "description"]),
      };

      searchOrConditions = [transactionTokenMatch];

      if (productIds.length > 0) {
        searchOrConditions.push({ productId: { $in: productIds } });
      }
      if (billIds.length > 0) {
        searchOrConditions.push({ billId: { $in: billIds } });
      }
    }

    // Combine the search $or and the party $or with $and so neither clobbers the other
    const andConditions = [];
    if (searchOrConditions) andConditions.push({ $or: searchOrConditions });
    if (partyOrConditions) andConditions.push({ $or: partyOrConditions });
    if (andConditions.length > 0) {
      matchStage.$and = andConditions;
    }

    // Fetch filtered transactions with population of related fields
    const transactionData = await Transaction.find(matchStage)
      .populate({
        path: "productId",
        select: "",
        model: "Product",
      })
      .populate({
        path: "invItemId",
        model: "Inventory",
      })
      .populate({
        path: "distributorId",
        select: "",
        model: "Distributor",
      })
      .populate({
        path: "billId",
        model: "Bill",
        populate: {
          path: "retailerId",
          model: "OutletApproved",
          select: "outletName ownerName outletCode",
        },
      })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // ---------------------------------------------------------------------
    // NEW: attach a normalized `party` object to every row for the frontend.
    //  - invoice rows                          -> party = the distributor (self)
    //  - delivery / salesreturn / purchasereturn rows with a bill -> party = retailer
    //  - everything else (stockadjustment, godowntransfer, opening stock) -> null
    // ---------------------------------------------------------------------
    const transactionsWithParty = transactionData.map((txn) => {
      let party = null;

      if (txn.transactionType === "invoice") {
        party = {
          id: txn.distributorId?._id,
          name: txn.distributorId?.name || txn.distributorId?.ownerName,
          type: "distributor",
        };
      } else if (
        ["delivery", "salesreturn", "purchasereturn"].includes(
          txn.transactionType,
        ) &&
        txn.billId?.retailerId
      ) {
        party = {
          id: txn.billId.retailerId._id,
          name:
            txn.billId.retailerId.outletName ||
            txn.billId.retailerId.ownerName,
          type: "retailer",
        };
      }

      return { ...txn, party };
    });

    // Total filtered count
    const totalFilteredCount = await Transaction.countDocuments(matchStage);

    // Total items count (without any filtering)
    const totalItemsCount = await Transaction.countDocuments({
      distributorId: req.user._id,
    });

    // Pagination calculation
    const totalPages = Math.ceil(totalFilteredCount / limitNum);

    return res.status(200).json({
      status: 200,
      message: "Transaction list retrieved successfully",
      data: transactionsWithParty,
      pagination: {
        currentPage: pageNum,
        limit: limitNum,
        totalPages,
        totalCount: totalItemsCount,
        filteredCount: totalFilteredCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// ---------------------------------------------------------------------------
// NEW: options endpoint that backs the searchable multi-select "Party" filter
// on the frontend. Register this as a route, e.g.:
//   router.get("/party-options", protect, searchPartyOptions);
// ---------------------------------------------------------------------------
const searchPartyOptions = asyncHandler(async (req, res) => {
  try {
    const { searchTerm = "" } = req.query;
    const distributorId = new mongoose.Types.ObjectId(req.user?._id);

    // Retailers this distributor has ever billed
    const billedRetailerIds = await Bill.distinct("retailerId", {
      distributorId,
    });

    const retailerQuery = { _id: { $in: billedRetailerIds } };
    if (searchTerm.trim()) {
      const regex = { $regex: searchTerm.trim(), $options: "i" };
      retailerQuery.$or = [
        { outletName: regex },
        { ownerName: regex },
        { outletCode: regex },
      ];
    }

    const retailers = await OutletApproved.find(retailerQuery)
      .select("outletName ownerName outletCode")
      .limit(20);

    const options = retailers.map((r) => ({
      value: r._id.toString(),
      label: r.outletName || r.ownerName || r.outletCode,
    }));

    // "self" = the distributor itself, used to filter invoice (stock-in) rows
    const selfLabel = req.user?.name || req.user?.ownerName || "My Account";
    if (
      !searchTerm.trim() ||
      selfLabel.toLowerCase().includes(searchTerm.trim().toLowerCase())
    ) {
      options.unshift({ value: "self", label: `${selfLabel} (Self)` });
    }

    return res.status(200).json({
      status: 200,
      message: "Party options retrieved successfully",
      data: options,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { allTransactionList, searchPartyOptions };