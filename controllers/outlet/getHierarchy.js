const Employee = require("../../models/employee.model");
const EmployeeMapping = require("../../models/employeeMapping.model");

const getHierarchy = async (empId) => {
  const hierarchy = {};

  const populateHierarchy = async (employeeId) => {
    // Find the employee with the given employeeId
    const employee = await Employee.findById(employeeId)
      .populate({
        path: "desgId",
        select: "name",
      })
      .exec();

    if (!employee) return;

    const designationName = employee.desgId.name;
    hierarchy[designationName] = employee;

    // Find the reporting manager from EmployeeMapping
    const employeeMapping = await EmployeeMapping.findOne({ empId: employeeId })
      .populate({
        path: "rmEmpId",
        select: "_id name desgId",
        populate: {
          path: "desgId",
          select: "name",
        },
      })
      .exec();

    if (employeeMapping && employeeMapping.rmEmpId) {
      await populateHierarchy(employeeMapping.rmEmpId._id);
    }
  };

  await populateHierarchy(empId);

  return hierarchy;
};

module.exports = { getHierarchy };
