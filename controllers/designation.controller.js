const asyncHandler = require("express-async-handler");
const Designation = require("../models/designation.model");
// const { generateCode } = require("../utils/codeGenerator");
const Employee = require("../models/employee.model");

const createDesignation = asyncHandler(async (req, res) => {
  try {
    const { code, name, parent_desg } = req.body;

    let designationExist = await Designation.findOne({ code: req.body.code });

    if (designationExist) {
      res.status(400);
      throw new Error("Designation already exists");
    }

    const designationData = await Designation.create({
      name,
      code,
      parent_desg,
    });

    return res.status(201).json({
      status: 201,
      message: "Designation created successfully",
      data: designationData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const detailDesignation = asyncHandler(async (req, res) => {
  try {
    let designationList = await Designation.findOne({
      _id: req.params.desId,
    }).populate([
      {
        path: "parent_desg",
        select: "name code",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "All Designation list",
      data: designationList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

//update

const updateDesignation = asyncHandler(async (req, res) => {
  try {
    // Check if the designation ID is present in the Employee model
    const employeeWithDesignation = await Employee.findOne({
      desgId: req.params.desId,
    });

    let message;

    if (employeeWithDesignation && req.body.hasOwnProperty("status")) {
      // If the designation is mapped to any employee, restrict the status update
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message:
          "Designation is mapped to an employee, status cannot be updated",
      };
    }

    // Proceed with the designation update
    let designationList = await Designation.findOneAndUpdate(
      { _id: req.params.desId },
      req.body,
      { new: true }
    );

    if (designationList) {
      if (!message) {
        message = {
          error: false,
          message: "Designation updated successfully",
          data: designationList,
        };
      } else {
        message.data = designationList;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Designation not updated",
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
    let designationList = await Designation.find({})
      .populate([
        {
          path: "parent_desg",
          select: "name code",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Designation list",
      data: designationList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = {
  createDesignation,
  allList,
  detailDesignation,
  updateDesignation,
};
