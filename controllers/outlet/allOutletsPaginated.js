const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");
const mongoose = require("mongoose");

const allOutletsPaginated = asyncHandler(async (req, res) => {
  let {
    page = 1,
    limit = 10,
    zoneId,
    stateId,
    regionId,
    outletStatus,
    fromDate,
    toDate,
  } = req.query;

  page = parseInt(page, 10);
  limit = parseInt(limit, 10);
  const skip = (page - 1) * limit;

  const filter = {};

  if (outletStatus !== undefined) filter.outletStatus = outletStatus;

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) {
      const startOfDay = new Date(fromDate);
      startOfDay.setHours(0, 0, 0, 0);
      filter.createdAt.$gte = startOfDay;
    }
    if (toDate) {
      const endOfDay = new Date(toDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = endOfDay;
    }
  }

  if (zoneId) filter.zoneId = new mongoose.Types.ObjectId(zoneId);
  if (stateId) filter.stateId = new mongoose.Types.ObjectId(stateId);
  if (regionId) filter.regionId = new mongoose.Types.ObjectId(regionId);

  const pipeline = [
    { $match: filter },

    // Employee
    {
      $lookup: {
        from: "employees",
        localField: "employeeId",
        foreignField: "_id",
        as: "employeeId",
      },
    },
    { $unwind: { path: "$employeeId", preserveNullAndEmptyArrays: true } },

    // ZSM
    {
      $lookup: {
        from: "employees",
        localField: "zsm",
        foreignField: "_id",
        as: "zsm",
      },
    },
    { $unwind: { path: "$zsm", preserveNullAndEmptyArrays: true } },

    // RSM
    {
      $lookup: {
        from: "employees",
        localField: "rsm",
        foreignField: "_id",
        as: "rsm",
      },
    },
    { $unwind: { path: "$rsm", preserveNullAndEmptyArrays: true } },

    // ASM
    {
      $lookup: {
        from: "employees",
        localField: "asm",
        foreignField: "_id",
        as: "asm",
      },
    },
    { $unwind: { path: "$asm", preserveNullAndEmptyArrays: true } },

    // Zone
    {
      $lookup: {
        from: "zones",
        localField: "zoneId",
        foreignField: "_id",
        as: "zoneId",
      },
    },
    { $unwind: { path: "$zoneId", preserveNullAndEmptyArrays: true } },

    // State
    {
      $lookup: {
        from: "states",
        localField: "stateId",
        foreignField: "_id",
        as: "stateId",
      },
    },
    { $unwind: { path: "$stateId", preserveNullAndEmptyArrays: true } },

    // Region
    {
      $lookup: {
        from: "regions",
        localField: "regionId",
        foreignField: "_id",
        as: "regionId",
      },
    },
    { $unwind: { path: "$regionId", preserveNullAndEmptyArrays: true } },

    // District
    {
      $lookup: {
        from: "districts",
        localField: "district",
        foreignField: "_id",
        as: "district",
      },
    },
    { $unwind: { path: "$district", preserveNullAndEmptyArrays: true } },

    // Beat 
    {
      $lookup: {
        from: "beats",
        localField: "beatId",
        foreignField: "_id",
        as: "beatId",
      },
    },

    // Distributor
    {
      $lookup: {
        from: "distributors",
        localField: "distributorId",
        foreignField: "_id",
        as: "distributorId",
      },
    },
    { $unwind: { path: "$distributorId", preserveNullAndEmptyArrays: true } },

    // Selling Brands
    {
      $lookup: {
        from: "brands",
        localField: "sellingBrands",
        foreignField: "_id",
        as: "sellingBrands",
      },
    },

    // CreatedBy (Employee)
    {
      $lookup: {
        from: "employees",
        let: { createdById: "$createdBy", createdByType: "$createdBy_type" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$createdById"] },
                  { $eq: ["$$createdByType", "Employee"] },
                ],
              },
            },
          },
        ],
        as: "createdByEmployee",
      },
    },
    {
      $unwind: {
        path: "$createdByEmployee",
        preserveNullAndEmptyArrays: true,
      },
    },

    // CreatedBy (User)
    {
      $lookup: {
        from: "users",
        let: { createdById: "$createdBy", createdByType: "$createdBy_type" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$createdById"] },
                  { $eq: ["$$createdByType", "User"] },
                ],
              },
            },
          },
        ],
        as: "createdByUser",
      },
    },
    {
      $unwind: {
        path: "$createdByUser",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Combine createdBy
    {
      $addFields: {
        createdBy: {
          $cond: [
            { $eq: ["$createdBy_type", "Employee"] },
            "$createdByEmployee",
            "$createdByUser",
          ],
        },
      },
    },
    {
      $project: {
        createdByEmployee: 0,
        createdByUser: 0,
      },
    },

    { $sort: { _id: -1 } },
    { $skip: skip },
    { $limit: limit },
  ];

  const countPipeline = [{ $match: filter }, { $count: "count" }];

  const outlets = await Outlet.aggregate(pipeline);
  const filteredCountResult = await Outlet.aggregate(countPipeline);
  const totalFilteredCount = filteredCountResult[0]?.count || 0;
  const totalCount = await Outlet.countDocuments({});
  const totalActiveCount = await Outlet.countDocuments({
    outletStatus: "Approved",
  });

  return res.status(200).json({
    status: 200,
    message: "All outlets list",
    data: outlets,
    pagination: {
      currentPage: page,
      limit,
      totalPages: Math.ceil(totalFilteredCount / limit),
      totalCount,
      filteredCount: totalFilteredCount,
      totalActiveCount,
    },
  });
});

module.exports = {
  allOutletsPaginated,
};
