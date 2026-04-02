const nodemailer = require("nodemailer");

const {
  EMAIL_HOST,
  EMAIL_PASSWORD,
  EMAIL_PORT,
  EMAIL_USERNAME,
} = require("../config/server.config.js");

const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    auth: {
      user: EMAIL_USERNAME,
      pass: EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: "RUPA DMS <dev.rahul.dutta.02@gmail.com>",
    to: options.email,
    subject: options.subject,
    html: options.htmlMessage,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
