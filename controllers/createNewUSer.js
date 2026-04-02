const asyncHandler = require("express-async-handler");
const User = require("../models/user.model.js");

const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, contact, status } = req.body;

  // ================= VALIDATION =================
  if (!name || !email || !password || !role) {
    res.status(400);
    throw new Error("Name, email, password and role are required");
  }

  const normalizedEmail = email.toLowerCase();
  const normalizedRole = role.toLowerCase();

  const allowedRoles = [
    "admin",
    "admine",
    "sub-admins",
    "sales",
    "user",
  ];
 

  if (!allowedRoles.includes(normalizedRole)) {
    res.status(400);
    throw new Error("Invalid user role");
  }

  const userExists = await User.findOne({ email: normalizedEmail });
  if (userExists) {
    res.status(409);
    throw new Error("User already exists with this email");
  }

  const defaultAvatar =
    "https://ui-avatars.com/api/?name=" +
    encodeURIComponent(name);

  const user = await User.create({
    name,
    email: normalizedEmail,
    password, // bcrypt handled in schema
    role: normalizedRole,
    contact: contact || "",
    avatar: defaultAvatar,
    status: status !== undefined ? status : true,
  });

  res.status(201).json({
    success: true,
    message: "User created successfully",
    data: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      contact: user.contact,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
    },
  });
});

module.exports = { createUser };
