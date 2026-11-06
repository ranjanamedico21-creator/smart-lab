/* =====================================================================
 * models/Billing.js   -   COMPLETE FILE, ready to paste (replaces the old file)
 *
 * Requires the schema from 01_migration.sql (stock "lots": Stock.PurchasePrice,
 * Stock.MRP, Stock.IgstPercentage and UNIQUE (BatchNumber, ProductId, PurchasePrice)).
 *
 * Conventions used below
 *   // FIX      a bug that existed in the old file
 *   // CHANGED  behaviour that changed on purpose
 *   // NEW      new code
 * Every other function is the old code, only cleaned (dead code and debug
 * console.logs removed). See CHANGES.md for the full list.
 * ===================================================================== */
const helper = require("../helper/helper");
const dbConnection = require("../config/DBConnection");
const moment = require("moment");


/* =====================================================================
 * 0. SHARED HELPERS  (NEW)
 * ===================================================================== */

// A single posted form row arrives as a STRING, several rows as an ARRAY.
const toArray = (v) =>
  Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];

// qs turns arrays with more than 20 rows into an object {0:{},1:{},...}
const toObjectArray = (v) =>
  Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];

// money rounding used everywhere (no 0.1 + 0.2 drift)
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// If true, a lot without its own price falls back to the customer's
// "product default price" (CustomerPricing.StockId IS NULL).
// Put ALLOW_PRODUCT_DEFAULT_PRICE=false in .env to force a price per lot.
const ALLOW_PRODUCT_DEFAULT_PRICE =
  process.env.ALLOW_PRODUCT_DEFAULT_PRICE !== "false";

/**
 * NEW - the ONE place that decides which selling price is used:
 *   1. price saved for THIS lot (CustomerPricing.StockId)      -> "LOT"
 *   2. customer's product default price (StockId IS NULL)      -> "DEFAULT"
 *   3. nothing                                                 -> null (sale blocked)
 * It never looks at the "last sold price".
 */
const resolveCustomerPrice = async (connection, customerId, stockId, productId) => {
  const [[lot]] = await connection.query(
    `SELECT SellingPrice FROM CustomerPricing
      WHERE CustomerId = ? AND StockId = ? AND Status = 1
      ORDER BY UpdatedAt DESC, Id DESC LIMIT 1`,
    [customerId, stockId]
  );
  if (lot) return { price: Number(lot.SellingPrice), source: "LOT" };

  if (ALLOW_PRODUCT_DEFAULT_PRICE && productId) {
    const [[def]] = await connection.query(
      `SELECT SellingPrice FROM CustomerPricing
        WHERE CustomerId = ? AND ProductId = ? AND StockId IS NULL AND Status = 1
        ORDER BY UpdatedAt DESC, Id DESC LIMIT 1`,
      [customerId, productId]
    );
    if (def) return { price: Number(def.SellingPrice), source: "DEFAULT" };
  }
  return null;
};

const formatDate = (invoicePoDate) =>
  invoicePoDate
    ? moment(invoicePoDate, "DD-MM-YYYY").format("YYYY-MM-DD")
    : null;

const productNameCache = new Map();


/* =====================================================================
 * 1. SUPPLIERS / PRODUCTS / CUSTOMERS
 * ===================================================================== */

/** Creates a supplier and its ledger account. FIX: connection was never released. */
const createSupplier = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();
  try {
    const {
      Name, Address, MobileNumber, GstIn, DlNo, CIN, City, State, Pincode, StdCode, LandlineNo,
    } = req.body;

    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO Suppliers (Name, Address, City, State, PinCode, StdCode, LandlineNumber, ContactNo, GstIn, DlNo, Cin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Name ?? null, Address ?? null, City ?? "", State ?? "", Pincode ?? "",
       StdCode ?? "", LandlineNo ?? "", MobileNumber ?? null, GstIn ?? null,
       DlNo ?? "", CIN ?? ""]
    );
    const supplierId = result.insertId;

    await connection.execute(
      `INSERT INTO Accounts (AccountName, AccountType, SupplierId) VALUES (?, 'SUPPLIER', ?)`,
      [`${Name}`, supplierId]
    );

    await connection.commit();
    return `Supplier ${Name} created successfully.`;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/** All suppliers. */
const getSuppliersList = async () => {
  const [rows] = await dbConnection.execute(`SELECT *, Lower(Name) AS Name FROM Suppliers`);
  return rows;
};

/** One supplier (returns rows array, as before). */
const getSupplierDetails = async (supplierId) => {
  const [rows] = await dbConnection.execute(`SELECT * FROM Suppliers WHERE Id = ?`, [supplierId]);
  return rows;
};

/** Creates a product of a supplier. */
const createProduct = async (req) => {
  const { supplier, name, knownAs, hsn } = req.body;

  const [isProductExist] = await dbConnection.execute(
    "SELECT 1 FROM Products WHERE SupplierId = ? AND LOWER(ProductName) = LOWER(?) LIMIT 1",
    [supplier, name]
  );
  if (isProductExist.length > 0) throw new Error("Product already exists.");

  await dbConnection.execute(
    "INSERT INTO Products (SupplierId, ProductName, KnownAs, Hsn) VALUES (?, ?, ?, ?)",
    [supplier, name, knownAs ?? "", hsn ?? null]
  );
  return "Product created successfully.";
};

/** All products with supplier name. */
const getProductList = async () => {
  const [rows] = await dbConnection.execute(
    `SELECT Products.Id, Products.ProductName, Products.Hsn, Products.KnownAs,
            Products.CreatedAt, Suppliers.Name AS SupplierName, Products.SupplierId
       FROM Products
       INNER JOIN Suppliers ON Products.SupplierId = Suppliers.Id`
  );
  return rows;
};

/**
 * Creates a customer + its ledger account + optional "product default" prices
 * (CustomerPricing rows with StockId NULL; a price saved for a specific lot on
 * the pricing page always wins over these).
 * FIX: a single product row arrives as a string -> SupplierId.map crashed.
 * FIX: rows without a price are skipped (empty string crashed the decimal column);
 *      the same product twice in one form keeps the LAST price (unique active key).
 */
const createCustomer = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();
  try {
    await connection.beginTransaction();

    const {
      CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict,
      BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode,
    } = req.body;

    const upperGstNo = GstNo ? GstNo.toUpperCase() : null;
    const upperDlNo = DlNo ? DlNo.toUpperCase() : null;

    const [customer] = await connection.execute(
      `INSERT INTO Customers (CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState,
                              BillingDistrict, BillingPincode, SupplyAddress, SupplyState,
                              SupplyDistrict, SupplyPincode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [CustomerName, MobileNo, upperGstNo, upperDlNo, BillingAddress, BillingState,
       BillingDistrict, BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode]
    );
    const CustomerId = customer.insertId;

    const suppliers = toArray(req.body.SupplierId);
    const products = toArray(req.body.ProductId);
    const prices = toArray(req.body.SellingPrice);

    const byProduct = new Map();
    suppliers.forEach((_, i) => {
      const price = Number(prices[i]);
      if (products[i] && price > 0)
        byProduct.set(String(products[i]), [CustomerId, suppliers[i], products[i], price]);
    });
    if (!byProduct.size) throw new Error("No products to insert/update.");

    await connection.query(
      `INSERT INTO CustomerPricing (CustomerId, SupplierId, ProductId, SellingPrice) VALUES ?`,
      [[...byProduct.values()]]
    );

    await connection.execute(
      `INSERT INTO Accounts (AccountName, AccountType, CustomerId) VALUES (?, 'CUSTOMER', ?)`,
      [`${CustomerName}`, CustomerId]
    );

    await connection.commit();
    return "Customer and pricing details added/updated successfully!";
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/** All customers (name lower-cased, as before). */
const getCustomerList = async () => {
  const [rows] = await dbConnection.promise().execute(
    `SELECT Id, Lower(CustomerName) AS CustomerName, MobileNo, CreatedAt, GstNo, DlNo
       FROM Customers ORDER BY CustomerName ASC`
  );
  return rows;
};

/** Customer name by id (lower-case) or null. */
const getCustomerName = async (customerId) => {
  const [rows] = await dbConnection.query(
    `SELECT Lower(CustomerName) AS CustomerName FROM Customers WHERE Id = ? LIMIT 1`,
    [customerId]
  );
  return rows.length ? rows[0].CustomerName : null;
};

const getCustomerDetails = async (customerId) => {
  const [rows] = await dbConnection.execute("SELECT * FROM Customers WHERE Id = ?", [customerId]);
  return rows.length ? rows[0] : null;
};

const updateCustomerDetails = async (req) => {
  const {
    CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict,
    BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode,
  } = req.body;
  const customerId = req.params.customerId;

  await dbConnection.execute(
    `UPDATE Customers SET CustomerName = ?, MobileNo = ?, GstNo = ?, DlNo = ?, BillingAddress = ?,
            BillingState = ?, BillingDistrict = ?, BillingPincode = ?, SupplyAddress = ?,
            SupplyState = ?, SupplyDistrict = ?, SupplyPincode = ?
      WHERE Id = ?`,
    [CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict,
     BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode, customerId]
  );
  return "Customer updated successfully.";
};


/* =====================================================================
 * 2. STOCK LISTS
 * ===================================================================== */

/**
 * Sellable stock for the sale / challan page.
 * CHANGED: returns the lot's MRP and orders by product, expiry (so two lots of
 *          the same batch are easy to tell apart).
 */
const getStockList = async () => {
  const sql = `
    SELECT Stock.Id, Products.Id AS ProductId, Products.ProductName, Products.SupplierId,
           Stock.BatchNumber, Stock.Quantity, Stock.MRP,
           DATE_FORMAT(Stock.ExpiryDate, '%d-%m-%y') AS ExpiryDate,
           Stock.CreatedAt,
           (SELECT IGSTPercentage FROM PurchaseOrderDetails
             WHERE ProductId = Products.Id ORDER BY Id DESC LIMIT 1) AS IGSTPercentage
      FROM Stock
      JOIN Products ON Stock.ProductId = Products.Id
     WHERE Stock.Quantity > 0 AND Stock.ExpiryDate > CURDATE()
     ORDER BY Products.ProductName, Stock.ExpiryDate`;
  const [rows] = await dbConnection.connection.promise().execute(sql);
  return rows;
};

/** Paginated stock grouped product -> batches (used by stock list + excel). */
const getStocks = async (supplierId = "", page = 1, limit = 20, isDownload = false) => {
  const offset = (page - 1) * limit;
  const params = [];

  let countSql = `
    SELECT COUNT(DISTINCT CONCAT(p.Id, '_', s.Id)) AS total
      FROM Stock st
      JOIN Products p ON st.ProductId = p.Id
      JOIN Suppliers s ON st.SupplierId = s.Id`;
  if (supplierId) { countSql += ` WHERE s.Id = ?`; params.push(supplierId); }

  const [countResult] = await dbConnection.execute(countSql, params);
  const totalProducts = countResult[0].total;

  let productSql = `
    SELECT DISTINCT p.Id AS ProductId, p.ProductName, s.Id AS SupplierId, s.Name AS SupplierName
      FROM Stock st
      JOIN Products p ON st.ProductId = p.Id
      JOIN Suppliers s ON st.SupplierId = s.Id`;
  const productParams = supplierId ? [supplierId] : [];
  if (supplierId) productSql += ` WHERE s.Id = ?`;
  productSql += ` ORDER BY p.ProductName ASC`;
  if (!isDownload) productSql += ` LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

  const [products] = await dbConnection.execute(productSql, productParams);
  if (products.length === 0) return { stocks: [], totalProducts };

  const productIds = products.map((p) => p.ProductId);
  let batchSql = `
    SELECT st.ProductId, st.SupplierId, st.BatchNumber,
           DATE_FORMAT(st.ExpiryDate, '%Y-%m-%d') AS ExpiryDate,
           SUM(st.Quantity) AS Quantity
      FROM Stock st
     WHERE st.ProductId IN (${productIds.map(() => "?").join(",")})`;
  const batchParams = [...productIds];
  if (supplierId) { batchSql += ` AND st.SupplierId = ?`; batchParams.push(supplierId); }
  batchSql += `
     GROUP BY st.ProductId, st.SupplierId, st.BatchNumber, st.ExpiryDate
     ORDER BY st.BatchNumber ASC`;

  const [batches] = await dbConnection.execute(batchSql, batchParams);

  const grouped = {};
  products.forEach((p) => {
    grouped[`${p.ProductId}_${p.SupplierId}`] = {
      ProductId: p.ProductId, ProductName: p.ProductName,
      SupplierId: p.SupplierId, SupplierName: p.SupplierName,
      TotalQuantity: 0, Batches: [],
    };
  });
  batches.forEach((b) => {
    const key = `${b.ProductId}_${b.SupplierId}`;
    const qty = parseFloat(b.Quantity) || 0;
    if (grouped[key]) {
      grouped[key].Batches.push({
        BatchNumber: b.BatchNumber,
        Quantity: qty,
        ExpiryDate: moment(b.ExpiryDate, "YYYY-MM-DD").format("DD-MM-YYYY"),
      });
      grouped[key].TotalQuantity += qty;
    }
  });

  return { stocks: Object.values(grouped), totalProducts };
};

/** CHANGED: MRP / cost come from the lot (Stock row). */
const getStockDetails = async (productId) => {
  const sql = `
    SELECT p.ProductName AS ProductName, p.Id AS ProductId, s.Name AS SupplierName,
           st.BatchNumber, st.Quantity, st.ExpiryDate, st.CreatedAt, st.Id AS stockId,
           st.MRP, st.PurchasePrice
      FROM Stock st
      JOIN Products p        ON st.ProductId = p.Id
      LEFT JOIN Suppliers s  ON st.SupplierId = s.Id
     WHERE st.ProductId = ?
     ORDER BY st.ExpiryDate, st.BatchNumber`;
  const [rows] = await dbConnection.connection.promise().query(sql, [productId]);
  return rows;
};

/**
 * Stock ledger page. FIX: ORDER BY Timestamp only -> rows with the same second
 * could swap places between pages; Id is now the tie-breaker.
 */
const getStockTransactions = async ({ stockId, limit = 10, offset = 0, type, search, fromDate, toDate }) => {
  let where = "WHERE StockId = ?";
  const params = [stockId];

  if (type) { where += " AND TransactionType = ?"; params.push(type); }
  if (search) { where += " AND Remarks LIKE ?"; params.push(`%${search}%`); }
  if (fromDate && toDate) {
    const startDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    const endDate = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    where += " AND DATE(Timestamp) BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }

  const db = dbConnection.connection.promise();

  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM StockTransactions ${where}`, params);

  const [[{ openingBalance }]] = await db.execute(
    `SELECT COALESCE(SUM(CASE WHEN Effect = 'IN' THEN Quantity ELSE -Quantity END), 0) AS openingBalance
       FROM (SELECT * FROM StockTransactions ${where}
              ORDER BY Timestamp ASC, Id ASC LIMIT ${Number(offset)}) t`,
    [...params]
  );

  const [rows] = await db.execute(
    `SELECT * FROM StockTransactions ${where}
      ORDER BY Timestamp ASC, Id ASC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    [...params]
  );

  return { transactions: rows, totalCount: total, openingBalance: Number(openingBalance || 0) };
};

/** Real stock according to the ledger (IN minus OUT). */
const getLedgerStock = async (stockId) => {
  const [[{ currentStock }]] = await dbConnection.connection.promise().query(
    `SELECT COALESCE(SUM(CASE WHEN Effect = 'IN' THEN Quantity ELSE -Quantity END), 0) AS currentStock
       FROM StockTransactions WHERE StockId = ?`,
    [stockId]
  );
  return Number(currentStock || 0);
};

const getProductNameFromStockId = async (stockId) => {
  const [rows] = await dbConnection.connection.promise().execute(
    `SELECT st.ProductId, st.BatchNumber, Pr.ProductName
       FROM Stock st JOIN Products Pr ON Pr.Id = st.ProductId
      WHERE st.Id = ?`,
    [stockId]
  );
  return rows[0];
};

const getProductFromStockId = async (stockId, connection) => {
  const [rows] = await connection.execute(
    `SELECT p.ProductName FROM Stock s JOIN Products p ON p.Id = s.ProductId WHERE s.Id = ?`,
    [stockId]
  );
  return rows.length ? rows[0].ProductName : null;
};

const getProductDetails = async (productId) => {
  const [productDetails] = await dbConnection.connection
    .promise()
    .query("SELECT * FROM Products WHERE Id = ?", [productId]);
  return productDetails[0];
};

/** Product name by id (cached). */
const getProductName = async (productId, connection = null) => {
  if (productNameCache.has(productId)) return productNameCache.get(productId);
  const executor = connection ? connection : dbConnection.connection.promise();
  const [rows] = await executor.execute("SELECT ProductName FROM Products WHERE Id = ?", [productId]);
  const productName = rows.length ? rows[0].ProductName : null;
  productNameCache.set(productId, productName);
  return productName;
};


/* =====================================================================
 * 3. SALES
 * ===================================================================== */

/**
 * Creates a sale (invoice) - stock, accounting and customer ledger in ONE transaction.
 *
 * CHANGED: price comes from resolveCustomerPrice() (lot price -> product default -> block).
 * FIX: the old query joined CustomerPricing on ProductId only, so a customer with
 *      several priced lots of one product was billed at an arbitrary one.
 * FIX: stock check + deduction was not atomic (two users could oversell). Lots are
 *      locked and the UPDATE is guarded with Quantity >= qty.
 * FIX: one-row form posts (strings, not arrays) crashed the reduce/map calls.
 * NEW: expired lots cannot be sold; every line is rounded to 2 decimals; lines are
 *      processed one after another (no parallel queries on one connection).
 * NEW: the same batch (same GST) entered on two rows becomes ONE invoice line with the summed
 *      quantity (a different GST % stays a separate line).
 */
const createSale = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    const customerId = Number(req.body.customerId);
    const saleDate = req.body.saleDate;
    const stockIds = toArray(req.body.stockId).map(Number);
    const quantities = toArray(req.body.quantitySold).map(Number);
    const sgsts = toArray(req.body.sgst).map(Number);
    const cgsts = toArray(req.body.cgst).map(Number);
    const userId = req.user.Id;

    if (!customerId || !saleDate || !stockIds.length) throw new Error("Missing required fields");
    if ([quantities, sgsts, cgsts].some((a) => a.length !== stockIds.length))
      throw new Error("Sale lines are incomplete (stock / quantity / GST mismatch).");

    stockIds.forEach((id, i) => {
      if (!Number.isInteger(id) || id <= 0) throw new Error(`Line ${i + 1}: invalid stock.`);
      if (!Number.isInteger(quantities[i]) || quantities[i] <= 0)
        throw new Error(`Line ${i + 1}: quantity must be a whole number above 0.`);
      if (!Number.isFinite(sgsts[i]) || sgsts[i] < 0 || !Number.isFinite(cgsts[i]) || cgsts[i] < 0)
        throw new Error(`Line ${i + 1}: invalid GST %.`);
    });

    const todayDate = moment().format("YYYY-MM-DD");
    const financialYear = await getFinancialYear(saleDate);
    const customerName = await getCustomerName(customerId);
    if (!customerName) throw new Error("Customer not found.");

    await connection.beginTransaction();

    const qtyByStock = new Map();           // merge duplicate stock lines
    stockIds.forEach((id, i) => qtyByStock.set(id, (qtyByStock.get(id) || 0) + quantities[i]));

    const [lots] = await connection.query(
      `SELECT s.Id, s.ProductId, s.BatchNumber, s.Quantity, s.ExpiryDate, p.ProductName
         FROM Stock s JOIN Products p ON p.Id = s.ProductId
        WHERE s.Id IN (?) FOR UPDATE OF s`,
      [[...qtyByStock.keys()]]
    );
    const lotMap = new Map(lots.map((l) => [Number(l.Id), l]));

    for (const [id, qty] of qtyByStock) {
      const lot = lotMap.get(id);
      if (!lot) throw new Error(`Stock ${id} not found`);
      const label = `${lot.ProductName} (Batch ${lot.BatchNumber})`;
      if (moment(lot.ExpiryDate).isBefore(moment(), "day"))
        throw new Error(`${label} is expired and cannot be sold.`);
      if (Number(lot.Quantity) < qty)
        throw new Error(`Insufficient stock for ${label}. Available: ${lot.Quantity}, requested: ${qty}`);
    }

    const invoiceId = await generateDocumentNumber(connection, "SALESINVOICE");

    let totalValueSum = 0, totalSgstSum = 0, totalCgstSum = 0, totalInvoiceAmount = 0;
    const lineRows = [];

    // NEW: the same batch (and GST) entered twice is ONE invoice line with the summed quantity.
    // The price is decided per batch, so identical stock + GST also means identical price.
    const merged = new Map();
    stockIds.forEach((id, i) => {
      const key = `${id}|${sgsts[i]}|${cgsts[i]}`;
      const m = merged.get(key);
      if (m) m.qty += quantities[i];
      else merged.set(key, { stockId: id, qty: quantities[i], sgst: sgsts[i], cgst: cgsts[i] });
    });

    for (const m of merged.values()) {
      const lot = lotMap.get(m.stockId);
      const resolved = await resolveCustomerPrice(connection, customerId, lot.Id, lot.ProductId);
      if (!resolved || !(resolved.price > 0))
        throw new Error(
          `No selling price set for ${lot.ProductName} (Batch ${lot.BatchNumber}) for ${customerName}. ` +
          `Set it on the customer pricing page.`
        );

      const qty = m.qty;
      const taxable = round2(qty * resolved.price);
      const sgstAmt = round2((taxable * m.sgst) / 100);
      const cgstAmt = round2((taxable * m.cgst) / 100);
      const withTax = round2(taxable + sgstAmt + cgstAmt);

      totalValueSum += taxable; totalSgstSum += sgstAmt;
      totalCgstSum += cgstAmt; totalInvoiceAmount += withTax;

      lineRows.push([lot.Id, qty, resolved.price, m.sgst, sgstAmt, m.cgst, cgstAmt, taxable, withTax]);
    }
    totalValueSum = round2(totalValueSum); totalSgstSum = round2(totalSgstSum);
    totalCgstSum = round2(totalCgstSum); totalInvoiceAmount = round2(totalInvoiceAmount);

    const [headerResult] = await connection.query(
      `INSERT INTO SalesHeader
         (CustomerId, InvoiceId, TotalAmountWithTax, TotalAmountWithoutTax, TotalSgst, TotalCgst,
          Status, CreatedAt, CreatedBy, FinancialYear, SaleDate)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [customerId, invoiceId, totalInvoiceAmount, totalValueSum, totalSgstSum, totalCgstSum,
       todayDate, userId, financialYear, saleDate]
    );
    const saleId = headerResult.insertId;

    await connection.query(
      `INSERT INTO SalesItems
         (SaleId, StockId, QuantitySold, SalePrice, Sgst, SgstAmount, Cgst, CgstAmount,
          TotalValue, TotalValueWithTax, CreatedAt, ReturnedQty)
       VALUES ?`,
      [lineRows.map((r) => [saleId, ...r, todayDate, 0])]
    );

    for (const [sId, qty] of qtyByStock) {
      const [upd] = await connection.query(
        `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ? AND Quantity >= ?`,
        [qty, sId, qty]
      );
      if (upd.affectedRows !== 1) throw new Error("Stock changed while billing. Please retry.");

      await connection.query(
        `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
         VALUES (?, 'REDUCE', 'OUT', ?, NOW(), ?)`,
        [sId, qty, `Sold to ${customerName} (${invoiceId})`]
      );
    }

    const voucherId = await createSaleEntry({
      connection, customerId, invoiceId, insertedSaleId: saleId,
      saleDate, totalAmount: totalInvoiceAmount, userId,
    });

    await connection.execute(
      `INSERT INTO CustomerLedger
         (CustomerId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId,
          ReferenceNo, DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'SALE', 'INVOICE', ?, ?, ?, 0, ?, ?)`,
      [customerId, financialYear, saleDate, saleId, invoiceId, totalInvoiceAmount,
       `Sale ${invoiceId}`, voucherId]
    );

    await connection.commit();
    return { saleId, invoiceId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Creates a delivery challan, reduces stock and logs it.
 * FIX: StockTransactions rows had no Effect (NOT NULL enum without default; on a
 *      non-strict server MySQL stored 'IN' - a REDUCE saved as IN made the ledger wrong).
 * FIX: CreatedBy used req.user.id (lower-case) -> always fell back to user 1.
 * FIX: one-row posts, atomic guarded stock update, expired lots blocked.
 */
const createChallan = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    const customerId = Number(req.body.customerId);
    const { ChallanDate, remarks = "" } = req.body;
    const stockIds = toArray(req.body.stockId).map(Number);
    const quantities = toArray(req.body.quantitySold).map(Number);

    if (!customerId || !ChallanDate || !stockIds.length) throw new Error("Missing required fields");
    if (quantities.length !== stockIds.length) throw new Error("Challan lines are incomplete.");
    stockIds.forEach((id, i) => {
      if (!Number.isInteger(id) || id <= 0) throw new Error(`Line ${i + 1}: invalid stock.`);
      if (!Number.isInteger(quantities[i]) || quantities[i] <= 0)
        throw new Error(`Line ${i + 1}: quantity must be a whole number above 0.`);
    });

    const customerName = await getCustomerName(customerId);
    if (!customerName) throw new Error("Customer not found.");
    const parsed = moment(ChallanDate, "DD-MM-YYYY");
    if (!parsed.isValid()) throw new Error("Invalid challan date.");
    const challanDateSql = parsed.format("YYYY-MM-DD");

    await connection.beginTransaction();

    const qtyByStock = new Map();
    stockIds.forEach((id, i) => qtyByStock.set(id, (qtyByStock.get(id) || 0) + quantities[i]));

    const [lots] = await connection.query(
      `SELECT s.Id, s.BatchNumber, s.Quantity, s.ExpiryDate, p.ProductName
         FROM Stock s JOIN Products p ON p.Id = s.ProductId
        WHERE s.Id IN (?) FOR UPDATE OF s`,
      [[...qtyByStock.keys()]]
    );
    const lotMap = new Map(lots.map((l) => [Number(l.Id), l]));

    for (const [id, qty] of qtyByStock) {
      const lot = lotMap.get(id);
      if (!lot) throw new Error(`Stock with ID ${id} not found.`);
      const label = `"${lot.ProductName}" (Batch ${lot.BatchNumber})`;
      if (moment(lot.ExpiryDate).isBefore(moment(), "day")) throw new Error(`${label} is expired.`);
      if (Number(lot.Quantity) < qty)
        throw new Error(`Insufficient stock for product ${label}. Available: ${lot.Quantity}, Requested: ${qty}`);
    }

    const [challanResult] = await connection.query(
      `INSERT INTO Challan (CustomerId, Remarks, ChallanDate, CreatedBy, CreatedAt)
       VALUES (?, ?, ?, ?, NOW())`,
      [customerId, remarks, challanDateSql, req.user?.Id || null]
    );
    const challanId = challanResult.insertId;

    for (const [sId, qty] of qtyByStock) {
      await connection.query(
        `INSERT INTO ChallanItems (ChallanId, StockId, QuantitySold) VALUES (?, ?, ?)`,
        [challanId, sId, qty]
      );
      const [upd] = await connection.query(
        `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ? AND Quantity >= ?`,
        [qty, sId, qty]
      );
      if (upd.affectedRows !== 1) throw new Error("Stock changed while creating the challan. Please retry.");

      await connection.query(
        `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
         VALUES (?, 'REDUCE', 'OUT', ?, NOW(), ?)`,
        [sId, qty, `Challan #${challanId} sent to ${customerName}`]
      );
    }

    await connection.commit();
    return challanId;
  } catch (error) {
    await connection.rollback();
    console.error("Error in createChallan:", error.message);
    throw error;
  } finally {
    connection.release();
  }
};


/* =====================================================================
 * 4. SALES QUERIES / PRINT DATA
 * ===================================================================== */

const getSalesData = async () => {
  const sql = `
    SELECT si.Id, c.CustomerName, p.ProductName, st.BatchNumber, si.QuantitySold, si.SalePrice,
           si.Cgst, si.Sgst, si.TotalValue, DATE_FORMAT(sh.CreatedAt, '%d-%m-%y') AS CreatedAt,
           sh.InvoiceId
      FROM SalesHeader sh
      JOIN SalesItems si ON sh.Id = si.SaleId
      JOIN Customers c   ON sh.CustomerId = c.Id
      JOIN Stock st      ON si.StockId = st.Id
      JOIN Products p    ON st.ProductId = p.Id
     ORDER BY sh.Id DESC`;
  const [rows] = await dbConnection.connection.promise().execute(sql);
  return rows;
};

/**
 * CHANGED: MRP comes from the lot (Stock.MRP). The old Invoices + PurchaseOrderDetails
 * joins duplicated rows when a product was twice in one PO and printed the first
 * purchase's MRP for merged batches.
 */
const getPrintSaleData = async (customerId, saleId) => {
  const salesQuery = `
    SELECT c.CustomerName, sh.CustomerId,
           p.ProductName, p.Hsn, p.KnownAs,
           stk.BatchNumber, DATE_FORMAT(stk.ExpiryDate, '%d-%m-%Y') AS ExpiryDate, stk.Id AS StockId,
           si.QuantitySold, IFNULL(si.ReturnedQty, 0) AS ReturnedQty, si.Id AS SalesItemId, si.SalePrice, si.Sgst, si.Cgst,
           si.SgstAmount, si.CgstAmount, si.TotalValue, si.TotalValueWithTax,
           sh.CreatedAt, sh.Id AS SaleId, sh.InvoiceId,
           stk.InvoiceId AS InvoiceRefId,
           stk.MRP AS MRP
      FROM SalesHeader sh
      JOIN SalesItems si ON sh.Id = si.SaleId
      JOIN Customers c   ON sh.CustomerId = c.Id
      JOIN Stock stk     ON si.StockId = stk.Id
      JOIN Products p    ON stk.ProductId = p.Id
     WHERE sh.CustomerId = ? AND sh.Id = ?
     ORDER BY si.Id`;
  const [rows] = await dbConnection.connection.promise().query(salesQuery, [customerId, saleId]);
  return rows;
};

const getPrintTotalSaleData = async (customerId, saleId) => {
  const query = `
    SELECT SUM(si.SgstAmount) AS TotalSgstAmount, SUM(si.CgstAmount) AS TotalCgstAmount,
           SUM(si.TotalValue) AS TotalValue, SUM(si.TotalValueWithTax) AS TotalValueWithTax,
           sh.InvoiceId, sh.Id AS SaleId, DATE_FORMAT(sh.CreatedAt, '%d-%m-%Y') AS CreatedAt
      FROM SalesHeader sh
      INNER JOIN SalesItems si ON sh.Id = si.SaleId
     WHERE sh.Id = ? AND sh.CustomerId = ?
     GROUP BY sh.Id`;
  const [rows] = await dbConnection.connection.promise().query(query, [saleId, customerId]);
  return rows;
};

/** One row per sale (grouped products) for the sales history page. */
const getSearchedSalesData = async (req) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  const fromDate = body.FromDate ? helper.parseDate(body.FromDate) : moment().format("YYYY-MM-DD");
  const toDate = body.ToDate ? helper.parseDate(body.ToDate) : moment().format("YYYY-MM-DD");

  if (!helper.compareDateForSearch(fromDate, toDate))
    throw new Error(`Invalid date range. "From Date" should be less than or equal to "To Date".`);

  const whereArr = [`DATE(sh.CreatedAt) BETWEEN ? AND ?`];
  const queryParams = [fromDate, toDate];

  if (body.InvoiceId) { whereArr.push(`sh.InvoiceId LIKE ?`); queryParams.push(`%${body.InvoiceId}%`); }
  if (body.Customer) { whereArr.push(`sh.CustomerId = ?`); queryParams.push(body.Customer); }

  const sql = `
    SELECT sh.Id AS SaleId, sh.InvoiceId, c.CustomerName, c.GstNo, c.Id AS CustomerId,
           GROUP_CONCAT(p.ProductName ORDER BY si.Id SEPARATOR ', ')    AS Products,
           GROUP_CONCAT(st.BatchNumber ORDER BY si.Id SEPARATOR ', ')   AS BatchNumbers,
           GROUP_CONCAT(si.QuantitySold ORDER BY si.Id SEPARATOR ', ')  AS QuantitySold,
           DATE_FORMAT(sh.CreatedAt, '%d-%m-%y') AS SaledOn
      FROM SalesHeader sh
      JOIN Customers c  ON sh.CustomerId = c.Id
      JOIN SalesItems si ON sh.Id = si.SaleId
      JOIN Stock st     ON si.StockId = st.Id
      JOIN Products p   ON st.ProductId = p.Id
     WHERE ${whereArr.join(" AND ")}
     GROUP BY sh.Id, sh.InvoiceId, c.CustomerName, c.GstNo, c.Id, SaledOn, sh.CreatedAt
     ORDER BY sh.CreatedAt DESC`;

  const [rows] = await dbConnection.connection.promise().execute(sql, queryParams);
  return rows;
};

/** Customer-wise sales (grouped by invoice) for the sales report / GST excel. */
const getSalesReport = async (req) => {
  const data = req.method === "POST" ? req.body : req.query;

  const Customer = data.Customer || null;
  const FromDate = data.FromDate || moment().format("DD-MM-YYYY");
  const ToDate = data.ToDate || moment().format("DD-MM-YYYY");

  const fromDate = helper.parseDate(FromDate);
  const toDate = helper.parseDate(ToDate);
  if (!helper.compareDateForSearch(fromDate, toDate)) throw new Error(`Invalid date range`);

  const startDate = moment(fromDate).startOf("day").format("YYYY-MM-DD HH:mm:ss");
  const endDate = moment(toDate).endOf("day").format("YYYY-MM-DD HH:mm:ss");

  const query = `
    SELECT sh.Id AS SaleId, sh.InvoiceId, DATE_FORMAT(sh.CreatedAt, '%d-%m-%y') AS CreatedAt,
           c.CustomerName, c.GstNo, p.ProductName, si.QuantitySold, si.SalePrice, si.TotalValue,
           si.TotalValueWithTax, si.Sgst, si.Cgst, si.SgstAmount, si.CgstAmount
      FROM SalesHeader sh
      JOIN Customers c   ON sh.CustomerId = c.Id
      JOIN SalesItems si ON si.SaleId = sh.Id
      JOIN Stock st      ON si.StockId = st.Id
      JOIN Products p    ON st.ProductId = p.Id
     WHERE sh.CreatedAt BETWEEN ? AND ?
       AND (? IS NULL OR sh.CustomerId = ?)
     ORDER BY sh.InvoiceId DESC, si.Id ASC`;

  const [rows] = await dbConnection.execute(query, [startDate, endDate, Customer, Customer]);

  const invoiceMap = {};
  rows.forEach((row) => {
    if (!invoiceMap[row.InvoiceId]) {
      invoiceMap[row.InvoiceId] = {
        SaleId: row.SaleId, InvoiceId: row.InvoiceId, CustomerName: row.CustomerName,
        GstNo: row.GstNo, CreatedAt: row.CreatedAt, Products: [],
        SubTotal: 0, GrandTotal: 0, TotalCgst: 0, TotalSgst: 0,
      };
    }
    const invoice = invoiceMap[row.InvoiceId];
    const totalValue = parseFloat(row.TotalValue) || 0;
    const totalValueWithTax = parseFloat(row.TotalValueWithTax) || 0;
    const cgstAmount = parseFloat(row.CgstAmount) || 0;
    const sgstAmount = parseFloat(row.SgstAmount) || 0;

    invoice.Products.push({
      ProductName: row.ProductName, QuantitySold: row.QuantitySold,
      SalePrice: parseFloat(row.SalePrice) || 0, Sgst: parseFloat(row.Sgst) || 0,
      Cgst: parseFloat(row.Cgst) || 0, TotalValue: totalValue, TotalValueWithTax: totalValueWithTax,
      CgstAmount: cgstAmount, SgstAmount: sgstAmount,
    });
    invoice.SubTotal += totalValue;
    invoice.GrandTotal += totalValueWithTax;
    invoice.TotalCgst += cgstAmount;
    invoice.TotalSgst += sgstAmount;
  });

  return Object.values(invoiceMap);
};


/* =====================================================================
 * 5. PAYMENTS AND LEDGERS
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * PAYMENT SAFETY HELPERS  (NEW)
 * Used by addPayment (customer receipt) and addPaymentToSupplier.
 *
 * Double submit protection:
 *   1. every payment form carries a one-time code (formToken), created when the page is opened;
 *   2. the code is claimed in IdempotencyKeys (UNIQUE Scope + TokenKey) INSIDE the payment transaction:
 *      the same form sent twice (double click, slow network, refresh, browser re-send, two tabs)
 *      finds the code already taken -> nothing is saved again;
 *      if the first request fails, its claim is rolled back and the same form can be sent again;
 *   3. the same cheque / UTR / payment no. cannot be entered twice for one supplier, and (as the
 *      database already enforces) a receipt no. is used only once.
 * ------------------------------------------------------------------- */
const firstValue = (v) => (Array.isArray(v) ? v[0] : v);
const paymentError = (msg) => { const e = new Error(msg); e.isUserError = true; return e; };

const PAYMENT_DATE_FORMATS = ["DD-MM-YYYY", "D-M-YYYY", "DD/MM/YYYY", "D/M/YYYY", "YYYY-MM-DD"];

/** Strict date: "31-02-2026", "abc" or a future date are refused (they used to become "Invalid date"). */
const readPaymentDate = (value) => {
  const raw = String(firstValue(value) == null ? "" : firstValue(value)).trim();
  const m = moment(raw, PAYMENT_DATE_FORMATS, true);
  if (!raw || !m.isValid()) throw paymentError(`Payment date "${raw}" is not a valid date. Use DD-MM-YYYY.`);
  if (m.isAfter(moment(), "day")) throw paymentError("Payment date cannot be in the future.");
  return m.format("YYYY-MM-DD");
};

/** Amount: digits with at most 2 decimals ("1,500.50" is accepted; "1e5", "-10", "12abc" are refused). */
const readPaymentAmount = (value) => {
  const t = String(firstValue(value) == null ? "" : firstValue(value)).replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw paymentError(`Amount "${t}" is not valid. Use numbers only, at most 2 decimals.`);
  const n = round2(t);
  if (!(n > 0)) throw paymentError("Amount must be greater than 0.");
  if (n > 99999999.99) throw paymentError("Amount is too large.");
  return n;
};

/** Text field: trimmed, single spaces; too long = error (never cut silently). */
const readPaymentText = (value, label, max, required = true) => {
  const t = String(firstValue(value) == null ? "" : firstValue(value)).replace(/\s+/g, " ").trim();
  if (required && !t) throw paymentError(`${label} is required.`);
  if (t.length > max) throw paymentError(`${label} is too long (max ${max} characters).`);
  return t;
};

/**
 * Claims the one-time code of a form inside the open transaction.
 * Returns { duplicate: false } for the first request, { duplicate: true, resultRef } for a repeat.
 * A second request with the same code waits here until the first one commits or rolls back.
 */
const claimFormToken = async (connection, scope, token, userId) => {
  const t = String(firstValue(token) || "").trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t))
    throw paymentError("This page is old or was opened before the update. Reload the page and enter the payment again.");
  try {
    await connection.query(
      `INSERT INTO IdempotencyKeys (Scope, TokenKey, UserId, ResultRef, CreatedAt) VALUES (?, ?, ?, NULL, NOW())`,
      [scope, t, userId || null]);
    return { token: t, duplicate: false };
  } catch (err) {
    if (err.code !== "ER_DUP_ENTRY") throw err;
    const [[row]] = await connection.query(
      `SELECT ResultRef FROM IdempotencyKeys WHERE Scope = ? AND TokenKey = ?`, [scope, t]);
    return { token: t, duplicate: true, resultRef: row ? row.ResultRef : null };
  }
};

const setFormTokenResult = (connection, scope, token, resultRef) =>
  connection.query(`UPDATE IdempotencyKeys SET ResultRef = ? WHERE Scope = ? AND TokenKey = ?`, [String(resultRef), scope, token]);

const inr = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Customer receipt (cash / bank) with double entry + customer ledger.
 * CHANGED: returns { message, duplicate, paymentId } instead of a plain message.
 * NEW: one-time form code (double submit), strict date / amount checks, friendly message when the
 *      receipt no. is already used (Payments.PaymentNo is UNIQUE in the database).
 */
const addPayment = async (req) => {
  const body = req.body || {};
  const userId = req.user && req.user.Id;
  if (!userId) throw new Error("userId is required");

  // validation runs before anything is written
  const customerId = Number(firstValue(body.customerId));
  if (!Number.isInteger(customerId) || customerId <= 0) throw paymentError("Select the customer.");
  const paymentDate = readPaymentDate(body.paymentDate);
  const amountPaid = readPaymentAmount(body.amountPaid);
  const paymentType = readPaymentText(body.paymentType, "Payment type", 50);
  const paymentNo = readPaymentText(body.paymentNo, "Payment no.", 50);
  const paymentNote = readPaymentText(body.paymentNote, "Payment note", 500);
  const normalizedPaymentType = getAccountTypeFromPaymentType(paymentType); // BANK or CASH

  const SCOPE = "CUSTOMER_PAYMENT";
  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const claim = await claimFormToken(connection, SCOPE, body.formToken, userId);
    if (claim.duplicate) {
      await connection.rollback();
      const [[p]] = claim.resultRef
        ? await connection.query(`SELECT PaymentNo, Credit FROM Payments WHERE Id = ?`, [claim.resultRef])
        : [[null]];
      return {
        duplicate: true, paymentId: claim.resultRef ? Number(claim.resultRef) : null,
        message: p
          ? `This payment was already saved (Receipt ${p.PaymentNo}, Rs. ${inr(p.Credit)}). It was NOT saved again.`
          : "This form was already submitted. It was NOT saved again.",
      };
    }

    // one receipt at a time per customer
    const [[customer]] = await connection.query(`SELECT Id FROM Customers WHERE Id = ? FOR UPDATE`, [customerId]);
    if (!customer) throw paymentError("Customer not found.");

    const [[used]] = await connection.query(
      `SELECT p.PaymentNo, DATE_FORMAT(p.PaymentDate, '%d-%m-%Y') AS d, p.Credit, IFNULL(p.IsDeleted, 0) AS IsDeleted, c.CustomerName
         FROM Payments p LEFT JOIN Customers c ON c.Id = p.CustomerId
        WHERE p.PaymentNo = ? LIMIT 1`, [paymentNo]);
    if (used) {
      throw paymentError(used.IsDeleted
        ? `Receipt no. ${used.PaymentNo} belonged to a deleted payment (${used.CustomerName || "customer"}, ${used.d}). Use a different number, for example ${used.PaymentNo}-R.`
        : `Receipt no. ${used.PaymentNo} is already entered (${used.CustomerName || "customer"}, ${used.d}, Rs. ${inr(used.Credit)}). Check the ledger before entering it again.`);
    }

    const [paymentResult] = await connection.query(
      `INSERT INTO Payments (CustomerId, PaymentNo, PaymentDate, Credit, PaymentType, PaymentNote)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [customerId, paymentNo, paymentDate, amountPaid, paymentType, paymentNote]
    );
    const receiptId = paymentResult.insertId;
    const financialYear = await getFinancialYear(paymentDate);

    const voucherId = await createReceiptEntry({
      connection, customerId, receiptId, receiptNo: paymentNo, receiptDate: paymentDate,
      amount: amountPaid, normalizedPaymentType, userId,
    });

    await connection.query(
      `INSERT INTO CustomerLedger
         (CustomerId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId,
          DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'RECEIPT', 'CustomerPayment', ?, 0, ?, ?, ?)`,
      [customerId, financialYear, paymentDate, receiptId, amountPaid,
       `Receipt ${paymentNo} via ${normalizedPaymentType}`, voucherId]
    );

    await setFormTokenResult(connection, SCOPE, claim.token, receiptId);
    await connection.commit();
    return { duplicate: false, paymentId: receiptId, message: `Payment of Rs. ${inr(amountPaid)} successfully received (Receipt ${paymentNo}).` };
  } catch (error) {
    await connection.rollback();
    // two different forms with the same receipt no. at the very same moment: the UNIQUE key stops the second one
    if (error.code === "ER_DUP_ENTRY" && /PaymentNo/i.test(error.message))
      throw paymentError(`Receipt no. ${paymentNo} is already entered. Check the ledger before entering it again.`);
    if (!error.isUserError) console.error("Error processing payment:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Payment made to a supplier.
 * CHANGED: returns { message, duplicate, paymentId } instead of a plain message.
 * NEW: one-time form code (double submit), strict date / amount checks, the same cheque / UTR /
 *      payment no. cannot be entered twice for one supplier, payments of one supplier are saved one
 *      after the other (supplier row lock).
 * Ledger posting is unchanged: PAYMENT = CREDIT in SupplierLedger, Dr Supplier / Cr Bank-Cash in LedgerEntries.
 */
const addPaymentToSupplier = async (req) => {
  const body = req.body || {};
  const userId = req.user && req.user.Id;
  if (!userId) throw new Error("userId is required");

  const supplierId = Number(firstValue(body.supplierId));
  if (!Number.isInteger(supplierId) || supplierId <= 0) throw paymentError("Select the supplier.");
  const paymentDate = readPaymentDate(body.paymentDate);
  const amountPaid = readPaymentAmount(body.amountPaid);
  const paymentType = readPaymentText(body.paymentType, "Payment type", 50);
  const paymentNo = readPaymentText(body.paymentNo, "Payment no. (cheque / UTR)", 50);
  const normalizePaymentType = getAccountTypeFromPaymentType(paymentType); // BANK or CASH

  const SCOPE = "SUPPLIER_PAYMENT";
  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const claim = await claimFormToken(connection, SCOPE, body.formToken, userId);
    if (claim.duplicate) {
      await connection.rollback();
      const [[p]] = claim.resultRef
        ? await connection.query(`SELECT PaymentNo, Credit FROM PaymentsToSupplier WHERE Id = ?`, [claim.resultRef])
        : [[null]];
      return {
        duplicate: true, paymentId: claim.resultRef ? Number(claim.resultRef) : null, supplierId,
        message: p
          ? `This payment was already saved (${p.PaymentNo}, Rs. ${inr(p.Credit)}). It was NOT saved again.`
          : "This form was already submitted. It was NOT saved again.",
      };
    }

    // payments of one supplier are saved one after the other -> the duplicate check below is reliable
    const [[supplier]] = await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [supplierId]);
    if (!supplier) throw paymentError("Supplier not found.");

    const [[used]] = await connection.query(
      `SELECT PaymentNo, DATE_FORMAT(PaymentDate, '%d-%m-%Y') AS d, Credit
         FROM PaymentsToSupplier
        WHERE SupplierId = ? AND TRIM(PaymentNo) = ? AND IFNULL(ReferenceType, '') <> 'CREDIT_NOTE'
        LIMIT 1`, [supplierId, paymentNo]);
    if (used)
      throw paymentError(`Payment no. ${used.PaymentNo} is already entered for this supplier (${used.d}, Rs. ${inr(used.Credit)}). Check the supplier ledger before entering it again.`);

    const [paymentResult] = await connection.query(
      `INSERT INTO PaymentsToSupplier (SupplierId, PaymentNo, PaymentDate, Credit, PaymentType)
       VALUES (?, ?, ?, ?, ?)`,
      [supplierId, paymentNo, paymentDate, amountPaid, paymentType]
    );
    const paymentId = paymentResult.insertId;
    const financialYear = await getFinancialYear(paymentDate);

    const voucherId = await createPaymentEntry({
      connection, supplierId, paymentId, paymentNo, paymentDate,
      amount: amountPaid, paymentMode: normalizePaymentType, userId,
    });

    await connection.query(
      `INSERT INTO SupplierLedger
         (SupplierId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId,
          DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'PAYMENT', 'SupplierPayment', ?, 0, ?, ?, ?)`,
      [supplierId, financialYear, paymentDate, paymentId, amountPaid, `Payment ${paymentNo}`, voucherId]
    );

    await setFormTokenResult(connection, SCOPE, claim.token, paymentId);
    await connection.commit();
    return { duplicate: false, paymentId, supplierId, message: `Payment of Rs. ${inr(amountPaid)} successfully saved (${paymentNo}).` };
  } catch (error) {
    await connection.rollback();
    if (!error.isUserError) console.error("Error saving supplier payment:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Customer ledger between two dates with opening balance and running balance.
 * CHANGED: every row also carries its document numbers (same idea as the supplier ledger):
 *   ReferenceType 'Invoice'         -> SalesHeader.Id   (invoice no, link to the sale)
 *   ReferenceType 'CustomerPayment' -> Payments.Id      (receipt / cheque / UTR no, mode, note)
 *   ReferenceType 'SalesReturn'     -> SalesReturn.Id   (credit note no)
 * Description is kept EXACTLY as before (used by the Excel and PDF downloads).
 * SAFE FOR MONEY: joins only on primary keys, the credit note list is a sub-query -> no repeated rows;
 * Debit / Credit / Balance still come only from CustomerLedger.
 * FIX: running balance added up in paise (no 0.1 + 0.2 drift, no "0.00 CR").
 * FIX: PaymentNo / PaymentType are now filled, so those Excel columns are no longer empty.
 */
const CUSTOMER_TYPE_LABELS = { SALE: "Sale", RECEIPT: "Receipt", SALES_RETURN: "Sales Return", OPENING_BALANCE: "Opening Balance" };

const getCustomerLedger = async (customerId, startDate, endDate) => {
  const from = moment(startDate);
  const to = moment(endDate);
  if (!from.isValid() || !to.isValid()) throw new Error("Invalid ledger dates.");
  const start = from.format("YYYY-MM-DD");
  const end = to.format("YYYY-MM-DD");

  const [[opening]] = await dbConnection.execute(
    `SELECT COALESCE(SUM(DebitAmount), 0) AS totalDebit, COALESCE(SUM(CreditAmount), 0) AS totalCredit
       FROM CustomerLedger WHERE CustomerId = ? AND EntryDate < ?`,
    [customerId, start]
  );

  let running = toPaise(opening.totalDebit) - toPaise(opening.totalCredit);
  let sumDebit = running > 0 ? running : 0;
  let sumCredit = running < 0 ? -running : 0;

  const ledger = [{
    Date: moment(start).subtract(1, "day").format("DD-MM-YYYY"),
    Type: "Opening Balance",
    TransactionType: "OPENING_BALANCE",
    Description: "Opening Balance",
    Ref: "", RefLabel: "", Mode: "", Note: "",
    Debit: sumDebit / 100,
    Credit: sumCredit / 100,
    Balance: paiseToBalance(running),
    IsOpening: true,
  }];

  const [entries] = await dbConnection.execute(
    `SELECT cl.Id, cl.EntryDate, cl.TransactionType, cl.ReferenceType, cl.ReferenceId, cl.ReferenceNo,
            cl.DebitAmount, cl.CreditAmount, cl.Description,
            sh.Id AS SaleId, sh.InvoiceId AS InvoiceNo,
            p.PaymentNo, p.PaymentType, p.PaymentNote,
            (SELECT GROUP_CONCAT(cn.CreditNoteNumber ORDER BY cn.Id SEPARATOR ', ')
               FROM CreditNotes cn WHERE cn.SalesReturnId = sr.Id) AS CreditNoteNos
       FROM CustomerLedger cl
       LEFT JOIN SalesHeader sh ON cl.ReferenceType = 'Invoice'         AND sh.Id = cl.ReferenceId
       LEFT JOIN Payments p     ON cl.ReferenceType = 'CustomerPayment' AND p.Id  = cl.ReferenceId
       LEFT JOIN SalesReturn sr ON cl.ReferenceType = 'SalesReturn'     AND sr.Id = cl.ReferenceId
      WHERE cl.CustomerId = ? AND cl.EntryDate BETWEEN ? AND ?
      ORDER BY cl.EntryDate ASC, cl.Id ASC`,
    [customerId, start, end]
  );

  for (const row of entries) {
    const debit = toPaise(row.DebitAmount);
    const credit = toPaise(row.CreditAmount);
    running += debit - credit;
    sumDebit += debit;
    sumCredit += credit;

    let ref = "", refLabel = "", mode = "", note = "", saleId = null;
    switch (String(row.ReferenceType || "").toUpperCase()) {
      case "INVOICE":
        ref = row.InvoiceNo || row.ReferenceNo || "";
        refLabel = "Inv";
        saleId = row.SaleId || null;
        break;
      case "CUSTOMERPAYMENT":
        ref = row.PaymentNo || row.ReferenceNo || "";
        mode = row.PaymentType || "";
        refLabel = /cash/i.test(mode) ? "" : "Chq/UTR";
        note = row.PaymentNote || "";
        break;
      case "SALESRETURN":
        ref = row.CreditNoteNos || row.ReferenceNo || `SR-${row.ReferenceId}`;
        refLabel = row.CreditNoteNos ? "CN" : "";
        break;
      default:
        ref = row.ReferenceNo || "";
    }

    ledger.push({
      Id: row.Id,
      Date: ledgerDate(row.EntryDate),
      Type: CUSTOMER_TYPE_LABELS[row.TransactionType] || row.TransactionType,
      TransactionType: row.TransactionType,
      Description: `${row.Description} (${row.ReferenceType || ""} ${row.ReferenceId || ""})`,   // unchanged (Excel / PDF)
      Narration: row.Description || "",
      Ref: ref,
      RefLabel: ref ? refLabel : "",
      Mode: mode,
      Note: note,
      SaleId: saleId,
      InvoiceId: saleId,                               // the old view linked sales with entry.InvoiceId
      PaymentNo: row.PaymentNo || "",                  // used by the Excel download
      PaymentType: row.PaymentType || "",
      Debit: debit / 100,
      Credit: credit / 100,
      Balance: paiseToBalance(running),
    });
  }

  return {
    ledger,
    totalDebit: sumDebit / 100,
    totalCredit: sumCredit / 100,
    closingBalance: paiseToBalance(running),
  };
};

/* ---------------------------------------------------------------------
 * SUPPLIER LEDGER  (CHANGED)
 * Every row now carries the document numbers on both sides, so the ledger can be ticked off
 * against the supplier's own statement:
 *   ReferenceType 'Purchase'           (old purchases)  -> PurchaseOrders.Id
 *   ReferenceType 'Invoice'            (new purchases)  -> Invoices.Id  (-> PurchaseOrders)
 *   ReferenceType 'SupplierPayment'                     -> PaymentsToSupplier.Id
 *   ReferenceType 'SupplierCreditNote' (expiry settle)  -> SupplierCreditNotes.Id (-> return / debit note)
 * SAFE FOR MONEY: every join is on a primary key (at most one row per ledger row) and every
 * extra list (invoices of an old PO, debit notes of a return) is a sub-query, so a ledger row can
 * never be repeated. Debit / Credit / Balance still come ONLY from SupplierLedger.
 * FIX: running balance is added up in paise (whole numbers) -> no 0.1 + 0.2 drift, no "0.00 CR".
 * ------------------------------------------------------------------- */
const LEDGER_TYPE_LABELS = {
  OPENING_BALANCE: "Opening Balance", PURCHASE: "Purchase", PURCHASE_RETURN: "Purchase Return",
  PAYMENT: "Payment", DEBIT_NOTE: "Debit Note", CREDIT_NOTE: "Credit Note", ADJUSTMENT: "Adjustment",
};
const toPaise = (v) => Math.round(Number(v || 0) * 100);
const paiseToBalance = (p) => (Math.abs(p) / 100).toFixed(2) + (p >= 0 ? " DR" : " CR");
const ledgerDate = (d) => {
  if (!d) return "";
  const m = moment(d);
  return m.isValid() && m.year() > 1900 ? m.format("DD-MM-YYYY") : "";      // '0000-00-00' -> blank
};
const joinRefs = (...v) => v.filter((x) => x != null && String(x).trim() !== "").join(" / ");

const getSupplierLedger = async (supplierId, startDate, endDate) => {
  const from = moment(startDate);
  const to = moment(endDate);
  if (!from.isValid() || !to.isValid()) throw new Error("Invalid ledger dates.");
  const start = from.format("YYYY-MM-DD");
  const end = to.format("YYYY-MM-DD");

  const [[opening]] = await dbConnection.execute(
    `SELECT COALESCE(SUM(DebitAmount), 0) AS totalDebit, COALESCE(SUM(CreditAmount), 0) AS totalCredit
       FROM SupplierLedger WHERE SupplierId = ? AND EntryDate < ?`,
    [supplierId, start]
  );

  let running = toPaise(opening.totalDebit) - toPaise(opening.totalCredit);
  let sumDebit = running > 0 ? running : 0;
  let sumCredit = running < 0 ? -running : 0;

  const ledger = [{
    Date: moment(start).subtract(1, "day").format("DD-MM-YYYY"),
    Type: "Opening Balance",
    Description: "Opening Balance",
    OurRef: "", OurRefDate: "", SupplierRef: "", SupplierRefDate: "", PoDate: "",
    Debit: sumDebit / 100,
    Credit: sumCredit / 100,
    Balance: paiseToBalance(running),
    IsOpening: true,
  }];

  const [entries] = await dbConnection.execute(
    `SELECT sl.Id, sl.EntryDate, sl.TransactionType, sl.ReferenceType, sl.ReferenceId, sl.ReferenceNo,
            sl.DebitAmount, sl.CreditAmount, sl.Description,
            COALESCE(po.PurchaseInvoiceNo, ipo.PurchaseInvoiceNo) AS OurPurchaseNo,
            COALESCE(po.PoDate, ipo.PoDate)                       AS PoDate,
            po.SupplierInvoiceNo                                  AS PoSupplierInvoiceNo,
            (SELECT GROUP_CONCAT(DISTINCT i2.SupplierInvoiceNo ORDER BY i2.SupplierInvoiceNo SEPARATOR ', ')
               FROM Invoices i2 WHERE i2.PurchaseOrderId = po.Id)  AS OldPoInvoiceNos,
            (SELECT MIN(i3.InvoiceDate) FROM Invoices i3 WHERE i3.PurchaseOrderId = po.Id) AS OldPoInvoiceDate,
            inv.SupplierInvoiceNo                                 AS InvSupplierInvoiceNo,
            inv.InvoiceDate                                       AS InvInvoiceDate,
            pay.PaymentNo, pay.PaymentType,
            cn.CreditNoteNumber, cn.CreditDate, cn.ReferenceReturnNumber,
            (SELECT GROUP_CONCAT(dn.DebitNoteNumber ORDER BY dn.Id SEPARATOR ', ')
               FROM SupplierDebitNotes dn WHERE dn.ExpiryReturnId = cn.ExpiryReturnId) AS DebitNoteNos
       FROM SupplierLedger sl
       LEFT JOIN PurchaseOrders po       ON sl.ReferenceType = 'Purchase'           AND po.Id  = sl.ReferenceId
       LEFT JOIN Invoices inv            ON sl.ReferenceType = 'Invoice'            AND inv.Id = sl.ReferenceId
       LEFT JOIN PurchaseOrders ipo      ON ipo.Id = inv.PurchaseOrderId
       LEFT JOIN PaymentsToSupplier pay  ON sl.ReferenceType = 'SupplierPayment'    AND pay.Id = sl.ReferenceId
       LEFT JOIN SupplierCreditNotes cn  ON sl.ReferenceType = 'SupplierCreditNote' AND cn.Id  = sl.ReferenceId
      WHERE sl.SupplierId = ? AND sl.EntryDate BETWEEN ? AND ?
      ORDER BY sl.EntryDate ASC, sl.Id ASC`,
    [supplierId, start, end]
  );

  for (const row of entries) {
    const debit = toPaise(row.DebitAmount);
    const credit = toPaise(row.CreditAmount);
    running += debit - credit;
    sumDebit += debit;
    sumCredit += credit;

    // OurRef = our document, SupplierRef = the supplier's (or bank's) document
    let ourRef = "", ourRefDate = "", supplierRef = "", supplierRefDate = "", refLabel = "";
    switch (row.ReferenceType) {
      case "Purchase":                                   // purchases entered before the invoice module
        ourRef = row.OurPurchaseNo || "";
        ourRefDate = ledgerDate(row.PoDate);
        supplierRef = row.OldPoInvoiceNos || row.PoSupplierInvoiceNo || row.ReferenceNo || "";
        supplierRefDate = ledgerDate(row.OldPoInvoiceDate);
        refLabel = "Inv";
        break;
      case "Invoice":
        ourRef = row.OurPurchaseNo || "";
        ourRefDate = ledgerDate(row.PoDate);
        supplierRef = row.InvSupplierInvoiceNo || row.ReferenceNo || "";
        supplierRefDate = ledgerDate(row.InvInvoiceDate);
        refLabel = "Inv";
        break;
      case "SupplierPayment":
        ourRef = row.PaymentType || "";
        supplierRef = row.PaymentNo || row.ReferenceNo || "";
        refLabel = row.PaymentType && /cash/i.test(row.PaymentType) ? "" : "Chq/UTR";
        break;
      case "SupplierCreditNote":                         // expiry settlement
        ourRef = joinRefs(row.ReferenceReturnNumber, row.DebitNoteNos);
        supplierRef = row.CreditNoteNumber || row.ReferenceNo || "";
        supplierRefDate = ledgerDate(row.CreditDate);
        refLabel = "CN";
        break;
      default:
        supplierRef = row.ReferenceNo || "";
    }

    ledger.push({
      Id: row.Id,
      Date: ledgerDate(row.EntryDate),
      Type: LEDGER_TYPE_LABELS[row.TransactionType] || row.TransactionType,
      TransactionType: row.TransactionType,
      Description: row.Description || LEDGER_TYPE_LABELS[row.TransactionType] || row.TransactionType,
      OurRef: ourRef,
      OurRefDate: ourRefDate,
      SupplierRef: supplierRef,
      SupplierRefLabel: supplierRef ? refLabel : "",
      SupplierRefDate: supplierRefDate,
      PoDate: ourRefDate,                                // kept for old templates
      Debit: debit / 100,
      Credit: credit / 100,
      Balance: paiseToBalance(running),
    });
  }

  return {
    ledger,
    totalDebit: sumDebit / 100,
    totalCredit: sumCredit / 100,
    closingBalance: paiseToBalance(running),
  };
};

/**
 * All customers' balances for a date range (accounts based).
 * FIX: joined CarryForward on cf.Id, but the primary key is CarryForwardId -> the page
 *      crashed with "Unknown column 'cf.Id'".
 * FIX: LedgerEntries has no CreatedAt column (the date is Vouchers.VoucherDate), so the
 *      date filter could never run. The entries are now filtered through their voucher.
 */
const getCustomersLedger = async (startDate, endDate) => {
  const query = `
    SELECT c.Id, c.CustomerName,
           COALESCE(SUM(le.DebitAmount), 0)  AS TotalDebit,
           COALESCE(SUM(le.CreditAmount), 0) AS TotalCredit,
           COALESCE(cf.Debit, 0)  AS CarryForwardDebit,
           COALESCE(cf.Credit, 0) AS CarryForwardCredit,
           (COALESCE(SUM(le.DebitAmount), 0) + COALESCE(cf.Debit, 0)
            - COALESCE(SUM(le.CreditAmount), 0) - COALESCE(cf.Credit, 0)) AS NetBalance,
           CASE
             WHEN (COALESCE(SUM(le.DebitAmount), 0) + COALESCE(cf.Debit, 0)
                   - COALESCE(SUM(le.CreditAmount), 0) - COALESCE(cf.Credit, 0)) > 0
               THEN CONCAT((COALESCE(SUM(le.DebitAmount), 0) + COALESCE(cf.Debit, 0)
                            - COALESCE(SUM(le.CreditAmount), 0) - COALESCE(cf.Credit, 0)), ' DR')
             WHEN (COALESCE(SUM(le.DebitAmount), 0) + COALESCE(cf.Debit, 0)
                   - COALESCE(SUM(le.CreditAmount), 0) - COALESCE(cf.Credit, 0)) < 0
               THEN CONCAT(ABS(COALESCE(SUM(le.DebitAmount), 0) + COALESCE(cf.Debit, 0)
                               - COALESCE(SUM(le.CreditAmount), 0) - COALESCE(cf.Credit, 0)), ' CR')
             ELSE '0'
           END AS BalanceType
      FROM Customers c
      LEFT JOIN Accounts a      ON a.CustomerId = c.Id
      LEFT JOIN (
        SELECT le2.AccountId, le2.DebitAmount, le2.CreditAmount
          FROM LedgerEntries le2
          JOIN Vouchers v ON v.Id = le2.VoucherId
         WHERE v.VoucherDate BETWEEN ? AND ?
      ) le ON le.AccountId = a.Id
      LEFT JOIN CarryForward cf ON cf.CarryForwardId = (
              SELECT cf2.CarryForwardId FROM CarryForward cf2
               WHERE cf2.CustomerId = c.Id AND cf2.CarryForwardDate < ?
               ORDER BY cf2.CarryForwardDate DESC LIMIT 1)
     GROUP BY c.Id, c.CustomerName, cf.Debit, cf.Credit
     ORDER BY c.CustomerName ASC`;
  const [rows] = await dbConnection.connection.promise().query(query, [startDate, endDate, startDate]);
  return rows;
};

/** Customers with total debit / credit / pending amount and last receipt date. */
const getCustomerListWithDues = async () => {
  const query = `
    SELECT c.Id AS CustomerId, c.CustomerName,
           ROUND(IFNULL(SUM(cl.DebitAmount), 0), 2)  AS TotalDebit,
           ROUND(IFNULL(SUM(cl.CreditAmount), 0), 2) AS TotalCredit,
           ROUND(IFNULL(SUM(cl.DebitAmount), 0) - IFNULL(SUM(cl.CreditAmount), 0), 2) AS PendingAmount,
           MAX(CASE WHEN cl.TransactionType = 'RECEIPT' THEN cl.EntryDate END) AS LastPaymentDate
      FROM Customers c
      LEFT JOIN CustomerLedger cl ON cl.CustomerId = c.Id
     GROUP BY c.Id, c.CustomerName
     ORDER BY c.CustomerName ASC`;
  const [rows] = await dbConnection.execute(query);
  return rows;
};


/* =====================================================================
 * 6. PURCHASE ORDERS AND RECEIVING THE SUPPLIER INVOICE
 * ===================================================================== */

/** Creates a purchase order (lines with the same product + price + GST are merged). */
const createPurchasePo = async (req) => {
  const connection = await dbConnection.pool.promise().getConnection();

  try {
    const { supplierId, purchasePoDate } = req.body;
    const productId = toArray(req.body.productId);
    const quantity = toArray(req.body.quantity);
    const purchasePrice = toArray(req.body.purchasePrice);
    const igst = toArray(req.body.igst);
    const mrp = toArray(req.body.mrp);
    const poDate = moment(purchasePoDate, "DD-MM-YYYY").format("YYYY-MM-DD");

    if (!supplierId) throw new Error("Supplier is required");
    if (!productId.length) throw new Error("Add at least one product.");

    let totalAmountWithTax = 0;
    const productMap = new Map();

    for (let i = 0; i < productId.length; i++) {
      const key = `${productId[i]}_${purchasePrice[i]}_${igst[i]}`;
      const qty = Number(quantity[i]);
      const price = Number(purchasePrice[i]);
      const igstPercentage = Number(igst[i]);

      if (isNaN(qty) || qty <= 0) throw new Error("Quantity must be a valid number greater than 0.");
      if (isNaN(price) || price <= 0) throw new Error("one of the product purchase price has not been set.");
      if (isNaN(igstPercentage) || igstPercentage <= 0) throw new Error("one of the product igst percentage is not set.");

      const itemTotal = qty * price;
      const igstAmount = (itemTotal * igstPercentage) / 100;
      totalAmountWithTax += itemTotal + igstAmount;

      if (productMap.has(key)) {
        const existing = productMap.get(key);
        existing.quantity += qty;
        existing.totalPrice += itemTotal;
      } else {
        productMap.set(key, {
          productId: Number(productId[i]), quantity: qty, purchasePrice: price,
          mrp: Number(mrp[i]), igst: igstPercentage, totalPrice: itemTotal,
        });
      }
    }

    const values = Array.from(productMap.values()).map((item) => [
      item.productId, item.quantity, item.purchasePrice, item.mrp, item.igst, item.quantity,
    ]);

    await connection.beginTransaction();

    const invoiceNo = await generateDocumentNumber(connection, "PurchaseInvoice");
    const [poResult] = await connection.query(
      `INSERT INTO PurchaseOrders (SupplierId, PurchaseInvoiceNo, OrderDate, TotalAmountWithTax, Status, PoDate)
       VALUES (?, ?, NOW(), ?, 'Pending', ?)`,
      [supplierId, invoiceNo, round2(totalAmountWithTax), poDate]
    );
    const purchaseOrderId = poResult.insertId;

    await connection.query(
      `INSERT INTO PurchaseOrderDetails
         (PurchaseOrderId, ProductId, Quantity, PurchasePrice, MRP, IGSTPercentage, RemainingQuantity)
       VALUES ?`,
      [values.map((row) => [purchaseOrderId, ...row])]
    );

    await connection.commit();
    return purchaseOrderId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * PO lines with their invoices / received stock.
 * FIX: the old query joined InvoiceDetails on ProductId ONLY, so every PO line
 *      was repeated once for every invoice of that product in ANY other PO
 *      (a brand-new PO printed product 1 over and over). Invoice lines are now
 *      joined through THIS PO's invoices.
 */
const getTotalPurchasePoDetails = async (purchaseOrderId) => {
  const query = `
    SELECT po.Id AS PurchaseOrderId, po.PurchaseInvoiceNo, po.TotalAmountWithTax, po.OrderDate,
           po.Status, po.SupplierId, s.Name AS SupplierName,
           pod.Id AS PurchaseOrderDetailId, pod.ProductId, p.ProductName,
           pod.Quantity AS OrderedQuantity, pod.PurchasePrice, pod.MRP, pod.IGSTPercentage,
           pod.IGSTAmount, pod.TotalAmount, pod.RemainingQuantity,
           inv.InvoiceId AS InvoiceId, inv.SupplierInvoiceNo AS InvoiceNo, inv.InvoiceDate,
           inv.InvoiceTotalAmount AS InvoiceTotalAmount,
           inv.ReceivedQuantity, st.BatchNumber, st.MfgDate, st.ExpiryDate,
           st.Quantity AS ReceivedStockQuantity
      FROM PurchaseOrders po
      JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
      JOIN Products p  ON pod.ProductId = p.Id
      JOIN Suppliers s ON po.SupplierId = s.Id
      LEFT JOIN (
        SELECT idt.ProductId, idt.ReceivedQuantity, i2.Id AS InvoiceId, i2.PurchaseOrderId,
               i2.SupplierInvoiceNo, i2.InvoiceDate, i2.TotalAmount AS InvoiceTotalAmount
          FROM InvoiceDetails idt
          JOIN Invoices i2 ON i2.Id = idt.InvoiceId
      ) inv ON inv.PurchaseOrderId = po.Id AND inv.ProductId = pod.ProductId
      LEFT JOIN Stock st ON st.InvoiceId = inv.InvoiceId AND st.ProductId = pod.ProductId
     WHERE po.Id = ?
     ORDER BY pod.ProductId, inv.InvoiceDate`;
  const [rows] = await dbConnection.connection.promise().query(query, [purchaseOrderId]);
  return rows;
};

const getTotalPurchasePoAmount = async (purchaseOrderId) => {
  const query = `
    SELECT SUM(PurchaseOrderDetails.IGSTAmount) AS IgstAmount,
           SUM(PurchaseOrderDetails.TotalAmount) AS TotalValue,
           SUM(PurchaseOrderDetails.IGSTAmount + PurchaseOrderDetails.TotalAmount) AS TotalValueWithTax,
           PurchaseOrders.PurchaseInvoiceNo, PurchaseOrders.OrderDate
      FROM PurchaseOrderDetails
      JOIN PurchaseOrders ON PurchaseOrders.Id = PurchaseOrderDetails.PurchaseOrderId
     WHERE PurchaseOrderDetails.PurchaseOrderId = ?
     GROUP BY PurchaseOrders.PurchaseInvoiceNo, PurchaseOrders.OrderDate`;
  const [rows] = await dbConnection.connection.promise().query(query, [purchaseOrderId]);
  return rows;
};

/** PO list for the "receive purchase order" page. */
const getPurchasePoListForReceivingTheOrder = async (filters) => {
  const { PurchaseInvoiceNo = null, Supplier = null, FromDate, ToDate } = filters;

  const fromDate = FromDate ? helper.parseDate(FromDate) : moment().format("YYYY-MM-DD HH:mm:ss");
  const toDate = ToDate ? helper.parseDate(ToDate) : moment().format("YYYY-MM-DD HH:mm:ss");

  if (!helper.compareDateForSearch(fromDate, toDate))
    throw new Error(`Invalid date range. "From Date" should be less than or equal to "To Date".`);

  const query = `
    SELECT po.Id AS PurchaseOrderId, po.PurchaseInvoiceNo, po.SupplierId,
           DATE_FORMAT(po.PoDate, '%d-%m-%Y') AS PurchasePoDate, s.Name AS SupplierName,
           DATE_FORMAT(po.OrderDate, '%d-%m-%Y') AS OrderDate, po.TotalAmountWithTax, po.Status,
           pod.Id AS PurchaseOrderDetailId, pod.ProductId, p.ProductName, pod.Quantity,
           pod.PurchasePrice, pod.MRP, pod.IGSTPercentage, pod.IGSTAmount, pod.RemainingQuantity,
           pod.TotalAmount AS ProductTotalAmount
      FROM PurchaseOrders po
      JOIN Suppliers s ON po.SupplierId = s.Id
      JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
      JOIN Products p ON pod.ProductId = p.Id
     WHERE (po.PurchaseInvoiceNo = ? OR ? IS NULL)
       AND (po.SupplierId = ? OR ? IS NULL)
       AND ((? IS NULL OR ? IS NULL) OR (po.OrderDate BETWEEN ? AND ?))
     ORDER BY po.OrderDate DESC`;

  const values = [PurchaseInvoiceNo, PurchaseInvoiceNo, Supplier, Supplier,
                  fromDate, toDate, fromDate, toDate];
  const [results] = await dbConnection.connection.promise().execute(query, values);
  return results;
};

/**
 * PO list (grouped) with product-level and PO-level receiving status computed at
 * run time from OrderedQty and RemainingQuantity.
 */
const getPurchasePoList = async (filters) => {
  const { PurchaseInvoiceNo = null, Supplier = null, FromDate, ToDate } = filters;

  const fromDate = FromDate ? helper.parseDate(FromDate) : moment().format("YYYY-MM-DD");
  const toDate = ToDate ? helper.parseDate(ToDate) : moment().format("YYYY-MM-DD");
  if (fromDate && toDate && !helper.compareDateForSearch(fromDate, toDate))
    throw new Error("Invalid date range.");

  const query = `
    SELECT po.Id AS PurchaseOrderId, po.PurchaseInvoiceNo,
           DATE_FORMAT(po.PoDate, '%d-%m-%Y') AS PurchasePoDate, po.SupplierId, s.Name AS SupplierName,
           DATE_FORMAT(po.OrderDate, '%d-%m-%Y') AS OrderDate,
           pod.ProductId, p.ProductName, pod.Quantity AS OrderedQty, pod.RemainingQuantity,
           i.SupplierInvoiceNo
      FROM PurchaseOrders po
      JOIN Suppliers s ON po.SupplierId = s.Id
      JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
      JOIN Products p ON pod.ProductId = p.Id
      LEFT JOIN (
        SELECT PurchaseOrderId, SupplierInvoiceNo FROM Invoices
         WHERE Id IN (SELECT MAX(Id) FROM Invoices GROUP BY PurchaseOrderId)
      ) i ON i.PurchaseOrderId = po.Id
     WHERE (? IS NULL OR po.PurchaseInvoiceNo = ?)
       AND (? IS NULL OR po.SupplierId = ?)
       AND ((? IS NULL OR ? IS NULL) OR (po.OrderDate BETWEEN ? AND ?))
     ORDER BY po.OrderDate DESC, po.Id, pod.ProductId`;

  const values = [PurchaseInvoiceNo, PurchaseInvoiceNo, Supplier, Supplier,
                  fromDate, toDate, fromDate, toDate];
  const [rows] = await dbConnection.connection.promise().execute(query, values);

  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.PurchaseOrderId]) {
      grouped[row.PurchaseOrderId] = {
        PurchaseOrderId: row.PurchaseOrderId, PurchaseInvoiceNo: row.PurchaseInvoiceNo,
        SupplierId: row.SupplierId, SupplierName: row.SupplierName, OrderDate: row.OrderDate,
        PurchasePoDate: row.PurchasePoDate, SupplierInvoiceNo: row.SupplierInvoiceNo,
        TotalOrderedQty: 0, TotalReceivedQty: 0, Products: [],
      };
    }
    const receivedQty = row.OrderedQty - row.RemainingQuantity;
    let productStatus = "Pending";
    if (receivedQty === 0) productStatus = "Pending";
    else if (receivedQty < row.OrderedQty) productStatus = "Partially Received";
    else productStatus = "Received";

    grouped[row.PurchaseOrderId].Products.push({
      ProductId: row.ProductId, ProductName: row.ProductName, OrderedQty: row.OrderedQty,
      ReceivedQty: receivedQty, RemainingQty: row.RemainingQuantity, Status: productStatus,
    });
    grouped[row.PurchaseOrderId].TotalOrderedQty += row.OrderedQty;
    grouped[row.PurchaseOrderId].TotalReceivedQty += receivedQty;
  });

  Object.values(grouped).forEach((po) => {
    if (po.TotalReceivedQty === 0) po.POStatus = "Pending";
    else if (po.TotalReceivedQty < po.TotalOrderedQty) po.POStatus = "Partially Received";
    else po.POStatus = "Received";
  });

  return Object.values(grouped);
};

const getInvoiceDetails = async (purchaseOrderId) => {
  const [invoices] = await dbConnection.connection.promise().execute(
    `SELECT i.SupplierInvoiceNo, i.InvoiceDate, i.TotalAmount FROM Invoices i WHERE i.PurchaseOrderId = ?`,
    [purchaseOrderId]
  );
  return invoices;
};

/**
 * Receives goods against a purchase order: invoice + stock lots + accounting.
 *
 * CHANGED: stock is a LOT (batch + purchase price); cost, MRP and GST are saved on
 *          the Stock row. Same batch at the same price merges, at a different
 *          price it becomes a new Stock row with its own selling price.
 * FIX: the PO status compared "3" === 3 (SUM() returns a string) so a PO was NEVER
 *      marked Received -> the expiry-settlement invoice search (needs 'Received')
 *      found nothing. A line that was only partly received also left the PO 'Pending';
 *      the status is now Pending / Partially Received / Received from the quantities.
 * FIX: two lines of the same product in one PO overwrote each other.
 * FIX: SupplierId is taken from the PO, not from the browser.
 * FIX: StockTransactions rows now carry Effect = 'IN'.
 * NEW: batch / expiry / manufacturing date validation.
 */
const generateInvoice = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    const { purchaseOrderId, supplierInvoiceNo, invoicePoDate } = req.body;
    const userId = req.user.Id;
    const products = toObjectArray(req.body.products);

    if (!purchaseOrderId || !supplierInvoiceNo)
      throw new Error("PurchaseOrderId and SupplierInvoiceNo are required");
    if (!products.length) throw new Error("Products array is required");

    const formattedInvoiceDate = formatDate(invoicePoDate);
    if (!formattedInvoiceDate || formattedInvoiceDate === "Invalid date")
      throw new Error("A valid invoice date is required.");

    await connection.beginTransaction();

    const [[po]] = await connection.execute(
      `SELECT Id, SupplierId FROM PurchaseOrders WHERE Id = ? FOR UPDATE`, [purchaseOrderId]);
    if (!po) throw new Error("Purchase order not found.");
    const supplierId = po.SupplierId;

    const [poLines] = await connection.execute(
      `SELECT Id, ProductId, RemainingQuantity, PurchasePrice, MRP, IGSTPercentage
         FROM PurchaseOrderDetails WHERE PurchaseOrderId = ? FOR UPDATE`,
      [purchaseOrderId]
    );
    const linesByProduct = new Map();
    poLines.forEach((l) => {
      l.remaining = Number(l.RemainingQuantity);
      const k = Number(l.ProductId);
      if (!linesByProduct.has(k)) linesByProduct.set(k, []);
      linesByProduct.get(k).push(l);
    });

    const productIds = [...new Set(products.map((p) => Number(p.productId)))];
    const [productRows] = await connection.query(
      `SELECT Id, ProductName FROM Products WHERE Id IN (?)`, [productIds]);
    const productMap = new Map(productRows.map((p) => [p.Id, p.ProductName]));

    const [invoiceResult] = await connection.execute(
      `INSERT INTO Invoices (PurchaseOrderId, SupplierInvoiceNo, InvoiceDate, TotalAmount, Status, ReceivedBy)
       VALUES (?, ?, ?, 0, 'Pending', ?)`,
      [purchaseOrderId, supplierInvoiceNo, formattedInvoiceDate, userId]
    );
    const invoiceId = invoiceResult.insertId;

    let totalInvoiceAmount = 0;
    const invoiceValues = [];

    for (const item of products) {
      const productId = Number(item.productId);
      const receivedQuantity = Number(item.receivedQuantity || 0);
      const freeQuantity = Number(item.freeQuantity || 0);
      const totalQty = receivedQuantity + freeQuantity;
      const productName = productMap.get(productId) || `Product ${productId}`;
      const batchNumber = String(item.batchNumber || "").trim();

      if (!productId || totalQty <= 0 || receivedQuantity < 0 || freeQuantity < 0)
        throw new Error(`Invalid quantity for ${productName}`);
      if (!batchNumber) throw new Error(`Batch number required for ${productName}`);

      const expiry = formatDate(item.expiryDate);
      const mfg = formatDate(item.mfgDate);
      if (!expiry || expiry === "Invalid date") throw new Error(`Valid expiry date required for ${productName}`);
      if (!mfg || mfg === "Invalid date") throw new Error(`Valid manufacturing date required for ${productName}`);

      // FIX: the same product can appear twice in one PO -> pick the right line
      const candidates = linesByProduct.get(productId) || [];
      if (!candidates.length) throw new Error(`${productName} is not in this PO`);
      const line = item.poDetailId
        ? candidates.find((l) => Number(l.Id) === Number(item.poDetailId))
        : candidates.find((l) => l.remaining >= receivedQuantity);
      if (!line || receivedQuantity > line.remaining)
        throw new Error(`Received qty exceeds remaining qty for ${productName}`);
      line.remaining -= receivedQuantity;

      const price = Number(line.PurchasePrice);
      const gst = Number(line.IGSTPercentage);
      const totalAmount = round2(receivedQuantity * price);
      const igstAmount = round2((totalAmount * gst) / 100);
      totalInvoiceAmount += totalAmount + igstAmount;

      invoiceValues.push([invoiceId, productId, receivedQuantity, price, gst, igstAmount, totalAmount]);

      await connection.execute(
        `UPDATE PurchaseOrderDetails SET RemainingQuantity = RemainingQuantity - ? WHERE Id = ?`,
        [receivedQuantity, line.Id]
      );

      /* CHANGED: lot upsert - the unique key is (BatchNumber, ProductId, PurchasePrice) */
      const [stockResult] = await connection.execute(
        `INSERT INTO Stock
           (ProductId, BatchNumber, ExpiryDate, Quantity, SupplierId, InvoiceId, CreatedAt, MfgDate,
            PurchasePrice, MRP, IgstPercentage)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           Id = LAST_INSERT_ID(Id),
           Quantity = Quantity + VALUES(Quantity),
           ExpiryDate = VALUES(ExpiryDate),
           MfgDate = VALUES(MfgDate),
           MRP = VALUES(MRP),
           IgstPercentage = VALUES(IgstPercentage)`,
        [productId, batchNumber, expiry, totalQty, supplierId, invoiceId, mfg, price,
         Number(line.MRP), gst]
      );
      const stockId = stockResult.insertId;
      const isNewLot = stockResult.affectedRows === 1;
      const lotLabel = `${productName} (Batch ${batchNumber}, cost ${price})`;

      if (receivedQuantity > 0) {
        await connection.execute(
          `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
           VALUES (?, 'ADD', 'IN', ?, NOW(), ?)`,
          [stockId, receivedQuantity,
           `${isNewLot ? "New lot" : "Restock"} ${lotLabel} - Purchase Invoice ${supplierInvoiceNo}`]
        );
      }
      if (freeQuantity > 0) {
        await connection.execute(
          `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
           VALUES (?, 'FREE_ADD', 'IN', ?, NOW(), ?)`,
          [stockId, freeQuantity, `Free stock ${lotLabel} - ${supplierInvoiceNo}`]
        );
      }
    }

    totalInvoiceAmount = round2(totalInvoiceAmount);

    await connection.query(
      `INSERT INTO InvoiceDetails
         (InvoiceId, ProductId, ReceivedQuantity, PurchasePrice, IGSTPercentage, IGSTAmount, TotalAmount)
       VALUES ?`,
      [invoiceValues]
    );
    await connection.execute(`UPDATE Invoices SET TotalAmount = ? WHERE Id = ?`, [totalInvoiceAmount, invoiceId]);

    const voucherId = await createPurchaseEntry(
      connection, supplierId, purchaseOrderId, supplierInvoiceNo, formattedInvoiceDate,
      totalInvoiceAmount, userId
    );
    const financialYear = await getFinancialYear(formattedInvoiceDate);
    await connection.query(
      `INSERT INTO SupplierLedger
         (SupplierId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceNo, ReferenceId,
          DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'PURCHASE', 'Invoice', ?, ?, ?, 0, ?, ?)`,
      [supplierId, financialYear, formattedInvoiceDate, supplierInvoiceNo, invoiceId,
       totalInvoiceAmount, `Purchase Invoice ${supplierInvoiceNo}`, voucherId]
    );

    // FIX: compare NUMBERS (SUM() comes back as a string)
    // Received = every line closed; Pending = nothing received yet; otherwise Partially Received
    // (the old code ignored a line that was only partly received, so such a PO stayed "Pending")
    const [[statusRow]] = await connection.execute(
      `SELECT COUNT(*) AS total, SUM(RemainingQuantity = 0) AS closed, SUM(RemainingQuantity = Quantity) AS untouched
         FROM PurchaseOrderDetails WHERE PurchaseOrderId = ?`,
      [purchaseOrderId]
    );
    const total = Number(statusRow.total);
    const closed = Number(statusRow.closed || 0);
    const untouched = Number(statusRow.untouched || 0);
    let poStatus = "Partially Received";
    if (closed === total) poStatus = "Received";
    else if (untouched === total) poStatus = "Pending";

    await connection.execute(
      `UPDATE PurchaseOrders SET Status = ?, SupplierInvoiceNo = ? WHERE Id = ?`,
      [poStatus, supplierInvoiceNo, purchaseOrderId]
    );

    await connection.commit();
    productNameCache.clear();
    return { message: "Invoice + Stock + Accounting Done", invoiceId, voucherId };
  } catch (error) {
    await connection.rollback();
    console.error("Invoice Error:", error.message);
    throw error;
  } finally {
    connection.release();
  }
};

/** Purchase invoice lines by the supplier's invoice number (for the PDF). */
const getInvoiceDetailsThroughSupplierInvoiceNo = async (supplierInvoiceNo) => {
  const sql = `
    SELECT po.Id AS PurchaseOrderId, po.SupplierId, po.PurchaseInvoiceNo, po.OrderDate,
           po.TotalAmountWithTax, po.Status AS PurchaseOrderStatus,
           pod.ProductId, p.ProductName, p.Hsn, pod.Quantity AS OrderedQuantity, pod.PurchasePrice,
           pod.IGSTPercentage, pod.IGSTAmount, pod.TotalAmount AS OrderedTotalAmount,
           pod.RemainingQuantity,
           MAX(id.IGSTAmount) AS ReceivedIgstAmount, MAX(id.TotalAmount) AS ReceivedTotalAmount,
           COALESCE(SUM(id.ReceivedQuantity), 0) AS ReceivedQuantityInInvoice,
           COALESCE(SUM(id.TotalAmount), 0) AS TotalReceivedAmount
      FROM PurchaseOrders po
      JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
      JOIN Products p ON pod.ProductId = p.Id
      LEFT JOIN Invoices i ON i.PurchaseOrderId = po.Id
      LEFT JOIN InvoiceDetails id ON i.Id = id.InvoiceId AND id.ProductId = pod.ProductId
     WHERE i.SupplierInvoiceNo = ?
     GROUP BY po.Id, po.SupplierId, po.PurchaseInvoiceNo, po.OrderDate, po.TotalAmountWithTax, po.Status,
              pod.ProductId, p.ProductName, p.Hsn, pod.Quantity, pod.PurchasePrice, pod.IGSTPercentage,
              pod.IGSTAmount, pod.TotalAmount, pod.RemainingQuantity
    HAVING SUM(id.ReceivedQuantity) > 0`;
  const [rows] = await dbConnection.connection.promise().query(sql, [supplierInvoiceNo]);
  return rows;
};


/* =====================================================================
 * 7. CUSTOMER PRICING
 * ===================================================================== */

/**
 * Pricing page: every sellable lot with ITS OWN price for this customer.
 * CHANGED: cost / MRP / expiry come from the lot; SellingPrice = this lot's price
 *          only (0 when not set); ProductDefaultPrice + PriceSource say where a
 *          price comes from, so nothing looks like a "last sold price" any more.
 * FIX: `WHERE ...;` followed by a second `WHERE s.Id = ?` crashed whenever a
 *      supplier was selected.
 */
const getSuppliersProductWithCustomerPricing = async (customerId, supplierId = null) => {
  const params = [customerId, customerId, customerId];

  let query = `
    SELECT COALESCE(cp.Id, 0)                     AS CustomerPricingId,
           ?                                      AS CustomerId,
           p.Id                                   AS ProductId,
           p.ProductName,
           s.Id                                   AS SupplierId,
           s.Name                                 AS SupplierName,
           stk.Id                                 AS StockId,
           stk.BatchNumber,
           stk.Quantity,
           DATE_FORMAT(stk.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
           DATEDIFF(stk.ExpiryDate, CURDATE())    AS DaysToExpiry,
           stk.MRP,
           stk.PurchasePrice,
           COALESCE(cp.SellingPrice, 0)           AS SellingPrice,
           dp.SellingPrice                        AS ProductDefaultPrice,
           CASE WHEN cp.Id IS NOT NULL THEN 'LOT'
                WHEN dp.Id IS NOT NULL THEN 'DEFAULT'
                ELSE 'NONE' END                   AS PriceSource
      FROM Stock stk
      JOIN Products  p ON p.Id = stk.ProductId
      JOIN Suppliers s ON s.Id = p.SupplierId
      LEFT JOIN CustomerPricing cp ON cp.Id = (
            SELECT c1.Id FROM CustomerPricing c1
             WHERE c1.CustomerId = ? AND c1.StockId = stk.Id AND c1.Status = 1
             ORDER BY c1.UpdatedAt DESC, c1.Id DESC LIMIT 1)
      LEFT JOIN CustomerPricing dp ON dp.Id = (
            SELECT c2.Id FROM CustomerPricing c2
             WHERE c2.CustomerId = ? AND c2.ProductId = p.Id AND c2.StockId IS NULL AND c2.Status = 1
             ORDER BY c2.UpdatedAt DESC, c2.Id DESC LIMIT 1)
     WHERE stk.Quantity > 0`;

  if (supplierId) {
    query += ` AND s.Id = ?`;
    params.push(supplierId);
  }
  query += ` ORDER BY p.ProductName, stk.ExpiryDate`;

  const [rows] = await dbConnection.connection.promise().query(query, params);
  return rows;
};

/**
 * Saves a price for ONE lot (stockId) or, without stockId, a product default.
 * CHANGED: returns { message, belowCost } instead of a string.
 * FIX: `StockId = ?` never matches NULL -> null-safe `<=>`.
 * FIX: the stock must belong to the product (no mismatched saves).
 * NEW: price validated; a price below the lot's cost is saved but flagged (you do
 *      sell short-expiry stock at a loss on purpose).
 */
const setProductPricingForCustomer = async (customerId, supplierId, productId, newProductPrice, stockId) => {
  const connection = await dbConnection.connection.promise().getConnection();
  try {
    const price = round2(newProductPrice);
    if (!(price > 0)) throw new Error("Selling price must be greater than 0.");

    await connection.beginTransaction();

    let belowCost = false;
    const lotId = stockId ? Number(stockId) : null;

    if (lotId) {
      const [[lot]] = await connection.query(
        `SELECT s.Id, s.ProductId, s.PurchasePrice, p.SupplierId
           FROM Stock s JOIN Products p ON p.Id = s.ProductId
          WHERE s.Id = ? FOR UPDATE OF s`,
        [lotId]
      );
      if (!lot) throw new Error("Stock not found.");
      if (Number(lot.ProductId) !== Number(productId))
        throw new Error("This stock does not belong to the selected product.");
      supplierId = lot.SupplierId;
      belowCost = price < Number(lot.PurchasePrice);
    } else if (!supplierId) {
      const [[prod]] = await connection.query(`SELECT SupplierId FROM Products WHERE Id = ?`, [productId]);
      if (!prod) throw new Error("Product not found.");
      supplierId = prod.SupplierId;
    }

    await connection.query(
      `UPDATE CustomerPricing SET Status = 0
        WHERE CustomerId = ? AND ProductId = ? AND StockId <=> ? AND Status = 1`,
      [customerId, productId, lotId]
    );
    await connection.query(
      `INSERT INTO CustomerPricing (CustomerId, SupplierId, ProductId, SellingPrice, Status, StockId)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [customerId, supplierId, productId, price, lotId]
    );

    await connection.commit();
    return {
      belowCost,
      message: belowCost
        ? "Price saved, but it is BELOW the purchase cost of this lot."
        : "Product pricing updated successfully.",
    };
  } catch (error) {
    await connection.rollback();
    console.error("Error updating product pricing:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Does the customer have a usable price?
 * CHANGED: with stockId it answers exactly what billing will do (lot -> default -> none).
 * FIX: the old query also counted inactive (Status 0) rows as "price exists".
 */
const getProductPrice = async (productId, customerId, stockId = null) => {
  const db = dbConnection.connection.promise();
  if (stockId) {
    const resolved = await resolveCustomerPrice(db, customerId, stockId, productId);
    return resolved ? [resolved] : [];
  }
  const [rows] = await db.query(
    `SELECT * FROM CustomerPricing WHERE CustomerId = ? AND ProductId = ? AND Status = 1`,
    [customerId, productId]
  );
  return rows;
};


/* =====================================================================
 * 8. EDIT A SALE
 * ===================================================================== */

/**
 * Edit a saved sale: change quantity / price / GST of lines, REMOVE lines and ADD new products.
 *
 *   updatedSales  [{ id, quantity, rate, sgst, cgst }]  existing lines (id = SalesItems.Id)
 *   removedRows   [SalesItems.Id, ...]                  lines to delete
 *   newLines      [{ stockId, quantity, rate?, sgst?, cgst? }]  products to add to this sale
 *                 rate empty  -> the customer's price for that lot (lot price -> default price)
 *                 sgst/cgst empty -> half of the product's current GST each
 *
 * Everything is ONE transaction: stock, stock ledger, invoice totals, voucher and customer ledger.
 * If anything is wrong NOTHING is saved.
 *
 * FIX (accounting): the old code created the NEW voucher and then deleted ALL vouchers of the
 *      sale (including the new one) - the ledger row pointed to a deleted voucher. Old postings are
 *      now removed FIRST, then re-posted.
 * FIX: it also ran UPDATE Sales (legacy table) with SalesItems ids and corrupted unrelated rows.
 * FIX: lines are verified to belong to THIS sale (the old edit page sent the SALE id for a removed
 *      row, so a removal could hit a line of a different invoice).
 * NEW: add products to the sale - the same batch + price + GST as a line already on the invoice is
 *      MERGED into that line (its quantity goes up, no second line); lines that become identical by an
 *      edit are combined too (never a line that has a sales return); a sale must keep at least one product; nothing changed = nothing
 *      written; a line cannot be reduced / removed below what was already returned; expired lots
 *      cannot be added or increased; stock updates are guarded; re-posting uses the original SaleDate.
 */
const updateSales = async (updatedSales, removedRows, customerId, saleId, userId, newLines = []) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    await connection.beginTransaction();
    const customerName = await getCustomerName(customerId);

    const [[saleHeader]] = await connection.query(
      `SELECT Id, InvoiceId, CustomerId, DATE_FORMAT(SaleDate, '%Y-%m-%d') AS SaleDate
         FROM SalesHeader WHERE Id = ? FOR UPDATE`,
      [saleId]
    );
    if (!saleHeader) throw new Error("Sale not found");
    if (Number(saleHeader.CustomerId) !== Number(customerId))
      throw new Error("This sale does not belong to the selected customer.");

    const invoiceId = saleHeader.InvoiceId;
    const saleDate = saleHeader.SaleDate || moment().format("YYYY-MM-DD");
    const todayDate = moment().format("YYYY-MM-DD");

    let removedCount = 0;
    let changedCount = 0;
    let addedCount = 0;
    let mergedCount = 0;

    /* 1. removed rows */
    const removeIds = toArray(removedRows).map(Number).filter(Boolean);
    if (removeIds.length) {
      const [items] = await connection.query(
        `SELECT Id, StockId, QuantitySold, IFNULL(ReturnedQty, 0) AS ReturnedQty
           FROM SalesItems WHERE Id IN (?) AND SaleId = ? FOR UPDATE`,
        [removeIds, saleId]
      );
      if (items.length !== removeIds.length) throw new Error("Some removed rows do not belong to this sale.");

      for (const item of items) {
        if (Number(item.ReturnedQty) > 0)
          throw new Error("A line that already has a sales return cannot be removed.");

        await connection.query(`UPDATE Stock SET Quantity = Quantity + ? WHERE Id = ?`,
          [item.QuantitySold, item.StockId]);
        await connection.query(
          `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Effect, Remarks)
           VALUES (?, ?, 'ADD', 'IN', ?)`,
          [item.StockId, item.QuantitySold,
           `Stock restored (sale edit, ${customerName}, invoice ${invoiceId})`]
        );
      }
      await connection.query(`DELETE FROM SalesItems WHERE Id IN (?) AND SaleId = ?`, [removeIds, saleId]);
      removedCount = items.length;
    }

    /* 2. changed rows */
    for (const u of toArray(updatedSales)) {
      const [[item]] = await connection.query(
        `SELECT Id, StockId, QuantitySold, SalePrice, Sgst, Cgst, IFNULL(ReturnedQty, 0) AS ReturnedQty
           FROM SalesItems WHERE Id = ? AND SaleId = ? FOR UPDATE`,
        [u.id, saleId]
      );
      if (!item) throw new Error("Sale item not found - reload the page and retry.");

      const newQty = Number(u.quantity);
      const rate = Number(u.rate);
      const sgst = Number(u.sgst);
      const cgst = Number(u.cgst);

      if (!Number.isInteger(newQty) || newQty <= 0)
        throw new Error("Quantity must be a whole number above 0 (remove the row instead).");
      if (newQty < Number(item.ReturnedQty))
        throw new Error(`Quantity cannot be below the already returned quantity (${item.ReturnedQty}).`);
      if (!(rate > 0) || !(sgst >= 0) || !(cgst >= 0)) throw new Error("Invalid rate or GST.");

      const unchanged =
        newQty === Number(item.QuantitySold) && round2(rate) === round2(item.SalePrice) &&
        round2(sgst) === round2(item.Sgst) && round2(cgst) === round2(item.Cgst);
      if (unchanged) continue;
      changedCount++;

      const taxable = round2(newQty * rate);
      const sgstAmt = round2((taxable * sgst) / 100);
      const cgstAmt = round2((taxable * cgst) / 100);
      const total = round2(taxable + sgstAmt + cgstAmt);

      await connection.query(
        `UPDATE SalesItems
            SET QuantitySold = ?, SalePrice = ?, Sgst = ?, Cgst = ?, SgstAmount = ?, CgstAmount = ?,
                TotalValue = ?, TotalValueWithTax = ?
          WHERE Id = ?`,
        [newQty, rate, sgst, cgst, sgstAmt, cgstAmt, taxable, total, item.Id]
      );

      const diff = Number(item.QuantitySold) - newQty;      // > 0  => stock goes back
      if (diff > 0) {
        await connection.query(`UPDATE Stock SET Quantity = Quantity + ? WHERE Id = ?`, [diff, item.StockId]);
        await connection.query(
          `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Effect, Remarks)
           VALUES (?, ?, 'ADD', 'IN', ?)`,
          [item.StockId, diff, `Sale updated ${invoiceId}`]
        );
      } else if (diff < 0) {
        const need = -diff;
        const [[lot]] = await connection.query(
          `SELECT s.BatchNumber, s.ExpiryDate, p.ProductName
             FROM Stock s JOIN Products p ON p.Id = s.ProductId WHERE s.Id = ?`,
          [item.StockId]
        );
        if (lot && moment(lot.ExpiryDate).isBefore(moment(), "day"))
          throw new Error(`${lot.ProductName} (Batch ${lot.BatchNumber}) is expired - its quantity cannot be increased.`);

        const [upd] = await connection.query(
          `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ? AND Quantity >= ?`,
          [need, item.StockId, need]
        );
        if (upd.affectedRows !== 1)
          throw new Error(`Insufficient stock to increase the quantity${lot ? ` of ${lot.ProductName} (Batch ${lot.BatchNumber})` : ""}.`);
        await connection.query(
          `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Effect, Remarks)
           VALUES (?, ?, 'REDUCE', 'OUT', ?)`,
          [item.StockId, need, `Sale updated ${invoiceId}`]
        );
      }
    }

    /* 3. NEW products added to this sale.
          Same batch + same price + same GST as a line that is ALREADY on the invoice (or as another new
          line)  ->  that line's quantity is increased; no second line is created. */
    const adds = toArray(newLines);
    if (adds.length) {
      const parsed = adds.map((a, i) => {
        const line = i + 1;
        const stockId = Number(a.stockId);
        const quantity = Number(a.quantity);
        const rate = a.rate === undefined || a.rate === null || String(a.rate).trim() === "" ? null : Number(a.rate);
        const sgst = a.sgst === undefined || a.sgst === null || String(a.sgst).trim() === "" ? null : Number(a.sgst);
        const cgst = a.cgst === undefined || a.cgst === null || String(a.cgst).trim() === "" ? null : Number(a.cgst);

        if (!Number.isInteger(stockId) || stockId <= 0) throw new Error(`New product ${line}: invalid stock.`);
        if (!Number.isInteger(quantity) || quantity <= 0)
          throw new Error(`New product ${line}: quantity must be a whole number above 0.`);
        if (rate !== null && !(rate > 0)) throw new Error(`New product ${line}: price must be above 0.`);
        if ((sgst !== null && !(sgst >= 0)) || (cgst !== null && !(cgst >= 0)))
          throw new Error(`New product ${line}: invalid GST %.`);
        return { stockId, quantity, rate, sgst, cgst };
      });

      const [lots] = await connection.query(
        `SELECT s.Id, s.ProductId, s.BatchNumber, s.Quantity, s.ExpiryDate, p.ProductName
           FROM Stock s JOIN Products p ON p.Id = s.ProductId
          WHERE s.Id IN (?) FOR UPDATE OF s`,
        [[...new Set(parsed.map((p) => p.stockId))]]
      );
      const lotMap = new Map(lots.map((l) => [Number(l.Id), l]));

      // resolve price + GST of every line, then group identical ones (same batch, price, GST)
      const groups = new Map();
      for (const p of parsed) {
        const lot = lotMap.get(p.stockId);
        if (!lot) throw new Error(`Stock ${p.stockId} not found.`);
        const label = `${lot.ProductName} (Batch ${lot.BatchNumber})`;
        if (moment(lot.ExpiryDate).isBefore(moment(), "day")) throw new Error(`${label} is expired and cannot be sold.`);

        let price = p.rate;
        if (price === null) {
          const resolved = await resolveCustomerPrice(connection, customerId, lot.Id, lot.ProductId);
          if (!resolved || !(resolved.price > 0))
            throw new Error(`No selling price set for ${label} for ${customerName}. Enter a price for it.`);
          price = resolved.price;
        }

        let sgst = p.sgst;
        let cgst = p.cgst;
        if (sgst === null || cgst === null) {
          const [[gstRow]] = await connection.query(
            `SELECT IGSTPercentage FROM PurchaseOrderDetails WHERE ProductId = ? ORDER BY Id DESC LIMIT 1`,
            [lot.ProductId]
          );
          if (!gstRow) throw new Error(`No GST rate known for ${label}. Enter SGST and CGST.`);
          if (sgst === null) sgst = Number(gstRow.IGSTPercentage) / 2;
          if (cgst === null) cgst = Number(gstRow.IGSTPercentage) / 2;
        }

        const key = `${lot.Id}|${round2(price).toFixed(2)}|${round2(sgst).toFixed(2)}|${round2(cgst).toFixed(2)}`;
        const g = groups.get(key);
        if (g) g.quantity += p.quantity;
        else groups.set(key, { lot, label, price, sgst, cgst, quantity: p.quantity });
      }

      for (const g of groups.values()) {
        const [upd] = await connection.query(
          `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ? AND Quantity >= ?`,
          [g.quantity, g.lot.Id, g.quantity]
        );
        if (upd.affectedRows !== 1)
          throw new Error(`Insufficient stock for ${g.label}. Available: ${g.lot.Quantity}, requested: ${g.quantity}`);

        // an identical line already on this invoice? -> add the quantity to it
        const [[same]] = await connection.query(
          `SELECT Id, QuantitySold FROM SalesItems
            WHERE SaleId = ? AND StockId = ? AND ROUND(SalePrice, 2) = ? AND ROUND(Sgst, 2) = ? AND ROUND(Cgst, 2) = ?
            ORDER BY Id LIMIT 1 FOR UPDATE`,
          [saleId, g.lot.Id, round2(g.price), round2(g.sgst), round2(g.cgst)]
        );

        if (same) {
          const totalQty = Number(same.QuantitySold) + g.quantity;
          const taxable = round2(totalQty * g.price);
          const sgstAmt = round2((taxable * g.sgst) / 100);
          const cgstAmt = round2((taxable * g.cgst) / 100);
          await connection.query(
            `UPDATE SalesItems
                SET QuantitySold = ?, SgstAmount = ?, CgstAmount = ?, TotalValue = ?, TotalValueWithTax = ?
              WHERE Id = ?`,
            [totalQty, sgstAmt, cgstAmt, taxable, round2(taxable + sgstAmt + cgstAmt), same.Id]
          );
          mergedCount++;
        } else {
          const taxable = round2(g.quantity * g.price);
          const sgstAmt = round2((taxable * g.sgst) / 100);
          const cgstAmt = round2((taxable * g.cgst) / 100);
          await connection.query(
            `INSERT INTO SalesItems
               (SaleId, StockId, QuantitySold, SalePrice, Sgst, SgstAmount, Cgst, CgstAmount,
                TotalValue, TotalValueWithTax, CreatedAt, ReturnedQty)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [saleId, g.lot.Id, g.quantity, g.price, g.sgst, sgstAmt, g.cgst, cgstAmt, taxable,
             round2(taxable + sgstAmt + cgstAmt), todayDate]
          );
          addedCount++;
        }

        await connection.query(
          `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Effect, Remarks)
           VALUES (?, ?, 'REDUCE', 'OUT', ?)`,
          [g.lot.Id, g.quantity, `Sale updated ${invoiceId} (${same ? "quantity added to an existing line" : "product added"})`]
        );
      }
    }

    /* 4. a sale must keep at least one product; nothing changed -> nothing written */
    const [[lineCount]] = await connection.query(`SELECT COUNT(*) AS c FROM SalesItems WHERE SaleId = ?`, [saleId]);
    if (Number(lineCount.c) === 0) throw new Error("A sale must keep at least one product.");

    if (!removedCount && !changedCount && !addedCount && !mergedCount) {
      await connection.rollback();
      return `No changes were made to sale ${invoiceId}.`;
    }

    /* 4b. ONE LINE per batch + price + GST: identical lines are combined (however they came about:
           an add, a price edit that made two lines equal, or older data). Lines that have a sales
           return are never touched, so credit notes keep pointing at the right line.
           Stock is unaffected (the quantities only move from one line to another). */
    const [dupGroups] = await connection.query(
      `SELECT StockId, ROUND(SalePrice, 2) AS P, ROUND(Sgst, 2) AS G1, ROUND(Cgst, 2) AS G2, COUNT(*) AS C
         FROM SalesItems
        WHERE SaleId = ?
        GROUP BY StockId, ROUND(SalePrice, 2), ROUND(Sgst, 2), ROUND(Cgst, 2)
       HAVING COUNT(*) > 1 AND SUM(IFNULL(ReturnedQty, 0)) = 0`,
      [saleId]
    );
    for (const grp of dupGroups) {
      const [members] = await connection.query(
        `SELECT Id, QuantitySold, SalePrice, Sgst, Cgst FROM SalesItems
          WHERE SaleId = ? AND StockId = ? AND ROUND(SalePrice, 2) = ? AND ROUND(Sgst, 2) = ? AND ROUND(Cgst, 2) = ?
          ORDER BY Id FOR UPDATE`,
        [saleId, grp.StockId, grp.P, grp.G1, grp.G2]
      );
      if (members.length < 2) continue;
      const keep = members[0];
      const totalQty = members.reduce((s, m) => s + Number(m.QuantitySold), 0);
      const taxable = round2(totalQty * Number(keep.SalePrice));
      const sgstAmt = round2((taxable * Number(keep.Sgst)) / 100);
      const cgstAmt = round2((taxable * Number(keep.Cgst)) / 100);
      await connection.query(
        `UPDATE SalesItems
            SET QuantitySold = ?, SgstAmount = ?, CgstAmount = ?, TotalValue = ?, TotalValueWithTax = ?
          WHERE Id = ?`,
        [totalQty, sgstAmt, cgstAmt, taxable, round2(taxable + sgstAmt + cgstAmt), keep.Id]
      );
      await connection.query(`DELETE FROM SalesItems WHERE Id IN (?) AND SaleId = ?`,
        [members.slice(1).map((m) => m.Id), saleId]);
      mergedCount += members.length - 1;
    }

    /* 5. totals */
    const [[totals]] = await connection.query(
      `SELECT IFNULL(SUM(TotalValue), 0) AS withoutTax, IFNULL(SUM(SgstAmount), 0) AS sgst,
              IFNULL(SUM(CgstAmount), 0) AS cgst, IFNULL(SUM(TotalValueWithTax), 0) AS withTax
         FROM SalesItems WHERE SaleId = ?`,
      [saleId]
    );
    const totalWithTax = round2(totals.withTax);

    await connection.query(
      `UPDATE SalesHeader
          SET TotalAmountWithoutTax = ?, TotalSgst = ?, TotalCgst = ?, TotalAmountWithTax = ?
        WHERE Id = ?`,
      [round2(totals.withoutTax), round2(totals.sgst), round2(totals.cgst), totalWithTax, saleId]
    );

    /* 6. accounting: remove the OLD postings first, then re-post */
    const financialYear = await getFinancialYear(saleDate);

    await connection.query(
      `DELETE FROM CustomerLedger
        WHERE CustomerId = ? AND ReferenceId = ? AND ReferenceType = 'INVOICE' AND TransactionType = 'SALE'`,
      [customerId, saleId]
    );
    const [oldVouchers] = await connection.query(
      `SELECT Id FROM Vouchers WHERE ReferenceId = ? AND ReferenceType = 'Sale' AND VoucherType = 'SALE'`,
      [saleId]
    );
    if (oldVouchers.length) {
      const ids = oldVouchers.map((v) => v.Id);
      await connection.query(`DELETE FROM LedgerEntries WHERE VoucherId IN (?)`, [ids]);
      await connection.query(`DELETE FROM Vouchers WHERE Id IN (?)`, [ids]);
    }

    const voucherId = await createSaleEntry({
      connection, customerId, invoiceId, insertedSaleId: saleId, saleDate,
      totalAmount: totalWithTax, userId,
    });

    await connection.query(
      `INSERT INTO CustomerLedger
         (CustomerId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId,
          ReferenceNo, DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'SALE', 'INVOICE', ?, ?, ?, 0, ?, ?)`,
      [customerId, financialYear, saleDate, saleId, invoiceId, totalWithTax,
       `Updated Sale ${invoiceId}`, voucherId]
    );

    await connection.commit();

    const parts = [];
    if (addedCount) parts.push(`${addedCount} product${addedCount > 1 ? "s" : ""} added`);
    if (mergedCount) parts.push(`${mergedCount} merged into existing line${mergedCount > 1 ? "s" : ""}`);
    if (removedCount) parts.push(`${removedCount} removed`);
    if (changedCount) parts.push(`${changedCount} changed`);
    return `Sale with ${invoiceId} updated successfully (${parts.join(", ")})`;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * NEW: lots that can be added to a sale of this customer, with the price billing would use and
 * their supplier (the page asks supplier -> product -> batch).
 * Only lots with stock that are not expired. PriceSource: LOT (price saved for the batch),
 * DEFAULT (customer's product default) or NONE (the user has to type a price).
 */
const getAddableStockForSale = async (customerId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT stk.Id AS StockId, p.Id AS ProductId, p.ProductName, p.Hsn, p.SupplierId, sup.Name AS SupplierName,
            stk.BatchNumber, stk.Quantity,
            DATE_FORMAT(stk.ExpiryDate, '%d-%m-%Y') AS ExpiryDate, stk.MRP,
            (SELECT IGSTPercentage FROM PurchaseOrderDetails WHERE ProductId = p.Id ORDER BY Id DESC LIMIT 1) AS IGSTPercentage,
            cp.SellingPrice AS LotPrice, dp.SellingPrice AS DefaultPrice
       FROM Stock stk
       JOIN Products p   ON p.Id = stk.ProductId
       JOIN Suppliers sup ON sup.Id = p.SupplierId
       LEFT JOIN CustomerPricing cp ON cp.Id = (
             SELECT c1.Id FROM CustomerPricing c1
              WHERE c1.CustomerId = ? AND c1.StockId = stk.Id AND c1.Status = 1
              ORDER BY c1.UpdatedAt DESC, c1.Id DESC LIMIT 1)
       LEFT JOIN CustomerPricing dp ON dp.Id = (
             SELECT c2.Id FROM CustomerPricing c2
              WHERE c2.CustomerId = ? AND c2.ProductId = p.Id AND c2.StockId IS NULL AND c2.Status = 1
              ORDER BY c2.UpdatedAt DESC, c2.Id DESC LIMIT 1)
      WHERE stk.Quantity > 0 AND stk.ExpiryDate >= CURDATE()
      ORDER BY sup.Name, p.ProductName, stk.ExpiryDate, stk.BatchNumber`,
    [customerId, customerId]
  );

  return rows.map((r) => {
    let price = null;
    let source = "NONE";
    if (r.LotPrice !== null) { price = Number(r.LotPrice); source = "LOT"; }
    else if (ALLOW_PRODUCT_DEFAULT_PRICE && r.DefaultPrice !== null) { price = Number(r.DefaultPrice); source = "DEFAULT"; }
    return {
      StockId: r.StockId, ProductId: r.ProductId, ProductName: r.ProductName, Hsn: r.Hsn,
      SupplierId: r.SupplierId, SupplierName: r.SupplierName,
      BatchNumber: r.BatchNumber, Quantity: Number(r.Quantity), ExpiryDate: r.ExpiryDate,
      MRP: r.MRP === null ? null : Number(r.MRP),
      IGSTPercentage: r.IGSTPercentage === null ? null : Number(r.IGSTPercentage),
      CustomerPrice: price, PriceSource: source,
    };
  });
};


/**
 * NEW: the customer's saved price for the given stock rows, as { [stockId]: { price, source } | null }.
 * Same rule billing uses: price saved for the batch -> customer's product default -> nothing.
 * The edit-sale page shows it next to every line so you do not have to remember prices.
 */
const getCustomerPricesForStock = async (customerId, stockIds) => {
  const ids = [...new Set(toArray(stockIds).map(Number).filter((x) => x > 0))];
  const out = {};
  if (!ids.length) return out;

  const [rows] = await dbConnection.connection.promise().query(
    `SELECT stk.Id AS StockId, cp.SellingPrice AS LotPrice, dp.SellingPrice AS DefaultPrice
       FROM Stock stk
       LEFT JOIN CustomerPricing cp ON cp.Id = (
             SELECT c1.Id FROM CustomerPricing c1
              WHERE c1.CustomerId = ? AND c1.StockId = stk.Id AND c1.Status = 1
              ORDER BY c1.UpdatedAt DESC, c1.Id DESC LIMIT 1)
       LEFT JOIN CustomerPricing dp ON dp.Id = (
             SELECT c2.Id FROM CustomerPricing c2
              WHERE c2.CustomerId = ? AND c2.ProductId = stk.ProductId AND c2.StockId IS NULL AND c2.Status = 1
              ORDER BY c2.UpdatedAt DESC, c2.Id DESC LIMIT 1)
      WHERE stk.Id IN (?)`,
    [customerId, customerId, ids]
  );

  rows.forEach((r) => {
    if (r.LotPrice !== null) out[r.StockId] = { price: Number(r.LotPrice), source: "LOT" };
    else if (ALLOW_PRODUCT_DEFAULT_PRICE && r.DefaultPrice !== null) out[r.StockId] = { price: Number(r.DefaultPrice), source: "DEFAULT" };
    else out[r.StockId] = null;
  });
  return out;
};


/* =====================================================================
 * 9. CHALLANS
 * ===================================================================== */

const getChallanDetails = async (customerId, challanId) => {
  const [rows] = await dbConnection.execute(
    `SELECT c.ChallanId, c.ChallanDate, c.Remarks, ci.StockId, ci.QuantitySold,
            s.BatchNumber, s.ExpiryDate, p.ProductName
       FROM Challan c
       JOIN Customers cust ON c.CustomerId = cust.Id
       JOIN ChallanItems ci ON c.ChallanId = ci.ChallanId
       JOIN Stock s ON ci.StockId = s.Id
       JOIN Products p ON s.ProductId = p.Id
      WHERE c.CustomerId = ? AND c.ChallanId = ?`,
    [customerId, challanId]
  );
  return rows;
};

/** Challans grouped by customer -> challan, with the sale (if converted). */
const getAllChallans = async (filters) => {
  try {
    const { fromDate, toDate, customerId, challanId } = filters;
    const { from, to } = helper.getDateRange(fromDate, toDate);

    let query = `
      SELECT c.ChallanId, c.ChallanDate, c.Status, c.Remarks, cust.CustomerName, cust.Id AS CustomerId,
             ci.StockId, ci.QuantitySold, s.BatchNumber, s.ExpiryDate, p.ProductName,
             shi.Id AS SaleItemId, sh.Id AS SaleHeaderId, sh.InvoiceId
        FROM Challan c
        JOIN Customers cust ON c.CustomerId = cust.Id
        JOIN ChallanItems ci ON c.ChallanId = ci.ChallanId
        JOIN Stock s ON ci.StockId = s.Id
        JOIN Products p ON s.ProductId = p.Id
        LEFT JOIN SalesHeader sh ON sh.ChallanId = c.ChallanId
        LEFT JOIN SalesItems shi ON shi.SaleId = sh.Id AND shi.StockId = ci.StockId
       WHERE c.ChallanDate >= ? AND c.ChallanDate < DATE_ADD(?, INTERVAL 1 DAY)`;
    const params = [from, to];

    if (customerId) { query += ` AND c.CustomerId = ?`; params.push(customerId); }
    if (challanId) { query += ` AND c.ChallanId = ?`; params.push(challanId); }
    query += ` ORDER BY cust.CustomerName, c.ChallanDate DESC, c.ChallanId, ci.StockId`;

    const [rows] = await dbConnection.connection.promise().query(query, params);

    const groupedChallans = {};
    rows.forEach((row) => {
      const custId = row.CustomerId;
      const challanKey = row.ChallanId;

      if (!groupedChallans[custId])
        groupedChallans[custId] = { CustomerName: row.CustomerName, challans: {} };

      if (!groupedChallans[custId].challans[challanKey]) {
        groupedChallans[custId].challans[challanKey] = {
          ChallanDate: row.ChallanDate, Status: row.Status, Remarks: row.Remarks,
          InvoiceId: row.InvoiceId || null, SaleHeaderId: row.SaleHeaderId || null,
          items: [], SaleItemIds: [],
        };
      }
      const challan = groupedChallans[custId].challans[challanKey];

      if (row.SaleItemId && !challan.SaleItemIds.includes(row.SaleItemId))
        challan.SaleItemIds.push(row.SaleItemId);

      challan.items.push({
        StockId: row.StockId, QuantitySold: row.QuantitySold, BatchNumber: row.BatchNumber,
        ExpiryDate: row.ExpiryDate, ProductName: row.ProductName, SaleItemId: row.SaleItemId || null,
      });
    });
    return groupedChallans;
  } catch (error) {
    console.error("Error fetching challans:", error.message);
    throw new Error("Failed to fetch challans. Please try again.");
  }
};

/**
 * Cancels a challan and puts the stock back.
 * FIX: the 'ADD' stock-ledger rows had no Effect (stored as IN only by accident).
 * FIX: the connection is released in `finally`; the "already converted" check runs
 *      inside the transaction on a locked challan row.
 */
const cancelTheChallan = async (challanId) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    await connection.beginTransaction();

    const [[challan]] = await connection.query(
      `SELECT Status FROM Challan WHERE ChallanId = ? FOR UPDATE`, [challanId]);
    if (!challan) throw new Error(`Challan ${challanId} not found.`);

    const [converted] = await connection.query(`SELECT Id FROM SalesHeader WHERE ChallanId = ?`, [challanId]);
    if (converted.length > 0)
      throw new Error(
        `Challan ${challanId} has already been converted to Sale(s) with Id: ` +
        `${converted.map((r) => r.Id).join(", ")}.You have to go sales view to cancel the sale.`
      );
    if (challan.Status === "Cancelled") throw new Error(`Challan ${challanId} has already been cancelled`);

    await connection.query(`UPDATE Challan SET Status = 'Cancelled' WHERE ChallanId = ?`, [challanId]);

    const [rows] = await connection.query(
      `SELECT StockId, QuantitySold FROM ChallanItems WHERE ChallanId = ?`, [challanId]);

    for (const { StockId, QuantitySold } of rows) {
      await connection.query(`UPDATE Stock SET Quantity = Quantity + ? WHERE Id = ?`, [QuantitySold, StockId]);
      await connection.query(
        `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Remarks, Timestamp)
         VALUES (?, 'ADD', 'IN', ?, ?, NOW())`,
        [StockId, QuantitySold, `Cancelled Challan #${challanId}`]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error(error);
    throw error;
  } finally {
    connection.release();
  }
};

/** Marks a challan as delivered. */
const deliverTheProduct = async (challanId) => {
  const [challanStatus] = await dbConnection.execute(
    `SELECT * FROM Challan WHERE Status = 'Delivered' AND ChallanId = ?`, [challanId]);
  if (challanStatus.length > 0) throw new Error(`challan ${challanId} has already been delivered.`);

  await dbConnection.connection.promise().query(
    `UPDATE Challan SET Status = 'Delivered' WHERE ChallanId = ?`, [challanId]);
};

/** Sales created from a challan (rows of SalesHeader). */
const isChallanAlreadyConvertedToSale = async (challanId) => {
  const [rows] = await dbConnection.execute(`SELECT * FROM SalesHeader WHERE ChallanId = ?`, [challanId]);
  return rows;
};

/**
 * Converts a challan into a sale (stock was already reduced by the challan).
 * CHANGED: same price rule as createSale (lot price -> product default -> block).
 * FIX: the IGST lookup joined `pod.Id = i.PurchaseOrderId` (a PO line id compared
 *      with a PO id) -> wrong GST or "No IGST". The product's CURRENT GST (latest PO
 *      line) is used, falling back to the lot's GST.
 * FIX: the price lookup ignored the lot (same bug as createSale).
 * FIX: double conversion race - the challan row is locked and the "already converted"
 *      check runs inside the transaction. The stock-ledger audit rows get an Effect.
 * NEW: the challan must belong to the customer; every line is rounded.
 */
const convertToSale = async (challanId, customerId, userId) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    await connection.beginTransaction();

    const [[challan]] = await connection.query(
      `SELECT ChallanId, CustomerId, Status FROM Challan WHERE ChallanId = ? FOR UPDATE`, [challanId]);
    if (!challan) throw new Error(`Challan with Id ${challanId} does not exist.`);
    if (Number(challan.CustomerId) !== Number(customerId))
      throw new Error("This challan does not belong to the selected customer.");
    if (challan.Status === "Cancelled") throw new Error("Challan already cancelled.");

    const [existing] = await connection.query(`SELECT Id FROM SalesHeader WHERE ChallanId = ?`, [challanId]);
    if (existing.length) throw new Error(`Already converted to Sale(s): ${existing.map((r) => r.Id).join(", ")}`);

    if (challan.Status === "Pending")
      await connection.query(`UPDATE Challan SET Status = 'Delivered' WHERE ChallanId = ?`, [challanId]);

    const [challanItems] = await connection.query(
      `SELECT StockId, SUM(QuantitySold) AS QuantitySold FROM ChallanItems WHERE ChallanId = ? GROUP BY StockId`,
      [challanId]
    );
    if (!challanItems.length) throw new Error("No items in challan");

    const todayDate = moment().format("YYYY-MM-DD");
    const financialYear = await getFinancialYear();
    const customerName = await getCustomerName(customerId);
    const invoiceId = await generateDocumentNumber(connection, "SALESINVOICE");

    let totalValueSum = 0, totalSgstSum = 0, totalCgstSum = 0, totalInvoiceAmount = 0;
    const lineRows = [];
    const stockLog = [];

    for (const item of challanItems) {
      const qty = Number(item.QuantitySold);

      const [[lot]] = await connection.query(
        `SELECT s.Id, s.ProductId, s.BatchNumber, s.IgstPercentage, p.ProductName
           FROM Stock s JOIN Products p ON p.Id = s.ProductId WHERE s.Id = ?`,
        [item.StockId]
      );
      if (!lot) throw new Error(`Stock ${item.StockId} not found`);

      const resolved = await resolveCustomerPrice(connection, customerId, lot.Id, lot.ProductId);
      if (!resolved || !(resolved.price > 0))
        throw new Error(`No price for ${lot.ProductName} (Batch ${lot.BatchNumber}) for customer ${customerName}`);

      const [[gstRow]] = await connection.query(
        `SELECT IGSTPercentage FROM PurchaseOrderDetails WHERE ProductId = ? ORDER BY Id DESC LIMIT 1`,
        [lot.ProductId]
      );
      const igst = gstRow ? Number(gstRow.IGSTPercentage)
                          : lot.IgstPercentage !== null ? Number(lot.IgstPercentage) : null;
      if (igst === null || Number.isNaN(igst)) throw new Error(`No GST rate for ${lot.ProductName}`);
      const sgst = igst / 2;
      const cgst = igst / 2;

      const taxable = round2(qty * resolved.price);
      const sgstAmt = round2((taxable * sgst) / 100);
      const cgstAmt = round2((taxable * cgst) / 100);
      const withTax = round2(taxable + sgstAmt + cgstAmt);

      totalValueSum += taxable; totalSgstSum += sgstAmt;
      totalCgstSum += cgstAmt; totalInvoiceAmount += withTax;

      lineRows.push([lot.Id, qty, resolved.price, sgst, sgstAmt, cgst, cgstAmt, taxable, withTax]);
      stockLog.push([lot.Id, 0, "UPDATE", "OUT", `Challan ${challanId} -> Sale ${invoiceId}`, new Date()]);
    }
    totalValueSum = round2(totalValueSum); totalSgstSum = round2(totalSgstSum);
    totalCgstSum = round2(totalCgstSum); totalInvoiceAmount = round2(totalInvoiceAmount);

    const [headerResult] = await connection.query(
      `INSERT INTO SalesHeader
         (CustomerId, InvoiceId, ChallanId, TotalAmountWithTax, TotalAmountWithoutTax, TotalSgst, TotalCgst,
          Status, CreatedAt, CreatedBy, FinancialYear, SaleDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [customerId, invoiceId, challanId, totalInvoiceAmount, totalValueSum, totalSgstSum, totalCgstSum,
       todayDate, userId, financialYear, todayDate]
    );
    const newSaleId = headerResult.insertId;

    await connection.query(
      `INSERT INTO SalesItems
         (SaleId, StockId, QuantitySold, SalePrice, Sgst, SgstAmount, Cgst, CgstAmount,
          TotalValue, TotalValueWithTax, CreatedAt, ReturnedQty)
       VALUES ?`,
      [lineRows.map((r) => [newSaleId, ...r, todayDate, 0])]
    );

    // audit rows only - the stock was already reduced when the challan was created
    await connection.query(
      `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Effect, Remarks, TimeStamp) VALUES ?`,
      [stockLog]
    );

    const voucherId = await createSaleEntry({
      connection, customerId, invoiceId, insertedSaleId: newSaleId, saleDate: todayDate,
      totalAmount: totalInvoiceAmount, userId,
    });

    await connection.execute(
      `INSERT INTO CustomerLedger
         (CustomerId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId,
          ReferenceNo, DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'SALE', 'INVOICE', ?, ?, ?, 0, ?, ?)`,
      [customerId, financialYear, todayDate, newSaleId, invoiceId, totalInvoiceAmount,
       `Sale ${invoiceId}`, voucherId]
    );

    await connection.commit();
    return { saleId: newSaleId, invoiceId };
  } catch (error) {
    await connection.rollback();
    console.error("Error in convertToSale:", error);
    throw error;
  } finally {
    connection.release();
  }
};


/* =====================================================================
 * 10. STOCK REPORTS
 * ===================================================================== */

/**
 * Supplier-wise stock / sales report.
 * CHANGED: cost comes from the lot (s.PurchasePrice) and rows are per lot (s.Id);
 *          CreatedAt is returned (the excel "Added On" column was always empty).
 */
const getSalesReportSupplierWise = async (fromDate, toDate, supplierId = "") => {
  const FromDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
  const ToDate = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");

  const salesReportQuery = `
    SELECT p.ProductName, s.BatchNumber, s.PurchasePrice,
           DATE_FORMAT(s.ExpiryDate, '%d %b %Y') AS ExpiryDate, s.CreatedAt,
           (s.Quantity + COALESCE(SUM(CASE
              WHEN sh.CreatedAt BETWEEN CONCAT(?, ' 00:00:00') AND CONCAT(?, ' 23:59:59')
              THEN si.QuantitySold END), 0)) AS OpeningQuantity,
           COALESCE(SUM(CASE
              WHEN sh.CreatedAt BETWEEN CONCAT(?, ' 00:00:00') AND CONCAT(?, ' 23:59:59')
              THEN si.QuantitySold END), 0) AS QuantitySold,
           s.Quantity AS RemainingQuantity,
           COALESCE(SUM(CASE
              WHEN sh.CreatedAt BETWEEN CONCAT(?, ' 00:00:00') AND CONCAT(?, ' 23:59:59')
              THEN si.TotalValue END), 0) AS SalesTotalValue,
           sup.Name AS SupplierName,
           (s.Quantity * s.PurchasePrice) AS RemainingStockTotalPrice
      FROM Stock s
      JOIN Products p ON s.ProductId = p.Id
      LEFT JOIN Suppliers sup ON p.SupplierId = sup.Id
      LEFT JOIN SalesItems si ON si.StockId = s.Id
      LEFT JOIN SalesHeader sh ON sh.Id = si.SaleId
     WHERE (? IS NULL OR ? = '' OR p.SupplierId = ?)
     GROUP BY s.Id, p.ProductName, s.BatchNumber, s.Quantity, s.PurchasePrice, sup.Name,
              s.ExpiryDate, s.CreatedAt
     ORDER BY p.ProductName, s.BatchNumber, s.ExpiryDate`;

  const [rows] = await dbConnection.execute(salesReportQuery, [
    FromDate, ToDate, FromDate, ToDate, FromDate, ToDate, supplierId, supplierId, supplierId,
  ]);
  return rows;
};

/**
 * Non-moving / expiring stock list.
 * CHANGED: cost from the lot; BatchQuantity (current + sold) is returned because the
 *          excel export reads it.
 */
const getNonMovableStocks = async (supplierId, search, page, pageSize) => {
  const offset = (page - 1) * pageSize;

  const sql = `
    SELECT *
      FROM (
        SELECT sup.Id AS SupplierId, sup.Name AS SupplierName,
               p.Id AS ProductId, p.ProductName AS ProductName,
               s.Id AS StockId, s.BatchNumber, s.Quantity AS CurrentStock,
               (s.Quantity + IFNULL(SUM(si.QuantitySold), 0)) AS BatchQuantity,
               s.ExpiryDate, s.CreatedAt AS StockCreatedAt,
               IFNULL(SUM(si.QuantitySold), 0) AS QuantitySold,
               MAX(sh.SaleDate) AS LastSaleDate,
               COALESCE(MAX(sh.SaleDate), s.CreatedAt) AS BaselineDate,
               DATEDIFF(CURDATE(), COALESCE(MAX(sh.SaleDate), s.CreatedAt)) AS MovementAgeDays,
               s.PurchasePrice,
               (s.Quantity * s.PurchasePrice) AS ValueAtCost,
               CASE
                 WHEN s.ExpiryDate < CURDATE() THEN 'EXPIRED'
                 WHEN s.ExpiryDate BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 MONTH) THEN 'EXPIRING_SOON'
                 WHEN DATEDIFF(CURDATE(), COALESCE(MAX(sh.SaleDate), s.CreatedAt)) >= 60 THEN 'NON_MOVING'
                 ELSE 'OK'
               END AS StatusFlag
          FROM Stock s
          JOIN Products p   ON p.Id = s.ProductId
          JOIN Suppliers sup ON sup.Id = s.SupplierId
          LEFT JOIN SalesItems si ON si.StockId = s.Id
          LEFT JOIN SalesHeader sh ON sh.Id = si.SaleId
         WHERE (? IS NULL OR s.SupplierId = ?)
           AND (? = '' OR CAST(p.ProductName AS CHAR CHARACTER SET utf8mb4)
                          LIKE CONCAT('%', CAST(? AS CHAR CHARACTER SET utf8mb4), '%'))
           AND s.Quantity > 0
         GROUP BY s.Id, sup.Id, p.Id
      ) x
     ORDER BY FIELD(CAST(x.StatusFlag AS CHAR CHARACTER SET utf8mb4),
                    'EXPIRED', 'EXPIRING_SOON', 'NON_MOVING', 'OK'),
              x.ExpiryDate, x.BaselineDate
     LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`;

  const [rows] = await dbConnection.query(sql, [supplierId, supplierId, search, search]);
  return rows;
};

/** FIX: the summary did not filter `s.Quantity > 0` like the list does -> wrong counts / pages. */
const getNonMovableSummary = async (supplierId, search) => {
  const sql = `
    SELECT COUNT(*) AS totalCount, SUM(CurrentStock) AS totalCurrentStock,
           SUM(CASE WHEN StatusFlag = 'EXPIRED' THEN 1 ELSE 0 END) AS expiredCount,
           SUM(CASE WHEN StatusFlag = 'EXPIRING_SOON' THEN 1 ELSE 0 END) AS expiringSoonCount,
           SUM(CASE WHEN StatusFlag = 'NON_MOVING' THEN 1 ELSE 0 END) AS nonMovingCount
      FROM (
        SELECT s.Quantity AS CurrentStock,
               CASE
                 WHEN s.ExpiryDate < CURDATE() THEN 'EXPIRED'
                 WHEN s.ExpiryDate BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 MONTH) THEN 'EXPIRING_SOON'
                 WHEN DATEDIFF(CURDATE(), COALESCE(MAX(sh.SaleDate), s.CreatedAt)) >= 60 THEN 'NON_MOVING'
                 ELSE 'OK'
               END AS StatusFlag
          FROM Stock s
          JOIN Products p ON p.Id = s.ProductId
          LEFT JOIN SalesItems si ON si.StockId = s.Id
          LEFT JOIN SalesHeader sh ON sh.Id = si.SaleId
         WHERE (? IS NULL OR s.SupplierId = ?)
           AND (? = '' OR CAST(p.ProductName AS CHAR CHARACTER SET utf8mb4)
                          LIKE CONCAT('%', CAST(? AS CHAR CHARACTER SET utf8mb4), '%'))
           AND s.Quantity > 0
         GROUP BY s.Id
      ) x`;
  const [rows] = await dbConnection.execute(sql, [supplierId, supplierId, search, search]);
  return rows[0] || {};
};

/** Expired stock still on hand (paginated). */
const getExpiredProductDetails = async (req) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const { productId, supplierId } = req.query;

  let whereClause = `WHERE Stock.Quantity > 0 AND Stock.ExpiryDate < CURDATE()`;
  const params = [];
  if (supplierId) { whereClause += ` AND Stock.SupplierId = ?`; params.push(supplierId); }
  if (productId) { whereClause += ` AND Products.Id = ?`; params.push(productId); }

  const dataQuery = `
    SELECT Stock.Id, Products.Id AS ProductId, Products.ProductName, Stock.BatchNumber, Stock.Quantity,
           DATE_FORMAT(Stock.ExpiryDate, '%d-%m-%Y') AS ExpiryDate, Stock.CreatedAt,
           Suppliers.Name AS SupplierName, Stock.SupplierId,
           (SELECT IGSTPercentage FROM PurchaseOrderDetails
             WHERE ProductId = Products.Id ORDER BY Id DESC LIMIT 1) AS IGSTPercentage
      FROM Stock
      JOIN Products ON Stock.ProductId = Products.Id
      LEFT JOIN Suppliers ON Stock.SupplierId = Suppliers.Id
      ${whereClause}
     ORDER BY Stock.ExpiryDate ASC
     LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

  const countQuery = `
    SELECT COUNT(*) AS total FROM Stock JOIN Products ON Stock.ProductId = Products.Id ${whereClause}`;

  const db = dbConnection.connection.promise();
  const [[countResult]] = await db.execute(countQuery, params);
  const [rows] = await db.execute(dataQuery, [...params]);

  return {
    currentPage: page, pageSize: limit, totalRecords: countResult.total,
    totalPages: Math.ceil(countResult.total / limit), data: rows,
  };
};

/**
 * Moves selected expired stock into ExpiredStock, logs it and zeroes the stock.
 * CHANGED: the ledger row is Effect 'OUT' with a POSITIVE quantity (it used to be an
 *          'IN' row with a negative quantity which polluted the stock history totals);
 *          cost / GST come from the lot, the INNER JOIN on InvoiceDetails is gone.
 * FIX: throws if some row could not be moved instead of silently skipping it.
 */
const moveExpiredProduct = async (stockIds, userId) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    const ids = toArray(stockIds).map(Number).filter(Boolean);
    if (!ids.length) throw new Error("No stock selected.");

    await connection.beginTransaction();

    const [validStocks] = await connection.query(
      `SELECT Id FROM Stock WHERE Id IN (?) AND Quantity > 0 AND ExpiryDate < CURDATE() FOR UPDATE`, [ids]);
    if (validStocks.length !== ids.length)
      throw new Error("Some stocks are not expired or have zero quantity.");

    const [ins] = await connection.query(
      `INSERT INTO ExpiredStock
         (StockId, InvoiceId, ProductId, SupplierId, BatchNumber, ExpiryDate, ExpiredQty,
          PurchasePrice, GSTPercent, ExpiredAmount, RemainingAmount, MovedBy)
       SELECT s.Id, s.InvoiceId, s.ProductId, s.SupplierId, s.BatchNumber, s.ExpiryDate, s.Quantity,
              s.PurchasePrice, IFNULL(s.IgstPercentage, 0),
              ROUND(s.Quantity * s.PurchasePrice * (1 + IFNULL(s.IgstPercentage, 0) / 100), 2),
              ROUND(s.Quantity * s.PurchasePrice * (1 + IFNULL(s.IgstPercentage, 0) / 100), 2), ?
         FROM Stock s WHERE s.Id IN (?)`,
      [userId, ids]
    );
    if (ins.affectedRows !== ids.length) throw new Error("Some stock could not be moved to expired stock.");

    await connection.query(
      `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, TimeStamp, Remarks)
       SELECT s.Id, 'EXPIRED', 'OUT', s.Quantity, NOW(), 'Stock moved due to expiry'
         FROM Stock s WHERE s.Id IN (?)`,
      [ids]
    );

    await connection.query(`UPDATE Stock SET Quantity = 0 WHERE Id IN (?)`, [ids]);

    await connection.commit();
    return "Expired stock moved successfully.";
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};


/* =====================================================================
 * 11. PRODUCT PRICE HISTORY / EXPIRED STOCK SETTLEMENT (price reduction)
 * ===================================================================== */

/**
 * Purchase price history of a product (paginated).
 * FIX: the connection was never released (leaked one connection per page view).
 */
const getProductPriceHistory = async (productId, supplierId, page = 1, limit = 20) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    if (!productId) throw new Error("ProductId is required.");
    const offset = (page - 1) * limit;

    const [[{ total }]] = await connection.execute(
      `SELECT COUNT(*) AS total FROM PurchaseOrderDetails pod WHERE pod.ProductId = ?`, [productId]);

    const dataQuery = `
      SELECT pod.PurchasePrice, pod.PurchaseOrderId, inv.SupplierInvoiceNo, po.PoDate,
             p.Id AS ProductId, p.ProductName, p.SupplierId, s.Name AS SupplierName
        FROM PurchaseOrderDetails pod
        JOIN Products p ON pod.ProductId = p.Id
        JOIN PurchaseOrders po ON pod.PurchaseOrderId = po.Id
        JOIN Suppliers s ON p.SupplierId = s.Id
        LEFT JOIN (
          SELECT PurchaseOrderId, MAX(SupplierInvoiceNo) AS SupplierInvoiceNo
            FROM Invoices GROUP BY PurchaseOrderId
        ) inv ON inv.PurchaseOrderId = pod.PurchaseOrderId
       WHERE pod.ProductId = ?
       ORDER BY pod.PurchaseOrderId ASC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

    const [rows] = await connection.execute(dataQuery, [productId]);

    return {
      data: rows,
      pagination: {
        totalRecords: total, totalPages: Math.ceil(total / limit), currentPage: page, limit,
      },
    };
  } catch (error) {
    console.error("Error fetching product purchase price history:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/** Moved-expired list with supplier / status filter and pagination. */
const getListOfMovedExpiredProduct = async ({ supplierId, status, limit, offset }) => {
  const whereConditions = [];
  const params = [];

  if (supplierId) { whereConditions.push("es.SupplierId = ?"); params.push(supplierId); }

  if (status) {
    if (status === "PENDING")
      whereConditions.push("(es.ExpiredAmount - IFNULL(es.SettledAmount,0)) > 0 AND IFNULL(es.SettledAmount,0) = 0");
    else if (status === "PARTIAL")
      whereConditions.push("IFNULL(es.SettledAmount,0) > 0 AND (es.ExpiredAmount - IFNULL(es.SettledAmount,0)) > 0");
    else if (status === "SETTLED")
      whereConditions.push("(es.ExpiredAmount - IFNULL(es.SettledAmount,0)) <= 0");
  }

  const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const dataQuery = `
    SELECT es.Id, es.SupplierId, s.Name AS SupplierName, es.ProductId, p.ProductName,
           es.BatchNumber, es.ExpiryDate, es.ExpiredQty,
           IFNULL(SUM(eri.Quantity), 0) AS AlreadySentQty,
           (es.ExpiredQty - IFNULL(SUM(eri.Quantity), 0)) AS RemainingSendQty,
           es.ExpiredAmount, IFNULL(es.SettledAmount, 0) AS SettledAmount,
           (es.ExpiredAmount - IFNULL(es.SettledAmount, 0)) AS RemainingAmount,
           CASE
             WHEN (es.ExpiredAmount - IFNULL(es.SettledAmount, 0)) <= 0 THEN 'SETTLED'
             WHEN IFNULL(es.SettledAmount, 0) > 0 THEN 'PARTIAL'
             ELSE 'PENDING'
           END AS CurrentStatus
      FROM ExpiredStock es
      INNER JOIN Products p ON es.ProductId = p.Id
      INNER JOIN Suppliers s ON es.SupplierId = s.Id
      LEFT JOIN (SELECT eri.ExpiredStockId, eri.Quantity FROM ExpiryReturnItems eri JOIN ExpiryReturns er ON er.Id = eri.ExpiryReturnId WHERE IFNULL(er.Status, '') <> 'CANCELLED') eri ON eri.ExpiredStockId = es.Id
      ${whereClause}
     GROUP BY es.Id
     ORDER BY es.Id DESC
     LIMIT ? OFFSET ?`;

  const countQuery = `SELECT COUNT(*) AS total FROM ExpiredStock es ${whereClause}`;

  const db = dbConnection.connection.promise();
  const [rows] = await db.query(dataQuery, [...params, limit, offset]);
  const [countResult] = await db.query(countQuery, params);

  return { rows, total: countResult[0].total };
};

/** Supplier invoices (status Received) matching a keyword - for rate-difference settlement. */
const searchSupplierInvoice = async ({ keyword, supplierId }) => {
  if (!supplierId) { const err = new Error("Supplier ID is required"); err.statusCode = 400; throw err; }
  if (!keyword) { const err = new Error("Keyword is required"); err.statusCode = 400; throw err; }

  const [rows] = await dbConnection.connection.promise().query(
    `SELECT i.Id, i.SupplierInvoiceNo, i.InvoiceDate, i.TotalAmount, po.Id AS PurchaseOrderId, po.PoDate
       FROM Invoices i
       JOIN PurchaseOrders po ON i.PurchaseOrderId = po.Id
      WHERE po.Status = 'Received' AND po.SupplierId = ? AND i.SupplierInvoiceNo LIKE ?
      ORDER BY i.InvoiceDate DESC
      LIMIT 10`,
    [supplierId, `%${keyword}%`]
  );
  return rows;
};

const getInvoiceProducts = async (invoiceId) => {
  if (!invoiceId) throw new Error("Invalid invoiceId.");

  const [rows] = await dbConnection.connection.promise().query(
    `SELECT id.Id AS InvoiceDetailId, id.InvoiceId, id.ProductId, p.ProductName,
            id.ReceivedQuantity AS Quantity, id.PurchasePrice, id.IGSTPercentage,
            (id.ReceivedQuantity * id.PurchasePrice) AS LineAmount
       FROM InvoiceDetails id
       INNER JOIN Invoices inv ON inv.Id = id.InvoiceId
       INNER JOIN Products p ON p.Id = id.ProductId
      WHERE id.InvoiceId = ?
      ORDER BY p.ProductName ASC`,
    [invoiceId]
  );
  return rows;
};

/** Last 3 purchase prices per product for one supplier (rate-difference settlement). */
const getLastThreePricesBulk = async (productIds, supplierId) => {
  if (!Array.isArray(productIds) || productIds.length === 0)
    throw new Error("Product IDs must be a non-empty array.");
  if (!supplierId) throw new Error("Supplier ID is required.");

  const placeholders = productIds.map(() => "?").join(",");
  const [rows] = await dbConnection.connection.promise().execute(
    `SELECT id.ProductId, id.PurchasePrice, DATE_FORMAT(inv.InvoiceDate, '%d-%m-%Y') AS InvoiceDate
       FROM InvoiceDetails id
       INNER JOIN Invoices inv ON inv.Id = id.InvoiceId
       INNER JOIN PurchaseOrders po ON po.Id = inv.PurchaseOrderId
      WHERE id.ProductId IN (${placeholders}) AND po.SupplierId = ?
      ORDER BY id.ProductId, inv.InvoiceDate DESC`,
    [...productIds, supplierId]
  );

  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.ProductId]) grouped[row.ProductId] = [];
    if (grouped[row.ProductId].length < 3)
      grouped[row.ProductId].push({ PurchasePrice: Number(row.PurchasePrice), InvoiceDate: row.InvoiceDate });
  });
  return grouped;
};

/**
 * Price-reduction settlement of an expired batch: a new, cheaper purchase invoice
 * line is used to recover the expired amount (extra becomes supplier credit).
 * All in one transaction with row locks. (Logic unchanged; connection now always released.)
 */
const settleExpiredStock = async ({ expiredId, settlements, userId }) => {
  const conn = await dbConnection.pool.promise().getConnection();
  try {
    await conn.beginTransaction();

    const [expiredRows] = await conn.execute(
      `SELECT Id, SupplierId, RemainingAmount, SettledAmount FROM ExpiredStock WHERE Id = ? FOR UPDATE`,
      [expiredId]
    );
    if (!expiredRows.length) throw new Error("Expired stock not found");

    const expired = expiredRows[0];
    let remainingExpiredAmount = parseFloat(expired.RemainingAmount);
    let totalSettledNow = 0;

    for (const item of settlements) {
      let recoverable = parseFloat(item.settlementAmount);
      const { invoiceId, productId, invoiceDetailId } = item;
      const oldPrice = parseFloat(item.oldPrice);
      const newPrice = parseFloat(item.newPrice);
      const qty = parseFloat(item.qty);

      if (recoverable <= 0) continue;

      // A) use existing credit of that invoice first
      const [creditRows] = await conn.execute(
        `SELECT Id, RemainingCredit FROM SupplierInvoiceCredit
          WHERE SupplierId = ? AND InvoiceId = ? AND ProductId = ? FOR UPDATE`,
        [expired.SupplierId, invoiceId, productId]
      );

      if (creditRows.length && creditRows[0].RemainingCredit > 0) {
        const availableCredit = parseFloat(creditRows[0].RemainingCredit);
        const creditUsed = Math.min(availableCredit, recoverable);
        await conn.execute(
          `UPDATE SupplierInvoiceCredit
              SET UsedCredit = UsedCredit + ?, RemainingCredit = RemainingCredit - ? WHERE Id = ?`,
          [creditUsed, creditUsed, creditRows[0].Id]
        );
        recoverable -= creditUsed;
      }

      // B) still something left -> price-reduction settlement
      if (recoverable > 0) {
        const usableAmount = Math.min(recoverable, remainingExpiredAmount);

        await conn.execute(
          `INSERT INTO ExpiredSettlement
             (ExpiredStockId, InvoiceId, InvoiceDetailId, ProductId, SettlementType, Qty, OldPrice,
              NewPrice, SettlementAmount, CreatedBy)
           VALUES (?, ?, ?, ?, 'PRICE_REDUCTION', ?, ?, ?, ?, ?)`,
          [expiredId, invoiceId, invoiceDetailId, productId, qty, oldPrice, newPrice, usableAmount, userId]
        );

        totalSettledNow += usableAmount;
        remainingExpiredAmount -= usableAmount;

        // C) more than the expired amount -> extra credit for later
        const extraCredit = recoverable - usableAmount;
        if (extraCredit > 0) {
          await conn.execute(
            `INSERT INTO SupplierInvoiceCredit (SupplierId, InvoiceId, ProductId, TotalCredit, RemainingCredit)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               TotalCredit = TotalCredit + VALUES(TotalCredit),
               RemainingCredit = RemainingCredit + VALUES(RemainingCredit)`,
            [expired.SupplierId, invoiceId, productId, extraCredit, extraCredit]
          );
        }
      }
    }

    const newSettled = parseFloat(expired.SettledAmount) + totalSettledNow;
    const status = remainingExpiredAmount <= 0 ? "SETTLED" : newSettled > 0 ? "PARTIAL" : "PENDING";

    await conn.execute(
      `UPDATE ExpiredStock SET SettledAmount = ?, RemainingAmount = ?, SettlementStatus = ? WHERE Id = ?`,
      [newSettled, remainingExpiredAmount, status, expiredId]
    );

    await conn.commit();
    return { success: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const getInvoiceCredit = async (invoiceId) => {
  if (!invoiceId) throw new Error("Invoice ID is required");

  const [rows] = await dbConnection.connection.promise().execute(
    `SELECT sic.ProductId, p.ProductName, sic.TotalCredit, sic.UsedCredit, sic.RemainingCredit AS AvailableAmount
       FROM SupplierInvoiceCredit sic
       JOIN Products p ON p.Id = sic.ProductId
      WHERE sic.InvoiceId = ? AND sic.RemainingCredit > 0`,
    [invoiceId]
  );
  return rows;
};


/* =====================================================================
 * 12. SALES RETURN
 *
 * Bugs fixed in this block (all of them reproduced on your real data):
 *  1. The DB connection was never released (no finally) -> the pool ran out of
 *     connections after a few returns -> "sales return is not working".
 *  2. Validation / allocation ran BEFORE beginTransaction with no locks, so the
 *     same goods could be returned twice by two users.
 *  3. Return items were keyed by ProductId: two batches of one product overwrote
 *     each other and allocations hung under the wrong return item.
 *  4. The batch lookup took stockRows[0]. With lots, the wrong lot could be
 *     restocked. Now we find the lots THIS CUSTOMER bought and allocate oldest-first.
 *  5. The same product + batch on two form rows were validated separately and
 *     could together exceed what was sold. Rows are merged, in-request usage tracked.
 *  6. The credit-note total was calculated from unrounded numbers while the stored
 *     allocations were rounded (your returns 6 and 7 differ by paise). One rounded
 *     source is used now.
 *  7. An unknown "condition" skipped stock handling but still issued a credit note.
 *  8. Expired returns took cost from the FIRST invoice via an INNER JOIN that
 *     silently inserted nothing when no row matched. Lot cost is used; it throws.
 *  9. The return reason was validated but never saved (SalesReturnItems.Reason).
 * ===================================================================== */

const RETURN_CONDITIONS = ["GOOD", "EXPIRED", "DEFECTIVE", "DEFECTIVE_EXPIRED", "DAMAGED"];

const normalizeReturnLines = (items) => {
  if (!Array.isArray(items) || !items.length) throw new Error("No items selected for return.");

  const merged = new Map();
  items.forEach((raw, idx) => {
    const n = idx + 1;
    const product = Number(raw.Product);
    const batch = String(raw.BatchNumber ?? "").trim();
    const qty = Number(raw.Quantity);
    const condition = String(raw.Condition || "GOOD").trim().toUpperCase().replace(/\s+/g, "_");
    const reason = String(raw.Reason ?? "").trim();

    if (!product || !batch) throw new Error(`Line ${n}: product and batch are required.`);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Line ${n}: quantity must be a whole number above 0.`);
    if (!RETURN_CONDITIONS.includes(condition)) throw new Error(`Line ${n}: invalid condition "${raw.Condition}".`);

    const key = `${product}|${batch.toLowerCase()}|${condition}`;
    const prev = merged.get(key);
    if (prev) {
      prev.Quantity += qty;
      if (reason && !prev.Reason.includes(reason)) prev.Reason = prev.Reason ? `${prev.Reason}; ${reason}` : reason;
    } else {
      merged.set(key, { Product: product, BatchNumber: batch, Quantity: qty, Condition: condition, Reason: reason });
    }
  });
  return [...merged.values()];
};

/**
 * Finds the sale lines this customer bought (product + batch), locks them and
 * allocates the return oldest-sale-first, across lots if needed.
 */
const allocateReturns = async (connection, customerId, lines) => {
  const consumed = new Map();          // saleItemId -> qty allocated so far in THIS request
  const allocations = [];
  const errors = [];

  for (const line of lines) {
    const [rows] = await connection.query(
      `SELECT si.Id AS SaleItemId, si.StockId, si.QuantitySold, IFNULL(si.ReturnedQty, 0) AS ReturnedQty,
              si.SalePrice, si.Sgst, si.Cgst, s.ExpiryDate, s.BatchNumber, p.ProductName
         FROM SalesItems si
         JOIN SalesHeader sh ON sh.Id = si.SaleId
         JOIN Stock s        ON s.Id  = si.StockId
         JOIN Products p     ON p.Id  = s.ProductId
        WHERE sh.CustomerId = ? AND s.ProductId = ? AND s.BatchNumber = ?
          AND si.QuantitySold > IFNULL(si.ReturnedQty, 0)
        ORDER BY sh.CreatedAt ASC, si.Id ASC
        FOR UPDATE OF si`,
      [customerId, line.Product, line.BatchNumber]
    );

    const name = rows[0]?.ProductName || (await getProductName(line.Product, connection)) || `Product ${line.Product}`;
    const label = `${name} (Batch ${line.BatchNumber})`;

    const candidates = rows
      .map((r) => ({
        ...r,
        remaining: Number(r.QuantitySold) - Number(r.ReturnedQty) - (consumed.get(r.SaleItemId) || 0),
      }))
      .filter((r) => r.remaining > 0);

    if (!candidates.length) {
      errors.push(`${label}: not sold to this customer, or already fully returned.`);
      continue;
    }
    const available = candidates.reduce((s, c) => s + c.remaining, 0);
    if (line.Quantity > available) {
      errors.push(`${label}: return qty ${line.Quantity} is more than the returnable qty ${available}.`);
      continue;
    }

    let need = line.Quantity;
    for (const c of candidates) {
      if (need <= 0) break;

      if (line.Condition === "GOOD" && moment(c.ExpiryDate).isBefore(moment(), "day")) {
        errors.push(`${label}: product is expired but marked GOOD.`);
        break;
      }

      const take = Math.min(need, c.remaining);
      const rate = Number(c.SalePrice);
      const taxable = round2(take * rate);
      const sgstAmt = round2((taxable * Number(c.Sgst)) / 100);
      const cgstAmt = round2((taxable * Number(c.Cgst)) / 100);

      allocations.push({
        saleItemId: c.SaleItemId, stockId: c.StockId, condition: line.Condition, reason: line.Reason,
        productName: name, batch: line.BatchNumber, qty: take, rate, taxable, sgstAmt, cgstAmt,
        total: round2(taxable + sgstAmt + cgstAmt),
      });
      consumed.set(c.SaleItemId, (consumed.get(c.SaleItemId) || 0) + take);
      need -= take;
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return allocations;
};

async function createSalesReturn(connection, customerId, amount, userId) {
  const [res] = await connection.query(
    `INSERT INTO SalesReturn (CustomerId, TotalAmount, CreatedBy) VALUES (?, ?, ?)`,
    [customerId, amount, userId]
  );
  return res.insertId;
}

// one SalesReturnItems row per (lot, condition); returns Map "stockId|condition" -> id
async function insertSalesReturnItems(connection, salesReturnId, aggregates) {
  const ids = new Map();
  for (const a of aggregates) {
    const [res] = await connection.query(
      `INSERT INTO SalesReturnItems (SalesReturnId, StockId, Quantity, ItemCondition, Reason)
       VALUES (?, ?, ?, ?, ?)`,
      [salesReturnId, a.stockId, a.qty, a.condition, a.reason || null]
    );
    ids.set(`${a.stockId}|${a.condition}`, res.insertId);
  }
  return ids;
}

async function updateSalesReturnedQty(connection, allocations) {
  for (const a of allocations) {
    const [res] = await connection.query(
      `UPDATE SalesItems SET ReturnedQty = IFNULL(ReturnedQty, 0) + ?
        WHERE Id = ? AND IFNULL(ReturnedQty, 0) + ? <= QuantitySold`,
      [a.qty, a.saleItemId, a.qty]
    );
    if (res.affectedRows !== 1) throw new Error("Returned quantity would exceed sold quantity. Please retry.");
  }
}

const insertReturnAllocations = async (connection, returnItemIds, allocations) => {
  for (const a of allocations) {
    const salesReturnItemId = returnItemIds.get(`${a.stockId}|${a.condition}`);
    if (!salesReturnItemId) throw new Error("Internal error: return item mapping missing.");
    await connection.query(
      `INSERT INTO ReturnAllocations
         (SalesReturnItemId, SaleItemId, Quantity, Rate, ReturnTaxableAmount, ReturnCgstAmount, ReturnSgstAmount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [salesReturnItemId, a.saleItemId, a.qty, a.rate, a.taxable, a.cgstAmt, a.sgstAmt]
    );
  }
};

const updateStockTransactionTable = async (connection, stockId, transactionType, effect, quantity, remarks) => {
  await connection.query(
    `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Remarks) VALUES (?, ?, ?, ?, ?)`,
    [stockId, transactionType, effect, quantity, remarks]
  );
};

const decreaseStock = async (connection, qty, stockId) => {
  await connection.query(`UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ?`, [qty, stockId]);
};

const increaseStock = async (connection, qty, stockId) => {
  await connection.query(`UPDATE Stock SET Quantity = Quantity + ? WHERE Id = ?`, [qty, stockId]);
};

/** CHANGED: returns { id, number } - the number is reused for payment / ledger rows. */
async function createCreditNote(connection, customerId, salesReturnId, amount, userId) {
  const creditNoteNumber = await generateDocumentNumber(connection, "CreditNote");
  const [res] = await connection.query(
    `INSERT INTO CreditNotes (CustomerId, CreditNoteNumber, SalesReturnId, TotalAmount, CreatedBy)
     VALUES (?, ?, ?, ?, ?)`,
    [customerId, creditNoteNumber, salesReturnId, amount, userId]
  );
  return { id: res.insertId, number: creditNoteNumber };
}

async function insertCreditNoteAdjustment(connection, creditNoteId, amount) {
  await connection.query(
    `INSERT INTO CreditNoteAdjustments (CreditNoteId, AdjustedAmount) VALUES (?, ?)`,
    [creditNoteId, amount]
  );
}

/**
 * Credit notes are also written to Payments with type CREDIT_NOTE (legacy).
 * CHANGED: PaymentNo is the credit note number instead of PAY-<timestamp>.
 * NOTE: the payment reports exclude these rows (they are not cash received).
 */
const insertPaymentEntry = async (connection, customerId, creditNoteNumber, creditNoteId, amount) => {
  await connection.query(
    `INSERT INTO Payments (CustomerId, PaymentNo, PaymentDate, PaymentType, Description, Credit, Debit)
     VALUES (?, ?, ?, 'CREDIT_NOTE', ?, ?, 0)`,
    [customerId, creditNoteNumber, new Date(), `Credit note issued against return CN-${creditNoteId}`, amount]
  );
};

/**
 * Parks returned bad stock in ExpiredStock for settlement with the supplier.
 * CHANGED: the lot's own cost + GST (Stock.PurchasePrice / IgstPercentage).
 * FIX: throws when nothing was inserted (the old INNER JOIN failed silently).
 */
const moveToExpiredStock = async (connection, stockId, qty, movedBy) => {
  const [res] = await connection.query(
    `INSERT INTO ExpiredStock
       (StockId, InvoiceId, ProductId, SupplierId, BatchNumber, ExpiryDate, ExpiredQty, PurchasePrice,
        GSTPercent, SettledAmount, ExpiredAmount, RemainingAmount, SettlementStatus, MovedAt, MovedBy)
     SELECT s.Id, s.InvoiceId, s.ProductId, s.SupplierId, s.BatchNumber, s.ExpiryDate, ?, s.PurchasePrice,
            IFNULL(s.IgstPercentage, 0), 0,
            ROUND(? * s.PurchasePrice * (1 + IFNULL(s.IgstPercentage, 0) / 100), 2),
            ROUND(? * s.PurchasePrice * (1 + IFNULL(s.IgstPercentage, 0) / 100), 2),
            'PENDING', NOW(), ?
       FROM Stock s WHERE s.Id = ?`,
    [qty, qty, qty, movedBy, stockId]
  );
  if (res.affectedRows !== 1) throw new Error(`Could not move stock ${stockId} to expired stock.`);
};

/**
 * GOOD            -> the quantity goes back to the SAME lot that was sold.
 * everything else -> the ledger shows IN then OUT (net 0, as before) and the quantity
 *                    is parked in ExpiredStock for supplier settlement.
 */
const applyStockEffectsForReturn = async (connection, aggregates, customerName, userId) => {
  for (const a of aggregates) {
    const label = `${a.productName} batch ${a.batch}`;
    if (a.condition === "GOOD") {
      await increaseStock(connection, a.qty, a.stockId);
      await updateStockTransactionTable(connection, a.stockId, "SALE_RETURN", "IN", a.qty,
        `Sales return ${label} from ${customerName}`);
    } else {
      await updateStockTransactionTable(connection, a.stockId, "EXPIRED_RETURN_IN", "IN", a.qty,
        `Return received (${a.condition}) ${label} from ${customerName}`);
      await updateStockTransactionTable(connection, a.stockId, "EXPIRED_RETURN_OUT", "OUT", a.qty,
        `Moved to expired stock ${label} (${customerName})`);
      await moveToExpiredStock(connection, a.stockId, a.qty, userId);
    }
  }
};

/**
 * MAIN ENTRY.  items = [{ Product, BatchNumber, Quantity, Condition, Reason }]
 * Validation, locks and all writes are ONE transaction; the connection is ALWAYS released.
 */
async function processSalesReturn(customerId, items, userId) {
  const connection = await dbConnection.pool.promise().getConnection();

  try {
    if (!customerId) throw new Error("Customer is required.");
    if (!userId) throw new Error("userId is required");

    const customerName = await getCustomerName(customerId);
    if (!customerName) throw new Error("Customer not found.");

    const lines = normalizeReturnLines(items);

    await connection.beginTransaction();

    const allocations = await allocateReturns(connection, customerId, lines);
    const totalWithGst = round2(allocations.reduce((s, a) => s + a.total, 0));

    // aggregate per (lot, condition)
    const aggMap = new Map();
    for (const a of allocations) {
      const key = `${a.stockId}|${a.condition}`;
      const cur = aggMap.get(key);
      if (cur) {
        cur.qty += a.qty;
        if (a.reason && !cur.reason.includes(a.reason)) cur.reason = cur.reason ? `${cur.reason}; ${a.reason}` : a.reason;
      } else {
        aggMap.set(key, {
          stockId: a.stockId, condition: a.condition, qty: a.qty, reason: a.reason || "",
          productName: a.productName, batch: a.batch,
        });
      }
    }
    const aggregates = [...aggMap.values()];

    const salesReturnId = await createSalesReturn(connection, customerId, totalWithGst, userId);
    const returnItemIds = await insertSalesReturnItems(connection, salesReturnId, aggregates);
    await insertReturnAllocations(connection, returnItemIds, allocations);
    await updateSalesReturnedQty(connection, allocations);

    await applyStockEffectsForReturn(connection, aggregates, customerName, userId);

    const creditNote = await createCreditNote(connection, customerId, salesReturnId, totalWithGst, userId);
    await insertCreditNoteAdjustment(connection, creditNote.id, totalWithGst);
    await insertPaymentEntry(connection, customerId, creditNote.number, creditNote.id, totalWithGst);

    const returnDate = moment().format("YYYY-MM-DD");
    const financialYear = await getFinancialYear(returnDate);
    const voucherId = await createSalesReturnEntry({
      connection, customerId, salesReturnId, creditNoteId: creditNote.id,
      amount: totalWithGst, returnDate, userId,
    });

    await connection.execute(
      `INSERT INTO CustomerLedger
         (CustomerId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId, ReferenceNo,
          DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'SALES_RETURN', 'SalesReturn', ?, ?, 0, ?, ?, ?)`,
      [customerId, financialYear, returnDate, salesReturnId, creditNote.number, totalWithGst,
       `Sales Return ${salesReturnId} / ${creditNote.number}`, voucherId]
    );

    await connection.commit();
    return {
      success: true, salesReturnId, creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.number, totalAmount: totalWithGst,
    };
  } catch (err) {
    console.error("processSalesReturn failed:", err.message);
    try { await connection.rollback(); } catch (_) { /* connection may already be gone */ }
    throw err;
  } finally {
    connection.release();               // FIX: was never released
  }
}

/**
 * Sales return list.
 * FIX: the end date was date-only ("2026-10-09" = 00:00:00) so returns made ON the
 *      end date (e.g. today) never showed. DATE(sr.CreatedAt) is compared now.
 */
const viewSalesReturn = async (customerId, fromDate, toDate) => {
  const startDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
  const endDate = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");

  let sql = `
    SELECT sr.Id AS SalesReturnId, sr.CreatedAt, c.CustomerName, cn.TotalAmount, cn.CreditNoteNumber,
           items.items, cn.Id AS creditNoteId
      FROM SalesReturn sr
      JOIN Customers c ON c.Id = sr.CustomerId
      LEFT JOIN CreditNotes cn ON cn.SalesReturnId = sr.Id
      LEFT JOIN (
        SELECT sri.SalesReturnId,
               JSON_ARRAYAGG(JSON_OBJECT('ProductName', p.ProductName, 'BatchNumber', s.BatchNumber,
                                         'Quantity', sri.Quantity, 'Condition', sri.ItemCondition)) AS items
          FROM SalesReturnItems sri
          JOIN Stock s ON s.Id = sri.StockId
          JOIN Products p ON p.Id = s.ProductId
         GROUP BY sri.SalesReturnId
      ) items ON items.SalesReturnId = sr.Id
     WHERE DATE(sr.CreatedAt) BETWEEN ? AND ?`;

  const params = [startDate, endDate];
  if (customerId) { sql += ` AND sr.CustomerId = ?`; params.push(customerId); }
  sql += ` ORDER BY sr.CreatedAt DESC`;

  const [rows] = await dbConnection.execute(sql, params);
  rows.forEach((r) => {
    r.TotalAmount = Number(r.TotalAmount || 0);
    if (!r.items) r.items = [];
    else if (typeof r.items === "string") r.items = JSON.parse(r.items);
  });
  return rows;
};

/**
 * Credit-note print data.
 * FIX: joined the OLD `Sales` table; ReturnAllocations.SaleItemId points to SalesItems,
 *      so the print showed wrong / empty items.
 * FIX: the catch block swallowed the error and returned undefined (controller crashed).
 */
const getIndividualCustomerSalesRtCN = async (creditNoteId) => {
  try {
    const headerQuery = `
      SELECT cn.Id AS CreditNoteId, cn.CreditNoteNumber, cn.TotalAmount, cn.CreatedAt,
             c.Id AS CustomerId, c.CustomerName, c.MobileNo, c.BillingAddress, c.BillingDistrict,
             c.BillingState, c.BillingPincode, c.GstNo, c.DlNo
        FROM CreditNotes cn
        JOIN SalesReturn sr ON sr.Id = cn.SalesReturnId
        JOIN Customers c ON c.Id = sr.CustomerId
       WHERE cn.Id = ?`;

    const itemsQuery = `
      SELECT p.ProductName, p.Hsn, s.BatchNumber, s.ExpiryDate, ra.Rate, sa.Cgst, sa.Sgst,
             SUM(ra.Quantity) AS Quantity,
             SUM(ra.Quantity * ra.Rate) AS TaxableAmount,
             SUM(ra.ReturnCgstAmount) AS CgstAmount,
             SUM(ra.ReturnSgstAmount) AS SgstAmount,
             SUM((ra.Quantity * ra.Rate) + ra.ReturnCgstAmount + ra.ReturnSgstAmount) AS Total
        FROM CreditNotes cn
        JOIN SalesReturn sr ON sr.Id = cn.SalesReturnId
        JOIN SalesReturnItems sri ON sri.SalesReturnId = sr.Id
        JOIN ReturnAllocations ra ON ra.SalesReturnItemId = sri.Id
        JOIN SalesItems sa ON sa.Id = ra.SaleItemId
        JOIN Stock s ON s.Id = sa.StockId
        JOIN Products p ON p.Id = s.ProductId
       WHERE cn.Id = ?
       GROUP BY p.ProductName, p.Hsn, s.BatchNumber, s.ExpiryDate, ra.Rate, sa.Cgst, sa.Sgst
       ORDER BY p.ProductName`;

    const summaryQuery = `
      SELECT SUM(ra.Quantity * ra.Rate) AS TaxableAmount,
             SUM(ra.ReturnCgstAmount) AS TotalCgstAmount,
             SUM(ra.ReturnSgstAmount) AS TotalSgstAmount,
             SUM((ra.Quantity * ra.Rate) + ra.ReturnCgstAmount + ra.ReturnSgstAmount) AS TotalCreditAmount
        FROM CreditNotes cn
        JOIN SalesReturn sr ON sr.Id = cn.SalesReturnId
        JOIN SalesReturnItems sri ON sri.SalesReturnId = sr.Id
        JOIN ReturnAllocations ra ON ra.SalesReturnItemId = sri.Id
       WHERE cn.Id = ?`;

    const [creditNoteHeader] = await dbConnection.query(headerQuery, [creditNoteId]);
    const [items] = await dbConnection.query(itemsQuery, [creditNoteId]);
    const [summary] = await dbConnection.query(summaryQuery, [creditNoteId]);

    return { creditNoteHeader, items, summary };
  } catch (error) {
    console.error(error);
    throw error;
  }
};


/* =====================================================================
 * 13. FINANCIAL YEAR / DOCUMENT NUMBERS
 * ===================================================================== */

/** "2026-27" for a date (April - March). */
const getFinancialYear = async (date = null) => {
  const d = date ? new Date(date) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  let startYear, endYear;

  if (month >= 4) { startYear = year; endYear = year + 1; }
  else { startYear = year - 1; endYear = year; }

  return `${startYear}-${String(endYear).slice(-2)}`;
};

/** Next document number (PREFIX/FY/0001) - must be called inside a transaction. */
async function generateDocumentNumber(connection, docType) {
  const fy = await getFinancialYear();

  const [[row]] = await connection.query(
    `SELECT Prefix, FinancialYear, CurrentValue FROM DocumentSequences WHERE DocType = ? FOR UPDATE`,
    [docType]
  );
  if (!row) throw new Error(`Document type '${docType}' not configured.`);

  let newNumber;
  if (row.FinancialYear !== fy) {
    newNumber = 1;
    await connection.query(
      `UPDATE DocumentSequences SET CurrentValue = 1, FinancialYear = ? WHERE DocType = ?`, [fy, docType]);
  } else {
    newNumber = row.CurrentValue + 1;
    await connection.query(
      `UPDATE DocumentSequences SET CurrentValue = CurrentValue + 1 WHERE DocType = ?`, [docType]);
  }

  return `${row.Prefix}/${fy}/${String(newNumber).padStart(4, "0")}`;
}


/* =====================================================================
 * 14. EXPIRED STOCK -> SUPPLIER (return, debit note, settlement)
 * ===================================================================== */

/**
 * Expired batches that can still be sent to a supplier.
 * CHANGED: price / GST come from the ExpiredStock snapshot (the same numbers the debit
 *          note is built from) instead of re-reading the first invoice.
 */
const expiredProductPageForMoveToSupplier = async (supplierId) => {
  const dataQuery = `
    SELECT es.Id, es.SupplierId, s.Name AS SupplierName, es.ProductId, p.ProductName, es.StockId,
           es.BatchNumber, DATE_FORMAT(es.ExpiryDate, '%d-%m-%Y') AS ExpiryDate, es.ExpiredQty,
           IFNULL(SUM(eri.Quantity), 0) AS AlreadySentQty,
           (es.ExpiredQty - IFNULL(SUM(eri.Quantity), 0)) AS RemainingSendQty,
           es.PurchasePrice, es.GSTPercent AS IgstPercentage,
           es.ExpiredAmount, IFNULL(es.SettledAmount, 0) AS SettledAmount,
           (es.ExpiredAmount - IFNULL(es.SettledAmount, 0)) AS RemainingAmount
      FROM ExpiredStock es
      INNER JOIN Products p ON es.ProductId = p.Id
      INNER JOIN Suppliers s ON es.SupplierId = s.Id
      LEFT JOIN (SELECT eri.ExpiredStockId, eri.Quantity FROM ExpiryReturnItems eri JOIN ExpiryReturns er ON er.Id = eri.ExpiryReturnId WHERE IFNULL(er.Status, '') <> 'CANCELLED') eri ON eri.ExpiredStockId = es.Id
     WHERE es.SupplierId = ? AND (es.ExpiredAmount - IFNULL(es.SettledAmount, 0)) > 0
     GROUP BY es.Id
    HAVING RemainingSendQty > 0
     ORDER BY es.ExpiryDate ASC`;

  const [rows] = await dbConnection.connection.promise().query(dataQuery, [supplierId]);
  return rows;
};

/** Sends expired products to a supplier: return + debit note + settlement ledger. */
const sendExpiredToSupplier = async ({ supplierId, items, userId }) => {
  const connection = await dbConnection.pool.promise().getConnection();

  try {
    await connection.beginTransaction();

    // FIX: a double click on "send" made TWO returns + debit notes when only part of the quantity was sent.
    //      The same user sending exactly the same batches and quantities to the same supplier within 30 seconds
    //      gets the return that was just made instead of a second one.
    const [[sup]] = await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [supplierId]);
    if (!sup) throw new Error("Supplier not found.");
    const sigOf = (list) => list.map((x) => `${Number(x.id)}:${Number(x.q)}`).sort().join(",");
    const wantSig = sigOf(items.map((i) => ({ id: i.expiredStockId, q: i.quantity })));
    const [recent] = await connection.query(
      `SELECT er.Id, eri.ExpiredStockId AS id, eri.Quantity AS q
         FROM ExpiryReturns er JOIN ExpiryReturnItems eri ON eri.ExpiryReturnId = er.Id
        WHERE er.SupplierId = ? AND er.CreatedBy = ? AND er.CreatedAt >= NOW() - INTERVAL 30 SECOND
          AND IFNULL(er.Status, '') <> 'CANCELLED'`, [supplierId, userId]);
    const byReturn = {};
    recent.forEach((r) => { (byReturn[r.Id] = byReturn[r.Id] || []).push(r); });
    const same = Object.keys(byReturn).find((id) => sigOf(byReturn[id]) === wantSig);
    if (same) {
      await connection.rollback();
      return { expReturnId: Number(same), duplicate: true };
    }

    const returnNumber = await generateDocumentNumber(connection, "ExpiryReturn");
    const debitNoteNumber = await generateDocumentNumber(connection, "SupplierDebitNote");

    const [headerResult] = await connection.query(
      `INSERT INTO ExpiryReturns (ReturnNumber, SupplierId, ReturnDate, TotalItems, Status, CreatedBy, CreatedAt)
       VALUES (?, ?, NOW(), ?, 'SENT', ?, NOW())`,
      [returnNumber, supplierId, items.length, userId]
    );
    const expiryReturnId = headerResult.insertId;

    const stockIds = items.map((i) => i.expiredStockId);
    const [stocks] = await connection.query(
      `SELECT Id, ExpiredQty, ExpiredAmount, PurchasePrice, GSTPercent, StockId, ProductId
         FROM ExpiredStock WHERE Id IN (?) FOR UPDATE`,
      [stockIds]
    );
    const stockMap = {};
    stocks.forEach((s) => (stockMap[s.Id] = s));

    const [sentRows] = await connection.query(
      `SELECT eri.ExpiredStockId, SUM(eri.Quantity) AS sentQty FROM ExpiryReturnItems eri
        JOIN ExpiryReturns er ON er.Id = eri.ExpiryReturnId
        WHERE eri.ExpiredStockId IN (?) AND IFNULL(er.Status, '') <> 'CANCELLED' GROUP BY eri.ExpiredStockId`,
      [stockIds]
    );
    const sentMap = {};
    sentRows.forEach((r) => (sentMap[r.ExpiredStockId] = Number(r.sentQty)));

    let totalTaxable = 0, totalGST = 0, totalAmount = 0;
    const debitItems = [];

    for (const item of items) {
      const stock = stockMap[item.expiredStockId];
      if (!stock) throw new Error("Invalid stock selected");

      const qty = Number(item.quantity);
      if (!(qty > 0)) throw new Error("Return quantity must be greater than 0");

      const remaining = Number(stock.ExpiredQty) - (sentMap[item.expiredStockId] || 0);
      if (qty > remaining) throw new Error("Return quantity exceeds remaining expired qty");

      const [itemResult] = await connection.query(
        `INSERT INTO ExpiryReturnItems (ExpiryReturnId, ExpiredStockId, Quantity, CreatedAt)
         VALUES (?, ?, ?, NOW())`,
        [expiryReturnId, item.expiredStockId, qty]
      );

      const rate = parseFloat(stock.PurchasePrice || 0);
      const snapshotGst = parseFloat(stock.GSTPercent || 0);
      // NEW: the GST % of a line can be given when the debit note is made (blank = the batch's own GST %)
      const given = item.gstPercent === undefined || item.gstPercent === null || String(item.gstPercent).trim() === "" ? null : Number(item.gstPercent);
      if (given !== null && !(Number.isFinite(given) && given >= 0 && given <= 100))
        throw new Error("GST % must be a number between 0 and 100.");
      const gstPercent = given === null ? snapshotGst : given;
      const taxable = round2(qty * rate);
      const gstAmount = round2((taxable * gstPercent) / 100);
      const total = round2(taxable + gstAmount);

      totalTaxable += taxable; totalGST += gstAmount; totalAmount += total;

      // A GST % typed now (e.g. the rate changed after the purchase) is REMEMBERED by the batch for all of its quantity that
      // is not in a debit note yet (this send + the rest), so the next debit note for the batch starts at the same rate.
      // ExpiredAmount (GST inclusive) follows: only that unsent quantity changes, earlier debit notes keep their own GST.
      if (round2(gstPercent) !== round2(snapshotGst)) {
        const unsentTaxable = round2(remaining * rate);
        const d = round2(round2((unsentTaxable * gstPercent) / 100) - round2((unsentTaxable * snapshotGst) / 100));
        await connection.query(
          `UPDATE ExpiredStock SET GSTPercent = ?, ExpiredAmount = ExpiredAmount + ?, RemainingAmount = RemainingAmount + ? WHERE Id = ?`,
          [gstPercent, d, d, item.expiredStockId]);
        stock.GSTPercent = gstPercent;
      }
      sentMap[item.expiredStockId] = (sentMap[item.expiredStockId] || 0) + qty;      // the same batch twice in one request can no longer be over-sent

      debitItems.push({
        expiryReturnItemId: itemResult.insertId, productId: stock.ProductId, quantity: qty, rate,
        gstPercent, amount: taxable, gstAmount, totalAmount: total,
      });
    }
    totalTaxable = round2(totalTaxable); totalGST = round2(totalGST); totalAmount = round2(totalAmount);

    const [debitResult] = await connection.query(
      `INSERT INTO SupplierDebitNotes
         (SupplierId, ExpiryReturnId, DebitNoteNumber, DebitDate, TotalItems, Amount, GSTAmount,
          TotalAmount, Status, CreatedBy)
       VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, 'SENT', ?)`,
      [supplierId, expiryReturnId, debitNoteNumber, debitItems.length, totalTaxable, totalGST,
       totalAmount, userId]
    );
    const debitNoteId = debitResult.insertId;

    for (const d of debitItems) {
      await connection.query(
        `INSERT INTO SupplierDebitNoteItems
           (SupplierDebitNoteId, ExpiryReturnItemId, ProductId, Quantity, Rate, GSTPercent, Amount,
            GSTAmount, TotalAmount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [debitNoteId, d.expiryReturnItemId, d.productId, d.quantity, d.rate, d.gstPercent, d.amount,
         d.gstAmount, d.totalAmount]
      );
    }

    const balance = parseFloat(await getSupplierBalance(connection, supplierId)) || 0;
    const newBalance = balance + totalAmount;
    await connection.query(
      `INSERT INTO SupplierSettlementLedger
         (SupplierId, ExpiryReturnId, ReferenceType, ReferenceId, ReferenceNumber, DebitAmount,
          CreditAmount, BalanceAfter, CreatedBy)
       VALUES (?, ?, 'DEBIT_NOTE', ?, ?, ?, 0, ?, ?)`,
      [supplierId, expiryReturnId, debitNoteId, debitNoteNumber, totalAmount, newBalance, userId]
    );

    await connection.commit();
    return { expReturnId: expiryReturnId, debitNoteId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};



/* ---------------------------------------------------------------------
 * ONCE-ONLY FORM SUBMISSIONS  (NEW)
 * Every form of the settlement page carries a one-time code (submitToken). The first request that uses it
 * "claims" it inside its transaction; a second request with the same code (double click, refresh, browser
 * re-send) waits for the first one and then finds the code taken -> it does nothing and says so.
 * If the first request fails, its claim is rolled back and the code can be used again.
 * ------------------------------------------------------------------- */
const claimSubmission = async (connection, token, action, refId, userId) => {
  const t = String(Array.isArray(token) ? token[0] : token || "").trim().slice(0, 40);
  if (!t) return true;                                     // old page without a code: allowed (no protection)
  const [r] = await connection.query(
    `INSERT IGNORE INTO FormSubmissions (Token, Action, RefId, CreatedBy, CreatedAt) VALUES (?, ?, ?, ?, NOW())`,
    [t, action, refId, userId]);
  return r.affectedRows === 1;
};
const alreadyDone = (message) => ({ duplicate: true, changed: false, message });

/* ---------------------------------------------------------------------
 * CREDIT NOTES WITH THEIR LINES  (NEW) - for the settlement page, the register and the settled view.
 * Credit notes saved before SupplierCreditNoteItems existed have no lines (unless the migration could
 * fill them in), they are shown with "products not recorded".
 * ------------------------------------------------------------------- */
const getCreditNotesForReturns = async (returnIds) => {
  const ids = (Array.isArray(returnIds) ? returnIds : [returnIds]).map(Number).filter(Boolean);
  if (!ids.length) return [];
  const db = dbConnection.pool.promise();
  const [notes] = await db.query(
    `SELECT cn.*, DATE_FORMAT(cn.CreditDate, '%d-%m-%Y') AS CreditDateText
       FROM SupplierCreditNotes cn WHERE cn.ExpiryReturnId IN (?) ORDER BY cn.CreditDate ASC, cn.Id ASC`, [ids]);
  if (!notes.length) return [];
  let lines = [];
  try {
    [lines] = await db.query(
      `SELECT ci.CreditNoteId, ci.ExpiryReturnItemId, ci.Quantity, ci.Rate, ci.GSTPercent, ci.Amount, ci.GSTAmount, ci.TotalAmount,
              p.ProductName, es.BatchNumber
         FROM SupplierCreditNoteItems ci
         JOIN ExpiryReturnItems eri ON eri.Id = ci.ExpiryReturnItemId
         JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
         LEFT JOIN Products p ON p.Id = es.ProductId
        WHERE ci.CreditNoteId IN (?) ORDER BY ci.Id`, [notes.map((n) => n.Id)]);
  } catch (e) {
    if (e.code !== "ER_NO_SUCH_TABLE") throw e;          // migration not run yet: notes without lines
  }
  const byNote = new Map();
  lines.forEach((l) => { if (!byNote.has(l.CreditNoteId)) byNote.set(l.CreditNoteId, []); byNote.get(l.CreditNoteId).push(l); });
  return notes.map((n) => ({
    ...n,
    SettlementTypeLabel: SETTLEMENT_TYPES[n.SettlementType] || (n.SettlementType ? n.SettlementType : "Credit Note"),
    Reference: n.CreditNoteNumber || (n.SupplierInvoiceRefNo ? `INV ${n.SupplierInvoiceRefNo}` : (n.PoNo ? `PO ${n.PoNo}` : "")),
    items: byNote.get(n.Id) || [],
  }));
};

/** ExpiryReturnItems.Id -> [{ number, qty, total, date }] from the credit notes above. */
const creditNotesByItem = (notes) => {
  const map = new Map();
  notes.forEach((n) => n.items.forEach((l) => {
    if (!map.has(l.ExpiryReturnItemId)) map.set(l.ExpiryReturnItemId, []);
    map.get(l.ExpiryReturnItemId).push({
      number: n.Reference, invoiceRefNo: n.SupplierInvoiceRefNo || "", poNo: n.PoNo || "", date: n.CreditDateText,
      qty: Number(l.Quantity), total: Number(l.TotalAmount),
    });
  }));
  return map;
};

/** Recent invoice numbers of the supplier, offered as suggestions in the "Invoice Ref No" boxes. */
const getSupplierRecentInvoiceNos = async (supplierId) => {
  if (!supplierId) return [];
  try {
    const [rows] = await dbConnection.pool.promise().query(
      `SELECT DISTINCT PurchaseInvoiceNo AS no FROM PurchaseOrders
        WHERE SupplierId = ? AND PurchaseInvoiceNo IS NOT NULL AND PurchaseInvoiceNo <> ''
        ORDER BY Id DESC LIMIT 40`, [supplierId]);
    return rows.map((r) => r.no);
  } catch (e) {
    return [];                                              // suggestions only - never break the page
  }
};

/** Items of an expiry return with accepted / rejected / pending quantity + credit notes. */
const getMovedSupplierProductFromReturnNumber = async (expiryReturnId) => {
  const [[header]] = await dbConnection.execute(
    `SELECT Status, SupplierId, ReturnNumber, CreatedAt, IsLocked FROM ExpiryReturns WHERE Id = ?`,
    [expiryReturnId]
  );

  const [rows] = await dbConnection.execute(
    `SELECT er.Id AS ReturnId, er.ReturnNumber, er.SupplierId, s.Name AS SupplierName,
            er.CreatedAt AS SentDate, eri.Id AS ItemId, eri.Quantity AS SentQty,
            IFNULL(eri.AcceptedQuantity, 0) AS AcceptedQty,
            IFNULL(eri.RejectedQuantity, 0) AS RejectedQty,
            IFNULL(eri.SettledAmount, 0) AS SettledAmount,
            (eri.Quantity - IFNULL(eri.AcceptedQuantity, 0) - IFNULL(eri.RejectedQuantity, 0)) AS PendingQty,
            p.ProductName, es.BatchNumber, es.ExpiryDate,
            COALESCE(di.Rate, es.PurchasePrice) AS PurchasePrice,
            COALESCE(di.GSTPercent, es.GSTPercent) AS GSTPercent,
            (COALESCE(di.Rate, es.PurchasePrice) * (1 + COALESCE(di.GSTPercent, es.GSTPercent) / 100)) AS PurchaseWithGst
       FROM ExpiryReturns er
       JOIN ExpiryReturnItems eri ON eri.ExpiryReturnId = er.Id
       LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
       JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
       JOIN Products p ON p.Id = es.ProductId
       JOIN Suppliers s ON s.Id = er.SupplierId
      WHERE er.Id = ?
      ORDER BY eri.Id`,
    [expiryReturnId]
  );

  // CHANGED: credit notes with their products, and the credit note(s) of every line
  const creditNotes = await getCreditNotesForReturns(expiryReturnId);
  const perItem = creditNotesByItem(creditNotes);
  rows.forEach((r) => { r.CreditNotes = perItem.get(r.ItemId) || []; });

  const hasPending = rows.some((r) => r.PendingQty > 0);
  const hasProcessed = rows.some((r) => r.AcceptedQty > 0 || r.RejectedQty > 0);

  let computedStatus = "PENDING";
  if (!hasPending && rows.length > 0) computedStatus = "SETTLED";
  else if (hasProcessed) computedStatus = "PARTIAL_SETTLED";
  if (header && header.Status === "CANCELLED") computedStatus = "CANCELLED";

  // What the finished return really was: a return can be "Settled" (locked) and still have rejected units
  let outcome = "";
  if (header && Number(header.IsLocked) && header.Status !== "CANCELLED") {
    const acc = rows.reduce((a, r) => a + Number(r.AcceptedQty || 0), 0);
    const rej = rows.reduce((a, r) => a + Number(r.RejectedQty || 0), 0);
    outcome = rej > 0 ? (acc > 0 ? "SETTLED_PART_WRITTEN_OFF" : "WRITTEN_OFF") : "SETTLED";
  }

  return { rows, expiryReturnId, computedStatus, outcome, creditNotes, header };
};

const getMovedExpiredProductToSupplier = async (supplierId) => {
  const [rows] = await dbConnection.execute(
    `SELECT er.Id AS ReturnId, er.SupplierId, s.Name AS SupplierName, er.CreatedAt AS SentDate,
            eri.Id AS ItemId, eri.ExpiredStockId, eri.Quantity AS SentQty, p.ProductName,
            es.BatchNumber, es.ExpiryDate, IFNULL(eri.AcceptedQuantity, 0) AS AcceptedQty,
            (eri.Quantity - IFNULL(eri.AcceptedQuantity, 0)) AS PendingQty
       FROM ExpiryReturns er
       JOIN ExpiryReturnItems eri ON eri.ExpiryReturnId = er.Id
       JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
       JOIN Products p ON p.Id = es.ProductId
       JOIN Suppliers s ON s.Id = er.SupplierId
      WHERE er.SupplierId = ?
      ORDER BY er.CreatedAt DESC`,
    [supplierId]
  );
  return rows;
};

/**
 * Debit note register.
 * CHANGED: rates come from the ExpiredStock snapshot (same numbers the debit note was
 *          created with); the old INNER JOIN through Stock -> InvoiceDetails dropped
 *          items whose invoice had no line for the product.
 */
const getSupplierDebitNoteRegister = async ({ fromDate, toDate, supplierId }) => {
  let where = ` WHERE 1=1 `;
  const params = [];

  if (fromDate && toDate) {
    const startDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    const endDate = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    where += ` AND DATE(er.CreatedAt) BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }
  if (supplierId) { where += ` AND er.SupplierId = ? `; params.push(supplierId); }

  const db = dbConnection.pool.promise();

  const [headers] = await db.query(
    `SELECT er.Id, er.ReturnNumber, er.CreatedAt, er.Status, IFNULL(er.IsLocked, 0) AS IsLocked, s.Name AS SupplierName
       FROM ExpiryReturns er
       JOIN Suppliers s ON s.Id = er.SupplierId
       ${where}
      ORDER BY er.CreatedAt DESC`,
    params
  );
  if (!headers.length) return [];

  const returnIds = headers.map((r) => r.Id);
  const [items] = await db.query(
    `SELECT eri.Id AS ItemId, eri.ExpiryReturnId, p.ProductName, es.BatchNumber, eri.Quantity,
            COALESCE(di.Rate, es.PurchasePrice) AS PurchasePrice,
            eri.Status, eri.AcceptedQuantity, eri.RejectedQuantity,
            COALESCE(di.GSTPercent, es.GSTPercent) AS IgstPercentage,
            COALESCE(di.TotalAmount, (eri.Quantity * es.PurchasePrice) + (eri.Quantity * es.PurchasePrice * es.GSTPercent / 100)) AS Total
       FROM ExpiryReturnItems eri
       LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
       JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
       JOIN Products p ON p.Id = es.ProductId
      WHERE eri.ExpiryReturnId IN (?)`,
    [returnIds]
  );

  // NEW: the credit notes of every return (number, invoice ref, PO, amount) and of every product
  const notes = await getCreditNotesForReturns(returnIds);
  const notesByReturn = {};
  notes.forEach((n) => { (notesByReturn[n.ExpiryReturnId] = notesByReturn[n.ExpiryReturnId] || []).push(n); });
  const notesByItem = creditNotesByItem(notes);

  const itemMap = {};
  items.forEach((item) => {
    if (!itemMap[item.ExpiryReturnId]) itemMap[item.ExpiryReturnId] = [];
    itemMap[item.ExpiryReturnId].push(item);
  });

  return headers.map((header) => {
    const products = itemMap[header.Id] || [];
    let totalAmount = 0;
    const itemStatusSummary = { AcceptedQty: 0, RejectedQty: 0, PendingQty: 0 };

    products.forEach((p) => {
      totalAmount += Number(p.Total);
      itemStatusSummary.AcceptedQty += Number(p.AcceptedQuantity || 0);
      itemStatusSummary.RejectedQty += Number(p.RejectedQuantity || 0);
      if (p.Status === "Pending") itemStatusSummary.PendingQty += Number(p.Quantity);
    });

    return {
      Id: header.Id, ReturnNumber: header.ReturnNumber, SupplierName: header.SupplierName,
      CreatedAt: header.CreatedAt,
      // a finalized (locked) return is shown as Settled; a Settled / Cancelled one can only be viewed, never settled again
      ReturnStatus: Number(header.IsLocked) && header.Status !== "CANCELLED"
        ? (itemStatusSummary.RejectedQty > 0 ? (itemStatusSummary.AcceptedQty > 0 ? "SETTLED_PART_WRITTEN_OFF" : "WRITTEN_OFF") : "SETTLED")
        : header.Status,
      CanSettle: !Number(header.IsLocked) && header.Status !== "SETTLED" && header.Status !== "CANCELLED",
      ItemStatusSummary: itemStatusSummary,
      TotalAmount: totalAmount,
      CreditNotes: (notesByReturn[header.Id] || []).map((n) => ({
        Id: n.Id, Number: n.Reference, InvoiceRefNo: n.SupplierInvoiceRefNo || "", PoNo: n.PoNo || "",
        Date: n.CreditDateText, Type: n.SettlementTypeLabel, Total: Number(n.TotalAmount) || 0,
      })),
      CreditTotal: (notesByReturn[header.Id] || []).reduce((a, n) => a + (Number(n.TotalAmount) || 0), 0),
      products: products.map((p) => ({
        CreditNotes: notesByItem.get(p.ItemId) || [],
        ProductName: p.ProductName, BatchNumber: p.BatchNumber, Quantity: Number(p.Quantity),
        AcceptedQty: Number(p.AcceptedQuantity || 0), RejectedQty: Number(p.RejectedQuantity || 0),
        PurchasePrice: p.PurchasePrice, IgstPercentage: p.IgstPercentage, Total: p.Total,
        ItemStatus: p.Status,
      })),
    };
  });
};

const getSupplierBalance = async (connection, supplierId) => {
  const [[row]] = await connection.query(
    `SELECT IFNULL(SUM(DebitAmount - CreditAmount), 0) AS balance FROM SupplierSettlementLedger WHERE SupplierId = ?`,
    [supplierId]
  );
  return row.balance;
};

/* ---------------------------------------------------------------------
 * CREDIT NOTE DETAILS OF A SETTLEMENT  (NEW)
 *
 * The supplier often approves the products of one debit note SEPARATELY, each with its own credit note
 * number (and against its own invoice / PO). So every line that is settled now can carry its own
 * credit note details; lines without their own details use the details at the bottom of the page.
 * Lines with the same credit note (same number + invoice ref + PO + date + type) become ONE credit note,
 * so "4 products, 2 credit notes" saves exactly 2 SupplierCreditNotes rows, each with its lines in
 * SupplierCreditNoteItems.
 *
 * Form fields
 *   page level : creditNoteNumber, creditNoteDate (YYYY-MM-DD), invoiceRefNo, poNo, settlementType
 *   per line   : acceptedQty_<itemId>; and when "own credit note" is ticked: ownCn_<itemId>=1,
 *                cnNo_<itemId>, cnDate_<itemId>, invRef_<itemId>, poNo_<itemId>
 * Rules
 *   - Credit Note type needs a credit note number. Next-purchase adjustment / replacement stock need a
 *     credit note number OR an invoice ref no OR a PO no (the reference the supplier gave).
 *   - A credit note number can be entered only once per supplier (typing mistakes / double entry).
 *   - CN date: not in the future, and not before the return was sent.
 * ------------------------------------------------------------------- */
const SETTLEMENT_TYPES = { CREDIT_NOTE: "Credit Note", PRICE_ADJUSTMENT: "Next Purchase Adjustment", REPLACEMENT_STOCK: "Replacement Stock" };
const refText = (v, max = 60) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const settleError = (msg) => { const e = new Error(msg); e.isUserError = true; return e; };

const readCnDate = (value, sentOn, label) => {
  if (value == null || String(value).trim() === "") return moment().format("YYYY-MM-DD");
  const m = moment(String(value).trim(), ["YYYY-MM-DD", "DD-MM-YYYY", "D-M-YYYY", "DD/MM/YYYY"], true);
  if (!m.isValid()) throw settleError(`${label}: the credit note date "${value}" is not a valid date.`);
  if (m.isAfter(moment(), "day")) throw settleError(`${label}: the credit note date cannot be in the future.`);
  if (sentOn && m.isBefore(moment(sentOn), "day")) throw settleError(`${label}: the credit note date is before the return was sent (${moment(sentOn).format("DD-MM-YYYY")}).`);
  return m.format("YYYY-MM-DD");
};

/** Columns of SupplierCreditNotes (cached) - optional columns are only written when they exist. */
let creditNoteCols = null;
const creditNoteColumns = async (connection) => {
  if (creditNoteCols) return creditNoteCols;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SupplierCreditNotes'`);
  const set = new Set(rows.map((r) => r.c));
  if (set.has("SupplierInvoiceRefNo") && set.has("SubmitToken")) creditNoteCols = set;          // cache only once the migration has run
  return set;
};

/** A field posted twice arrives as an array: use the first value. */
const scalar = (v) => (Array.isArray(v) ? v[0] : v);

/** Reference text: trimmed, single spaces, max 60 characters (longer = error, never cut silently). */
const readRef = (v, label, what) => {
  const t = refText(scalar(v), 1000);
  if (t.length > 60) throw settleError(`${label}: the ${what} is too long (max 60 characters).`);
  return t;
};

/** Accept Qty: digits with at most 3 decimals ("4abc", "1e1", "-1", "0.0004" are refused). */
const readQty = (v, label) => {
  const raw = scalar(v);
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
  const t = String(raw).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) throw settleError(`${label}: Accept Qty "${t}" is not a valid quantity (numbers only, at most 3 decimals).`);
  return Number(t);
};

const readReturnId = (v) => {
  const id = Number(scalar(v));
  if (!Number.isInteger(id) || id <= 0) throw settleError("This settlement could not be found. Open it again from the debit note register.");
  return id;
};

/**
 * NEW: fingerprint of everything the settlement page shows (quantities, amounts, rates, credit notes, status).
 * The page sends it back; if it changed in between (another save, another tab, another user, a GST revision,
 * a product added) the save is refused and the page is shown again with the latest figures.
 */
const settlementVersion = async (conn, expiryReturnId) => {
  const [[r]] = await conn.query(
    `SELECT er.Status, IFNULL(er.IsLocked, 0) AS L,
            (SELECT GROUP_CONCAT(CONCAT_WS(':', eri.Id, eri.Quantity, IFNULL(eri.AcceptedQuantity, 0), IFNULL(eri.RejectedQuantity, 0),
                                           IFNULL(eri.SettledAmount, 0), IFNULL(di.Rate, ''), IFNULL(di.GSTPercent, '')) ORDER BY eri.Id SEPARATOR ';')
               FROM ExpiryReturnItems eri LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
              WHERE eri.ExpiryReturnId = er.Id) AS items,
            (SELECT CONCAT(COUNT(*), ':', IFNULL(MAX(Id), 0)) FROM SupplierCreditNotes WHERE ExpiryReturnId = er.Id) AS notes
       FROM ExpiryReturns er WHERE er.Id = ?`, [expiryReturnId]);
  if (!r) return "";
  return require("crypto").createHash("sha1").update([r.Status, r.L, r.items, r.notes].join("|")).digest("hex").slice(0, 16);
};

/** Credit notes already saved by this exact page submission (double click / refresh / browser re-send). */
const notesOfSubmission = async (conn, expiryReturnId, token) => {
  if (!token) return [];
  const [rows] = await conn.query(
    `SELECT Id AS id, IFNULL(NULLIF(CreditNoteNumber, ''), IFNULL(CONCAT('INV ', SupplierInvoiceRefNo), CONCAT('PO ', PoNo))) AS reference,
            TotalAmount AS total, (SELECT COUNT(*) FROM SupplierCreditNoteItems ci WHERE ci.CreditNoteId = cn.Id) AS nLines
       FROM SupplierCreditNotes cn WHERE ExpiryReturnId = ? AND SubmitToken = ? ORDER BY Id`, [expiryReturnId, token]);
  return rows.map((r) => ({ id: r.id, reference: r.reference, total: Number(r.total), lines: Number(r.nLines) }));
};

/** The reference shown in ledgers when there is no credit note number. */
const cnReference = (g) => g.cn || (g.inv ? `INV ${g.inv}` : `PO ${g.po}`);

/**
 * Settles accepted quantities of an expiry return (credit note(s) + accounting) on an OPEN transaction.
 * Used by Save Settlement and by Finalize.
 * Earlier fixes kept: every ExpiredStock row gets its own settled amount; header status from numbers;
 * the CREDIT_NOTE ledger row is a CREDIT; rate / GST come from the debit note line.
 * CHANGED: one credit note per distinct credit note (see above) instead of one for everything typed;
 *          settlement type, supplier invoice ref no, PO no and credit note date are saved;
 *          the lines of every credit note are saved (SupplierCreditNoteItems).
 */
const applySettlement = async (connection, data, userId, opts = {}) => {
    const expiryReturnId = readReturnId(data.expReturnId);
    const token = refText(scalar(data.submitToken), 40);

    const [[header]] = await connection.query(
      `SELECT SupplierId, ReturnNumber, IsLocked, Status, CreatedAt FROM ExpiryReturns WHERE Id = ? FOR UPDATE`,
      [expiryReturnId]
    );
    if (!header) throw settleError("This settlement could not be found. Open it again from the debit note register.");
    const supplierId = header.SupplierId;
    // FIX: settlements of the same supplier run one after the other, so the duplicate credit note check and the
    //      running balance of the supplier settlement ledger are always correct. This MUST be the first read after
    //      the return's lock: MySQL fixes what a transaction "sees" at its first plain SELECT, so locking later would
    //      still show the data from before the other settlement was saved.
    await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [supplierId]);

    // FIX: the same page sent twice (double click, refresh, browser re-send) -> nothing new, report what the first one saved
    if (!opts.skipDuplicateCheck) {
      const already = await notesOfSubmission(connection, expiryReturnId, token);
      if (already.length) return { totalAmount: 0, creditNotes: already, duplicate: true };
    }

    if (header.IsLocked) throw settleError("This settlement is already finalized. Nothing more can be saved on it.");
    if (header.Status === "CANCELLED") throw settleError("This settlement was cancelled.");
    if (header.Status === "SETTLED") throw settleError("This settlement is already fully settled.");

    // FIX: a page opened before someone else changed the settlement (other tab, other user, GST revised, product added)
    if (!opts.skipVersionCheck) {
      const sent = refText(scalar(data.pageVersion), 40);
      if (!sent) throw settleError("This page is old. It has been reloaded - check the figures and save again.");
      if (sent !== (await settlementVersion(connection, expiryReturnId)))
        throw settleError("This settlement was changed after you opened the page (another save, another tab or another user). The page now shows the latest figures - check them and save again.");
    }

    const type = SETTLEMENT_TYPES[scalar(data.settlementType)] ? scalar(data.settlementType) : "CREDIT_NOTE";
    const pageRef = {
      cn: readRef(data.creditNoteNumber, "Credit note details", "credit note number"),
      inv: readRef(data.invoiceRefNo, "Credit note details", "invoice ref no"),
      po: readRef(data.poNo, "Credit note details", "PO no"),
      dateRaw: scalar(data.creditNoteDate),
    };

    const [items] = await connection.query(
      `SELECT eri.Id, eri.Quantity, eri.ExpiredStockId, IFNULL(eri.AcceptedQuantity, 0) AS OldAccepted,
              IFNULL(eri.RejectedQuantity, 0) AS OldRejected,
              es.ProductId, p.ProductName, es.BatchNumber,
              COALESCE(di.Rate, es.PurchasePrice) AS PurchasePrice,
              COALESCE(di.GSTPercent, es.GSTPercent) AS IgstPercentage
         FROM ExpiryReturnItems eri
         LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
         JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
         LEFT JOIN Products p ON p.Id = es.ProductId
        WHERE eri.ExpiryReturnId = ?`,
      [expiryReturnId]
    );

    const groups = new Map();                     // one entry per credit note to create
    const settledPerExpired = new Map();          // ExpiredStock.Id -> amount settled now
    let totalAmount = 0;

    for (const item of items) {
      const label = `${item.ProductName || "Item " + item.Id}${item.BatchNumber ? " (" + item.BatchNumber + ")" : ""}`;
      const newAccepted = readQty(data[`acceptedQty_${item.Id}`], label);
      const oldAccepted = parseFloat(item.OldAccepted) || 0;
      const sentQty = Number(item.Quantity);
      const open = round2(sentQty - oldAccepted - (parseFloat(item.OldRejected) || 0));

      if (newAccepted < 0) throw settleError(`${label}: Accept Qty cannot be negative.`);
      if (newAccepted > open + 1e-9) throw settleError(`${label}: Accept Qty ${newAccepted} is more than the pending quantity ${open}.`);
      if (newAccepted === 0) continue;

      // credit note details of this line: its own, or the ones at the bottom of the page
      const own = String(scalar(data[`ownCn_${item.Id}`]) || "") === "1";
      const ref = own
        ? { cn: readRef(data[`cnNo_${item.Id}`], label, "credit note number"), inv: readRef(data[`invRef_${item.Id}`], label, "invoice ref no"),
            po: readRef(data[`poNo_${item.Id}`], label, "PO no"), dateRaw: scalar(data[`cnDate_${item.Id}`]) || pageRef.dateRaw }
        : pageRef;
      if (type === "CREDIT_NOTE" && !ref.cn)
        throw settleError(`${label}: enter the credit note number${own ? " for this product" : ""}.`);
      if (!ref.cn && !ref.inv && !ref.po)
        throw settleError(`${label}: enter the credit note number, the supplier's invoice ref no or the PO no.`);
      const date = readCnDate(ref.dateRaw, header.CreatedAt, label);

      const rate = Number(item.PurchasePrice);
      const gst = Number(item.IgstPercentage);
      const lineTaxable = round2(newAccepted * rate);
      const lineGst = round2((lineTaxable * gst) / 100);
      const lineTotal = round2(lineTaxable + lineGst);
      totalAmount += lineTotal;

      const key = [ref.cn.toUpperCase(), ref.inv.toUpperCase(), ref.po.toUpperCase(), date].join("|");
      if (!groups.has(key)) groups.set(key, { cn: ref.cn, inv: ref.inv, po: ref.po, date, taxable: 0, gst: 0, total: 0, lines: [] });
      const g = groups.get(key);
      g.taxable += lineTaxable; g.gst += lineGst; g.total += lineTotal;
      g.lines.push({ itemId: item.Id, productId: item.ProductId, label, qty: newAccepted, rate, gstPercent: gst, taxable: lineTaxable, gstAmount: lineGst, total: lineTotal });

      const totalAccepted = oldAccepted + newAccepted;
      const itemStatus = Math.abs(totalAccepted - sentQty) < 1e-9 ? "SETTLED" : "PARTIAL";
      await connection.query(
        `UPDATE ExpiryReturnItems
            SET AcceptedQuantity = AcceptedQuantity + ?, SettledAmount = IFNULL(SettledAmount, 0) + ?,
                Status = ?, UpdatedAt = NOW()
          WHERE Id = ?`,
        [newAccepted, lineTotal, itemStatus, item.Id]
      );
      settledPerExpired.set(item.ExpiredStockId, round2((settledPerExpired.get(item.ExpiredStockId) || 0) + lineTotal));
    }
    totalAmount = round2(totalAmount);

    // the same credit note number may not be used with two different invoice / PO / date on one save
    const byNumber = new Map();
    for (const g of groups.values()) {
      if (!g.cn) continue;
      const k = g.cn.toUpperCase();
      if (byNumber.has(k)) throw settleError(`Credit note ${g.cn} is entered with two different invoice ref / PO no / dates. A credit note has one date and one reference - make them the same, or correct the number.`);
      byNumber.set(k, g);
    }
    // ... and a credit note number is entered only once per supplier
    if (byNumber.size) {
      const [dups] = await connection.query(
        `SELECT CreditNoteNumber, ReferenceReturnNumber, DATE_FORMAT(CreditDate, '%d-%m-%Y') AS d
           FROM SupplierCreditNotes WHERE SupplierId = ? AND UPPER(TRIM(CreditNoteNumber)) IN (?)`,
        [supplierId, [...byNumber.keys()]]);
      if (dups.length) {
        const d = dups[0];
        throw settleError(`Credit note ${d.CreditNoteNumber} is already entered for this supplier (return ${d.ReferenceReturnNumber}, dated ${d.d}). Check the number.`);
      }
    }

    const created = [];
    if (groups.size) {
      const [[supplierAccount]] = await connection.query(`SELECT Id FROM Accounts WHERE SupplierId = ? LIMIT 1`, [supplierId]);
      if (!supplierAccount) throw new Error("Supplier account not found");
      const [[purchaseReturnAccount]] = await connection.query(`SELECT Id FROM Accounts WHERE AccountName = 'Purchase Return' LIMIT 1`);
      if (!purchaseReturnAccount) throw new Error("Purchase Return account not found");

      for (const g of groups.values()) {
        g.taxable = round2(g.taxable); g.gst = round2(g.gst); g.total = round2(g.total);
        const reference = cnReference(g);
        const narration = `Expiry Settlement - ${header.ReturnNumber}` +
          (g.cn ? ` - CN ${g.cn}` : "") + (g.inv ? ` - Inv ${g.inv}` : "") + (g.po ? ` - PO ${g.po}` : "");
        const gstPercents = [...new Set(g.lines.map((l) => l.gstPercent))];

        const cnRow = {
          SupplierId: supplierId, ExpiryReturnId: expiryReturnId, ReferenceReturnNumber: header.ReturnNumber,
          CreditNoteNumber: g.cn || "", SupplierInvoiceRefNo: g.inv || null, PoNo: g.po || null, SettlementType: type,
          CreditDate: g.date, Amount: g.taxable, GSTPercent: gstPercents.length === 1 ? gstPercents[0] : null,
          GSTAmount: g.gst, TotalAmount: g.total, SubmitToken: token || null,
          Remarks: `${SETTLEMENT_TYPES[type]}: ${g.lines.map((l) => `${l.label} x ${l.qty}`).join(", ")}`.slice(0, 250),
          CreatedBy: userId,
        };
        const cols = await creditNoteColumns(connection);
        for (const need of ["SupplierInvoiceRefNo", "PoNo", "SettlementType", "SubmitToken"]) {
          if (!cols.has(need)) throw new Error(`Column SupplierCreditNotes.${need} is missing - run migrations/2026-10-26_supplier_credit_note_refs.sql first.`);
        }
        Object.keys(cnRow).forEach((k) => { if (!cols.has(k)) delete cnRow[k]; });    // GSTPercent / Remarks only when the table has them
        const [creditResult] = await connection.query(`INSERT INTO SupplierCreditNotes SET ?`, [cnRow]);
        const referenceId = creditResult.insertId;

        await connection.query(
          `INSERT INTO SupplierCreditNoteItems
             (CreditNoteId, ExpiryReturnId, ExpiryReturnItemId, ProductId, Quantity, Rate, GSTPercent, Amount, GSTAmount, TotalAmount, CreatedBy, CreatedAt)
           VALUES ?`,
          [g.lines.map((l) => [referenceId, expiryReturnId, l.itemId, l.productId, l.qty, l.rate, l.gstPercent, l.taxable, l.gstAmount, l.total, userId, moment().format("YYYY-MM-DD HH:mm:ss")])]
        );

        const balance = await getSupplierBalance(connection, supplierId);
        await connection.query(
          `INSERT INTO SupplierSettlementLedger
             (SupplierId, ExpiryReturnId, ReferenceType, ReferenceId, ReferenceNumber, DebitAmount,
              CreditAmount, BalanceAfter, Remarks, CreatedBy)
           VALUES (?, ?, 'CREDIT_NOTE', ?, ?, 0, ?, ?, ?, ?)`,
          [supplierId, expiryReturnId, referenceId, reference, g.total, round2(balance - g.total), narration.slice(0, 255), userId]
        );

        // double entry:  Dr Supplier A/c   Cr Purchase Return A/c  (dated on the credit note date)
        const [voucherResult] = await connection.query(
          `INSERT INTO Vouchers (VoucherNo, VoucherType, VoucherDate, ReferenceType, ReferenceId, Description, CreatedBy)
           VALUES (?, 'CREDIT_NOTE', ?, 'SupplierCreditNote', ?, ?, ?)`,
          [reference, g.date, referenceId, narration, userId]
        );
        const voucherId = voucherResult.insertId;
        await connection.query(
          `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, ?, 0), (?, ?, 0, ?)`,
          [voucherId, supplierAccount.Id, g.total, voucherId, purchaseReturnAccount.Id, g.total]);

        await connection.query(
          `INSERT INTO SupplierLedger
             (SupplierId, EntryDate, TransactionType, ReferenceType, ReferenceId, DebitAmount, CreditAmount,
              Description, VoucherId, FinancialYear)
           VALUES (?, ?, 'CREDIT_NOTE', 'SupplierCreditNote', ?, 0, ?, ?, ?, ?)`,
          [supplierId, g.date, referenceId, g.total, narration, voucherId, await getFinancialYear(g.date)]
        );

        // legacy table kept in sync (temporary)
        await connection.query(
          `INSERT INTO PaymentsToSupplier
             (SupplierId, PaymentNo, PaymentDate, PaymentType, Description, Credit, Debit, ReferenceType, ReferenceId)
           VALUES (?, ?, ?, 'CREDIT_NOTE', ?, 0, ?, 'CREDIT_NOTE', ?)`,
          [supplierId, reference, g.date, narration, g.total, referenceId]
        );

        created.push({ id: referenceId, reference, total: g.total, lines: g.lines.length });
      }

      // every ExpiredStock row gets ITS OWN settled amount
      for (const [expiredStockId, settledNow] of settledPerExpired) {
        const [[es]] = await connection.query(
          `SELECT SettledAmount, ExpiredAmount FROM ExpiredStock WHERE Id = ? FOR UPDATE`, [expiredStockId]);
        const expiredAmount = Number(es.ExpiredAmount) || 0;
        const updatedSettled = round2((Number(es.SettledAmount) || 0) + settledNow);
        const remaining = round2(expiredAmount - updatedSettled);

        let settlementStatus = "PENDING";
        if (updatedSettled > 0 && updatedSettled < expiredAmount) settlementStatus = "PARTIAL";
        else if (updatedSettled >= expiredAmount) settlementStatus = "FULLY_SETTLED";

        await connection.query(
          `UPDATE ExpiredStock SET SettledAmount = ?, RemainingAmount = ?, SettlementStatus = ? WHERE Id = ?`,
          [updatedSettled, remaining, settlementStatus, expiredStockId]
        );
      }
    }

    // header status (numbers, not strings)
    const [[summary]] = await connection.query(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN Status = 'SETTLED' THEN 1 ELSE 0 END) AS settledCount
         FROM ExpiryReturnItems WHERE ExpiryReturnId = ?`,
      [expiryReturnId]
    );
    const total = Number(summary.total);
    const settledCount = Number(summary.settledCount || 0);

    let headerStatus = "SENT";
    if (settledCount === total) headerStatus = "SETTLED";
    else if (settledCount > 0) headerStatus = "PARTIAL_SETTLED";

    await connection.query(
      `UPDATE ExpiryReturns SET Status = ?, UpdatedAt = NOW() WHERE Id = ?`, [headerStatus, expiryReturnId]);
  return { totalAmount, creditNotes: created };
};

const settleSupplierReturn = async (data, userId) => {
  const connection = await dbConnection.pool.promise().getConnection();

  try {
    await connection.beginTransaction();
    const result = await applySettlement(connection, data, userId);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/** Debit note print data (header, items, summary). CHANGED: rates from the ExpiredStock snapshot. */
const getSupplierDebitNoteRegisterInHtml = async (expiryReturnId) => {
  const connection = await dbConnection.pool.promise().getConnection();

  try {
    const [headerRows] = await connection.query(
      `SELECT er.Id, er.ReturnNumber, DATE_FORMAT(er.CreatedAt, '%d-%m-%Y') AS ReturnDate,
              dn.DebitNoteNumber, DATE_FORMAT(dn.DebitDate, '%d-%m-%Y') AS DebitNoteDate,
              s.Name AS SupplierName, s.GstIn, s.Address, s.DlNo, s.Cin, s.State, s.City, s.Pincode
         FROM ExpiryReturns er
         JOIN Suppliers s ON s.Id = er.SupplierId
         LEFT JOIN SupplierDebitNotes dn ON dn.ExpiryReturnId = er.Id
        WHERE er.Id = ?`,
      [expiryReturnId]
    );
    if (!headerRows.length) return null;

    const [items] = await connection.query(
      `SELECT p.ProductName, p.Hsn, es.BatchNumber, DATE_FORMAT(es.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
              eri.Quantity, COALESCE(di.Rate, es.PurchasePrice) AS PurchasePrice,
              COALESCE(di.GSTPercent, es.GSTPercent) AS GstPercent,
              COALESCE(di.Amount, ROUND(eri.Quantity * es.PurchasePrice, 2)) AS Taxable,
              COALESCE(di.GSTAmount, ROUND(eri.Quantity * es.PurchasePrice * es.GSTPercent / 100, 2)) AS GstAmount,
              COALESCE(di.TotalAmount, ROUND(eri.Quantity * es.PurchasePrice * (1 + es.GSTPercent / 100), 2)) AS Total
         FROM ExpiryReturnItems eri
         LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
         JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
         JOIN Products p ON p.Id = es.ProductId
        WHERE eri.ExpiryReturnId = ?`,
      [expiryReturnId]
    );

    const [summaryRows] = await connection.query(
      `SELECT SUM(COALESCE(di.Amount, ROUND(eri.Quantity * es.PurchasePrice, 2))) AS TaxableAmount,
              SUM(COALESCE(di.GSTAmount, ROUND(eri.Quantity * es.PurchasePrice * es.GSTPercent / 100, 2))) AS GstAmount,
              SUM(COALESCE(di.TotalAmount, ROUND(eri.Quantity * es.PurchasePrice * (1 + es.GSTPercent / 100), 2))) AS GrandTotal
         FROM ExpiryReturnItems eri
         LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
         JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
        WHERE eri.ExpiryReturnId = ?`,
      [expiryReturnId]
    );

    return { header: headerRows[0], items, summary: summaryRows[0] };
  } finally {
    connection.release();               // FIX: was never released
  }
};

/** Supplier expiry-settlement ledger. */
const supplierExpSettlementLedger = async (supplierId, fromDate, toDate) => {
  let where = `WHERE SupplierId = ?`;
  const params = [supplierId];

  if (fromDate && toDate) { where += ` AND DATE(CreatedAt) BETWEEN ? AND ?`; params.push(fromDate, toDate); }

  const [rows] = await dbConnection.execute(
    `SELECT Id, CreatedAt, ReferenceType, ReferenceId, DebitAmount, CreditAmount, BalanceAfter, Remarks
       FROM SupplierSettlementLedger ${where} ORDER BY CreatedAt ASC, Id ASC`,
    params
  );
  return rows;
};

const getSupplierSettlementView = async (expiryReturnId) => {
  const [[header]] = await dbConnection.execute(
    `SELECT er.*, s.Name AS SupplierName FROM ExpiryReturns er JOIN Suppliers s ON s.Id = er.SupplierId WHERE er.Id = ?`,
    [expiryReturnId]
  );
  const [items] = await dbConnection.execute(
    `SELECT eri.*, p.ProductName
       FROM ExpiryReturnItems eri
       JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
       JOIN Products p ON p.Id = es.ProductId
      WHERE eri.ExpiryReturnId = ?`,
    [expiryReturnId]
  );
  const creditNotes = await getCreditNotesForReturns(expiryReturnId);
  const perItem = creditNotesByItem(creditNotes);
  items.forEach((i) => { i.CreditNotes = perItem.get(i.Id) || []; });
  const [writeoffs] = await dbConnection.execute(
    `SELECT * FROM SupplierReturnWriteOff WHERE ExpiryReturnId = ?`, [expiryReturnId]);
  const [ledger] = await dbConnection.execute(
    `SELECT * FROM SupplierSettlementLedger WHERE SupplierId = ? ORDER BY Id DESC`, [header.SupplierId]);

  return { header, items, creditNotes, writeoffs, ledger };
};

/**
 * Final call: rejected quantity (sent minus accepted) is written off at the debit note's rate and GST, the batch's
 * remaining amount is closed accordingly, and the return is locked. Refuses to run twice.
 */
const finalizeExpiryReturn = async (expReturnId, userId, formData = null) => {   // expReturnId is re-read (validated) below
  const connection = await dbConnection.pool.promise().getConnection();

  try {
    await connection.beginTransaction();

    // FIX: a second run (double click / reload) wrote the rejected quantity off AGAIN
    expReturnId = readReturnId(expReturnId);
    const [[ret]] = await connection.query(`SELECT Id, SupplierId, ReturnNumber, Status, IFNULL(IsLocked, 0) AS IsLocked FROM ExpiryReturns WHERE Id = ? FOR UPDATE`, [expReturnId]);
    if (!ret) throw settleError("This settlement could not be found.");
    if (ret.Status === "CANCELLED") throw settleError("This settlement was cancelled.");
    // FIX: second click on "Yes, finalize" -> not an error, it is simply done already
    if (Number(ret.IsLocked)) { const e = settleError("This settlement is already finalized."); e.alreadyDone = true; throw e; }
    await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [ret.SupplierId]);    // first read after the lock (see applySettlement)
    if (formData) {
      const sent = refText(scalar(formData.pageVersion), 40);
      if (!sent) throw settleError("This page is old. It has been reloaded - check the figures and finalize again.");
      if (sent !== (await settlementVersion(connection, expReturnId)))
        throw settleError("This settlement was changed after you opened the page (another save, another tab or another user). The page now shows the latest figures - check them and finalize again.");
    }

    // FIX: "Finalize & Close" used to ignore the Accept Qty boxes on the page, so everything the person had just entered
    // (but not yet saved) was written off as REJECTED. The quantities typed on the page are now settled first, in the
    // same transaction, and only the rest is written off.
    let settledNow = 0, createdNotes = [];
    if (formData) {
      const typed = Object.keys(formData).some((k) => k.startsWith("acceptedQty_") && String(scalar(formData[k]) ?? "").trim() !== "" && String(scalar(formData[k])).trim() !== "0");
      if (typed) {
        const r = await applySettlement(connection, { ...formData, expReturnId }, userId, { skipVersionCheck: true, skipDuplicateCheck: true });
        settledNow = r.totalAmount; createdNotes = r.creditNotes || [];
      }
    }

    const [items] = await connection.query(
      `SELECT eri.Id, eri.ExpiredStockId, eri.Quantity, IFNULL(eri.AcceptedQuantity, 0) AS AcceptedQty,
              COALESCE(di.Quantity, eri.Quantity) AS DnQty,
              COALESCE(di.Rate, es.PurchasePrice) AS PurchasePrice, es.StockId,
              COALESCE(di.GSTPercent, es.GSTPercent) AS GSTPercent, es.SupplierId, es.ProductId
         FROM ExpiryReturnItems eri
         LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
         JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
        WHERE eri.ExpiryReturnId = ?`,
      [expReturnId]
    );

    const writtenOffByBatch = new Map();                       // ExpiredStock.Id -> amount written off now
    let writeOffQty = 0, writeOffTotal = 0, ledgerCloseTotal = 0;
    for (const item of items) {
      const rejected = Number(item.Quantity) - Number(item.AcceptedQty);
      if (rejected > 0) {
        const rate = Number(item.PurchasePrice);
        const gst = Number(item.GSTPercent);
        const amount = round2(rejected * rate);
        const gstAmount = round2((amount * gst) / 100);
        const total = round2(amount + gstAmount);

        await connection.query(
          `INSERT INTO SupplierReturnWriteOff
             (SupplierId, ExpiryReturnId, ExpiryReturnItemId, StockId, ProductId, RejectedQty, Rate,
              GSTPercent, Amount, GSTAmount, TotalAmount, CreatedBy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.SupplierId, expReturnId, item.Id, item.StockId, item.ProductId, rejected, rate, gst,
           amount, gstAmount, total, userId]
        );
        await connection.query(`UPDATE ExpiryReturnItems SET RejectedQuantity = ? WHERE Id = ?`, [rejected, item.Id]);
        writtenOffByBatch.set(item.ExpiredStockId, round2((writtenOffByBatch.get(item.ExpiredStockId) || 0) + total));
        writeOffQty += rejected; writeOffTotal += total;
        // the supplier ledger only holds what the DEBIT NOTE charged (the debit note can be for fewer units than were sent,
        // e.g. 3 of 4 approved: the 4th unit was never billed to the supplier, it is only a loss for us)
        const billedLeft = Math.max(0, Number(item.DnQty) - Number(item.AcceptedQty));
        if (billedLeft > 0) {
          const t = round2(billedLeft * rate);
          ledgerCloseTotal += round2(t + round2((t * gst) / 100));
        }
      }
    }
    writeOffTotal = round2(writeOffTotal); ledgerCloseTotal = round2(ledgerCloseTotal);

    // FIX: the supplier settlement ledger kept the rejected amount as "still owed by the supplier" for ever. The supplier
    // refused it, so it is closed here with a WRITE_OFF credit row and the balance of this return goes to zero.
    if (ledgerCloseTotal > 0) {
      const balance = Number(await getSupplierBalance(connection, ret.SupplierId)) || 0;
      await connection.query(
        `INSERT INTO SupplierSettlementLedger
           (SupplierId, ExpiryReturnId, ReferenceType, ReferenceId, ReferenceNumber, DebitAmount, CreditAmount, BalanceAfter, Remarks, CreatedBy)
         VALUES (?, ?, 'WRITE_OFF', ?, ?, 0, ?, ?, ?, ?)`,
        [ret.SupplierId, expReturnId, expReturnId, ret.ReturnNumber, ledgerCloseTotal, round2(balance - ledgerCloseTotal),
         `Not approved by the supplier: ${writeOffQty} unit(s) written off`, userId]);
    }

    // NEW: the written-off quantity is no longer "remaining" on its batch, so a batch whose every unit is either
    // credited or written off becomes FULLY_SETTLED (it used to stay PARTIAL with the rejected amount "remaining").
    for (const [expiredStockId, writtenOff] of writtenOffByBatch) {
      const [[es]] = await connection.query(`SELECT ExpiredAmount, SettledAmount FROM ExpiredStock WHERE Id = ? FOR UPDATE`, [expiredStockId]);
      const settled = Number(es.SettledAmount) || 0;
      const remaining = Math.max(0, round2(Number(es.ExpiredAmount) - settled - writtenOff));
      const status = remaining <= 0.005 ? "FULLY_SETTLED" : (settled > 0 ? "PARTIAL" : "PENDING");
      await connection.query(`UPDATE ExpiredStock SET RemainingAmount = ?, SettlementStatus = ? WHERE Id = ?`, [remaining, status, expiredStockId]);
    }

    await connection.query(`UPDATE ExpiryReturns SET Status = 'SETTLED', IsLocked = 1 WHERE Id = ?`, [expReturnId]);
    await connection.commit();
    return { settledNow: round2(settledNow), writeOffQty, writeOffTotal, creditNotes: createdNotes };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/* ---------------------------------------------------------------------
 * REVISE THE GST OF A DEBIT NOTE THAT IS STILL WAITING FOR THE SUPPLIER'S APPROVAL  (NEW)
 *
 * Why: a debit note is built from the GST % that was on the purchase (e.g. 12 %). If the GST rate changes
 * before the supplier approves it (12 % -> 5 %), the debit note, the supplier ledger entry and the amount
 * credited on approval must all follow the new rate - and they must agree with each other.
 *
 * What is changed, in ONE transaction:
 *   - SupplierDebitNoteItems  GSTPercent / GSTAmount / TotalAmount of the revised lines (taxable value unchanged)
 *   - SupplierDebitNotes      GSTAmount / TotalAmount (sum of the lines) + an audit line in Remarks
 *   - SupplierSettlementLedger  the DEBIT_NOTE row (DebitAmount) and the stored BalanceAfter of it and of every
 *                             later row of that supplier (the supplier balance itself is SUM(debit - credit), so it
 *                             is correct automatically)
 *   - ExpiredStock            ExpiredAmount / RemainingAmount follow the change (so "fully settled" is still reached);
 *                             optionally the GST % used for the quantity that has not been sent yet
 * Not allowed: a locked return, or a line that already has an accepted / rejected quantity or a settled amount
 * (its credit note and accounting entries already exist at the old rate).
 * ------------------------------------------------------------------- */

/** Data for the "revise GST" page: header + one row per debit note line (with the lock reason, if any). */
const getDebitNoteForGstRevision = async (expiryReturnId) => {
  const db = dbConnection.pool.promise();

  const [[header]] = await db.query(
    `SELECT er.Id, er.ReturnNumber, er.Status, IFNULL(er.IsLocked, 0) AS IsLocked,
            DATE_FORMAT(er.CreatedAt, '%d-%m-%Y') AS ReturnDate, er.SupplierId, s.Name AS SupplierName,
            dn.Id AS DebitNoteId, dn.DebitNoteNumber, dn.Amount, dn.GSTAmount, dn.TotalAmount, dn.Remarks
       FROM ExpiryReturns er
       JOIN Suppliers s ON s.Id = er.SupplierId
       LEFT JOIN SupplierDebitNotes dn ON dn.ExpiryReturnId = er.Id
      WHERE er.Id = ?`,
    [expiryReturnId]
  );
  if (!header) return null;

  const [rows] = await db.query(
    `SELECT eri.Id AS ItemId, di.Id AS DebitNoteItemId, p.ProductName, es.BatchNumber,
            DATE_FORMAT(es.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
            COALESCE(di.Quantity, eri.Quantity) AS Quantity, eri.Quantity AS ReturnQty,
            COALESCE(di.Rate, es.PurchasePrice) AS Rate,
            COALESCE(di.Amount, ROUND(eri.Quantity * es.PurchasePrice, 2)) AS Taxable,
            COALESCE(di.GSTPercent, es.GSTPercent) AS GstPercent,
            COALESCE(di.GSTAmount, ROUND(eri.Quantity * es.PurchasePrice * es.GSTPercent / 100, 2)) AS GstAmount,
            COALESCE(di.TotalAmount, ROUND(eri.Quantity * es.PurchasePrice * (1 + es.GSTPercent / 100), 2)) AS Total,
            IFNULL(eri.AcceptedQuantity, 0) AS AcceptedQty, IFNULL(eri.RejectedQuantity, 0) AS RejectedQty,
            IFNULL(eri.SettledAmount, 0) AS SettledAmount
       FROM ExpiryReturnItems eri
       JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
       JOIN Products p ON p.Id = es.ProductId
       LEFT JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id
      WHERE eri.ExpiryReturnId = ?
      ORDER BY eri.Id`,
    [expiryReturnId]
  );

  const items = rows.map((r) => {
    let lockedReason = "";
    if (header.Status === "CANCELLED") lockedReason = "The settlement was cancelled.";
    else if (header.Status === "SETTLED") lockedReason = "The settlement is already settled.";
    else if (Number(header.IsLocked)) lockedReason = "The return is finalized.";
    else if (!r.DebitNoteItemId) lockedReason = "No debit note line.";
    else if (Number(r.AcceptedQty) > 0 || Number(r.SettledAmount) > 0) lockedReason = "Already accepted / settled at the old rate.";
    else if (Number(r.RejectedQty) > 0) lockedReason = "Already written off.";
    // the debit note was issued for a different quantity than the one recorded on the return
    const qtyMismatch = !!r.DebitNoteItemId && round2(r.Quantity) !== round2(r.ReturnQty);
    return { ...r, editable: !lockedReason, lockedReason, qtyMismatch };
  });

  return { header, items };
};

/**
 * changes: [{ itemId (ExpiryReturnItems.Id), gstPercent }]   reason is required (it is saved as an audit line).
 * applyToRemaining: also use the new GST % for the quantity of those batches that has not been sent to the supplier yet.
 */
const reviseExpiryReturnGst = async ({ expiryReturnId, changes, reason, applyToRemaining = true, userId, submitToken = null }) => {
  const why = String(reason || "").trim();
  if (why.length < 3) throw new Error("Please give a short reason for changing the GST (it is saved with the debit note).");

  const wanted = toArray(changes).map((c) => ({
    itemId: Number(c.itemId),
    gst: c.gstPercent === undefined || c.gstPercent === null || String(c.gstPercent).trim() === "" ? NaN : Number(c.gstPercent),
  }));
  if (!wanted.length) throw new Error("No GST % was given.");
  wanted.forEach((w) => {
    if (!Number.isInteger(w.itemId) || w.itemId <= 0) throw new Error("Invalid debit note line.");
    if (!(Number.isFinite(w.gst) && w.gst >= 0 && w.gst <= 100)) throw new Error("GST % must be a number between 0 and 100.");
  });
  if (new Set(wanted.map((w) => w.itemId)).size !== wanted.length) throw new Error("The same line was sent twice.");

  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [[ret]] = await connection.query(
      `SELECT Id, SupplierId, ReturnNumber, Status, IFNULL(IsLocked, 0) AS IsLocked FROM ExpiryReturns WHERE Id = ? FOR UPDATE`,
      [expiryReturnId]
    );
    if (!ret) throw new Error("Expiry return not found.");
    await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [ret.SupplierId]);
    if (!(await claimSubmission(connection, submitToken, "REVISE_GST", ret.Id, userId))) {
      await connection.rollback();
      return alreadyDone("This GST change was already saved (the form was sent twice) - nothing was changed again.");
    }
    if (ret.Status === "CANCELLED") throw new Error("This settlement was cancelled, so its GST cannot be changed.");
    if (ret.Status === "SETTLED") throw new Error("This settlement is already settled, so its GST cannot be changed.");
    if (Number(ret.IsLocked)) throw new Error("This return is finalized, so its GST can no longer be changed.");

    const [[dn]] = await connection.query(
      `SELECT Id, DebitNoteNumber, TotalAmount, GSTAmount, Remarks FROM SupplierDebitNotes WHERE ExpiryReturnId = ? FOR UPDATE`,
      [expiryReturnId]
    );
    if (!dn) throw new Error("This return has no debit note.");

    const [items] = await connection.query(
      `SELECT eri.Id, eri.ExpiredStockId, eri.Quantity, IFNULL(eri.AcceptedQuantity, 0) AS AcceptedQty,
              IFNULL(eri.RejectedQuantity, 0) AS RejectedQty, IFNULL(eri.SettledAmount, 0) AS SettledAmount,
              di.Id AS DiId, di.Rate, di.Amount, di.GSTPercent, di.GSTAmount, di.TotalAmount,
              p.ProductName, es.BatchNumber
         FROM ExpiryReturnItems eri
         JOIN SupplierDebitNoteItems di ON di.ExpiryReturnItemId = eri.Id AND di.SupplierDebitNoteId = ?
         JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
         JOIN Products p ON p.Id = es.ProductId
        WHERE eri.ExpiryReturnId = ?
        FOR UPDATE`,
      [dn.Id, expiryReturnId]
    );
    const byId = new Map(items.map((i) => [Number(i.Id), i]));

    const changedLines = [];                      // for the audit text
    const perStock = new Map();                   // ExpiredStock.Id -> { delta, newGst: Set }
    for (const w of wanted) {
      const item = byId.get(w.itemId);
      if (!item) throw new Error(`Line ${w.itemId} does not belong to this return (or has no debit note line).`);

      const oldGst = Number(item.GSTPercent);
      if (round2(oldGst) === round2(w.gst)) continue;                    // unchanged

      if (Number(item.AcceptedQty) > 0 || Number(item.RejectedQty) > 0 || Number(item.SettledAmount) > 0)
        throw new Error(`${item.ProductName} (Batch ${item.BatchNumber}) is already accepted / settled at ${oldGst}%, so its GST cannot be changed.`);

      const taxable = Number(item.Amount);
      const gstAmount = round2((taxable * w.gst) / 100);
      const total = round2(taxable + gstAmount);

      // The batch's ExpiredAmount covers every unit SENT on the return item. If the supplier approved fewer units
      // than were sent (debit note for 380 of 385), the other units follow the same new rate.
      const sentTaxable = round2(Number(item.Quantity) * Number(item.Rate));
      const delta = round2(round2((sentTaxable * w.gst) / 100) - round2((sentTaxable * oldGst) / 100));

      await connection.query(
        `UPDATE SupplierDebitNoteItems SET GSTPercent = ?, GSTAmount = ?, TotalAmount = ? WHERE Id = ?`,
        [w.gst, gstAmount, total, item.DiId]
      );

      const s = perStock.get(item.ExpiredStockId) || { delta: 0, newGst: new Set() };
      s.delta = round2(s.delta + delta);
      s.newGst.add(round2(w.gst));
      perStock.set(item.ExpiredStockId, s);
      changedLines.push(`${item.ProductName} (Batch ${item.BatchNumber}) ${oldGst}% -> ${w.gst}%`);
    }

    if (!changedLines.length) {
      await connection.rollback();
      return { changed: 0, message: "No GST was changed." };
    }

    /* the batches: ExpiredAmount follows the new GST (and, if asked, the not-yet-sent quantity too) */
    for (const [expiredStockId, s] of perStock) {
      const [[es]] = await connection.query(
        `SELECT Id, ExpiredQty, PurchasePrice, GSTPercent, ExpiredAmount, SettledAmount FROM ExpiredStock WHERE Id = ? FOR UPDATE`,
        [expiredStockId]
      );
      let totalDelta = s.delta;
      let snapshotGst = Number(es.GSTPercent);

      if (applyToRemaining && s.newGst.size === 1) {
        const newGst = [...s.newGst][0];
        const [[sent]] = await connection.query(
          `SELECT IFNULL(SUM(eri.Quantity), 0) AS q FROM ExpiryReturnItems eri
            JOIN ExpiryReturns er ON er.Id = eri.ExpiryReturnId
           WHERE eri.ExpiredStockId = ? AND IFNULL(er.Status, '') <> 'CANCELLED'`, [expiredStockId]);
        const unsent = Math.max(0, Number(es.ExpiredQty) - Number(sent.q));
        if (unsent > 0) {
          const taxable = round2(unsent * Number(es.PurchasePrice));
          totalDelta = round2(totalDelta + round2((taxable * newGst) / 100) - round2((taxable * snapshotGst) / 100));
        }
        snapshotGst = newGst;
      }

      const expiredAmount = round2(Number(es.ExpiredAmount) + totalDelta);
      const settled = Number(es.SettledAmount) || 0;
      const remaining = round2(expiredAmount - settled);
      let status = "PENDING";
      if (settled > 0 && settled < expiredAmount) status = "PARTIAL";
      else if (settled > 0 && settled >= expiredAmount) status = "FULLY_SETTLED";

      await connection.query(
        `UPDATE ExpiredStock SET GSTPercent = ?, ExpiredAmount = ?, RemainingAmount = ?, SettlementStatus = ? WHERE Id = ?`,
        [snapshotGst, expiredAmount, remaining, status, expiredStockId]
      );
    }

    /* the debit note header = sum of its lines */
    const [[sums]] = await connection.query(
      `SELECT IFNULL(SUM(GSTAmount), 0) AS gst, IFNULL(SUM(TotalAmount), 0) AS total
         FROM SupplierDebitNoteItems WHERE SupplierDebitNoteId = ?`,
      [dn.Id]
    );
    const newGstTotal = round2(sums.gst);
    const newTotal = round2(sums.total);
    const oldTotal = round2(dn.TotalAmount);
    const oldGstTotal = round2(dn.GSTAmount);
    const diff = round2(newTotal - oldTotal);

    const stamp = moment().format("DD-MM-YYYY HH:mm");
    const audit = `[${stamp}] GST revised by user ${userId}: ${changedLines.join("; ")}. ` +
                  `Total ${oldTotal.toFixed(2)} -> ${newTotal.toFixed(2)} (GST ${oldGstTotal.toFixed(2)} -> ${newGstTotal.toFixed(2)}). Reason: ${why}`;

    await connection.query(
      `UPDATE SupplierDebitNotes
          SET GSTAmount = ?, TotalAmount = ?, UpdatedAt = NOW(),
              Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?)
        WHERE Id = ?`,
      [newGstTotal, newTotal, audit, dn.Id]
    );
    await connection.query(
      `UPDATE ExpiryReturns SET UpdatedAt = NOW(), Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?) WHERE Id = ?`,
      [audit, expiryReturnId]
    );

    /* the supplier settlement ledger: the DEBIT_NOTE row and the stored running balances after it */
    let ledgerUpdated = false;
    if (diff !== 0) {
      const [[row]] = await connection.query(
        `SELECT Id FROM SupplierSettlementLedger
          WHERE SupplierId = ? AND ReferenceType = 'DEBIT_NOTE' AND ReferenceId = ? ORDER BY Id LIMIT 1 FOR UPDATE`,
        [ret.SupplierId, dn.Id]
      );
      if (row) {
        await connection.query(
          `UPDATE SupplierSettlementLedger
              SET DebitAmount = ?, Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?)
            WHERE Id = ?`,
          [newTotal, `GST revised on ${stamp}: ${oldTotal.toFixed(2)} -> ${newTotal.toFixed(2)}`, row.Id]
        );
        await connection.query(
          `UPDATE SupplierSettlementLedger SET BalanceAfter = BalanceAfter + ? WHERE SupplierId = ? AND Id >= ?`,
          [diff, ret.SupplierId, row.Id]
        );
        ledgerUpdated = true;
      }
    }

    await connection.commit();
    return {
      changed: changedLines.length, oldTotal, newTotal, diff, oldGst: oldGstTotal, newGst: newGstTotal, ledgerUpdated,
      message: `GST revised on ${dn.DebitNoteNumber}: ${changedLines.length} line${changedLines.length > 1 ? "s" : ""}. ` +
               `Debit note total ${oldTotal.toFixed(2)} -> ${newTotal.toFixed(2)} (${diff > 0 ? "+" : ""}${diff.toFixed(2)}).` +
               (ledgerUpdated || diff === 0 ? "" : " (No supplier ledger row was found for this debit note, so the ledger was not changed.)"),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};


/* =====================================================================
 * 15. ACCOUNTING ENTRIES (double entry)
 * ===================================================================== */

const createPurchaseEntry = async (connection, supplierId, purchaseId, purchaseNo, purchaseDate, totalAmount, userId) => {
  if (!supplierId || !purchaseId || !purchaseNo || !totalAmount) throw new Error("Missing required fields");
  if (!userId) throw new Error("userId is required");

  const [[supplierAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE SupplierId = ?`, [supplierId]);
  if (!supplierAcc) throw new Error("Supplier account not found");

  const [[purchaseAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE AccountType = 'PURCHASE'`);
  if (!purchaseAcc) throw new Error("Purchase account not found");

  const [voucher] = await connection.execute(
    `INSERT INTO Vouchers (VoucherNo, VoucherType, VoucherDate, ReferenceType, ReferenceId, Description, CreatedBy)
     VALUES (?, 'PURCHASE', ?, ?, ?, ?, ?)`,
    [purchaseNo, purchaseDate, "Purchase", purchaseId, "Purchase Entry", userId]
  );
  const voucherId = voucher.insertId;

  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, ?, 0)`,
    [voucherId, purchaseAcc.Id, totalAmount]);                         // Dr Purchase
  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, 0, ?)`,
    [voucherId, supplierAcc.Id, totalAmount]);                         // Cr Supplier

  return voucherId;
};

const createSaleEntry = async ({ connection, customerId, invoiceId, insertedSaleId, saleDate, totalAmount, userId }) => {
  if (!customerId || !invoiceId || totalAmount == null) throw new Error("Missing required fields in sale entry");
  if (!userId) throw new Error("userId is required");

  const [[customerAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE CustomerId = ?`, [customerId]);
  if (!customerAcc) throw new Error("Customer account not found");

  const [[salesAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE AccountType = 'SALES'`);
  if (!salesAcc) throw new Error("Sales account not found");

  const [voucher] = await connection.execute(
    `INSERT INTO Vouchers (VoucherNo, VoucherType, VoucherDate, ReferenceType, ReferenceId, Description, CreatedBy)
     VALUES (?, 'SALE', ?, ?, ?, ?, ?)`,
    [invoiceId, saleDate, "Sale", insertedSaleId, "Sale Entry", userId]
  );
  const voucherId = voucher.insertId;

  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, ?, 0)`,
    [voucherId, customerAcc.Id, totalAmount]);                         // Dr Customer
  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, 0, ?)`,
    [voucherId, salesAcc.Id, totalAmount]);                            // Cr Sales

  return voucherId;
};

const createPaymentEntry = async ({ connection, supplierId, paymentId, paymentNo, paymentDate, amount, paymentMode, userId }) => {
  if (!supplierId || !paymentId || !amount || !paymentMode) throw new Error("Missing required fields in payment entry");
  if (!userId) throw new Error("userId is required");

  const [[supplierAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE SupplierId = ?`, [supplierId]);
  if (!supplierAcc) throw new Error("Supplier account not found");

  const [[paymentAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE AccountType = ?`, [paymentMode]);
  if (!paymentAcc) throw new Error(`${paymentMode} account not found`);

  const [voucher] = await connection.execute(
    `INSERT INTO Vouchers (VoucherNo, VoucherType, VoucherDate, ReferenceType, ReferenceId, Description, CreatedBy)
     VALUES (?, 'PAYMENT', ?, ?, ?, ?, ?)`,
    [paymentNo, paymentDate, "SupplierPayment", paymentId, `Payment to Supplier`, userId]
  );
  const voucherId = voucher.insertId;

  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, ?, 0)`,
    [voucherId, supplierAcc.Id, amount]);                              // Dr Supplier
  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, 0, ?)`,
    [voucherId, paymentAcc.Id, amount]);                               // Cr Bank / Cash

  return voucherId;
};

const createReceiptEntry = async ({ connection, customerId, receiptId, receiptNo, receiptDate, amount, normalizedPaymentType, userId }) => {
  if (!customerId || !receiptNo || !amount) throw new Error("Missing required fields in receipt entry");
  if (!userId) throw new Error("userId is required");

  const [[customerAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE CustomerId = ?`, [customerId]);
  if (!customerAcc) throw new Error("Customer account not found");

  const [[bankAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE AccountType = ?`, [normalizedPaymentType]);
  if (!bankAcc) throw new Error(`${normalizedPaymentType} account not found`);

  const [voucher] = await connection.execute(
    `INSERT INTO Vouchers (VoucherNo, VoucherType, VoucherDate, ReferenceType, ReferenceId, Description, CreatedBy)
     VALUES (?, 'RECEIPT', ?, ?, ?, ?, ?)`,
    [receiptNo, receiptDate, "CustomerReceipt", receiptId, `Receipt from customer`, userId]
  );
  const voucherId = voucher.insertId;

  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, ?, 0)`,
    [voucherId, bankAcc.Id, amount]);                                  // Dr Bank / Cash
  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, 0, ?)`,
    [voucherId, customerAcc.Id, amount]);                              // Cr Customer

  return voucherId;
};

const createSalesReturnEntry = async ({ connection, customerId, salesReturnId, creditNoteId, amount, returnDate, userId }) => {
  if (!customerId || !salesReturnId || !amount) throw new Error("Missing fields in sales return entry");
  if (!userId) throw new Error("userId is required");

  const [[customerAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE CustomerId = ?`, [customerId]);
  if (!customerAcc) throw new Error("Customer account not found");

  const [[salesReturnAcc]] = await connection.execute(`SELECT Id FROM Accounts WHERE AccountType = 'SALES_RETURN'`);
  if (!salesReturnAcc) throw new Error("Sales Return account not found");

  const [voucher] = await connection.execute(
    `INSERT INTO Vouchers (VoucherNo, VoucherType, VoucherDate, ReferenceType, ReferenceId, Description, CreatedBy)
     VALUES (?, 'DEBIT_NOTE', ?, ?, ?, ?, ?)`,
    [`SR-${salesReturnId}`, returnDate, "SalesReturn", salesReturnId, "Sales Return Entry", userId]
  );
  const voucherId = voucher.insertId;

  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, ?, 0)`,
    [voucherId, salesReturnAcc.Id, amount]);                           // Dr Sales Return
  await connection.execute(
    `INSERT INTO LedgerEntries (VoucherId, AccountId, DebitAmount, CreditAmount) VALUES (?, ?, 0, ?)`,
    [voucherId, customerAcc.Id, amount]);                              // Cr Customer

  return voucherId;
};

/** cash / card / online / cheque / upi -> ledger account type CASH or BANK */
const getAccountTypeFromPaymentType = (paymentType) => {
  if (!paymentType) throw new Error("paymentType is required");

  switch (paymentType.trim().toLowerCase()) {
    case "cash": return "CASH";
    case "card":
    case "online":
    case "cheque":
    case "upi": return "BANK";
    default: throw new Error(`Invalid payment type: ${paymentType}`);
  }
};


/* =====================================================================
 * 16. PAYMENT CORRECTIONS AND PAYMENT REPORTS
 * ===================================================================== */

// reverse all ledger postings of a customer payment
const reversePaymentEntries = async (connection, paymentId) => {
  const [ledgerRows] = await connection.execute(
    `SELECT VoucherId FROM CustomerLedger WHERE ReferenceType = 'CustomerPayment' AND ReferenceId = ?`,
    [paymentId]
  );

  await connection.execute(
    `DELETE FROM CustomerLedger WHERE ReferenceType = 'CustomerPayment' AND ReferenceId = ?`, [paymentId]);

  for (const row of ledgerRows) {
    if (!row.VoucherId) continue;
    await connection.execute(`DELETE FROM LedgerEntries WHERE VoucherId = ?`, [row.VoucherId]);
    await connection.execute(`UPDATE Vouchers SET IsReversed = 1, ReversedAt = NOW() WHERE Id = ?`, [row.VoucherId]);
  }
};

const deletePayment = async (paymentId, userId) => {
  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [[payment]] = await connection.execute(
      `SELECT p.*, c.CustomerName FROM Payments p JOIN Customers c ON c.Id = p.CustomerId
        WHERE p.Id = ? AND IFNULL(p.IsDeleted, 0) = 0`,
      [paymentId]
    );
    if (!payment) throw new Error(`Payment #${paymentId} not found or already deleted.`);

    await reversePaymentEntries(connection, paymentId);

    await connection.execute(
      `INSERT INTO PaymentCorrectionLog
         (PaymentId, ActionType, OriginalCustomerId, CorrectCustomerId, OriginalAmount, PaymentNo,
          PaymentDate, ActionBy, ActionAt, Notes)
       VALUES (?, 'DELETE', ?, NULL, ?, ?, ?, ?, NOW(), ?)`,
      [paymentId, payment.CustomerId, payment.Credit, payment.PaymentNo, payment.PaymentDate, userId,
       `Deleted by user ${userId}`]
    );

    await connection.execute(
      `UPDATE Payments SET IsDeleted = 1, DeletedBy = ?, DeletedAt = NOW() WHERE Id = ?`, [userId, paymentId]);

    await connection.commit();
    return {
      success: true,
      message: `Payment ${payment.PaymentNo} (₹${Number(payment.Credit).toLocaleString("en-IN")}) deleted from ${payment.CustomerName}.`,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const transferPayment = async ({ paymentId, toCustomerId, userId }) => {
  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [[payment]] = await connection.execute(
      `SELECT p.*, c.CustomerName AS OriginalCustomerName FROM Payments p JOIN Customers c ON c.Id = p.CustomerId
        WHERE p.Id = ? AND IFNULL(p.IsDeleted, 0) = 0`,
      [paymentId]
    );
    if (!payment) throw new Error(`Payment #${paymentId} not found.`);

    const [[targetCustomer]] = await connection.execute(
      `SELECT Id, CustomerName FROM Customers WHERE Id = ?`, [toCustomerId]);
    if (!targetCustomer) throw new Error(`Target customer #${toCustomerId} not found.`);

    const fromCustomerId = payment.CustomerId;
    if (fromCustomerId == toCustomerId) throw new Error(`Payment is already under ${payment.OriginalCustomerName}.`);

    await reversePaymentEntries(connection, paymentId);

    await connection.execute(
      `UPDATE Payments SET CustomerId = ?, TransferredFrom = ?, TransferredBy = ?, TransferredAt = NOW() WHERE Id = ?`,
      [toCustomerId, fromCustomerId, userId, paymentId]
    );

    const financialYear = await getFinancialYear(payment.PaymentDate);
    const normalizedPayType = getAccountTypeFromPaymentType(payment.PaymentType);

    const newVoucherId = await createReceiptEntry({
      connection, customerId: toCustomerId, receiptId: paymentId, receiptNo: payment.PaymentNo,
      receiptDate: payment.PaymentDate, amount: payment.Credit, normalizedPaymentType: normalizedPayType, userId,
    });

    await connection.execute(
      `INSERT INTO CustomerLedger
         (CustomerId, FinancialYear, EntryDate, TransactionType, ReferenceType, ReferenceId,
          DebitAmount, CreditAmount, Description, VoucherId)
       VALUES (?, ?, ?, 'RECEIPT', 'CustomerPayment', ?, 0, ?, ?, ?)`,
      [toCustomerId, financialYear, payment.PaymentDate, paymentId, payment.Credit,
       `Receipt ${payment.PaymentNo} [transferred from ${payment.OriginalCustomerName}]`, newVoucherId]
    );

    await connection.execute(
      `INSERT INTO PaymentCorrectionLog
         (PaymentId, ActionType, OriginalCustomerId, CorrectCustomerId, OriginalAmount, PaymentNo,
          PaymentDate, ActionBy, ActionAt, Notes)
       VALUES (?, 'TRANSFER', ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [paymentId, fromCustomerId, toCustomerId, payment.Credit, payment.PaymentNo, payment.PaymentDate,
       userId, `Transferred from ${payment.OriginalCustomerName} to ${targetCustomer.CustomerName}`]
    );

    await connection.commit();
    return {
      success: true,
      message: `Payment ${payment.PaymentNo} transferred from ${payment.OriginalCustomerName} → ${targetCustomer.CustomerName}.`,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Payments of a customer for the correction page.
 * FIX: credit-note rows (PaymentType 'CREDIT_NOTE') are not real receipts and cannot be
 *      transferred (getAccountTypeFromPaymentType throws) - they are excluded.
 */
const getCustomerPayments = async (customerId, fromDate, toDate) => {
  const start = fromDate ? moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD")
                         : moment().subtract(30, "days").format("YYYY-MM-DD");
  const end = toDate ? moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD") : moment().format("YYYY-MM-DD");

  const [rows] = await dbConnection.pool.promise().execute(
    `SELECT p.Id, p.PaymentNo, p.Credit AS Amount, p.PaymentType,
            DATE_FORMAT(p.PaymentDate, '%d-%m-%Y') AS PaymentDate, p.PaymentDate AS PaymentDateRaw,
            c.CustomerName, c.Id AS CustomerId, p.TransferredFrom, p.TransferredAt,
            IFNULL(p.IsDeleted, 0) AS IsDeleted,
            (SELECT COUNT(*) FROM PaymentCorrectionLog pl WHERE pl.PaymentId = p.Id) AS CorrectionCount
       FROM Payments p
       JOIN Customers c ON c.Id = p.CustomerId
      WHERE p.CustomerId = ? AND p.PaymentDate BETWEEN ? AND ?
        AND IFNULL(p.IsDeleted, 0) = 0
        AND IFNULL(p.PaymentType, '') <> 'CREDIT_NOTE'
      ORDER BY p.PaymentDate DESC, p.Id DESC`,
    [customerId, start, end]
  );
  return rows;
};

/**
 * Payments received between two dates.
 * FIX: credit notes (stored in Payments with type CREDIT_NOTE) were counted as cash received.
 */
const getPaymentsReceivable = async (fromDate, toDate, customerId = "", paymentType = "") => {
  const startDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
  const endDate = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");

  let query = `
    SELECT p.Id, p.PaymentNo, p.PaymentNote, DATE_FORMAT(p.PaymentDate, '%d-%m-%Y') AS PaymentDate,
           p.PaymentDate AS PaymentDateRaw, p.Credit AS Amount, p.PaymentType,
           c.Id AS CustomerId, c.CustomerName, c.MobileNo
      FROM Payments p
      JOIN Customers c ON c.Id = p.CustomerId
     WHERE p.PaymentDate BETWEEN ? AND ?
       AND IFNULL(p.IsDeleted, 0) = 0
       AND IFNULL(p.PaymentType, '') <> 'CREDIT_NOTE'`;
  const params = [startDate, endDate];

  if (customerId) { query += ` AND p.CustomerId = ?`; params.push(customerId); }
  if (paymentType) { query += ` AND p.PaymentType = ?`; params.push(paymentType); }
  query += ` ORDER BY p.PaymentDate DESC, p.Id DESC`;

  const [rows] = await dbConnection.execute(query, params);

  const totalAmount = rows.reduce((sum, row) => sum + Number(row.Amount || 0), 0);
  const typeWiseBreakup = {};
  rows.forEach((row) => {
    const type = row.PaymentType || "Unknown";
    typeWiseBreakup[type] = (typeWiseBreakup[type] || 0) + Number(row.Amount || 0);
  });

  return { rows, totalAmount, typeWiseBreakup };
};

const getDistinctPaymentTypes = async () => {
  const [rows] = await dbConnection.execute(
    `SELECT DISTINCT PaymentType FROM Payments
      WHERE PaymentType IS NOT NULL AND PaymentType <> 'CREDIT_NOTE' ORDER BY PaymentType ASC`
  );
  return rows.map((r) => r.PaymentType);
};


/* =====================================================================
 * 17. PROFIT AND LOSS
 * CHANGED: cost = the LOT's own purchase price (Stock.PurchasePrice). It used to be read
 *          from the first invoice of the batch (InvoiceDetails), which was wrong for lots.
 * ===================================================================== */

/** Product-wise gross margin report. */
const getProfitLossReport = async (fromDate, toDate, filters = {}) => {
  const { supplierId = "", productId = "", customerId = "" } = filters;

  const startDate = moment(fromDate, "DD-MM-YYYY").startOf("day").format("YYYY-MM-DD HH:mm:ss");
  const endDate = moment(toDate, "DD-MM-YYYY").endOf("day").format("YYYY-MM-DD HH:mm:ss");

  const query = `
    SELECT p.Id AS ProductId, p.ProductName, sup.Id AS SupplierId, sup.Name AS SupplierName,
           SUM(si.QuantitySold) AS TotalQtySold,
           SUM(IFNULL(si.ReturnedQty, 0)) AS TotalQtyReturned,
           SUM(si.QuantitySold - IFNULL(si.ReturnedQty, 0)) AS NetQtySold,
           AVG(si.SalePrice) AS AvgSalePrice,
           AVG(st.PurchasePrice) AS AvgPurchasePrice,
           SUM((si.QuantitySold - IFNULL(si.ReturnedQty, 0)) * si.SalePrice) AS NetSalesValue,
           SUM((si.QuantitySold - IFNULL(si.ReturnedQty, 0)) * st.PurchasePrice) AS CostOfGoodsSold,
           SUM((si.QuantitySold - IFNULL(si.ReturnedQty, 0)) * si.SalePrice)
             - SUM((si.QuantitySold - IFNULL(si.ReturnedQty, 0)) * st.PurchasePrice) AS GrossProfit,
           COUNT(DISTINCT sh.Id) AS InvoiceCount
      FROM SalesItems si
      JOIN SalesHeader sh ON sh.Id = si.SaleId
      JOIN Stock st ON st.Id = si.StockId
      JOIN Products p ON p.Id = st.ProductId
      JOIN Suppliers sup ON sup.Id = st.SupplierId
     WHERE sh.CreatedAt BETWEEN ? AND ?
       AND (? = '' OR st.SupplierId = ?)
       AND (? = '' OR p.Id = ?)
       AND (? = '' OR sh.CustomerId = ?)
     GROUP BY p.Id, p.ProductName, sup.Id, sup.Name
     ORDER BY GrossProfit DESC`;

  const params = [startDate, endDate, supplierId, supplierId, productId, productId, customerId, customerId];
  const [rows] = await dbConnection.execute(query, params);

  rows.forEach((r) => {
    r.TotalQtySold = Number(r.TotalQtySold);
    r.TotalQtyReturned = Number(r.TotalQtyReturned);
    r.NetQtySold = Number(r.NetQtySold);
    r.AvgSalePrice = Number(r.AvgSalePrice);
    r.AvgPurchasePrice = Number(r.AvgPurchasePrice);
    r.NetSalesValue = Number(r.NetSalesValue);
    r.CostOfGoodsSold = Number(r.CostOfGoodsSold);
    r.GrossProfit = Number(r.GrossProfit);
    r.GrossMarginPercent = r.NetSalesValue > 0
      ? Number(((r.GrossProfit / r.NetSalesValue) * 100).toFixed(2)) : 0;
  });

  const summary = rows.reduce(
    (acc, r) => {
      acc.totalNetSales += r.NetSalesValue;
      acc.totalCOGS += r.CostOfGoodsSold;
      acc.totalGrossProfit += r.GrossProfit;
      acc.totalQtySold += r.NetQtySold;
      return acc;
    },
    { totalNetSales: 0, totalCOGS: 0, totalGrossProfit: 0, totalQtySold: 0 }
  );
  summary.totalGrossMarginPercent = summary.totalNetSales > 0
    ? Number(((summary.totalGrossProfit / summary.totalNetSales) * 100).toFixed(2)) : 0;

  // NEW: expired stock the supplier refused is a loss -> net profit = gross profit - write-off (not tied to a customer)
  const writeOffs = customerId
    ? { rows: [], totals: { qty: 0, taxable: 0, gst: 0, total: 0 } }
    : await getExpiryWriteOffLoss(fromDate, toDate, { supplierId, productId });
  summary.expiryWriteOff = writeOffs.totals.total;
  summary.netProfit = round2(summary.totalGrossProfit - writeOffs.totals.total);
  summary.netMarginPercent = summary.totalNetSales > 0 ? Number(((summary.netProfit / summary.totalNetSales) * 100).toFixed(2)) : 0;

  return { rows, summary, writeOffs };
};

/** Expiry stock that the supplier did not take back (written off when a settlement is finalized) - a LOSS for the business. */
const getExpiryWriteOffLoss = async (fromDate, toDate, filters = {}) => {
  const { supplierId = "", productId = "" } = filters;
  const startDate = moment(fromDate, "DD-MM-YYYY").startOf("day").format("YYYY-MM-DD HH:mm:ss");
  const endDate = moment(toDate, "DD-MM-YYYY").endOf("day").format("YYYY-MM-DD HH:mm:ss");

  const [rows] = await dbConnection.execute(
    `SELECT w.Id, w.CreatedAt, w.ExpiryReturnId, er.ReturnNumber, w.SupplierId, sup.Name AS SupplierName,
            w.ProductId, p.ProductName, es.BatchNumber, w.RejectedQty, w.Rate, w.GSTPercent,
            w.Amount, w.GSTAmount, w.TotalAmount
       FROM SupplierReturnWriteOff w
       JOIN ExpiryReturns er ON er.Id = w.ExpiryReturnId
       JOIN ExpiryReturnItems eri ON eri.Id = w.ExpiryReturnItemId
       JOIN ExpiredStock es ON es.Id = eri.ExpiredStockId
       LEFT JOIN Products p ON p.Id = w.ProductId
       LEFT JOIN Suppliers sup ON sup.Id = w.SupplierId
      WHERE w.CreatedAt BETWEEN ? AND ?
        AND (? = '' OR w.SupplierId = ?)
        AND (? = '' OR w.ProductId = ?)
      ORDER BY w.CreatedAt DESC, w.Id DESC`,
    [startDate, endDate, supplierId, supplierId, productId, productId]
  );

  const totals = { qty: 0, taxable: 0, gst: 0, total: 0 };
  rows.forEach((r) => {
    ["RejectedQty", "Rate", "GSTPercent", "Amount", "GSTAmount", "TotalAmount"].forEach((k) => (r[k] = Number(r[k] || 0)));
    totals.qty += r.RejectedQty; totals.taxable += r.Amount; totals.gst += r.GSTAmount; totals.total += r.TotalAmount;
  });
  Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));
  return { rows, totals };
};

/** Invoice-wise profit and loss (each line: sale price vs the lot's cost). */
const getInvoiceWiseProfitLoss = async (fromDate, toDate, filters = {}) => {
  const { customerId = "", supplierId = "", invoiceId = "" } = filters;

  const startDate = moment(fromDate, "DD-MM-YYYY").startOf("day").format("YYYY-MM-DD HH:mm:ss");
  const endDate = moment(toDate, "DD-MM-YYYY").endOf("day").format("YYYY-MM-DD HH:mm:ss");

  const query = `
    SELECT sh.Id AS SaleId, sh.InvoiceId, DATE_FORMAT(sh.CreatedAt, '%d-%m-%Y') AS InvoiceDate,
           sh.CreatedAt AS InvoiceDateRaw, c.Id AS CustomerId, c.CustomerName,
           si.Id AS SalesItemId, p.Id AS ProductId, p.ProductName,
           sup.Id AS SupplierId, sup.Name AS SupplierName, st.Id AS StockId, st.BatchNumber,
           si.QuantitySold, IFNULL(si.ReturnedQty, 0) AS ReturnedQty,
           (si.QuantitySold - IFNULL(si.ReturnedQty, 0)) AS NetQty,
           si.SalePrice, st.PurchasePrice AS PurchasePrice,
           si.Sgst, si.Cgst, si.TotalValue, si.TotalValueWithTax
      FROM SalesHeader sh
      JOIN SalesItems si ON si.SaleId = sh.Id
      JOIN Customers c ON c.Id = sh.CustomerId
      JOIN Stock st ON st.Id = si.StockId
      JOIN Products p ON p.Id = st.ProductId
      JOIN Suppliers sup ON sup.Id = st.SupplierId
     WHERE sh.CreatedAt BETWEEN ? AND ?
       AND (? = '' OR sh.CustomerId = ?)
       AND (? = '' OR st.SupplierId = ?)
       AND (? = '' OR sh.InvoiceId LIKE ?)
     ORDER BY sh.CreatedAt DESC, sh.Id ASC, si.Id ASC`;

  const params = [startDate, endDate, customerId, customerId, supplierId, supplierId, invoiceId, `%${invoiceId}%`];
  const [rows] = await dbConnection.execute(query, params);

  const invoiceMap = {};
  rows.forEach((row) => {
    const netQty = Number(row.NetQty);
    const salePrice = Number(row.SalePrice);
    const purchasePrice = Number(row.PurchasePrice);

    const lineSaleValue = Number((netQty * salePrice).toFixed(2));
    const lineCost = Number((netQty * purchasePrice).toFixed(2));
    const lineProfit = Number((lineSaleValue - lineCost).toFixed(2));
    const lineMarginPercent = lineSaleValue > 0 ? Number(((lineProfit / lineSaleValue) * 100).toFixed(2)) : 0;

    if (!invoiceMap[row.SaleId]) {
      invoiceMap[row.SaleId] = {
        SaleId: row.SaleId, InvoiceId: row.InvoiceId, InvoiceDate: row.InvoiceDate,
        CustomerId: row.CustomerId, CustomerName: row.CustomerName, items: [],
        InvoiceSaleValue: 0, InvoiceCost: 0, InvoiceProfit: 0,
      };
    }
    const invoice = invoiceMap[row.SaleId];

    invoice.items.push({
      ProductId: row.ProductId, ProductName: row.ProductName, SupplierName: row.SupplierName,
      BatchNumber: row.BatchNumber, QuantitySold: Number(row.QuantitySold), ReturnedQty: Number(row.ReturnedQty),
      NetQty: netQty, SalePrice: salePrice, PurchasePrice: purchasePrice, LineSaleValue: lineSaleValue,
      LineCost: lineCost, LineProfit: lineProfit, LineMarginPercent: lineMarginPercent,
    });

    invoice.InvoiceSaleValue = Number((invoice.InvoiceSaleValue + lineSaleValue).toFixed(2));
    invoice.InvoiceCost = Number((invoice.InvoiceCost + lineCost).toFixed(2));
    invoice.InvoiceProfit = Number((invoice.InvoiceProfit + lineProfit).toFixed(2));
  });

  const invoices = Object.values(invoiceMap).map((inv) => {
    inv.InvoiceMarginPercent = inv.InvoiceSaleValue > 0
      ? Number(((inv.InvoiceProfit / inv.InvoiceSaleValue) * 100).toFixed(2)) : 0;
    return inv;
  });

  const summary = invoices.reduce(
    (acc, inv) => {
      acc.totalSales += inv.InvoiceSaleValue;
      acc.totalCost += inv.InvoiceCost;
      acc.totalProfit += inv.InvoiceProfit;
      acc.totalInvoices += 1;
      return acc;
    },
    { totalSales: 0, totalCost: 0, totalProfit: 0, totalInvoices: 0 }
  );
  summary.totalMarginPercent = summary.totalSales > 0
    ? Number(((summary.totalProfit / summary.totalSales) * 100).toFixed(2)) : 0;

  return { invoices, summary };
};


/* =====================================================================
 * 18. PRODUCT / BATCH TRACE  (NEW)
 *
 * "For this product (and optionally this batch): when did I buy it, at what price,
 *  from which supplier invoice - and to whom did I sell it, at what price, with what
 *  price difference."
 *
 * Needs the stock-lot columns from 01_migration.sql (Stock.PurchasePrice / MRP / IgstPercentage).
 * Prices on both sides are BEFORE GST (purchase price on the supplier invoice, sale price on
 * your invoice), so the difference is your gross margin per unit.
 * ===================================================================== */

/** Batches of one product (used for the batch suggestions on the trace page). */
const getProductBatches = async (productId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT BatchNumber, MAX(ExpiryDate) AS ExpiryDate, SUM(Quantity) AS Quantity
       FROM Stock
      WHERE ProductId = ?
      GROUP BY BatchNumber
      ORDER BY MAX(ExpiryDate) DESC, BatchNumber`,
    [productId]
  );
  return rows;
};

/**
 * Purchase + sales history of a product, optionally of one batch (partial batch text is fine).
 *
 * Returns
 *   product          the product (+ supplier)
 *   lots[]           one row per stock lot (batch + purchase price): bought on / invoice /
 *                    purchase price / MRP / qty bought / sold / returned / in stock
 *   sales[]          one row per sale line: date, invoice, customer, qty, sale price, purchase
 *                    price of that lot, price difference per unit, % and net margin
 *   pendingChallans[] stock delivered on a challan that is not billed yet
 *   summary          totals for the cards at the top
 *
 * "Bought qty" is read from the stock ledger: purchase receipts (ADD / FREE_ADD) but NOT the
 * 'ADD' rows that only put stock back (sale edits, cancelled challans, old-style customer returns).
 */
const getProductTrace = async ({ productId, supplierId = null, batch = "" }) => {
  const pid = Number(productId);
  if (!pid) throw new Error("Select a product.");

  const db = dbConnection.connection.promise();

  const [[product]] = await db.query(
    `SELECT p.Id, p.ProductName, p.KnownAs, p.Hsn, p.SupplierId, sup.Name AS SupplierName
       FROM Products p
       JOIN Suppliers sup ON sup.Id = p.SupplierId
      WHERE p.Id = ?`,
    [pid]
  );
  if (!product) throw new Error("Product not found.");
  if (supplierId && Number(supplierId) !== Number(product.SupplierId))
    throw new Error("This product does not belong to the selected supplier.");

  // optional batch filter: "contains", with LIKE wildcards in the text made harmless
  const batchText = String(batch || "").trim();
  const batchLike = `%${batchText.replace(/[\\%_]/g, "\\$&")}%`;
  const batchSql = batchText ? ` AND s.BatchNumber LIKE ?` : "";
  const params = batchText ? [pid, batchLike] : [pid];

  /* ---------- purchases: one row per lot ---------- */
  const [lots] = await db.query(
    `SELECT s.Id AS StockId, s.BatchNumber, s.MfgDate, s.ExpiryDate, s.Quantity AS CurrentStock,
            s.PurchasePrice, s.MRP, s.IgstPercentage,
            sup.Name AS SupplierName,
            inv.SupplierInvoiceNo, inv.InvoiceDate, po.PurchaseInvoiceNo AS PoNumber,
            IFNULL(rc.ReceivedQty, 0)  AS ReceivedQty,
            rc.FirstReceived, rc.LastReceived,
            IFNULL(sl.SoldQty, 0)      AS SoldQty,
            IFNULL(sl.ReturnedQty, 0)  AS ReturnedQty
       FROM Stock s
       LEFT JOIN Suppliers sup      ON sup.Id = s.SupplierId
       LEFT JOIN Invoices inv       ON inv.Id = s.InvoiceId
       LEFT JOIN PurchaseOrders po  ON po.Id  = inv.PurchaseOrderId
       LEFT JOIN (
         SELECT t.StockId, SUM(t.Quantity) AS ReceivedQty,
                MIN(DATE(t.Timestamp)) AS FirstReceived, MAX(DATE(t.Timestamp)) AS LastReceived
           FROM StockTransactions t
          WHERE t.Effect = 'IN'
            AND (t.TransactionType = 'FREE_ADD'
                 OR (t.TransactionType = 'ADD'
                     AND IFNULL(t.Remarks, '') NOT LIKE '%restored%'
                     AND IFNULL(t.Remarks, '') NOT LIKE 'Cancelled Challan%'
                     AND IFNULL(t.Remarks, '') NOT LIKE 'Sale updated%'
                     AND IFNULL(t.Remarks, '') NOT LIKE '%return from customer%'))
          GROUP BY t.StockId
       ) rc ON rc.StockId = s.Id
       LEFT JOIN (
         SELECT si.StockId, SUM(si.QuantitySold) AS SoldQty, SUM(IFNULL(si.ReturnedQty, 0)) AS ReturnedQty
           FROM SalesItems si
          GROUP BY si.StockId
       ) sl ON sl.StockId = s.Id
      WHERE s.ProductId = ?${batchSql}
      ORDER BY s.ExpiryDate, s.BatchNumber, s.Id`,
    params
  );

  /* ---------- sales: one row per sale line ---------- */
  const [sales] = await db.query(
    `SELECT sh.Id AS SaleId, sh.InvoiceId, COALESCE(sh.SaleDate, DATE(sh.CreatedAt)) AS SaleDate,
            c.Id AS CustomerId, c.CustomerName,
            s.Id AS StockId, s.BatchNumber,
            si.Id AS SalesItemId, si.QuantitySold, IFNULL(si.ReturnedQty, 0) AS ReturnedQty,
            (si.QuantitySold - IFNULL(si.ReturnedQty, 0)) AS NetQty,
            si.SalePrice, s.PurchasePrice,
            (si.SalePrice - s.PurchasePrice) AS DiffPerUnit,
            ROUND((si.SalePrice - s.PurchasePrice) / NULLIF(s.PurchasePrice, 0) * 100, 2) AS MarginPercent,
            ROUND((si.QuantitySold - IFNULL(si.ReturnedQty, 0)) * (si.SalePrice - s.PurchasePrice), 2) AS NetMargin,
            sh.ChallanId
       FROM SalesItems si
       JOIN SalesHeader sh ON sh.Id = si.SaleId
       JOIN Customers c    ON c.Id  = sh.CustomerId
       JOIN Stock s        ON s.Id  = si.StockId
      WHERE s.ProductId = ?${batchSql}
      ORDER BY COALESCE(sh.SaleDate, DATE(sh.CreatedAt)) DESC, sh.Id DESC, si.Id`,
    params
  );

  /* ---------- delivered on challan but not billed yet ---------- */
  const [pendingChallans] = await db.query(
    `SELECT ch.ChallanId, ch.ChallanDate, ch.Status, cust.CustomerName, s.BatchNumber,
            ci.QuantitySold, s.PurchasePrice
       FROM ChallanItems ci
       JOIN Challan ch     ON ch.ChallanId = ci.ChallanId
       JOIN Customers cust ON cust.Id = ch.CustomerId
       JOIN Stock s        ON s.Id = ci.StockId
      WHERE s.ProductId = ?${batchSql}
        AND ch.Status <> 'Cancelled'
        AND NOT EXISTS (SELECT 1 FROM SalesHeader sh2 WHERE sh2.ChallanId = ch.ChallanId)
      ORDER BY ch.ChallanDate DESC, ch.ChallanId DESC`,
    params
  );

  /* ---------- totals for the cards ---------- */
  const n = (v) => Number(v) || 0;
  const boughtQty = lots.reduce((sum, l) => sum + n(l.ReceivedQty), 0);
  const boughtValue = lots.reduce((sum, l) => sum + n(l.ReceivedQty) * n(l.PurchasePrice), 0);
  const soldQty = sales.reduce((sum, r) => sum + n(r.QuantitySold), 0);
  const returnedQty = sales.reduce((sum, r) => sum + n(r.ReturnedQty), 0);
  const netQty = soldQty - returnedQty;
  const salesValue = sales.reduce((sum, r) => sum + n(r.NetQty) * n(r.SalePrice), 0);
  const costOfSold = sales.reduce((sum, r) => sum + n(r.NetQty) * n(r.PurchasePrice), 0);

  const summary = {
    lotCount: lots.length,
    saleLines: sales.length,
    boughtQty,
    soldQty,
    returnedQty,
    netSoldQty: netQty,
    inStockQty: lots.reduce((sum, l) => sum + n(l.CurrentStock), 0),
    onChallanQty: pendingChallans.reduce((sum, r) => sum + n(r.QuantitySold), 0),
    avgPurchasePrice: boughtQty > 0 ? round2(boughtValue / boughtQty) : null,
    avgSalePrice: netQty > 0 ? round2(salesValue / netQty) : null,
    salesValue: round2(salesValue),
    costOfSold: round2(costOfSold),
    margin: round2(salesValue - costOfSold),
    marginPercent: costOfSold > 0 ? round2(((salesValue - costOfSold) / costOfSold) * 100) : null,
  };

  return { product, batch: batchText, lots, sales, pendingChallans, summary };
};


/* =====================================================================
 * EXPORTS  (unchanged names - the controller does not need to change imports)
 * ===================================================================== */
/* ---------------------------------------------------------------------
 * CANCEL A SETTLEMENT  /  ADD EXPIRED PRODUCT TO A SETTLEMENT  (NEW)
 *
 * Cancel: the whole expiry return (and its debit note) is voided while the supplier has not approved anything.
 *   - ExpiryReturns.Status and SupplierDebitNotes.Status = 'CANCELLED' (nothing is deleted; a history line is kept)
 *   - the supplier ledger gets a reversing CREDIT row (DEBIT_NOTE_CANCEL), so the supplier balance goes back
 *   - the expired quantity is free again: every "already sent" total ignores cancelled returns, so the
 *     products show up again on the "send to supplier" page
 *   - refused when the return is finalized, or any quantity is already accepted / rejected / credited
 * Add: more expired batches are put on an open return: new return lines + debit note lines, the debit note total,
 *   the ledger row and the later running balances follow. Allowed until the return is finalized or cancelled.
 * ------------------------------------------------------------------- */
const NOT_CANCELLED_SQL = `IFNULL(er.Status, '') <> 'CANCELLED'`;

/** What can be done with this return, and the expired batches that can still be added to it. */
const getReturnActions = async (expiryReturnId) => {
  const db = dbConnection.pool.promise();
  const [[ret]] = await db.query(
    `SELECT Id, SupplierId, Status, IFNULL(IsLocked, 0) AS IsLocked FROM ExpiryReturns WHERE Id = ?`, [expiryReturnId]);
  if (!ret) return null;

  const out = {
    status: ret.Status, isCancelled: ret.Status === "CANCELLED", isLocked: !!Number(ret.IsLocked),
    canAdd: false, canCancel: false, cancelBlockedReason: "", addBlockedReason: "", items: [],
  };
  if (out.isCancelled) { out.cancelBlockedReason = out.addBlockedReason = "This settlement is cancelled."; return out; }
  if (out.isLocked)    { out.cancelBlockedReason = out.addBlockedReason = "This settlement is finalized."; return out; }
  if (ret.Status === "SETTLED") { out.isSettled = true; out.cancelBlockedReason = out.addBlockedReason = "This settlement is already settled."; return out; }

  const [[ap]] = await db.query(
    `SELECT COUNT(*) AS n FROM ExpiryReturnItems
      WHERE ExpiryReturnId = ? AND (IFNULL(AcceptedQuantity, 0) > 0 OR IFNULL(RejectedQuantity, 0) > 0 OR IFNULL(SettledAmount, 0) > 0)`,
    [expiryReturnId]);
  const [[cn]] = await db.query(`SELECT COUNT(*) AS n FROM SupplierCreditNotes WHERE ExpiryReturnId = ?`, [expiryReturnId]);
  if (Number(ap.n) > 0 || Number(cn.n) > 0) {
    out.cancelBlockedReason = "The supplier's approval is already recorded (credit note / accepted quantity), so the settlement cannot be cancelled. Use Finalize & Close to write off what was not approved.";
  } else out.canCancel = true;

  out.canAdd = true;
  const [items] = await db.query(
    `SELECT es.Id, p.ProductName, es.BatchNumber, DATE_FORMAT(es.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
            es.ExpiredQty, es.PurchasePrice, es.GSTPercent,
            (es.ExpiredQty - IFNULL(sent.q, 0)) AS RemainingQty
       FROM ExpiredStock es
       JOIN Products p ON p.Id = es.ProductId
       LEFT JOIN (SELECT eri.ExpiredStockId, SUM(eri.Quantity) AS q
                    FROM ExpiryReturnItems eri
                    JOIN ExpiryReturns er ON er.Id = eri.ExpiryReturnId
                   WHERE ${NOT_CANCELLED_SQL}
                   GROUP BY eri.ExpiredStockId) sent ON sent.ExpiredStockId = es.Id
      WHERE es.SupplierId = ? AND (es.ExpiredAmount - IFNULL(es.SettledAmount, 0)) > 0
        AND (es.ExpiredQty - IFNULL(sent.q, 0)) > 0
      ORDER BY es.ExpiryDate ASC, p.ProductName`,
    [ret.SupplierId]);
  out.items = items;
  return out;
};

const cancelExpiryReturn = async ({ expiryReturnId, reason, userId, submitToken = null }) => {
  const why = String(reason || "").trim();
  if (why.length < 3) throw new Error("Please give a short reason for cancelling (it is saved with the debit note).");

  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [[ret]] = await connection.query(
      `SELECT Id, SupplierId, ReturnNumber, Status, IFNULL(IsLocked, 0) AS IsLocked FROM ExpiryReturns WHERE Id = ? FOR UPDATE`,
      [expiryReturnId]);
    if (!ret) throw new Error("Expiry return not found.");
    await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [ret.SupplierId]);
    if (!(await claimSubmission(connection, submitToken, "CANCEL_RETURN", ret.Id, userId))) {
      await connection.rollback();
      return alreadyDone("This settlement was already cancelled (the form was sent twice).");
    }
    if (ret.Status === "CANCELLED") throw new Error("This settlement is already cancelled.");
    if (ret.Status === "SETTLED") throw new Error("This settlement is already settled, so it cannot be cancelled.");
    if (Number(ret.IsLocked)) throw new Error("This settlement is finalized and cannot be cancelled.");

    const [[ap]] = await connection.query(
      `SELECT COUNT(*) AS n FROM ExpiryReturnItems
        WHERE ExpiryReturnId = ? AND (IFNULL(AcceptedQuantity, 0) > 0 OR IFNULL(RejectedQuantity, 0) > 0 OR IFNULL(SettledAmount, 0) > 0)`,
      [expiryReturnId]);
    const [[cn]] = await connection.query(`SELECT COUNT(*) AS n FROM SupplierCreditNotes WHERE ExpiryReturnId = ?`, [expiryReturnId]);
    if (Number(ap.n) > 0 || Number(cn.n) > 0)
      throw new Error("The supplier's approval is already recorded for this settlement, so it cannot be cancelled.");

    const [[dn]] = await connection.query(
      `SELECT Id, DebitNoteNumber, TotalAmount FROM SupplierDebitNotes WHERE ExpiryReturnId = ? FOR UPDATE`, [expiryReturnId]);

    const stamp = moment().format("DD-MM-YYYY HH:mm");
    const audit = `[${stamp}] Settlement cancelled by user ${userId}. Reason: ${why}`;

    await connection.query(
      `UPDATE ExpiryReturns SET Status = 'CANCELLED', UpdatedAt = NOW(), Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?) WHERE Id = ?`,
      [audit, expiryReturnId]);

    let reversed = 0;
    if (dn) {
      await connection.query(
        `UPDATE SupplierDebitNotes SET Status = 'CANCELLED', UpdatedAt = NOW(), Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?) WHERE Id = ?`,
        [audit, dn.Id]);

      // reverse exactly what the ledger holds for this return
      const [[led]] = await connection.query(
        `SELECT IFNULL(SUM(DebitAmount - CreditAmount), 0) AS amt FROM SupplierSettlementLedger
          WHERE SupplierId = ? AND ExpiryReturnId = ?`, [ret.SupplierId, expiryReturnId]);
      reversed = round2(led.amt);
      if (reversed !== 0) {
        const balance = Number(await getSupplierBalance(connection, ret.SupplierId)) || 0;
        await connection.query(
          `INSERT INTO SupplierSettlementLedger
             (SupplierId, ExpiryReturnId, ReferenceType, ReferenceId, ReferenceNumber, DebitAmount, CreditAmount, BalanceAfter, Remarks, CreatedBy)
           VALUES (?, ?, 'DEBIT_NOTE_CANCEL', ?, ?, 0, ?, ?, ?, ?)`,
          [ret.SupplierId, expiryReturnId, dn.Id, dn.DebitNoteNumber, reversed, round2(balance - reversed), `Cancelled: ${why}`, userId]);
      }
    }

    await connection.commit();
    return {
      reversed,
      message: `Settlement ${ret.ReturnNumber}${dn ? ` (debit note ${dn.DebitNoteNumber})` : ""} is cancelled.` +
               (reversed ? ` Rs ${reversed.toFixed(2)} was taken off the supplier's balance.` : "") +
               " The products are back on the \"send to supplier\" list.",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/** items: [{ expiredStockId, quantity, gstPercent? }] - gstPercent blank = the batch's own GST %. */
const addExpiredToReturn = async ({ expiryReturnId, items, userId, submitToken = null }) => {
  const wanted = toArray(items).map((i) => ({
    expiredStockId: Number(i.expiredStockId), quantity: Number(i.quantity),
    gst: i.gstPercent === undefined || i.gstPercent === null || String(i.gstPercent).trim() === "" ? null : Number(i.gstPercent),
  }));
  if (!wanted.length) throw new Error("Select at least one expired product to add.");
  wanted.forEach((w) => {
    if (!Number.isInteger(w.expiredStockId) || w.expiredStockId <= 0) throw new Error("Invalid expired product.");
    if (!(Number.isFinite(w.quantity) && w.quantity > 0)) throw new Error("Quantity must be greater than 0.");
    if (w.gst !== null && !(Number.isFinite(w.gst) && w.gst >= 0 && w.gst <= 100)) throw new Error("GST % must be a number between 0 and 100.");
  });
  if (new Set(wanted.map((w) => w.expiredStockId)).size !== wanted.length) throw new Error("The same batch was selected twice.");

  const connection = await dbConnection.pool.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [[ret]] = await connection.query(
      `SELECT Id, SupplierId, ReturnNumber, Status, IFNULL(IsLocked, 0) AS IsLocked FROM ExpiryReturns WHERE Id = ? FOR UPDATE`,
      [expiryReturnId]);
    if (!ret) throw new Error("Expiry return not found.");
    // FIX: double click / refresh added the same products twice (when stock was left)
    await connection.query(`SELECT Id FROM Suppliers WHERE Id = ? FOR UPDATE`, [ret.SupplierId]);
    if (!(await claimSubmission(connection, submitToken, "ADD_EXPIRED", ret.Id, userId))) {
      await connection.rollback();
      return alreadyDone("These products were already added (the form was sent twice) - nothing was added again.");
    }
    if (ret.Status === "CANCELLED") throw new Error("This settlement is cancelled.");
    if (ret.Status === "SETTLED") throw new Error("This settlement is already settled, so nothing can be added.");
    if (Number(ret.IsLocked)) throw new Error("This settlement is finalized, so nothing can be added.");

    const [[dn]] = await connection.query(
      `SELECT Id, DebitNoteNumber, TotalAmount FROM SupplierDebitNotes WHERE ExpiryReturnId = ? FOR UPDATE`, [expiryReturnId]);
    if (!dn) throw new Error("This return has no debit note.");

    const ids = wanted.map((w) => w.expiredStockId);
    const [stocks] = await connection.query(
      `SELECT Id, SupplierId, ProductId, ExpiredQty, PurchasePrice, GSTPercent
         FROM ExpiredStock WHERE Id IN (?) FOR UPDATE`, [ids]);
    const stockMap = new Map(stocks.map((s) => [Number(s.Id), s]));

    const [sentRows] = await connection.query(
      `SELECT eri.ExpiredStockId, SUM(eri.Quantity) AS q FROM ExpiryReturnItems eri
         JOIN ExpiryReturns er ON er.Id = eri.ExpiryReturnId
        WHERE eri.ExpiredStockId IN (?) AND IFNULL(er.Status, '') <> 'CANCELLED' GROUP BY eri.ExpiredStockId`, [ids]);
    const sentMap = new Map(sentRows.map((r) => [Number(r.ExpiredStockId), Number(r.q)]));

    const lines = [];
    for (const w of wanted) {
      const st = stockMap.get(w.expiredStockId);
      if (!st) throw new Error("Invalid expired product selected.");
      if (Number(st.SupplierId) !== Number(ret.SupplierId)) throw new Error("That product belongs to a different supplier than this settlement.");

      const remaining = Number(st.ExpiredQty) - (sentMap.get(w.expiredStockId) || 0);
      if (w.quantity > remaining) throw new Error(`Quantity exceeds the expired quantity still available (${remaining}).`);

      const rate = Number(st.PurchasePrice || 0);
      const snapshotGst = Number(st.GSTPercent || 0);
      const gstPercent = w.gst === null ? snapshotGst : w.gst;
      const taxable = round2(w.quantity * rate);
      const gstAmount = round2((taxable * gstPercent) / 100);
      const total = round2(taxable + gstAmount);

      const [itemResult] = await connection.query(
        `INSERT INTO ExpiryReturnItems (ExpiryReturnId, ExpiredStockId, Quantity, CreatedAt) VALUES (?, ?, ?, NOW())`,
        [expiryReturnId, w.expiredStockId, w.quantity]);
      await connection.query(
        `INSERT INTO SupplierDebitNoteItems
           (SupplierDebitNoteId, ExpiryReturnItemId, ProductId, Quantity, Rate, GSTPercent, Amount, GSTAmount, TotalAmount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dn.Id, itemResult.insertId, st.ProductId, w.quantity, rate, gstPercent, taxable, gstAmount, total]);

      // same rule as when sending: a GST % typed now is remembered by the batch for its not-yet-sent quantity
      if (round2(gstPercent) !== round2(snapshotGst)) {
        const unsentTaxable = round2(remaining * rate);
        const d = round2(round2((unsentTaxable * gstPercent) / 100) - round2((unsentTaxable * snapshotGst) / 100));
        await connection.query(
          `UPDATE ExpiredStock SET GSTPercent = ?, ExpiredAmount = ExpiredAmount + ?, RemainingAmount = RemainingAmount + ? WHERE Id = ?`,
          [gstPercent, d, d, w.expiredStockId]);
      }
      sentMap.set(w.expiredStockId, (sentMap.get(w.expiredStockId) || 0) + w.quantity);
      lines.push(`${w.quantity} x expired batch #${w.expiredStockId} @ ${gstPercent}% = ${total.toFixed(2)}`);
    }

    const stamp = moment().format("DD-MM-YYYY HH:mm");
    const audit = `[${stamp}] ${wanted.length} product${wanted.length > 1 ? "s" : ""} added by user ${userId}: ${lines.join("; ")}`;

    // header totals = sum of the lines
    const [[sums]] = await connection.query(
      `SELECT COUNT(*) AS n, IFNULL(SUM(Amount), 0) AS amt, IFNULL(SUM(GSTAmount), 0) AS gst, IFNULL(SUM(TotalAmount), 0) AS total
         FROM SupplierDebitNoteItems WHERE SupplierDebitNoteId = ?`, [dn.Id]);
    const oldTotal = round2(dn.TotalAmount);
    const newTotal = round2(sums.total);
    await connection.query(
      `UPDATE SupplierDebitNotes
          SET TotalItems = ?, Amount = ?, GSTAmount = ?, TotalAmount = ?, UpdatedAt = NOW(),
              Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?)
        WHERE Id = ?`,
      [sums.n, round2(sums.amt), round2(sums.gst), newTotal, audit, dn.Id]);

    // header status: the new lines are pending
    const [[cnt]] = await connection.query(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN Status = 'SETTLED' THEN 1 ELSE 0 END) AS settled,
              SUM(CASE WHEN IFNULL(AcceptedQuantity, 0) > 0 THEN 1 ELSE 0 END) AS touched
         FROM ExpiryReturnItems WHERE ExpiryReturnId = ?`, [expiryReturnId]);
    const headerStatus = Number(cnt.settled) === Number(cnt.total) ? "SETTLED"
      : (Number(cnt.touched) > 0 || Number(cnt.settled) > 0 ? "PARTIAL_SETTLED" : "SENT");
    await connection.query(
      `UPDATE ExpiryReturns SET TotalItems = ?, Status = ?, UpdatedAt = NOW(), Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?) WHERE Id = ?`,
      [cnt.total, headerStatus, audit, expiryReturnId]);

    // supplier ledger: the DEBIT_NOTE row and every later running balance
    const diff = round2(newTotal - oldTotal);
    if (diff !== 0) {
      const [[row]] = await connection.query(
        `SELECT Id FROM SupplierSettlementLedger
          WHERE SupplierId = ? AND ReferenceType = 'DEBIT_NOTE' AND ReferenceId = ? ORDER BY Id LIMIT 1 FOR UPDATE`,
        [ret.SupplierId, dn.Id]);
      if (row) {
        await connection.query(
          `UPDATE SupplierSettlementLedger SET DebitAmount = ?, Remarks = CONCAT(IFNULL(CONCAT(Remarks, CHAR(10)), ''), ?) WHERE Id = ?`,
          [newTotal, `Products added on ${stamp}: ${oldTotal.toFixed(2)} -> ${newTotal.toFixed(2)}`, row.Id]);
        await connection.query(
          `UPDATE SupplierSettlementLedger SET BalanceAfter = BalanceAfter + ? WHERE SupplierId = ? AND Id >= ?`,
          [diff, ret.SupplierId, row.Id]);
      }
    }

    await connection.commit();
    return {
      added: wanted.length, oldTotal, newTotal, diff,
      message: `${wanted.length} product${wanted.length > 1 ? "s were" : " was"} added to ${dn.DebitNoteNumber}. ` +
               `Debit note total ${oldTotal.toFixed(2)} -> ${newTotal.toFixed(2)} (+${diff.toFixed(2)}).`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  settlementVersion,
  getCreditNotesForReturns,
  getSupplierRecentInvoiceNos,
  createSupplier,
  getSuppliersList,
  createProduct,
  getProductList,
  createCustomer,
  getCustomerList,
  getStockList,
  createSale,
  getSalesData,
  addPayment,
  getStockTransactions,
  getCustomerLedger,
  getPrintSaleData,
  getCustomerDetails,
  getPrintTotalSaleData,
  createPurchasePo,
  getSupplierDetails,
  getTotalPurchasePoDetails,
  getTotalPurchasePoAmount,
  getPurchasePoList,
  getInvoiceDetails,
  getSearchedSalesData,
  getSalesReport,
  generateInvoice,
  getCustomersLedger,
  getProductPrice,
  getSuppliersProductWithCustomerPricing,
  setProductPricingForCustomer,
  getInvoiceDetailsThroughSupplierInvoiceNo,
  getStocks,
  getStockDetails,
  getProductDetails,
  updateSales,
  getSalesReportSupplierWise,
  updateCustomerDetails,
  getPurchasePoListForReceivingTheOrder,
  getSupplierLedger,
  addPaymentToSupplier,
  getChallanDetails,
  createChallan,
  getAllChallans,
  cancelTheChallan,
  deliverTheProduct,
  convertToSale,
  isChallanAlreadyConvertedToSale,
  getCustomerListWithDues,
  getProductFromStockId,
  getNonMovableSummary,
  getNonMovableStocks,
  getProductPriceHistory,
  getExpiredProductDetails,
  moveExpiredProduct,
  getListOfMovedExpiredProduct,
  searchSupplierInvoice,
  getInvoiceProducts,
  getLastThreePricesBulk,
  settleExpiredStock,
  getInvoiceCredit,
  getLedgerStock,
  getProductNameFromStockId,
  viewSalesReturn,
  getIndividualCustomerSalesRtCN,
  processSalesReturn,
  expiredProductPageForMoveToSupplier,
  getMovedExpiredProductToSupplier,
  sendExpiredToSupplier,
  getSupplierDebitNoteRegister,
  getSupplierDebitNoteRegisterInHtml,
  getMovedSupplierProductFromReturnNumber,
  settleSupplierReturn,
  supplierExpSettlementLedger,
  getSupplierSettlementView,
  finalizeExpiryReturn,
  deletePayment,
  transferPayment,
  getCustomerPayments,
  getPaymentsReceivable,
  getDistinctPaymentTypes,
  getProfitLossReport,
  getExpiryWriteOffLoss,
  getInvoiceWiseProfitLoss,
  getProductTrace,
  getProductBatches,
  getAddableStockForSale,
  getCustomerPricesForStock,
  getDebitNoteForGstRevision,
  reviseExpiryReturnGst,
  getReturnActions,
  cancelExpiryReturn,
  addExpiredToReturn,
};