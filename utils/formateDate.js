const moment = require("moment-timezone");

// Helper function to format dates
const formatDate = (date) => {
  return moment(date).tz("Asia/Kolkata").format("DD-MM-YY hh:mm:ss A");
};

module.exports = { formatDate };