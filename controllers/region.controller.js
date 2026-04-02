const asyncHandler = require("express-async-handler");
const Region = require("../models/region.model");
// const { generateCode } = require("../utils/codeGenerator");

const createRegion = asyncHandler(async (req, res) => {
  try {
    const { code, name, stateId } = req.body;

    let regionExist = await Region.findOne({
      code: req.body.code,
    });

    if (regionExist) {
      res.status(400);
      throw new Error("Region already exists");
    }

    const regionData = await Region.create({
      name,
      stateId,
      code,
    });

    return res.status(201).json({
      status: 201,
      message: "Region created successfully",
      data: regionData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const detailRegion = asyncHandler(async (req, res) => {
  try {
    let RegionList = await Region.findOne({ _id: req.params.rid }).populate([
      {
        path: "stateId",
        select: "",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "All Region list",
      data: RegionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// update

const RegionUpdate = asyncHandler(async (req, res) => {
  try {
    let RegionList = await Region.findOneAndUpdate(
      { _id: req.params.rid },
      req.body,
      { new: true }
    );
    if (RegionList) {
      message = {
        error: false,
        message: "Region updated successfully",
        data: RegionList,
      };
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "RegionList not upadated",
      };
      return res.status(500).send(message);
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const allList = asyncHandler(async (req, res) => {
  try {
    let RegionList = await Region.find({})
      .populate([
        {
          path: "stateId",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Region list",
      data: RegionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const listByZone = asyncHandler(async (req, res) => {
  try {
    let RegionList = await Region.find({ zoneId: req.params.zid })
      .populate([
        {
          path: "stateId",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Region list",
      data: RegionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createRegion,
  detailRegion,
  RegionUpdate,
  allList,
  listByZone,
};
