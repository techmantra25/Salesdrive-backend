const asyncHandler = require("express-async-handler");
const DBRule = require("../models/dbRule.model");

// Create and Save a new DBRule
const createDbRule = asyncHandler(async (req, res) => {
  try {
    const { dbId, module, rules } = req.body;

    if (!dbId || !module) {
      res.status(400);
      throw new Error("dbId and module are required");
    }

    // find if dbRule already exists
    const dbRuleExist = await DBRule.findOne({
      dbId,
      module,
    });

    // if dbRule already exists
    if (dbRuleExist) {
      res.status(400);
      throw new Error("DBRule already exists");
    }

    // create a new dbRule
    const dbRule = await DBRule.create({
      dbId,
      module,
      rules: rules ?? [],
    });

    return res.status(201).json({
      status: 201,
      message: "DBRule created successfully",
      data: dbRule,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

// Update and save DBRule
const updateDbRule = asyncHandler(async (req, res) => {
  try {
    const { dbId } = req.params;
    const { module, rules } = req.body;

    if (!dbId || !module) {
      res.status(400);
      throw new Error("dbId and module are required");
    }

    // find the dbRule by dbId and module
    const dbRule = await DBRule.findOne({ dbId, module });

    if (!dbRule) {
      res.status(404);
      throw new Error("DBRule not found");
    }

    // update the dbRule
    dbRule.rules = rules ?? dbRule.rules;
    await dbRule.save();

    return res.status(200).json({
      status: 200,
      message: "DBRule updated successfully",
      data: dbRule,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

// Get DBRule by id
const getDbRule = asyncHandler(async (req, res) => {
  try {
    const { dbId } = req.params;

    if (!dbId) {
      res.status(400);
      throw new Error("dbId is required");
    }

    // find the dbRule by dbId
    const dbRule = await DBRule.find({ dbId });

    if (!dbRule) {
      res.status(404);
      throw new Error("DBRule not found");
    }

    return res.status(200).json({
      status: 200,
      message: "DBRule fetched successfully",
      data: dbRule,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createDbRule, updateDbRule, getDbRule };
