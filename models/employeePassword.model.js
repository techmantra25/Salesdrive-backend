const mongoose = require("mongoose");

// password schema for employee
const employeePasswordSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    genPassword: {
      type: String,
      required: true,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const EmployeePassword = mongoose.model(
  "EmployeePassword",
  employeePasswordSchema
);

module.exports = EmployeePassword;
