const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");
const mongoose = require("mongoose");

//controller to get outlets list fast

const getOutletMinimalByDistributor = asyncHandler(async (req, res) => {
  try {
    const { did } = req.params; //distributor id

    //get all beats for this distributor

    const beats = await Beat.find(
      { distributorId: { $in: [did] } },
      { _id: 1 } //only get beat id
    ).lean();

    const beatIds = beats.map((beat) => beat._id);

    //get only the outlet data that is required for the usage

    const outlets = await OutletApproved.find(
      {
        beatId: { $in: beatIds },
        status: true,
      },
      {
        _id: 1,
        outletName: 1,
        outletCode: 1,
        outletUID: 1,
        beatId: 1,
        mobile1:1,
      }
    )
      .sort({ outletName: 1 })
      .lean();

    // const testids = outlets.map(o=> o.beatId);
    // console.log(testids);

    const normalizedOutlets = outlets.map((outlet) => ({
      ...outlet,
      beatId: Array.isArray(outlet.beatId)
        ? outlet.beatId.map((id) => id.toString())
        : [outlet.beatId.toString()],
    }));

    //normalizing the beatid to always be an array

    return res.status(200).json({
      status: 200,
      message: "Outlet list fetched",
      data: normalizedOutlets,
      count: normalizedOutlets.length,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "failed to fetch the outlet list");
  }
});

//controller to search outlets

const searchOutletsByDistributor = asyncHandler(async (req, res) => {
  try {
    const { did } = req.params;
    const { search, limit = 50 } = req.query;

    //validation
    if (!search || search.trim().length < 2) {
      return res.status(400).json({
        status: 400,
        message: "Search term must be at least 2 charecters long",
        data: [],
      });
    }

    //get beat id for this distributor

    const beats = await Beat.find(
      { distributorId: { $in: [did] } },
      { _id: 1 }
    ).lean();

    const beatIds = beats.map((beat) => beat._id);

    const outlets = await OutletApproved.find(
      {
        $text: { $search: search },
        beatId: { $in: beatIds },
        status: true,
      },
      {
        score: { $meta: "textScore" },
        _id: 1,
        outletName: 1,
        outletCode: 1,
        outletUID: 1,
        beatId: 1,
      }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(parseInt(limit))
      .lean();

    const normalizedOutlets = outlets.map((outlet) => ({
      ...outlet,
      beatId: Array.isArray(outlet.beatId)
        ? outlet.beatId.map((id) => id.toString())
        : [outlet.beatId.toString()],
    }));

    return res.status(200).json({
      status: 200,
      messages: "search results",
      data: normalizedOutlets,
      count: normalizedOutlets.length,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "search failed");
  }
});

//get full outlet details

const getOutletDetailById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 400,
        message: "Invalid outlet ID",
      });
    }

    const outlet = await OutletApproved.findById(id)
      .populate([
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "rsm",
          select: "",
        },
        {
          path: "asm",
          select: "",
        },
        {
          path: "zsm",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },

        {
          path: "distributorId",
          select: "",
        },

        {
          path: "sellingBrands",
          select: "",
        },
        {
          path: "createdFromLead",
          select: "",
        },
        {
          path: "employeeId",
          select: "",
        },
        {
          path: "createdBy",
          select: "",
        },
        {
          path: "district",
          select: "",
        },
        {
          path: "referenceId",
          select: "",
        },
      ])
      .lean();

    if (!outlet) {
      res.status(400).json({
        status: 404,
        message: "Outlet not found",
      });
    }
    return res.status(200).json({
      status: 200,
      message: "Outlet details loaded successfully",
      data: outlet,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Failed to fetch outlet details");
  }
});

const getOutletByDistributor = asyncHandler(async (req, res) => {
  try {
    const { did } = req.params;

    const beats = await Beat.find({
      distributorId: { $in: [did] },
    });

    const beatIds = beats.map((beat) => beat._id);

    const outletsApproved = await OutletApproved.find({
      beatId: { $in: beatIds },
      status: true,
    })
      .populate([
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "rsm",
          select: "",
        },
        {
          path: "asm",
          select: "",
        },
        {
          path: "zsm",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },

        {
          path: "distributorId",
          select: "",
        },

        {
          path: "sellingBrands",
          select: "",
        },
        {
          path: "createdFromLead",
          select: "",
        },
        {
          path: "employeeId",
          select: "",
        },
        {
          path: "createdBy",
          select: "",
        },
        {
          path: "district",
          select: "",
        },
        {
          path: "referenceId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "Outlet list by distributor",
      data: outletsApproved,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  getOutletMinimalByDistributor,
  searchOutletsByDistributor,
  getOutletDetailById,
  getOutletByDistributor,
};
