const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const PurchaseReturn = require("../../models/purchaseReturn.model");

const purchaseReturnPaginatedList = asyncHandler(async (req, res) => {
  let {
    page = 1,
    limit = 10,
    search,
    fromDate,
    toDate,
    distributorId,
    status,
  } = req.query;

  page = parseInt(page, 10);
  limit = parseInt(limit, 10);
  const skip = (page - 1) * limit;

  /** -------------------------
   * Base Match
   * ------------------------- */
  const matchStage = {};

  if (distributorId) {
    matchStage.distributorId = new mongoose.Types.ObjectId(distributorId);
  }

  if (status) {
    matchStage.status = status;
  }

  if (fromDate || toDate) {
    matchStage.createdAt = {};

    if (fromDate) {
      const start = new Date(fromDate);
      start.setHours(0, 0, 0, 0);
      matchStage.createdAt.$gte = start;
    }

    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      matchStage.createdAt.$lte = end;
    }
  }

  /** -------------------------
   * Aggregation Pipeline
   * ------------------------- */
  const pipeline = [
    { $match: matchStage },

    // 🔹 Invoice lookup
    {
      $lookup: {
        from: "invoices",
        localField: "invoiceId",
        foreignField: "_id",
        as: "invoice",
      },
    },
    { $unwind: "$invoice" },

    // 🔹 Search
    ...(search
      ? [
          {
            $match: {
              $or: [
                { code: { $regex: search, $options: "i" } },
                { "invoice.invoiceNo": { $regex: search, $options: "i" } },
              ],
            },
          },
        ]
      : []),

    // 🔹 Sorting
    { $sort: { createdAt: -1 } },

    // 🔹 Pagination
    { $skip: skip },
    { $limit: limit },

    // 🔹 Distributor populate
    {
      $lookup: {
        from: "distributors",
        localField: "distributorId",
        foreignField: "_id",
        as: "distributor",
      },
    },
    { $unwind: "$distributor" },

    // 🔹 Product lookup
    {
      $lookup: {
        from: "products",
        localField: "lineItems.product",
        foreignField: "_id",
        as: "products",
      },
    },

    // 🔹 Plant lookup
    {
      $lookup: {
        from: "plants",
        localField: "lineItems.plant",
        foreignField: "_id",
        as: "plants",
      },
    },

    // 🔹 Merge product & plant into lineItems
    {
      $addFields: {
        lineItems: {
          $map: {
            input: "$lineItems",
            as: "item",
            in: {
              $mergeObjects: [
                "$$item",
                {
                  product: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$products",
                          as: "p",
                          cond: { $eq: ["$$p._id", "$$item.product"] },
                        },
                      },
                      0,
                    ],
                  },
                  plant: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$plants",
                          as: "pl",
                          cond: { $eq: ["$$pl._id", "$$item.plant"] },
                        },
                      },
                      0,
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },

    // 🔹 Cleanup temp arrays
    {
      $project: {
        products: 0,
        plants: 0,
      },
    },
  ];

  /** -------------------------
   * Count Pipeline
   * ------------------------- */
  const countPipeline = pipeline.filter(
    (stage) => !stage.$skip && !stage.$limit
  );

  const [data, countResult] = await Promise.all([
    PurchaseReturn.aggregate(pipeline),
    PurchaseReturn.aggregate([...countPipeline, { $count: "count" }]),
  ]);

  const filteredCount = countResult[0]?.count || 0;
  const totalCount = await PurchaseReturn.countDocuments();

  /** -------------------------
   * Response
   * ------------------------- */
  return res.status(200).json({
    status: 200,
    error: false,
    message: "Paginated purchase returns fetched successfully",
    data,
    pagination: {
      currentPage: page,
      limit,
      totalPages: Math.ceil(filteredCount / limit),
      totalCount,
      filteredCount,
    },
  });
});

module.exports = { purchaseReturnPaginatedList };
