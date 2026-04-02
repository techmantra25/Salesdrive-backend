const path = require("path");
const fs = require("fs/promises");
const generateBillHTML = require("./generateBillHTML");
const html_to_pdf = require("html-pdf-node");

async function generatePDF(bill) {
  const pdfPath = path.join(__dirname, `${bill?.billNo}.pdf`);
  const htmlContent = generateBillHTML(bill);

  const file = { content: htmlContent };
  const options = {
    format: "A4",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    path: pdfPath, // This will save the PDF directly
  };

  try {
    await html_to_pdf.generatePdf(file, options);
    return pdfPath;
  } catch (error) {
    throw new Error(`PDF generation failed: ${error.message}`);
  }
}

module.exports = generatePDF;
