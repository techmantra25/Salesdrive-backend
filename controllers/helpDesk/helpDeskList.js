const HelpDesk = require("../../models/helpDesk.model");
const asyncHandler = require("express-async-handler");

const helpDeskList = asyncHandler(async (req, res) => {
  try {
    const helpDesks = await HelpDesk.find().sort({ createdAt: -1 });

    return res.status(200).json({
      status: 200,
      message: "HelpDesk entries fetched successfully",
      data: helpDesks,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { helpDeskList };
