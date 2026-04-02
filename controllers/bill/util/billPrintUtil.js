const { default: axios } = require("axios");
const { SERVER_URL } = require("../../../config/server.config");

const billPrintUtil = async (billIds) => {
  console.log("Bill print is being handled in the frontend now.");
  return;

  // try {
  //   if (billIds.length === 0) {
  //     return;
  //   }

  //   const billPrintBaseUrl = `${SERVER_URL}/api/v1/bill/get_bulk_bill`;

  //   const res = await axios.post(
  //     billPrintBaseUrl,
  //     {
  //       regenerate: true,
  //       billIds: billIds,
  //     },
  //     {
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //     }
  //   );
  // } catch (error) {
  //   console.error(error);
  // }
};

module.exports = { billPrintUtil };
