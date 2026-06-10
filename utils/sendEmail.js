const nodemailer = require("nodemailer");
const { writeLog } = require("../writeLog");

const {
  EMAIL_HOST,
  EMAIL_PASSWORD,
  EMAIL_PORT,
  EMAIL_USERNAME,
} = require("../config/server.config.js");

const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      auth: {
        user: EMAIL_USERNAME,
        pass: EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: "subhra.onenesstechs@gmail.com",
      to: options.email,
      cc: options.cc,
      subject: options.subject,
      html: options.htmlMessage,
    };

    const info = await transporter.sendMail(mailOptions);
    writeLog(`Email sent to ${options.email}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    writeLog(`Email send failed to ${options.email}: ${error.message}`);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = sendEmail;
