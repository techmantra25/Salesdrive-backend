const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/server.config");

const generateToken = (userId) => {
  const token = jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: "30d",
  });

  return token;
};

module.exports = generateToken;
