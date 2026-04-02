const axios = require("axios");
const { SERVER_URL } = require("../../../config/server.config");

const printLoadSheet = async ({ loadSheetIds, regenerate = false }) => {
  console.log("Load sheet print is being handled in the frontend now.");
  return;

  // const url = `${SERVER_URL}/api/v1/load-sheet/print-load-sheet`;

  // const data = {
  //   loadSheetIds: [...loadSheetIds],
  //   regenerate: regenerate,
  // };

  // try {
  //   const response = await axios.post(url, data, {
  //     headers: {
  //       "Content-Type": "application/json",
  //     },
  //   });

  //   return response.data;
  // } catch (error) {
  //   throw error;
  // }
};

module.exports = { printLoadSheet };
