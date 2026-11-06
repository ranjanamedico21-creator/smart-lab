const express = require("express");
const router = express.Router();
const User = require("../models/User");

const upload = require("../middleware/multer");
//const path = require("path");
//const upload = multer({ dest: path.join(__dirname, "../uploads/images") });
const BillingController = require("../controllers/BillingController")
// SECURITY FIX (2026-10-27): several routes below had no login check at all
// (open to anyone who knows the URL). Every route in this file now needs a login.
router.use(User.checkLoggedIn);


//Category create  page
//router.get("/userActivity", User.checkLoggedIn,CategoryController.getCategoryRegistrationPage);

//By default redirect to home page
router.get("/createSupplier",User.checkLoggedIn,BillingController.getCreateSupplierPage);

router.post("/createSupplier",User.checkLoggedIn,BillingController.createSupplier);

router.get("/getSupplierList",User.checkLoggedIn,BillingController.getSupplierList);

router.get("/supplierLedger/:supplierId",User.checkLoggedIn,BillingController.getSupplierLedger);

router.post("/supplierLedger/:supplierId",User.checkLoggedIn,BillingController.getSupplierLedger);

router.get("/createProduct",User.checkLoggedIn,BillingController.getCreateProductPage);

router.post("/createProduct",User.checkLoggedIn,BillingController.createProduct);

router.get("/getProductList",User.checkLoggedIn,BillingController.getProductList);

router.get("/createCustomer",User.checkLoggedIn,BillingController.getCreateCustomerPage);

router.post("/createCustomer",User.checkLoggedIn,BillingController.createCustomer);

router.get("/getCustomerList",User.checkLoggedIn,BillingController.getCustomerList);

//router.get("/addStock",User.checkLoggedIn,BillingController.getAddStockPage);

//router.post("/addStock",User.checkLoggedIn,BillingController.addStock);

router.get("/getStockList",User.checkLoggedIn,BillingController.getStockListPage);

router.post("/getStockList",User.checkLoggedIn,BillingController.getStockList);

router.get("/addSale",User.checkLoggedIn,BillingController.getSalePage);

router.post("/addSale",User.checkLoggedIn,BillingController.addSale);

router.get("/getSalesData",User.checkLoggedIn,BillingController.getSalesData);//check

//router.get("/addNotes",User.checkLoggedIn,BillingController.getAddNotesPage);

//router.post("/addNotes",User.checkLoggedIn,BillingController.addNotes);

//router.get("/notes",User.checkLoggedIn,BillingController.displayAllNotes);

router.get("/addPayment",User.checkLoggedIn,BillingController.getAddPaymentPage);

router.post("/addPayment",User.checkLoggedIn,BillingController.addPayment);

router.get("/addPaymentToSupplier",User.checkLoggedIn,BillingController.getAddPaymentPageForSupplier);

router.post("/addPaymentToSupplier",User.checkLoggedIn,BillingController.addPaymentToSupplier);

//router.get("/getDues",User.checkLoggedIn,BillingController.getDues);

router.get("/stockHistory/:stockId/:batchNumber",User.checkLoggedIn,BillingController.getStockHistory);

router.get("/stockDetails/:productId",User.checkLoggedIn,BillingController.getStockDetails);

router.get("/customersLedger",User.checkLoggedIn,BillingController.getCustomersLedger);//This gives customer Ledger of all the customers

router.get("/customerLedger/:customerId",User.checkLoggedIn,BillingController.getIndividualCustomerLedger);//first time url hit

router.post("/customerLedger/:customerId",User.checkLoggedIn,BillingController.getIndividualCustomerLedger);//through form submission

router.get("/customerLedgerInPdf/:customerId/:startDate/:endDate",User.checkLoggedIn,BillingController.getCustomerLedgerInPdf);

router.get("/downloadLedgerInExcel/:customerId/:startDate/:endDate",User.checkLoggedIn,BillingController.downloadLedgerInExcel);

router.get("/downloadSupplierLedgerInExcel/:supplierId/:startDate/:endDate",User.checkLoggedIn,BillingController.downloadSupplierLedgerInExcel);

router.get("/testPage",User.checkLoggedIn,BillingController.getCustomerLedgerInPdf);

router.get("/createPurchasePo",User.checkLoggedIn,BillingController.getPurchasePoPage);

router.post("/createPurchasePo",User.checkLoggedIn,BillingController.createPurchasePo);

router.get("/downloadPurchasePo/:purchaseId/:supplierId",User.checkLoggedIn,BillingController.downloadPurchasePo);

router.get("/downloadSales/:saleId/:customerId",User.checkLoggedIn,BillingController.downloadSales);

router.get("/viewPurchasePo",User.checkLoggedIn,BillingController.viewPurchasePo);

router.post("/viewPurchasePo",User.checkLoggedIn,BillingController.viewPurchasePoList);

//router.get("/makeOrderComplete/:invoiceId/:purchasePoId/:supplierId",BillingController.makeOrderComplete);

router.get("/receivePurchaseOrder/:purchaseOrderId",User.checkLoggedIn,BillingController.getReceivePurchaseOrderPage);

router.post("/receivePurchaseOrder",User.checkLoggedIn,BillingController.getReceivePurchaseOrderPage);

router.get("/viewSales",User.checkLoggedIn,BillingController.viewSales);

router.post("/viewSales",User.checkLoggedIn,BillingController.viewSaleThroughSearch);


router.get("/salesReportCustomerWise",User.checkLoggedIn,BillingController.customerWiseSales);

router.get("/salesReportForGst",User.checkLoggedIn,BillingController.downloadSalesReportForGstInExcel);

//router.post("/salesReportCustomerWise",User.checkLoggedIn,BillingController.custometrWiseSalesSearcheReport);

router.post("/salesReportCustomerWise",User.checkLoggedIn,BillingController.customerWiseSales);

router.post("/generateInvoice",User.checkLoggedIn,BillingController.generateInvoice);

router.get("/invoiceDetails/:purchaseOrderId",User.checkLoggedIn,BillingController.invoiceDetails);

router.get("/downloadInvoices/:supplierInvoice",User.checkLoggedIn,BillingController.downloadInvoice);

router.post("/getProductPrice",BillingController.getProductPrice);

router.get("/updatePrice/:customerId",User.checkLoggedIn,BillingController.getupdatePricePageForCustomer);

router.post("/updatePrice",User.checkLoggedIn,BillingController.getupdatePricePageForCustomer);

router.post("/setCustomerPrice/:customerId/:productId/:supplierId/:stockId",User.checkLoggedIn,BillingController.setProductPriceForCustomer);


router.get("/updateSales/:customerId/:saleId/",User.checkLoggedIn,BillingController.getupdateSalesPage);

router.post("/updateSales/:customerId/:saleId/",User.checkLoggedIn,BillingController.updateSales);

router.get("/editProduct/:productId",User.checkLoggedIn,BillingController.editProductDetail)

router.get("/salesreturn/",User.checkLoggedIn,BillingController.getReturnSalePage)

router.post("/salesreturn/",User.checkLoggedIn,BillingController.salesReturn)

router.get("/downloadStockInExcel/",User.checkLoggedIn,BillingController.downloadStockInExcel)

router.get("/downloadSalesReportInExcel/",User.checkLoggedIn,BillingController.downloadSalesReportInExcel)

router.get("/salesReportSupplierWise/",User.checkLoggedIn,BillingController.getSalesReportSupplierWisePage)

router.post("/salesReportSupplierWise/",User.checkLoggedIn,BillingController.salesReportSupplierWise)

router.get("/editCustomer/:customerId",User.checkLoggedIn,BillingController.editCustomer)

router.post("/updateCustomer/:customerId",User.checkLoggedIn,BillingController.updateCustomer)

router.get("/createChallan",User.checkLoggedIn,BillingController.getCreateChallanPage)

router.post("/createChallan",User.checkLoggedIn,BillingController.createChallan)

router.get("/viewChallan/:challanId/:customerId",User.checkLoggedIn,BillingController.viewChallan)

router.get("/downloadChallan/:challanId/:customerId",User.checkLoggedIn,BillingController.downloadChallanInPdf)

router.get("/viewChallans",User.checkLoggedIn,BillingController.viewChallans)

router.post("/viewChallans",User.checkLoggedIn,BillingController.viewChallans)

router.get("/viewChallanInHtml/:challanId/:customerId",User.checkLoggedIn,BillingController.viewChallanInHtml)

router.post("/cancelChallan",User.checkLoggedIn,BillingController.cancelChallan)

router.post("/deliver",User.checkLoggedIn,BillingController.delivery)

router.post("/convertToSale",User.checkLoggedIn,BillingController.convertToSale)

router.get("/customerListWithDues",User.checkLoggedIn,BillingController.getCustomerListWithDues)

router.get("/nonMovableStocks",User.checkLoggedIn,BillingController.getNonMovableStocks);

router.get("/viewSalesInHtml/:saleId/:customerId",User.checkLoggedIn,BillingController.viewSalesInHtml);

//router.get("/moveExpiredProduct",User.checkLoggedIn,BillingController.getDetailsOfExpiredProduct);

router.get("/moveExpiredProduct",User.checkLoggedIn,BillingController.getDetailsOfExpiredProduct);

router.post("/moveExpiredProduct",User.checkLoggedIn,BillingController.moveExpiredProduct);

router.get("/individualProductPriceHistory",User.checkLoggedIn,BillingController.showIndividualProductPriceHistory);

router.get("/listExpiredProduct",User.checkLoggedIn,BillingController.getListOfMovedExpiredProduct);

router.post("/listExpiredProduct",User.checkLoggedIn,BillingController.getListOfMovedExpiredProduct);

router.get("/moveExpiredProductToSupplier/:status/:supplierId",User.checkLoggedIn,BillingController.moveExpiredProductToSupplier);


// 🔍 Search supplier invoice (AJAX)
router.get('/searchSupplierInvoice', BillingController.searchSupplierInvoice);

// 📦 Get invoice products (AJAX)
router.get('/getInvoiceProducts', BillingController.getInvoiceProducts);

// 📦 Get  products price(AJAX)
router.get('/checkInvoiceCredit', BillingController.checkInvoiceCredit);

// 📦 Get  products price(AJAX)
router.get('/getLastThreePricesBulk', BillingController.getLastThreePricesBulk);


// 💰 Submit settlement
router.post('/expiredStockSettle', BillingController.expiredStockSettle);


// 💰 View Sales return
router.get('/viewSalesReturn',User.checkLoggedIn, BillingController.viewSalesReturn);

// 💰 View Sales return
router.post('/viewSalesReturn',User.checkLoggedIn, BillingController.viewSalesReturn);


// 💰 View Sales return
router.get('/viewIndividualSalesReturnCN/:creditNoteId',User.checkLoggedIn, BillingController.viewIndividualSalesReturnCN);


// 💰 send expired product to supplier
//then he will accept how many will be returned
router.post('/sendToSupplier',User.checkLoggedIn, BillingController.sendExpiredToSupplier);


// 💰 View Sales return
router.get('/supplierDebitNotRegister',User.checkLoggedIn, BillingController.supplierDebitNotRegister);


router.post('/supplierDebitNotRegister',User.checkLoggedIn, BillingController.supplierDebitNotRegister);




// 💰 View Sales return
router.post('/supplierDebitNote/:expirtyReturnId',User.checkLoggedIn, BillingController.supplierDebitNotRegister);



// 💰 View Sales return
router.get('/individualSupplierDebitNote/:expiryReturnId',User.checkLoggedIn, BillingController.supplierDebitNotRegisterInHtml);
//2026
router.get('/individualSupplierExpProductSettlement/:expReturnId',User.checkLoggedIn, BillingController.getViewForExpProductSuppSettlement);
// this function is acceptance from supplier for the expired product
//which hae sent to them for acceptance
router.post('/settleExpiry',User.checkLoggedIn, BillingController.settleExpiryWithSupplier);


router.get('/supplierExpSettlementLedger',User.checkLoggedIn, BillingController.supplierExpSettlementLedger);

router.post('/finalizeExpiry',User.checkLoggedIn, BillingController.finalizeExpiry);



//router.get("/nonMovableStocks/page",User.checkLoggedIn,BillingController.getNonMovableStocks);

//router.get("/uploadPurchasePoPdf",User.checkLoggedIn,BillingController.uploadPurchasePoPdf);

//router.get("/upload", poController.uploadForm);

//router.post("/uploadPurchasePoPdf",upload.single("poFile"),BillingController.processUploadedPdf);




//router.get("/printSale",BillingController.printSale);


//router.get("/addPayment",BillingController.);

//router.post("/createInventory",BillingController.createInventory);



//router.get("/createDocumentCategory", User.checkLoggedIn,CategoryController.getCreateDocumentCategoryPage);


router.get('/paymentCorrection',  User.checkLoggedIn, BillingController.getPaymentCorrectionPage);
router.post('/deletePayment',     User.checkLoggedIn, BillingController.deletePayment);
router.post('/transferPayment',   User.checkLoggedIn, BillingController.transferPayment);


router.get('/paymentReceivable', BillingController.getPaymentReceivablePage);
router.post('/paymentReceivable', BillingController.searchPaymentReceivable);

router.get('/profitLossReport', BillingController.getProfitLossPage);
router.post('/profitLossReport', BillingController.searchProfitLoss);

router.get('/invoiceWiseProfitLoss', BillingController.getInvoiceWiseProfitLossPage);
router.post('/invoiceWiseProfitLoss', BillingController.searchInvoiceWiseProfitLoss);


// page: supplier -> product -> optional batch   (GET, so the result can be bookmarked)
router.get("/productTrace",User.checkLoggedIn,User.checkAuthorisation, BillingController.getProductTracePage);

// JSON used by the batch box to suggest batches of the chosen product
router.get("/productTrace/batches",User.checkLoggedIn,User.checkAuthorisation, BillingController.getProductBatches);


router.post('/reviseDebitNoteGst/:expReturnId', User.checkLoggedIn,User.checkAuthorisation, BillingController.reviseDebitNoteGst);

router.post('/cancelExpiryReturn/:expReturnId', User.checkLoggedIn,User.checkAuthorisation, BillingController.cancelExpiryReturn);
router.post('/addExpiredToReturn/:expReturnId', User.checkLoggedIn,User.checkAuthorisation, BillingController.addExpiredToReturn);
 
module.exports = router;
