const asyncHandler = require("express-async-handler");
const Zone = require("../models/zone.model");
const State = require("../models/state.model");
// const { generateCode } = require("../utils/codeGenerator");

const createZone = asyncHandler(async (req, res) => {
  try {
    const { code, name } = req.body;

    // const zoneCode = await generateCode("Z-LX");

    let zoneExist = await Zone.findOne({ code: code });
    // Check if a zone with the same code already exists

    if (zoneExist) {
      res.status(400);
      throw new Error("Zone already exists");
    }

    const zoneData = await Zone.create({
      name,
      code,
    });

    return res.status(201).json({
      status: 201,
      message: "Zone created successfully",
      data: zoneData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const detailZone = asyncHandler(async (req, res) => {
  try {
    let zoneList = await Zone.findOne({ _id: req.params.zid });
    return res.status(201).json({
      status: 201,
      message: "All Zone list",
      data: zoneList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

//update

const updateZone = asyncHandler(async (req, res) => {
  try {
    // Check if the zone ID is present in the State model
    const stateWithZone = await State.findOne({ zoneId: req.params.zid });

    let message;

    if (stateWithZone && req.body.hasOwnProperty("status")) {
      // If the zone is present in the State model, remove the status field from the update payload
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message: "Zone is present in the State model, status cannot be updated",
      };
    }

    // Proceed with the zone update
    let zoneList = await Zone.findOneAndUpdate(
      { _id: req.params.zid },
      req.body,
      { new: true }
    );

    if (zoneList) {
      if (!message) {
        message = {
          error: false,
          message: "Zone updated successfully",
          data: zoneList,
        };
      } else {
        message.data = zoneList;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Zone not updated",
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
    let zoneList = await Zone.find({}).sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Zone list",
      data: zoneList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = {
  createZone,
  allList,
  detailZone,
  updateZone,
};
