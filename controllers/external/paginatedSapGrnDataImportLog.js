const asyncHandler = require("express-async-handler");
const GrnLOG = require("../../models/grnLogSchema");
const moment = require("moment");

const paginatedSapGrnDataImportLog = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search,
      fromDate,
      toDate,
      status,

      // 👈 NEW CreatedAt filter
      createdFromDate,
      createdToDate,
    } = req.query;

    page = Number(page);
    limit = Number(limit);

    let query = {};

    // -----------------------------------------
    // ORIGINAL PO DATE FILTER (GrnData.Fkdat)
    // -----------------------------------------
    if (fromDate || toDate) {
      const from = fromDate
        ? moment(fromDate, "YYYY-MM-DD").format("YYYYMMDD")
        : null;
      const to = toDate
        ? moment(toDate, "YYYY-MM-DD").format("YYYYMMDD")
        : null;

      if (from && to) {
        query.$expr = {
          $and: [
            { $gte: ["$GrnData.Fkdat", from] },
            { $lte: ["$GrnData.Fkdat", to] },
          ],
        };
      } else if (from) {
        query.$expr = { $gte: ["$GrnData.Fkdat", from] };
      } else if (to) {
        query.$expr = { $lte: ["$GrnData.Fkdat", to] };
      }
    }

    // -----------------------------------------
    // NEW: CREATED AT DATE RANGE FILTER
    // -----------------------------------------
    if (createdFromDate || createdToDate) {
      const createdRange = {};

      if (createdFromDate) {
        const start = new Date(createdFromDate);
        start.setHours(0, 0, 0, 0); // FIX timezone issue
        createdRange.$gte = start;
      }

      if (createdToDate) {
        const end = new Date(createdToDate);
        end.setHours(23, 59, 59, 999);
        createdRange.$lte = end;
      }

      query.createdAt = createdRange; // 👈 attach createdAt filter
    }

    // -----------------------------------------
    // SEARCH FILTER
    // -----------------------------------------
    if (search) {
      query.$or = [
        { Grn_Id: { $regex: search, $options: "i" } },
        { ErrorLog: { $regex: search, $options: "i" } },
        { SearchKey: { $regex: search, $options: "i" } },
      ];
    }

    // -----------------------------------------
    // STATUS FILTER
    // -----------------------------------------
    if (status && status !== "default") {
      query.GrnStatus = status;
    }

    // -----------------------------------------
    // COUNTS
    // -----------------------------------------
    const filteredCount = await GrnLOG.countDocuments(query);
    const totalActiveCount = await GrnLOG.countDocuments({});

    // -----------------------------------------
    // PAGINATED DATA
    // -----------------------------------------
    const result = await GrnLOG.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: "invoiceId",
        populate: {
          path: "distributorId",
          select: "dbCode name",
        },
      });

    return res.status(200).json({
      status: 200,
      message: "SAP GRN Data Import Log",
      data: result,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    console.error("Error in paginatedSapGrnDataImportLog:", error);
    res.status(500);
    throw error;
  }
});

module.exports = { paginatedSapGrnDataImportLog };