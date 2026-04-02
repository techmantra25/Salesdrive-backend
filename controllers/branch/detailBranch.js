const { Branch } = require("../../models/branch.model");

const detailBranch = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Branch ID is required." });
    }

    const branch = await Branch.findById(id).populate("bank distributorId");
    if (!branch) {
      return res.status(404).json({ error: "Branch not found." });
    }

    res.status(200).json({ status: 200, data: branch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  detailBranch,
};
