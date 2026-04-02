// Helper function to map status
const mapStatus = (status) => {
  switch (status) {
    case "Pending":
      return 0;
    case "Approved":
      return 1;
    case "Rejected":
      return 2;
    default:
      return 0;
  }
};

const mapStatusReverse = (status) => {
  switch (
    status.trim()
  ) {
    case "0":
      return "Pending";
    case "1":
      return "Approved";
    case "2":
      return "Rejected";
    default:
      return "Unknown";
  }
};

module.exports = { mapStatus, mapStatusReverse };
