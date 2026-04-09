const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");

const Bill = require("../../models/bill.model");
const OrderEntry = require("../../models/orderEntry.model");
const Invoice = require("../../models/invoice.model");
const Inventory = require("../../models/inventory.model");
const OutletApproved = require("../../models/outletApproved.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Transaction = require("../../models/transaction.model");
const Beat = require("../../models/beat.model");
const { calculateInTransitMap } = require("../../utils/calculateInTransitQty");

const getDashboardStats = asyncHandler(async (req, res) => {
  const distributorId = req.user._id;
  const filter = { distributorId };

  const {
    fromDate,
    toDate,
    salesPeriod = "today",
    stockView = "total",
  } = req.query;

  const startDate = fromDate
    ? moment(fromDate).startOf("day").toDate()
    : moment().subtract(5, "weeks").startOf("week").toDate();

  const endDate = toDate
    ? moment(toDate).endOf("day").toDate()
    : moment().endOf("day").toDate();

  const [
    orderVsBill,
    purchaseVsGRN,
    stockStatus,
    outletCount,
    points,
    sales,
    purchaseVsSales,
  ] = await Promise.all([
    getOrderVsBillCount(filter, startDate, endDate),
    getPurchaseVsGRN(filter, startDate, endDate),
    getCurrentStockStatus(filter, stockView, startDate, endDate),
    getOutletCount(distributorId),
    getPointsData(distributorId),
    getSalesData(filter, salesPeriod),
    getPurchaseVsSalesValue(filter),
  ]);

  res.status(200).json({
    status: 200,
    message: "Distributor dashboard stats retrieved successfully",
    data: {
      orderVsBill,
      purchaseVsGRN,
      stockStatus,
      outletCount,
      points,
      sales,
      purchaseVsSales,
    },
  });
});

const getSalesDateRange = (period) => {
  const now = moment().tz("Asia/Kolkata");

  switch (period) {
    case "7d":
      return {
        start: now.clone().subtract(6, "days").startOf("day").toDate(),
        end: now.clone().endOf("day").toDate(),
      };

    case "30d":
      return {
        start: now.clone().subtract(29, "days").startOf("day").toDate(),
        end: now.clone().endOf("day").toDate(),
      };

    case "90d":
      return {
        start: now.clone().subtract(89, "days").startOf("day").toDate(),
        end: now.clone().endOf("day").toDate(),
      };

    case "year":
      return {
        start: now.clone().startOf("year").toDate(),
        end: now.clone().endOf("day").toDate(),
      };

    case "today":
    default:
      return {
        start: now.clone().startOf("day").toDate(),
        end: now.clone().endOf("day").toDate(),
      };
  }
};

// 1️⃣ Order vs Bill (Weekly)
const getOrderVsBillCount = async (filter, startDate, endDate) => {
  const weeks = [];
  let current = moment(startDate).tz("Asia/Kolkata");

  for (let i = 1; i <= 5; i++) {
    weeks.push({
      label: `Week ${i}`,
      start: current.clone().toDate(),
      end: current.clone().add(6, "days").endOf("day").toDate(),
    });
    current.add(7, "days");
  }

  weeks.push({
    label: "Present Day",
    start: moment().tz("Asia/Kolkata").startOf("day").toDate(),
    end: moment().tz("Asia/Kolkata").endOf("day").toDate(),
  });

  return Promise.all(
    weeks.map(async (week) => {
      const [orderCount, billCount] = await Promise.all([
        OrderEntry.countDocuments({
          ...filter,
          createdAt: { $gte: week.start, $lte: week.end },
        }),
        Bill.countDocuments({
          ...filter,
          createdAt: { $gte: week.start, $lte: week.end },
        }),
      ]);

      return {
        period: week.label,
        orderCount,
        billCount,
      };
    })
  );
};

// 2️⃣ Purchase vs GRN
const getPurchaseVsGRN = async (filter, startDate, endDate) => {
  const weeks = [];
  let current = moment(startDate).tz("Asia/Kolkata");

  for (let i = 1; i <= 5; i++) {
    weeks.push({
      label: `Week ${i}`,
      start: current.clone().toDate(),
      end: current.clone().add(6, "days").endOf("day").toDate(),
    });
    current.add(7, "days");
  }

  weeks.push({
    label: "Present Day",
    start: moment().tz("Asia/Kolkata").startOf("day").toDate(),
    end: moment().tz("Asia/Kolkata").endOf("day").toDate(),
  });

  return Promise.all(
    weeks.map(async (week) => {
      const [purchaseCount, grnCount] = await Promise.all([
        Invoice.countDocuments({
          ...filter,
          createdAt: { $gte: week.start, $lte: week.end },
        }),
        Invoice.countDocuments({
          ...filter,
          status: "Confirmed",
          grnDate: { $gte: week.start, $lte: week.end },
        }),
      ]);

      return {
        period: week.label,
        purchaseCount,
        grnCount,
      };
    })
  );
};

// 3️⃣ Current Stock Status - FIXED VERSION
const getCurrentStockStatus = async (
  filter,
  stockView = "total",
  startDate,
  endDate
) => {
  stockView = stockView.toLowerCase();

  /* -------- Get ALL inventory data with product details -------- */
  const inventory = await Inventory.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $project: {
        productId: "$product._id",
        name: { $ifNull: ["$product.product_code", "$product.name"] },
        salable: { $ifNull: ["$availableQty", 0] },
        unsalable: { $ifNull: ["$unsalableQty", 0] },
        reserved: { $ifNull: ["$reservedQty", 0] },
        offer: { $ifNull: ["$offerQty", 0] },
      },
    },
    {
      $addFields: {
        currentStock: {
          $add: ["$salable", "$unsalable", "$reserved", "$offer"],
        },
      },
    },
  ]);

  /* ===== VIEW: TOTAL INVENTORY ===== */
  if (stockView === "total") {
    // ✅ FIX: For total view, always show CURRENT in-transit (not filtered by date range)
    // Use a wide date range or no end date to get all current in-transit items
    const currentInTransitMap = await calculateInTransitMap(
      filter.distributorId,
      moment().subtract(1, "year").toDate(), // Start from 1 year ago to catch all relevant invoices
      moment().add(1, "year").toDate() // Future date to include all pending deliveries
    );

    // Update inventory items with real in-transit data
    inventory.forEach((item) => {
      const productId = item.productId.toString();
      item.inTransit = currentInTransitMap.get(productId) || 0;
    });

    const totals = inventory.reduce(
      (acc, item) => {
        acc.salable += item.salable;
        acc.inTransit += item.inTransit;
        acc.currentStock += item.currentStock;
        return acc;
      },
      { salable: 0, inTransit: 0, currentStock: 0 }
    );

    return {
      view: "total",
      totalItems: totals.currentStock,
      data: [
        {
          name: "Inventory",
          Salable: totals.salable,
          "In-Transit": totals.inTransit,
          "Current Stock": totals.currentStock,
        },
      ],
    };
  }

  /* ===== VIEW: TOP 5 PRODUCTS ===== */
  if (stockView === "top5") {
    // ✅ FIX: For top5 view, always show CURRENT in-transit (not filtered by date range)
    const currentInTransitMap = await calculateInTransitMap(
      filter.distributorId,
      moment().subtract(1, "year").toDate(),
      moment().add(1, "year").toDate()
    );

    // Update inventory items with real in-transit data
    inventory.forEach((item) => {
      const productId = item.productId.toString();
      item.inTransit = currentInTransitMap.get(productId) || 0;
    });

    const top5 = [...inventory]
      .sort((a, b) => b.currentStock - a.currentStock)
      .slice(0, 5);

    return {
      view: "top5",
      totalItems: top5.reduce((sum, item) => sum + item.currentStock, 0),
      data: top5.map((p) => ({
        name: p.name,
        Salable: p.salable,
        "In-Transit": p.inTransit,
        "Current Stock": p.currentStock,
      })),
    };
  }

  /* ===== VIEW: LAST 6 MONTHS (HISTORICAL DATA) ===== */
  if (stockView === "last6months") {
    const months = [];

    // Generate month ranges
    for (let i = 5; i >= 0; i--) {
      const start = moment().subtract(i, "months").startOf("month");
      const end = moment().subtract(i, "months").endOf("month");

      months.push({
        label: start.format("MMM"),
        start: start.toDate(),
        end: end.toDate(),
      });
    }

    const monthData = await Promise.all(
      months.map(async (m) => {
        // Get inventory snapshot for this month
        const monthInventory = await Inventory.aggregate([
          {
            $match: {
              ...filter,
              createdAt: { $lte: m.end },
            },
          },
          {
            $lookup: {
              from: "products",
              localField: "productId",
              foreignField: "_id",
              as: "product",
            },
          },
          { $unwind: "$product" },
          {
            $group: {
              _id: null,
              salable: { $sum: "$availableQty" },
              unsalable: { $sum: "$unsalableQty" },
              reserved: { $sum: "$reservedQty" },
              offer: { $sum: "$offerQty" },
            },
          },
        ]);

        // ✅ This is correct: Calculate in-transit for each specific month
        const monthInTransitMap = await calculateInTransitMap(
          filter.distributorId,
          m.start,
          m.end
        );

        const totalInTransit = Array.from(monthInTransitMap.values()).reduce(
          (sum, qty) => sum + qty,
          0
        );

        const stockData = monthInventory[0] || {
          salable: 0,
          unsalable: 0,
          reserved: 0,
          offer: 0,
        };

        const currentStock =
          stockData.salable +
          stockData.unsalable +
          stockData.reserved +
          stockData.offer;

        return {
          name: m.label,
          Salable: stockData.salable,
          "In-Transit": totalInTransit,
          "Current Stock": currentStock,
        };
      })
    );

    return {
      view: "last6months",
      totalItems: monthData.at(-1)?.[" Stock"] || 0,
      data: monthData,
    };
  }

  return { view: stockView, totalItems: 0, data: [] };
};

// 4️⃣ Outlet Count
const getOutletCount = async (distributorId) => {
  const now = moment().tz("Asia/Kolkata");
  const lastMonthEnd = moment()
    .tz("Asia/Kolkata")
    .subtract(1, "month")
    .endOf("month");

  // 1️⃣ Get beats
  const beats = await Beat.find({ distributorId }).select("_id");
  const beatIds = beats.map((b) => b._id);

  if (!beatIds.length) {
    return {
      total: 0,
      active: 0,
      inactive: 0,
      percentageChange: 0,
    };
  }

  const baseFilter = { beatId: { $in: beatIds } };

  // 2️⃣ Current active & inactive
  const [activeNow, inactiveNow] = await Promise.all([
    OutletApproved.countDocuments({
      ...baseFilter,
      status: true,
    }),
    OutletApproved.countDocuments({
      ...baseFilter,
      status: false,
    }),
  ]);

  // 3️⃣ Active as of last month end
  const activeLastMonth = await OutletApproved.countDocuments({
    ...baseFilter,
    status: true,
    updatedAt: { $lte: lastMonthEnd.toDate() },
  });

  const percentageChange =
    activeLastMonth > 0
      ? (((activeNow - activeLastMonth) / activeLastMonth) * 100).toFixed(1)
      : 0;

  return {
    total: activeNow + inactiveNow,
    active: activeNow,
    inactive: inactiveNow,
    percentageChange: Number(percentageChange),
  };
};

// 5️⃣ Points
const getPointsData = async (distributorId) => {
  const result = await DistributorTransaction.aggregate([
    {
      $match: {
        distributorId,
        status: "Success", // only real transactions
      },
    },
    {
      $group: {
        _id: null,
        earned: {
          $sum: {
            $cond: [{ $eq: ["$transactionType", "credit"] }, "$point", 0],
          },
        },
        gifted: {
          $sum: {
            $cond: [{ $eq: ["$transactionType", "debit"] }, "$point", 0],
          },
        },
      },
    },
  ]);

  const earned = result[0]?.earned || 0;
  const gifted = result[0]?.gifted || 0;

  return {
    earned,
    gifted,
    net: earned - gifted,
  };
};

// 6️⃣ Sales Breakdown
const getSalesData = async (filter, salesPeriod = "today") => {
  const { start, end } = getSalesDateRange(salesPeriod);
  const sales = await OrderEntry.aggregate([
    {
      $match: {
        ...filter,
        status: { $in: ["Completed_Billed", "Partially_Billed"] },
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: "$orderSource",
        totalValue: { $sum: "$netAmount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const totalValue = sales.reduce((sum, item) => sum + item.totalValue, 0);

  const breakdown = sales.map((item) => ({
    category:
      item._id === "SFA"
        ? "SFA Sale"
        : item._id === "Distributor"
        ? "Distributor Sale"
        : item._id === "Retailer"
        ? "Retailer Sale"
        : item._id === "Telecaller"
        ? "Phone Orders"
        : "Other",
    value: item.totalValue,
    percentage:
      totalValue > 0
        ? ((item.totalValue / totalValue) * 100).toFixed(1)
        : "0.0",
    count: item.count,
  }));

  const todayStart = moment().tz("Asia/Kolkata").startOf("day").toDate();
  const todayEnd = moment().tz("Asia/Kolkata").endOf("day").toDate();

  const todaySales = await Bill.aggregate([
    {
      $match: {
        ...filter,
        status: "Delivered",
        "dates.deliveryDate": {
          $gte: todayStart,
          $lte: todayEnd,
        },
      },
    },
    { $group: { _id: null, total: { $sum: "$netAmount" } } },
  ]);

  return {
    breakdown,
    totalValue,
    todayTotal: todaySales[0]?.total || 0,
    period: salesPeriod,
    range: { start, end },
  };
};

// 7️⃣ Purchase vs Sales (Monthly)
const getPurchaseVsSalesValue = async (filter) => {
  const tz = "Asia/Kolkata";

  // 📅 Generate last 6 linear months
  const months = [];
  let current = moment().tz(tz).subtract(5, "months").startOf("month");

  for (let i = 0; i < 6; i++) {
    months.push({
      key: current.format("YYYY-MM"),
      label: current.format("MMM"),
      start: current.clone().startOf("month").toDate(),
      end: current.clone().endOf("month").toDate(),
    });
    current.add(1, "month");
  }

  // 🟢 Purchases
  const purchaseAgg = await Invoice.aggregate([
    {
      $match: {
        ...filter,
        createdAt: {
          $gte: months[0].start,
          $lte: months[5].end,
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: { date: "$createdAt", timezone: tz } },
          month: { $month: { date: "$createdAt", timezone: tz } },
        },
        total: { $sum: "$totalInvoiceAmount" },
      },
    },
  ]);

  // 🔵 Sales
  const salesAgg = await Bill.aggregate([
    {
      $match: {
        ...filter,
        status: "Delivered",
        "dates.deliveryDate": {
          $gte: months[0].start,
          $lte: months[5].end,
        },
      },
    },
    {
      $group: {
        _id: {
          year: {
            $year: { date: "$dates.deliveryDate", timezone: tz },
          },
          month: {
            $month: { date: "$dates.deliveryDate", timezone: tz },
          },
        },
        total: { $sum: "$netAmount" },
      },
    },
  ]);

  // 🧠 Lookup maps
  const purchaseMap = new Map();
  purchaseAgg.forEach((p) => {
    const key = `${p._id.year}-${String(p._id.month).padStart(2, "0")}`;
    purchaseMap.set(key, p.total);
  });

  const salesMap = new Map();
  salesAgg.forEach((s) => {
    const key = `${s._id.year}-${String(s._id.month).padStart(2, "0")}`;
    salesMap.set(key, s.total);
  });

  // 📊 Zero-filled, ordered, FINAL dataset
  return months.map((m) => ({
    month: m.label,
    purchaseValue: purchaseMap.get(m.key) || 0,
    salesValue: salesMap.get(m.key) || 0,
  }));
};


module.exports = { getDashboardStats };
