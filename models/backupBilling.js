/**
 *
 * @param {*} req
 * @returns string
 * This code is to create supplier whos supplies the products to sell
 * PASS
 */
const createSupplier = async (req) => {
  try {
    const {
      Name,
      Address,
      MobileNumber,
      GstIn,
      DlNo,
      CIN,
      City,
      State,
      Pincode,
      StdCode,
      LandlineNo,
    } = req.body;
    const sql = `INSERT INTO Suppliers (Name, Address,City,State,PinCode,StdCode,LandlineNumber, ContactNo, GstIn, DlNo, Cin) VALUES (?, ?, ?, ?, ?, ?,?,?,?,?,?)`;
    const [result] = await dbConnection.execute(sql, [
      Name,
      Address,
      City,
      State,
      Pincode,
      StdCode,
      LandlineNo,
      MobileNumber,
      GstIn,
      DlNo,
      CIN,
    ]);
    const supplierId = result.insertId;
    await dbConnection.execute(
      `
          INSERT INTO Accounts (AccountName, AccountType, SupplierId,CustomerId)
          VALUES (?, 'SUPPLIER', ?)
        `,
      [`${Name}`, supplierId, ""]
    );
    return "Supplier created successfully.";
  } catch (error) {
    throw error;
    //console.log(error)
  }
};

/**
 *
 * @returns object
 * This give all the supplier list.
 * PASS
 */
const getSuppliersList = async () => {
  try {
    const query = `SELECT *,Lower(Name) As Name  FROM Suppliers`;
    const [rows] = await dbConnection.execute(query);
    return rows;
  } catch (error) {
    throw error;
    // console.log(error)
  }
};

/**
 *
 * @param {*} supplierId
 * @returns object
 * This gives detail about a paricular supplier
 * PASS
 */
const getSupplierDetails = async (supplierId) => {
  try {
    const query = `SELECT * FROM Suppliers where Id =?`;
    const [rows] = await dbConnection.execute(query, [supplierId]);
    // console.log(rows)
    return rows;
  } catch (error) {
    throw error;
    // console.log(error)
  }
};
/**
 *
 * @param {*} req
 * @returns string
 * Thisis used to create the product which is supplied by the supplier
 * PASS
 */
const createProduct = async (req) => {
  try {
    const { supplier, name, knownAs, hsn } = req.body;

    // Check if product already exists
    const checkQuery =
      "SELECT 1 FROM Products WHERE SupplierId=? AND LOWER(ProductName) = LOWER(?) LIMIT 1";
    const [isProductExist] = await dbConnection.execute(checkQuery, [
      supplier,
      name,
    ]);

    if (isProductExist.length > 0) {
      throw new Error("Product already exists.");
    }

    // Insert new product
    const insertQuery =
      "INSERT INTO Products (SupplierId, ProductName, KnownAs, Hsn) VALUES (?, ?, ?, ?)";
    await dbConnection.execute(insertQuery, [supplier, name, knownAs, hsn]);

    // console.log("Product created successfully.");
    return "Product created successfully.";
  } catch (error) {
    // console.error("Error creating product:", error.message);
    throw error;
  }
};
/**
 *
 * @returns object
 *
 * This gives all the product list in the system
 * PASS
 */
const getProductList = async () => {
  try {
    const query = `select 
                            Products.Id,
                            Products.ProductName,
                            Products.Hsn,
                            Products.KnownAs,
                            Products.CreatedAt,
                            Suppliers.Name AS SupplierName,
                            Products.SupplierId
                            From
                                Products
                            Inner Join
                                Suppliers
                            On
                                Products.SupplierId=Suppliers.Id
                            `;
    const [rows] = await dbConnection.execute(query);
    return rows;
  } catch (error) {
    throw error;
    //  console.log(error)
  }
};
/**
 *
 * @param {*} req
 * @returns strings
 * This is used to create the customer to whom we sell the product.
 * PASS
 */
const createCustomer = async (req, res) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
    await connection.beginTransaction(); // Start transaction

    const {
      CustomerName,
      MobileNo,
      GstNo,
      DlNo,
      BillingAddress,
      BillingState,
      BillingDistrict,
      BillingPincode,
      SupplyAddress,
      SupplyState,
      SupplyDistrict,
      SupplyPincode,
      SupplierId,
      ProductId,
      SellingPrice,
    } = req.body;

    // console.log("Received request body:", req.body);
    const upperGstNo = GstNo ? GstNo.toUpperCase() : null;
    const upperDlNo = DlNo ? DlNo.toUpperCase() : null;

    // Insert customer data
    const insertCustomerQuery = `
            INSERT INTO Customers (CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict, BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

    const [customer] = await connection.execute(insertCustomerQuery, [
      CustomerName,
      MobileNo,
      upperGstNo,
      upperDlNo,
      BillingAddress,
      BillingState,
      BillingDistrict,
      BillingPincode,
      SupplyAddress,
      SupplyState,
      SupplyDistrict,
      SupplyPincode,
    ]);

    const CustomerId = customer.insertId;
    //console.log("Inserted Customer ID:", CustomerId);

    // Insert or Update Pricing (Bulk Insert for Efficiency)
    if (SupplierId && ProductId && SellingPrice && SupplierId.length > 0) {
      const insertPricingQuery = `INSERT INTO CustomerPricing (CustomerId, SupplierId, ProductId, SellingPrice)
                                               VALUES ?
                                               ON DUPLICATE KEY UPDATE SellingPrice = VALUES(SellingPrice)
            `;

      const productEntries = SupplierId.map((_, i) => [
        CustomerId,
        SupplierId[i],
        ProductId[i],
        SellingPrice[i],
      ]);

      // console.log(mysql.format(insertPricingQuery,[productEntries]))
      await connection.query(insertPricingQuery, [productEntries]);
      //  console.log("Inserted/Updated pricing details successfully.");
    } else {
      throw new Error("No products to insert/update.");
    }
    // const supplierId= result.insertId;
    await dbConnection.execute(
      `
          INSERT INTO Accounts (AccountName, AccountType, SupplierId,CustomerId)
          VALUES (?, 'CUSTOMER', ?, ?)
        `,
      [`${Name}`, " ", CustomerId]
    );
    await connection.commit(); // Commit transaction
    return "Customer and pricing details added/updated successfully!";
  } catch (error) {
    await connection.rollback(); // Rollback transaction in case of error
    //  console.error("Error in createCustomer:", error);
    throw error;
    //res.status(500).json({ error: "Internal Server Error", details: error.message });
  } finally {
    connection.release(); // Release DB connection
  }
};

/**
 * Get all customers from the system
 * @returns {Promise<Array<Object>>}
 * 
 * Pass
 */
const getCustomerList = async () => {
  try {
    const query = `
            SELECT 
                Id,
                Lower(CustomerName) As CustomerName,
                MobileNo,
                CreatedAt,
                GstNo,
                DlNo
            FROM Customers
            ORDER BY CustomerName ASC
        `;

    const [rows] = await dbConnection.promise().execute(query);
    return rows;
  } catch (error) {
    // console.error("Error fetching customer list:", error);
    throw error;
  }
};

/**
 * Get customer name by customer ID
 * @param {number} customerId
 * @returns {Promise<string|null>}
 * Pass
 */
const getCustomerName = async (customerId) => {
  // const connection = await dbConnection.pool.getConnection();
  try {
    const [rows] = await dbConnection.query(
      `SELECT  Lower(CustomerName) As CustomerName 
             FROM Customers 
             WHERE Id = ? 
             LIMIT 1`,
      [customerId]
    );

    return rows.length ? rows[0].CustomerName : null;
  } catch (error) {
    // console.error("Error fetching customer name:", error);
    throw error;
  } finally {
    // connection.release();
  }
};
/**
 * 
 * @returns 
 * Pass
 */
const getStockList = async () => {
  try {
    const sql = `SELECT 
                        Stock.Id,
                        Products.Id AS ProductId,
                        Products.ProductName,
                        Stock.BatchNumber,
                        Stock.Quantity, 
                        DATE_FORMAT(Stock.ExpiryDate, '%d-%m-%y') AS ExpiryDate,
                        Stock.CreatedAt,
                        (
                            SELECT IGSTPercentage 
                            FROM PurchaseOrderDetails 
                            WHERE ProductId = Products.Id 
                            ORDER BY Id DESC 
                            LIMIT 1
                        ) AS IGSTPercentage
                    FROM Stock
                    JOIN Products ON Stock.ProductId = Products.Id
                    WHERE Stock.Quantity > 0 AND Stock.ExpiryDate > CURDATE();
                            `;
    const [rows] = await dbConnection.connection.promise().execute(sql);
    //console.log(rows)
    // console.log('sujeet')
    return rows;
  } catch (error) {
    throw error;
  }
};

const getStocks = async (supplierId = "", page = 1,limit = 20,isDownload = false
) => {
  try {
    const offset = (page - 1) * limit;
    const params = [];

    // ===============================
    // 1️⃣ GET TOTAL PRODUCT COUNT
    // ===============================
    let countSql = `
                    SELECT COUNT(DISTINCT CONCAT(p.Id, '_', s.Id)) as total
                    FROM Stock st
                    JOIN Products p ON st.ProductId = p.Id
                    JOIN Suppliers s ON st.SupplierId = s.Id
              `;

    if (supplierId) {
      countSql += ` WHERE s.Id = ?`;
      params.push(supplierId);
    }

    const [countResult] = await dbConnection.execute(countSql, params);
    const totalProducts = countResult[0].total;

    // ===============================
    // 2️⃣ GET PAGINATED PRODUCTS
    // ===============================
    let productSql = `
                        SELECT DISTINCT
                          p.Id AS ProductId,
                          p.ProductName,
                          s.Id AS SupplierId,
                          s.Name AS SupplierName
                      FROM Stock st
                      JOIN Products p ON st.ProductId = p.Id
                      JOIN Suppliers s ON st.SupplierId = s.Id
                  `;

    const productParams = supplierId ? [supplierId] : [];

    if (supplierId) {
      productSql += ` WHERE s.Id = ?`;
    }

    productSql += `
      ORDER BY p.ProductName ASC
    `;

    if (!isDownload) {
      productSql += ` LIMIT ${limit} OFFSET ${offset}`;
      //productParams.push(limit, offset);
    }

    const [products] = await dbConnection.execute(productSql, productParams);

    if (products.length === 0) {
      return { stocks: [], totalProducts };
    }

    // ===============================
    // 3️⃣ FETCH BATCHES FOR THESE PRODUCTS
    // ===============================
    const productIds = products.map((p) => p.ProductId);

    let batchSql = `
      SELECT 
          st.ProductId,
          st.SupplierId,
          st.BatchNumber,
          DATE_FORMAT(st.ExpiryDate, '%Y-%m-%d') AS ExpiryDate,
          SUM(st.Quantity) AS Quantity
      FROM Stock st
      WHERE st.ProductId IN (${productIds.map(() => "?").join(",")})
    `;

    const batchParams = [...productIds];

    if (supplierId) {
      batchSql += ` AND st.SupplierId = ?`;
      batchParams.push(supplierId);
    }

    batchSql += `
      GROUP BY 
          st.ProductId,
          st.SupplierId,
          st.BatchNumber,
          st.ExpiryDate
      ORDER BY st.BatchNumber ASC
    `;

    const [batches] = await dbConnection.execute(batchSql, batchParams);

    // ===============================
    // 4️⃣ GROUP DATA CLEANLY
    // ===============================
    const grouped = {};

    products.forEach((p) => {
      const key = `${p.ProductId}_${p.SupplierId}`;
      grouped[key] = {
        ProductId: p.ProductId,
        ProductName: p.ProductName,
        SupplierId: p.SupplierId,
        SupplierName: p.SupplierName,
        TotalQuantity: 0,
        Batches: [],
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

    return {
      stocks: Object.values(grouped),
      totalProducts,
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};

/**
 *
 * @param {*} req
 * @param {*} res
 * @returns
 */

const createSale = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();
  try {
    await connection.beginTransaction();

    const {
      customerId,
      stockId,
      quantitySold,
      sgst,
      cgst,
      saleDate
    } = req.body;

    if (!customerId || !stockId || !quantitySold || !sgst || !cgst || !saleDate) {
      throw new Error("Missing required fields");
    }

    const customerName = await getCustomerName(customerId);

    const stockQuantityMap = stockId.reduce((map, stock, index) => {
      const quantity = parseFloat(quantitySold[index]);
      map[stock] = (map[stock] || 0) + quantity;
      return map;
    }, {});

    // ✅ STOCK CHECK
    for (let stockId in stockQuantityMap) {
      const totalQuantitySold = stockQuantityMap[stockId];

      const [rows] = await connection.query(`
        SELECT p.ProductName, s.BatchNumber, s.Quantity
        FROM Products p
        JOIN Stock s ON p.Id = s.ProductId
        WHERE s.Id = ?
      `, [stockId]);

      if (rows.length === 0) {
        throw new Error(`Stock not found`);
      }

      if (rows[0].Quantity < totalQuantitySold) {
        throw new Error(`Insufficient stock`);
      }
    }

    // ✅ INVOICE GENERATION
    const invoiceId = await generateDocumentNumber(connection,'SALESINVOICE')//`INV-${formattedDate}-${sequence}`;

    // ✅ PREPARE DATA
    let totalInvoiceAmount = 0;

    const salesData = await Promise.all(
      stockId.map(async (stock, index) => {
        const quantity = parseFloat(quantitySold[index]);
        const productBasedSgst = parseFloat(sgst[index]);
        const productBasedCgst = parseFloat(cgst[index]);

        const [[row]] = await connection.execute(`
          SELECT cp.SellingPrice
          FROM Stock s
          JOIN CustomerPricing cp ON s.ProductId = cp.ProductId
          WHERE s.Id = ? AND cp.CustomerId = ? AND cp.Status = 1
        `, [stock, customerId]);

        if (!row) {
          const pName = await getProductFromStockId(stock, connection);
          throw new Error(`No price for ${pName}`);
        }

        const price = parseFloat(row.SellingPrice);
        const totalValue = quantity * price;
        const sgstAmount = (totalValue * productBasedSgst) / 100;
        const cgstAmount = (totalValue * productBasedCgst) / 100;
        const totalWithTax = totalValue + sgstAmount + cgstAmount;

        totalInvoiceAmount += totalWithTax; // ✅ FIXED (accumulate)

        return [
          customerId,
          stock,
          quantity,
          price,
          productBasedSgst,
          sgstAmount,
          productBasedCgst,
          cgstAmount,
          totalValue,
          totalWithTax,
          invoiceId,
          1,
        ];
      })
    );

    // 🔥 NEW SYSTEM INSERT (HEADER)
    const [headerResult] = await connection.query(`
      INSERT INTO SalesHeader 
      (CustomerId, InvoiceId, TotalAmount, SaleDate)
      VALUES (?, ?, ?, ?)
    `, [customerId, invoiceId, totalInvoiceAmount, saleDate]);

    const saleId = headerResult.insertId;

    // 🔥 NEW SYSTEM INSERT (ITEMS)
    const itemsData = salesData.map(row => ([
      saleId,     // SaleId
      row[1],        // StockId
      row[2],        // Qty
      row[3],        // Price
      row[4],        // SGST
      row[5],        // SGST Amt
      row[6],        // CGST
      row[7],        // CGST Amt
      row[8],        // Total
      row[9]         // Total With Tax
    ]));

    await connection.query(`
      INSERT INTO SalesItems
      (SaleId, StockId, QuantitySold, SalePrice,
       Sgst, SgstAmount, Cgst, CgstAmount,
       TotalValue, TotalValueWithTax)
      VALUES ?
    `, [itemsData]);

    // ✅ STOCK UPDATE
    for (let stockId in stockQuantityMap) {
      const totalQuantitySold = stockQuantityMap[stockId];

      await connection.query(`
        INSERT INTO StockTransactions 
        (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
        VALUES (?, 'REDUCE', 'OUT', ?, NOW(), ?)
      `, [stockId, totalQuantitySold, `Sold to ${customerName}`]);

      await connection.query(`
        UPDATE Stock 
        SET Quantity = Quantity - ? 
        WHERE Id = ?
      `, [totalQuantitySold, stockId]);
    }
    const formattedPaymentDate = moment().format("YYYY-MM-DD");
    // 🔥 Financial Year
    const financialYear = await getFinancialYear(formattedPaymentDate);

    const voucherId= await  await createSaleEntry({
      connection,
      customerId,
      invoiceId,
      insertedSaleId: saleId, // ✅ IMPORTANT CHANGE
      saleDate,
      totalAmount: totalInvoiceAmount,
      userId: req.user.Id,
    });

    // ✅ CUSTOMER LEDGER
    await connection.execute(`
      INSERT INTO CustomerLedger
      (CustomerId, FinancialYear, EntryDate, TransactionType,
       ReferenceType, ReferenceId, ReferenceNo,
       DebitAmount, CreditAmount, Description, VoucherId)
      VALUES (?, ?, CURDATE(), 'SALE',
              'INVOICE', ?, ?, ?, 0, ?, ?)
    `, [
      customerId,
      financialYear,
      saleId,           // ✅ internal link
      invoiceId,           // ✅ human readable
      totalInvoiceAmount,
      `Sale ${invoiceId}`,
      voucherId
    ]);

    // 🔥 DOUBLE ENTRY (USE NEW SALE ID)
   // const saleDate = moment().format("YYYY-MM-DD");

    await connection.commit();
    return {saleId,invoiceId};

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Create a delivery challan, reduce stock, and log transactions
 *
 * @param {Object} req - Express request object
 * @param {Object} req.body - The request payload
 * @param {number} req.body.customerId - ID of the customer
 * @param {string} req.body.ChallanDate - Date of challan (yyyy-mm-dd)
 * @param {number[]} req.body.stockId - Array of stock IDs
 * @param {number[]} req.body.quantitySold - Array of quantities for each stock
 * @returns {number} challanId - ID of the newly created challan
 */
const createChallan = async (req) => {
  const connection = await dbConnection.connection.promise().getConnection();
  try {
    await connection.beginTransaction();

    // console.log(req.body)

    const {
      customerId,
      ChallanDate,
      stockId,
      quantitySold,
      remarks = "",
    } = req.body;

    if (!customerId || !stockId || !quantitySold || !ChallanDate) {
      throw new Error("Missing required fields");
    }

    const customerName = await getCustomerName(customerId);
    const challanDateSql = moment(ChallanDate, "DD-MM-YYYY").format(
      "YYYY-MM-DD"
    );

    // Track total quantities per stock
    const stockQuantityMap = stockId.reduce((map, stock, index) => {
      const qty = parseFloat(quantitySold[index]);
      map[stock] = (map[stock] || 0) + qty;
      return map;
    }, {});

    // Step 1: Check stock availability
    for (let sId in stockQuantityMap) {
      const totalQty = stockQuantityMap[sId];

      const stockQuery = `
                SELECT p.Id AS productId, p.ProductName, s.BatchNumber, s.Quantity AS availableQuantity
                FROM Products p
                JOIN Stock s ON p.Id = s.ProductId
                WHERE s.Id = ?;
            `;
      const [rows] = await connection.query(stockQuery, [sId]);

      if (rows.length === 0) {
        throw new Error(`Stock with ID ${sId} not found.`);
      }

      const stockInfo = rows[0];
      if (stockInfo.availableQuantity < totalQty) {
        throw new Error(
          `Insufficient stock for product "${stockInfo.ProductName}" (Batch ${stockInfo.BatchNumber}). 
                     Available: ${stockInfo.availableQuantity}, Requested: ${totalQty}`
        );
      }
    }

    // Step 2: Create challan
    const challanInsertQuery = `
            INSERT INTO Challan (CustomerId, Remarks, ChallanDate, CreatedBy, CreatedAt) 
            VALUES (?, ?, ?, ?, NOW())
        `;
    const [challanResult] = await connection.query(challanInsertQuery, [
      customerId,
      remarks,
      challanDateSql,
      req.user?.id || 1, // Use logged-in user or fallback
    ]);
    const challanId = challanResult.insertId;

    // Step 3: Insert challan items + update stock + log transactions
    for (let sId in stockQuantityMap) {
      const qty = stockQuantityMap[sId];

      // Insert into ChallanItems
      const challanItemQuery = `
                        INSERT INTO ChallanItems (ChallanId, StockId, QuantitySold) VALUES (?, ?, ?)
            `;
      await connection.query(challanItemQuery, [challanId, sId, qty]);

      // Log stock transaction
      const transactionQuery = `
                INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Timestamp, Remarks) 
                VALUES (?, 'REDUCE', ?, NOW(), ?)
            `;
      await connection.query(transactionQuery, [
        sId,
        qty,
        `Challan #${challanId} sent to ${customerName}`,
      ]);

      // Update stock
      const updateStockQuery = `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ?`;
      await connection.query(updateStockQuery, [qty, sId]);
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

