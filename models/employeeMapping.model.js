const mongoose = require("mongoose");

const employeeMappingSchema = new mongoose.Schema(
  {
    empId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    rmEmpId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const EmployeeMapping = mongoose.model(
  "EmployeeMapping",
  employeeMappingSchema
);

module.exports = EmployeeMapping;
