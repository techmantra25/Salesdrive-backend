const User = require("../models/user.model");
const UserPermission = require("../models/user_Access/userPagePermission");


/**
 * UPDATE USER
 * PUT /api/v1/users/:id
 */
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, status, contact } = req.body;

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (status !== undefined) user.status = status;
    if (contact !== undefined) user.contact = contact;

    await user.save();

    return res.json({
      success: true,
      message: "User updated successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


/**
 * DELETE USER
 * DELETE /api/v1/users/:id
 */
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    //  Check if user exists
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Delete user permissions first
    await UserPermission.deleteOne({ user: id });

    // Delete user
    await user.deleteOne();

    return res.json({
      success: true,
      message: "User and related permissions deleted successfully",
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
