const asyncHandler = require("express-async-handler");
const Employee = require("../models/employee.model");
const Designation = require("../models/designation.model");
const Beat = require("../models/beat.model");
const EmployeeMapping = require("../models/employeeMapping.model");
const EmployeePassword = require("../models/employeePassword.model");
const { Parser } = require("json2csv");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { default: axios } = require("axios");
const { SERVER_URL, CLIENT_URL } = require("../config/server.config");
const FormData = require("form-data");
const bcrypt = require("bcryptjs");
const generateToken = require("../utils/generateToken.js");
const sendEmail = require("../utils/sendEmail.js");
const Distributor = require("../models/distributor.model.js");

// Employee login
const loginEmployee = asyncHandler(async (req, res) => {
  try {
    const { empId, password } = req.body;

    // Find the employee by empId
    const employee = await Employee.findOne({ empId })
      .populate("desgId")
      .populate("zoneId")
      .populate("regionId")
      .populate("brandId");

    if (employee) {
      // Compare the provided password with the stored password
      const isMatchPassword = await bcrypt.compare(password, employee.password);

      if (isMatchPassword) {
        res.status(200).json({
          status: 200,
          data: {
            _id: employee._id,
            name: employee.name,
            empId: employee.empId,
            desgId: employee.desgId,
            zoneId: employee.zoneId,
            regionId: employee.regionId,
            brandId: employee.brandId,
            area: employee.area,
            token: generateToken(employee._id),
            role: "employee",
          },
        });
      } else {
        res.status(401);
        throw new Error("Invalid empId or password");
      }
    } else {
      res.status(401);
      throw new Error("Invalid empId or password");
    }
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get employee profile
const getEmployeeProfile = asyncHandler(async (req, res) => {
  try {
    res.status(200).json({
      status: 200,
      data: {
        ...req.user,
        role: "employee",
      },
    });
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Update employee password
const updateEmployeePassword = asyncHandler(async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400);
      throw new Error("Please provide both current and new password");
    }

    const employee = await Employee.findById(req.user._id);

    if (!employee) {
      res.status(404);
      throw new Error("Employee not found");
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, employee.password);

    if (!isMatch) {
      res.status(400);
      throw new Error("Current password is incorrect");
    } // Update password in employee collection
    employee.password = newPassword;
    await employee.save();

    // Update password in employeePassword collection
    const employeePassword = await EmployeePassword.findOne({
      employeeId: employee._id,
    });

    if (employeePassword) {
      // Update the existing record
      employeePassword.genPassword = newPassword;
      await employeePassword.save();
    } else {
      // Create a new record if one doesn't exist
      await EmployeePassword.create({
        employeeId: employee._id,
        genPassword: newPassword,
      });
    }

    res.status(200).json({
      status: 200,
      message: "Password updated successfully",
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Send employee credentials via email
const sendEmployeeCredentialEmail = asyncHandler(async (req, res) => {
  try {
    const employeeId = req.params.id;
    const { email } = req.body;

    const employee = await Employee.findById(employeeId);

    if (employee) {
      const employeePassword = await EmployeePassword.findOne({
        employeeId: employee._id,
      });

      if (employeePassword) {
        const message = `
          <h1>Employee Account Information</h1>
          <p>Hello ${employee.name},</p>
          <p>Your account has been created. Please find your login credentials below:</p>
          <p>Employee ID: <strong>${employee.empId}</strong></p>
          <p>Password: <strong>${employeePassword.genPassword}</strong></p>
          <p>Please login at: ${CLIENT_URL}/employee-login</p>
          <p>We recommend changing your password after your first login.</p>
          <hr />
          <p>Thank you!</p>
        `;

        await sendEmail({
          email: email,
          subject: "Your Employee Account Credentials",
          message,
        });

        res.status(200).json({
          status: 200,
          message: "Credentials sent successfully",
        });
      } else {
        res.status(404);
        throw new Error("Employee password record not found");
      }
    } else {
      res.status(404);
      throw new Error("Employee not found");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Create Employee - Updated to generate password
const createEmployee = asyncHandler(async (req, res) => {
  try {
    const {
      name,
      empId,
      desgId,
      zoneId,
      regionId,
      brandId,
      area,
      reporting_manager,
      leaving_date,
      distributorId,
      email,
      employeeLabel,
      phone,
      dob,
      joiningDate,
      headquarter,
      tenure,
      stateId,
    } = req.body; // Validate employee ID is provided and not empty
    if (!empId || empId === "") {
      res.status(400);
      throw new Error("Employee ID is required");
    }

    // Check if employee with the same empId already exists
    const employeeExist = await Employee.findOne({ empId });
    if (employeeExist) {
      res.status(400);
      throw new Error(`Employee with ID '${empId}' already exists`);
    }

    // Fetch the designation details
    const designation = await Designation.findOne({ _id: desgId });
    if (!designation) {
      res.status(404);
      throw new Error("Designation not found");
    }

    if (designation?.parent_desg && !reporting_manager) {
      res.status(400);
      throw new Error("Reporting manager required for this designation");
    }

    // Create distributor mapping history for each distributor
    const distributorMappingHistory = distributorId.map((id) => ({
      distributorId: id,
      mappedDate: new Date(),
      currentStatus: true,
    }));

    // Generate password for employee
    const generatedPassword = Math.random().toString(36).slice(-8); // Create the employee with all distributorIds stored
    let employeeData = await Employee.create({
      name,
      empId,
      desgId,
      zoneId,
      regionId,
      brandId,
      area,
      leaving_date,
      distributorMappingHistory,
      distributorId,
      password: generatedPassword,
      email,
      employeeLabel,
      phone,
      dob,
      joiningDate,
      headquarter,
      tenure,
      stateId,
    });

    // Save the original password
    await EmployeePassword.create({
      employeeId: employeeData._id,
      genPassword: generatedPassword,
    });

    // If designation has a parent_desg, and a reporting manager is provided, create a mapping
    if (designation?.parent_desg && reporting_manager) {
      const employeeMapping = await EmployeeMapping.create({
        empId: employeeData?._id,
        rmEmpId: reporting_manager,
      });

      employeeData = await Employee.findByIdAndUpdate(
        employeeData._id,
        {
          empMappingId: employeeMapping?._id,
        },
        { new: true }
      ).select("-password");
    }

    return res.status(201).json({
      status: 201,
      message: "Employee created successfully",
      data: employeeData,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

// new update employee >> mapping and uncapping data
const updateEmployee = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Find the employee by ID
    const employee = await Employee.findById(id).populate([
      {
        path: "empMappingId",
        select: "",
      },
    ]);

    if (!employee) {
      res.status(404);
      throw new Error("Employee not found");
    }

    const {
      name,
      empId,
      desgId,
      zoneId,
      regionId,
      brandId,
      area,
      reporting_manager,
      leaving_date,
      distributorId,
      status,
      employeeLabel,
      phone,
      dob,
      joiningDate,
      headquarter,
      email,
      tenure,
      stateId,
    } = req.body;

    if (empId === "") {
      res.status(400);
      throw new Error("Employee ID cannot be empty");
    }

    // Check if empId is being updated
    if (empId) {
      const employeeIdExists = await Employee.findOne({ empId });
      if (employeeIdExists && employeeIdExists._id.toString() !== id) {
        res.status(400);
        throw new Error(
          `Employee with ID '${empId}' already exists for another employee`
        );
      }
    }

    // Validate desgId (Designation)
    let designation;
    if (desgId) {
      designation = await Designation.findOne({ _id: desgId });
      if (!designation) {
        res.status(400);
        throw new Error("Invalid designation");
      }
    }

    // Update reporting manager if changed
    if (
      reporting_manager &&
      employee?.empMappingId?.rmEmpId.toString() !==
      reporting_manager?.toString()
    ) {
      await EmployeeMapping.findByIdAndUpdate(
        employee?.empMappingId?._id,
        {
          rmEmpId: reporting_manager,
        },
        { new: true }
      );
    }

    // Handle Region ID - Add new regions instead of overwriting
    // let finalRegionId = employee.regionId || [];
    // if (regionId && Array.isArray(regionId)) {
    //   const existingRegionIds = finalRegionId.map((id) => id.toString());
    //   const newRegionIds = regionId.map((id) => id.toString());

    //   // Add only new regions that don't already exist
    //   const regionsToAdd = newRegionIds.filter(
    //     (id) => !existingRegionIds.includes(id)
    //   );

    //   finalRegionId = [
    //     ...finalRegionId,
    //     ...regionsToAdd.map((id) => new mongoose.Types.ObjectId(id))
    //   ];
    // }


    let finalRegionId = employee.regionId || [];
    if (regionId !== undefined) {
      if (Array.isArray(regionId) && regionId.length > 0) {
        finalRegionId = regionId.map((id) => new mongoose.Types.ObjectId(id));
        //replace region with new region array
      }
      else {
        //clear regions if no regions are added 
        finalRegionId = [];
      }
    }

    let finalBeatId = employee.beatId || [];
if (regionId !== undefined) {
  const existingRegionIds = (employee.regionId || []).map((id) => id.toString());
  const newRegionIds = Array.isArray(regionId) 
    ? regionId.map((id) => id.toString()) 
    : [];

  // Find removed regions
  const removedRegionIds = existingRegionIds.filter(
    (id) => !newRegionIds.includes(id)
  );

  // If regions were removed, fetch and remove their associated beats
  if (removedRegionIds.length > 0) {
    // Fetch beats that belong to removed regions
    const beatsToRemove = await Beat.find({
      regionId: { $in: removedRegionIds.map(id => new mongoose.Types.ObjectId(id)) }
    }).select('_id');

    const beatIdsToRemove = beatsToRemove.map(beat => beat._id.toString());

    // Filter out beats that belong to removed regions
    finalBeatId = finalBeatId.filter(
      beatId => !beatIdsToRemove.includes(beatId.toString())
    );
  }
}



    // Handle Distributor ID - Add new distributors instead of overwriting
   // Handle Distributor ID - Replace with new array (not merge)
let finalDistributorId = employee.distributorId || [];
let newDistributorMappingHistory = [...(employee.distributorMappingHistory || [])];

if (distributorId !== undefined) {
  const existingDistributorIds = finalDistributorId.map((id) => id.toString());
  const newDistributorIds = Array.isArray(distributorId) 
    ? distributorId.map((id) => id.toString()) 
    : [];

  // Find removed distributors (exist in old but not in new)
  const removedDistributorIds = existingDistributorIds.filter(
    (id) => !newDistributorIds.includes(id)
  );
  
  // Find added distributors (exist in new but not in old)
  const addedDistributorIds = newDistributorIds.filter(
    (id) => !existingDistributorIds.includes(id)
  );

  // Mark removed distributors as unmapped in history
  if (removedDistributorIds.length > 0) {
    newDistributorMappingHistory = newDistributorMappingHistory.map(
      (record) => {
        if (
          removedDistributorIds.includes(record.distributorId.toString()) &&
          record.currentStatus
        ) {
          return {
            _id: record?._id,
            distributorId: new mongoose.Types.ObjectId(record.distributorId),
            mappedDate: record?.mappedDate,
            currentStatus: false,
            unMappedDate: new Date(),
          };
        }
        return record;
      }
    );
  }

  // Add new distributors to history
  if (addedDistributorIds.length > 0) {
    newDistributorMappingHistory = [
      ...newDistributorMappingHistory,
      ...addedDistributorIds.map((id) => ({
        distributorId: new mongoose.Types.ObjectId(id),
        mappedDate: new Date(),
        currentStatus: true,
      })),
    ];
  }

  // REPLACE with new distributor array (not merge)
  if (Array.isArray(distributorId) && distributorId.length > 0) {
    finalDistributorId = distributorId.map((id) => new mongoose.Types.ObjectId(id));
  } else {
    // Clear distributors if empty array sent
    finalDistributorId = [];
  }
}



    // Update employee details in the database
const updatedEmployee = await Employee.findByIdAndUpdate(
  id,
  {
    name: name || employee.name,
    empId: empId || employee.empId,
    desgId: desgId || employee.desgId,
    zoneId: zoneId || employee.zoneId,
    regionId: finalRegionId,
    brandId: brandId || employee.brandId,
    area: area || employee.area,
    leaving_date: leaving_date || employee.leaving_date,
    distributorId: finalDistributorId,
    status: status ?? employee.status,
    distributorMappingHistory: newDistributorMappingHistory,
    employeeLabel: employeeLabel || employee.employeeLabel,
    phone: phone || employee.phone,
    dob: dob || employee.dob,
    joiningDate: joiningDate || employee.joiningDate,
    headquarter: headquarter || employee.headquarter,
    email: email || employee.email,
    tenure: tenure ?? employee.tenure,
    stateId: stateId || employee.stateId,
    beatId: finalBeatId, // ADD THIS LINE
  },
  { new: true }
);

    return res.status(200).json({
      status: 200,
      message: "Employee updated successfully",
      data: updatedEmployee,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

// Get Employee Details by ID
const detailEmployee = asyncHandler(async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id).populate([
      {
        path: "desgId",
        select: "name", // Include only necessary fields
      },
      {
        path: "zoneId",
        select: "name",
      },
      {
        path: "regionId",
        select: "name",
      },
      {
        path: "brandId",
        select: "name",
      },
      {
        path: "empMappingId",
        populate: [
          {
            path: "empId",
            populate: [
              {
                path: "desgId",
                select: "name",
              },
              {
                path: "zoneId",
                select: "name",
              },
              {
                path: "regionId",
                select: "name",
              },
              {
                path: "brandId",
                select: "name",
              },
            ],
          },
        ],
      },
      {
        path: "distributorMappingHistory.distributorId",
        select: "name dbCode",
      },
      {
        path: "distributorId",
        select: "name dbCode",
      },
    ]);
    if (!employee) {
      res.status(404);
      throw new Error("Employee not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Employee details retrieved successfully",
      data: employee,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// map beatId to employeeId
const mapBeatIdToEmployeeId = asyncHandler(async (req, res) => {
  try {
    const { beatIds } = req.body; // Array of beat IDs to be mapped
    const { id } = req.params; // Employee ID from the URL parameter

    // Check if the employee exists
    const employee = await Employee.findById(id).populate([
      {
        path: "desgId",
        select: "",
      },
    ]);

    if (!employee) {
      res.status(404);
      throw new Error("Employee not found");
    }

    // Convert existing beat IDs to strings for comparison
    const existingBeatIds = employee.beatId.map((beatId) => beatId.toString());

    // Determine which beat IDs to remove (those that are in existingBeatIds but not in beatIds)
    const removedBeatIds = existingBeatIds.filter(
      (beatId) => !beatIds.includes(beatId)
    );

    // Filter out the removed beat IDs from the existing beat IDs
    const remainingBeatIds = existingBeatIds.filter(
      (beatId) => !removedBeatIds.includes(beatId)
    );

    // Determine new beat IDs to be added (those that are in beatIds but not in remainingBeatIds)
    const newBeatIds = beatIds.filter(
      (beatId) => !remainingBeatIds.includes(beatId)
    );

    if (employee?.desgId?.name !== "DEFAULT SALESMAN") {
      // Check if any of the new beat IDs are occupied normal beats
      const occupiedNormalBeats = await Beat.find({
        _id: { $in: newBeatIds },
        isOccupied: true,
        beat_type: "normal",
      });

      if (occupiedNormalBeats.length > 0) {
        res.status(400);
        throw new Error("One or more normal beats are already occupied");
      }
    }

    // Update the employee with the new beat IDs
    employee.beatId = [...remainingBeatIds, ...newBeatIds];
    const updatedEmployee = await employee.save();

    if (employee?.desgId?.name === "DEFAULT SALESMAN") {
      // Update the beats by adding the employee ID to the new beats
      await Beat.updateMany(
        { _id: { $in: newBeatIds } },
        { $push: { employeeId: employee._id } }
      );
    } else {
      // Update the beats by adding the employee ID to the new beats
      await Beat.updateMany(
        { _id: { $in: newBeatIds } },
        { $push: { employeeId: employee._id }, $set: { isOccupied: true } }
      );
    }

    // Remove employee ID from removed beats
    await Beat.updateMany(
      { _id: { $in: removedBeatIds } },
      { $pull: { employeeId: employee._id } }
    );

    // For every removed beat, if the beat does not have any employees, mark it as unoccupied
    removedBeatIds.forEach(async (beatId) => {
      const employeeList = await Employee.find({ beatId: beatId });
      if (employeeList.length === 0) {
        await Beat.updateOne({ _id: beatId }, { $set: { isOccupied: false } });
      }
    });

    return res.status(200).json({
      status: 200,
      message: "Employee updated successfully",
      data: updatedEmployee,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get All Employees
const allEmployees = asyncHandler(async (req, res) => {
  try {
    const employees = await Employee.find({})
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "distributorMappingHistory.distributorId",
          select: "name dbCode",
        },
        {
          path: "beatId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "All employees list",
      data: employees,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get All Employees Paginated
const allEmployeesPaginated = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      desgId,
      zoneId,
      regionId,
      brandId,
      status,
      search,
    } = req.query;

    const skip = (page - 1) * limit;

    // Build the filter object
    const filter = {};
    if (desgId) filter.desgId = desgId;
    if (zoneId) filter.zoneId = zoneId;
    if (regionId) filter.regionId = { $in: [regionId] };
    if (brandId) filter.brandId = brandId;
    if (status !== undefined) filter.status = status;

    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search, "i");

      const matchingDistributors = await Distributor.find({
        $or: [{ name: searchRegex }, { dbCode: searchRegex }],
      }).select("_id");

      const distributorIds = matchingDistributors.map((d) => d._id);

      const matchingBeats = await Beat.find({
        $or: [{ name: searchRegex }, { code: searchRegex }],
      }).select("_id");

      const beatIds = matchingBeats.map((b) => b._id);

      filter.$or = [
        { name: searchRegex },
        { empId: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        ...(distributorIds.length
          ? [{ distributorId: { $in: distributorIds } }]
          : []),
        ...(beatIds.length ? [{ beatId: { $in: beatIds } }] : []),
      ];
    }

    const employees = await Employee.find(filter)
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                { path: "desgId", select: "" },
                { path: "zoneId", select: "" },
                { path: "regionId", select: "" },
                { path: "brandId", select: "" },
                { path: "distributorId", select: "" },
                { path: "beatId", select: "" },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                { path: "desgId", select: "" },
                { path: "zoneId", select: "" },
                { path: "regionId", select: "" },
                { path: "brandId", select: "" },
                { path: "distributorId", select: "" },
                { path: "beatId", select: "" },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "distributorMappingHistory.distributorId",
          select: "name dbCode",
        },
        {
          // ✅ ONLY REQUIRED FIX IS HERE
          path: "beatId",
          populate: {
            path: "regionId",
            select: "name code",
          },
        },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const filteredCount = await Employee.countDocuments(filter);
    const totalCount = await Employee.countDocuments({});
    const totalActiveCount = await Employee.countDocuments({ status: true });

    return res.status(200).json({
      status: 200,
      message: "All employees list",
      data: employees,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        totalCount,
        filteredCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get All Employees
const employeesByDesg = asyncHandler(async (req, res) => {
  try {
    const employees = await Employee.find({ desgId: req.params.desgId })
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "distributorMappingHistory.distributorId",
          select: "name dbCode",
        },
        {
          path: "beatId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "All employees list",
      data: employees,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get Employees by Beat ID
const listByBeat = asyncHandler(async (req, res) => {
  try {
    // Extract beatId from request parameters
    const { beatId } = req.params;

    // Find employees where beatId is in the beatId array
    let employeeList = await Employee.find({ beatId: beatId })
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },
        {
          path: "distributorMappingHistory.distributorId",
          select: "name dbCode",
        },
      ])
      .sort({ _id: -1 }); // Sort by _id in descending order

    // Return the response
    return res.status(200).json({
      status: 200,
      message: "Employees list by beat",
      data: employeeList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get Employee by Distributor
const getEmployeeByDistributor = asyncHandler(async (req, res) => {
  try {
    const { did } = req.params;

    const employees = await Employee.find({
      distributorId: did,
    })
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "distributorMappingHistory.distributorId",
          select: "name dbCode",
        },
        {
          path: "beatId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "Employee List By Distributor",
      data: employees,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get Employee by Designation
const getEmployeeByDesignation = asyncHandler(async (req, res) => {
  try {
    const { desgId } = req.query;

    const employees = await Employee.find({
      desgId: desgId,
    })
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },
        {
          path: "distributorMappingHistory.distributorId",
          select: "name dbCode",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "Applicable reporting managers",
      data: employees,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get Employees Working Under a Employee
const getEmployeesWorkingUnderByEmployeeId = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const mappedEmployees = await EmployeeMapping.find({
      rmEmpId: id,
    });

    const employees = await Employee.find({
      _id: {
        $in: mappedEmployees.map((mappedEmployee) => mappedEmployee.empId),
      },
    }).populate([
      {
        path: "desgId",
        select: "",
      },
      {
        path: "zoneId",
        select: "",
      },
      {
        path: "regionId",
        select: "",
      },
      {
        path: "brandId",
        select: "",
      },
      {
        path: "empMappingId",
        select: "",
        populate: [
          {
            path: "empId",
            select: "",
            populate: [
              {
                path: "desgId",
                select: "",
              },
              {
                path: "zoneId",
                select: "",
              },
              {
                path: "regionId",
                select: "",
              },
              {
                path: "brandId",
                select: "",
              },
              {
                path: "distributorId",
                select: "",
              },
              {
                path: "beatId",
                select: "",
              },
            ],
          },
          {
            path: "rmEmpId",
            select: "",
            populate: [
              {
                path: "desgId",
                select: "",
              },
              {
                path: "zoneId",
                select: "",
              },
              {
                path: "regionId",
                select: "",
              },
              {
                path: "brandId",
                select: "",
              },
              {
                path: "distributorId",
                select: "",
              },
              {
                path: "beatId",
                select: "",
              },
            ],
          },
        ],
      },
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "distributorMappingHistory.distributorId",
        select: "name dbCode",
      },
      {
        path: "beatId",
        select: "",
      },
    ]);

    return res.status(200).json({
      status: 200,
      message: "Employees working under a employee",
      data: employees,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// get Employee Report
const getEmployeeReport = asyncHandler(async (req, res) => {
  try {
    const { desgId, zoneId, regionId, brandId, status } = req.query;

    // Build the filter object
    const filter = {};
    if (desgId) filter.desgId = desgId;
    if (zoneId) filter.zoneId = zoneId;
    if (regionId) filter.regionId = regionId;
    if (brandId) filter.brandId = brandId;
    if (status !== undefined) filter.status = status;

    const employees = await Employee.find(filter)
      .populate([
        {
          path: "desgId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
        {
          path: "empMappingId",
          select: "",
          populate: [
            {
              path: "empId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
            {
              path: "rmEmpId",
              select: "",
              populate: [
                {
                  path: "desgId",
                  select: "",
                },
                {
                  path: "zoneId",
                  select: "",
                },
                {
                  path: "regionId",
                  select: "",
                },
                {
                  path: "brandId",
                  select: "",
                },
                {
                  path: "distributorId",
                  select: "",
                },
                {
                  path: "distributorMappingHistory.distributorId",
                  select: "name dbCode",
                },
                {
                  path: "beatId",
                  select: "",
                },
              ],
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    const csvData = [];

    employees.forEach((employee) => {
      const baseData = {
        Name: employee?.name,
        "Employee Id": employee?.empId,
        "Designation Code": employee.desgId?.code,
        Designation: employee.desgId?.name,
        "Zone Code": employee.zoneId?.code,
        "Zone Name": employee.zoneId?.name,
        "State Code": employee.stateId?.slug,
        "State Name": employee.stateId?.name,
        "Region Code": employee.regionId?.code,
        "Region Name": employee.regionId?.name,
        Brands: employee.brandId?.map((brand) => brand.name).join(", "),
        area: employee.area?.join(", "),
        leaving_date: employee.leaving_date
          ? new Date(employee.leaving_date).toLocaleDateString()
          : "",
        status: employee.status == true ? "Active" : "Inactive",
        // New fields
        "Employee Label": employee?.employeeLabel,
        Phone: employee?.phone,
        DOB: employee.dob ? new Date(employee.dob).toLocaleDateString() : "",
        "Joining Date": employee.joiningDate
          ? new Date(employee.joiningDate).toLocaleDateString()
          : "",
        Headquarter: employee?.headquarter,
        Email: employee?.email,
        Tenure: employee?.tenure,
      };

      if (employee?.distributorId && employee?.distributorId?.length > 0) {
        employee.distributorId.forEach((distributor) => {
          if (employee.beatId && employee.beatId.length > 0) {
            employee.beatId.forEach((beatId) => {
              csvData.push({
                ...baseData,
                "DB Code": distributor?.dbCode,
                "DB Name": distributor?.name,
                "Beat Code": beatId?.code,
                "Beat Name": beatId?.name,
              });
            });
          } else {
            csvData.push({
              ...baseData,
              "DB Code": distributor?.dbCode,
              "DB Name": distributor?.name,
              "Beat Code": "",
              "Beat Name": "",
            });
          }
        });
      } else {
        csvData.push({
          ...baseData,
          "DB Code": "",
          "DB Name": "",
          "Beat Code": "",
          "Beat Name": "",
        });
      }
    });

    // Define CSV headers
    const fields = [
      { label: "Employee Id", value: "Employee Id" },
      { label: "Name", value: "Name" },
      { label: "Employee Label", value: "Employee Label" }, // New
      { label: "Phone", value: "Phone" }, // New
      { label: "Email", value: "Email" }, // New
      { label: "DOB", value: "DOB" }, // New
      { label: "Joining Date", value: "Joining Date" }, // New
      { label: "Tenure", value: "Tenure" }, // New
      { label: "Designation Code", value: "Designation Code" },
      { label: "Designation", value: "Designation" },
      { label: "Headquarter", value: "Headquarter" }, // New
      { label: "Zone Code", value: "Zone Code" },
      { label: "Zone Name", value: "Zone Name" },
      { label: "State Code", value: "State Code" },
      { label: "State Name", value: "State Name" },
      { label: "Region Code", value: "Region Code" },
      { label: "Region Name", value: "Region Name" },
      { label: "Brands", value: "Brands" },
      { label: "Area", value: "area" },
      { label: "Leaving Date", value: "leaving_date" },
      { label: "DB Code", value: "DB Code" },
      { label: "DB Name", value: "DB Name" },
      { label: "Beat Code", value: "Beat Code" },
      { label: "Beat Name", value: "Beat Name" },
      { label: "Status", value: "status" },
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    // Save CSV file to the server temporarily
    const filePath = path.join(__dirname, "employees.csv");
    fs.writeFileSync(filePath, csv);

    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `employees-${Date.now()}`);
    const CLOUDINARY_UPLOAD_URL = `${SERVER_URL}/api/v1/cloudinary/upload`;

    const result = await axios.post(CLOUDINARY_UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Remove the temporary file
    fs.unlinkSync(filePath);

    return res.status(200).json({
      status: 200,
      message: "All employees list",
      data: {
        csvLink: result.data.secure_url,
        count: employees.length, // This count might be misleading due to denormalization for distributors/beats
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get employee password (admin only)
const getEmployeePassword = asyncHandler(async (req, res) => {
  try {
    const employeeId = req.params.id;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      res.status(404);
      throw new Error("Employee not found");
    }

    // Find the password record
    const employeePassword = await EmployeePassword.findOne({
      employeeId: employee._id,
    });

    if (!employeePassword) {
      res.status(404);
      throw new Error("Employee password record not found");
    }

    res.status(200).json({
      status: 200,
      message: "Employee password retrieved successfully",
      data: {
        employeeId: employee._id,
        empId: employee.empId,
        name: employee.name,
        password: employeePassword.genPassword,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createEmployee,
  detailEmployee,
  updateEmployee,
  allEmployees,
  employeesByDesg,
  allEmployeesPaginated,
  mapBeatIdToEmployeeId,
  listByBeat,
  getEmployeeByDesignation,
  getEmployeesWorkingUnderByEmployeeId,
  getEmployeeReport,
  getEmployeeByDistributor,
  loginEmployee,
  getEmployeeProfile,
  updateEmployeePassword,
  sendEmployeeCredentialEmail,
  getEmployeePassword,
};
