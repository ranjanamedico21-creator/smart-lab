/* =====================================================================
 * controllers/BillingController.js   -   COMPLETE FILE, ready to paste
 *
 * Works with the new models/Billing.js (same function names, same view names,
 * same variables passed to the views).
 *
 *   // FIX      a bug that existed in the old file
 *   // CHANGED  behaviour that changed on purpose
 *   // NEW      new code
 * Everything else is the old code, only cleaned: dead code, commented-out blocks and
 * debug console.logs removed, the 12 copies of the company-details object replaced by
 * getCompanyDetails().  See CHANGES.md for the complete list.
 * ===================================================================== */
const Billing = require("../models/Billing");
require("dotenv").config();
const ejs = require("ejs");
const moment = require("moment");
const puppeteer = require("puppeteer");
const path = require("path");
const ExcelJS = require("exceljs");
const fs = require("fs");
const pdf = require("html-pdf");
const crypto = require("crypto");
const pdfParser = require("../helper/pdfParser");

const uploadId = crypto.randomUUID();


/* =====================================================================
 * 0. SHARED HELPERS
 * ===================================================================== */

// NEW: a single posted row arrives as a STRING, several rows as an ARRAY.
const toArray = (v) =>
  Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];

// NEW: rows per page. A missing / invalid PAGE_SIZE in .env used to produce "LIMIT NaN"
// (SQL error); it now falls back to 20.
const getPageSize = () => parseInt(process.env.PAGE_SIZE, 10) || 20;

// Centralized notification creation
const createNotification = (type, messages, icon) => ({ type, messages, icon });

/**
 * NEW: replaces the 12 copies of the company-details object.
 * Uses the individual SELLER_* variables; if SELLER_COMPANY_DETAILS (JSON) is set its
 * values win. Never throws when the JSON is missing or invalid.
 */
const getCompanyDetails = () => {
  const fromEnv = {
    coreCompany: process.env.SELLER_NAME,
    coreCompanyAddress: process.env.SELLER_ADDRESS,
    coreCompanyPhoneNumber: process.env.SELLER_PHONE,
    coreCompanyEmail: process.env.SELLER_EMAIL,
    coreCompanyBankName: process.env.SELLER_BANK,
    coreCompanyBranchName: process.env.SELLER_BANK_BRANCH,
    coreCompanyAccountNo: process.env.SELLER_ACC_NO,
    coreCompanyIFSCCode: process.env.SELLER_IFSC,
    coreCompanyGstNo: process.env.SELLER_GST,
    coreCompanyDLNo: process.env.SELLER_DL,
  };
  let fromJson = {};
  try { fromJson = JSON.parse(process.env.SELLER_COMPANY_DETAILS || "{}"); } catch (_) { fromJson = {}; }
  return { ...fromEnv, ...fromJson };
};

// company logo as a data: url for the printed documents
const getLogoBase64 = (mime = "png") => {
  const imagePath = path.resolve(__dirname, "../images/RanjanaImaging.png");
  return `data:image/${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
};

const renderHomeWithError = (res, error, customMessage = "") => {
  const notifications = [];

  if (customMessage)
    notifications.push({ type: "danger", messages: customMessage, icon: "bi-exclamation-triangle-fill" });
  if (error)
    notifications.push({ type: "danger", messages: error, icon: "bi-exclamation-triangle-fill" });

  console.error("Error:", error);

  res.render("home", {
    notifications,
    title: "Home",
    BRAND_NAME: process.env.BRAND_NAME,
    layout: "loggedInLayout",
  });
};


/* =====================================================================
 * 1. SUPPLIERS / PRODUCTS / CUSTOMERS
 * ===================================================================== */

const getCreateSupplierPage = async (req, res) => {
  res.render("createSupplier", { title: "Create Supplier", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
};

/** Creates a supplier (+ ledger account). */
const createSupplier = async (req, res) => {
  const notifications = [];
  try {
    const message = await Billing.createSupplier(req);
    const suppliers = await Billing.getSuppliersList();

    notifications.push({ type: "success", messages: message, icon: "bi-check-circle-fill" });

    res.render("suppliersList", {
      suppliers, notifications, title: "Supplier List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error creating supplier:", error.stack);

    notifications.push({
      type: "danger", messages: error.message || "An unexpected error occurred.", icon: "bi-exclamation-triangle-fill",
    });

    const { name = "", address = "", mobileNumber = "", gstIn = "", dlNo = "", cin = "" } = req.body || {};

    res.render("createSupplier", {
      notifications, name, address, mobileNumber, gstIn, dlNo, cin,
      title: "Create Supplier", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  }
};

const getSupplierList = async (req, res) => {
  try {
    const suppliers = await Billing.getSuppliersList();
    res.render("Billing/suppliersList", { suppliers, title: "Supplier List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred. Please retry get suplier list.");
  }
};

const getCreateProductPage = async (req, res) => {
  try {
    const supplierLists = await Billing.getSuppliersList();
    const productDetails = ""; // edit-product page needs this variable to exist
    res.render("product", { supplierLists, productDetails, title: "create product List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred. Please retry get create product page.");
  }
};

const createProduct = async (req, res) => {
  const notifications = [];
  try {
    const message = await Billing.createProduct(req);
    const products = await Billing.getProductList();

    notifications.push({ type: "success", messages: message, icon: "bi-check-circle-fill" });

    res.render("productList", {
      products, notifications, title: "Product List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error creating product:", error.stack);

    notifications.push({
      type: "danger", messages: error.message || "An unexpected error occurred.", icon: "bi-exclamation-triangle-fill",
    });

    const { supplier = "", name = "", hsn = "" } = req.body || {};
    const supplierLists = await Billing.getSuppliersList();

    res.render("product", {
      supplierLists, supplier, name, hsn, notifications,
      title: "Create Product", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  }
};

const getProductList = async (req, res) => {
  try {
    const products = await Billing.getProductList();
    res.render("productList", { products, title: "Product List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred. Please retry get  product list page.");
  }
};

/** FIX: also handles a product that does not exist (the old check was inverted and the notifications were never rendered). */
const editProductDetail = async (req, res) => {
  try {
    const productId = req.params.productId || "";
    if (!productId) throw new Error("No product Id found");

    const productDetails = await Billing.getProductDetails(productId);
    if (!productDetails) throw new Error(`No Product with this Id ${productId} has been found.`);

    const supplierLists = await Billing.getSuppliersList();
    res.render("product", { supplierLists, productDetails, title: "create product List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

const getCreateCustomerPage = async (req, res) => {
  try {
    const suppliers = await Billing.getSuppliersList();
    const products = await Billing.getProductList();
    res.render("createCustomer", { suppliers, products, title: "create customer ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred. Please retry get create customer page.");
  }
};

/** FIX: on an error the form was re-rendered WITHOUT suppliers / products (the page crashed). */
const createCustomer = async (req, res) => {
  const notifications = [];
  try {
    const result = await Billing.createCustomer(req);
    const message = { type: "success", msg: result, icon: "bi-check-circle-fill" };
    req.flash("message", JSON.stringify(message));
    res.redirect("/billing/getCustomerList");
  } catch (error) {
    console.error("Error creating customer:", error.stack);

    notifications.push({
      type: "danger", messages: error.message || "An unexpected error occurred.", icon: "bi-exclamation-triangle-fill",
    });

    try {
      const [suppliers, products] = await Promise.all([Billing.getSuppliersList(), Billing.getProductList()]);
      res.render("createCustomer", {
        notifications, suppliers, products, ...req.body,
        title: "Create Customer", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
      });
    } catch (innerError) {
      return renderHomeWithError(res, innerError);
    }
  }
};

const getCustomerList = async (req, res) => {
  const notifications = [];
  try {
    const customers = await Billing.getCustomerList();
    const flashMessages = req.flash("message");
    const message = flashMessages.length > 0 ? JSON.parse(flashMessages[0]) : null;

    if (message) notifications.push({ type: message.type, messages: message.msg, icon: message.icon });

    res.render("Billing/customerList", { notifications, customers, title: "Customer List", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred. Please retry get create customer list page.");
  }
};

const editCustomer = async (req, res) => {
  try {
    const customerId = req.params.customerId;
    if (!customerId) throw new Error("Customer Id is missing.Kindly try again.");
    const customerDetails = await Billing.getCustomerDetails(customerId);
    res.render("editCustomer", { customerDetails, title: "Edit customer details", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    req.flash("message", JSON.stringify({ type: "danger", msg: error.message, icon: "bi-exclamation-triangle-fill" }));
    res.redirect("/billing/getCustomerList");
  }
};

const updateCustomer = async (req, res) => {
  try {
    const customerId = req.params.customerId;
    if (!customerId) throw new Error("Customer Id is missing.");
    const result = await Billing.updateCustomerDetails(req);
    req.flash("message", JSON.stringify({ type: "success", msg: result, icon: "bi-check-circle-fill" }));
    res.redirect("/billing/getCustomerList");
  } catch (error) {
    req.flash("message", JSON.stringify({ type: "danger", msg: error.message, icon: "bi-exclamation-triangle-fill" }));
    res.redirect("/billing/getCustomerList");
  }
};


/* =====================================================================
 * 2. STOCK
 * ===================================================================== */

const getStockListPage = async (req, res) => {
  try {
    const supplierId = req.query.Supplier || "";
    const page = parseInt(req.query.page) || 1;
    const limit = getPageSize();

    const { stocks, totalProducts } = await Billing.getStocks(supplierId, page, limit, false);
    const totalPages = Math.ceil(totalProducts / limit);
    const suppliers = await Billing.getSuppliersList();

    res.render("stockList", {
      suppliers, supplierId, stocks, title: "Stock List", currentPage: page, totalPages,
      selectedSupplier: supplierId, BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

/** Search / download of the stock list (POST). */
const getStockList = async (req, res) => {
  try {
    const suppliers = await Billing.getSuppliersList();
    const action = req.body.action;
    const supplierId = req.body.Supplier;
    const page = parseInt(req.query.page) || 1;
    const limit = getPageSize();

    if (action === "download") return await downloadStockInExcel(req, res);

    const { stocks, totalProducts } = await Billing.getStocks(supplierId, page, limit, false);
    const totalPages = Math.ceil(totalProducts / limit);

    res.render("stockList", {
      supplierId, selectedSupplier: supplierId, currentPage: page, totalPages, suppliers, stocks,
      title: "Stock List ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const getStockDetails = async (req, res) => {
  try {
    const productId = req.params.productId;
    const stockDetails = await Billing.getStockDetails(productId);
    res.render("stockDetails", { stockDetails, title: "Stock Details ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

/** Stock ledger of one stock row with running balance. */
const getStockHistory = async (req, res) => {
  try {
    const stockId = Number(req.params.stockId);
    const page = parseInt(req.query.page) || 1;
    const limit = getPageSize();
    const type = req.query.type || null;
    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;
    const search = req.query.search || null;
    const offset = (page - 1) * limit;

    const currentStock = await Billing.getLedgerStock(stockId);
    const productDeatails = await Billing.getProductNameFromStockId(stockId);

    const { transactions, totalCount, openingBalance } = await Billing.getStockTransactions({
      stockId, limit, offset, type, search, fromDate, toDate,
    });

    let totalAdded = 0;
    let totalReduced = 0;
    transactions.forEach((t) => {
      if (t.Effect === "IN") totalAdded += Number(t.Quantity);
      else totalReduced += Number(t.Quantity);
    });

    const netStock = openingBalance + totalAdded - totalReduced;

    let runningBalance = openingBalance;
    const enrichedTransactions = transactions.map((t) => {
      if (t.Effect === "IN") runningBalance += Number(t.Quantity);
      else runningBalance -= Number(t.Quantity);
      return { ...t, runningBalance };
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.render("stockTransactionsHistory", {
      transactions: enrichedTransactions, totalAdded, totalReduced, currentStock, productDeatails, netStock,
      currentPage: page, totalPages, openingBalance, search, type, fromDate, toDate,
      title: "Stock Ledger", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};


/* =====================================================================
 * 3. SALES
 * ===================================================================== */

const getSalePage = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const stocks = await Billing.getStockList();
    const suppliers = await Billing.getSuppliersList();
    // the whole notifications array is flashed here (see addSale error path)
    const notifications = req.flash("message");
    res.render("addSale", { customers, suppliers, notifications, stocks, title: "Add Sale ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const addSale = async (req, res) => {
  const notifications = [];
  try {
    const customerId = req.body.customerId;
    if (!customerId) throw new Error("Customer Id is missing.");

    const { saleId, invoiceId } = await Billing.createSale(req);
    const salesData = await Billing.getPrintSaleData(customerId, saleId);
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, saleId);

    notifications.push({ type: "success", messages: `Sales created successfully with invoice no ${invoiceId}`, icon: "bi-check-circle-fill" });

    res.render("printSale", {
      notifications, salesData, companyDetails: getCompanyDetails(), customerDetails, totalSaleDetails,
      invoiceId, saleId, title: "Sales data ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error in addSale:", error);

    notifications.push({
      type: "danger", messages: error.message || "An error occurred while adding the sale.", icon: "bi-exclamation-triangle-fill",
    });

    req.flash("message", notifications);
    return res.redirect("/billing/addSale?error");
  }
};

const getSalesData = async (req, res) => {
  try {
    const sales = await Billing.getSalesData();
    res.render("salesData", { sales, title: "Sales data ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

/**
 * Everything the "update sale" page needs. Also used to show the page again after a failed save.
 * availableStock = lots that can be added to this sale (with supplier and the customer's price for each),
 * suppliers = every supplier (the page lists them all and disables the ones with no stock).
 * Every sale line also carries CustomerPrice / PriceSource = the customer's saved price for that batch.
 */
const loadUpdateSalesPageData = async (customerId, saleId) => {
  const [lines, customerDetails, totalSaleDetails, availableStock, suppliers] = await Promise.all([
    Billing.getPrintSaleData(customerId, saleId),
    Billing.getCustomerDetails(customerId),
    Billing.getPrintTotalSaleData(customerId, saleId),
    Billing.getAddableStockForSale(customerId),
    Billing.getSuppliersList(),                 // ALL suppliers (those without stock are shown disabled)
  ]);
  if (!lines.length) throw new Error("Sale not found for this customer.");

  // the customer's saved price next to every line (so nobody has to remember prices)
  const saved = await Billing.getCustomerPricesForStock(customerId, lines.map((l) => l.StockId));
  const salesData = lines.map((l) => ({
    ...l,
    CustomerPrice: saved[l.StockId] ? saved[l.StockId].price : null,
    PriceSource: saved[l.StockId] ? saved[l.StockId].source : "NONE",
  }));

  return { salesData, customerDetails, totalSaleDetails, availableStock, suppliers };
};

const renderUpdateSalesPage = (res, customerId, saleId, data, notifications = []) =>
  res.render("updateSales", {
    ...data, saleId, customerId, notifications,
    title: "Update sales data ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
  });

const getupdateSalesPage = async (req, res) => {
  try {
    const saleId = req.params.saleId;
    const customerId = req.params.customerId;
    if (!saleId || !customerId) throw new Error("Invoice Id or Customer Id missing.");

    const data = await loadUpdateSalesPageData(customerId, saleId);
    renderUpdateSalesPage(res, customerId, saleId, data);
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

/**
 * Saves an edited sale: change quantity / price / GST, remove lines, ADD new products.
 *   existing rows:  quantity_<SalesItemId>, rate_<id>, sgst_<id>, cgst_<id>
 *   removed rows:   removedRows = JSON array of SalesItems ids
 *   new products:   newStockId[], newQuantity[], newRate[], newSgst[], newCgst[]
 * CHANGED: on an error the edit page is shown again with the message (nothing was saved)
 *          instead of dropping you on the home page.
 */
const updateSales = async (req, res) => {
  const customerId = req.params.customerId;
  const saleId = req.params.saleId;

  try {
    const userId = req.user.Id;
    if (!customerId || !saleId) throw new Error("Either customerId or invoiceId is mising.");

    let removedRows = [];
    try {
      removedRows = JSON.parse(req.body.removedRows || "[]");
    } catch (_) {
      throw new Error("Could not read the removed rows. Reload the page and try again.");
    }
    const removedSet = new Set(toArray(removedRows).map(String));

    const updatedSales = [];
    const processedIds = new Set();

    for (const key in req.body) {
      if (key.startsWith("quantity_") || key.startsWith("sgst_") || key.startsWith("cgst_") || key.startsWith("rate_")) {
        const id = key.split("_")[1];
        if (!processedIds.has(id) && !removedSet.has(id)) {
          processedIds.add(id);
          updatedSales.push({
            id,
            quantity: req.body[`quantity_${id}`] || 0,
            sgst: req.body[`sgst_${id}`] || 0,
            cgst: req.body[`cgst_${id}`] || 0,
            rate: req.body[`rate_${id}`] || 0,
          });
        }
      }
    }

    // products added on the page
    const newStockIds = toArray(req.body.newStockId);
    const newQuantities = toArray(req.body.newQuantity);
    const newRates = toArray(req.body.newRate);
    const newSgsts = toArray(req.body.newSgst);
    const newCgsts = toArray(req.body.newCgst);
    const newLines = newStockIds.map((stockId, i) => ({
      stockId, quantity: newQuantities[i], rate: newRates[i], sgst: newSgsts[i], cgst: newCgsts[i],
    }));

    const result = await Billing.updateSales(updatedSales, [...removedSet], customerId, saleId, userId, newLines);

    const salesData = await Billing.getPrintSaleData(customerId, saleId);
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, saleId);

    res.render("printSale", {
      notifications: [{ type: "success", messages: result, icon: "bi-check-circle-fill" }],
      salesData, companyDetails: getCompanyDetails(), customerDetails, totalSaleDetails, saleId,
      title: "updated Sales data ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error updating sales:", error);
    try {
      const data = await loadUpdateSalesPageData(customerId, saleId);
      return renderUpdateSalesPage(res, customerId, saleId, data, [
        createNotification("danger", `${error.message || "Could not update the sale."} Nothing was saved.`, "bi-exclamation-triangle-fill"),
      ]);
    } catch (innerError) {
      return renderHomeWithError(res, error);
    }
  }
};

const viewSales = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const customerLists = await Billing.getSearchedSalesData(req);
    res.render("viewSales", { customers, customerLists, title: "Sales History ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const viewSaleThroughSearch = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const customerLists = await Billing.getSearchedSalesData(req);
    const { InvoiceId, Customer, FromDate, ToDate } = req.body;
    res.render("viewSales", { customers, customerLists, InvoiceId, Customer, FromDate, ToDate, title: "Sales History ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const customerWiseSales = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const invoices = await Billing.getSalesReport(req);
    const Customer = req.body?.Customer || "";
    const FromDate = req.body?.FromDate || moment().format("DD-MM-YYYY");
    const ToDate = req.body?.ToDate || moment().format("DD-MM-YYYY");
    res.render("salesReport", { Customer, invoices, FromDate, ToDate, customers, title: "Sales Report ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

/** Sales invoice as PDF. */
const downloadSales = async (req, res) => {
  try {
    const { saleId, customerId } = req.params;
    if (!saleId) throw new Error("Sale Id is missing.");
    if (!customerId) throw new Error("customer Id is missing.");

    const salesData = await Billing.getPrintSaleData(customerId, saleId);
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, saleId);

    if (!salesData || salesData.length === 0) throw new Error("No sales data found for this invoice.");
    if (!customerDetails || Object.keys(customerDetails).length === 0) throw new Error("Customer details not found.");

    const templatePath = path.join(__dirname, "../views/partials/downloadSales.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      salesData, customerDetails, totalSaleDetails, companyDetails: getCompanyDetails(), imageBase64: getLogoBase64("png"),
    });

    const options = { format: "A4", border: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" }, printBackground: true };

    pdf.create(htmlContent, options).toBuffer((err, buffer) => {
      if (err) {
        console.error("PDF Error:", err);
        return res.status(500).send("PDF generation failed");
      }
      const safeFileName = encodeURIComponent(`${customerDetails.CustomerName}-${totalSaleDetails[0].InvoiceId}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
      res.send(buffer);
    });
  } catch (error) {
    console.error("Error in downloadSales:", error);
    renderHomeWithError(res, error);
  }
};

/** Sales invoice as plain HTML (print preview). */
const viewSalesInHtml = async (req, res) => {
  try {
    const { saleId, customerId } = req.params;
    if (!saleId) throw new Error("Sale Id is missing.");
    if (!customerId) throw new Error("Customer Id is missing.");

    const salesData = await Billing.getPrintSaleData(customerId, saleId);
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, saleId);

    if (!salesData || salesData.length === 0) throw new Error("No sales data found for this invoice.");
    if (!customerDetails || Object.keys(customerDetails).length === 0) throw new Error("Customer details not found.");

    const templatePath = path.join(__dirname, "../views/Billing/viewSalesInHtml.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      salesData, customerDetails, totalSaleDetails, companyDetails: getCompanyDetails(), imageBase64: getLogoBase64("jpeg"),
    });
    return res.send(htmlContent);
  } catch (error) {
    console.error(error);
    renderHomeWithError(res, error);
  }
};


/* =====================================================================
 * 4. PAYMENTS AND LEDGERS
 * ===================================================================== */

const getAddPaymentPage = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const customerId = req.query.cId || "";
    res.render("Billing/addPayment", {
      customers, customerId, notifications: readPaymentFlash(req),
      formToken: crypto.randomUUID(),                                      // NEW: one-time code of this form
      title: "payment ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const getAddPaymentPageForSupplier = async (req, res) => {
  try {
    const suppliers = await Billing.getSuppliersList();
    const supplierId = req.query.sId || "";
    res.render("Billing/addPaymentToSupplier", {
      suppliers, supplierId, notifications: readPaymentFlash(req),
      formToken: crypto.randomUUID(),                                      // NEW: one-time code of this form
      title: "payment ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

/* NEW: messages that survive the redirect after a payment is saved */
const PAYMENT_FLASH = "paymentMessage";
const flashPayment = (req, type, text) =>
  req.flash(PAYMENT_FLASH, JSON.stringify({ type, messages: text, icon: type === "success" ? "bi-check-circle-fill" : "bi-info-circle-fill" }));
const readPaymentFlash = (req) =>
  req.flash(PAYMENT_FLASH).map((m) => { try { return JSON.parse(m); } catch (e) { return null; } }).filter(Boolean);

/**
 * CHANGED: after a payment is saved the browser is REDIRECTED to the empty form (Post/Redirect/Get),
 * so refresh / back button can never send the payment again. A repeated form (same one-time code)
 * saves nothing and shows "already saved". On an error nothing was saved: the form is shown again
 * with the typed values and the SAME code, so it can be corrected and sent again.
 */
const addPayment = async (req, res) => {
  const { customerId = "", paymentDate = "", amountPaid = "", paymentType = "", paymentNo = "", paymentNote = "", formToken = "" } = req.body || {};

  try {
    const result = await Billing.addPayment(req);
    flashPayment(req, result.duplicate ? "warning" : "success", result.message);
    return res.redirect(`${req.originalUrl.split("?")[0]}?cId=${encodeURIComponent(customerId)}`);   // same URL as the form (GET)
  } catch (error) {
    if (!error.isUserError) console.error("Error adding payment:", error.stack);
    const notifications = [createNotification("danger", error.message || "An error occurred while adding the payment.", "bi-exclamation-triangle-fill")];
    let customers = [];
    try {
      customers = await Billing.getCustomerList();
    } catch (e) {
      notifications.push(createNotification("danger", e.message, "bi-exclamation-triangle-fill"));
    }
    return res.render("Billing/addPayment", {
      customerId, paymentDate, amountPaid, paymentType, paymentNo, paymentNote, customers, notifications,
      formToken: formToken || crypto.randomUUID(),
      title: "Add Payment", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  }
};

const addPaymentToSupplier = async (req, res) => {
  const { supplierId = "", paymentDate = "", amountPaid = "", paymentType = "", paymentNo = "", formToken = "" } = req.body || {};

  try {
    const result = await Billing.addPaymentToSupplier(req);
    flashPayment(req, result.duplicate ? "warning" : "success", result.message);
    return res.redirect(`${req.originalUrl.split("?")[0]}?sId=${encodeURIComponent(supplierId)}`);   // same URL as the form (GET)
  } catch (error) {
    if (!error.isUserError) console.error("Error adding supplier payment:", error.stack);
    const notifications = [createNotification("danger", error.message || "An error occurred while adding the payment.", "bi-exclamation-triangle-fill")];
    let suppliers = [];
    try {
      suppliers = await Billing.getSuppliersList();
    } catch (e) {
      notifications.push(createNotification("danger", e.message, "bi-exclamation-triangle-fill"));
    }
    return res.render("Billing/addPaymentToSupplier", {
      supplierId, paymentDate, amountPaid, paymentType, paymentNo, suppliers, notifications,
      formToken: formToken || crypto.randomUUID(),
      title: "Add Payment", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  }
};

const getCustomersLedger = async (req, res) => {
  try {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    let startDate, endDate;

    if (req.method === "POST") {
      startDate = req.body.startDate || "";
      endDate = req.body.endDate || today.toISOString().split("T")[0];
    } else {
      startDate = currentMonth < 4 ? `${currentYear - 1}-04-01` : `${currentYear}-04-01`;
      endDate = today.toISOString().split("T")[0];
    }

    const customersLedger = await Billing.getCustomersLedger(startDate, endDate);

    res.render("Billing/customersLedger", {
      customersLedger, startDate, endDate, BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout", title: "Customer Ledger",
    });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

/**
 * Ledger of ONE customer.
 * FIX: the success message after a sales return was built but never passed to the view.
 * FIX: the error page crashed (customerDetails: null, but the view reads customerDetails.Id);
 *      customer details are now loaded first and every render passes the same variables.
 * FIX: empty / wrong dates became "Invalid date" in the query; From after To is refused.
 * FIX: an unknown customer id now shows "Customer not found".
 */
const getIndividualCustomerLedger = async (req, res) => {
  const customerId = req.params.customerId;
  const body = req.body || {};
  let customerDetails = null;
  let startDate = currentFyStart().format("DD-MM-YYYY");
  let endDate = moment().format("DD-MM-YYYY");
  const notifications = [];

  const render = (data = {}) =>
    res.render("Billing/customersLedger", {
      customerLedger: [], totalDebit: 0, totalCredit: 0, closingBalance: "0.00 DR",
      customerDetails, startDate, endDate, financialYear: body.financialYear || "", notifications,
      title: "Customer Ledger ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
      ...data,
    });
  const fail = (msg) => { notifications.push(createNotification("danger", msg, "bi-exclamation-triangle-fill")); return render({ errorMessage: msg }); };

  try {
    const flashed = req.flash ? req.flash("returnStock") : [];
    if (flashed.length) notifications.push(createNotification("success", flashed[0], "bi-check-circle-fill"));

    customerDetails = await Billing.getCustomerDetails(customerId);
    if (!customerDetails) return fail("Customer not found.");

    let from = currentFyStart();
    let to = moment();
    if (req.method === "POST" && (body.startDate || body.endDate)) {
      const range = readLedgerRange(body.startDate, body.endDate);
      if (range.error) {
        startDate = body.startDate || "";
        endDate = body.endDate || "";
        return fail(range.error);
      }
      ({ from, to } = range);
    }
    startDate = from.format("DD-MM-YYYY");
    endDate = to.format("DD-MM-YYYY");

    const { ledger, totalDebit, totalCredit, closingBalance } =
      await Billing.getCustomerLedger(customerId, from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD"));

    return render({ customerLedger: ledger, totalDebit, totalCredit, closingBalance });
  } catch (error) {
    console.error("Ledger error:", error);
    return fail("Error generating ledger. Please try again.");
  }
};

/** Customer ledger as printable HTML. */
const getCustomerLedgerInPdf = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.query.customerId;
    const fromDate = moment(req.params.startDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    const toDate = moment(req.params.endDate, "DD-MM-YYYY").format("YYYY-MM-DD");

    const { ledger, totalDebit, totalCredit, closingBalance } = await Billing.getCustomerLedger(customerId, fromDate, toDate);
    const customer = await Billing.getCustomerDetails(customerId);

    const templatePath = path.join(__dirname, "../views/partials/downloadCustomerLedger.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      company: getCompanyDetails(), ledger, customer, totalDebit, totalCredit, closingBalance,
      fromDate: moment(fromDate).format("DD-MM-YYYY"), toDate: moment(toDate).format("DD-MM-YYYY"),
      currentDate: moment().format("DD-MM-YYYY"), openingBalance: ledger[0]?.Balance || 0,
      imageBase64: getLogoBase64("jpeg"),
    });
    return res.send(htmlContent);
  } catch (error) {
    console.error("Error loading ledger:", error);
    res.status(500).send("Something went wrong while loading the ledger.");
  }
};

/** Customer ledger as Excel. */
const downloadLedgerInExcel = async (req, res) => {
  try {
    const customerId = req.params.customerId;
    const startDate = moment(req.params.startDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    const endDate = moment(req.params.endDate, "DD-MM-YYYY").format("YYYY-MM-DD");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Customer Ledger", { views: [{ state: "frozen", ySplit: 15 }] });

    const companyDetails = getCompanyDetails();
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const { ledger, totalDebit, totalCredit, closingBalance } = await Billing.getCustomerLedger(customerId, startDate, endDate);

    sheet.columns = [
      { header: "Date", key: "Date", width: 18 },
      { header: "Description", key: "Description", width: 30 },
      { header: "Ref No", key: "PaymentNo", width: 24 },
      { header: "Type / Mode", key: "PaymentType", width: 16 },
      { header: "Debit", key: "Debit", width: 15 },
      { header: "Credit", key: "Credit", width: 15 },
      { header: "Balance", key: "Balance", width: 18 },
    ];

    const centered = (text, opts = {}) => {
      const row = sheet.addRow([text]);
      row.alignment = { horizontal: "center" };
      if (opts.font) row.font = opts.font;
      sheet.mergeCells(`A${row.number}:G${row.number}`);
    };

    centered(companyDetails.coreCompany, { font: { size: 18, bold: true } });
    centered(companyDetails.coreCompanyAddress);
    centered(`Phone: ${companyDetails.coreCompanyPhoneNumber} | Email: ${companyDetails.coreCompanyEmail}`);
    centered(`GST: ${companyDetails.coreCompanyGstNo} | DL: ${companyDetails.coreCompanyDLNo}`);
    centered(`Bank: ${companyDetails.coreCompanyBankName} | A/C: ${companyDetails.coreCompanyAccountNo} | IFSC: ${companyDetails.coreCompanyIFSCCode}`);
    sheet.addRow([]);

    const custHeader = sheet.addRow(["Customer Ledger"]);
    custHeader.font = { bold: true, size: 14 };
    sheet.mergeCells(`A${custHeader.number}:G${custHeader.number}`);

    sheet.addRow(["Customer Name", customerDetails.CustomerName]);
    sheet.addRow(["Address", `${customerDetails.BillingAddress}, ${customerDetails.BillingDistrict}, ${customerDetails.BillingState} - ${customerDetails.BillingPincode}`]);
    sheet.addRow(["GST No", customerDetails.GstNo]);
    sheet.addRow(["Mobile", customerDetails.MobileNo]);
    sheet.addRow([]);
    sheet.addRow([]);

    const thin = { style: "thin" };
    const headerRow = sheet.addRow(["Date", "Description", "Ref No (Inv / CN / UTR)", "Type / Mode", "Debit", "Credit", "Balance"]);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: "center" };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "D9D9D9" } };
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
    });

    ledger.forEach((row) => {
      const newRow = sheet.addRow([row.Date, row.Description, row.Ref ? `${row.RefLabel ? row.RefLabel + " " : ""}${row.Ref}` : (row.PaymentNo || ""), row.Mode || row.PaymentType || (row.IsOpening ? "" : row.Type || ""), row.Debit, row.Credit, row.Balance]);   // CHANGED: invoice / CN / UTR no + type
      newRow.eachCell((cell, colNumber) => {
        cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (colNumber === 5 || colNumber === 6) { cell.numFmt = '"₹"#,##0.00'; cell.alignment = { horizontal: "right" }; }
        if (colNumber === 7) cell.alignment = { horizontal: "right" };
      });
    });

    sheet.addRow([]);
    const totalRow = sheet.addRow(["", "Total", "", "", totalDebit, totalCredit, ""]);
    totalRow.font = { bold: true };
    totalRow.getCell(5).numFmt = '"₹"#,##0.00';
    totalRow.getCell(6).numFmt = '"₹"#,##0.00';
    sheet.addRow(["", "Closing Balance", "", "", "", "", closingBalance]).font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Customer_Ledger_${customerId}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    if (!res.headersSent) res.status(500).send("Something went wrong while generating Excel.");
  }
};

/* NEW: shared date handling of the supplier ledger page and its Excel download */
const LEDGER_DATE_FORMATS = ["DD-MM-YYYY", "D-M-YYYY", "DD/MM/YYYY", "YYYY-MM-DD"];
const currentFyStart = () => {
  const today = moment();
  return today.month() < 3 ? moment(`${today.year() - 1}-04-01`, "YYYY-MM-DD") : moment(`${today.year()}-04-01`, "YYYY-MM-DD");
};
/** Returns { from, to } moments, or { error } when a date is invalid / From is after To. */
const readLedgerRange = (fromRaw, toRaw) => {
  const from = moment(String(fromRaw || "").trim(), LEDGER_DATE_FORMATS, true);
  const to = moment(String(toRaw || "").trim(), LEDGER_DATE_FORMATS, true);
  if (!from.isValid() || !to.isValid()) return { error: "Please select a valid From and To date (DD-MM-YYYY)." };
  if (from.isAfter(to, "day")) return { error: "From date cannot be after To date." };
  return { from, to };
};

/**
 * Supplier ledger as Excel.
 * FIX (earlier): City / GstIn are used (District / GstNo do not exist on Suppliers).
 * CHANGED: same columns as the page - type, our ref, supplier invoice / CN / cheque-UTR with dates.
 * FIX: invalid dates in the link or an unknown supplier gave a crash / "Invalid date" query.
 */
const downloadSupplierLedgerInExcel = async (req, res) => {
  try {
    const supplierId = req.params.supplierId;
    const range = readLedgerRange(req.params.startDate, req.params.endDate);
    if (range.error) return res.status(400).send(range.error);

    const supplierDetails = await Billing.getSupplierDetails(supplierId);
    const supplier = supplierDetails && supplierDetails[0];
    if (!supplier) return res.status(404).send("Supplier not found.");

    const { ledger, totalDebit, totalCredit, closingBalance } =
      await Billing.getSupplierLedger(supplierId, range.from.format("YYYY-MM-DD"), range.to.format("YYYY-MM-DD"));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Supplier Ledger");
    const thin = { style: "thin" };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const money = '#,##0.00';

    sheet.columns = [
      { key: "Date", width: 12 }, { key: "Type", width: 16 }, { key: "OurRef", width: 30 }, { key: "OurRefDate", width: 12 },
      { key: "SupplierRef", width: 26 }, { key: "SupplierRefDate", width: 12 }, { key: "Description", width: 42 },
      { key: "Debit", width: 15 }, { key: "Credit", width: 15 }, { key: "Balance", width: 18 },
    ];

    const title = sheet.addRow([`Supplier Ledger: ${supplier.Name || ""}`]);
    title.font = { bold: true, size: 16 };
    sheet.mergeCells(`A${title.number}:J${title.number}`);
    sheet.addRow([`Period: ${range.from.format("DD-MM-YYYY")} to ${range.to.format("DD-MM-YYYY")}`]);
    sheet.addRow(["Address", `${supplier.Address || ""}, ${supplier.City || ""}, ${supplier.State || ""} - ${supplier.Pincode || ""}`]);
    sheet.addRow(["GST No", supplier.GstIn || ""]);
    sheet.addRow(["DL No", supplier.DlNo || ""]);
    sheet.addRow(["Mobile No", supplier.ContactNo || ""]);
    sheet.addRow([]);

    const header = sheet.addRow(["Date", "Type", "Our Ref (PO / Return / Mode)", "Our Ref Date", "Supplier Ref (Inv / CN / Chq-UTR)",
      "Supplier Ref Date", "Description", "Debit (Rs.)", "Credit (Rs.)", "Balance"]);
    header.font = { bold: true };
    header.eachCell((c) => { c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "D9D9D9" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
    sheet.views = [{ state: "frozen", ySplit: header.number }];

    ledger.forEach((row) => {
      const r = sheet.addRow([
        row.Date, row.Type || "", row.OurRef || "", row.OurRefDate || "",
        row.SupplierRef ? `${row.SupplierRefLabel ? row.SupplierRefLabel + " " : ""}${row.SupplierRef}` : "",
        row.SupplierRefDate || "", row.Description || "",
        Number(row.Debit) || 0, Number(row.Credit) || 0, row.Balance,
      ]);
      r.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
      r.getCell(8).numFmt = money;
      r.getCell(9).numFmt = money;
      r.getCell(10).alignment = { horizontal: "right" };
      if (row.IsOpening) r.font = { italic: true };
    });

    const total = sheet.addRow(["", "", "", "", "", "", "Total", totalDebit, totalCredit, ""]);
    total.font = { bold: true };
    total.getCell(8).numFmt = money;
    total.getCell(9).numFmt = money;
    const closing = sheet.addRow(["", "", "", "", "", "", "Closing Balance", "", "", closingBalance]);
    closing.font = { bold: true };
    closing.getCell(10).alignment = { horizontal: "right" };

    const safeName = String(supplier.Name || supplierId).replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      `attachment; filename=Supplier_Ledger_${safeName}_${range.from.format("DDMMYYYY")}_${range.to.format("DDMMYYYY")}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    if (!res.headersSent) res.status(500).send("Something went wrong while generating Excel.");
  }
};

/**
 * Supplier ledger page (GET = current financial year, POST = chosen dates).
 * FIX: the error page crashed (supplierDetails: null, but the view reads supplierDetails[0]);
 *      supplier details are now loaded first and every render passes the same variables.
 * FIX: an empty / wrong date was sent to MySQL as "Invalid date"; From after To is refused.
 * FIX: an unknown supplier id showed a crash page, it now shows "Supplier not found".
 */
const getSupplierLedger = async (req, res) => {
  const supplierId = req.params.supplierId;
  const body = req.body || {};
  let supplierDetails = [];
  let startDate = currentFyStart().format("DD-MM-YYYY");
  let endDate = moment().format("DD-MM-YYYY");

  const render = (data = {}) =>
    res.render("Billing/supplierLedger", {
      supplierLedger: [], totalDebit: 0, totalCredit: 0, closingBalance: "0.00 DR", notifications: [],
      supplierDetails, startDate, endDate, financialYear: body.financialYear || "",
      title: "Supplier Ledger ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
      ...data,
    });
  const fail = (msg) => render({ errorMessage: msg, notifications: [createNotification("danger", msg, "bi-exclamation-triangle-fill")] });

  try {
    supplierDetails = (await Billing.getSupplierDetails(supplierId)) || [];
    if (!supplierDetails.length) return fail("Supplier not found.");

    let from = currentFyStart();
    let to = moment();
    if (req.method === "POST") {
      const range = readLedgerRange(body.startDate, body.endDate);
      if (range.error) {
        startDate = body.startDate || "";
        endDate = body.endDate || "";
        return fail(range.error);
      }
      ({ from, to } = range);
    }
    startDate = from.format("DD-MM-YYYY");
    endDate = to.format("DD-MM-YYYY");

    const { ledger, totalDebit, totalCredit, closingBalance } =
      await Billing.getSupplierLedger(supplierId, from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD"));

    return render({ supplierLedger: ledger, totalDebit, totalCredit, closingBalance });
  } catch (error) {
    console.error("Ledger error:", error);
    return fail("Error generating ledger. Please try again.");
  }
};

/**
 * FIX: the view needs TotalSales / TotalPayments but the model returns TotalDebit /
 *      TotalCredit - the old mapping turned both into 0.
 */
const getCustomerListWithDues = async (req, res) => {
  try {
    let customersWithDues = await Billing.getCustomerListWithDues();
    customersWithDues = customersWithDues.map((cust) => ({
      ...cust,
      TotalDebit: Number(cust.TotalDebit) || 0,
      TotalCredit: Number(cust.TotalCredit) || 0,
      TotalSales: Number(cust.TotalSales ?? cust.TotalDebit) || 0,
      TotalPayments: Number(cust.TotalPayments ?? cust.TotalCredit) || 0,
      PendingAmount: Number(cust.PendingAmount) || 0,
    }));

    res.render("Customer/customerDues", {
      customersWithDues, moment, title: "Customer with dues amount", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error in viewCustomerDues:", error);
    return renderHomeWithError(res, error);
  }
};


/* =====================================================================
 * 5. PURCHASE ORDERS AND RECEIVING THE SUPPLIER INVOICE
 * ===================================================================== */

const getPurchasePoPage = async (req, res) => {
  try {
    const suppliers = await Billing.getSuppliersList();
    const products = await Billing.getProductList();
    res.render("Billing/createPurchasePo", { suppliers, products, title: "Purchase Po", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

/** Creates a purchase order and shows the printable PO. */
const createPurchasePo = async (req, res) => {
  try {
    const purchaseOrderId = await Billing.createPurchasePo(req);
    if (!purchaseOrderId) throw new Error("Failed to create Purchase Order");

    const { supplierId } = req.body;
    if (!supplierId) throw new Error("Supplier is required");

    const [supplierDetails, totalPurchaseDetails, totalPurchasePoAmount] = await Promise.all([
      Billing.getSupplierDetails(supplierId),
      Billing.getTotalPurchasePoDetails(purchaseOrderId),
      Billing.getTotalPurchasePoAmount(purchaseOrderId),
    ]);

    const c = getCompanyDetails();
    const companyDetails = {
      name: c.coreCompany, address: c.coreCompanyAddress, phone: c.coreCompanyPhoneNumber, email: c.coreCompanyEmail,
      bankName: c.coreCompanyBankName, accountNo: c.coreCompanyAccountNo, ifsc: c.coreCompanyIFSCCode,
      gstNo: c.coreCompanyGstNo, dlNo: c.coreCompanyDLNo,
    };

    return res.render("purchasePoOrder", {
      supplierDetails, totalPurchaseDetails, purchaseOrderId, companyDetails, totalPurchasePoAmount,
      title: "Purchase PO", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error in createPurchasePo:", error);

    try {
      const [suppliers, products] = await Promise.all([Billing.getSuppliersList(), Billing.getProductList()]);
      const { productId = "", supplierId = "", quantity = "", purchasePrice = "", igst = "", mrp = "" } = req.body;

      const notifications = [{
        type: "danger", messages: error.message || "Something went wrong while creating Purchase PO.", icon: "bi-exclamation-triangle-fill",
      }];

      return res.render("Billing/createPurchasePo", {
        suppliers, products, productId, supplierId, quantity, purchasePrice, igst, mrp, notifications,
        title: "Create Purchase PO", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
      });
    } catch (innerError) {
      console.error("Secondary error:", innerError);
      return res.status(500).send("Critical error while processing request.");
    }
  }
};

/** Purchase order as PDF (puppeteer). */
const downloadPurchasePo = async (req, res) => {
  try {
    const purchaseOrderId = req.params.purchaseId;
    const supplierId = req.params.supplierId;

    const supplierDetails = await Billing.getSupplierDetails(supplierId);
    const totalPurchaseDetails = await Billing.getTotalPurchasePoDetails(purchaseOrderId);
    const totalPurchasePoAmount = await Billing.getTotalPurchasePoAmount(purchaseOrderId);
    const companyDetails = { ...getCompanyDetails() };

    const templatePath = path.join(__dirname, "../views/partials/downloadPurchasePo.ejs");
    const headerTemplate = `
<style>
  .header-wrap { width: 100%; padding: 4px 15px 4px 25px; font-family: 'Roboto', sans-serif; font-size: 20px; border-bottom: 2px solid #000; box-sizing: border-box; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; width: 100%; margin-bottom:5px; margin-top:5px; }
  .header-title { text-transform: uppercase; font-weight: 700; font-size: 20px; }
  .header-small { font-size: 15px; }
  .badge-tax { background: #000; color: #fff; padding: 2px 6px; font-size: 9px; border-radius: 3px; text-transform: uppercase; }
  img { max-height: 26px; max-width: 80px; }
</style>
<div class="header-wrap">
  <div class="header-top">
    <div>
      <div class="header-title">${companyDetails.coreCompany}</div>
      <div class="header-small">${companyDetails.coreCompanyAddress}</div>
      <div class="header-small">Email: ${companyDetails.coreCompanyEmail} | Phone: ${companyDetails.coreCompanyPhoneNumber}</div>
    </div>
    <div style="text-align:right;">
      <div class="badge-tax">Tax Invoice</div>
      <img src="${companyDetails.coreCompanyLogoUrl || "logo-placeholder.png"}" />
    </div>
  </div>
</div>`;

    const html = await ejs.renderFile(templatePath, { supplierDetails, totalPurchaseDetails, companyDetails, totalPurchasePoAmount, purchaseOrderId });

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.emulateMediaType("screen");
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await page.pdf({
        format: "A4", printBackground: true, displayHeaderFooter: true,
        margin: { top: "90px", bottom: "60px", left: "25mm", right: "25mm" },
        headerTemplate, footerTemplate: `<div></div>`,
      });

      res.setHeader("Content-Disposition", `attachment; filename=PurchasePo-${purchaseOrderId}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdfBuffer);
    } finally {
      await browser.close();           // FIX: the browser leaked when rendering failed
    }
  } catch (error) {
    console.error("Error in downloading purchase PO:", error);
    res.status(500).send("Error generating purchase order PDF");
  }
};

const viewPurchasePo = async (req, res) => {
  try {
    const filters = {
      PurchaseInvoiceNo: req.body.PurchaseInvoiceNo || null,
      Supplier: req.body.Supplier || null,
      FromDate: req.body.FromDate || null,
      ToDate: req.body.ToDate || null,
    };
    const supplierLists = await Billing.getSuppliersList();
    const purchasePoLists = await Billing.getPurchasePoList(filters);
    res.render("Billing/viewPurchasePo", { supplierLists, purchasePoLists, title: "Purchase Po History ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const viewPurchasePoList = async (req, res) => {
  try {
    const filters = {
      PurchaseInvoiceNo: req.body.PurchaseInvoiceNo || null,
      Supplier: req.body.Supplier || null,
      FromDate: req.body.FromDate || null,
      ToDate: req.body.ToDate || null,
    };
    const supplierLists = await Billing.getSuppliersList();
    const purchasePoLists = await Billing.getPurchasePoList(filters);
    res.render("Billing/viewPurchasePo", {
      supplierLists, purchasePoLists, PurchaseInvoiceNo: filters.PurchaseInvoiceNo, Supplier: filters.Supplier,
      FromDate: filters.FromDate, ToDate: filters.ToDate, title: "Purchase Po History", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const getReceivePurchaseOrderPage = async (req, res) => {
  try {
    const body = req.body || {};
    const purchaseOrderId = req.params.purchaseOrderId || null;

    let purchaseOrderDetails = [];
    if (purchaseOrderId) purchaseOrderDetails = await Billing.getTotalPurchasePoDetails(purchaseOrderId);

    const purchaseOrderData = purchaseOrderDetails.length > 0 ? purchaseOrderDetails[0] : {};

    const filters = {
      PurchaseInvoiceNo: body.PurchaseInvoiceNo || purchaseOrderData.PurchaseInvoiceNo || null,
      Supplier: body.Supplier || purchaseOrderData.SupplierId || null,
      FromDate: body.FromDate || purchaseOrderData.OrderDate || null,
      ToDate: body.ToDate || null,
    };
    const suppliers = await Billing.getSuppliersList();
    const purchaseOrders = await Billing.getPurchasePoListForReceivingTheOrder(filters);

    const orderDateDMY = purchaseOrderData.OrderDate ? moment(purchaseOrderData.OrderDate).format("DD-MM-YYYY") : null;

    res.render("Billing/receivePurchaseOrder", {
      suppliers,
      purchaseOrderDetails: purchaseOrders,
      PurchaseInvoiceNo: body.PurchaseInvoiceNo || purchaseOrderData.PurchaseInvoiceNo || null,
      Supplier: body.Supplier || purchaseOrderData.SupplierId || null,
      FromDate: body.FromDate || orderDateDMY,
      ToDate: body.ToDate || orderDateDMY,
      title: "Receive Purchase Order", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error(error.stack);
    res.status(500).send("Error fgt loading page");
  }
};

/**
 * Receives goods against a PO.
 * FIX: the catch block was EMPTY -> on any error the browser waited forever.
 * FIX: the "selected" rows were computed but never used (the model got every row).
 * FIX: more than 20 rows arrive as an object, not an array (qs arrayLimit) - handled.
 */
const generateInvoice = async (req, res) => {
  try {
    const { purchaseOrderId } = req.body;
    if (!purchaseOrderId) throw new Error("Purchase order id is missing.");

    const raw = req.body.products;
    const all = Array.isArray(raw) ? raw : Object.values(raw || {});
    const selected = all.filter((p) => p && p.selected);
    if (!selected.length) throw new Error("Select at least one product to receive.");

    req.body.products = selected;                        // only the checked rows go to the model

    const { message } = await Billing.generateInvoice(req);
    req.flash("message", message);
    return res.redirect(`/Billing/invoiceDetails/${purchaseOrderId}`);
  } catch (error) {
    console.error("generateInvoice error:", error);
    return renderHomeWithError(res, error.message || error, "Could not receive the purchase order.");
  }
};

/**
 * FIX: the missing-id guard sat outside the try block (unhandled rejection).
 * FIX: a "success" notification was always shown, even with no message.
 */
const invoiceDetails = async (req, res) => {
  const notifications = [];
  try {
    const { purchaseOrderId } = req.params;
    if (!purchaseOrderId) throw new Error("Purchase order Id is missing.");

    const purchaseOrder = await Billing.getTotalPurchasePoDetails(purchaseOrderId);
    const invoices = await Billing.getInvoiceDetails(purchaseOrderId);
    const flashed = req.flash("message");
    if (flashed.length) notifications.push(createNotification("success", flashed[0], "bi-check-circle-fill"));

    res.render("invoiceDetails", {
      purchaseOrder: purchaseOrder || null, invoices, purchaseOrderId, BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout", title: "Purchase Order Invoice Details", notifications,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching invoice details");
  }
};

/** FIX: invoiceDetails[0] was read before checking that anything was found. */
const downloadInvoice = async (req, res) => {
  try {
    const supplierInvoiceNo = req.params.supplierInvoice;
    const invoiceDetailRows = await Billing.getInvoiceDetailsThroughSupplierInvoiceNo(supplierInvoiceNo);

    if (invoiceDetailRows.length === 0) return res.status(404).send("No data found for this Supplier Invoice No");

    const purchaseOrder = await Billing.getTotalPurchasePoDetails(invoiceDetailRows[0].PurchaseOrderId);

    const templatePath = path.join(__dirname, "../views/partials/downloadInvoice.ejs");
    const templateHtml = await ejs.renderFile(templatePath, { invoiceDetails: invoiceDetailRows, purchaseOrder, moment });

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas", "--disable-gpu", "--single-process"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(templateHtml, { waitUntil: "load", timeout: 0 });
      const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

      res.setHeader("Content-Disposition", `attachment; filename="PurchaseOrder_${supplierInvoiceNo}.pdf"`);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error("Error generating invoice PDF:", error);
    res.status(500).send("Error generating invoice PDF");
  }
};

/** Upload a supplier PO pdf and review the parsed lines. */
const processUploadedPdf = async (req, res) => {
  try {
    const supplierId = req.body.supplierId;
    const pdfPath = req.file.path;

    const parsedData = await pdfParser.parsePoPdf(pdfPath);
    const supplierProducts = await Billing.getProductList();

    res.render("Billing/poReview", {
      uploadId, supplierId, header: parsedData.header, items: parsedData.items, supplierProducts,
      title: "upload purchase po", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (err) {
    console.error(err);
    res.send("Error processing PDF");
  }
};


/* =====================================================================
 * 6. CUSTOMER PRICING
 * ===================================================================== */

const loadPricingPageData = async (customerId, supplierId) => {
  const [productPricingForCustomer, customers, suppliers] = await Promise.all([
    Billing.getSuppliersProductWithCustomerPricing(customerId, supplierId),
    Billing.getCustomerList(),
    Billing.getSuppliersList(),
  ]);
  return { productPricingForCustomer, customers, suppliers };
};

/** FIX: removed console.log(req) (dumped the whole request on every page load). */
const getupdatePricePageForCustomer = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.body?.customerId;
    const supplierId = req.body?.supplierId || req.query?.supplierId || "";
    const data = await loadPricingPageData(customerId, supplierId);

    res.render("setProductPricing", {
      ...data, customerId, supplierId, BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout", title: "Customer product pricing",
    });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

/**
 * Saves the price of ONE lot (stockId) for a customer.
 * CHANGED: the model returns { message, belowCost } - a below-cost price shows a warning.
 * FIX: console.log(req) removed; one render path instead of three copies.
 */
const setProductPriceForCustomer = async (req, res) => {
  const notifications = [];
  const { customerId, supplierId, productId, stockId } = req.params;
  const newProductPrice = req.body.newProductPrice;

  try {
    if (!customerId || !productId || !stockId || !(Number(newProductPrice) > 0))
      throw new Error("Missing or invalid parameters (customer, product, stock, price).");

    const result = await Billing.setProductPricingForCustomer(customerId, supplierId, productId, newProductPrice, stockId);
    notifications.push(createNotification(
      result.belowCost ? "warning" : "success", result.message,
      result.belowCost ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill"
    ));
  } catch (error) {
    console.error("Error in setProductPriceForCustomer:", error);
    notifications.push(createNotification("danger", error.message || "Could not save the price.", "bi-exclamation-triangle-fill"));
  }

  try {
    const data = await loadPricingPageData(customerId, supplierId);
    return res.render("setProductPricing", {
      ...data, customerId, supplierId, notifications, BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout", title: "Customer Product Pricing",
    });
  } catch (error) {
    return renderHomeWithError(res, error);
  }
};

/**
 * Does the customer have a usable price (sale page check)?
 * CHANGED: send stockId from the sale page JS ({ productId, customerId, stockId }) so the
 *          answer matches what billing will really do. FIX: error path answers (was a hang).
 */
const getProductPrice = async (req, res) => {
  try {
    const { productId, customerId, stockId } = req.body;
    const result = await Billing.getProductPrice(productId, customerId, stockId || null);
    res.json({ success: result.length > 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Could not check price." });
  }
};

const showIndividualProductPriceHistory = async (req, res) => {
  try {
    const productId = parseInt(req.query.productId);
    const supplierId = req.query.supplierId ? parseInt(req.query.supplierId) : null;
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit = getPageSize();

    const result = await Billing.getProductPriceHistory(productId, supplierId, page, limit);

    return res.render("Billing/individualProductPriceHistory", {
      rows: result.data, pagination: result.pagination, productId, selectedSupplierId: supplierId,
      title: "Product Price History", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error in showIndividualProductPriceHistory controller:", error);
    return renderHomeWithError(res, error, "");
  }
};


/* =====================================================================
 * 7. SALES RETURN
 * ===================================================================== */

const getReturnSalePage = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const suppliers = await Billing.getSuppliersList();
    const products = await Billing.getProductList();
    res.render("return", { customers, suppliers, products, title: "Return sales page", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

/**
 * Sales return.  Form fields: Customer, Product[], BatchNumber[], Quantity[], Condition[], Reason[]
 * FIX: with ONE row the form posts strings, so `Product.length` was the string length and the
 *      code looped over characters -> single-item returns failed.
 * FIX: an OBJECT was flashed ("[object Object]") plus a second message; now one readable
 *      message with the credit note number.
 */
const salesReturn = async (req, res) => {
  try {
    const customerId = req.body.Customer;
    if (!customerId) throw new Error("Customer is required.");

    const products = toArray(req.body.Product);
    const batches = toArray(req.body.BatchNumber);
    const quantities = toArray(req.body.Quantity);
    const conditions = toArray(req.body.Condition);
    const reasons = toArray(req.body.Reason);

    if (!products.length) throw new Error("Add at least one product to return.");
    if (batches.length !== products.length || quantities.length !== products.length)
      throw new Error("Some return rows are incomplete (product / batch / quantity).");

    const items = products.map((product, i) => {
      if (!reasons[i] || !String(reasons[i]).trim()) throw new Error(`Row ${i + 1}: reason is required.`);
      return {
        Product: product, BatchNumber: batches[i], Quantity: quantities[i],
        Condition: conditions[i] || "GOOD", Reason: reasons[i],
      };
    });

    const result = await Billing.processSalesReturn(customerId, items, req.user.Id);

    req.flash("returnStock", `Sales return completed. Credit note ${result.creditNoteNumber} for Rs. ${result.totalAmount.toFixed(2)}.`);
    return res.redirect(`/billing/customerLedger/${customerId}`);
  } catch (error) {
    console.error("Sales Return Error:", error.message);
    return renderHomeWithError(res, error.message);
  }
};

/** FIX: the default end date used the format "DD-MM-YYY" (typo) -> garbage date -> empty list on first open. */
const viewSalesReturn = async (req, res) => {
  try {
    const customerId = req.body?.customer || "";
    const startDate = req.body?.startDate || moment().format("DD-MM-YYYY");
    const endDate = req.body?.endDate || moment().format("DD-MM-YYYY");

    const customers = await Billing.getCustomerList();
    const data = await Billing.viewSalesReturn(customerId, startDate, endDate);

    res.render("Billing/viewSalesReturn", {
      customers, startDate, endDate, customerId, data, title: "view sales return",
      BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred.Kindly try again 1.");
  }
};

const viewIndividualSalesReturnCN = async (req, res) => {
  try {
    const creditNoteId = req.params.creditNoteId;
    if (!creditNoteId) throw new Error("Some parameter are missing");

    const { creditNoteHeader, items, summary } = await Billing.getIndividualCustomerSalesRtCN(creditNoteId);

    const templatePath = path.join(__dirname, "../views/Billing/individualSalesReturnCN.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      companyDetails: getCompanyDetails(), imageBase64: getLogoBase64("jpeg"), creditNoteHeader, items, summary,
    });
    return res.send(htmlContent);
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred.Kindly try again 2.");
  }
};


/* =====================================================================
 * 8. CHALLANS
 * ===================================================================== */

/** FIX: the catch block was empty (the page hung on error). */
const getCreateChallanPage = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const stocks = await Billing.getStockList();
    const notifications = req.flash("message");
    res.render("Challan/createChallan", { customers, notifications, stocks, title: "Create challan ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    return renderHomeWithError(res, error, "");
  }
};

const createChallan = async (req, res) => {
  const notifications = [];
  try {
    const challanId = await Billing.createChallan(req);
    const customerDetails = await Billing.getCustomerDetails(req.body.customerId);
    const challans = await Billing.getChallanDetails(req.body.customerId, challanId);

    notifications.push({ type: "success", messages: `Challan created successfully with challan no ${challanId}`, icon: "bi-check-circle-fill" });

    res.render("Challan/viewChallan", {
      notifications, companyDetails: getCompanyDetails(), customerDetails, challans, challanId,
      title: "Challan data ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error in create challan:", error);

    notifications.push({
      type: "danger", messages: error.message || "An error occurred while creating the challan.", icon: "bi-exclamation-triangle-fill",
    });

    req.flash("message", notifications);
    return res.redirect("/billing/createChallan?error");
  }
};

const viewChallan = async (req, res) => {
  try {
    const { challanId, customerId } = req.params;
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const challans = await Billing.getChallanDetails(customerId, challanId);

    res.render("Challan/viewChallan", {
      companyDetails: getCompanyDetails(), customerDetails, challans, challanId,
      title: "Challan data", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error fetching challan details:", error);
    res.status(500).send("Internal Server Error");
  }
};

/** Challan as PDF (puppeteer or html-pdf, switched by USE_PUPPETEER). */
const downloadChallanInPdf = async (req, res) => {
  try {
    const { challanId, customerId } = req.params;

    const customerDetails = await Billing.getCustomerDetails(customerId);
    const totalChallanDetails = await Billing.getChallanDetails(customerId, challanId);

    if (!totalChallanDetails || totalChallanDetails.length === 0)
      return res.status(404).send(`No challan data found for challan #${challanId}.`);
    if (!customerDetails || Object.keys(customerDetails).length === 0)
      return res.status(404).send("Customer details not found.");

    const templatePath = path.join(__dirname, "../views/partials/downloadChallan.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      customerDetails, totalChallanDetails, challanId, companyDetails: getCompanyDetails(), imageBase64: getLogoBase64("png"),
    });

    const safeFileName = encodeURIComponent(`Challan-${challanId}-${customerDetails.CustomerName}.pdf`);
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
    res.setHeader("Content-Type", "application/pdf");

    if (process.env.USE_PUPPETEER === "true") {
      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas", "--disable-gpu", "--single-process"],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: "load", timeout: 0 });
        const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" } });
        return res.send(pdfBuffer);
      } finally {
        await browser.close();
      }
    }

    // html-pdf path (shared hosting compatible)
    const options = {
      format: "A4", orientation: "portrait", border: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" },
      type: "pdf", timeout: 30000, phantomPath: process.env.PHANTOMJS_PATH || undefined,
    };
    const pdfBuffer = await new Promise((resolve, reject) => {
      pdf.create(htmlContent, options).toBuffer((err, buffer) => (err ? reject(err) : resolve(buffer)));
    });
    return res.send(pdfBuffer);
  } catch (error) {
    console.error("Error in downloadChallanInPdf:", error);
    if (!res.headersSent) res.status(500).send("Error generating challan PDF.");
  }
};

const viewChallanInHtml = async (req, res) => {
  try {
    const { challanId, customerId } = req.params;
    if (!challanId) throw new Error("Challan Id is missing.");
    if (!customerId) throw new Error("Customer Id is missing.");

    const customerDetails = await Billing.getCustomerDetails(customerId);
    const challans = await Billing.getChallanDetails(customerId, challanId);

    if (!challans || challans.length === 0) throw new Error("No challan data found for this invoice.");
    if (!customerDetails || Object.keys(customerDetails).length === 0) throw new Error("Customer details not found.");

    const templatePath = path.join(__dirname, "../views/Billing/viewChallanInHtml.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      challans, challanId, customerDetails, companyDetails: getCompanyDetails(), imageBase64: getLogoBase64("jpeg"),
    });
    return res.send(htmlContent);
  } catch (error) {
    console.error(error);
    renderHomeWithError(res, error);
  }
};

const viewChallans = async (req, res) => {
  try {
    const filters = {
      challanId: req.body?.challanId || "",
      customerId: req.body?.customerId || "",
      fromDate: req.body?.fromDate || "",
      toDate: req.body?.toDate || "",
    };

    const groupedChallans = await Billing.getAllChallans(filters);
    const customers = await Billing.getCustomerList();
    const notifications = req.flash("message");

    return res.render("Challan/viewAllChallan", {
      groupedChallans, customers, notifications, filters, moment, title: "Challan List",
      BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error fetching challan list:", error);
    return renderHomeWithError(res, error);
  }
};

/** Renders the challan page again after cancel / deliver, always with the notification. */
const renderChallanAfterAction = async (res, customerId, challanId, notifications) => {
  try {
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const challans = await Billing.getChallanDetails(customerId, challanId);

    res.render("Challan/viewChallan", {
      companyDetails: getCompanyDetails(), customerDetails, challans, notifications, challanId,
      title: "Challan data", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (fetchError) {
    console.error(fetchError);
    res.status(500).send("Unable to load challan details.");
  }
};

const cancelChallan = async (req, res) => {
  const notifications = [];
  const { challanId, customerId } = req.body;

  try {
    await Billing.cancelTheChallan(challanId);
    notifications.push({ type: "success", messages: "Challan has been successfully cancelled.", icon: "bi-check-circle-fill" });
  } catch (error) {
    console.error(error);
    notifications.push({ type: "danger", messages: error.message || "An error occurred while cancelling the challan.", icon: "bi-exclamation-triangle-fill" });
  }
  await renderChallanAfterAction(res, customerId, challanId, notifications);
};

const delivery = async (req, res) => {
  const notifications = [];
  const { challanId, customerId } = req.body;

  try {
    await Billing.deliverTheProduct(challanId);
    notifications.push({ type: "success", messages: "Challan is marked as successfully delivered.", icon: "bi-check-circle-fill" });
  } catch (error) {
    console.error(error);
    notifications.push({ type: "danger", messages: error.message || "An error occurred while delivering the challan.", icon: "bi-exclamation-triangle-fill" });
  }
  await renderChallanAfterAction(res, customerId, challanId, notifications);
};

const convertToSale = async (req, res) => {
  const notifications = [];
  try {
    const { challanId, customerId } = req.body;
    const userId = req.user.Id;

    const { saleId, invoiceId } = await Billing.convertToSale(challanId, customerId, userId);
    const salesData = await Billing.getPrintSaleData(customerId, saleId);
    const customerDetails = await Billing.getCustomerDetails(customerId);
    const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, saleId);

    notifications.push({ type: "success", messages: `Sales created successfully with invoice no ${invoiceId}`, icon: "bi-check-circle-fill" });

    res.render("printSale", {
      notifications, salesData, companyDetails: getCompanyDetails(), customerDetails, totalSaleDetails, saleId,
      title: "Sales data ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    notifications.push({ type: "danger", messages: error.message, icon: "bi-exclamation-triangle-fill" });
    req.flash("message", notifications);
    return res.redirect("/billing/viewChallans?error");
  }
};


/* =====================================================================
 * 9. STOCK / SALES REPORTS AND EXCEL EXPORTS
 * ===================================================================== */

const THIN_BORDER = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };

const sendWorkbook = async (res, workbook, fileName) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  await workbook.xlsx.write(res);
  res.end();
};

/** Stock list as Excel (all batches, expiry status coloured). */
const downloadStockInExcel = async (req, res) => {
  try {
    const supplierId = req.body.Supplier;
    const { stocks } = await Billing.getStocks(supplierId, null, null, true);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Stock Report");

    worksheet.mergeCells("A1:G1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `STOCK REPORT AS ON ${new Date().toLocaleDateString("en-IN")}`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(1).height = 25;
    worksheet.addRow([]);

    const headerRow = worksheet.addRow(["S.No", "Supplier", "Product", "Batch No", "Expiry Date", "Quantity", "Expiry Status"]);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F75B5" } };
      cell.border = THIN_BORDER;
    });
    worksheet.views = [{ state: "frozen", ySplit: 3 }];

    let serial = 1;

    stocks.forEach((stock) => {
      stock.Batches.forEach((batch) => {
        let expiryStatus = "Valid";
        let expiryDisplay = "-";

        if (batch.ExpiryDate) {
          const parts = batch.ExpiryDate.split("-");              // DD-MM-YYYY
          if (parts.length === 3) {
            const expiryDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
            expiryDisplay = batch.ExpiryDate;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const threeMonthsLater = new Date(today);
            threeMonthsLater.setMonth(today.getMonth() + 3);

            if (expiryDate < today) expiryStatus = "Expired";
            else if (expiryDate <= threeMonthsLater) expiryStatus = "Expiring Soon";
          }
        }

        const row = worksheet.addRow([serial++, stock.SupplierName, stock.ProductName, batch.BatchNumber,
                                      expiryDisplay, Number(batch.Quantity) || 0, expiryStatus]);

        row.getCell(1).alignment = { horizontal: "center" };
        row.getCell(4).alignment = { horizontal: "center" };
        row.getCell(5).alignment = { horizontal: "center" };
        row.getCell(6).alignment = { horizontal: "right" };
        row.getCell(7).alignment = { horizontal: "center" };
        row.getCell(6).numFmt = "#,##0";

        if (expiryStatus === "Expired") row.getCell(7).font = { bold: true, color: { argb: "FFFF0000" } };
        else if (expiryStatus === "Expiring Soon") row.getCell(7).font = { bold: true, color: { argb: "FFFFA500" } };
        else row.getCell(7).font = { color: { argb: "FF008000" } };

        row.eachCell((cell) => { cell.border = THIN_BORDER; });
      });

      const totalRow = worksheet.addRow(["", "", `${stock.ProductName} Total`, "", "", stock.TotalQuantity, ""]);
      totalRow.font = { bold: true };
      totalRow.getCell(6).numFmt = "#,##0";
      totalRow.getCell(6).alignment = { horizontal: "right" };
      totalRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        cell.border = THIN_BORDER;
      });
    });

    worksheet.columns = [{ width: 8 }, { width: 25 }, { width: 60 }, { width: 18 }, { width: 15 }, { width: 12 }, { width: 18 }];

    await sendWorkbook(res, workbook, "stock_report.xlsx");
  } catch (error) {
    console.error("Error generating Excel file:", error);
    if (!res.headersSent) renderHomeWithError(res, error);
  }
};

/**
 * Supplier-wise stock / sales report as Excel.
 * CHANGED: streams the file (no temp file in the controllers folder that could clash
 *          between two users); column widths now match the 12 columns.
 */
const downloadSalesReportInExcel = async (req, res) => {
  try {
    const FromDate = req.body?.FromDate || moment().format("DD-MM-YYYY");
    const ToDate = req.body?.ToDate || moment().format("DD-MM-YYYY");
    const supplierId = req.body?.Supplier || null;

    const salesData = await Billing.getSalesReportSupplierWise(FromDate, ToDate, supplierId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sales Report");

    worksheet.mergeCells("A1:L1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Sales Report as on From ${FromDate} To ${ToDate}`;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: "center" };
    worksheet.getRow(1).height = 20;
    worksheet.addRow([]);

    const headerRow = worksheet.addRow([
      "Serial No", "Supplier Name", "Product Name", "ExpDate", "Batch Number", "Opening Quantity", "Quantity Sold",
      "Remaining Quantity", "Price/Unit", "Remaining Stock Price", "Expiry Status", "Added On",
    ]);
    headerRow.font = { size: 12, bold: true };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    [10, 30, 50, 20, 20, 18, 18, 20, 15, 22, 20, 18].forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });

    salesData.forEach((product, index) => {
      const expDate = product.ExpiryDate ? moment(product.ExpiryDate, "DD MMM YYYY") : null;
      const createdAt = product.CreatedAt ? moment(product.CreatedAt) : null;
      const today = moment();
      const threeMonthsFromNow = moment().add(3, "months");

      let expiryStatus = "Valid";
      let style = null;

      if (expDate && expDate.isValid()) {
        if (expDate.isBefore(today, "day")) {
          expiryStatus = "Expired";
          style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF800000" } }, font: { color: { argb: "FFFFFFFF" }, bold: true } };
        } else if (expDate.isBetween(today, threeMonthsFromNow, null, "[]")) {
          expiryStatus = "Expiring Soon";
          style = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } }, font: { color: { argb: "FFFFFFFF" }, bold: true } };
        }
      }

      const dataRow = worksheet.addRow([
        index + 1, product.SupplierName, product.ProductName,
        expDate && expDate.isValid() ? expDate.format("DD-MMM-YYYY") : "",
        product.BatchNumber, Number(product.OpeningQuantity), Number(product.QuantitySold),
        Number(product.RemainingQuantity), Number(product.PurchasePrice), Number(product.RemainingStockTotalPrice),
        expiryStatus, createdAt ? createdAt.format("DD-MMM-YYYY") : "",
      ]);
      dataRow.alignment = { horizontal: "left", vertical: "middle" };

      if (style) {
        [4, 11].forEach((c) => { dataRow.getCell(c).fill = style.fill; dataRow.getCell(c).font = style.font; });
      }
    });

    await sendWorkbook(res, workbook, "sales_report.xlsx");
  } catch (error) {
    console.error("Error generating sales report:", error.message);
    if (!res.headersSent) res.status(500).send("Error generating sales report");
  }
};

const getSalesReportSupplierWisePage = async (req, res) => {
  try {
    const suppliers = await Billing.getSuppliersList();
    const FromDate = moment().format("DD-MM-YYYY");
    const ToDate = moment().format("DD-MM-YYYY");
    const salesReports = await Billing.getSalesReportSupplierWise(FromDate, ToDate);
    res.render("supplierWiseSalesReport", { suppliers, moment, salesReports, FromDate, ToDate, title: "Supplier Sales Report ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

/** FIX: the catch block was empty (the page hung on error). */
const salesReportSupplierWise = async (req, res) => {
  try {
    const FromDate = req.body?.FromDate || moment().format("DD-MM-YYYY");
    const ToDate = req.body?.ToDate || moment().format("DD-MM-YYYY");
    const action = req.body.action;
    const Supplier = req.body.Supplier;

    if (action === "download") return await downloadSalesReportInExcel(req, res);

    const suppliers = await Billing.getSuppliersList();
    const salesReports = await Billing.getSalesReportSupplierWise(FromDate, ToDate, Supplier);
    res.render("supplierWiseSalesReport", { suppliers, Supplier, salesReports, moment, FromDate, ToDate, title: "Supplier Sales Report ", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

// 400 days -> "1 year 1 month 5 days"
const humanAge = (days) => {
  const d = Math.max(0, Number(days) || 0);
  const years = Math.floor(d / 365);
  const months = Math.floor((d % 365) / 30);
  const rest = (d % 365) % 30;
  const parts = [];
  if (years) parts.push(`${years} year${years > 1 ? "s" : ""}`);
  if (months) parts.push(`${months} month${months > 1 ? "s" : ""}`);
  if (rest || !parts.length) parts.push(`${rest} day${rest === 1 ? "" : "s"}`);
  return parts.join(" ");
};

/**
 * Non-moving / expiring stock page and Excel (?download=true).
 * FIX: the excel read BatchQuantity / MovementAge / MovementAgeText which the query never
 *      returned (those columns were empty). They are derived from the model data now.
 */
const getNonMovableStocks = async (req, res) => {
  try {
    const supplierId = req.query.supplierId || null;
    const download = req.query.download === "true";
    const search = (req.query.search || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = getPageSize();

    const [suppliers, stocksResult, summary] = await Promise.all([
      Billing.getSuppliersList(),
      Billing.getNonMovableStocks(supplierId, search, page, pageSize),
      Billing.getNonMovableSummary(supplierId, search),
    ]);

    const totalPages = Math.max(1, Math.ceil((summary.totalCount || 0) / pageSize));

    if (download) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Non Movable Stock");

      sheet.addRow([
        "Supplier", "Product", "Batch", "Stock Qty", "Sold Qty", "Current Stock", "Expiry Date", "Last Sale Date",
        "Movement Age (Days)", "Movement Age (Y-M-D)", "Status", "Purchase Price", "Value At Cost",
      ]);

      stocksResult.forEach((row) => {
        sheet.addRow([
          row.SupplierName, row.ProductName, row.BatchNumber,
          Number(row.BatchQuantity ?? 0), Number(row.QuantitySold ?? 0), Number(row.CurrentStock ?? 0),
          row.ExpiryDate ? new Date(row.ExpiryDate) : null, row.LastSaleDate ? new Date(row.LastSaleDate) : null,
          Number(row.MovementAgeDays ?? 0), humanAge(row.MovementAgeDays),
          row.StatusFlag, Number(row.PurchasePrice ?? 0), Number(row.ValueAtCost ?? 0),
        ]);
      });

      [4, 5, 6, 12, 13].forEach((c) => { sheet.getColumn(c).numFmt = "#,##0.00"; });
      sheet.getColumn(9).numFmt = "0";
      sheet.getRow(1).font = { bold: true };
      [20, 30, 15, 12, 12, 15, 15, 15, 18, 22, 12, 15, 18].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const status = row.getCell(11).value;
        let color = null;
        if (status === "EXPIRED") color = "FFFF6B6B";
        if (status === "EXPIRING_SOON") color = "FFFFD966";
        if (status === "NON_MOVING") color = "FFD9D9D9";
        if (color) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; });
      });

      const summarySheet = workbook.addWorksheet("Supplier Summary");
      summarySheet.addRow(["Supplier", "Total Current Stock", "Total Value At Cost"]);
      summarySheet.getRow(1).font = { bold: true };

      const supplierMap = new Map();
      stocksResult.forEach((row) => {
        const key = row.SupplierName || "Unknown";
        if (!supplierMap.has(key)) supplierMap.set(key, { totalStock: 0, totalValue: 0 });
        const agg = supplierMap.get(key);
        agg.totalStock += Number(row.CurrentStock || 0);
        agg.totalValue += Number(row.ValueAtCost || 0);
      });
      supplierMap.forEach((agg, name) => summarySheet.addRow([name, agg.totalStock, agg.totalValue]));

      summarySheet.getColumn(1).width = 25;
      summarySheet.getColumn(2).width = 18;
      summarySheet.getColumn(3).width = 20;
      summarySheet.getColumn(2).numFmt = "#,##0.00";
      summarySheet.getColumn(3).numFmt = "#,##0.00";

      return await sendWorkbook(res, workbook, "NonMovingStock.xlsx");
    }

    return res.render("nonMovableDefaultPage", {
      suppliers, stocks: stocksResult, selectedSupplierId: supplierId, search, page, totalPages, summary,
      title: "Non Movable Stocks", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    console.error("Error in getNonMovableStocks:", error);
    return renderHomeWithError(res, error);
  }
};

/** GST sales report (invoice-wise) as Excel. FIX: number format was set on the label cell of the totals. */
const downloadSalesReportForGstInExcel = async (req, res) => {
  try {
    const salesReports = await Billing.getSalesReport(req);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("GST Sales Report");
    let currentRow = 1;

    const mergedTitle = (text, font) => {
      sheet.mergeCells(`A${currentRow}:I${currentRow}`);
      sheet.getCell(`A${currentRow}`).value = text;
      sheet.getCell(`A${currentRow}`).font = font;
      sheet.getCell(`A${currentRow}`).alignment = { horizontal: "center" };
      currentRow++;
    };

    mergedTitle(getCompanyDetails().coreCompany || "Ranjana Imaging And Medical Solutions", { size: 16, bold: true });
    mergedTitle("GST Sales Report", { size: 14, bold: true });
    mergedTitle(`Report Period: ${req.body?.FromDate || req.query?.FromDate || ""} to ${req.body?.ToDate || req.query?.ToDate || ""}`, {});
    currentRow += 1;

    let grandSubTotal = 0, grandCgst = 0, grandSgst = 0, grandTotal = 0;

    salesReports.forEach((invoice) => {
      sheet.mergeCells(`A${currentRow}:I${currentRow}`);
      sheet.getCell(`A${currentRow}`).value =
        `Invoice: ${invoice.InvoiceId} | Customer: ${invoice.CustomerName} | GST: ${invoice.GstNo || "-"} | Date: ${invoice.CreatedAt}`;
      sheet.getCell(`A${currentRow}`).font = { bold: true };
      currentRow += 2;

      const headerRow = sheet.addRow([
        "S.No", "Product Name", "Qty", "Taxable Value (₹)", "CGST %", "CGST Amt (₹)", "SGST %", "SGST Amt (₹)",
        "Total Value (₹)", "Total Value With Tax (₹)",
      ]);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center" };
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
        cell.border = THIN_BORDER;
      });
      currentRow++;

      invoice.Products.forEach((product, i) => {
        const taxableValue = parseFloat(product.TotalValue) || 0;
        const row = sheet.addRow([
          i + 1, product.ProductName, product.QuantitySold, taxableValue,
          parseFloat(product.Cgst) || 0, parseFloat(product.CgstAmount) || 0,
          parseFloat(product.Sgst) || 0, parseFloat(product.SgstAmount) || 0,
          taxableValue, parseFloat(product.TotalValueWithTax) || 0,
        ]);
        [4, 6, 8, 9, 10].forEach((c) => { row.getCell(c).numFmt = "#,##0.00"; });
        row.eachCell((cell) => { cell.border = THIN_BORDER; });
        currentRow++;
      });

      currentRow++;

      [["SubTotal", invoice.SubTotal], ["Total CGST", invoice.TotalCgst], ["Total SGST", invoice.TotalSgst], ["Grand Total", invoice.GrandTotal]].forEach((t) => {
        const row = sheet.addRow(["", "", "", "", "", "", "", "", t[0], t[1]]);
        row.font = { bold: true };
        row.getCell(10).numFmt = "#,##0.00";
        currentRow++;
      });

      currentRow += 2;
      grandSubTotal += invoice.SubTotal; grandCgst += invoice.TotalCgst;
      grandSgst += invoice.TotalSgst; grandTotal += invoice.GrandTotal;
    });

    mergedTitle("OVERALL GST SUMMARY", { size: 13, bold: true });
    currentRow += 1;

    [["Total Taxable Value", grandSubTotal], ["Total CGST", grandCgst], ["Total SGST", grandSgst], ["Overall Grand Total", grandTotal]].forEach((s) => {
      const row = sheet.addRow(["", "", "", "", "", "", "", s[0], s[1]]);
      row.font = { bold: true };
      row.getCell(9).numFmt = "#,##0.00";
      currentRow++;
    });

    sheet.columns = [{ width: 6 }, { width: 35 }, { width: 8 }, { width: 15 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 18 }, { width: 30 }];

    await sendWorkbook(res, workbook, "GST_Sales_Report.xlsx");
  } catch (error) {
    console.error("GST Sales Excel Export Error:", error);
    if (!res.headersSent) res.status(500).send("Failed to generate GST sales Excel report");
  }
};


/* =====================================================================
 * 10. EXPIRED STOCK AND SUPPLIER SETTLEMENT
 * ===================================================================== */

const getDetailsOfExpiredProduct = async (req, res) => {
  const notifications = [];
  try {
    const expiredProductDetails = await Billing.getExpiredProductDetails(req);
    const suppliers = await Billing.getSuppliersList();
    const products = await Billing.getProductList();

    const flashMessages = req.flash("message");
    const message = flashMessages.length ? flashMessages[0] : null;
    if (message) notifications.push(createNotification(message.type, message.msg, message.icon));

    res.render("Billing/moveExpiredProduct", {
      expiredStock: expiredProductDetails.data, suppliers, products,
      pagination: {
        currentPage: expiredProductDetails.currentPage, totalPages: expiredProductDetails.totalPages,
        totalRecords: expiredProductDetails.totalRecords, pageSize: expiredProductDetails.pageSize,
      },
      filters: { supplierId: req.query.supplierId || "", productId: req.query.productId || "" },
      title: "Expired product", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout", notifications,
    });
  } catch (error) {
    return renderHomeWithError(res, error);
  }
};

/**
 * Moves selected expired stock into ExpiredStock.
 * FIX: the error branch called req.flash(error.message, {...}) (arguments swapped, so the
 *      error text became the flash KEY) and a stray `console.lo` statement sat before the redirect.
 */
const moveExpiredProduct = async (req, res) => {
  const { page, supplierId, productId } = req.body;
  const query = new URLSearchParams({ page: page || 1, supplierId: supplierId || "", productId: productId || "" }).toString();

  try {
    const result = await Billing.moveExpiredProduct(req.body.stockIds, req.user.Id);
    req.flash("message", { type: "success", msg: result, icon: "bi-check-circle" });
  } catch (error) {
    console.error(error);
    req.flash("message", { type: "danger", msg: error.message || "Some error occurred while moving expired stock.", icon: "bi-exclamation-triangle" });
  }
  return res.redirect(`/billing/moveExpiredProduct?${query}`);
};

/** FIX: console.log(expiredList[0].SupplierId) crashed the page when the list was empty. */
const getListOfMovedExpiredProduct = async (req, res) => {
  try {
    const supplierId = req.body.supplierId || "";
    const status = req.body.status || "";
    const page = parseInt(req.query.page) || 1;
    const limit = getPageSize();
    const offset = (page - 1) * limit;

    const result = await Billing.getListOfMovedExpiredProduct({ supplierId, status, limit, offset });
    const totalRecords = result.total;
    const totalPages = Math.ceil(totalRecords / limit);
    const suppliers = await Billing.getSuppliersList();

    return res.render("Billing/viewMovedExpiredProduct", {
      expiredList: result.rows, suppliers, filters: { supplierId, status },
      title: "List of Expired Stocks", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
      pagination: { currentPage: page, totalPages, totalRecords, limit },
    });
  } catch (error) {
    console.error("Error in getListOfMovedExpiredProduct:", error);
    return renderHomeWithError(res, error, "");
  }
};

const searchSupplierInvoice = async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
    const supplierId = req.query.supplierId;

    if (!supplierId) return res.status(400).json({ success: false, message: "No SupplierId found." });
    if (!keyword || keyword.length <= 3)
      return res.status(400).json({ success: false, message: "No Keyword found or Keyword is less or equal to 3 word." });

    const invoices = await Billing.searchSupplierInvoice({ keyword, supplierId });
    return res.json(invoices);
  } catch (error) {
    console.error("Invoice search error:", error);
    return res.status(500).json([]);
  }
};

const getInvoiceProducts = async (req, res) => {
  try {
    const invoiceId = req.query.invoiceId;
    if (!invoiceId) return res.json([]);
    return res.json(await Billing.getInvoiceProducts(invoiceId));
  } catch (error) {
    console.error("Invoice products fetch error:", error);
    return res.status(500).json([]);
  }
};

const getLastThreePricesBulk = async (req, res) => {
  try {
    const { productIds, supplierId } = req.query;
    if (!productIds || !supplierId) return res.json({});

    const idsArray = productIds.split(",").map((id) => parseInt(id));
    return res.json(await Billing.getLastThreePricesBulk(idsArray, supplierId));
  } catch (error) {
    console.error("Error getLastThreePricesBulk:", error);
    return res.status(500).json([]);
  }
};

/**
 * The settlement page of an expiry return (with the GST revision data and any messages).
 * CHANGED: `values` = what was typed (shown again after an error), `recentInvoices` = suggestions for the Invoice Ref No.
 */
const renderSettlementPage = async (res, expReturnId, notifications = [], values = {}) => {
  const { rows, header, expiryReturnId, computedStatus, outcome, creditNotes } = await Billing.getMovedSupplierProductFromReturnNumber(expReturnId);
  if (!header) throw new Error("Settlement not found.");
  const gstRevision = await Billing.getDebitNoteForGstRevision(expReturnId);
  const actions = await Billing.getReturnActions(expReturnId);
  const recentInvoices = await Billing.getSupplierRecentInvoiceNos(header.SupplierId);

  res.render("Billing/viewMovedExpiredProductSettlement", {
    expiryItems: rows, expReturnId: expiryReturnId, computedStatus, outcome, creditNotes, header, gstRevision, actions, notifications,
    values: values || {}, recentInvoices, today: moment().format("YYYY-MM-DD"),
    // NEW: what the page showed (a stale page cannot save) + a one-time code (a double click saves once)
    pageVersion: await Billing.settlementVersion(require("../config/DBConnection").pool.promise(), expiryReturnId),
    submitToken: crypto.randomUUID(),
    title: "view moved expired product for settlement", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
  });
};

/** "2 credit notes saved: CN/1 (Rs 1,200.00), CN/2 (Rs 300.00)" */
const creditNoteMessage = (list) => {
  const money = (v) => Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!list || !list.length) return "";
  return `${list.length} credit note${list.length > 1 ? "s" : ""} saved: ${list.map((c) => `${c.reference} (Rs ${money(c.total)}, ${c.lines} product${c.lines > 1 ? "s" : ""})`).join(", ")}.`;
};

/** The "send expired stock to supplier" page. */
const renderSendToSupplierPage = async (res, supplierId, status = "", notifications = []) => {
  const expiredProductDetails = await Billing.expiredProductPageForMoveToSupplier(supplierId, status);
  return res.render("Billing/moveExpiredProductToSupplier", {
    expiredList: expiredProductDetails || [], supplierId, status, notifications,
    title: "Expired Product Send To Supplier", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
  });
};

/** Price-reduction settlement of an expired batch (JSON api). */
const expiredStockSettle = async (req, res) => {
  try {
    const { expiredId, settlements } = req.body;
    if (!expiredId || !settlements || !settlements.length) return res.status(400).json({ message: "Invalid request data" });

    await Billing.settleExpiredStock({ expiredId, settlements, userId: req.user.Id });
    return res.json({ message: "Settlement successful" });
  } catch (error) {
    console.error("Settlement error:", error);
    return res.status(500).json({ message: "Settlement failed" });
  }
};

const checkInvoiceCredit = async (req, res) => {
  try {
    const { invoiceId } = req.query;
    if (!invoiceId) return res.status(400).json({ success: false, message: "Invoice ID is required" });

    const credit = await Billing.getInvoiceCredit(invoiceId);
    return res.status(200).json({ success: true, data: credit });
  } catch (err) {
    console.error("Error in checkInvoiceCredit:", err);
    return res.status(500).json({ success: false, message: "Error fetching invoice credit" });
  }
};

/** FIX: a single selected row arrives as a string -> expiredIds.map crashed. */
/**
 * Makes the return + debit note. Each selected row sends  sendQty_<id>  and  gst_<id>  (GST % of that line;
 * blank = the batch's own GST %). On an error the SAME page is shown again with the message (nothing was saved).
 * FIX: a single selected row arrives as a string -> expiredIds.map crashed.
 */
const sendExpiredToSupplier = async (req, res) => {
  const supplierId = req.body.supplierId;
  try {
    const expiredIds = toArray(req.body.expiredIds);
    if (!expiredIds.length) throw new Error("Select at least one product to send.");

    const items = expiredIds.map((id) => ({
      expiredStockId: id, expiredId: id, quantity: req.body[`sendQty_${id}`], gstPercent: req.body[`gst_${id}`],
    }));

    const { expReturnId, duplicate } = await Billing.sendExpiredToSupplier({ supplierId, items, userId: req.user.Id });
    return await renderSettlementPage(res, expReturnId, [
      duplicate
        ? createNotification("info", "This debit note was created a moment ago (the form was sent twice) - no second one was made.", "bi-info-circle-fill")
        : createNotification("success", "Debit note created. It is waiting for the supplier's approval.", "bi-check-circle-fill"),
    ]);
  } catch (error) {
    console.error(error);
    try {
      return await renderSendToSupplierPage(res, supplierId, "", [
        createNotification("danger", `${error.message || "Could not create the debit note."} Nothing was saved.`, "bi-exclamation-triangle-fill"),
      ]);
    } catch (inner) {
      return renderHomeWithError(res, error, "Some error occurred. Please retry get suplier list 3.");
    }
  }
};

const moveExpiredProductToSupplier = async (req, res) => {
  try {
    const supplierId = req.params.supplierId;
    const status = req.params.status;

    if (!supplierId) throw new Error("SupplierId is missing.");
    if (!status) throw new Error("Status is missing.");

    return await renderSendToSupplierPage(res, supplierId, status);
  } catch (error) {
    console.error("Move Expired Product Error:", error);
    return renderHomeWithError(res, error);
  }
};

const supplierDebitNotRegister = async (req, res) => {
  try {
    const { fromDate, toDate, supplierId } = req.body;
    const rows = await Billing.getSupplierDebitNoteRegister({ fromDate, toDate, supplierId });
    const suppliers = await Billing.getSuppliersList();

    res.render("Billing/supplierDebitNoteRegister", {
      rows, suppliers, fromDate, toDate, supplierId, title: "supplier debit note",
      BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error);
  }
};

const supplierDebitNotRegisterInHtml = async (req, res) => {
  try {
    const expiryReturnId = req.params.expiryReturnId;
    if (!expiryReturnId) throw new Error("Some important parameter is missing.");

    const debitNoteData = await Billing.getSupplierDebitNoteRegisterInHtml(expiryReturnId);
    if (!debitNoteData) throw new Error("Debit Note not found.");

    const templatePath = path.join(__dirname, "../views/Billing/individualSupplierReturnDN.ejs");
    const htmlContent = await ejs.renderFile(templatePath, {
      companyDetails: getCompanyDetails(), imageBase64: getLogoBase64("png"),
      header: debitNoteData.header, items: debitNoteData.items, summary: debitNoteData.summary,
    });
    return res.send(htmlContent);
  } catch (error) {
    console.error("Supplier Debit Note Error:", error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

const getViewForExpProductSuppSettlement = async (req, res) => {
  try {
    const expReturnId = req.params.expReturnId || "";
    if (!expReturnId) throw new Error("Expiry return Id is missing.");

    await renderSettlementPage(res, expReturnId);
  } catch (error) {
    return renderHomeWithError(res, error, "Some error occurred. Please retry get list.");
  }
};

/**
 * Save Settlement.
 * CHANGED: comes back to the settlement page with the credit notes that were saved (it used to open a separate
 *          page from which the settlement could not be found again). On an error the same page is shown with the
 *          message and everything that was typed - nothing is saved.
 */
const settleExpiryWithSupplier = async (req, res) => {
  const expiryReturnId = req.body.expReturnId;
  try {
    if (!expiryReturnId) throw new Error("ExpiryReturnId must be missing.");

    const result = await Billing.settleSupplierReturn(req.body, req.user.Id);
    let msg = creditNoteMessage(result && result.creditNotes) || "Nothing to settle: enter the Accept Qty of at least one product.";
    if (result && result.duplicate) msg = "Already saved (the page was sent twice) - nothing was saved again. " + msg;
    return await renderSettlementPage(res, expiryReturnId, [
      createNotification(result && result.creditNotes && result.creditNotes.length ? "success" : "warning", msg,
        result && result.creditNotes && result.creditNotes.length ? "bi-check-circle-fill" : "bi-info-circle-fill"),
    ]);
  } catch (error) {
    if (!error.isUserError) console.error(error);
    try {
      return await renderSettlementPage(res, expiryReturnId, [
        createNotification("danger", `${error.message || "Could not save the settlement."} Nothing was saved.`, "bi-exclamation-triangle-fill"),
      ], req.body);
    } catch (inner) {
      return renderHomeWithError(res, error);
    }
  }
};

const supplierExpSettlementLedger = async (req, res) => {
  try {
    const supplierId = req.query.supplierId || "";
    const fromDate = req.query.fromDate || "";
    const toDate = req.query.toDate || "";
    if (!supplierId) throw new Error("Supplier required");

    const ledger = await Billing.supplierExpSettlementLedger(supplierId, fromDate, toDate);

    res.render("Billing/supplierExpSettlementLedger", {
      ledger, supplierId, fromDate, toDate, BRAND_NAME: process.env.BRAND_NAME, title: "Supplier Ledger", layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error);
  }
};

/** FIX: the catch block re-threw inside an async express handler -> the request hung. */
/** FIX: the catch block re-threw inside an async express handler -> the request hung. */
const finalizeExpiry = async (req, res) => {
  const expReturnId = req.body.expReturnId;
  try {
    // the Accept Qty boxes / credit note number on the page are part of this request: they are settled first, the rest is written off
    const r = await Billing.finalizeExpiryReturn(expReturnId, req.user.Id, req.body);
    const money = (v) => Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const parts = [];
    if (r && r.settledNow > 0) parts.push(`Rs ${money(r.settledNow)} settled by credit note`);
    if (r && r.creditNotes && r.creditNotes.length) parts.push(creditNoteMessage(r.creditNotes).replace(/\.$/, ""));
    if (r && r.writeOffTotal > 0) parts.push(`${r.writeOffQty} unit(s) / Rs ${money(r.writeOffTotal)} not approved and written off`);
    await renderSettlementPage(res, expReturnId, [
      createNotification("success", `Settlement finalised.${parts.length ? " " + parts.join("; ") + "." : ""}`, "bi-check-circle-fill"),
    ]);
  } catch (error) {
    if (!error.isUserError) console.error(error);
    try {
      if (error.alreadyDone) return await renderSettlementPage(res, expReturnId, [createNotification("info", error.message, "bi-info-circle-fill")]);
      await renderSettlementPage(res, expReturnId, [createNotification("danger", `${error.message || "Could not finalise."} Nothing was saved.`, "bi-exclamation-triangle-fill")], req.body);
    } catch (inner) {
      renderHomeWithError(res, error);
    }
  }
};


/* =====================================================================
 * 11. PAYMENT CORRECTION, PAYMENT RECEIVABLE, PROFIT AND LOSS
 * ===================================================================== */

/** FIX: the success message flashed by delete / transfer was never read (nothing was shown). */
const getPaymentCorrectionPage = async (req, res) => {
  try {
    const customers = await Billing.getCustomerList();
    const customerId = req.query.customerId || "";
    const fromDate = req.query.fromDate || moment().subtract(30, "days").format("DD-MM-YYYY");
    const toDate = req.query.toDate || moment().format("DD-MM-YYYY");

    const notifications = [];
    req.flash("message").forEach((m) => {
      try {
        const msg = typeof m === "string" ? JSON.parse(m) : m;
        notifications.push(createNotification(msg.type, msg.msg, msg.icon));
      } catch (_) { /* ignore unreadable flash */ }
    });

    let payments = [];
    if (customerId) payments = await Billing.getCustomerPayments(customerId, fromDate, toDate);

    res.render("Billing/paymentCorrection", {
      customers, payments, customerId, fromDate, toDate, notifications,
      title: "Payment Correction", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

const deletePayment = async (req, res) => {
  try {
    const { paymentId, customerId, fromDate, toDate } = req.body;
    if (!paymentId) throw new Error("Payment ID is required.");

    const result = await Billing.deletePayment(paymentId, req.user.Id);

    req.flash("message", JSON.stringify({ type: "success", msg: result.message, icon: "bi-check-circle-fill" }));
    res.redirect(`/billing/paymentCorrection?customerId=${customerId}&fromDate=${fromDate}&toDate=${toDate}`);
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

const transferPayment = async (req, res) => {
  try {
    const { paymentId, toCustomerId, fromCustomerId, fromDate, toDate } = req.body;
    if (!paymentId) throw new Error("Payment ID is required.");
    if (!toCustomerId) throw new Error("Please select the correct customer.");

    const result = await Billing.transferPayment({ paymentId, toCustomerId, userId: req.user.Id });

    req.flash("message", JSON.stringify({ type: "success", msg: result.message, icon: "bi-check-circle-fill" }));
    res.redirect(`/billing/paymentCorrection?customerId=${fromCustomerId}&fromDate=${fromDate}&toDate=${toDate}`);
  } catch (error) {
    renderHomeWithError(res, error);
  }
};

// GET (query string) and POST (body) share one implementation
const renderPaymentReceivable = async (source, res, errorText) => {
  try {
    const customers = await Billing.getCustomerList();
    const paymentTypes = await Billing.getDistinctPaymentTypes();

    const customerId = source.customerId || "";
    const paymentType = source.paymentType || "";
    const fromDate = source.fromDate || moment().startOf("month").format("DD-MM-YYYY");
    const toDate = source.toDate || moment().format("DD-MM-YYYY");

    const { rows: payments, totalAmount, typeWiseBreakup } = await Billing.getPaymentsReceivable(fromDate, toDate, customerId, paymentType);

    res.render("Billing/paymentReceivable", {
      customers, paymentTypes, payments, totalAmount, typeWiseBreakup, customerId, paymentType, fromDate, toDate,
      title: "Payment Receivable", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, errorText);
  }
};

const getPaymentReceivablePage = (req, res) =>
  renderPaymentReceivable(req.query, res, "Some error occurred while fetching payment receivable list.");

const searchPaymentReceivable = (req, res) =>
  renderPaymentReceivable(req.body, res, "Some error occurred while searching payment receivable.");

// profit & loss pages
const renderProfitLoss = async (source, res, errorText) => {
  try {
    const [suppliers, products, customers] = await Promise.all([
      Billing.getSuppliersList(), Billing.getProductList(), Billing.getCustomerList(),
    ]);

    const supplierId = source.supplierId || "";
    const productId = source.productId || "";
    const customerId = source.customerId || "";
    const fromDate = source.fromDate || moment().startOf("month").format("DD-MM-YYYY");
    const toDate = source.toDate || moment().format("DD-MM-YYYY");

    const { rows, summary, writeOffs } = await Billing.getProfitLossReport(fromDate, toDate, { supplierId, productId, customerId });

    res.render("Billing/profitLossReport", {
      suppliers, products, customers, rows, summary, writeOffs, supplierId, productId, customerId, fromDate, toDate,
      title: "Profit & Loss Report", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, errorText);
  }
};

const getProfitLossPage = (req, res) => renderProfitLoss(req.query, res, "Some error occurred while generating profit & loss report.");
const searchProfitLoss = (req, res) => renderProfitLoss(req.body, res, "Some error occurred while searching profit & loss report.");

const renderInvoiceWiseProfitLoss = async (source, res, errorText) => {
  try {
    const [customers, suppliers] = await Promise.all([Billing.getCustomerList(), Billing.getSuppliersList()]);

    const customerId = source.customerId || "";
    const supplierId = source.supplierId || "";
    const invoiceId = source.invoiceId || "";
    const fromDate = source.fromDate || moment().startOf("month").format("DD-MM-YYYY");
    const toDate = source.toDate || moment().format("DD-MM-YYYY");

    const { invoices, summary } = await Billing.getInvoiceWiseProfitLoss(fromDate, toDate, { customerId, supplierId, invoiceId });

    res.render("Billing/invoiceWiseProfitLoss", {
      customers, suppliers, invoices, summary, customerId, supplierId, invoiceId, fromDate, toDate,
      title: "Invoice-wise Profit & Loss", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
    });
  } catch (error) {
    return renderHomeWithError(res, error, errorText);
  }
};

const getInvoiceWiseProfitLossPage = (req, res) =>
  renderInvoiceWiseProfitLoss(req.query, res, "Some error occurred while generating invoice-wise profit & loss report.");
const searchInvoiceWiseProfitLoss = (req, res) =>
  renderInvoiceWiseProfitLoss(req.body, res, "Some error occurred while searching invoice-wise profit & loss report.");


/* =====================================================================
 * 12. PRODUCT / BATCH TRACE  (NEW)
 *   GET /billing/productTrace            page: supplier -> product -> optional batch
 *   GET /billing/productTrace/batches    JSON batch suggestions for a product
 * ===================================================================== */

/**
 * Shows when a product (or one batch) was bought, at what price, and to whom it was sold,
 * at what price, with the price difference.
 * Uses GET so a result can be bookmarked / shared:  ?supplierId=1&productId=14&batch=JD26186
 * A link that has only ?productId=.. still opens with the right supplier selected.
 */
const getProductTracePage = async (req, res) => {
  const notifications = [];
  let suppliers = [];
  let products = [];
  let trace = null;

  let supplierId = String(req.query.supplierId || "");
  const productId = String(req.query.productId || "");
  const batch = String(req.query.batch || "").trim();

  try {
    [suppliers, products] = await Promise.all([Billing.getSuppliersList(), Billing.getProductList()]);

    if (productId && !supplierId) {
      const found = products.find((p) => String(p.Id) === productId);
      if (found) supplierId = String(found.SupplierId);
    }

    if (productId) {
      trace = await Billing.getProductTrace({ productId, supplierId, batch });
    } else if (req.query.supplierId || batch) {
      notifications.push(createNotification("warning", "Select a product to see its history.", "bi-info-circle-fill"));
    }
  } catch (error) {
    console.error("Product trace error:", error);
    trace = null;
    notifications.push(createNotification("danger", error.message || "Could not load the product history.", "bi-exclamation-triangle-fill"));
  }

  res.render("Billing/productTrace", {
    suppliers, products, supplierId, productId, batch, trace, moment, notifications,
    title: "Product / Batch History", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout",
  });
};

/** Batch suggestions for the batch box: [{ batch, expiry, quantity }] */
const getProductBatches = async (req, res) => {
  try {
    const productId = Number(req.query.productId);
    if (!productId) return res.json([]);

    const rows = await Billing.getProductBatches(productId);
    return res.json(rows.map((r) => ({
      batch: r.BatchNumber,
      expiry: r.ExpiryDate ? moment(r.ExpiryDate).format("DD-MM-YYYY") : "",
      quantity: Number(r.Quantity) || 0,
    })));
  } catch (error) {
    console.error("getProductBatches error:", error);
    return res.status(500).json([]);
  }
};


/* =====================================================================
 * 13. REVISE THE GST OF A DEBIT NOTE THAT IS WAITING FOR APPROVAL  (NEW)
 *   POST /billing/reviseDebitNoteGst/:expReturnId
 * The form is the "Revise GST" window on the settlement page (viewMovedExpiredProductSettlement.ejs); it sends
 *   gst_<lineId>  (new GST % per line), reason, applyToRemaining.
 * The settlement page is shown again, with the result message.
 * ===================================================================== */
const reviseDebitNoteGst = async (req, res) => {
  const expReturnId = req.params.expReturnId;
  try {
    const changes = [];
    for (const key in req.body) {
      if (key.startsWith("gst_")) changes.push({ itemId: key.slice(4), gstPercent: req.body[key] });
    }

    const result = await Billing.reviseExpiryReturnGst({
      expiryReturnId: expReturnId, changes, reason: req.body.reason, submitToken: req.body.submitToken,
      applyToRemaining: ["1", "on", "true"].includes(String(req.body.applyToRemaining || "")),
      userId: req.user.Id,
    });

    await renderSettlementPage(res, expReturnId, [
      createNotification(result.changed ? "success" : "info", result.message, result.changed ? "bi-check-circle-fill" : "bi-info-circle-fill"),
    ]);
  } catch (error) {
    if (!error.isUserError) console.error("reviseDebitNoteGst error:", error);
    try {
      await renderSettlementPage(res, expReturnId, [
        createNotification("danger", `${error.message || "Could not change the GST."} Nothing was saved.`, "bi-exclamation-triangle-fill"),
      ]);
    } catch (inner) {
      renderHomeWithError(res, error);
    }
  }
};


/* =====================================================================
 * EXPORTS (same names as before - the routes file does not change)
 * ===================================================================== */
/* =====================================================================
 * 14. CANCEL A SETTLEMENT / ADD EXPIRED PRODUCT TO A SETTLEMENT  (NEW)
 *   POST /billing/cancelExpiryReturn/:expReturnId     body: reason
 *   POST /billing/addExpiredToReturn/:expReturnId     body: expiredIds[], qty_<id>, gst_<id>
 * Both are forms inside windows on the settlement page; the page is shown again with the result message.
 * ===================================================================== */
const cancelExpiryReturn = async (req, res) => {
  const expReturnId = req.params.expReturnId;
  try {
    const result = await Billing.cancelExpiryReturn({ expiryReturnId: expReturnId, reason: req.body.reason, userId: req.user.Id, submitToken: req.body.submitToken });
    await renderSettlementPage(res, expReturnId, [createNotification(result.duplicate ? "info" : "success", result.message, result.duplicate ? "bi-info-circle-fill" : "bi-check-circle-fill")]);
  } catch (error) {
    if (!error.isUserError) console.error("cancelExpiryReturn error:", error);
    try {
      await renderSettlementPage(res, expReturnId, [
        createNotification("danger", `${error.message || "Could not cancel the settlement."} Nothing was changed.`, "bi-exclamation-triangle-fill"),
      ]);
    } catch (inner) {
      renderHomeWithError(res, error);
    }
  }
};

const addExpiredToReturn = async (req, res) => {
  const expReturnId = req.params.expReturnId;
  try {
    const ids = toArray(req.body.expiredIds);
    const items = ids.map((id) => ({ expiredStockId: id, quantity: req.body[`qty_${id}`], gstPercent: req.body[`gst_${id}`] }));
    const result = await Billing.addExpiredToReturn({ expiryReturnId: expReturnId, items, userId: req.user.Id, submitToken: req.body.submitToken });
    await renderSettlementPage(res, expReturnId, [createNotification(result.duplicate ? "info" : "success", result.message, result.duplicate ? "bi-info-circle-fill" : "bi-check-circle-fill")]);
  } catch (error) {
    if (!error.isUserError) console.error("addExpiredToReturn error:", error);
    try {
      await renderSettlementPage(res, expReturnId, [
        createNotification("danger", `${error.message || "Could not add the products."} Nothing was saved.`, "bi-exclamation-triangle-fill"),
      ]);
    } catch (inner) {
      renderHomeWithError(res, error);
    }
  }
};

module.exports = {
  getCreateSupplierPage,
  createSupplier,
  getSupplierList,
  getCreateProductPage,
  createProduct,
  getProductList,
  getCreateCustomerPage,
  createCustomer,
  getCustomerList,
  getStockListPage,
  getSalePage,
  addSale,
  getSalesData,
  getAddPaymentPage,
  addPayment,
  getStockHistory,
  getIndividualCustomerLedger,
  getCustomerLedgerInPdf,
  getPurchasePoPage,
  createPurchasePo,
  downloadPurchasePo,
  downloadSales,
  viewPurchasePo,
  viewPurchasePoList,
  viewSales,
  viewSaleThroughSearch,
  customerWiseSales,
  getReceivePurchaseOrderPage,
  generateInvoice,
  invoiceDetails,
  getCustomersLedger,
  downloadLedgerInExcel,
  getProductPrice,
  getupdatePricePageForCustomer,
  setProductPriceForCustomer,
  downloadInvoice,
  getStockDetails,
  editProductDetail,
  getupdateSalesPage,
  updateSales,
  getReturnSalePage,
  salesReturn,
  downloadStockInExcel,
  downloadSalesReportInExcel,
  getSalesReportSupplierWisePage,
  salesReportSupplierWise,
  getStockList,
  editCustomer,
  updateCustomer,
  getSupplierLedger,
  getAddPaymentPageForSupplier,
  addPaymentToSupplier,
  downloadSupplierLedgerInExcel,
  getCreateChallanPage,
  createChallan,
  viewChallan,
  downloadChallanInPdf,
  viewChallans,
  cancelChallan,
  convertToSale,
  delivery,
  getCustomerListWithDues,
  getNonMovableStocks,
  processUploadedPdf,
  downloadSalesReportForGstInExcel,
  viewSalesInHtml,
  getDetailsOfExpiredProduct,
  moveExpiredProduct,
  showIndividualProductPriceHistory,
  getListOfMovedExpiredProduct,
  searchSupplierInvoice,
  getInvoiceProducts,
  getLastThreePricesBulk,
  expiredStockSettle,
  checkInvoiceCredit,
  viewSalesReturn,
  viewIndividualSalesReturnCN,
  sendExpiredToSupplier,
  moveExpiredProductToSupplier,
  supplierDebitNotRegister,
  supplierDebitNotRegisterInHtml,
  getViewForExpProductSuppSettlement,
  settleExpiryWithSupplier,
  supplierExpSettlementLedger,
  finalizeExpiry,
  getPaymentCorrectionPage,
  transferPayment,
  deletePayment,
  getPaymentReceivablePage,
  searchPaymentReceivable,
  getProfitLossPage,
  searchProfitLoss,
  getInvoiceWiseProfitLossPage,
  searchInvoiceWiseProfitLoss,
  viewChallanInHtml,
  getProductTracePage,
  getProductBatches,
  reviseDebitNoteGst,
  cancelExpiryReturn,
  addExpiredToReturn,
};