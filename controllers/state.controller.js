const asyncHandler = require("express-async-handler");
const State = require("../models/state.model");
const Region = require("../models/region.model");
// const { generateCode } = require("../utils/codeGenerator");

const createState = asyncHandler(async (req, res) => {
  try {
    const { code, name, zoneId, slug } = req.body;

    let stateExist = await State.findOne({
      code: code,
    });

    if (stateExist) {
      res.status(400);
      throw new Error("State already exists");
    }

    // const StateCode = await generateCode("ST-LX");

    const stateData = await State.create({
      name,
      zoneId,
      code,
      slug,
    });

    return res.status(201).json({
      status: 201,
      message: "State created successfully",
      data: stateData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const detailState = asyncHandler(async (req, res) => {
  try {
    let StateList = await State.findOne({ _id: req.params.sid }).populate([
      {
        path: "zoneId",
        select: "",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "All State list",
      data: StateList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// update

const StateUpdate = asyncHandler(async (req, res) => {
  try {
    // Check if the zone ID is present in the State model
    const RegionWithState = await Region.findOne({ stateId: req.params.sid });

    let message;

    if (RegionWithState && req.body.hasOwnProperty("status")) {
      // If the State is present in the Region model, remove the status field from the update payload
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message:
          "State is present in the Region model, status cannot be updated",
      };
    }

    // Proceed with the State update
    let stateList = await State.findOneAndUpdate(
      { _id: req.params.sid },
      req.body,
      { new: true }
    );

    if (stateList) {
      if (!message) {
        message = {
          error: false,
          message: "State updated successfully",
          data: stateList,
        };
      } else {
        message.data = stateList;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "State not updated",
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
    let StateList = await State.find({})
      .populate([
        {
          path: "zoneId",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All State list",
      data: StateList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const listByZone = asyncHandler(async (req, res) => {
  try {
    let StateList = await State.find({
      $and: [{ zoneId: req.params.zid }, { regionId: req.params.rid }],
    })
      .populate([
        {
          path: "zoneId",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Region list",
      data: StateList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createState,
  detailState,
  StateUpdate,
  allList,
  listByZone,
};
