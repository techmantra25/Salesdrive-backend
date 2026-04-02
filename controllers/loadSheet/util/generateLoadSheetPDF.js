const puppeteer = require("puppeteer");
const path = require("path");
const generateLoadSheetHTML = require("./generateLoadSheetHTML");

const generateLoadSheetPDF = async (loadSheet) => {
  const pdfPath = path.join(__dirname, `${loadSheet?.allocationNo}.pdf`);
  const htmlContent = generateLoadSheetHTML(loadSheet);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return pdfPath;
  } catch (error) {
    throw new Error(`PDF generation failed: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
};

module.exports = generateLoadSheetPDF;
