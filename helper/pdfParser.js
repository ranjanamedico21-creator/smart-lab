/**process.env.GOOGLE_CLOUD_DISABLE_METADATA = "true";



const fs = require("fs");
const path = require("path");
const vision = require("@google-cloud/vision");

const client = new vision.ImageAnnotatorClient({
  keyFilename: path.join(__dirname, "../config/google-vision.json")
});**/

/**
 * OCR PDF directly (multi-page)
 */
/**async function ocrPdf(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);

  const request = {
    requests: [
      {
        inputConfig: {
          content: buffer.toString("base64"),
          mimeType: "application/pdf"
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
      }
    ]
  };

  const [result] = await client.batchAnnotateFiles(request);

  let text = "";
  const pages = result.responses[0].responses;

  for (const page of pages) {
    text += page.fullTextAnnotation?.text || "";
  }

  return text;
}
**/
/**
 * Extract Header
 */
/**function extractHeader(text) {
  return {
    poNumber: text.match(/PO\s*No[:\s]+([\w\-]+)/i)?.[1] || "",
    poDate: text.match(/PO\s*Date[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/)?.[1] || "",
    invoiceNumber: text.match(/Invoice\s*No[:\s]+([\w\-]+)/i)?.[1] || "",
    invoiceDate: text.match(/Invoice\s*Date[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/)?.[1] || "",
    supplierName: text.match(/JODAS EXPOIM PVT LTD/i)
      ? "JODAS EXPOIM PVT LTD"
      : ""
  };
}
**/
/**
 * Extract Products
 */
/**function extractProducts(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/mg|inj|vial|tab|capsule|syrup/i.test(line)) {
      items.push({
        description: line,
        hsn: line.match(/\b\d{8}\b/)?.[0] || "",
        batchNo: line.match(/\b[A-Z0-9]{5,}\b/)?.[0] || "",
        expiryDate: line.match(/\b(0[1-9]|1[0-2])[-\/]\d{2,4}\b/)?.[0] || "",
        qty: line.match(/\b\d{1,4}\b/)?.[0] || "",
        rate: line.match(/\d+\.\d{2}/)?.[0] || "",
        igst: text.match(/IGST\s*@?\s*(\d{1,2})\s*%/i)?.[1] + "%" || "",
        amount: line.match(/\d+\.\d{2}$/)?.[0] || ""
      });
    }
  }

  return items;
}
**/
/**
 * MAIN FUNCTION
 */
/**async function parsePoPdf(pdfPath) {
  const text = await ocrPdf(pdfPath);
  return {
    header: extractHeader(text),
    items: extractProducts(text)
  };
}

module.exports = { parsePoPdf };**/
