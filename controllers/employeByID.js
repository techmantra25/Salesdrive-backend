// controllers/employee.controller.js

const Employee = require("../models/employee.model"); // <-- Use your actual Employee model path

exports.searchEmployee = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || !query.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const searchRegex = new RegExp(query.trim(), "i");

    const employees = await Employee.find({
      $or: [
        { name: searchRegex },
        { empId: searchRegex },
      ],
    })
      .select("name empId -_id")
      .limit(20);

    return res.status(200).json({
      success: true,
      count: employees.length,
      data: employees,
    });
  } catch (error) {
    console.error("Error searching employee:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while searching employee",
      error: error.message,
    });
  }
};