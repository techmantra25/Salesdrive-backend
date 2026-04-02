const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");
const { generateCode } = require("../../utils/codeGenerator");

const createBeat = asyncHandler(async (req, res) => {
  try {
    const { name, beat_type, regionId, distributorId, beatIds } = req.body;

    let beatExist = await Beat.findOne({
      $and: [{ name: req.body.name }, { regionId: req.body.regionId }],
    });

    if (beatExist) {
      res.status(400);
      throw new Error("Beat already exists");
    }

    // beatIds should be an array, if provided
    if (beatIds && !Array.isArray(beatIds)) {
      res.status(400);
      throw new Error("beatIds should be an array");
    }

    const BeatCode = await generateCode("BEAT");

    // Ensure distributorId is an array
    const distributorIds = Array.isArray(distributorId)
      ? distributorId
      : distributorId
      ? [distributorId]
      : [];

    const beatData = await Beat.create({
      name,
      beat_type,
      regionId,
      beatIds,
      distributorId: distributorIds,
      code: BeatCode,
    });

    return res.status(201).json({
      status: 201,
      message: "Beat created successfully",
      data: beatData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createBeat };
