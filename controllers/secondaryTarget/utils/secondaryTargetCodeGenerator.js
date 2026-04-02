const SecondaryTarget = require("../../../models/secondaryTarget.model");

const ALPHA_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// generating a three charecter random string
const randomAlpha = () => {
  let result = "";
  for (let i = 0; i < 3; i++) {
    result += ALPHA_CHARS[Math.floor(Math.random() * ALPHA_CHARS.length)];
  }
  return result;
};

// generate a random 4 digit numeric string

const randomNumeric = () => {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
};

// this is a unique target code in formdat R+3 letteres + 4 digits example  RXYZ1234

// code to avoid possible race condition during bulk update of distributor or case where the distributor and admin try to create target togeteht

const generateTargetCode = async (maxAttempts = 10) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = `R${randomAlpha()}${randomNumeric()}`;

    const exists = await SecondaryTarget.exists({ targetCode: candidate });

    if (!exists) {
      return candidate;
    }
  }
  throw new Error("failed to generate a unique code after maximum attempts.Please retry ")
};


module.exports = {generateTargetCode};