const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");
const { generateCode } = require("../../utils/codeGenerator");

const createBeat = asyncHandler(async (req, res) => {
  try {
    const {
      name,
      beat_type,
      regionId,
      distributorId,
      beatIds,
      subDivisionId,
    } = req.body;

    let beatExist = await Beat.findOne({
      name,
      regionId,
    });

    if (beatExist) {
      res.status(400);
      throw new Error("Beat already exists");
    }

    if (beatIds && !Array.isArray(beatIds)) {
      res.status(400);
      throw new Error("beatIds should be an array");
    }

    // Keep generating until an unused code is found
    let BeatCode;
    let codeExists = true;

    while (codeExists) {
      BeatCode = await generateCode("BEAT");
      codeExists = await Beat.exists({ code: BeatCode });
    }

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
      subDivisionId,
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