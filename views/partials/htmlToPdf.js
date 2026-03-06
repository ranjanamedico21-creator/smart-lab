
const puppeteer =require("puppeteer");

const defaultOptions={
    format:'A4'
}

async function htmlToPdf(html,options=defaultOptions){
// Launch the browser and open a new blank page

console.log(options)
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
const pdfBuffer= await page.pdf(options);
await browser.close();
return pdfBuffer;
}



//asyc function htmlToPdfFoReport(htm)
module.exports={
    htmlToPdf:htmlToPdf,
   // htmlToPdfFoReport:htmlToPdfFoReport
    
}