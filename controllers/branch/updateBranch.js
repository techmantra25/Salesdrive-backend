const { Branch } = require("../../models/branch.model");

const updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    if (!id) {
      return res.status(400).json({ error: "Branch ID is required." });
    }

    const updatedBranch = await Branch.findByIdAndUpdate(id, updatedData, {
      new: true,
      runValidators: true,
    });

    if (!updatedBranch) {
      return res.status(404).json({ error: "Branch not found." });
    }

    res.status(200).json({ status: 200, data: updatedBranch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  updateBranch,
};
