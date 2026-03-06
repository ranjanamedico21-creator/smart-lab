const helper = require("../helper/helper");
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support
const dbConnection = require("../config/DBConnection");
const moment =require('moment');
//const { connect } = require("puppeteer");
//const BillingController = require("../controllers/BillingController");

/**
 * Create a new supplier
 *
 * This function inserts a new supplier record into the `Suppliers` table
 * using data received from the request body.
 *
 * @param {Object} req - Express request object
 * @param {Object} req.body - Supplier details
 * @param {string} req.body.Name - Supplier name
 * @param {string} req.body.Address - Supplier address
 * @param {string} req.body.City - City of supplier
 * @param {string} req.body.State - State of supplier
 * @param {string|number} req.body.Pincode - Area pincode
 * @param {string} req.body.StdCode - STD code for landline
 * @param {string} req.body.LandlineNo - Landline number
 * @param {string} req.body.MobileNumber - Primary contact number
 * @param {string} req.body.GstIn - GST identification number
 * @param {string} req.body.DlNo - Drug License number
 * @param {string} req.body.CIN - Corporate Identification Number
 *
 * @returns {Promise<string>} - Success message after supplier creation
 *
 * @throws {Error} - Throws database insertion or validation errors
 *
 * Usage Example:
 * await createSupplier(req);
 */
const createSupplier = async (supplierDetails) => {
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
            LandlineNo
        } = supplierDetails;

        const sql = `
            INSERT INTO Suppliers
            (
                Name,
                Address,
                City,
                State,
                PinCode,
                StdCode,
                LandlineNumber,
                ContactNo,
                GstIn,
                DlNo,
                Cin
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await dbConnection.execute(sql, [
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
            CIN
        ]);

        return 'Supplier created successfully.';
    } catch (error) {
        console.error("Error creating supplier:", error);
        throw error;
    }
};

/**
 * Get list of all suppliers
 *
 * This function retrieves all supplier records from the `Suppliers` table.
 * It is commonly used for:
 *  - Supplier listing pages
 *  - Dropdown selections
 *  - Supplier management screens
 *
 * @returns {Promise<Array>} - Returns an array of supplier objects.
 *                            If no suppliers exist, an empty array is returned.
 *
 * @throws {Error} - Throws database or query execution error
 *
 * Usage Example:
 * const suppliers = await getSuppliersList();
 */
const getSuppliersList = async () => {
    try {
        const query = `
            SELECT *,Lower(Name) As Name
            FROM Suppliers
        `;

        const [rows] = await dbConnection.execute(query);
        return rows;
    } catch (error) {
        console.error("Error fetching suppliers list:", error);
        throw error;
    }
};

/**
 * Get supplier details by supplier ID
 *
 * This function fetches complete supplier information from the `Suppliers` table
 * based on the provided supplierId.
 *
 * @param {number} supplierId - Unique ID of the supplier
 * @returns {Promise<Array>} - Returns an array containing supplier details.
 *                            If supplierId does not exist, an empty array is returned.
 *
 * @throws {Error} - Throws database or query execution error
 *
 * Usage Example:
 * const supplier = await getSupplierDetails(5);
 */
const getSupplierDetails = async (supplierId) => {
    try {
        const query = `
            SELECT *
            FROM Suppliers
            WHERE Id = ?
        `;

        const [rows] = await dbConnection.execute(query, [supplierId]);

        return rows;
    } catch (error) {
        console.error("Error fetching supplier details:", error);
        throw error;
    }
};

/**
 * 
 * @param {*} req 
 * @returns string
 * Thisis used to create the product which is supplied by the supplier
 */
const createProduct = async (req) => {
    try {
        const { supplier, name, knownAs, hsn } = req.body;

        // Check if product already exists
        const checkQuery = "SELECT 1 FROM Products WHERE SupplierId=? AND LOWER(ProductName) = LOWER(?) LIMIT 1";
        const [isProductExist] = await dbConnection.execute(checkQuery, [supplier, name]);

        if (isProductExist.length > 0) {
            throw new Error("Product already exists.");
        }

        // Insert new product
        const insertQuery = "INSERT INTO Products (SupplierId, ProductName, KnownAs, Hsn) VALUES (?, ?, ?, ?)";
        await dbConnection.execute(insertQuery, [supplier, name, knownAs, hsn]);

        console.log("Product created successfully.");
        return  "Product created successfully." ;
    } catch (error) {
        console.error("Error creating product:", error.message);
        throw error;
    }
};
/**
 * 
 * @returns object
 * 
 * This gives all the product list in the system
 */
const getProductList = async()=>{

    try {
        const query =`select 
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
                            `
        const [rows]= await dbConnection.execute(query);
        return rows
    } catch (error) {
        throw error
        console.log(error)
    }
}
/**
 * 
 * @param {*} req 
 * @returns strings
 * This is used to create the customer to whom we sell the product.
 */
const createCustomer = async (req, res) => {
    const connection = await dbConnection.pool.promise().getConnection();
    
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

        console.log("Received request body:", req.body);
        const upperGstNo = GstNo ? GstNo.toUpperCase() : null;
        const upperDlNo = DlNo ? DlNo.toUpperCase() : null;

        // Insert customer data
        const insertCustomerQuery = `
            INSERT INTO Customers (CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict, BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [customer] = await connection.execute(insertCustomerQuery, [
            CustomerName, MobileNo, upperGstNo, upperDlNo, BillingAddress, BillingState, BillingDistrict, 
            BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode
        ]);

        const CustomerId = customer.insertId;
        console.log("Inserted Customer ID:", CustomerId);

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

            console.log(mysql.format(insertPricingQuery,[productEntries]))
            await connection.query(insertPricingQuery, [productEntries]);
            console.log("Inserted/Updated pricing details successfully.");
        } else {
            throw new Error("No products to insert/update.");
        }

        await connection.commit(); // Commit transaction
        return  "Customer and pricing details added/updated successfully!";

    } catch (error) {
        await connection.rollback(); // Rollback transaction in case of error
        console.error("Error in createCustomer:", error);
        throw error
        //res.status(500).json({ error: "Internal Server Error", details: error.message });
    } finally {
        connection.release(); // Release DB connection
    }
};

/**
 * Get all customers from the system
 * @returns {Promise<Array<Object>>}
 */
const getCustomerList = async () => {
    try {
        const query = `
            SELECT 
                Id,
                Lower(CustomerName) As CustomerName,
                GstNo,
                DlNo,
               
                CreatedAt
            FROM Customers
            ORDER BY CustomerName ASC
        `;

        const [rows] = await dbConnection.promise().execute(query);
        return rows;

    } catch (error) {
        console.error("Error fetching customer list:", error);
        throw error;
    }
};

/**
 * Get customer name by customer ID
 * @param {number} customerId
 * @returns {Promise<string|null>}
 */
const getCustomerName = async (customerId) => {
    const connection = await dbConnection.pool.promise().getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT Lower(CustomerName) As CustomerName
             FROM Customers 
             WHERE Id = ? 
             LIMIT 1`,
            [customerId]
        );

        return rows.length ? rows[0].CustomerName : null;

    } catch (error) {
        console.error("Error fetching customer name:", error);
        throw error;
    } finally {
        connection.release();
    }
};


const getStockList = async()=>{
    try {
       /* const sql = `
                    SELECT Stock.Id,Products.Id AS ProductId, Products.ProductName, Stock.BatchNumber, Stock.Quantity, 
                    DATE_FORMAT(Stock.ExpiryDate,'%d-%m-%y') AS ExpiryDate,
                    Stock.CreatedAt 
                    FROM Stock
                    JOIN Products ON Stock.ProductId = Products.Id 
                    WHERE Stock.Quantity > 0;`*/
        /*const sql=`SELECT 
                        Stock.Id,
                        Products.Id AS ProductId,
                        Products.ProductName,
                        Stock.BatchNumber,
                        Stock.Quantity, 
                        DATE_FORMAT(Stock.ExpiryDate, '%d-%m-%y') AS ExpiryDate,
                        Stock.CreatedAt,
                        PurchaseOrderDetails.IGSTPercentage
                    FROM Stock
                    JOIN Products ON Stock.ProductId = Products.Id
                    JOIN PurchaseOrderDetails ON PurchaseOrderDetails.ProductId = Products.Id
                    WHERE Stock.Quantity > 0;`*/
        const sql=`SELECT 
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
                            `
        const [rows]= await dbConnection.connection.promise().execute(sql)
        console.log(rows)
        console.log('sujeet')
        return rows
    } catch (error) {
        throw error
    }
}

/*const getStocks = async (supplierId = '') => {
    try {

        console.log(supplierId);
        console.log('supplier')
        let sql = `SELECT 
                        p.Id AS ProductId,
                        p.ProductName,
                        s.Id AS SupplierId,
                        s.Name AS SupplierName,
                        SUM(st.Quantity) AS TotalQuantity,
                        st.BatchNumber
                    FROM Stock st
                    JOIN Products p ON st.ProductId = p.Id
                    JOIN Suppliers s ON st.SupplierId = s.Id`;

        const queryParams = [];

        if (supplierId) {

            console.log('i m in supplier')
            sql += ` WHERE s.Id = ?`;
            queryParams.push(supplierId);
        }

        sql += ` GROUP BY p.Id, p.ProductName, s.Id, s.Name, st.BatchNumber;`;

        console.log(mysql.format(sql,queryParams))

        const [rows] = await dbConnection.execute(sql, queryParams);
        return rows;
    } catch (error) {
        console.log(error);
        throw error;
    }
};
*/

/*const getStocks = async (supplierId = '') => {
  try {

    let sql = `
      SELECT 
          p.Id AS ProductId,
          p.ProductName,
          s.Id AS SupplierId,
          s.Name AS SupplierName,
          st.BatchNumber,
          DATE_FORMAT(st.ExpiryDate, '%Y-%m-%d') AS ExpiryDate,
          SUM(st.Quantity) AS Quantity
      FROM Stock st
      JOIN Products p ON st.ProductId = p.Id
      JOIN Suppliers s ON st.SupplierId = s.Id
    `;

    const queryParams = [];

    if (supplierId) {
      sql += ` WHERE s.Id = ?`;
      queryParams.push(supplierId);
    }

    sql += `
      GROUP BY 
          p.Id, p.ProductName, 
          s.Id, s.Name, 
          st.BatchNumber,
          st.ExpiryDate
      ORDER BY 
          p.ProductName ASC,
          s.Name ASC,
          st.BatchNumber ASC
    `;

    const [rows] = await dbConnection.execute(sql, queryParams);
    const grouped={};
    rows.forEach(row => {
    
          const key = `${row.ProductId}_${row.SupplierId}`;
          // Ensure numeric quantity
          const quantity = parseFloat(row.Quantity) || 0;
    
          if (!grouped[key]) {
            grouped[key] = {
              ProductId: row.ProductId,
              ProductName: row.ProductName,
              SupplierId: row.SupplierId,
              SupplierName: row.SupplierName,
              TotalQuantity: 0,
              Batches: []
            };
          }
    
          grouped[key].Batches.push({
            BatchNumber: row.BatchNumber,
            Quantity: quantity,
            ExpiryDate: moment(row.ExpiryDate, "YYYY-MM-DD").format("DD-MM-YYYY") 
          });
    
          grouped[key].TotalQuantity += quantity;
        });
    return Object.values(grouped);;

  } catch (error) {
    console.log(error);
    throw error;
  }
};*/

/*const getStocks = async (supplierId = '',limit = null,offset = null,isDownload = false) => {
  try {
    let sql = `
      SELECT 
          p.Id AS ProductId,
          p.ProductName,
          s.Id AS SupplierId,
          s.Name AS SupplierName,
          st.BatchNumber,
          DATE_FORMAT(st.ExpiryDate, '%Y-%m-%d') AS ExpiryDate,
          SUM(st.Quantity) AS Quantity
      FROM Stock st
      JOIN Products p ON st.ProductId = p.Id
      JOIN Suppliers s ON st.SupplierId = s.Id
    `;

    const queryParams = [];

    if (supplierId) {
      sql += ` WHERE s.Id = ?`;
      queryParams.push(supplierId);
    }

    sql += `
      GROUP BY 
          p.Id, p.ProductName, 
          s.Id, s.Name, 
          st.BatchNumber,
          st.ExpiryDate
      ORDER BY 
          p.ProductName ASC,
          s.Name ASC,
          st.BatchNumber ASC
    `;

    // ✅ Add Pagination Only If NOT Download
    if (!isDownload && limit !== null && offset !== null) {
      sql += ` LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);
    }

    const [rows] = await dbConnection.execute(sql, queryParams);

    // ===============================
    // GROUPING LOGIC
    // ===============================
    const grouped = {};

    rows.forEach(row => {

      const key = `${row.ProductId}_${row.SupplierId}`;
      const quantity = parseFloat(row.Quantity) || 0;

      if (!grouped[key]) {
        grouped[key] = {
          ProductId: row.ProductId,
          ProductName: row.ProductName,
          SupplierId: row.SupplierId,
          SupplierName: row.SupplierName,
          TotalQuantity: 0,
          Batches: []
        };
      }

      grouped[key].Batches.push({
        BatchNumber: row.BatchNumber,
        Quantity: quantity,
        ExpiryDate: moment(row.ExpiryDate, "YYYY-MM-DD").format("DD-MM-YYYY")
      });

      grouped[key].TotalQuantity += quantity;
    });

    return Object.values(grouped);

  } catch (error) {
    console.log(error);
    throw error;
  }
};*/

const getStocks = async (supplierId = '',page = 1,limit = 20,isDownload = false) => {
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
    const productIds = products.map(p => p.ProductId);

    let batchSql = `
      SELECT 
          st.ProductId,
          st.SupplierId,
          st.BatchNumber,
          DATE_FORMAT(st.ExpiryDate, '%Y-%m-%d') AS ExpiryDate,
          SUM(st.Quantity) AS Quantity
      FROM Stock st
      WHERE st.ProductId IN (${productIds.map(() => '?').join(',')})
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

    products.forEach(p => {
      const key = `${p.ProductId}_${p.SupplierId}`;
      grouped[key] = {
        ProductId: p.ProductId,
        ProductName: p.ProductName,
        SupplierId: p.SupplierId,
        SupplierName: p.SupplierName,
        TotalQuantity: 0,
        Batches: []
      };
    });

    batches.forEach(b => {
      const key = `${b.ProductId}_${b.SupplierId}`;
      const qty = parseFloat(b.Quantity) || 0;

      if (grouped[key]) {
        grouped[key].Batches.push({
          BatchNumber: b.BatchNumber,
          Quantity: qty,
          ExpiryDate: moment(b.ExpiryDate, "YYYY-MM-DD").format("DD-MM-YYYY")
        });

        grouped[key].TotalQuantity += qty;
      }
    });

    return {
      stocks: Object.values(grouped),
      totalProducts
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
    const connection = await dbConnection.pool.promise().getConnection();
    try {
        // Start transaction
        await connection.beginTransaction();

        // Destructure and validate the request body
        const {
            customerId,
            stockId, // Array
            quantitySold, // Array
            sgst, // Arrau SGST percentage
            cgst, // Array CGST percentage
        } = req.body;

        if (!customerId || !stockId || !quantitySold  || !sgst || !cgst) {
            throw new Error('Missing required fields');
        }
        const customerName= await getCustomerName(customerId);
        // Track total quantities per stock
        const stockQuantityMap = stockId.reduce((map, stock, index) => {
            const quantity = parseFloat(quantitySold[index]);
            map[stock] = (map[stock] || 0) + quantity;
            return map;
        }, {});
//console.log(stockQuantityMap)
//console.log(`stockQuantityMap`)

        // Step 2: Check stock availability
        for (let stockId in stockQuantityMap) {
            const totalQuantitySold = stockQuantityMap[stockId];

            const stockAvailabilityQuery = `SELECT 
                                                    p.Id AS productId,
                                                    p.ProductName AS productName,
                                                    s.BatchNumber AS batchNumber,
                                                    s.Quantity AS availableQuantity
                                                FROM 
                                                    Products p
                                                JOIN 
                                                    Stock s
                                                ON 
                                                    p.Id = s.ProductId
                                                WHERE 
                                                    s.Id = ?;
                                            `;
            const [rows] = await connection.query(stockAvailabilityQuery, [stockId]);

            console.log(rows);

            console.log(mysql.format(stockAvailabilityQuery,[stockId]))
            console.log('stock available query ')
            const stockInfo = rows[0];
            if (rows.length === 0) {
                throw new Error(`Stock with ${stockInfo.productName}" (Batch ${stockInfo.batchNumber}) not found.`);
            }

            if (stockInfo.availableQuantity < totalQuantitySold) {
                throw new Error(
                    `Insufficient stock for product "${stockInfo.productName}" (Batch ${stockInfo.batchNumber}). Available: ${stockInfo.availableQuantity}, Requested: ${totalQuantitySold}`
                );
            }
        }
        // Get today's date in YYYY-MM-DD format
        const todayDate = moment().format('YYYY-MM-DD');
        //get all the count of invoice generated today
        const [result] = await connection.query(`SELECT COUNT(DISTINCT InvoiceId) AS count FROM Sales WHERE DATE(CreatedAt) = ?`, [todayDate]);
        const totalCount=result[0].count
        //generating invoiceId
        const formattedDate = moment().format('YYYYMMDD');
        //console.log(formattedDate)
        //console.log('formattedDate')
        const sequence = String(totalCount + 1).padStart(3, '0'); // Incremental number
        const invoiceId= `INV-${formattedDate}-${sequence}`;
          //return result[0].count;
        // Step 3: Insert sales data
        const salesData = await Promise.all(stockId.map(async (stock, index) => {
            const quantity = parseFloat(quantitySold[index]);
            const productBasedSgst=parseFloat(sgst[index])
            const productBasedCgst=parseFloat(cgst[index])
            const query = `SELECT cp.SellingPrice
                           FROM Stock s
                           JOIN CustomerPricing cp ON s.ProductId = cp.ProductId
                           WHERE s.Id = ? AND cp.CustomerId = ? And cp.Status=1`;
            const [row] = await connection.execute(query, [stock, customerId]);
            // Check if no rows are returned and throw an error
            if (row.length === 0) {
                //get stock name
                const pName = await getProductFromStockId(stock,connection)
                throw new Error(`No SellingPrice found for Stock: ${pName} and Customer Name: ${customerName}.`);
            }
            console.log(mysql.format(query, [stock, customerId]));
        
            const price = parseFloat(row[0].SellingPrice);
            //console.log(price);
            console.log('price');
            const totalValue = quantity * price;
           // const sgstAmount = totalValue * (parseFloat(sgst)) / 100;
           const sgstAmount = (totalValue * productBasedSgst) / 100;
           // const cgstAmount = totalValue * (parseFloat(cgst)) / 100;
           const cgstAmount = (totalValue * productBasedCgst) / 100;
           const totalWithTax = totalValue + (totalValue * (productBasedSgst + productBasedCgst) / 100);
        
            return [customerId, stock, quantity, price, productBasedSgst, sgstAmount,productBasedCgst, cgstAmount, totalValue, totalWithTax, invoiceId,1];
        }));
        const saleQuery = `INSERT INTO Sales (CustomerId, StockId, QuantitySold, SalePrice,Sgst,SgstAmount,Cgst,CgstAmount,TotalValue,TotalValueWithTax,InvoiceId,Status) VALUES ? `;
//insert into payments table 
        console.log(mysql.format(saleQuery,[salesData]))

        console.log('********************Testing sales query****************************')
        await connection.query(saleQuery, [salesData]);

        // Step 4: Update stock and log transactions
        for (let stockId in stockQuantityMap) {
            const totalQuantitySold = stockQuantityMap[stockId];

            // Log the transaction
            const insertTransactionQuery = `INSERT INTO StockTransactions (StockId, TransactionType,Effect, Quantity, Timestamp, Remarks) VALUES (?, 'REDUCE',?, ?, NOW(), ?)`;
            await connection.query(insertTransactionQuery, [stockId,'OUT', totalQuantitySold, `Sold to the customer ${customerName}`]);

            // Update stock quantity
            const updateStockQuery = `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ?`;
            await connection.query(updateStockQuery, [totalQuantitySold, stockId]);
        }

        // Commit transaction
        await connection.commit();
       // res.status(200).send({ message: '' });
       return invoiceId

    } catch (error) {
        console.error('Error in createSale:', error.message);
        await connection.rollback(); // Rollback transaction on error
        throw error
       // res.status(500).send({ error: error.message });
    } finally {
        connection.release(); // Release the connection
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
    const connection = await dbConnection.pool.promise().getConnection();
    try {
        await connection.beginTransaction();

        console.log(req.body)

        const { customerId, ChallanDate, stockId, quantitySold, remarks = '' } = req.body;

        if (!customerId || !stockId || !quantitySold || !ChallanDate) {
            throw new Error('Missing required fields');
        }

        const customerName = await getCustomerName(customerId);
        const challanDateSql = moment(ChallanDate, "DD-MM-YYYY").format("YYYY-MM-DD");


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
            req.user?.Id || 1, // Use logged-in user or fallback
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
            await connection.query(transactionQuery, [sId, qty, `Challan #${challanId} sent to ${customerName}`]);

            // Update stock
            const updateStockQuery = `UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ?`;
            await connection.query(updateStockQuery, [qty, sId]);
        }

        await connection.commit();
        return challanId;

    } catch (error) {
        await connection.rollback();
        console.error('Error in createChallan:', error.message);
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * 
 * @returns 
 */
const getSalesData= async()=>{
    try {
        const sql = `
                    SELECT
                         Sales.Id,
                         Customers.CustomerName,
                         Products.ProductName, 
                         Stock.BatchNumber, 
                         Sales.QuantitySold,
                         Sales.SalePrice,
                         Sales.Cgst,Sales.Sgst, 
                         Sales.TotalValue,
                         DATE_FORMAT( Sales.CreatedAt,'%d-%m-%y') AS CreatedAt 
                    FROM Sales
                    JOIN Customers ON Sales.CustomerId = Customers.Id
                    JOIN Stock ON Sales.StockId = Stock.Id
                    JOIN Products ON Stock.ProductId = Products.Id`;
        const [rows]= await dbConnection.connection.promise().execute(sql);
        return rows
    } catch (error) {
        console.log(error)
        throw error
    }
}

const addNotes = async(req)=>{
    try {
        const {saleId,noteType,amount,reason}= req.body;
        const query= `insert Into CreditDebitNotes (SaleId,NoteType,Amount,Reason) Values (?,?,?,?)`
        await dbConnection.connection.promise().execute(query,[saleId,noteType,amount,reason]);
        return 'Notes added successfully.'
    } catch (error) {
        throw error
    }
}

const getNotes= async()=>{
    try {
        const sql = `
                    SELECT notes.Id, notes.NoteType, notes.Amount, notes.Reason, notes.CreatedAt, 
                        Sales.Id AS SaleId, Customers.CustomerName , Products.ProductName, Stock.BatchNumber
                    FROM CreditDebitNotes AS notes
                    JOIN Sales ON notes.SaleId = Sales.Id
                    JOIN Customers ON Sales.CustomerId = Customers.Id
                    JOIN Stock ON Sales.StockId = Stock.Id
                    JOIN Products ON Stock.ProductId = Products.Id`;
        const [rows]= await dbConnection.connection.promise().execute(sql)
        return rows

    } catch (error) {
        throw error
    }
}


const addPayment = async (req, res) => {
    try {
        // Destructure request body
        const {customerId,paymentDate,paymentNo, amountPaid, paymentType } = req.body;
        const formattedPaymentDate = moment(paymentDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
       // Id	CustomerId	PaymentNo	PaymentDate	Amount	PaymentType	Description	

       // console.log(req.body)

        // Validate input
        if ( !paymentDate || !amountPaid || !paymentType || !paymentNo) {
           // return res.status(400).json({ message: "All fields are required." });
            throw new Error("All fields are required.");
        }

        const paymentSql = `INSERT INTO Payments (CustomerId,PaymentNo, PaymentDate, Credit, PaymentType)
                            VALUES (?, ?, ?, ?, ?)`;
                            console.log((mysql.format(paymentSql,[customerId,paymentNo, formattedPaymentDate, amountPaid, paymentType])))
        await dbConnection.connection.promise().query(paymentSql, [customerId,paymentNo, formattedPaymentDate, amountPaid, paymentType]);
            return  `Payment of Rs. ${amountPaid} successfully updated.`
    } catch (error) {
        console.error("Error processing payment:", error);
        throw new Error("An error occurred while processing the payment.")
       // res.status(500).json({ message:  });
    }
};

const addPaymentToSupplier = async (req) => {
    try {
        // Destructure request body
        const {supplierId,paymentDate,paymentNo, amountPaid, paymentType } = req.body;
        const formattedPaymentDate = moment(paymentDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
       // Id	CustomerId	PaymentNo	PaymentDate	Amount	PaymentType	Description	

       // console.log(req.body)

        // Validate input
        if ( !paymentDate || !amountPaid || !paymentType || !paymentNo) {
           // return res.status(400).json({ message: "All fields are required." });
            throw new Error("All fields are required.");
        }

        const paymentSql = `INSERT INTO PaymentsToSupplier (SupplierId,PaymentNo, PaymentDate, Credit, PaymentType)
                            VALUES (?, ?, ?, ?, ?)`;
                            console.log((mysql.format(paymentSql,[supplierId,paymentNo, formattedPaymentDate, amountPaid, paymentType])))
        await dbConnection.connection.promise().query(paymentSql, [supplierId,paymentNo, formattedPaymentDate, amountPaid, paymentType]);
            return  `Payment of Rs. ${amountPaid} successfully updated.`
    } catch (error) {
        console.error("Error processing payment:", error);
        throw new Error("An error occurred while processing the payment.")
       // res.status(500).json({ message:  });
    }
};

/**
 * Fetch paginated stock transaction history with advanced filtering.
 *
 * @param {Object} options - Filter and pagination options
 * @param {number} options.stockId - Required Stock ID
 * @param {number} [options.limit=10] - Number of records per page
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {string} [options.type] - Filter by transaction type (ADD, REDUCE, ADJUST)
 * @param {string} [options.search] - Search text for remarks (LIKE search)
 * @param {string} [options.fromDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.toDate] - End date (YYYY-MM-DD)
 *
 * @returns {Promise<Object>} Returns paginated transaction data
 * @returns {Array}  returns.data - List of transaction rows
 * @returns {number} returns.total - Total number of filtered records
 * @returns {number} returns.totalPages - Total pages based on limit
 *
 * @example
 * const result = await getStockTransactions({
 *   stockId: 5,
 *   limit: 10,
 *   offset: 0,
 *   type: 'ADD',
 *   search: 'adjustment',
 *   fromDate: '2025-01-01',
 *   toDate: '2025-12-31'
 * });
 *
 * console.log(result.data);
 */
const getStockTransactionsTest = async ({
  stockId,
  limit = 10,
  offset = 0,
  type,
  search,
  fromDate,
  toDate
}) => {

  try {

      let where = "WHERE StockId = ?";
      let params = [stockId];

      if (type) {
          where += " AND TransactionType = ?";
          params.push(type);
      }

      if (search) {
          where += " AND Remarks LIKE ?";
          params.push(`%${search}%`);
      }

      if (fromDate && toDate) {
          const startDate=moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
          const endDate= moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");
          where += " AND DATE(Timestamp) BETWEEN ? AND ?";
          params.push(startDate, endDate);
      }

      /* ===============================
         1️⃣ DATA QUERY (Paginated)
      =============================== */
      const dataQuery = `
          SELECT *
          FROM StockTransactions
          ${where}
          ORDER BY Timestamp DESC
          LIMIT ? OFFSET ?
      `;

      const [transactions] = await dbConnection.connection
          .promise()
          .execute(dataQuery, [...params, limit, offset]);

      /* ===============================
         2️⃣ COUNT QUERY
      =============================== */
      const countQuery = `
          SELECT COUNT(*) as totalCount
          FROM StockTransactions
          ${where}
      `;

      

      const [[{ totalCount }]] = await dbConnection.connection
          .promise()
          .execute(countQuery, params);

      /* ===============================
         3️⃣ SUMMARY QUERY (IMPORTANT)
      =============================== */
      const summaryQuery = `
          SELECT
            SUM(CASE 
                  WHEN TransactionType IN ('ADD','SALE_RETURN','EXPIRED_RETURN_IN')
                  THEN Quantity ELSE 0 END) as totalAdded,

            SUM(CASE 
                  WHEN TransactionType IN ('REDUCE','EXPIRED_RETURN_OUT')
                  THEN Quantity ELSE 0 END) as totalReduced
          FROM StockTransactions
          ${where}
      `;

      const [[summary]] = await dbConnection.connection
          .promise()
          .execute(summaryQuery, params);

      return {
          transactions,
          totalCount,
          totalAdded: summary.totalAdded || 0,
          totalReduced: summary.totalReduced || 0
      };

  } catch (error) {
      throw error;
  }
};



const getLedgerStock = async (stockId) => {

  const [[{ currentStock }]] = await dbConnection.connection
    .promise()
    .execute(
      `
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN Effect = 'IN' THEN Quantity
            ELSE -Quantity
          END
        ),0) AS currentStock
      FROM StockTransactions
      WHERE StockId = ?
      `,
      [stockId]
    );

  return Number(currentStock || 0);
}

const getStockTransactions = async ({
  stockId,
  limit = 10,
  offset = 0,
  type,
  search,
  fromDate,
  toDate
}) => {

  let where = "WHERE StockId = ?";
  let params = [stockId];

  if (type) {
    where += " AND TransactionType = ?";
    params.push(type);
  }

  if (search) {
    where += " AND Remarks LIKE ?";
    params.push(`%${search}%`);
  }

  if (fromDate && toDate) {
    const startDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
    const endDate   = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");

    where += " AND DATE(Timestamp) BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }

  /* 1️⃣ Total Count */
  const [[{ total }]] = await dbConnection.connection
    .promise()
    .execute(
      `SELECT COUNT(*) as total FROM StockTransactions ${where}`,
      params
    );

  /* 2️⃣ Opening Balance (Before Offset) */
  const openingQuery = `
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN Effect = 'IN' THEN Quantity
          ELSE -Quantity
        END
      ),0) AS openingBalance
    FROM (
      SELECT *
      FROM StockTransactions
      ${where}
      ORDER BY Timestamp ASC
      LIMIT ${Number(offset)}
    ) t
  `;

  const [[{ openingBalance }]] = await dbConnection.connection
    .promise()
    .execute(openingQuery, [...params]);

  /* 3️⃣ Current Page Data */
  const dataQuery = `
    SELECT *
    FROM StockTransactions
    ${where}
    ORDER BY Timestamp ASC
    LIMIT ${Number(limit)} OFFSET ${Number(offset)}
  `;

  const [rows] = await dbConnection.connection
    .promise()
    .execute(dataQuery, [...params]);
    

  return {
    transactions: rows,
    totalCount: total,
    openingBalance: Number(openingBalance || 0)
  };
};


/**
 * 
 * @param {*} customerId 
 * @param {*} startDate 
 * @param {*} endDate 
 * @returns array of object
 * 
 */

/*const getCustomerLedger = async (customerId, startDate, endDate) => {
 
  try {
    let startDateForQuery = moment(startDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    let endDateForQuery = moment(endDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
            
    const [carryForwardRows] = await dbConnection.connection.promise().execute(
      `
      SELECT 
        SUM(Debit) AS CF_Debit, 
        SUM(Credit) AS CF_Credit 
      FROM CarryForward 
      WHERE CustomerId = ? AND CarryForwardDate < ?
      `,
      [customerId, startDateForQuery]
    );

    const [salesBeforeRows] = await dbConnection.execute(
      `
      SELECT SUM(TotalValueWithTax) AS SalesTotal
      FROM Sales
      WHERE CustomerId = ? AND CreatedAt < ?
      `,
      [customerId, startDateForQuery]
    );

    const [paymentsBeforeRows] = await dbConnection.connection.promise().execute(
      `
      SELECT 
        SUM(Credit) AS TotalCredit,
        SUM(Debit) AS TotalDebit
      FROM Payments
      WHERE CustomerId = ? AND PaymentDate < ?
      `,
      [customerId, startDateForQuery]
    );

   

    const [ledgerEntries] = await dbConnection.execute(
        `
        SELECT CONCAT('Sale - ', InvoiceId) AS Type, 
               MIN(CreatedAt) AS Date, 
               SUM(TotalValueWithTax) AS Amount, 
               'DR' AS EntryType
        FROM Sales
        WHERE CustomerId = ? 
          AND CreatedAt BETWEEN ? AND ?
        GROUP BY InvoiceId
      
        UNION ALL
      
        SELECT 'Payment', PaymentDate AS Date, Credit AS Amount, 'CR' AS EntryType
        FROM Payments
        WHERE CustomerId = ? 
          AND PaymentDate BETWEEN ? AND ? 
          AND Credit > 0
      
        UNION ALL
      
        SELECT 'Payment', PaymentDate AS Date, Debit AS Amount, 'DR' AS EntryType
        FROM Payments
        WHERE CustomerId = ? 
          AND PaymentDate BETWEEN ? AND ? 
          AND Debit > 0
      
        ORDER BY Date ASC
        `,
        [
          customerId, startDateForQuery, endDateForQuery,
          customerId, startDateForQuery, endDateForQuery,
          customerId, startDateForQuery, endDateForQuery
        ]
      );
      

    const cf = carryForwardRows[0] || {};
    const sb = salesBeforeRows[0] || {};
    const pb = paymentsBeforeRows[0] || {};

    const openingBalance =
      (Number(cf.CF_Debit) || 0) -
      (Number(cf.CF_Credit) || 0) +
      (Number(sb.SalesTotal) || 0) -
      (Number(pb.TotalCredit) || 0) +
      (Number(pb.TotalDebit) || 0);

    let runningBalance = openingBalance;
    const ledger = [];

    // Opening balance entry
    ledger.push({
      Date: moment(startDate).subtract(1, 'day').format('DD-MM-YYYY HH:mm:ss'),
      Description: 'Opening Balance',
      Debit: runningBalance > 0 ? Number(runningBalance) : 0,
      Credit: runningBalance < 0 ? Math.abs(Number(runningBalance)) : 0,
      Balance:
        Math.abs(Number(runningBalance)).toFixed(2) +
        (runningBalance >= 0 ? ' DR' : ' CR'),
    });

    // Process ledger entries
    // Fixes applied: ensure amount is numeric and entry type is valid
ledgerEntries.forEach((row) => {
    const amount = Number(row.Amount || 0); // Ensure it's always a number
  
    if (row.EntryType === 'DR') {
      runningBalance += amount;
    } else if (row.EntryType === 'CR') {
      runningBalance -= amount;
    }
  
    ledger.push({
      Date: moment(row.Date).format('DD-MM-YYYY HH:mm:ss'),
      Description: row.Type,
      Debit: row.EntryType === 'DR' ? amount : 0,
      Credit: row.EntryType === 'CR' ? amount : 0,
      Balance:
        !isNaN(runningBalance)
          ? Math.abs(runningBalance).toFixed(2) + (runningBalance >= 0 ? ' DR' : ' CR')
          : 'Error',
    });
  });
  

    const totalDebit = ledger.reduce((sum, row) => sum + Number(row.Debit || 0), 0);
    const totalCredit = ledger.reduce((sum, row) => sum + Number(row.Credit || 0), 0);
    const closingBalance =
      Math.abs(runningBalance).toFixed(2) + (runningBalance >= 0 ? ' Dr' : ' Cr');

    return {
      ledger,
      totalDebit: Number(totalDebit.toFixed(2)),
      totalCredit: Number(totalCredit.toFixed(2)),
      closingBalance,
    };
  } catch (error) {
    throw error;
  } finally {
    //connection.release();
  }
};
*/

/**
 * getCustomerLedger
 * ------------------------------------------------------------
 * Generates customer ledger between two dates.
 *
 * Includes:
 *  - Opening Balance (CarryForward + previous Sales - previous Payments)
 *  - Sales within date range (Debit entries)
 *  - Payments within date range (Credit/Debit entries)
 *  - Running balance calculation
 *
 * @param {number} customerId
 * @param {string} startDate (YYYY-MM-DD)
 * @param {string} endDate (YYYY-MM-DD)
 *
 * @returns {
*   ledger: Array,
*   totalDebit: number,
*   totalCredit: number,
*   closingBalance: string
* }
*/
const getCustomerLedger = async (customerId, startDate, endDate) => {
 try {
   const startDateForQuery = moment(startDate)
     .startOf("day")
     .format("YYYY-MM-DD HH:mm:ss");

   const endDateForQuery = moment(endDate)
     .endOf("day")
     .format("YYYY-MM-DD HH:mm:ss");

   /* ============================================================
      1️⃣ GET OPENING BALANCE COMPONENTS
      ------------------------------------------------------------
      Opening Balance =
      (CarryForward Debit - CarryForward Credit)
      + Sales before start date
      - Payments Credit before start date
      + Payments Debit before start date
   ============================================================ */

   // Carry Forward totals before start date
   const [carryForwardRows] =
     await dbConnection.connection.promise().execute(
       `
       SELECT 
         SUM(Debit) AS CF_Debit,
         SUM(Credit) AS CF_Credit
       FROM CarryForward
       WHERE CustomerId = ?
         AND CarryForwardDate < ?
       `,
       [customerId, startDateForQuery]
     );

   // Sales total before start date
   const [salesBeforeRows] = await dbConnection.execute(
     `
     SELECT SUM(TotalValueWithTax) AS SalesTotal
     FROM Sales
     WHERE CustomerId = ?
       AND CreatedAt < ?
     `,
     [customerId, startDateForQuery]
   );

   // Payments before start date
   const [paymentsBeforeRows] =
     await dbConnection.connection.promise().execute(
       `
       SELECT 
         SUM(Credit) AS TotalCredit,
         SUM(Debit) AS TotalDebit
       FROM Payments
       WHERE CustomerId = ?
         AND PaymentDate < ?
       `,
       [customerId, startDateForQuery]
     );

   const cf = carryForwardRows[0] || {};
   const sb = salesBeforeRows[0] || {};
   const pb = paymentsBeforeRows[0] || {};

   const openingBalance =
     (Number(cf.CF_Debit) || 0) -
     (Number(cf.CF_Credit) || 0) +
     (Number(sb.SalesTotal) || 0) -
     (Number(pb.TotalCredit) || 0) +
     (Number(pb.TotalDebit) || 0);

   /* ============================================================
      2️⃣ FETCH LEDGER ENTRIES WITHIN DATE RANGE
      ------------------------------------------------------------
      Includes:
      - Sales (always Debit)
      - Payments (Credit or Debit)
      Also returns PaymentNo and PaymentType for clarity.
   ============================================================ */

   const [ledgerEntries] = await dbConnection.execute(
     `
     SELECT 
       'Sale' AS Type,
       InvoiceId,
       NULL AS PaymentNo,
       NULL AS PaymentType,
       MIN(CreatedAt) AS Date,
       SUM(TotalValueWithTax) AS Amount,
       'DR' AS EntryType
     FROM Sales
     WHERE CustomerId = ?
       AND CreatedAt BETWEEN ? AND ?
     GROUP BY InvoiceId

     UNION ALL

     SELECT
       'Payment' AS Type,
       NULL AS InvoiceId,
       PaymentNo,
       PaymentType,
       PaymentDate AS Date,
       Credit AS Amount,
       'CR' AS EntryType
     FROM Payments
     WHERE CustomerId = ?
       AND PaymentDate BETWEEN ? AND ?
       AND Credit > 0

     UNION ALL

     SELECT
       'Payment' AS Type,
       NULL AS InvoiceId,
       PaymentNo,
       PaymentType,
       PaymentDate AS Date,
       Debit AS Amount,
       'DR' AS EntryType
     FROM Payments
     WHERE CustomerId = ?
       AND PaymentDate BETWEEN ? AND ?
       AND Debit > 0

     ORDER BY Date ASC
     `,
     [
       customerId,
       startDateForQuery,
       endDateForQuery,
       customerId,
       startDateForQuery,
       endDateForQuery,
       customerId,
       startDateForQuery,
       endDateForQuery,
     ]
   );

   /* ============================================================
      3️⃣ BUILD LEDGER WITH RUNNING BALANCE
   ============================================================ */

   let runningBalance = openingBalance;
   const ledger = [];

   // Opening Balance Row
   ledger.push({
     Date: moment(startDate)
       .subtract(1, "day")
       .format("DD-MM-YYYY HH:mm:ss"),
     Description: "Opening Balance",
     PaymentNo: "",
     PaymentType: "",
     Debit: runningBalance > 0 ? runningBalance : 0,
     Credit: runningBalance < 0 ? Math.abs(runningBalance) : 0,
     Balance:
       Math.abs(runningBalance).toFixed(2) +
       (runningBalance >= 0 ? " DR" : " CR"),
   });

   // Process each transaction row
   ledgerEntries.forEach((row) => {
     const amount = Number(row.Amount || 0);

     if (row.EntryType === "DR") {
       runningBalance += amount;
     } else if (row.EntryType === "CR") {
       runningBalance -= amount;
     }

     // Construct readable description
     let description = "";
     if (row.Type === "Sale") {
       description = `Sale - ${row.InvoiceId}`;
     } else if (row.Type === "Payment") {
       description = `Payment - ${row.PaymentNo} (${row.PaymentType})`;
     }

     ledger.push({
       Date: moment(row.Date).format("DD-MM-YYYY HH:mm:ss"),
       Description: description,
       PaymentNo: row.PaymentNo || "",
       PaymentType: row.PaymentType || "",
       Type:row.Type,
       InvoiceId:row.InvoiceId,
       Debit: row.EntryType === "DR" ? amount : 0,
       Credit: row.EntryType === "CR" ? amount : 0,
       Balance:
         Math.abs(runningBalance).toFixed(2) +
         (runningBalance >= 0 ? " DR" : " CR"),
     });
   });

   /* ============================================================
      4️⃣ CALCULATE TOTALS & CLOSING BALANCE
   ============================================================ */

   const totalDebit = ledger.reduce(
     (sum, row) => sum + Number(row.Debit || 0),
     0
   );

   const totalCredit = ledger.reduce(
     (sum, row) => sum + Number(row.Credit || 0),
     0
   );

   const closingBalance =
     Math.abs(runningBalance).toFixed(2) +
     (runningBalance >= 0 ? " Dr" : " Cr");

   return {
     ledger,
     totalDebit: Number(totalDebit.toFixed(2)),
     totalCredit: Number(totalCredit.toFixed(2)),
     closingBalance,
   };
 } catch (error) {
   throw error;
 }
};

/**
 * 
 * @param {*} supplierId 
 * @param {*} startDate 
 * @param {*} endDate 
 * @returns array of object
 * 
 */
const getSupplierLedger = async (supplierId, startDate, endDate) => {
   // const connection = await dbConnection.pool.getConnection();
    try {
      // 1. Carry Forward Entries before the selected start date
      const [carryForwardRows] = await dbConnection.execute(
        `
        SELECT 
          SUM(Debit) AS CF_Debit, 
          SUM(Credit) AS CF_Credit 
        FROM CarryForwardTableForSupplier 
        WHERE SupplierId = ? AND CarryForwardDate < ?
        `,
        [supplierId, startDate]
      );
  
      // 2. Purchases before start date (treated as debit)
      const [salesBeforeRows] = await dbConnection.execute(
        `
        SELECT SUM(TotalAmountWithTax) AS SalesTotal
        FROM PurchaseOrders
        WHERE SupplierId = ? AND OrderDate < ?
        `,
        [supplierId, startDate]
      );
  
      // 3. Payments before start date (credits and any advance payments)
      const [paymentsBeforeRows] = await dbConnection.execute(
        `
        SELECT 
          SUM(Credit) AS TotalCredit,
          SUM(Debit) AS TotalDebit
        FROM PaymentsToSupplier
        WHERE SupplierId = ? AND PaymentDate < ?
        `,
        [supplierId, startDate]
      );
  
      // 4. All ledger entries within the selected date range
      const [ledgerEntries] = await dbConnection.execute(
        `
        SELECT 'Purchase' AS Type, OrderDate AS Date,PoDate, TotalAmountWithTax AS Amount, 'DR' AS EntryType
        FROM PurchaseOrders
        WHERE SupplierId = ? AND OrderDate BETWEEN ? AND ?
  
        UNION ALL
  
        SELECT 'Payment', PaymentDate AS Date,NULL AS PoDate, Credit AS Amount, 'CR' AS EntryType
        FROM PaymentsToSupplier
        WHERE SupplierId = ? AND PaymentDate BETWEEN ? AND ? AND Credit > 0
  
        UNION ALL
  
        SELECT 'Payment', PaymentDate AS Date,NULL AS PoDate, Debit AS Amount, 'DR' AS EntryType
        FROM PaymentsToSupplier
        WHERE SupplierId = ? AND PaymentDate BETWEEN ? AND ? AND Debit > 0
  
        ORDER BY Date ASC
        `,
        [
          supplierId, startDate, endDate,
          supplierId, startDate, endDate,
          supplierId, startDate, endDate
        ]
      );
      // Calculate opening balance
      const cf = carryForwardRows[0] || {};
      const sb = salesBeforeRows[0] || {};
      const pb = paymentsBeforeRows[0] || {};
  
      const openingBalance =
        (Number(cf.CF_Debit) || 0) -
        (Number(cf.CF_Credit) || 0) +
        (Number(sb.SalesTotal) || 0) -
        (Number(pb.TotalCredit) || 0) +
        (Number(pb.TotalDebit) || 0);
  
      let runningBalance = openingBalance;
      const ledger = [];
  
      // 5. Push opening balance entry
      ledger.push({
        Date: moment(startDate).subtract(1, 'day').format('DD-MM-YYYY'),
        Description: 'Opening Balance',
        Debit: runningBalance > 0 ? Number(runningBalance) : 0,
        Credit: runningBalance < 0 ? Math.abs(Number(runningBalance)) : 0,
        Balance:
          Math.abs(Number(runningBalance)).toFixed(2) +
          (runningBalance >= 0 ? ' DR' : ' CR'),
      });
  
      // 6. Process actual ledger transactions
       ledgerEntries.forEach((row) => {
        const amount = Number(row.Amount || 0);
        if (row.EntryType === 'DR') {
          runningBalance += amount;
        } else if (row.EntryType === 'CR') {
          runningBalance -= amount;
        }
  
        ledger.push({
          Date: moment(row.Date).format('DD-MM-YYYY'),
          PoDate:moment(row.PoDate).format('DD-MM-YYYY'),
          Description: row.Type,
          Debit: row.EntryType === 'DR' ? amount : 0,
          Credit: row.EntryType === 'CR' ? amount : 0,
          Balance:
            !isNaN(runningBalance)
              ? Math.abs(runningBalance).toFixed(2) + (runningBalance >= 0 ? ' DR' : ' CR')
              : 'Error',
        });
      });

     /* ledgerEntries.forEach((row) => {
        const amount = Number(row.Amount || 0);
      
        if (row.EntryType === 'DR') {
          runningBalance += amount;
        } else if (row.EntryType === 'CR') {
          runningBalance -= amount;
        }
      
        // 👉 Description with Purchase + Invoice No
        let description;
      
        if (row.Type === 'Purchase') {
          // If invoice no exists: "Purchase - INV123"
          // If not: just "Purchase"
          description = row.SupplierInvoiceNo
            ? `Purchase - ${row.SupplierInvoiceNo}`
            : 'Purchase';
        } else {
          description = 'Payment';
        }
      
        ledger.push({
          Date: moment(row.Date).format('DD-MM-YYYY HH:mm:ss'),
          Description: description,
          Debit: row.EntryType === 'DR' ? amount : 0,
          Credit: row.EntryType === 'CR' ? amount : 0,
          Balance: !isNaN(runningBalance)
            ? Math.abs(runningBalance).toFixed(2) +
              (runningBalance >= 0 ? ' DR' : ' CR')
            : 'Error',
        });
      });*/
      
  
      // 7. Final totals
      const totalDebit = ledger.reduce((sum, row) => sum + Number(row.Debit || 0), 0);
      const totalCredit = ledger.reduce((sum, row) => sum + Number(row.Credit || 0), 0);
      const closingBalance =
        Math.abs(runningBalance).toFixed(2) + (runningBalance >= 0 ? ' Dr' : ' Cr');
  
      return {
        ledger,
        totalDebit: Number(totalDebit.toFixed(2)),
        totalCredit: Number(totalCredit.toFixed(2)),
        closingBalance,
      };
    } catch (error) {
      throw error;
    } finally {
      //connection.release();
    }
  };
  
  
const getPrintSaleData= async(customerId,invoiceId)=>{
    try {
       /* const salesQuery=`SELECT 
                                c.CustomerName ,
                                sl.CustomerId,
                                p.ProductName,
                                p.Hsn,
                                stk.BatchNumber,
                                DATE_FORMAT(stk.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
                                stk.Id AS StockId,
                                sl.QuantitySold,
                                sl.SalePrice,
                                sl.sgst,
                                sl.cgst,
                                sl.SgstAmount,
                                sl.CgstAmount,
                                sl.TotalValue,
                                sl.TotalValueWithTax,
                                sl.CreatedAt,
                                sl.Id
                            FROM 
                                Sales sl
                            INNER JOIN 
                                Customers c ON sl.CustomerId = c.Id
                            INNER JOIN 
                                Stock stk ON sl.StockId = stk.Id
                            INNER JOIN 
                                Products p ON stk.ProductId = p.Id
                            WHERE 
                                sl.CustomerId = ?
                            AND sl.InvoiceId = ?`;*/
            const salesQuery=`SELECT 
                                    c.CustomerName,
                                    sl.CustomerId,
                                    p.ProductName,
                                    p.Hsn,
                                    p.KnownAs,
                                    stk.BatchNumber,
                                    DATE_FORMAT(stk.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
                                    stk.Id AS StockId,
                                    sl.QuantitySold,
                                    sl.SalePrice,
                                    sl.sgst,
                                    sl.cgst,
                                    sl.SgstAmount,
                                    sl.CgstAmount,
                                    sl.TotalValue,
                                    sl.TotalValueWithTax,
                                    sl.CreatedAt,
                                    sl.Id AS SaleId,
                                    inv.Id AS InvoiceId,
                                    inv.PurchaseOrderId,
                                    pod.MRP

                                FROM 
                                    Sales sl
                                INNER JOIN 
                                    Customers c ON sl.CustomerId = c.Id
                                INNER JOIN 
                                    Stock stk ON sl.StockId = stk.Id
                                INNER JOIN 
                                    Products p ON stk.ProductId = p.Id
                                INNER JOIN 
                                    Invoices inv ON stk.InvoiceId = inv.Id
                                INNER JOIN 
                                    PurchaseOrderDetails pod ON inv.PurchaseOrderId = pod.PurchaseOrderId AND pod.ProductId = p.Id
                                WHERE 
                                    sl.CustomerId = ?
                                    AND sl.InvoiceId = ?;`
                            console.log(mysql.format(salesQuery,[customerId,invoiceId]))
        const [rows]= await dbConnection.connection.promise().query(salesQuery,[customerId,invoiceId])
       // console.log(rows)
        return rows
    } catch (error) {
        throw error
    }
}

const getPrintTotalSaleData= async(customerId,invoiceId)=>{
    try {
        const query= `SELECT 
                            SUM(sl.SgstAmount) AS TotalSgstAmount,
                            SUM(sl.CgstAmount) AS TotalCgstAmount,
                            SUM(sl.TotalValue) AS TotalValue,
                            SUM(sl.TotalValueWithTax) AS TotalValueWithTax,
                            sl.InvoiceId,
                            MAX(sl.CreatedAt) AS CreatedAt
                        FROM 
                            Sales sl
                        WHERE 
                            sl.InvoiceId = ?
                        AND
                            sl.CustomerId=?
                        GROUP BY sl.InvoiceId;
                        `;
                            console.log(mysql.format(query,[invoiceId,customerId]))
        const [rows] = await dbConnection.connection.promise().query(query,[invoiceId,customerId])
        console.log(rows)
        return rows
                        
    } catch (error) {
        
        throw error
    }
}
/**
 * 
 * @param {*} customerId 
 * @returns object 
 */
const getCustomerDetails = async (customerId) => {
  try {
      //console.log('i m in  roro ro uiy y y y y y y y y r')
    const query = "SELECT * FROM Customers WHERE Id = ?";
    const [rows] = await dbConnection.execute(query, [customerId]);
    return rows.length ? rows[0] : null;
  } catch (error) {
    throw error;
  }
};


/*const createPurchasePo= async(req)=>{
    try {
        const{productId,supplierId,quantity,purchasePrice,igst,mrp}=req.body
        const totalValue=quantity*purchasePrice
        const igstAmount= totalValue*igst/100;
        const totalValueWithTax=totalValue + igstAmount
        // Get today's date in YYYY-MM-DD format
        const todayDate = moment().format('YYYY-MM-DD');
        //get all the count of invoice generated today
        const [result] = await dbConnection.connection.promise().query(`SELECT COUNT(DISTINCT InvoiceId) AS count FROM PurchasePo WHERE DATE(OrderedOn) = ?`, [todayDate]);
        const totalCount=result[0].count
        //generating invoiceId
        const formattedDate = moment().format('YYYYMMDD');
        console.log(formattedDate)
        console.log('formattedDate')
        const sequence = String(totalCount + 1).padStart(3, '0'); // Incremental number
        const invoiceId= `PUR-INV-${formattedDate}-${sequence}`;
        const purchaseQuery=`Insert Into PurchasePo(ProductId,InvoiceId,SupplierId,Quantity,PurchasePrice,Igst,IgstAmount,TotalValue,TotalValueWithTax,MRP) VALUES (?,?,?,?,?,?,?,?,?,?)`
        console.log(mysql.format(purchaseQuery,[productId,invoiceId,supplierId,quantity,purchasePrice,igst,igstAmount,totalValue,totalValueWithTax]))
        const [rows]= await dbConnection.connection.promise().query(purchaseQuery,[productId,invoiceId,supplierId,quantity,purchasePrice,igst,igstAmount,totalValue,totalValueWithTax,mrp])
        return invoiceId

        
    } catch (error) {
        throw error
    }
}*/


const createPurchasePo = async (req) => {
    const connection = await dbConnection.pool.promise().getConnection();

    try {
        await connection.beginTransaction();
        const { supplierId, productId, quantity, purchasePrice, igst, mrp, purchasePoDate } = req.body;
        //my sql supports date in YYYY-MM-DD format 
        const poDate= moment(purchasePoDate,"DD-MM-YYYY").format("YYYY-MM-DD")
        console.log(req.body);
        
        // Initialize total amount
        let totalAmountWithTax = 0;
        let productMap = new Map();
        
        // **Step 1: Group products by productId, purchasePrice, and IGST**
        for (let i = 0; i < productId.length; i++) {
            let key = `${productId[i]}_${purchasePrice[i]}_${igst[i]}`; // Unique key for grouping
        
            // Convert to numbers to avoid string concatenation issues
            let qty = Number(quantity[i]);
            let price = Number(purchasePrice[i]);
            let igstPercentage = Number(igst[i]);
            let itemTotal = qty * price; // Base amount
            let igstAmount = (itemTotal * igstPercentage) / 100;  // IGST calculation
        
            totalAmountWithTax += itemTotal + igstAmount; // Accumulate total amount
        
            if (productMap.has(key)) {
                // If product already exists, update quantity and recalculate IGST
                let existingProduct = productMap.get(key);
                existingProduct.quantity += qty; // Add quantity
                existingProduct.totalPrice += itemTotal; // Add total price
                existingProduct.totalIgst = (existingProduct.totalPrice * igstPercentage) / 100; // Recalculate IGST
            } else {
                // Otherwise, store product details
                productMap.set(key, {
                    productId: Number(productId[i]), // Convert to number
                    quantity: qty,
                    purchasePrice: price,
                    mrp: Number(mrp[i]), // Convert to number
                    igst: igstPercentage,
                    totalPrice: itemTotal, // Store total price
                    totalIgst: igstAmount  // Store IGST
                });
            }
        }
        console.log(productMap)
        // **Step 2: Convert map to an array for batch insert**
        let values = Array.from(productMap.values()).map(item => [
            item.productId,
            item.quantity,
            item.purchasePrice,
            item.mrp,
            item.igst,
           // item.totalIgst,
           // item.totalPrice, // Correct IGST for final quantity
            item.quantity   // Remaining quantity (same as total quantity initially)
        ]);


        //generate invoice no 
        let invoiceNo = await generatePurchaseInvoiceNumber();

       // console.log(invoiceNo)
        console.log( ` Insert into PurchaseOrders`)

         // Insert into PurchaseOrders
       // Insert into PurchaseOrders
       console.log('1st query')
       // console.log(mysql.format(insertQuery,flattenedValues))

        const query = `INSERT INTO PurchaseOrders (SupplierId,PurchaseInvoiceNo, OrderDate, TotalAmountWithTax, Status, PoDate) VALUES (?,?, NOW(), ?, 'Pending', ?)`;
        console.log(mysql.format(query,[supplierId,invoiceNo, totalAmountWithTax]))
        const [poResult] = await connection.query(query, [supplierId,invoiceNo,totalAmountWithTax,poDate]);
        const purchaseOrderId = poResult.insertId;
        console.log('purchase', purchaseOrderId )
        console.log(values)
        // Batch Insert into PurchaseOrderDetails
        const insertQuery = `
            INSERT INTO PurchaseOrderDetails 
            (PurchaseOrderId, ProductId, Quantity, PurchasePrice, MRP, IGSTPercentage, RemainingQuantity) 
            VALUES ?
        `;

        // Ensure each row has PurchaseOrderId and keep the array structured correctly
        const finalValues = values.map(row => [purchaseOrderId, ...row]);
        console.log(mysql.format(insertQuery, [finalValues]));

        // Execute Query
        await connection.query(insertQuery, [finalValues]);

                await connection.commit();
                console.log('Purchase Order Created Successfully');
                return purchaseOrderId;

    } catch (error) {
        await connection.rollback();
        console.error('Error Creating Purchase Order:', error.message);
        throw error
    } finally {
        connection.release();
    }
};

// Function to generate purchase invoice number
const generatePurchaseInvoiceNumber = async () => {
    const formattedDate = moment().format('YYYYMMDD');  // Get current date in YYYYMMDD format
    console.log(formattedDate);

    // Fetch the total count of invoices created today from the database
    const query = `SELECT COUNT(*) AS count FROM PurchaseOrders WHERE DATE(OrderDate) = CURDATE()`;
    const [result] = await dbConnection.connection.promise().execute(query);
    
    const totalCount = result[0].count || 0;  // Get total count of invoices for today

    const sequence = String(totalCount + 1).padStart(3, '0'); // Increment count with padding
    const invoiceId = `PUR-INV-${formattedDate}-${sequence}`;

    console.log('Generated Invoice ID:', invoiceId);
    return invoiceId;
};
/**
 * 
 * @param {*} purchaseOrderId 
 * @returns purchase order details
 * using this function at billing controller
 * 1.createPurchasePo
 * 2.getReceivePurchaseOrderPage
 */
const getTotalPurchasePoDetails= async(purchaseOrderId)=>{
    try {
        const query =`SELECT 
                            po.Id AS PurchaseOrderId,
                            po.PurchaseInvoiceNo,
                            po.TotalAmountWithTax,
                            po.OrderDate,
                            po.Status,
                            po.SupplierId,
                            s.Name AS SupplierName,
                            pod.ProductId,
                            p.ProductName,
                            pod.Quantity,
                            pod.PurchasePrice,
                            pod.MRP,
                            pod.IGSTPercentage,
                            pod.IGSTAmount,
                            pod.TotalAmount,
                            pod.RemainingQuantity
                        FROM PurchaseOrders po
                        JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
                        JOIN Products p ON pod.ProductId = p.Id
                        JOIN Suppliers s ON po.SupplierId = s.Id
                        WHERE po.Id = ?;`
        const [rows]= await dbConnection.connection.promise().query(query,[purchaseOrderId])
        return rows;
    } catch (error) {
        throw error
    }
}

const getTotalPurchasePoAmount= async(purchaseOrderId)=>{
    try {
        const query=`SELECT 
                            SUM(PurchaseOrderDetails.IGSTAmount) AS IgstAmount,
                            SUM(PurchaseOrderDetails.TotalAmount) AS TotalValue,
                            SUM(PurchaseOrderDetails.IGSTAmount + PurchaseOrderDetails.TotalAmount) AS TotalValueWithTax,
                            PurchaseOrders.PurchaseInvoiceNo,
                            PurchaseOrders.OrderDate
                        FROM 
                            PurchaseOrderDetails
                        JOIN
                            PurchaseOrders
                        ON
                            PurchaseOrders.Id=PurchaseOrderDetails.PurchaseOrderId 
                        WHERE 
                            PurchaseOrderDetails.PurchaseOrderId = ?;`
        const [rows]= await dbConnection.connection.promise().query(query,[purchaseOrderId])
         return rows;
    } catch (error) {
        throw error
    }
}


const getPurchasePoListForReceivingTheOrder= async(filters)=>{
    try {
        const { PurchaseInvoiceNo, Supplier, FromDate, ToDate } = filters;

       // const body = req.body && typeof req.body === "object" ? req.body : {};
        const fromDate = FromDate ? helper.parseDate(FromDate) : moment().format("YYYY-MM-DD HH:mm:ss");
        const toDate = ToDate ? helper.parseDate(ToDate) : moment().format("YYYY-MM-DD HH:mm:ss");

        console.log("From Date:", fromDate);
        console.log("To Date:", toDate);
        console.log("check purchase po");

        if (!helper.compareDateForSearch(fromDate, toDate)) {
            throw new Error(`Invalid date range. "From Date" should be less than or equal to "To Date".`);
        }
        const query = `SELECT 
                            po.Id AS PurchaseOrderId,
                            po.PurchaseInvoiceNo,
                            po.SupplierId,
                            DATE_FORMAT(po.PoDate, '%d-%m-%Y') AS PurchasePoDate,
                            s.Name AS SupplierName,
                            DATE_FORMAT(po.OrderDate, '%d-%m-%Y') AS OrderDate,
                            po.TotalAmountWithTax,
                            po.Status,
                            pod.ProductId,
                            p.ProductName,
                            pod.Quantity,
                            pod.PurchasePrice,
                            pod.MRP,
                            pod.IGSTPercentage,
                            pod.IGSTAmount,
                            pod.RemainingQuantity,
                            pod.TotalAmount AS ProductTotalAmount
                        FROM 
                            PurchaseOrders po
                        JOIN 
                            Suppliers s ON po.SupplierId = s.Id
                        JOIN 
                            PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
                        JOIN 
                            Products p ON pod.ProductId = p.Id
                        WHERE 
                            (po.PurchaseInvoiceNo = ? OR ? IS NULL)
                            AND (po.SupplierId = ? OR ? IS NULL)
                            AND (
                                (? IS NULL OR ? IS NULL) 
                                OR (po.OrderDate BETWEEN ? AND ?)
                            )
                        ORDER BY 
                            po.OrderDate DESC;
                        `

    const values = [PurchaseInvoiceNo, PurchaseInvoiceNo,Supplier, Supplier,fromDate, toDate, fromDate, toDate];
    console.log("Executing Query in search:", mysql.format(query, values));

    console.log('in purchase po search ')

    const [results] = await dbConnection.connection.promise().execute(query, values);
    return results

    } catch (error) {
        console.log(error)
        throw error
    }
}

/**
 * getPurchasePoList
 * -----------------
 * Fetches Purchase Orders along with their products and dynamically calculates
 * product-level and PO-level receiving status.
 *
 * Key Features:
 * 1. Supports MULTIPLE products per Purchase Order.
 * 2. Handles PARTIAL receiving of products correctly.
 * 3. Derives product status dynamically:
 *    - Pending             → ReceivedQty = 0
 *    - Partially Received  → 0 < ReceivedQty < OrderedQty
 *    - Received            → ReceivedQty === OrderedQty
 * 4. Derives PO status dynamically based on ALL products:
 *    - Pending             → No product received
 *    - Partially Received  → Some products received
 *    - Received            → All products fully received
 *
 * IMPORTANT:
 * - PO status is NOT trusted from PurchaseOrders table.
 * - Status is calculated at runtime using OrderedQty and RemainingQuantity.
 *
 * Returned Data Structure:
 * [
 *   {
 *     PurchaseOrderId,
 *     PurchaseInvoiceNo,
 *     SupplierName,
 *     OrderDate,
 *     PurchasePoDate,
 *     SupplierInvoiceNo,
 *     POStatus,
 *     TotalOrderedQty,
 *     TotalReceivedQty,
 *     Products: [
 *       {
 *         ProductId,
 *         ProductName,
 *         OrderedQty,
 *         ReceivedQty,
 *         RemainingQty,
 *         Status
 *       }
 *     ]
 *   }
 * ]
 *
 * @param {Object} filters
 * @param {string|null} filters.PurchaseInvoiceNo - Filter by PO invoice number
 * @param {number|null} filters.Supplier - Supplier ID
 * @param {string|null} filters.FromDate - Start date (dd-mm-yyyy)
 * @param {string|null} filters.ToDate - End date (dd-mm-yyyy)
 *
 * @returns {Promise<Array>} Array of grouped Purchase Orders with products and statuses
 *
 * @throws {Error} If date range is invalid or query execution fails
 */
const getPurchasePoList = async (filters) => {
    try {

        console.log(filters);
        console.log('tretetetetetetet')
      const { PurchaseInvoiceNo, Supplier, FromDate, ToDate } = filters;
        
      const fromDate = FromDate ? helper.parseDate(FromDate) : moment().format("YYYY-MM-DD HH:mm:ss");
      const toDate = ToDate ? helper.parseDate(ToDate) : moment().format("YYYY-MM-DD HH:mm:ss");

      console.log('test 23333')

      if (fromDate && toDate && !helper.compareDateForSearch(fromDate, toDate)) {
        throw new Error('Invalid date range.');
      }
  console.log('test45454')
      const query = `
        SELECT 
          po.Id AS PurchaseOrderId,
          po.PurchaseInvoiceNo,
          DATE_FORMAT(po.PoDate, '%d-%m-%Y') AS PurchasePoDate,
          po.SupplierId,
          s.Name AS SupplierName,
          DATE_FORMAT(po.OrderDate, '%d-%m-%Y') AS OrderDate,
  
          pod.ProductId,
          p.ProductName,
          pod.Quantity AS OrderedQty,
          pod.RemainingQuantity,
  
          i.SupplierInvoiceNo
  
        FROM PurchaseOrders po
        JOIN Suppliers s ON po.SupplierId = s.Id
        JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
        JOIN Products p ON pod.ProductId = p.Id
        LEFT JOIN (
          SELECT PurchaseOrderId, SupplierInvoiceNo
          FROM Invoices
          WHERE Id IN (SELECT MAX(Id) FROM Invoices GROUP BY PurchaseOrderId)
        ) i ON i.PurchaseOrderId = po.Id
  
        WHERE 
          (? IS NULL OR po.PurchaseInvoiceNo = ?)
          AND (? IS NULL OR po.SupplierId = ?)
          AND (
            (? IS NULL OR ? IS NULL)
            OR (po.OrderDate BETWEEN ? AND ?)
          )
  
        ORDER BY po.OrderDate DESC, po.Id, pod.ProductId;
      `;
  
      const values = [
        PurchaseInvoiceNo, PurchaseInvoiceNo,
        Supplier, Supplier,
        fromDate, toDate, fromDate, toDate
      ];
  console.log(values);
  console.log(mysql.format(query,values));
  console.log('passed')
      const [rows] = await dbConnection.connection.promise().execute(query, values);
  
      const grouped = {};
  
      rows.forEach(row => {
        if (!grouped[row.PurchaseOrderId]) {
          grouped[row.PurchaseOrderId] = {
            PurchaseOrderId: row.PurchaseOrderId,
            PurchaseInvoiceNo: row.PurchaseInvoiceNo,
            SupplierId: row.SupplierId,
            SupplierName: row.SupplierName,
            OrderDate: row.OrderDate,
            PurchasePoDate: row.PurchasePoDate,
            SupplierInvoiceNo: row.SupplierInvoiceNo,
  
            TotalOrderedQty: 0,
            TotalReceivedQty: 0,
            Products: []
          };
        }
  
        const receivedQty = row.OrderedQty - row.RemainingQuantity;
  
        let productStatus = 'Pending';
        if (receivedQty === 0) productStatus = 'Pending';
        else if (receivedQty < row.OrderedQty) productStatus = 'Partially Received';
        else productStatus = 'Received';
  
        grouped[row.PurchaseOrderId].Products.push({
          ProductId: row.ProductId,
          ProductName: row.ProductName,
          OrderedQty: row.OrderedQty,
          ReceivedQty: receivedQty,
          RemainingQty: row.RemainingQuantity,
          Status: productStatus
        });
  
        grouped[row.PurchaseOrderId].TotalOrderedQty += row.OrderedQty;
        grouped[row.PurchaseOrderId].TotalReceivedQty += receivedQty;
      });
  
      Object.values(grouped).forEach(po => {
        if (po.TotalReceivedQty === 0) po.POStatus = 'Pending';
        else if (po.TotalReceivedQty < po.TotalOrderedQty) po.POStatus = 'Partially Received';
        else po.POStatus = 'Received';
      });
  
      return Object.values(grouped);
  
    } catch (error) {
      console.error('Error in getPurchasePoList:', error);
      throw error;
    }
  };
  

  /*const getPurchasePoList = async (filters) => {
    try {
      const { PurchaseInvoiceNo, Supplier, FromDate, ToDate } = filters;
  
      const fromDate = FromDate ? helper.parseDate(FromDate) : moment().format("YYYY-MM-DD");
      const toDate = ToDate ? helper.parseDate(ToDate) : moment().format("YYYY-MM-DD");
  
      if (!helper.compareDateForSearch(fromDate, toDate)) {
        throw new Error(`Invalid date range.`);
      }
  
      const query = `
        SELECT 
          po.Id AS PurchaseOrderId,
          po.PurchaseInvoiceNo,
          DATE_FORMAT(po.PoDate, '%d-%m-%Y') AS PurchasePoDate,
          po.SupplierId,
          s.Name AS SupplierName,
          DATE_FORMAT(po.OrderDate, '%d-%m-%Y') AS OrderDate,
          po.TotalAmountWithTax,
          po.Status,
          pod.ProductId,
          p.ProductName,
          pod.Quantity,
          pod.PurchasePrice,
          pod.Status,
          pod.MRP,
          pod.IGSTPercentage,
          pod.IGSTAmount,
          pod.RemainingQuantity,
          pod.TotalAmount AS ProductTotalAmount,
          i.SupplierInvoiceNo
        FROM 
          PurchaseOrders po
        JOIN 
          Suppliers s ON po.SupplierId = s.Id
        JOIN 
          PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
        JOIN 
          Products p ON pod.ProductId = p.Id
        LEFT JOIN (
          SELECT PurchaseOrderId, SupplierInvoiceNo
          FROM invoices
          WHERE Id IN (
            SELECT MAX(Id) FROM invoices GROUP BY PurchaseOrderId
          )
        ) i ON i.PurchaseOrderId = po.Id
        WHERE 
          (po.PurchaseInvoiceNo = ? OR ? IS NULL)
          AND (po.SupplierId = ? OR ? IS NULL)
          AND (
            (? IS NULL OR ? IS NULL) 
            OR (po.OrderDate BETWEEN ? AND ?)
          )
        ORDER BY 
          po.OrderDate DESC, po.PurchaseInvoiceNo, pod.ProductId;
      `;
  
      const values = [
        PurchaseInvoiceNo, PurchaseInvoiceNo,
        Supplier, Supplier,
        fromDate, toDate, fromDate, toDate
      ];
  
      const [results] = await dbConnection.connection.promise().execute(query, values);
  
      // Group results by PurchaseInvoiceNo
      const groupedResults = {};
      results.forEach(row => {
        if (!groupedResults[row.PurchaseInvoiceNo]) {
          groupedResults[row.PurchaseInvoiceNo] = {
            PurchaseOrderId: row.PurchaseOrderId,
            SupplierId: row.SupplierId,
            SupplierName: row.SupplierName,
            OrderDate: row.OrderDate,
            Status: row.Status,
            PurchaseInvoiceNo: row.PurchaseInvoiceNo,
            SupplierInvoiceNo: row.SupplierInvoiceNo,
            PurchasePoDate: row.PurchasePoDate,
            Products: []
          };
        }
  
        groupedResults[row.PurchaseInvoiceNo].Products.push({
          ProductId: row.ProductId,
          ProductName: row.ProductName,
          Quantity: row.Quantity,
          PurchasePrice: row.PurchasePrice,
          MRP: row.MRP,
          IGSTPercentage: row.IGSTPercentage,
          IGSTAmount: row.IGSTAmount,
          RemainingQuantity: row.RemainingQuantity,
          ProductTotalAmount: row.ProductTotalAmount
        });
      });
  
      return Object.values(groupedResults); // return as array of grouped objects
  
    } catch (error) {
      console.error("Error in getPurchasePoList:", error.message);
      throw error;
    }
  };
  


const generateInvoiceEs = async (req) => {
    const connection = await dbConnection.pool.getConnection();

    try {
        await connection.beginTransaction();

        const { purchaseOrderId, supplierInvoiceNo, products, invoicePoDate} = req.body;
        //my sql accepts Date in YYYY-MM-DD format
        const formattedInvoiceDate = moment(invoicePoDate,"DD-MM-YYYY").format("YYYY-MM-DD")
        console.log('start tango')
        console.log(products)

        console.log('tango ')
        
        // Fetch Ordered Products & Remaining Quantities
        const [orderedProducts] = await connection.execute(`SELECT 
                                                                    ProductId, Quantity, PurchasePrice, IGSTPercentage, RemainingQuantity
                                                                FROM 
                                                                    PurchaseOrderDetails
                                                                WHERE 
                                                                    PurchaseOrderId = ?`, [purchaseOrderId]);

        const orderedMap = new Map();
        orderedProducts.forEach(({ ProductId, Quantity, PurchasePrice, IGSTPercentage, RemainingQuantity }) => {
            orderedMap.set(Number(ProductId), { 
                orderedQuantity: Quantity, 
                remainingQuantity: RemainingQuantity, 
                purchasePrice: PurchasePrice, 
                igstPercentage: IGSTPercentage 
            });
        });
console.log(orderedMap);
console.log('i m in ordered mal')
        // Insert Invoice
        const insertInvoiceQuery = ` 
            INSERT INTO Invoices (PurchaseOrderId, SupplierInvoiceNo, InvoiceDate, TotalAmount, Status, ReceivedBy) 
            VALUES (?, ?, ? , 0, 'Pending', ?)`;

        const [invoiceResult] = await connection.execute(insertInvoiceQuery, [purchaseOrderId, supplierInvoiceNo, formattedInvoiceDate, req.user.Id]);

        const invoiceId = invoiceResult.insertId;
        let totalInvoiceAmount = 0;
        let allProductsReceived = true; // Flag to track if all products are fully received

        // Prepare Invoice Details
        const invoiceValues = products.map(({ productId, receivedQuantity}) => {
            const numericProductId = Number(productId);

            if (!orderedMap.has(numericProductId)) {
                throw new Error(`Product ID ${productId} not found in Purchase Order`);
            }

            const { orderedQuantity, remainingQuantity, purchasePrice, igstPercentage } = orderedMap.get(numericProductId);

            if (receivedQuantity > remainingQuantity) {
                throw new Error(`Received quantity (${receivedQuantity}) exceeds remaining quantity (${remainingQuantity}) for Product ID ${productId}`);
            }

            const totalAmount = receivedQuantity * purchasePrice;
            const igstAmount = (totalAmount * igstPercentage) / 100;
            totalInvoiceAmount += totalAmount + igstAmount;

            // Calculate new remaining quantity
            console.log(remainingQuantity)

            console.log(receivedQuantity);
            const newRemainingQuantity = remainingQuantity - receivedQuantity;
            if (newRemainingQuantity > 0) {
                allProductsReceived = false;
            }

            // Update `RemainingQuantity` in `PurchaseOrderDetails`
            orderedMap.set(numericProductId, {
                ...orderedMap.get(numericProductId),
                remainingQuantity: newRemainingQuantity
            });

            return [invoiceId, numericProductId, receivedQuantity, purchasePrice, igstPercentage, igstAmount, totalAmount];
        });

        // Insert Invoice Details
        await connection.query(`
            INSERT INTO InvoiceDetails (InvoiceId, ProductId, ReceivedQuantity, PurchasePrice, IGSTPercentage, IGSTAmount, TotalAmount)
            VALUES ?`, [invoiceValues]);

        // Update `RemainingQuantity` in `PurchaseOrderDetails`
        for (const { productId, receivedQuantity } of products) {
            await connection.execute(`UPDATE PurchaseOrderDetails  SET RemainingQuantity = RemainingQuantity - ? 
                                        WHERE PurchaseOrderId = ? AND ProductId = ?`, 
                                        [receivedQuantity, purchaseOrderId, productId]
            );
        }

        // Update Total Invoice Amount in Invoices table
        await connection.execute("UPDATE Invoices SET TotalAmount = ? WHERE Id = ?", [totalInvoiceAmount, invoiceId]);

        // If all products are received, mark `PurchaseOrders` as "Completed"
        if (allProductsReceived) {
            await connection.execute(`UPDATE PurchaseOrders SET Status = 'Received' WHERE Id = ?`, [purchaseOrderId]);
        }


            // Insert into Stock & Log Transactions
for (const { productId, receivedQuantity, batchNumber, expiryDate, supplierId, mfgDate, freeQuantity } of products) {

    // Insert or Update Stock Table (total = paid + free)
    const totalQty = Number(receivedQuantity) + Number((freeQuantity || 0));

    const stockQuery = `
        INSERT INTO Stock (ProductId, BatchNumber, ExpiryDate, Quantity, SupplierId, InvoiceId, CreatedAt, MfgDate)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
        ON DUPLICATE KEY UPDATE 
            Quantity = Quantity + VALUES(Quantity), 
            ExpiryDate = VALUES(ExpiryDate),
            MfgDate = VALUES(MfgDate)`;

    console.log('stock query');
    console.log(mysql.format(stockQuery, [
        productId,
        batchNumber,
        moment(expiryDate, "DD-MM-YYYY").format("YYYY-MM-DD"),
        totalQty,
        supplierId,
        invoiceId,
        moment(mfgDate, "DD-MM-YYYY").format("YYYY-MM-DD")
    ]));

    const [stockResult] = await connection.execute(stockQuery, [
        productId,
        batchNumber,
        moment(expiryDate, "DD-MM-YYYY").format("YYYY-MM-DD"),
        totalQty,
        supplierId,
        invoiceId,
        moment(mfgDate, "DD-MM-YYYY").format("YYYY-MM-DD")
    ]);

    const stockId = stockResult.insertId || (
        await connection.execute(
            `SELECT Id FROM stock WHERE ProductId = ? AND BatchNumber = ?`, 
            [productId, batchNumber]
        )
    )[0][0].Id;

    // Check if a new batch was added
    const isNewBatch = stockResult.affectedRows === 1;

    // Remarks
    const remarksPaid = isNewBatch 
        ? `New batch added Product ${productId} (Batch ${batchNumber}) from Invoice ${invoiceId}` 
        : `Restocked existing Product ${productId} (Batch ${batchNumber}) from Invoice ${invoiceId}`;

    const remarksFree = `Free stock added Product ${productId} (Batch ${batchNumber}) from Invoice ${invoiceId}`;

    // --- Transactions ---

    // Paid Quantity Transaction
    if (receivedQuantity > 0) {
        const txnPaidQuery = `
            INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Timestamp, Remarks)
            VALUES (?, 'ADD', ?, NOW(), ?)
        `;
        console.log(mysql.format(txnPaidQuery, [stockId, receivedQuantity, remarksPaid]));
        await connection.execute(txnPaidQuery, [stockId, receivedQuantity, remarksPaid]);
    }

    // Free Quantity Transaction
    if (freeQuantity && freeQuantity > 0) {
        const txnFreeQuery = `
            INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Timestamp, Remarks)
            VALUES (?, 'FREE_ADD', ?, NOW(), ?)
        `;
        console.log(mysql.format(txnFreeQuery, [stockId, freeQuantity, remarksFree]));
        await connection.execute(txnFreeQuery, [stockId, freeQuantity, remarksFree]);
    }
}

console.log('success')
        await connection.commit();
        return {message:'Purchase order updated successfully and stock recorded.',invoiceId:invoiceId}
    } catch (error) {
        await connection.rollback();
        console.error(error);
        throw error;
    } finally {
        connection.release();
    }
};
*/
const productNameCache = new Map();

/**
 * Fetches product name by product ID.
 * Uses transaction connection if provided, otherwise pooled connection.
 *
 * @param {*} productId
 * @param {*} connection (optional)
 * @returns {Promise<string|null>}
 */
const getProductName = async (productId, connection = null) => {
  try {
    if (productNameCache.has(productId)) {
      return productNameCache.get(productId);
    }

    const executor = connection
      ? connection
      : dbConnection.connection.promise();

    const [rows] = await executor.execute(
      'SELECT ProductName FROM Products WHERE Id = ?',
      [productId]
    );

    const productName = rows.length ? rows[0].ProductName : null;
    productNameCache.set(productId, productName);

    return productName;
  } catch (error) {
    throw error;
  }
};

/*const generateInvoice = async (req) => {
    const connection = await dbConnection.pool.getConnection();

    try {
        await connection.beginTransaction();

        const { purchaseOrderId, supplierInvoiceNo, products, invoicePoDate } = req.body;

        console.log(req.body);
        const formattedInvoiceDate = moment(invoicePoDate, "DD-MM-YYYY").format("YYYY-MM-DD");

       // console.log('products:' + products);

        // Fetch Ordered Products
        const [orderedProducts] = await connection.execute(`
            SELECT ProductId, Quantity, RemainingQuantity, PurchasePrice, IGSTPercentage
            FROM PurchaseOrderDetails
            WHERE PurchaseOrderId = ?
        `, [purchaseOrderId]);

        const orderedMap = new Map();
        orderedProducts.forEach(p => {
            orderedMap.set(Number(p.ProductId), p);
        });

        // Insert Invoice
        const [invoiceResult] = await connection.execute(`
            INSERT INTO Invoices (PurchaseOrderId, SupplierInvoiceNo, InvoiceDate, TotalAmount, Status, ReceivedBy)
            VALUES (?, ?, ?, 0, 'Pending', ?)
        `, [purchaseOrderId, supplierInvoiceNo, formattedInvoiceDate, req.user.Id]);

        const invoiceId = invoiceResult.insertId;
        let totalInvoiceAmount = 0;

        // Prepare Invoice Details
        const invoiceValues = [];

        for (const { productId, receivedQuantity } of products) {
            const row = orderedMap.get(Number(productId));
            if (!row) throw new Error(`Invalid ProductId ${productId}`);

            const productName= await getProductName(productId);

            if (receivedQuantity > row.RemainingQuantity) {
                throw new Error(`Received qty exceeds remaining qty for Product ${productName} having product Id ${productId}`);
            }

            const totalAmount = receivedQuantity * row.PurchasePrice;
            const igstAmount = (totalAmount * row.IGSTPercentage) / 100;
            totalInvoiceAmount += totalAmount + igstAmount;

            invoiceValues.push([
                invoiceId,
                productId,
                receivedQuantity,
                row.PurchasePrice,
                row.IGSTPercentage,
                igstAmount,
                totalAmount
            ]);

            // 🔹 Update Product Remaining + Status
            await connection.execute(`
                UPDATE PurchaseOrderDetails
                SET 
                    RemainingQuantity = RemainingQuantity - ?,
                    Status = CASE
                        WHEN RemainingQuantity - ? = 0 THEN 'Received'
                        ELSE 'Partial'
                    END
                WHERE PurchaseOrderId = ? AND ProductId = ?
            `, [receivedQuantity, receivedQuantity, purchaseOrderId, productId]);
        }

        // Insert Invoice Details
        await connection.query(`
            INSERT INTO InvoiceDetails
            (InvoiceId, ProductId, ReceivedQuantity, PurchasePrice, IGSTPercentage, IGSTAmount, TotalAmount)
            VALUES ?
        `, [invoiceValues]);

        // Update Invoice Total
        await connection.execute(`
            UPDATE Invoices SET TotalAmount = ? WHERE Id = ?
        `, [totalInvoiceAmount, invoiceId]);

        // 🔹 Recalculate PO Status FROM DB
        const [[statusRow]] = await connection.execute(`
            SELECT 
                COUNT(*) AS total,
                SUM(Status = 'Received') AS received
            FROM PurchaseOrderDetails
            WHERE PurchaseOrderId = ?
        `, [purchaseOrderId]);

        let poStatus = 'Pending';
        if (statusRow.received > 0 && statusRow.received < statusRow.total) {
            poStatus = 'Partially Received';
        }
        if (statusRow.received === statusRow.total) {
            poStatus = 'Received';
        }

        await connection.execute(`
            UPDATE PurchaseOrders SET Status = ? WHERE Id = ?
        `, [poStatus, purchaseOrderId]);

        console.log('in stock transaction at new place')

        // ---------- STOCK & TRANSACTIONS (unchanged logic) ----------
        for (const { productId, receivedQuantity, batchNumber, expiryDate, supplierId, mfgDate, freeQuantity } of products) {

            console.log(freeQuantity);
            console.log('freeQuantity')

            const totalQty = Number(receivedQuantity) + Number(freeQuantity || 0);

            const [stockResult] = await connection.execute(`
                INSERT INTO Stock (ProductId, BatchNumber, ExpiryDate, Quantity, SupplierId, InvoiceId, CreatedAt, MfgDate)
                VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
                ON DUPLICATE KEY UPDATE 
                    Quantity = Quantity + VALUES(Quantity),
                    ExpiryDate = VALUES(ExpiryDate),
                    MfgDate = VALUES(MfgDate)
            `, [
                productId,
                batchNumber,
                moment(expiryDate, "DD-MM-YYYY").format("YYYY-MM-DD"),
                totalQty,
                supplierId,
                invoiceId,
                moment(mfgDate, "DD-MM-YYYY").format("YYYY-MM-DD")
            ]);

            const stockId = stockResult.insertId || (
                await connection.execute(
                    `SELECT Id FROM Stock WHERE ProductId = ? AND BatchNumber = ?`,
                    [productId, batchNumber]
                )
            )[0][0].Id;

            const productName= await getProductName(productId);
            const isNewBatch = stockResult.affectedRows === 1;
                    // Remarks
                const remarksPaid = isNewBatch 
                ? `New batch added For Product ${productName} having Id ${productId} (Batch ${batchNumber}) from Invoice ${invoiceId}` 
                : `Restocked existing Product with name as ${productName} and Id as ${productId} (Batch ${batchNumber}) from Invoice ${invoiceId}`;
            // --- Transactions ---

            // Paid Quantity Transaction
            if (receivedQuantity > 0) {
                const txnPaidQuery = `
                    INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Timestamp, Remarks)
                    VALUES (?, 'ADD', ?, NOW(), ?)
                `;
                console.log(mysql.format(txnPaidQuery, [stockId, receivedQuantity, remarksPaid]));
                await connection.execute(txnPaidQuery, [stockId, receivedQuantity, remarksPaid]);
            }
            const remarksFree = `Free stock added for Product ${productName} with Id  ${productId} (Batch ${batchNumber}) from Invoice ${invoiceId}`;
            if (freeQuantity > 0) {
                await connection.execute(`
                    INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Timestamp, Remarks)
                    VALUES (?, 'FREE_ADD', ?, NOW(), ?)
                `, [stockId, freeQuantity, remarksFree]);
            }
        }

        await connection.commit();
        return {message:'Purchase order updated successfully and stock recorded.',invoiceId:invoiceId}

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};*/
const formatDate = (invoicePoDate) =>
    invoicePoDate ? moment(invoicePoDate, "DD-MM-YYYY").format("YYYY-MM-DD") : null;

/**
 * Generates a purchase invoice against an existing Purchase Order.
 *
 * What this function does:
 * 1. Starts a database transaction to ensure data consistency.
 * 2. Validates request payload (purchase order, products, quantities).
 * 3. Creates a new Invoice entry linked to the Purchase Order.
 * 4. For each product:
 *    - Validates received quantity against remaining PO quantity.
 *    - Inserts invoice line items (InvoiceDetails).
 *    - Updates remaining quantity and status in PurchaseOrderDetails.
 * 5. Calculates and updates the total invoice amount including IGST.
 * 6. Updates Purchase Order status (Pending / Partially Received / Received).
 * 7. Records stock entries:
 *    - Adds or updates batch-wise stock.
 *    - Records paid and free stock transactions separately.
 * 8. Commits the transaction if all operations succeed.
 * 9. Rolls back the transaction if any step fails.
 *
 * Key characteristics:
 * - Fully transactional (atomic operation).
 * - Handles partial and full deliveries.
 * - Supports batch-wise stock management.
 * - Prevents over-receipt of products.
 * - Automatically maintains PO, Invoice, Stock, and Transaction consistency.
 *
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request payload
 * @param {number} req.body.purchaseOrderId - Purchase Order ID
 * @param {string} req.body.supplierInvoiceNo - Supplier invoice number
 * @param {Array<Object>} req.body.products - List of received products
 * @param {string} req.body.invoicePoDate - Invoice date (DD-MM-YYYY)
 *
 * @returns {Promise<Object>} 
 * Returns an object containing:
 * - message: Success message
 * - invoiceId: Generated invoice ID
 *
 * @throws {Error}
 * Throws an error if validation fails or any database operation fails.
 */

const generateInvoice = async (req) => {
    const connection = await dbConnection.pool.promise().getConnection();
  
    try {
      await connection.beginTransaction();
  
      const { purchaseOrderId, supplierInvoiceNo, products, invoicePoDate } = req.body;

      // -------------------- VALIDATION --------------------
      if (!purchaseOrderId || !supplierInvoiceNo) {
        throw new Error('PurchaseOrderId and SupplierInvoiceNo are required');
      }
  
      if (!Array.isArray(products) || !products.length) {
        throw new Error('Products array is required');
      }
 
      products.forEach(p => {
        if (!p.productId || p.receivedQuantity == null) {
          throw new Error('Invalid product payload');
        }
      });
      console.log('1')
      const formattedInvoiceDate = formatDate(invoicePoDate);

      // -------------------- FETCH PO PRODUCTS --------------------
      const [orderedProducts] = await connection.execute(`
        SELECT ProductId, Quantity, RemainingQuantity, PurchasePrice, IGSTPercentage
        FROM PurchaseOrderDetails
        WHERE PurchaseOrderId = ?
      `, [purchaseOrderId]);

      const orderedMap = new Map();
      orderedProducts.forEach(p => {
        orderedMap.set(Number(p.ProductId), p);
      });
      console.log('2')
      // -------------------- INSERT INVOICE --------------------
      const [invoiceResult] = await connection.execute(`
        INSERT INTO Invoices
        (PurchaseOrderId, SupplierInvoiceNo, InvoiceDate, TotalAmount, Status, ReceivedBy)
        VALUES (?, ?, ?, 0, 'Pending', ?)
      `, [purchaseOrderId, supplierInvoiceNo, formattedInvoiceDate, req.user.Id]);
  
      const invoiceId = invoiceResult.insertId;
      let totalInvoiceAmount = 0;
      const invoiceValues = [];
      console.log('3')
      // -------------------- INVOICE DETAILS --------------------
      for (const item of products) {
        const productId = Number(item.productId);
        const receivedQuantity = Number(item.receivedQuantity);
      
        const row = orderedMap.get(productId);
        if (!row) throw new Error(`Invalid ProductId ${productId}`);
  
        const productName = await getProductName(productId, connection);
        
        if (receivedQuantity > row.RemainingQuantity) {
          throw new Error(
            `Received qty exceeds remaining qty for Product ${productName} (ID ${productId})`
          );
        }
        console.log('4')
        const totalAmount = receivedQuantity * row.PurchasePrice;
        const igstAmount = (totalAmount * row.IGSTPercentage) / 100;
        totalInvoiceAmount += totalAmount + igstAmount;
  
        invoiceValues.push([
          invoiceId,
          productId,
          receivedQuantity,
          row.PurchasePrice,
          row.IGSTPercentage,
          igstAmount,
          totalAmount
        ]);
        console.log('5')

    console.log(mysql.format(`UPDATE PurchaseOrderDetails
SET 
  RemainingQuantity = GREATEST(RemainingQuantity - ?, 0)
WHERE PurchaseOrderId = ?
  AND ProductId = ?;
        `, [receivedQuantity, purchaseOrderId, productId]))

        await connection.execute(`
          UPDATE PurchaseOrderDetails
SET 
  RemainingQuantity = GREATEST(RemainingQuantity - ?, 0)
WHERE PurchaseOrderId = ?
  AND ProductId = ?;
        `, [receivedQuantity, purchaseOrderId, productId]);
      }

      if (!invoiceValues.length) {
        throw new Error('No invoice items to insert');
      }
      console.log('6')
      await connection.query(`
        INSERT INTO InvoiceDetails
        (InvoiceId, ProductId, ReceivedQuantity, PurchasePrice, IGSTPercentage, IGSTAmount, TotalAmount)
        VALUES ?
      `, [invoiceValues]);

      await connection.execute(`
        UPDATE Invoices SET TotalAmount = ? WHERE Id = ?
      `, [totalInvoiceAmount, invoiceId]);
      console.log('7')
      // -------------------- PO STATUS --------------------
      const [[statusRow]] = await connection.execute(`
        SELECT COUNT(*) AS total, SUM(Status = 'Received') AS received
        FROM PurchaseOrderDetails
        WHERE PurchaseOrderId = ?
      `, [purchaseOrderId]);
  
      let poStatus = 'Pending';
      if (statusRow.received === statusRow.total) {
        poStatus = 'Received';
      } else if (statusRow.received > 0) {
        poStatus = 'Partially Received';
      }
      console.log('8')
      await connection.execute(`
        UPDATE PurchaseOrders SET Status = ? WHERE Id = ?
      `, [poStatus, purchaseOrderId]);
  
      // -------------------- STOCK & TRANSACTIONS --------------------
      for (const {
        productId, receivedQuantity, batchNumber,
        expiryDate, supplierId, mfgDate, freeQuantity
      } of products) {
  
        const totalQty = Number(receivedQuantity) + Number(freeQuantity || 0);
  
        const [stockResult] = await connection.execute(`
          INSERT INTO Stock
          (ProductId, BatchNumber, ExpiryDate, Quantity, SupplierId, InvoiceId, CreatedAt, MfgDate)
          VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
          ON DUPLICATE KEY UPDATE
            Quantity = Quantity + VALUES(Quantity),
            ExpiryDate = VALUES(ExpiryDate),
            MfgDate = VALUES(MfgDate)
        `, [
          productId,
          batchNumber,
          formatDate(expiryDate),
          totalQty,
          supplierId,
          invoiceId,
          formatDate(mfgDate)
        ]);
        console.log('9')
        const stockId = stockResult.insertId || (
          await connection.execute(
            `SELECT Id FROM Stock WHERE ProductId = ? AND BatchNumber = ?`,
            [productId, batchNumber]
          )
        )[0][0].Id;
  
        const productName = await getProductName(productId, connection);
        const isNewBatch = stockResult.affectedRows === 1;
  
        const remarksPaid = isNewBatch
          ? `New batch added for Product ${productName} (ID ${productId}, Batch ${batchNumber}) from Invoice ${invoiceId}`
          : `Restocked Product ${productName} (ID ${productId}, Batch ${batchNumber}) from Invoice ${invoiceId}`;
  
        if (receivedQuantity > 0) {
          await connection.execute(`
            INSERT INTO StockTransactions
            (StockId, TransactionType, Quantity, Timestamp, Remarks)
            VALUES (?, 'ADD', ?, NOW(), ?)
          `, [stockId, receivedQuantity, remarksPaid]);
        }
        console.log('10')
        if (freeQuantity > 0) {
          await connection.execute(`
            INSERT INTO StockTransactions
            (StockId, TransactionType, Quantity, Timestamp, Remarks)
            VALUES (?, 'FREE_ADD', ?, NOW(), ?)
          `, [
            stockId,
            freeQuantity,
            `Free stock added for Product ${productName} (ID ${productId}, Batch ${batchNumber}) from Invoice ${invoiceId}`
          ]);
        }
      }
  console.log('final')
      await connection.commit();
      productNameCache.clear();
  
      return {
        message: 'Purchase order updated successfully and stock recorded.',
        invoiceId
      };
  
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  


/**
 * 
 * @param {*} req 
 * @returns 
 * This is use to view the sales it is updated version of previous one
 * Displays single invoice for all the product ordered in a invoice.
 */
const getSearchedSalesData = async (req) => {
   // const connection = await dbConnection.pool.getConnection(); // Get DB connection

    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const fromDate = body.FromDate ? helper.parseDate(body.FromDate) : moment().format("YYYY-MM-DD");
        const toDate = body.ToDate ? helper.parseDate(body.ToDate) : moment().format("YYYY-MM-DD");

        if (!helper.compareDateForSearch(fromDate, toDate)) {
            throw new Error(`Invalid date range. "From Date" should be less than or equal to "To Date".`);
        }

        // Initialize `where` conditions and parameters array
        const whereArr = [`Date(Sales.CreatedAt) BETWEEN ? AND ?`];
        const queryParams = [fromDate, toDate];

        // Add optional filters if provided
        if (body.InvoiceId) {
            whereArr.push(`Sales.InvoiceId LIKE ?`);
            queryParams.push(`%${body.InvoiceId}%`);
        }
        if (body.Customer) {
            whereArr.push(`Sales.CustomerId = ?`);
            queryParams.push(body.Customer);
        }

        // Construct WHERE clause
        const whereStr = whereArr.length ? `WHERE ${whereArr.join(" AND ")}` : "";
        
        const sql = `
            SELECT 
                Sales.InvoiceId,
                Customers.CustomerName,
                Customers.GstNo,
                GROUP_CONCAT(Products.ProductName ORDER BY Sales.Id SEPARATOR ', ') AS Products,
                GROUP_CONCAT(Stock.BatchNumber ORDER BY Sales.Id SEPARATOR ', ') AS BatchNumbers,
                GROUP_CONCAT( Sales.QuantitySold ORDER BY Sales.Id SEPARATOR ', ') AS QuantitySold,
                Customers.Id AS CustomerId,
                DATE_FORMAT(Sales.CreatedAt, '%d-%m-%y') AS SaledOn
            FROM Sales
            JOIN Customers ON Sales.CustomerId = Customers.Id
            JOIN Stock ON Sales.StockId = Stock.Id
            JOIN Products ON Stock.ProductId = Products.Id
            ${whereStr}
            GROUP BY Sales.InvoiceId, Customers.CustomerName, Customers.Id, SaledOn
            ORDER BY MAX(Sales.CreatedAt) DESC;
        `;

        console.log("Executing Query:", sql, queryParams); // Debugging

        const [rows] = await dbConnection.execute(sql, queryParams);

        return rows;
    } catch (error) {
        console.error("Error in getSearchedSalesData:", error);
        throw error; // Rethrow error for handling in higher scope
    } finally {
       // connection.release(); // Ensure connection is released
    }
};


const getSalesReport = async (req) => {
   // const connection = await dbConnection.pool.getConnection();

    try {
       
        // Extract request body
        const data = req.method === 'POST' ? req.body : req.query;

        const Customer = data.Customer || null
        const FromDate = data.FromDate || moment().format('DD-MM-YYYY');
        const ToDate   = data.ToDate   || moment().format('DD-MM-YYYY');
        

        // Parse and validate dates
        const fromDate = FromDate ? helper.parseDate(FromDate) : moment().format("YYYY-MM-DD");
        const toDate = ToDate ? helper.parseDate(ToDate) : moment().format("YYYY-MM-DD");

        if (!helper.compareDateForSearch(fromDate, toDate)) {
            throw new Error(`Invalid date range. "From Date" should be less than or equal to "To Date".`);
        }

       
        // Convert to full datetime strings as our createdAt column  is having timestamp
        const startDate = moment(fromDate).startOf('day').format('YYYY-MM-DD HH:mm:ss'); // '2025-04-01 00:00:00'
        const endDate = moment(toDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');       // '2025-04-13 23:59:59'
        const query=`SELECT 
                          s.InvoiceId,
                          DATE_FORMAT(s.CreatedAt,'%d-%m-%y') AS CreatedAt,
                          c.CustomerName,
                          c.GstNo,
                          p.ProductName,
                          s.QuantitySold,
                          s.TotalValue,
                          s.TotalValueWithTax,
                          s.SalePrice,
                          s.Sgst,
                          s.Cgst,
                          s.SgstAmount,
                          s.CgstAmount
                      FROM Sales s
                      JOIN Customers c ON s.CustomerId = c.Id
                      JOIN Stock st ON s.StockId = st.Id
                      JOIN Products p ON st.ProductId = p.Id
                      WHERE s.CreatedAt BETWEEN ? AND ?
                      AND (? IS NULL OR s.CustomerId = ?)
                      ORDER BY s.InvoiceId DESC, s.Id ASC;`

        console.log("Executing Query:", mysql.format(query, [startDate, endDate,Customer,Customer])); // Debugging query

        // Execute query
        const [salesReports] = await dbConnection.execute(query, [startDate, endDate,Customer,Customer]);

        const invoiceMap = {};
        salesReports.forEach(row => {
            if (!invoiceMap[row.InvoiceId]) {
                invoiceMap[row.InvoiceId] = {
                InvoiceId: row.InvoiceId,
                CustomerName: row.CustomerName,
                GstNo: row.GstNo,
                CreatedAt: row.CreatedAt,
                Products: [],
                SubTotal: 0,
                GrandTotal: 0,
                TotalCgst: 0,
                TotalSgst: 0
                };
            }

            const invoice = invoiceMap[row.InvoiceId];

            // 🔥 CONVERT TO NUMBER HERE
            const totalValue = parseFloat(row.TotalValue) || 0;
            const totalValueWithTax = parseFloat(row.TotalValueWithTax) || 0;
            const cgstAmount = parseFloat(row.CgstAmount) || 0;
            const sgstAmount = parseFloat(row.SgstAmount) || 0;

            invoice.Products.push({
                ProductName: row.ProductName,
                QuantitySold: row.QuantitySold,
                Sgst:parseFloat(row.Sgst) || 0,
                Cgst:parseFloat(row.Cgst) || 0,
                SalePrice: parseFloat(row.SalePrice) || 0,
                TotalValue: totalValue,
                TotalValueWithTax: totalValueWithTax,
                CgstAmount: cgstAmount,
                SgstAmount: sgstAmount
            });

            // ✅ Proper numeric addition
            invoice.SubTotal += totalValue;
            invoice.GrandTotal += totalValueWithTax;
            invoice.TotalCgst += cgstAmount;
            invoice.TotalSgst += sgstAmount;

    });

        const invoices = Object.values(invoiceMap);  

        return invoices;
        
    } catch (error) {
        console.error("Error in getSalesReport:", error.message);
        throw error; // You can return a structured error response here if needed
    } finally {
       // connection.release(); // Ensure connection is released in all cases
    }
};

const getInvoiceDetails= async(purchaseOrderId)=>{

    try {
        const invoiceQuery = `SELECT 
                                    i.SupplierInvoiceNo, 
                                    i.InvoiceDate, 
                                    i.TotalAmount
                                FROM Invoices i
                                WHERE i.PurchaseOrderId = ?`;
    
   // const [purchaseOrder] = await dbConnection.connection.promise().execute(purchaseOrderQuery, [purchaseOrderId]);
   // const [products] = await dbConnection.connection.promise().execute(productDetailsQuery, [purchaseOrderId]);
    const [invoices] = await dbConnection.connection.promise().execute(invoiceQuery, [purchaseOrderId])
    return invoices
    } catch (error) {
        console.log(error)
        throw error
    }

}

const getCustomersLedger = async(startDate,endDate)=>{
    try {
        /*const query=`SELECT 
                        c.Id,
                        c.CustomerName,
                        COALESCE(SUM(s.TotalValueWithTax), 0) AS TotalDebit,
                        COALESCE(SUM(p.Amount), 0) AS TotalCredit,
                        
                        -- Carry forward debit and credit
                        COALESCE(cf.Debit, 0) AS CarryForwardDebit,
                        COALESCE(cf.Credit, 0) AS CarryForwardCredit,

                        -- Calculate NetBalance with proper sign
                        (COALESCE(SUM(s.TotalValueWithTax), 0) + COALESCE(cf.Debit, 0) 
                        - COALESCE(SUM(p.Amount), 0) - COALESCE(cf.Credit, 0)) AS NetBalance,

                        CASE 
                            WHEN (COALESCE(SUM(s.
                            TotalValueWithTax), 0) + COALESCE(cf.Debit, 0) 
                                - COALESCE(SUM(p.Amount), 0) - COALESCE(cf.Credit, 0)) > 0 
                                THEN CONCAT((COALESCE(SUM(s.TotalValueWithTax), 0) + COALESCE(cf.Debit, 0) 
                                            - COALESCE(SUM(p.Amount), 0) - COALESCE(cf.Credit, 0)), ' DR')
                            WHEN (COALESCE(SUM(s.TotalValueWithTax), 0) + COALESCE(cf.Debit, 0) 
                                - COALESCE(SUM(p.Amount), 0) - COALESCE(cf.Credit, 0)) < 0 
                                THEN CONCAT(ABS(COALESCE(SUM(s.TotalValueWithTax), 0) + COALESCE(cf.Debit, 0) 
                                                - COALESCE(SUM(p.Amount), 0) - COALESCE(cf.Credit, 0)), ' CR')
                            ELSE '0'
                        END AS BalanceType

                    FROM 
                        Customers c

                    LEFT JOIN Sales s ON c.Id = s.CustomerId 
                        AND s.CreatedAt BETWEEN ? AND ?

                    LEFT JOIN Payments p ON c.Id = p.CustomerId 
                        AND p.PaymentDate BETWEEN ? AND ?

                    -- Use latest carry forward entry before selected date
                    LEFT JOIN CarryForward cf ON c.Id = cf.CustomerId 
                        AND cf.CarryForwardDate = (
                            SELECT MAX(cf2.CarryForwardDate)
                            FROM CarryForward cf2 
                            WHERE cf2.CustomerId = c.Id AND cf2.CarryForwardDate < ?
                        )

                    GROUP BY 
                        c.Id, 
                        c.CustomerName, 
                        cf.Debit, 
                        cf.Credit;
                    `
         console.log(mysql.format(query,[startDate,endDate,startDate,endDate,startDate]))
        const [rows]= await dbConnection.connection.promise().query(query,[startDate,endDate,startDate,endDate,startDate])*/
      const query= ` SELECT 
                        c.Id,
                        c.CustomerName,

                        -- Sales total
                        COALESCE(s.TotalDebit, 0) AS TotalDebit,

                        -- Payments total
                        COALESCE(p.TotalCredit, 0) AS TotalCredit,

                        -- Carry Forward values
                        COALESCE(cf.Debit, 0) AS CarryForwardDebit,
                        COALESCE(cf.Credit, 0) AS CarryForwardCredit,

                        -- Net balance
                        (
                            COALESCE(s.TotalDebit, 0) + COALESCE(cf.Debit, 0)
                            - COALESCE(p.TotalCredit, 0) - COALESCE(cf.Credit, 0)
                        ) AS NetBalance,

                        -- Balance type with DR/CR
                        CASE 
                            WHEN (
                                COALESCE(s.TotalDebit, 0) + COALESCE(cf.Debit, 0)
                                - COALESCE(p.TotalCredit, 0) - COALESCE(cf.Credit, 0)
                            ) > 0 
                                THEN CONCAT(
                                    (
                                        COALESCE(s.TotalDebit, 0) + COALESCE(cf.Debit, 0)
                                        - COALESCE(p.TotalCredit, 0) - COALESCE(cf.Credit, 0)
                                    ), ' DR')
                            WHEN (
                                COALESCE(s.TotalDebit, 0) + COALESCE(cf.Debit, 0)
                                - COALESCE(p.TotalCredit, 0) - COALESCE(cf.Credit, 0)
                            ) < 0 
                                THEN CONCAT(
                                    ABS(
                                        COALESCE(s.TotalDebit, 0) + COALESCE(cf.Debit, 0)
                                        - COALESCE(p.TotalCredit, 0) - COALESCE(cf.Credit, 0)
                                    ), ' CR')
                            ELSE '0'
                        END AS BalanceType

                    FROM Customers c

                    -- Subquery for sales
                    LEFT JOIN (
                        SELECT CustomerId, SUM(TotalValueWithTax) AS TotalDebit
                        FROM Sales
                        WHERE CreatedAt BETWEEN ? AND ?
                        GROUP BY CustomerId
                    ) s ON c.Id = s.CustomerId

                    -- Subquery for payments
                    LEFT JOIN (
                        SELECT CustomerId, SUM(Amount) AS TotalCredit
                        FROM Payments
                        WHERE PaymentDate BETWEEN ? AND ?
                        GROUP BY CustomerId
                    ) p ON c.Id = p.CustomerId

                    -- Latest carry forward before selected date
                    LEFT JOIN CarryForward cf ON cf.CarryForwardId = (
                        SELECT cf2.CarryForwardId
                        FROM CarryForward cf2
                        WHERE cf2.CustomerId = c.Id AND cf2.CarryForwardDate < ?
                        ORDER BY cf2.CarryForwardDate DESC
                        LIMIT 1
                    );`
const [rows]= await dbConnection.connection.promise().query(query,[startDate,endDate,startDate,endDate,startDate])
        return rows
        //console.log(rows)
    } catch (error) {
        console.log(error)
        throw error
    }
}

const getProductPrice= async(productId,customerId)=>{

    try {
        const checkProductPriceQuery='select * from CustomerPricing where CustomerId=? AND ProductId=?'
        const [result]= await dbConnection.connection.promise().query(checkProductPriceQuery,[customerId,productId])
        return result
    } catch (error) {
        console.log(error)
        throw error
    }
}
/**
 * 
 * @param {*} stockId 
 * @returns 
 */
const getProductNameFromStockId = async (stockId) => {
    try {
        const query = `SELECT st.ProductId, st.BatchNumber, Pr.ProductName
                            FROM Stock st
                            JOIN Products Pr ON Pr.Id = st.ProductId
                            WHERE st.Id = ?
                        `;
        const [rows] = await dbConnection.connection.promise().execute(query, [stockId]);
        return rows[0]; // or return rows if you expect multiple
    } catch (error) {
        console.log('Error fetching product name:', error);
        throw error;
    }
};

/**
 * 
 * @param {*} customerId 
 * @param {*} supplierId 
 * @returns 
 */
/*const getSuppliersProductWithCustomerPricing = async (customerId, supplierId = null) => {
    try {
       
        let query = `SELECT 
                            COALESCE(cp.Id, 0) AS CustomerPricingId,
                            COALESCE(cp.CustomerId, ?) AS CustomerId,
                            p.Id AS ProductId,
                            p.ProductName,
                            s.Id AS SupplierId,
                            s.Name AS SupplierName,
                            COALESCE(cp.SellingPrice, 0) AS SellingPrice,
                            stk.BatchNumber,
                            stk.Id AS StockId,
                            pod.MRP,
                            pod.PurchasePrice
                            
                        FROM Stock stk
                        JOIN Products p ON stk.ProductId= p.Id
                        JOIN Invoices inv ON inv.Id = stk.InvoiceId
                        JOIN Suppliers s ON p.SupplierId = s.Id 
                        JOIN PurchaseOrderDetails pod ON pod.PurchaseOrderId = inv.PurchaseOrderId AND pod.ProductId = p.Id
                        LEFT JOIN CustomerPricing cp 
                            ON cp.ProductId = p.Id 
                            AND cp.CustomerId = ? AND
                            cp.Status=1
                    `;

        let queryParams = [customerId, customerId]; // Default parameters

        if (supplierId) {
            query += ` WHERE s.Id = ?`; // Add supplier filter condition
            queryParams.push(supplierId); // Append supplierId to parameters
        }

        const [result] = await dbConnection.connection.promise().query(query, queryParams);
        console.log(result);
        return result;
        
    } catch (error) {
        console.log(error)
        throw error;
    }
};*/
const getSuppliersProductWithCustomerPricing = async (customerId, supplierId = null) => {
  try {

      let query = `SELECT 
                          COALESCE(cp.Id, 0) AS CustomerPricingId,
                          COALESCE(cp.CustomerId, ?) AS CustomerId,
                          p.Id AS ProductId,
                          p.ProductName,
                          s.Id AS SupplierId,
                          s.Name AS SupplierName,
                          COALESCE(cp.SellingPrice, 0) AS SellingPrice,
                          stk.BatchNumber,
                          stk.Id AS StockId,
                          pod.MRP,
                          pod.PurchasePrice
                          
                      FROM Stock stk
                      JOIN Products p ON stk.ProductId = p.Id
                      JOIN Invoices inv ON inv.Id = stk.InvoiceId
                      JOIN Suppliers s ON p.SupplierId = s.Id 
                      JOIN PurchaseOrderDetails pod 
                          ON pod.PurchaseOrderId = inv.PurchaseOrderId 
                          AND pod.ProductId = p.Id
                          
                      LEFT JOIN CustomerPricing cp 
                          ON cp.ProductId = p.Id 
                          AND cp.StockId = stk.Id     -- 🔥 IMPORTANT FIX
                          AND cp.CustomerId = ?
                          AND cp.Status = 1
                  `;

      let queryParams = [customerId, customerId];

      if (supplierId) {
          query += ` WHERE s.Id = ?`;
          queryParams.push(supplierId);
      }

      const [result] = await dbConnection.connection.promise().query(query, queryParams);
      return result;

  } catch (error) {
      console.log(error);
      throw error;
  }
};

/**
 * 
 * @param {*} customerId 
 * @param {*} supplierId 
 * @param {*} productId 
 * @param {*} newProductPrice 
 * @returns 
 */
const setProductPricingForCustomer = async (customerId, supplierId, productId, newProductPrice,stockId) => {
    const connection = await dbConnection.connection.promise().getConnection();
    try {
        await connection.beginTransaction(); // Start transaction

        // Check if price entry exists
        const checkPriceExistQuery = `SELECT * FROM CustomerPricing WHERE CustomerId=? AND SupplierId=? AND ProductId=? AND StockId=?`;
        const [checkPriceExist] = await connection.query(checkPriceExistQuery, [customerId, supplierId, productId, stockId]);

        if (checkPriceExist.length > 0) {

          console.log('deactivate query');

          console.log(mysql.format(`UPDATE CustomerPricing SET Status=0 WHERE CustomerId=? AND SupplierId=? AND ProductId=? AND StockId=?`),[customerId, supplierId, productId, stockId])
            // Deactivate previous price
            const deactivatePreviousPriceQuery = `UPDATE CustomerPricing SET Status=0 WHERE CustomerId=? AND SupplierId=? AND ProductId=? AND StockId=?`;
            await connection.query(deactivatePreviousPriceQuery, [customerId, supplierId, productId, stockId]);
        }

        // Insert new product price for the customer
        const setNewProductPriceForCustomerQuery = `
            INSERT INTO CustomerPricing (CustomerId, SupplierId, ProductId, SellingPrice, Status, StockId) 
            VALUES (?, ?, ?, ?, 1, ?)
        `;
        console.log('********test******')
        console.log(mysql.format(setNewProductPriceForCustomerQuery,[customerId, supplierId, productId, newProductPrice,stockId]))
        await connection.query(setNewProductPriceForCustomerQuery, [customerId, supplierId, productId, newProductPrice,stockId]);
        console.log('********test******')

        await connection.commit(); // Commit transaction
        return   "Product pricing updated successfully." 

    } catch (error) {
        await connection.rollback(); // Rollback transaction on error
        console.error("Error updating product pricing:", error);
        throw error
        //return { success: false, message: "Failed to update product pricing." };
    } finally {
        connection.release(); // Release connection
    }
};

const getInvoiceDetailsThroughSupplierInvoiceNo= async(supplierInvoiceNo)=>{

    try {
        const sql =`SELECT 
                            po.Id AS PurchaseOrderId,
                            po.SupplierId,
                            po.PurchaseInvoiceNo,
                            po.OrderDate,
                            po.TotalAmountWithTax,
                            po.Status AS PurchaseOrderStatus,
                            
                            pod.ProductId,
                            p.ProductName,
                            p.Hsn,
                            pod.Quantity AS OrderedQuantity,
                            pod.PurchasePrice,
                            pod.IGSTPercentage,
                            pod.IGSTAmount,
                            pod.TotalAmount AS OrderedTotalAmount,
                            pod.RemainingQuantity,
                            id.IGSTAmount AS ReceivedIgstAmount,
                            id.TotalAmount AS ReceivedTotalAmount,
                        
                            COALESCE(SUM(id.ReceivedQuantity), 0) AS ReceivedQuantityInInvoice,
                            COALESCE(SUM(id.TotalAmount), 0) AS TotalReceivedAmount
                        
                        FROM PurchaseOrders po
                        JOIN PurchaseOrderDetails pod ON po.Id = pod.PurchaseOrderId
                        JOIN Products p ON pod.ProductId = p.Id
                        LEFT JOIN Invoices i ON i.PurchaseOrderId = po.Id
                        LEFT JOIN InvoiceDetails id ON i.Id = id.InvoiceId AND id.ProductId = pod.ProductId
                        WHERE i.SupplierInvoiceNo = ?  
                        GROUP BY 
                            po.Id, po.SupplierId, po.PurchaseInvoiceNo, po.OrderDate, po.TotalAmountWithTax, po.Status,
                            pod.ProductId, p.ProductName, p.Hsn, pod.Quantity, pod.PurchasePrice, pod.IGSTPercentage, 
                            pod.IGSTAmount, pod.TotalAmount, pod.RemainingQuantity
                        HAVING SUM(id.ReceivedQuantity) > 0; 
    
                    `;

            //const connection = await pool.getConnection();
            console.log(mysql.format(sql,[supplierInvoiceNo]))
            const [rows] = await dbConnection.connection.promise().query(sql, [supplierInvoiceNo]);
            return rows
    } catch (error) {
        
        console.log(error)
        throw error
    }
}
const getStockDetails= async(productId)=>{
    try {
        const sql=`SELECT 
                        p.ProductName AS ProductName, 
                        p.Id AS ProductId,
                        s.Name AS SupplierName, 
                        st.BatchNumber, 
                        st.Quantity, 
                        st.ExpiryDate,
                        st.CreatedAt,
                        st.Id AS stockId,
                        pod.MRP,
                        pod.PurchasePrice
                    FROM Stock st
                    JOIN Invoices inv ON st.InvoiceId = inv.Id
                    JOIN Products p ON st.ProductId = p.Id
                    JOIN PurchaseOrderDetails pod ON pod.PurchaseOrderId= inv.PurchaseOrderId AND pod.ProductId = p.Id
                    JOIN Suppliers s ON st.SupplierId = s.Id
                    WHERE st.ProductId = ?;`
        const [rows]= await dbConnection.connection.promise().query(sql,[productId])
        return rows;
    } catch (error) {
        console.log(error)
        throw error
    }
}

const getProductDetails= async(productId)=>{

    try {
        const [productDetails] = await dbConnection.connection.promise().query('select * from Products where Id=?',[productId])

    console.log(mysql.format('select * from Products where Id=?',[productId]))
        return productDetails[0]

    } catch (error) {
        console.log(error)
        throw error
    }
}
/**
 * 
 * @param {*} updatedSales 
 * @param {*} removedRows 
 * @param {*} customerId 
 * @param {*} invoiceId 
 * @returns This is used to update the sale after the sale.
 */
const updateSales = async (updatedSales, removedRows, customerId, invoiceId) => {
    const connection = await dbConnection.pool.promise().getConnection();
    //const connection = await dbConnection.pool.getConnection();
    let customerName='';

    try {
        await connection.beginTransaction(); // ✅ Start transaction

        // ✅ Restore stock before deleting sales records
        if (removedRows.length > 0) {
            // Fetch sales records before deletion to get stock IDs and quantities
            const [deletedSales] = await connection.query(
                'SELECT Id, StockId, QuantitySold FROM Sales WHERE Id IN (?)',
                [removedRows]
            );

            for (const sale of deletedSales) {
                // ✅ Fetch Stock Data
                const [stock] = await connection.query('SELECT * FROM Stock WHERE Id=?', [sale.StockId]);

                if (!stock.length) {
                    throw new Error(`Stock not found for Stock ID ${sale.StockId}`);
                }

                // ✅ Restore Stock Quantity
                const restoredQuantity = stock[0].Quantity + sale.QuantitySold;
                await connection.query('UPDATE Stock SET Quantity=? WHERE Id=?', [restoredQuantity, sale.StockId]);

                 // ✅ get customer Name;
                  customerName= await getCustomerName(customerId);

                // ✅ Insert Stock Transaction for the restored stock
                const remarks = `Stock restored due to sale deletion (Invoice: ${invoiceId}, Customer Name: ${customerName})`;
                await connection.query(
                    `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Remarks) 
                     VALUES (?, ?, ?, ?)`,
                    [sale.StockId, sale.QuantitySold, 'ADD', remarks]
                );
            }

            // ✅ Now delete the sales records
            await connection.query('DELETE FROM Sales WHERE Id IN (?)', [removedRows]);
        }

        // ✅ Process Updated Sales
        for (const update of updatedSales) {
           // const [result] = await connection.query('SELECT * FROM Sales WHERE Id = ?', [update.id]);

            const [result]= await connection.query(`SELECT 
                                                            s.Id AS SaleId,
                                                            s.StockId,
                                                            s.QuantitySold,
                                                            s.SalePrice,
                                                            st.ProductId,
                                                            p.SupplierId
                                                        FROM 
                                                            Sales s
                                                        JOIN 
                                                            Stock st ON s.StockId = st.Id
                                                        JOIN 
                                                            Products p ON st.ProductId = p.Id
                                                        WHERE 
                                                            s.Id = ?`,[update.id])

                                                            console.log(result);
                                                            console.log('result tttttt')

            if (!result.length) {
                throw new Error('Some key field has been changed. Kindly try again.');
            }

            const newQuantitySold = Number(update.quantity);
            const sgstPercentage = Number(update.sgst);
            const cgstPercentage = Number(update.cgst);
            const salePrice = Number(update.rate);

            const oldSalePrice = Number(result[0].SalePrice);

            if(salePrice != oldSalePrice){
                const [updateCustomerSalePrice] = await setProductPricingForCustomer(customerId, result[0].SupplierId, result[0].ProductId, salePrice);
            }
            const taxableValue = newQuantitySold * salePrice;

            // ✅ Correct SGST & CGST Amount Calculation
            const sgstAmount = (taxableValue * sgstPercentage) / 100;
            const cgstAmount = (taxableValue * cgstPercentage) / 100;
            const totalValueWithTax = taxableValue + sgstAmount + cgstAmount;

            // ✅ Update Sales Table
            await connection.query(
                `UPDATE Sales 
                 SET QuantitySold=?,SalePrice=?, Sgst=?, Cgst=?, SgstAmount=?, CgstAmount=?, TotalValue=?, TotalValueWithTax=? 
                 WHERE Id=?`,
                [newQuantitySold,salePrice, sgstPercentage, cgstPercentage, sgstAmount, cgstAmount, taxableValue, totalValueWithTax, update.id]
            );

            // ✅ Check if quantity changed
            if (newQuantitySold !== result[0].QuantitySold) {
                const [stock] = await connection.query('SELECT * FROM Stock WHERE Id=?', [result[0].StockId]);

                if (!stock.length) {
                    throw new Error(`Stock not found for Stock ID ${result[0].StockId}`);
                }

                // ✅ Calculate stock difference correctly
                const quantityDifference = result[0].QuantitySold - newQuantitySold;
                const finalQuantity = stock[0].Quantity + quantityDifference;

                // ✅ Check stock before reducing
                if (quantityDifference < 0 && stock[0].Quantity < Math.abs(quantityDifference)) {
                    throw new Error(`Not enough stock available for Stock ID ${result[0].StockId}. Requested: ${Math.abs(quantityDifference)}, Available: ${stock[0].Quantity}`);
                }

                // ✅ Update Stock Table
                await connection.query('UPDATE Stock SET Quantity=? WHERE Id=?', [finalQuantity, result[0].StockId]);

                // ✅ Determine Transaction Type
                let transactionType = quantityDifference > 0 ? 'ADD' : 'REDUCE';
                let remarks = quantityDifference > 0
                    ? `Stock added due to return from customer with Name ${customerName} with Invoice ${invoiceId}`
                    : `Stock reduced due to demand from customer with ID ${customerName} with Invoice ${invoiceId}`;

                // ✅ Insert Stock Transaction
                await connection.query(
                    `INSERT INTO StockTransactions (StockId, Quantity, TransactionType, Remarks) 
                     VALUES (?, ?, ?, ?)`,
                    [result[0].StockId, Math.abs(quantityDifference), transactionType, remarks]
                );
            }
        }

        await connection.commit(); // ✅ Commit transaction
        return `Stock Transaction For sale with invoice No ${invoiceId} has been updated.`;
    } catch (error) {
        await connection.rollback(); // ❌ Rollback on error
        console.log(error);
        throw error;
    } finally {
        connection.release();
    }
};
// /**
//  * 
//  * @param {*} customerId 
//  * @param {*} supplierId 
//  * @param {*} productId 
//  * @param {*} batchNumber 
//  * @param {*} quantity 
//  * @param {*} reason 
//  * @param {*} defective 
//  */
// /*const processReturn = async (customerId, supplierId, productId, batchNumber, quantity, reason, condition) => {
//  const connection = await dbConnection.pool.promise().getConnection();//await dbConnection.pool.getConnection();
//     try {
//        // console.log(condition ? "Defective product return" : "Non-defective product return");

//         await connection.beginTransaction();

//         // Check if stock exists
//         //might get multiple stocks as multiple time same batch and product can be sold
//         const findStockQuery = "SELECT * FROM Stock WHERE ProductId=? AND BatchNumber=?";
//         const [stocks] = await connection.query(findStockQuery, [productId, batchNumber]);
//         const productName = await getProductName(productId, connection);
//         if (stocks.length === 0) {
//             throw new Error(`Product with Name ${productName} and BatchNumber ${batchNumber} does not exist.`);
//         }
//         const stockIds = stocks.map(s => s.Id);
//         const placeholders = stockIds.map(() => '?').join(',');
//         //find all the stocks sold to the customer and also get sum of the quantity sold
//         //to the customer , so that more than sold to them can not be returned 
//         const findSalesQuery=`SELECT 
//                                   s.Id,
//                                   s.StockId,
//                                   SUM(s.QuantitySold) AS SoldQty
//                               FROM Sales s
//                               WHERE s.StockId IN (${placeholders})
//                               AND s.CustomerId = ?
//                               GROUP BY s.StockId
//                               ORDER BY s.Id ASC`
//         const [saleDetails] = await connection.query(findSalesQuery, [...stockIds, customerId]);
//         const customerName= await getCustomerName(customerId);
//         // Fetch most recent sales details sold to the customer
//        // const findSalesQuery = "SELECT * FROM Sales WHERE StockId=? AND CustomerId=? ORDER BY Id DESC LIMIT 1";
//        // const [saleDetails] = await connection.query(findSalesQuery, [stock[0].Id, customerId]);

//         if (!saleDetails || saleDetails.length === 0) {
//             throw new Error(`No sales record found for Product ${productName} and CustomerId ${customerName}.`);
//         }

//         const latestSale = saleDetails[0]; // Most recent sale entry

//         // Check if total returned quantity exceeds sold quantity
//         const totalReturnedQuery = `SELECT COALESCE(SUM(ReturnQuantity), 0) AS TotalReturned 
//                                         FROM SaleReturns 
//                                         WHERE SaleId=?`;
//         const [returnSummary] = await connection.query(totalReturnedQuery, [latestSale.Id]);

//         const totalReturned = returnSummary[0]?.TotalReturned || 0;
//         //this code was giving rror 11 oct 2025
//         if (totalReturned + Number(quantity) > latestSale.QuantitySold) {
//             throw new Error(`Cannot return ${quantity}. Already returned: ${totalReturned}, Sold: ${latestSale.QuantitySold}`);
//         }

//         // Calculate return amounts
//         const salesPrice = Number(latestSale.SalePrice) || 0;
//         const cgst = Number(latestSale.Cgst) || 0;
//         const sgst = Number(latestSale.Sgst) || 0;
//         const returnQty = Number(quantity) || 0;

//         const totalAmountWithoutTax = returnQty * salesPrice;
//         const totalCgstAmount = (totalAmountWithoutTax * cgst) / 100;
//         const totalSgstAmount = (totalAmountWithoutTax * sgst) / 100;
//         const totalAmountWithTax = totalAmountWithoutTax + totalCgstAmount + totalSgstAmount;

//         const todayDateTime = moment().format('YYYY-MM-DD HH:mm:ss');

//         // Insert into returns table
//         const returnQuery = "INSERT INTO SaleReturns (SaleId, StockId, ReturnQuantity, ReturnReason, ReturnDate, RefundAmount, ReturnType) VALUES (?, ?, ?, ?, ?, ?, ?)";
//         console.log(mysql.format(returnQuery, [latestSale.Id, stock[0].Id, quantity, reason, todayDateTime, totalAmountWithTax, condition]));

//         await connection.query(returnQuery, [latestSale.Id, stock[0].Id, quantity, reason, todayDateTime, totalAmountWithTax, condition]);

//         // Update Payments table
//         const PaymentNo = 'RET-' + latestSale.InvoiceId + todayDateTime +'-RetQuant' + quantity;
//         const updateReturnPaymentQuery = "INSERT INTO Payments (CustomerId, PaymentNo, PaymentDate, PaymentType, Description, Credit, Debit) VALUES (?, ?, ?, ?, ?, ?, ?)";

//         console.log(mysql.format(updateReturnPaymentQuery, [customerId, PaymentNo, todayDateTime, 'NA', reason, 0, totalAmountWithTax]));

//         await connection.query(updateReturnPaymentQuery, [customerId, PaymentNo, todayDateTime, 'NA', reason, totalAmountWithTax,0]);
//        // const customerName= await getCustomerName(customerId);
//         // If the product is NOT defective, update stock quantity and stock transaction table
//         if (condition==='Good') {
//             const updatedQuantity = stock[0].Quantity + Number(quantity);
//             const updateStockQuery = "UPDATE Stock SET Quantity=? WHERE Id=?";
//             console.log(mysql.format(updateStockQuery, [updatedQuantity, stock[0].Id]));

//             await connection.query(updateStockQuery, [updatedQuantity, stock[0].Id]);

//             // Update stock transactions table
//             const updateStockTransactions = "INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Timestamp, Remarks) VALUES (?, ?, ?, ?, ?)";
//             await connection.query(updateStockTransactions, [
//                 stocks[0].Id, 'ADD', quantity, todayDateTime, 
//                 `Added due to sales return for customer ${customerName} and InvoiceId ${latestSale.InvoiceId} and RetQuantity ${quantity}`
//             ]);
//         }
// //if prorduct is defective or expired then what ?
//         if (condition==='Expired') {


//           const returnedQty = Number(quantity);
//           const stockId = stock[0].Id;
//           const currentQty = Number(stock[0].Quantity);
  
//           /* ===============================
//              1️⃣ ADD STOCK (Sales Return)
//           =============================== */
  
//           const qtyAfterReturn = currentQty + returnedQty;
  
//           const updateStockAddQuery = `
//               UPDATE Stock 
//               SET Quantity = ? 
//               WHERE Id = ?
//           `;
  
//           await connection.query(updateStockAddQuery, [
//               qtyAfterReturn,
//               stockId
//           ]);
  
//           /* ===============================
//              2️⃣ Stock Transaction - RETURN_IN
//           =============================== */
  
//           const insertTransactionQuery = `
//               INSERT INTO StockTransactions 
//               (StockId, TransactionType, Quantity, Timestamp, Remarks) 
//               VALUES (?, ?, ?, ?, ?)
//           `;
  
//           await connection.query(insertTransactionQuery, [
//               stockId,
//               'EXPIRED_RETURN',
//               returnedQty,
//               todayDateTime,
//               `Sales return from ${customerName} due to expiry, InvoiceId ${latestSale.InvoiceId}`
//           ]);
  
//           /* ===============================
//              3️⃣ MOVE TO EXPIRED (Reduce Sellable Stock)
//           =============================== */
  
//           const qtyAfterExpiredMove = qtyAfterReturn - returnedQty;
  
//           const updateStockReduceQuery = `
//               UPDATE Stock 
//               SET Quantity = ? 
//               WHERE Id = ?
//           `;
  
//           await connection.query(updateStockReduceQuery, [
//               qtyAfterExpiredMove,
//               stockId
//           ]);
  
//           /* ===============================
//              4️⃣ Stock Transaction - EXPIRED_OUT
//           =============================== */
  
//           await connection.query(insertTransactionQuery, [
//               stockId,
//               'EXPIRED_OUT',
//               returnedQty,
//               todayDateTime,
//               `Moved to expired stock from sales return from ${customerName} due to expiry, InvoiceId ${latestSale.InvoiceId}`
//           ]);
//         }
// //`Id`, `StockId`, `InvoiceId`, `ProductId`, `SupplierId`, `BatchNumber`, `ExpiryDate`, `ExpiredQty`, `PurchasePrice`, `GSTPercent`, `ExpiredAmount`, `SettledAmount`, `RemainingAmount`, `SettlementStatus`, `MovedAt`, `MovedBy`SELECT * FROM `ExpiredStock` WHERE 1
//         // Commit transaction
//         await connection.commit();
//         console.log("Return processed successfully.");
//         return "Return processed successfully.";
//     } catch (error) {
//         console.error("Error processing return:", error.message);
//         await connection.rollback();
//         throw error;
//     } finally {
//         connection.release();
//     }
// };*/


/**
 * Process customer return (Good / Expired)
 * Handles:
 * - Sale validation
 * - Sale return entry
 * - Payment entry
 * - Stock adjustment
 * - Expired stock movement
 *
 * @param {number} customerId
 * @param {number} supplierId
 * @param {number} productId
 * @param {string} batchNumber
 * @param {number} quantity
 * @param {string} reason
 * @param {'Good'|'Expired'} condition
 * @param {number} userId
 */
/* =========================================================
   🔥 MAIN PROCESS RETURN FUNCTION
========================================================= */
const processReturn = async (
                                customerId,
                                productId,
                                batchNumber,
                                quantity,
                                reason,
                                condition,
                                movedBy,
                                supplierId
                            ) => {

    const connection = await dbConnection.pool.promise().getConnection();

    try {

        await connection.beginTransaction();
        const today = moment().format('YYYY-MM-DD HH:mm:ss');

        /* 1️⃣ GET STOCKS */
        const stocks = await getStocksByProductBatch(connection, productId, batchNumber);
        const productName = await getProductName(productId, connection);
          if (!stocks.length) {
              throw new Error(`Stock not found for product with name as ${productName} with batch ${batchNumber}.`);
          }
        const stockIds = stocks.map(s => s.Id);

        /* 2️⃣ GET SALES FIFO */
        const sales = await getSalesForCustomer(connection, stockIds, customerId);
          //get customer name 
        const customerName = await getCustomerName(customerId);
        if (!sales.length) {
              throw new Error(`No sales found for product name as ${productName} and batch ${batchNumber} for the customer name as ${customerName}.`);
          }

        let remainingQty = Number(quantity);//returned quantitny

        /* 3️⃣ FIFO LOOP */
        for (const sale of sales) {

            if (remainingQty <= 0) break;

            const availableQty = await getAvailableReturnQty(
                connection,
                sale.Id,
                sale.SoldQty
            );

            if (availableQty <= 0) continue;

            const returnQty = Math.min(availableQty, remainingQty);

            console.log(sale)

            console.log('*********************')

            const totalAmount = calculateReturnAmount(
                sale.SalePrice,
                sale.Cgst,
                sale.Sgst,
                returnQty
            );

            /* Insert Sale Return */
            await insertSaleReturn(
                connection,
                sale.Id,
                sale.StockId,
                returnQty,
                reason,
                totalAmount,
                condition,
                today
            );

            /* Insert Payment */
            await insertPaymentEntry(
                connection,
                customerId,
                sale.InvoiceId,
                returnQty,
                totalAmount,
                reason,
                today
            );

            /* GOOD PRODUCT */
            if (condition === 'Good') {

                await increaseStock(connection, sale.StockId, returnQty);

                await insertStockTransaction(
                    connection,
                    sale.StockId,
                    'SALE_RETURN',
                    returnQty,
                    today,
                    `Customer with name ${customerName} with product ${productName} with 
                      batch ${batchNumber} has returned(Good) this.`
                );
            }

            /* EXPIRED PRODUCT */
            if (condition === 'Expired'|| condition === 'Defective' || condition === 'Defective & Expired') {

                await validateIfStockExpired(connection, sale.StockId);

                // Add stock
                await increaseStock(connection, sale.StockId, returnQty);

                await insertStockTransaction(
                    connection,
                    sale.StockId,
                    'EXPIRED_RETURN_IN',
                    returnQty,
                    today,
                    `Customer with name ${customerName} with product ${productName} with 
                      batch ${batchNumber} has returned(expired) this.`
                );

                // Remove sellable
                await decreaseStock(connection, sale.StockId, returnQty);

                await insertStockTransaction(
                    connection,
                    sale.StockId,
                    'EXPIRED_RETURN_OUT',
                    returnQty,
                    today,
                    `Moved to expired stock with product name ${productName} and batch ${batchNumber}`
                );

                await moveToExpiredStock(
                    connection,
                    sale.StockId,
                    returnQty,
                    movedBy
                );
            }

            remainingQty -= returnQty;
        }

        if (remainingQty > 0) {
            throw new Error(`Return quantity of ${productName} exceeds sold quantity to the customer ${customerName}.`);
        }

        await connection.commit();
        return "Return processed successfully.";

    } catch (error) {

        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
};

const getStocksByProductBatch = async (connection, productId, batchNumber) => {

  const [rows] = await connection.query(
      `SELECT * FROM Stock
       WHERE ProductId = ?
       AND BatchNumber = ?
       FOR UPDATE`,
      [productId, batchNumber]
  );

  return rows;
};

const getSalesForCustomer = async (connection, stockIds, customerId) => {

  const placeholders = stockIds.map(() => '?').join(',');

  const [rows] = await connection.query(
      `SELECT 
          s.Id,
          s.StockId,
          s.InvoiceId,
          s.SalePrice,
          s.Cgst,
          s.Sgst,
          s.QuantitySold AS SoldQty
       FROM Sales s
       WHERE s.StockId IN (${placeholders})
       AND s.CustomerId = ?
       ORDER BY s.Id ASC`,
      [...stockIds, customerId]
  );

  return rows;
};
const getAvailableReturnQty = async (connection, saleId, soldQty) => {

  const [rows] = await connection.query(
      `SELECT COALESCE(SUM(ReturnQuantity),0) AS ReturnedQty
       FROM SaleReturns
       WHERE SaleId = ?`,
      [saleId]
  );

  const returned = Number(rows[0].ReturnedQty || 0);
  const available = Number(soldQty) - returned;

  return available > 0 ? available : 0;
};

const calculateReturnAmount = (salePrice, cgst, sgst, qty) => {

  const base = qty * Number(salePrice || 0);
  const cgstAmt = (base * Number(cgst || 0)) / 100;
  const sgstAmt = (base * Number(sgst || 0)) / 100;
  console.log('base:'+ base);
  console.log('cgstAmt:'+ cgstAmt);
  console.log('sgstAmt:'+sgstAmt)

  return base + cgstAmt + sgstAmt;
};
const insertSaleReturn = async (connection,saleId,stockId,qty,reason,amount,condition,dateTime) => {

  await connection.query(
      `INSERT INTO SaleReturns
       (SaleId, StockId, ReturnQuantity, ReturnReason, ReturnDate, RefundAmount, ReturnType)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [saleId, stockId, qty, reason, dateTime, amount, condition]
  );
};
const insertPaymentEntry = async (
  connection,
  customerId,
  invoiceId,
  qty,
  amount,
  reason,
  dateTime
) => {
  const today = moment().format('YYYY-MM-DD HH:mm:ss');
  const paymentNo = `RET-${invoiceId}-${today}-${qty}`;

  await connection.query(
      `INSERT INTO Payments
       (CustomerId, PaymentNo, PaymentDate, PaymentType, Description, Credit, Debit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customerId, paymentNo, dateTime, 'RETURN', reason, amount, 0]
  );
};
const increaseStock = async (connection, stockId, qty) => {

  await connection.query(
      `UPDATE Stock
       SET Quantity = Quantity + ?
       WHERE Id = ?`,
      [qty, stockId]
  );
};
const decreaseStock = async (connection, stockId, qty) => {

  await connection.query(
      `UPDATE Stock
       SET Quantity = Quantity - ?
       WHERE Id = ?`,
      [qty, stockId]
  );
};
/*const insertStockTransaction = async (connection,stockId,type,qty,dateTime,remarks) => {

  await connection.query( `INSERT INTO StockTransactions
       (StockId, TransactionType, Quantity, Timestamp, Remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [stockId, type, qty, dateTime, remarks]
  );
};*/
const insertStockTransaction = async (
  connection,
  stockId,
  type,
  qty,
  dateTime,
  remarks
) => {

  const effectMap = {
      ADD: 'IN',
      FREE_ADD: 'IN',
      SALE_RETURN: 'IN',
      EXPIRED_RETURN_IN: 'IN',

      REDUCE: 'OUT',
      EXPIRED: 'OUT',
      EXPIRED_RETURN_OUT: 'OUT'
  };

  const effect = effectMap[type];

  await connection.query(
      `INSERT INTO StockTransactions
       (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [stockId, type, effect, qty, dateTime, remarks]
  );
};

const validateIfStockExpired = async (connection, stockId) => {

  const [rows] = await connection.query(`SELECT ExpiryDate FROM Stock WHERE Id = ?`,[stockId]);

  if (!rows.length) {
      throw new Error('Stock not found.');
  }

  const expiryDate = rows[0].ExpiryDate;

  if (!expiryDate) {
      throw new Error('Product has no expiry date.');
  }

  if (moment(expiryDate).isAfter(moment())) {
      throw new Error(
          `Product not expired. Expiry: ${moment(expiryDate).format('DD-MM-YYYY')}`
      );
  }

  return true;
};
const moveToExpiredStock = async (connection,stockId,qty,movedBy) => {

  const insertQuery = `INSERT INTO ExpiredStock
                        (
                            StockId,
                            InvoiceId,
                            ProductId,
                            SupplierId,
                            BatchNumber,
                            ExpiryDate,
                            ExpiredQty,
                            PurchasePrice,
                            GSTPercent,
                            SettledAmount,
                            RemainingAmount,
                            SettlementStatus,
                            MovedAt,
                            MovedBy
                        )
                        SELECT
                            s.Id,
                            s.InvoiceId,
                            s.ProductId,
                            s.SupplierId,
                            s.BatchNumber,
                            s.ExpiryDate,
                            ?,                                -- ExpiredQty
                            idt.PurchasePrice,
                            idt.IGSTPercentage,
                            0,                                -- SettledAmount
                            (? * idt.PurchasePrice * (1 + idt.IGSTPercentage/100)),  -- RemainingAmount
                            'PENDING',
                            NOW(),
                            ?
                        FROM Stock s
                        INNER JOIN InvoiceDetails idt
                            ON idt.InvoiceId = s.InvoiceId
                          AND idt.ProductId = s.ProductId
                        WHERE s.Id = ?;
                      `;

  await connection.query(insertQuery, [qty, qty, movedBy, stockId]);
};

/**
 * Generate a supplier-wise sales and stock report within a given date range.
 *
 * - Calculates opening quantity, sold quantity, remaining quantity.
 * - Includes purchase price (from PurchaseOrderDetails).
 * - Calculates sales revenue (from Sales.TotalValue).
 * - Calculates remaining stock value (RemainingQty × PurchasePrice).
 *
 * @async
 * @function getSalesReportSupplierWise
 * @param {string} fromDate - Start date in **DD-MM-YYYY** format.
 * @param {string} toDate - End date in **DD-MM-YYYY** format.
 * @param {(number|string|null)} [supplierId=''] - Supplier ID, or `null`/`''` to fetch all suppliers.
 * @returns {Promise<Array<Object>>} - Resolves to an array of report rows.
 *
 * Each row contains:
 * - `ProductName` {string}
 * - `BatchNumber` {string}
 * - `PurchasePrice` {number}
 * - `OpeningQty` {number}
 * - `SoldQty` {number}
 * - `RemainingQty` {number}
 * - `SalesTotalValue` {number}
 * - `SupplierName` {string}
 * - `RemainingValue` {number}
 */
/*const getSalesReportSupplierWise = async (fromDate, toDate, supplierId = '') => {
    try {
      // Convert dates to MySQL-compatible format
      const FromDate = moment(fromDate, "DD-MM-YYYY").format("YYYY-MM-DD");
      const ToDate = moment(toDate, "DD-MM-YYYY").format("YYYY-MM-DD");
  
      // SQL query
      const salesReportQuery = `SELECT
            p.ProductName,
            s.BatchNumber,
            pod.PurchasePrice,
            s.CreatedAt,
            DATE_FORMAT( s.ExpiryDate, '%d %b %Y') AS ExpiryDate,
  
            (s.Quantity
             + COALESCE(SUM(CASE WHEN sa.CreatedAt BETWEEN CONCAT(?, ' 00:00:00') 
                                                 AND CONCAT(?, ' 23:59:59')
                                 THEN sa.QuantitySold END), 0)
            ) AS OpeningQuantity,
  
            COALESCE(SUM(CASE WHEN sa.CreatedAt BETWEEN CONCAT(?, ' 00:00:00') 
                                               AND CONCAT(?, ' 23:59:59')
                              THEN sa.QuantitySold END), 0) AS QuantitySold,
  
            s.Quantity AS RemainingQuantity,
  
            COALESCE(SUM(CASE WHEN sa.CreatedAt BETWEEN CONCAT(?, ' 00:00:00') 
                                               AND CONCAT(?, ' 23:59:59')
                              THEN sa.TotalValue END), 0) AS SalesTotalValue,
  
            sup.Name AS SupplierName,
  
            (s.Quantity * pod.PurchasePrice) AS RemainingStockTotalPrice
  
        FROM Stock s
        JOIN Products p ON s.ProductId = p.Id
        LEFT JOIN Sales sa ON sa.StockId = s.Id
        LEFT JOIN Suppliers sup ON p.SupplierId = sup.Id
        LEFT JOIN Invoices inv ON inv.Id = s.InvoiceId
        LEFT JOIN PurchaseOrderDetails pod
               ON pod.PurchaseOrderId = inv.PurchaseOrderId
              AND pod.ProductId = s.ProductId
        WHERE (? IS NULL OR ? = '' OR p.SupplierId = ?)
        GROUP BY p.ProductName, s.BatchNumber, s.Quantity, pod.PurchasePrice, sup.Name
        ORDER BY p.ProductName, s.BatchNumber
      `;
  
      // Debug: show formatted query
      console.log(
        mysql.format(salesReportQuery, [
          FromDate, ToDate,   // OpeningQty
          FromDate, ToDate,   // SoldQty
          FromDate, ToDate,   // SalesTotalValue
          supplierId, supplierId, supplierId
        ])
      );
  
      // Execute query
      const [rows] = await dbConnection
        .execute(salesReportQuery, [
          FromDate, ToDate,   // OpeningQty
          FromDate, ToDate,   // SoldQty
          FromDate, ToDate,   // SalesTotalValue
          supplierId, supplierId, supplierId
        ]);
  
      return rows;
    } catch (error) {
      console.error("Error in getSalesReportSupplierWise:", error);
      throw error;
    }
  };*/
// goa plan
/*const getSalesReportSupplierWise = async (fromDate,toDate,supplier=null) => {
  try {

      const FromDate = moment(fromDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
      const ToDate   = moment(toDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

      const startDate = `${FromDate} 00:00:00`;
      const endDate   = `${ToDate} 23:59:59`;

      let query = `
      SELECT
          s.Id AS StockId,
          sup.Name AS SupplierName,
          p.ProductName,
          s.BatchNumber,
          DATE_FORMAT(s.ExpiryDate,'%Y-%m-%d') AS ExpiryDate,
          IFNULL(id.PurchasePrice,0) AS PurchasePrice,

          IFNULL(opening.OpenQty,0) AS OpeningQuantity,
          IFNULL(period.InQty,0) AS InDuringPeriod,
          IFNULL(period.OutQty,0) AS QuantitySold

      FROM Stock s
      JOIN Products p ON p.Id = s.ProductId
      JOIN Suppliers sup ON sup.Id = s.SupplierId

      LEFT JOIN InvoiceDetails id
             ON id.InvoiceId = s.InvoiceId
            AND id.ProductId = s.ProductId

      LEFT JOIN (
          SELECT
              StockId,
              SUM(
                  CASE
                      WHEN Effect = 'IN' THEN Quantity
                      WHEN Effect = 'OUT' THEN -Quantity
                  END
              ) AS OpenQty
          FROM StockTransactions
          WHERE Timestamp < ?
          GROUP BY StockId
      ) opening ON opening.StockId = s.Id

     
      LEFT JOIN (
          SELECT
              StockId,
              SUM(CASE WHEN Effect='IN' THEN Quantity END) AS InQty,
              SUM(CASE WHEN Effect='OUT' THEN Quantity END) AS OutQty
          FROM StockTransactions
          WHERE Timestamp BETWEEN ? AND ?
          GROUP BY StockId
      ) period ON period.StockId = s.Id

      WHERE 1=1
      `;

      const params = [startDate, startDate, endDate];

      if (supplier) {
          query += ` AND sup.Id = ?`;
          params.push(supplier);
      }

      query += `
      ORDER BY
          sup.Name,
          p.ProductName,
          s.BatchNumber
      `;

      const [rows] = await dbConnection.execute(query, params);

      const finalResult = rows.map(row => {

          const closing =
              Number(row.OpeningQuantity) +
              Number(row.InDuringPeriod) -
              Number(row.QuantitySold);

          const remainingValue =
              closing * Number(row.PurchasePrice);

          return {
              ...row,
              ClosingQuantity: closing,
              RemainingStockTotalPrice: remainingValue
          };
      });

      return finalResult;

  } catch (error) {
      console.error("Optimized Report Error:", error);
      throw error;
  }
};*/


const getSalesReportSupplierWise = async (
  fromDate,
  toDate,
  page = 1,
  supplier = null,
  isDownload = false
) => {
  try {

    const FromDate = moment(fromDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    const ToDate   = moment(toDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

    if (!FromDate || !ToDate) {
        throw new Error("FromDate and ToDate are required");
    }

    const startDate = `${FromDate} 00:00:00`;
    const endDate   = `${ToDate} 23:59:59`;

    /* ---------------- SAFE PAGINATION ---------------- */

    const parsedPage = parseInt(page, 10);
    const safePage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const safeLimit = 20;
    const safeOffset = (safePage - 1) * safeLimit;

    /* ---------------- BASE QUERY ---------------- */

    let baseQuery = `
      FROM Stock s
      JOIN Products p ON p.Id = s.ProductId
      JOIN Suppliers sup ON sup.Id = s.SupplierId

      LEFT JOIN InvoiceDetails id
             ON id.InvoiceId = s.InvoiceId
            AND id.ProductId = s.ProductId

      LEFT JOIN (
          SELECT StockId,
              SUM(CASE
                      WHEN Effect='IN' THEN Quantity
                      WHEN Effect='OUT' THEN -Quantity
                  END) AS OpenQty
          FROM StockTransactions
          WHERE Timestamp < ?
          GROUP BY StockId
      ) opening ON opening.StockId = s.Id

      LEFT JOIN (
          SELECT StockId,
              SUM(CASE WHEN Effect='IN' THEN Quantity END) AS InQty,
              SUM(CASE WHEN Effect='OUT' THEN Quantity END) AS OutQty
          FROM StockTransactions
          WHERE Timestamp BETWEEN ? AND ?
          GROUP BY StockId
      ) period ON period.StockId = s.Id

      WHERE 1=1
      AND IFNULL(period.OutQty,0) > 0
    `;

    const params = [startDate, startDate, endDate];

    if (supplier) {
        baseQuery += ` AND sup.Id = ?`;
        params.push(supplier);
    }

    /* ---------------- COUNT QUERY ---------------- */

    let totalRecords = 0;
    let totalPages = 1;

    if (!isDownload) {
        const countQuery = `
            SELECT COUNT(*) AS total
            ${baseQuery}
        `;

        const [countResult] = await dbConnection.execute(countQuery, params);
        totalRecords = countResult[0].total;
        totalPages = Math.ceil(totalRecords / safeLimit);
    }

    /* ---------------- DATA QUERY ---------------- */

    let dataQuery = `
      SELECT
          s.Id AS StockId,
          sup.Name AS SupplierName,
          p.ProductName,
          s.BatchNumber,
          DATE_FORMAT(s.ExpiryDate,'%Y-%m-%d') AS ExpiryDate,
          IFNULL(id.PurchasePrice,0) AS PurchasePrice,

          IFNULL(opening.OpenQty,0) AS OpeningQuantity,
          IFNULL(period.InQty,0) AS InDuringPeriod,
          IFNULL(period.OutQty,0) AS QuantitySold

      ${baseQuery}

      ORDER BY sup.Name, p.ProductName, s.BatchNumber
    `;

    const finalParams = [...params];

    if (!isDownload) {
      dataQuery += ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;
       // finalParams.push(safeLimit, safeOffset);
    }

    const [rows] = await dbConnection.execute(dataQuery, finalParams);

    /* ---------------- CALCULATIONS ---------------- */

    let grandSold = 0;
    let grandRemainingValue = 0;

    const result = rows.map(row => {

        const closing =
            Number(row.OpeningQuantity) +
            Number(row.InDuringPeriod) -
            Number(row.QuantitySold);

        const remainingValue =
            closing * Number(row.PurchasePrice);

        grandSold += Number(row.QuantitySold);
        grandRemainingValue += remainingValue;

        return {
            ...row,
            ClosingQuantity: closing,
            RemainingStockTotalPrice: remainingValue
        };
    });

    return {
        rows: result,
        pagination: isDownload ? null : {
            page: safePage,
            limit: safeLimit,
            totalRecords,
            totalPages
        },
        grandTotals: {
            grandSold,
            grandRemainingValue
        }
    };

  } catch (error) {
      console.error("Sales Report Error:", error);
      throw error;
  }
};
/**
 * 
 * @param {*} req 
 * @returns 
 */
const updateCustomerDetails= async(req)=>{
    try {
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
        } = req.body;
    
        console.log("Received request body:", req.body);
        const customerId=req.params.customerId
        // Insert customer data
        const insertCustomerQuery = `
            UPDATE  Customers Set CustomerName=?, MobileNo=?, GstNo=?, DlNo=?, BillingAddress=?, BillingState=?, BillingDistrict=?, BillingPincode=?, SupplyAddress=?, SupplyState=?, SupplyDistrict=?, SupplyPincode=? where Id=?
        `;
    console.log(mysql.format(insertCustomerQuery, [
        CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict, 
        BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode,customerId
    ]))
        const [customer] = await dbConnection.execute(insertCustomerQuery, [
            CustomerName, MobileNo, GstNo, DlNo, BillingAddress, BillingState, BillingDistrict, 
            BillingPincode, SupplyAddress, SupplyState, SupplyDistrict, SupplyPincode,customerId
        ]);
    
        return 'Customer updated successfully.'
    } catch (error) {
        console.log(error)
        throw error
    }
}

/**
 * Fetch full challan details for a given customer and challan
 * 
 * @param {number} customerId - ID of the customer
 * @param {number} challanId - ID of the challan
 * @returns {Promise<Array>} List of challan items with product/stock info
 */
const getChallanDetails = async (customerId, challanId) => {
    try {
        const challanDetailsQuery = `SELECT 
                c.ChallanId,
                c.ChallanDate,
                c.Remarks,
                ci.StockId,
                ci.QuantitySold,
                s.BatchNumber,
                s.ExpiryDate,
                p.ProductName
            FROM Challan c
            JOIN Customers cust ON c.CustomerId = cust.Id
            JOIN ChallanItems ci ON c.ChallanId = ci.ChallanId
            JOIN Stock s ON ci.StockId = s.Id
            JOIN Products p ON s.ProductId = p.Id
            WHERE c.CustomerId = ? AND c.ChallanId =?;
        `;

        const [rows] = await dbConnection.execute(challanDetailsQuery, [customerId, challanId]);
        return rows;
    } catch (error) {
        console.error("Error fetching challan details:", error.message);
        throw error;
    }
};

/**
 * Fetches all challans with optional filters, grouped by customer and challan.
 * Also includes Sale IDs for each challan and SaleId per item.
 *
 * @param {Object} filters - Filters to apply
 * @param {string} [filters.fromDate] - Start date in dd-mm-yyyy format
 * @param {string} [filters.toDate] - End date in dd-mm-yyyy format
 * @param {number|string} [filters.customerId] - Customer ID to filter
 * @param {number|string} [filters.challanId] - Challan ID to filter
 * @returns {Promise<Object>} Grouped challans by CustomerId -> ChallanId
 * @throws {Error} If there is a database error
 */
const getAllChallans = async (filters) => {
    try {
      const { fromDate, toDate, customerId, challanId } = filters;
  
      // Convert and validate dates using helper
      const { from, to } = helper.getDateRange(fromDate, toDate);
  
      // Base query with LEFT JOIN to Sales
      let query = `
        SELECT 
          c.ChallanId,
          c.ChallanDate,
          c.Status,
          c.Remarks,
          cust.CustomerName,
          cust.Id AS CustomerId,
          ci.StockId,
          ci.QuantitySold,
          s.BatchNumber,
          s.ExpiryDate,
          p.ProductName,
          sal.Id As SaleId
        FROM Challan c
        JOIN Customers cust ON c.CustomerId = cust.Id
        JOIN ChallanItems ci ON c.ChallanId = ci.ChallanId
        JOIN Stock s ON ci.StockId = s.Id
        JOIN Products p ON s.ProductId = p.Id
        LEFT JOIN Sales sal ON sal.ChallanId = c.ChallanId AND sal.StockId = ci.StockId
        WHERE c.ChallanDate BETWEEN ? AND ?
      `;
  
      const params = [from, to];
  
      // Add filters dynamically
      if (customerId) {
        query += ` AND c.CustomerId = ?`;
        params.push(customerId);
      }
  
      if (challanId) {
        query += ` AND c.ChallanId = ?`;
        params.push(challanId);
      }
  
      query += ` ORDER BY cust.CustomerName, c.ChallanDate DESC, c.ChallanId, ci.StockId`;

      console.log('testing in divas');

      console.log(mysql.format(query,params))

      console.log(' i m in format')
  
      const [rows] = await dbConnection.connection.promise().query(query, params);
  
      // Group by CustomerId -> ChallanId -> items
      const groupedChallans = {};
  
      rows.forEach(row => {
        const custId = row.CustomerId;
        const challanId = row.ChallanId;
  
        if (!groupedChallans[custId]) {
          groupedChallans[custId] = {
            CustomerName: row.CustomerName,
            challans: {}
          };
        }
  
        if (!groupedChallans[custId].challans[challanId]) {
          groupedChallans[custId].challans[challanId] = {
            ChallanDate: row.ChallanDate,
            Status: row.Status,
            Remarks: row.Remarks,
            items: [],
            SaleIds: [] // Collect all sale IDs for this challan
          };
        }
  
        // Add SaleId for this item
        const saleId = row.SaleId ? row.SaleId : null;
        if (saleId && !groupedChallans[custId].challans[challanId].SaleIds.includes(saleId)) {
          groupedChallans[custId].challans[challanId].SaleIds.push(saleId);
        }
  
        // Add item
        groupedChallans[custId].challans[challanId].items.push({
          StockId: row.StockId,
          QuantitySold: row.QuantitySold,
          BatchNumber: row.BatchNumber,
          ExpiryDate: row.ExpiryDate,
          ProductName: row.ProductName,
          SaleId: saleId
        });
      });
  
      return groupedChallans;
  
    } catch (error) {
      console.error("Error fetching challans:", error.message);
      throw new Error("Failed to fetch challans. Please try again.");
    }
  };
  

/**
 * Cancels a challan and reverts stock changes.
 *
 * Steps:
 * 1. Starts a transaction.
 * 2. Updates the challan status to "Cancelled".
 * 3. Retrieves all items linked to the challan.
 * 4. For each item:
 *    - Updates the stock quantity (adds back the sent quantity).
 *    - Inserts a stock transaction record with type "ADD".
 * 5. Commits the transaction if successful, otherwise rolls back.
 *
 * @async
 * @function cancelTheChallan
 * @param {number} challanId - The ID of the challan to cancel.
 * @returns {Promise<{success: boolean, message: string}>} Result object indicating success or failure.
 */
const cancelTheChallan = async (challanId) => {
    const connection = await dbConnection.pool.promise().getConnection();
    //const connection = await dbConnection.pool.getConnection();
  
    try {
      // Begin transaction
      await connection.beginTransaction();
  
      // 1. check whether challan is converted to sale 
            const isChallanconvertedToSale= await isChallanAlreadyConvertedToSale(challanId);
            if(isChallanconvertedToSale.length>0){
                    // Extract SaleIds
                    const saleIds = isChallanconvertedToSale.map(row => row.Id);
                    // Throw an error with SaleIds to inform the user
                    throw new Error(`Challan ${challanId} has already been converted to Sale(s) with Id: ${saleIds.join(', ')}.You have to sales view to cancel the sale.`);
                    }

      //1. check whether challan has already been cancelled.
      const checkChallanStatusQuery=`select * from Challan where ChallanId=? And Status='Cancelled'`;
      const [challanStatuRows]=await connection.query(checkChallanStatusQuery,[challanId])
                    if(challanStatuRows.length>0)
                        throw new Error(`Challan ${challanId} has already been cancelled` )
      // 2. Update Challan status
      const cancelChallanQuery = `UPDATE Challan SET Status = 'Cancelled' WHERE ChallanId = ?`;
      await connection.query(cancelChallanQuery, [challanId]);
  
      // 2. Get Challan items (StockId & Quantity)
      const getQuantitySentQuery = `SELECT StockId, QuantitySold FROM ChallanItems WHERE ChallanId = ?`;
      const [rows] = await connection.query(getQuantitySentQuery, [challanId]);
  
      // 4. Loop through challan items
      for (const item of rows) {
        const { StockId, QuantitySold } = item;
  
        // 4a. Update Stock table (add back quantity)
        const updateStockQuery = `UPDATE Stock SET Quantity = Quantity + ? WHERE Id = ?`;
        await connection.query(updateStockQuery, [QuantitySold, StockId]);
  
        // 4b. Insert into StockTransaction table
        const insertTransactionQuery = `
          INSERT INTO StockTransactions (StockId, TransactionType, Quantity, Remarks, Timestamp)
          VALUES (?, 'ADD', ?, 'Cancelled Challan #${challanId}', NOW())
        `;
        await connection.query(insertTransactionQuery, [StockId, QuantitySold]);
      }
  
      // 4. Commit transaction
      await connection.commit();
      connection.release();
  
     // return { success: true, message: "Challan cancelled successfully" };
  
    } catch (error) {
      // Rollback if error
      await connection.rollback();
      connection.release();
      console.error(error);
      throw error
     // return { success: false, message: "Error cancelling challan" };
    }
  };
  /**
 * Marks a challan as delivered.
 *
 * Executes an SQL UPDATE on the Challan table to set the status to "Delivered"
 * for the given challan ID. Errors are logged and rethrown to be handled by the caller.
 *
 * @async
 * @function deliverTheProduct
 * @param {number} challanId - The unique identifier of the challan to mark as delivered.
 * @returns {Promise<void>} Resolves when the operation is successful, otherwise throws an error.
 * @throws {Error} Will throw an error if the database update fails.
 */
  
const deliverTheProduct = async (challanId) => {
    try {
        const challanStatusQuery=`select * from Challan where Status='Delivered' And ChallanId=?`;
        const [challanStatus]= await dbConnection.execute(challanStatusQuery,[challanId])
            if(challanStatus.length>0)
                throw new Error(`challan ${challanId} has already been delivered.`)
        const challanDeliveryQuery = `UPDATE Challan 
                                            SET Status = 'Delivered' 
                                            WHERE ChallanId = ?
        `;
        await dbConnection.connection.promise().query(challanDeliveryQuery, [challanId]);
    } catch (error) {
        console.error("Error in deliverTheProduct:", error);
       throw error
    }
};
  
/**
 * Converts a challan into a sale:
 * 1. Validates challan status:
 *    - If Cancelled → throws error
 *    - If Delivered → skips conversion
 *    - If Pending → marks as Delivered
 * 2. Generates a new Invoice ID for the sale.
 * 3. Fetches challan items & calculates price, SGST, CGST, totals.
 * 4. Inserts records into Sales table.
 * 5. Logs a stock transaction with ADD=0 (audit purpose).
 *
 * @param {number} challanId - The Challan ID being converted.
 * @param {number} customerId - The Customer ID for the sale.
 * @returns {Promise<string>} invoiceId - The generated Invoice ID.
 * @throws {Error} If challan not found, cancelled, or data missing.
 */
const convertToSale = async (challanId, customerId) => {
    const connection = await dbConnection.pool.promise().getConnection();
   // const connection = await dbConnection.pool.getConnection();
    let invoiceId = null;
  
    try {
      await connection.beginTransaction();
  
      // 1. Fetch challan status
      const [statusRows] = await connection.query(
        `SELECT Status FROM Challan WHERE ChallanId = ?`,
        [challanId]
      );
      if (statusRows.length === 0) {
        throw new Error(`Challan with Id ${challanId} does not exist.`);
      }
  
      const status = statusRows[0].Status;
      if (status === "Cancelled") {
        throw new Error(`Challan with Id ${challanId} is already cancelled.`);
      }
      //2. if status is pending then make it deliver
      if (status === "Pending") {
        await connection.query(
            `UPDATE Challan SET Status = 'Delivered' WHERE ChallanId = ?`,
            [challanId]
          );
      }
  
     
      //3.check whether challan has been alread converted to sale 
      //challanId will exist in sales table then display all sale id with challan id 

      const isChallanconvertedToSale= await isChallanAlreadyConvertedToSale(challanId);
            if(isChallanconvertedToSale.length>0){
                    // Extract SaleIds
                    const saleIds = isChallanconvertedToSale.map(row => row.Id);
                    // Throw an error with SaleIds to inform the user
                    throw new Error(`Challan ${challanId} has already been converted to Sale(s) with Id: ${saleIds.join(', ')}`);
                  }

      const isItConvertedTosaleQuery=`select * from Sales where CustomerId=? And ChallanId=?`
      // 4. Get challan items
      const [challanItems] = await connection.query(
        `SELECT StockId, QuantitySold FROM ChallanItems WHERE ChallanId = ?`,
        [challanId]
      );
      if (challanItems.length === 0) {
        throw new Error("No items found in the challan.");
      }
  
      // 5. Generate Invoice ID
      const todayDate = moment().format("YYYY-MM-DD");
      const [countRow] = await connection.query(
        `SELECT COUNT(DISTINCT InvoiceId) AS count 
         FROM Sales 
         WHERE DATE(CreatedAt) = ?`,
        [todayDate]
      );
      const totalCount = countRow[0].count;
      const formattedDate = moment().format("YYYYMMDD");
      const sequence = String(totalCount + 1).padStart(3, "0");
      invoiceId = `INV-${formattedDate}-${sequence}`;
  
      const customerName = await getCustomerName(customerId);
      const salesData = [];
      const stockTransaction = [];
  
      // 6. Prepare Sales Data
      for (const item of challanItems) {
        const { StockId, QuantitySold } = item;
  
        // Price from customer pricing
        const [priceRow] = await connection.execute(
          `SELECT cp.SellingPrice
           FROM Stock s
           JOIN CustomerPricing cp ON s.ProductId = cp.ProductId
           WHERE s.Id = ? AND cp.CustomerId = ? AND cp.Status = 1`,
          [StockId, customerId]
        );
        if (priceRow.length === 0) {
            const link = `<a href="/billing/updatePrice/${customerId}">Set Price</a>`;
            throw new Error(
              `No SellingPrice found for StockId: ${StockId}, Customer: ${customerName}. ${link}`
            );
          }
        const price = parseFloat(priceRow[0].SellingPrice);
  
        // IGST from purchase order
        const [igstRow] = await connection.query(
          `SELECT pod.IGSTPercentage
                    FROM Stock s
                    JOIN Invoices i ON s.InvoiceId = i.Id
                    JOIN PurchaseOrderDetails pod ON i.PurchaseOrderId = pod.Id
                    WHERE s.Id = ?;`,
          [StockId]
        );
        if (igstRow.length === 0) {
          throw new Error(`No IGST found for StockId: ${StockId}`);
        }
        const IGST = parseFloat(igstRow[0].IGSTPercentage);
        const SGST = IGST / 2;
        const CGST = IGST / 2;
  
        const totalValue = QuantitySold * price;
        const sgstAmount = (totalValue * SGST) / 100;
        const cgstAmount = (totalValue * CGST) / 100;
        const totalWithTax = totalValue + sgstAmount + cgstAmount;
  
        salesData.push([
          customerId,
          StockId,
          QuantitySold,
          price,
          SGST,
          sgstAmount,
          CGST,
          cgstAmount,
          totalValue,
          totalWithTax,
          invoiceId,
          challanId,
          1 // status = Active
        ]);

       /* stockTransaction.push([
            StockId,
            QuantitySold,
            'update',
            `Challan ${challanId} converted to Sale (Invoice ${invoiceId}`,
            NOW()

        ])*/
         // 🔹 Log into StockTransaction (QtyOut since it's a sale)
            stockTransaction.push([
                StockId,
                0, // QtyAdd
                "Update", // Action
                `Challan ${challanId} converted to Sale (Invoice ${invoiceId})`,
                new Date()
            ]);
      }
  
      // 7. Insert into Sales
      await connection.query(
        `INSERT INTO Sales 
         (CustomerId, StockId, QuantitySold, SalePrice, Sgst, SgstAmount, Cgst, CgstAmount, TotalValue, TotalValueWithTax, InvoiceId,ChallanId, Status) 
         VALUES ?`,
        [salesData]
      );
  
      // 8. Log stock transaction (audit only, no qty changes)
      await connection.query(
        `INSERT INTO StockTransactions 
         (StockId, Quantity, TransactionType, Remarks, TimeStamp) 
         VALUES ?`,
        [stockTransaction]
      );
  
      await connection.commit();
      return invoiceId;
    } catch (error) {
      await connection.rollback();
      console.error("Error in convertToSale:", error);
      throw error;
    } finally {
      connection.release();
    }
  };
/**
 * Checks if a challan has already been converted to a sale for a given customer.
 *
 * @async
 * @function isChallanAlreadyConvertedToSale
 * @param {number} challanId - The ID of the challan to check.
 * @param {number} customerId - The ID of the customer associated with the challan.
 * @returns {Promise<boolean>} - Resolves to `true` if the challan is already converted to sale,
 *                               otherwise `false`.
 * @throws {Error} Will throw an error if the database query fails.
 */
const isChallanAlreadyConvertedToSale = async (challanId) => {
    try {
      const query = `
        SELECT * 
        FROM Sales
        WHERE  ChallanId = ?
      `;
      console.log(mysql.format(query,[challanId]))
      const [rows] = await dbConnection.execute(query, [challanId]);
      console.log(rows);
      console.log('i m i nrow check')
      return rows;
    } catch (error) {
      console.error("Error in isChallanAlreadyConvertedToSale:", error);
      throw error;
    }
  };
  
  /**
 * Fetches the list of all customers along with their sales, payments, pending dues, and last payment date.
 *
 * @async
 * @function getCustomerListWithDues
 * @returns {Promise<Array<Object>>} Returns a promise that resolves to an array of customer ledger objects.
 * Each object contains:
 *  - CustomerId {number} : ID of the customer
 *  - CustomerName {string} : Name of the customer
 *  - TotalSales {number} : Total sales amount for the customer
 *  - TotalPayments {number} : Total payments made by the customer
 *  - PendingAmount {number} : Pending amount (TotalSales - TotalPayments)
 *  - LastPaymentDate {Date|null} : Date of the last payment, null if no payments made
 * 
 * @throws {Error} Throws an error if database query fails
 */
const getCustomerListWithDues = async () => {

    const query = `SELECT 
                        c.Id AS CustomerId,
                        c.CustomerName,
                        IFNULL(CAST(s.TotalSales AS DECIMAL(10,2)),0) AS TotalSales,
                        IFNULL(CAST(p.TotalPayments AS DECIMAL(10,2)),0) AS TotalPayments,
                        (IFNULL(CAST(s.TotalSales AS DECIMAL(10,2)),0) - IFNULL(CAST(p.TotalPayments AS DECIMAL(10,2)),0)) AS PendingAmount,
                        p.LastPaymentDate
                    FROM 
                        Customers c
                    LEFT JOIN 
                        (SELECT CustomerId, SUM(TotalValueWithTax) AS TotalSales
                        FROM Sales
                        GROUP BY CustomerId) s ON s.CustomerId = c.Id
                    LEFT JOIN 
                        (SELECT CustomerId, SUM(Credit) AS TotalPayments, MAX(PaymentDate) AS LastPaymentDate
                        FROM Payments
                        GROUP BY CustomerId) p ON p.CustomerId = c.Id
                    ORDER BY 
                        c.Id ASC;

    `;
  
    try {
      const [rows] = await dbConnection.execute(query);
      return rows;
    } catch (err) {
      console.error('Error fetching customer ledger:', err);
      throw err;
    }
  };
  
 /**
 * Fetches the product name for a given stock ID by joining the Stock and Products tables.
 *
 * @async
 * @function getProductFromStockId
 * @param {number} stockId - The ID of the stock item to look up.
 * @returns {Promise<string|null>} The product name if found, otherwise `null`.
 * @throws {Error} If the database query fails.
 */
const getProductFromStockId = async (stockId,connection) => {
    try {
      const query = `
        SELECT p.ProductName
        FROM Stock s
        JOIN Products p ON p.Id = s.ProductId
        WHERE s.Id = ?
      `;
  
      const [rows] = await connection.execute(query, [stockId]); // Assuming db.execute is used (mysql2)
  
      if (rows.length > 0) {
        return rows[0].ProductName;
      }
      return null;
    } catch (error) {
      console.error("Error fetching product from stockId:", error);
      throw error;
    }
  };
  
const getNonMovableStocks= async( supplierId, search, page, pageSize )=> {
    const offset = (page - 1) * pageSize;

    console.log(offset);
    console.log(pageSize)
  
    const sql = `SELECT *
FROM (
    SELECT
        sup.Id           AS SupplierId,
        sup.Name         AS SupplierName,

        p.Id             AS ProductId,
        p.ProductName    AS ProductName,

        s.Id             AS StockId,
        s.BatchNumber,
        s.Quantity       AS CurrentStock,
        s.ExpiryDate,
        s.CreatedAt      AS StockCreatedAt,

        IFNULL(SUM(sa.QuantitySold), 0) AS QuantitySold,
        MAX(sa.CreatedAt)               AS LastSaleDate,

        COALESCE(MAX(sa.CreatedAt), s.CreatedAt) AS BaselineDate,

        DATEDIFF(
            CURDATE(),
            COALESCE(MAX(sa.CreatedAt), s.CreatedAt)
        ) AS MovementAgeDays,

        pod.PurchasePrice,
        (s.Quantity * pod.PurchasePrice) AS ValueAtCost,

        CASE
            WHEN s.ExpiryDate < CURDATE()
                THEN 'EXPIRED'
            WHEN s.ExpiryDate BETWEEN CURDATE()
                 AND DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
                THEN 'EXPIRING_SOON'
            WHEN DATEDIFF(
                    CURDATE(),
                    COALESCE(MAX(sa.CreatedAt), s.CreatedAt)
                 ) >= 60
                THEN 'NON_MOVING'
            ELSE 'OK'
        END AS StatusFlag

    FROM Stock s
    JOIN Products p
        ON p.Id = s.ProductId
    JOIN Suppliers sup
        ON sup.Id = s.SupplierId
    LEFT JOIN Sales sa
        ON sa.StockId = s.Id
    LEFT JOIN Invoices i
        ON i.Id = s.InvoiceId
    LEFT JOIN PurchaseOrderDetails pod
        ON pod.PurchaseOrderId = i.PurchaseOrderId
       AND pod.ProductId = s.ProductId

    WHERE
        (? IS NULL OR s.SupplierId = ?)
    AND (
        ? = ''
        OR CAST(p.ProductName AS CHAR CHARACTER SET utf8mb4)
           LIKE CONCAT('%', CAST(? AS CHAR CHARACTER SET utf8mb4), '%')
    )
    
    AND
        s.Quantity > 0

    GROUP BY
        s.Id,
        sup.Id,
        p.Id,
        pod.PurchasePrice
) x
ORDER BY
    FIELD(
        CAST(x.StatusFlag AS CHAR CHARACTER SET utf8mb4),
        'EXPIRED',
        'EXPIRING_SOON',
        'NON_MOVING',
        'OK'
    ),
    x.ExpiryDate,
    x.BaselineDate
LIMIT ${pageSize} OFFSET ${offset};

`;
  
    const params = [
      supplierId,
      supplierId,
      search,
      search
    ];
    console.log(mysql.format(sql,params))
    const [rows] = await dbConnection.execute(sql, params);
    return  rows ;
  }
  
const getNonMovableSummary=async( supplierId, search)=> {
    const sql = `
     SELECT
    COUNT(*) AS totalCount,

    SUM(CurrentStock) AS totalCurrentStock,

    SUM(
        CASE
            WHEN CAST(StatusFlag AS CHAR CHARACTER SET utf8mb4) = 'EXPIRED'
            THEN 1 ELSE 0
        END
    ) AS expiredCount,

    SUM(
        CASE
            WHEN CAST(StatusFlag AS CHAR CHARACTER SET utf8mb4) = 'EXPIRING_SOON'
            THEN 1 ELSE 0
        END
    ) AS expiringSoonCount,

    SUM(
        CASE
            WHEN CAST(StatusFlag AS CHAR CHARACTER SET utf8mb4) = 'NON_MOVING'
            THEN 1 ELSE 0
        END
    ) AS nonMovingCount

FROM (
    /* === your main stock query (same as earlier) === */
    SELECT
        s.Quantity AS CurrentStock,

        CASE
            WHEN s.ExpiryDate < CURDATE()
                THEN 'EXPIRED'
            WHEN s.ExpiryDate BETWEEN CURDATE()
                 AND DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
                THEN 'EXPIRING_SOON'
            WHEN DATEDIFF(
                    CURDATE(),
                    COALESCE(MAX(sa.CreatedAt), s.CreatedAt)
                 ) >= 60
                THEN 'NON_MOVING'
            ELSE 'OK'
        END AS StatusFlag,

        p.ProductName,
        s.SupplierId

    FROM Stock s
    JOIN Products p ON p.Id = s.ProductId
    LEFT JOIN Sales sa ON sa.StockId = s.Id

    WHERE
        (? IS NULL OR s.SupplierId = ?)
    AND (
        ? = ''
        OR CAST(p.ProductName AS CHAR CHARACTER SET utf8mb4)
           LIKE CONCAT('%', CAST(? AS CHAR CHARACTER SET utf8mb4), '%')
    )

    GROUP BY s.Id
) x;

    `;
  
    const params = [supplierId, supplierId, search, search];
    const [rows] = await dbConnection.execute(sql, params);
    return rows[0] || {};
  }

/**
 * Fetch expired stock items with available quantity.
 * Supports pagination and optional filtering by:
 *  - SupplierId (vendor-wise)
 *  - ProductId
 *
 * Default behavior:
 *  - If SupplierId is not provided → returns expired stock for all suppliers
 *  - If SupplierId is provided → returns expired stock only for that supplier
 *
 * @async
 * @function getExpiredProductDetails
 * @param {Object} req - Express request object
 * @param {Object} req.query - Query parameters
 * @param {number} req.query.page - Page number (default: 1)
 * @param {number} req.query.limit - Records per page (default: 20)
 * @param {number} req.query.productId - Optional product filter
 * @param {number} req.query.supplierId - Optional supplier (vendor) filter
 * @returns {Promise<Object>} Expired stock list with pagination metadata
 */
const getExpiredProductDetails = async (req) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const offset = (page - 1) * limit;

        const { productId, supplierId } = req.query;

        let whereClause = `
            WHERE Stock.Quantity > 0
              AND Stock.ExpiryDate < CURDATE()
        `;
        const params = [];

        // Optional supplier (vendor) filter
        if (supplierId) {
            whereClause += ` AND Stock.SupplierId = ?`;
            params.push(supplierId);
        }

        // Optional product filter
        if (productId) {
            whereClause += ` AND Products.Id = ?`;
            params.push(productId);
        }

        // Main data query
        const dataQuery = `
            SELECT 
                Stock.Id,
                Products.Id AS ProductId,
                Products.ProductName,
                Stock.BatchNumber,
                Stock.Quantity, 
                DATE_FORMAT(Stock.ExpiryDate, '%d-%m-%Y') AS ExpiryDate,
                Stock.CreatedAt,
                Suppliers.Name As SupplierName,
                Stock.SupplierId,
                (
                    SELECT IGSTPercentage
                    FROM PurchaseOrderDetails
                    WHERE ProductId = Products.Id
                    ORDER BY Id DESC
                    LIMIT 1
                ) AS IGSTPercentage
            FROM Stock
            JOIN Products ON Stock.ProductId = Products.Id
            LEFT JOIN Suppliers ON Stock.SupplierId = Suppliers.Id
            ${whereClause}
            ORDER BY Stock.ExpiryDate ASC
            LIMIT ${limit} OFFSET ${offset};
        `;

        // Count query for pagination
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM Stock
            JOIN Products ON Stock.ProductId = Products.Id
            ${whereClause};
        `;

        const [[countResult]] = await dbConnection.connection
            .promise()
            .execute(countQuery, params);
//console.log(mysql.format(dataQuery, [...params, limit, offset]));
console.log('hi sexa')
        const [rows] = await dbConnection.connection
            .promise()
            .execute(dataQuery, [...params]);

        return {
            currentPage: page,
            pageSize: limit,
            totalRecords: countResult.total,
            totalPages: Math.ceil(countResult.total / limit),
            data: rows
        };
    } catch (error) {
        throw error;
    }
};
/**
 * Moves expired products from the live Stock table to the ExpiredStock table,
 * logs the movement in the StockTransactions table, and updates the Stock table
 * to mark the products as expired.
 *
 * This function is used in a pharmaceutical stock management system where
 * certain products have reached their expiry date. The expired stock cannot be sold,
 * but it can be settled with suppliers through price adjustments on future purchases.
 *
 * Business Context:
 * 1. When a stock batch expires, its value (PurchasePrice × Quantity) is recorded in ExpiredStock.
 * 2. The ExpiredStock table acts as a snapshot for auditing and tracking expired inventory.
 * 3. The stock movement is logged in StockTransactions with negative quantity, ensuring
 *    a complete audit trail for accounting and inventory control.
 * 4. The stock table is updated to prevent the expired products from being sold.
 * 5. Suppliers can later reduce the purchase price of new products to settle the value
 *    of expired products, tracked via the ExpiredStock and subsequent settlement logic.
 *
 * Technical Steps:
 * 1️⃣ Insert expired stock into ExpiredStock table (snapshot for settlement and audit).
 * 2️⃣ Log stock transaction in StockTransactions table (negative quantity).
 * 3️⃣ Update Stock table to set Quantity = 0 and Status = 'EXPIRED' (prevent selling).
 * 4️⃣ All steps run inside a single database transaction to maintain data consistency.
 *
 * @param {number} userId - The ID of the user performing this action (for audit/logging).
 * @param {number[]} stockIds - Array of Stock table IDs representing expired products.
 *
 * @returns {Promise<string>} - Returns a success message when the operation completes.
 *
 * @throws {Error} - Throws an error if no stock is selected, or if any DB operation fails.
 *
 * Example Usage:
 *   const stockIdsToExpire = [12, 15, 20];
 *   try {
 *       const result = await moveExpiredProduct(currentUser.id, stockIdsToExpire);
 *       console.log(result); // "Expired stock moved successfully."
 *   } catch (err) {
 *       console.error("Failed to move expired stock:", err.message);
 *   }
 *
 * Notes for Developers:
 * - Always wrap this call in an authenticated context to ensure the userId is valid.
 * - Ensure stockIds passed are valid, non-expired stock items.
 * - Do not manually update the Stock table outside of this function for expired products.
 * - This function supports multiple stock items at once.
 */
const moveExpiredProduct = async (stockIds, userId) => {
  const connection = await dbConnection.connection.promise().getConnection();

  try {
      if (!stockIds || stockIds.length === 0) {
          throw new Error("No stock selected.");
      }

      await connection.beginTransaction();

      // 1️⃣ Prevent double move
      const [alreadyMoved] = await connection.query(
          `SELECT StockId 
           FROM ExpiredStock 
           WHERE StockId IN (${stockIds.map(() => '?').join(',')})`,
          stockIds
      );
console.log('1')
      if (alreadyMoved.length > 0) {
          throw new Error("Some selected stock is already moved to expired.");
      }

      console.log('2')
      // 2️⃣ Insert into ExpiredStock (with RemainingAmount)
      const insertQuery = `
          INSERT INTO ExpiredStock
          (
              StockId,
              InvoiceId,
              ProductId,
              SupplierId,
              BatchNumber,
              ExpiryDate,
              ExpiredQty,
              PurchasePrice,
              GSTPercent,
              ExpiredAmount,
              RemainingAmount,
              MovedBy
          )
          SELECT
              s.Id,
              s.InvoiceId,
              s.ProductId,
              s.SupplierId,
              s.BatchNumber,
              s.ExpiryDate,
              s.Quantity,
              idt.PurchasePrice,
              idt.IGSTPercentage,
              (s.Quantity * idt.PurchasePrice * (1 + idt.IGSTPercentage/100)),
              (s.Quantity * idt.PurchasePrice * (1 + idt.IGSTPercentage/100)),
              ?
          FROM Stock s
          INNER JOIN InvoiceDetails idt
              ON idt.InvoiceId = s.InvoiceId
             AND idt.ProductId = s.ProductId
          WHERE s.Id IN (${stockIds.map(() => '?').join(',')})
      `;
console.log(mysql.format(insertQuery,[userId, ...stockIds]))
      await connection.query(insertQuery, [userId, ...stockIds]);
console.log('3')
      // 3️⃣ Log transaction
      const stockTransactionQuery = `
          INSERT INTO StockTransactions
          (
              StockId,
              TransactionType,
              Quantity,
              TimeStamp,
              Remarks
          )
          SELECT
              s.Id,
              'EXPIRED',
              -s.Quantity,
              NOW(),
              'Stock moved due to expiry'
          FROM Stock s
          WHERE s.Id IN (${stockIds.map(() => '?').join(',')})
      `;
console.log(mysql.format(stockTransactionQuery,stockIds))
console.log('4')
      await connection.query(stockTransactionQuery, stockIds);

     

      // 4️⃣ Update stock
      const updateStockQuery = `
          UPDATE Stock
          SET Quantity = 0
          WHERE Id IN (${stockIds.map(() => '?').join(',')})
      `;
console.log(updateStockQuery,stockIds)
      await connection.query(updateStockQuery, stockIds);
   console.log('5')

      await connection.commit();

      

      return "Expired stock moved successfully.";

  } catch (err) {
      await connection.rollback();
      throw err;
  } finally {
      connection.release();
  }
};

/**
 * Get paginated purchase price history of a product.
 *
 * Purpose:
 * --------
 * This service fetches historical purchase pricing information
 * of a specific product across purchase orders.
 * It is mainly used for:
 * - Price trend analysis
 * - Procurement audits
 * - Supplier & invoice tracking
 *
 * Data Source & Joins:
 * -------------------
 * - PurchaseOrderDetails → Purchase price per PO
 * - Products → Product name & supplier reference
 * - Suppliers → Supplier name
 * - PurchaseOrders → Purchase date
 * - Invoices → Supplier invoice number (optional)
 *
 * Important Notes:
 * ----------------
 * - SupplierId is taken from Products table
 * - LEFT JOIN is used for invoices because invoice
 *   may not exist at query time
 * - Pagination is mandatory to avoid large data loads
 *
 * @param {number} productId - Unique identifier of the product
 * @param {number} page - Current page number (default: 1)
 * @param {number} limit - Records per page (default: 10)
 *
 * @returns {Promise<Object>} {
 *   data: Array,
 *   pagination: {
 *     totalRecords,
 *     totalPages,
 *     currentPage,
 *     limit
 *   }
 * }
 */

const getProductPriceHistory = async (productId,supplierId,page = 1,limit = 20) => {
    const connection = await dbConnection.connection.promise().getConnection();

    try {
        if (!productId) {
            throw new Error("ProductId is required.");
        }

        const offset = (page - 1) * limit;

        // 🔢 Count total records
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM PurchaseOrderDetails pod
            WHERE pod.ProductId = ?
        `;

        const [[{ total }]] = await connection.execute(
            countQuery,
            [productId]
        );

        // 📄 Main paginated query
        const dataQuery = `SELECT 
                                pod.PurchasePrice,
                                pod.PurchaseOrderId,
                                inv.SupplierInvoiceNo,
                                pod.PurchaseOrderId,
                                po.PoDate,
                                p.Id AS ProductId,
                                p.ProductName,
                                p.SupplierId,
                                s.Name AS SupplierName

                            FROM PurchaseOrderDetails pod
                            JOIN Products p 
                                ON pod.ProductId = p.Id
                            JOIN PurchaseOrders po 
                                ON pod.PurchaseOrderId = po.Id
                            JOIN Suppliers s 
                                ON p.SupplierId = s.Id
                            LEFT JOIN (
                                SELECT 
                                    PurchaseOrderId,
                                    MAX(SupplierInvoiceNo) AS SupplierInvoiceNo
                                FROM Invoices
                                GROUP BY PurchaseOrderId
                            ) inv 
                                ON inv.PurchaseOrderId = pod.PurchaseOrderId

                            WHERE pod.ProductId = ?
                            ORDER BY po.PoDate DESC
                            LIMIT ${limit} OFFSET ${offset}
                            `;
console.log(mysql.format(dataQuery,[productId, limit, offset]))
        const [rows] = await connection.execute(
            dataQuery,
            [productId]
        );
console.log(rows);
        return {
            data: rows,
            pagination: {
                totalRecords: total,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                limit
            }
        };

    } catch (error) {
        console.error(
            "Error fetching product purchase price history:",
            error
        );
        throw error;
    }
};
/**
 * Model: Fetch Moved Expired Products
 *
 * Applies:
 *  - Supplier filter (optional)
 *  - Status filter (optional)
 *  - Pagination (LIMIT + OFFSET)
 *
 * Status Logic:
 *  PENDING  → RemainingAmount = ExpiredAmount
 *  PARTIAL  → RemainingAmount > 0 AND SettledAmount > 0
 *  SETTLED  → RemainingAmount <= 0
 */
const getListOfMovedExpiredProduct = async ({supplierId,status,limit,offset}) => {
  let whereConditions = [];
  let params = [];

  if (supplierId) {
      whereConditions.push("es.SupplierId = ?");
      params.push(supplierId);
  }

  if (status) {
      if (status === 'PENDING') {
          whereConditions.push("(es.ExpiredAmount - IFNULL(es.SettledAmount,0)) > 0 AND IFNULL(es.SettledAmount,0) = 0");
      } else if (status === 'PARTIAL') {
          whereConditions.push("IFNULL(es.SettledAmount,0) > 0 AND (es.ExpiredAmount - IFNULL(es.SettledAmount,0)) > 0");
      } else if (status === 'SETTLED') {
          whereConditions.push("(es.ExpiredAmount - IFNULL(es.SettledAmount,0)) <= 0");
      }
  }

  const whereClause = whereConditions.length? `WHERE ${whereConditions.join(" AND ")}`: "";

  const dataQuery = `SELECT
                          es.Id,
                          es.SupplierId,
                          s.Name AS SupplierName,
                          es.ProductId,
                          p.ProductName,
                          es.BatchNumber,
                          es.ExpiryDate,
                          es.ExpiredQty,
                          es.ExpiredAmount,
                          IFNULL(es.SettledAmount,0) AS SettledAmount,
                          (es.ExpiredAmount - IFNULL(es.SettledAmount,0)) AS RemainingAmount,

                          CASE
                              WHEN (es.ExpiredAmount - IFNULL(es.SettledAmount,0)) <= 0 THEN 'SETTLED'
                              WHEN IFNULL(es.SettledAmount,0) > 0 THEN 'PARTIAL'
                              ELSE 'PENDING'
                          END AS CurrentStatus

                      FROM ExpiredStock es
                      INNER JOIN Products p ON es.ProductId = p.Id
                      INNER JOIN Suppliers s ON es.SupplierId = s.Id
                      ${whereClause}
                      ORDER BY es.Id DESC
                      LIMIT ${limit} OFFSET ${offset}
  `;

  const countQuery = `SELECT 
                        COUNT(*) AS total
                            FROM ExpiredStock es
                            ${whereClause}`;

  const [rows] = await dbConnection.connection.promise().query(dataQuery, [...params]);
  const [countResult] = await dbConnection.connection.promise().query(countQuery, params);

  return {
      rows,
      total: countResult[0].total
  };
};

/**
 * Search Supplier Invoices by keyword and supplier ID.
 *
 * This function fetches up to 10 supplier invoices filtered by:
 *  - supplierId (required)
 *  - keyword (partial match on SupplierInvoiceNo)
 *
 * Results are ordered by InvoiceDate in descending order (latest first).
 *
 * @async
 * @function searchSupplierInvoice
 * @param {Object} params - Function parameters
 * @param {string} params.keyword - Keyword to search in SupplierInvoiceNo (required)
 * @param {number} params.supplierId - Supplier ID to filter invoices (required)
 *
 * @returns {Promise<Array>} Resolves with an array of invoice objects:
 * [
 *   {
 *     Id: number,
 *     SupplierInvoiceNo: string,
 *     InvoiceDate: Date
 *   }
 * ]
 *
 * @throws {Error} Throws error if supplierId or keyword is missing
 * @throws {Error} Throws database error if query fails
 */
const searchSupplierInvoice = async ({ keyword, supplierId }) => {
  try {
      // ✅ Validation
      if (!supplierId) {
          const err = new Error("Supplier ID is required");
          err.statusCode = 400;
          throw err;
      }

      if (!keyword) {
          const err = new Error("Keyword is required");
          err.statusCode = 400;
          throw err;
      }

      const query = `
            SELECT 
                i.Id,
                i.SupplierInvoiceNo,
                i.InvoiceDate,
                i.TotalAmount,
                po.Id AS PurchaseOrderId,
                po.PoDate
            FROM Invoices i
            JOIN PurchaseOrders po 
                ON i.PurchaseOrderId = po.Id
            WHERE po.Status = 'Received'
            AND po.SupplierId=?
            AND i.SupplierInvoiceNo LIKE ?
            ORDER BY i.InvoiceDate DESC
            LIMIT 10
        `;


      const [rows] = await dbConnection.connection.promise().query(query, [
          supplierId,
          `%${keyword}%`
      ]);

      return rows;

  } catch (error) {
      console.error("Error in searchSupplierInvoice:", error.message);
      throw error;
  }
};

/**
 * Fetch products of a supplier invoice
 * Used in Expired Stock Settlement modal
 *
 * @param {number} invoiceId
 * @param {number} supplierId
 * @returns {Promise<Array>}
 */

const getInvoiceProducts = async (invoiceId) => {

  try {

      if (!invoiceId) {
          throw new Error('Invalid invoiceId.');
      }

      const query = `
          SELECT
              id.Id As InvoiceDetailId,
              id.InvoiceId,
              id.ProductId,
              p.ProductName,
              id.ReceivedQuantity As Quantity,
              id.PurchasePrice,
              id.IGSTPercentage,
              (id.ReceivedQuantity * id.PurchasePrice) AS LineAmount
          FROM InvoiceDetails id
          INNER JOIN Invoices inv 
              ON inv.Id = id.InvoiceId
          INNER JOIN Products p
              ON p.Id = id.ProductId
          WHERE id.InvoiceId = ?
          ORDER BY p.ProductName ASC
      `;

      const [rows] = await dbConnection
          .connection
          .promise()
          .query(query, [invoiceId]);

      return rows;

  } catch (error) {

      console.error('BillingModel.getInvoiceProducts Error:', error);
      throw error; // important: let controller handle response
  }
};

/**
 * ------------------------------------------------------------
 * getLastThreePricesBulk
 * ------------------------------------------------------------
 * Fetches the last 3 purchase prices for multiple products
 * for a specific supplier.
 *
 * 📌 Business Purpose:
 * When settling expired stock through price difference,
 * we need historical purchase prices of products
 * to allow the user to select a previous price easily.
 *
 * 📌 What This Function Does:
 * 1️⃣ Accepts multiple Product IDs.
 * 2️⃣ Filters records by Supplier ID.
 * 3️⃣ Orders by latest InvoiceDate (DESC).
 * 4️⃣ Returns only the last 3 prices per product.
 * 5️⃣ Groups results by ProductId.
 *
 * 📥 Params:
 * @param {number[]} productIds - Array of Product IDs
 * @param {number} supplierId - Supplier ID
 *
 * 📤 Returns:
 * {
 *   1: [
 *        { PurchasePrice: 120, InvoiceDate: '10-01-2026' },
 *        { PurchasePrice: 110, InvoiceDate: '01-01-2026' },
 *        { PurchasePrice: 105, InvoiceDate: '20-12-2025' }
 *      ],
 *   2: [...]
 * }
 *
 * ⚠️ Throws:
 * - Error if DB query fails
 * - Error if invalid parameters
 *
 * ------------------------------------------------------------
 */

const getLastThreePricesBulk = async (productIds, supplierId) => {

  try {

      // 🔹 Basic Validation
      if (!Array.isArray(productIds) || productIds.length === 0) {
          throw new Error('Product IDs must be a non-empty array.');
      }

      if (!supplierId) {
          throw new Error('Supplier ID is required.');
      }

      const placeholders = productIds.map(() => '?').join(',');

      const query = `SELECT 
                          id.ProductId,
                          id.PurchasePrice,
                          DATE_FORMAT(inv.InvoiceDate, '%d-%m-%Y') AS InvoiceDate
                      FROM InvoiceDetails id
                      INNER JOIN Invoices inv
                          ON inv.Id = id.InvoiceId
                      INNER JOIN PurchaseOrders po
                          ON po.Id = inv.PurchaseOrderId
                      WHERE id.ProductId IN (${placeholders})
                      AND po.SupplierId = ?
                      ORDER BY id.ProductId, inv.InvoiceDate DESC;

                      `;
console.log(mysql.format( query,
  [...productIds, supplierId]))
      const [rows] = await dbConnection.connection.promise().execute(
          query,
          [...productIds, supplierId]
      );

      // 🔹 Group + limit to 3 records per product
      const grouped = {};

      rows.forEach(row => {

          if (!grouped[row.ProductId]) {
              grouped[row.ProductId] = [];
          }

          if (grouped[row.ProductId].length < 3) {
              grouped[row.ProductId].push({
                  PurchasePrice: Number(row.PurchasePrice),
                  InvoiceDate: row.InvoiceDate
              });
          }
      });

      return grouped;

  } catch (error) {

      console.error('Error in getLastThreePricesBulk:', error);
      throw error;
  }
};

/**
 * ============================================================
 * Service: settleExpiredStock
 * ============================================================
 *
 * Description:
 *   Performs settlement of expired stock against supplier invoices.
 *   This function:
 *     - Locks expired stock record (FOR UPDATE)
 *     - Uses existing invoice credit if available
 *     - Applies price reduction settlement if required
 *     - Generates additional supplier credit if over-adjusted
 *     - Updates expired stock settlement status
 *     - Executes everything inside a DB transaction
 *
 * Business Flow:
 *   1️⃣ Lock expired stock record to prevent concurrent settlement.
 *   2️⃣ For each settlement item:
 *        A) Try to consume existing SupplierInvoiceCredit first.
 *        B) If recoverable still remains → apply PRICE_REDUCTION settlement.
 *        C) If extra recoverable remains → create additional supplier credit.
 *   3️⃣ Update ExpiredStock:
 *        - SettledAmount
 *        - RemainingAmount
 *        - SettlementStatus (PENDING / PARTIAL / FULLY_SETTLED)
 *   4️⃣ Commit transaction.
 *
 * Transaction Safety:
 *   - Uses SELECT ... FOR UPDATE to lock rows.
 *   - Rolls back on any failure.
 *   - Prevents double settlement in concurrent requests.
 *
 * @async
 * @function settleExpiredStock
 *
 * @param {Object} params
 * @param {number} params.expiredId      - Expired stock record ID (required)
 * @param {Array}  params.settlements    - Array of settlement items:
 *      [
 *        {
 *          invoiceId: number,
 *          productId: number,
 *          invoiceDetailId: number,
 *          recoverable: number,
 *          oldPrice: number,
 *          newPrice: number,
 *          qty: number
 *        }
 *      ]
 * @param {number} params.userId         - Logged-in user performing settlement
 *
 * @returns {Promise<Object>}
 *      { success: true }
 *
 * @throws {Error}
 *      - If expired stock not found
 *      - If DB operation fails
 *      - If transaction fails (auto rollback)
 *
 * Important Notes for Developers:
 *   - Never remove transaction handling.
 *   - Always keep row-level locking for financial consistency.
 *   - Ensure recoverable values are validated before calling.
 *   - Be cautious modifying credit logic — it affects accounting.
 */

const settleExpiredStock = async ({expiredId,settlements,userId}) => {
  const conn = await dbConnection.pool.promise().getConnection();
    try {
        await conn.beginTransaction();
        // 1️⃣ Get expired stock
        const [expiredRows] = await conn.execute(
            `SELECT Id, SupplierId, RemainingAmount, SettledAmount
             FROM ExpiredStock
             WHERE Id = ? FOR UPDATE`,
            [expiredId]
        );
console.log('1')
        if (!expiredRows.length)
            throw new Error('Expired stock not found');

        const expired = expiredRows[0];
        let remainingExpiredAmount = parseFloat(expired.RemainingAmount);

        let totalSettledNow = 0;
console.log(settlements);
console.log('2')
        // 2️⃣ Loop each settlement product
        for (const item of settlements) {

            let recoverable = parseFloat(item.settlementAmount);
            const invoiceId = item.invoiceId;
            const productId = item.productId;
            const invoiceDetailId = item.invoiceDetailId;
            const oldPrice = parseFloat(item.oldPrice);
            const newPrice = parseFloat(item.newPrice);
            const qty = parseFloat(item.qty);

            if (recoverable <= 0) continue;

            // 🔹 Step A: Check existing credit first
            const [creditRows] = await conn.execute(
                `SELECT Id, RemainingCredit
                 FROM SupplierInvoiceCredit
                 WHERE SupplierId = ?
                 AND InvoiceId = ?
                 AND ProductId = ?
                 FOR UPDATE`,
                [expired.SupplierId, invoiceId, productId]
            );
console.log(mysql.format(`SELECT Id, RemainingCredit
                 FROM SupplierInvoiceCredit
                 WHERE SupplierId = ?
                 AND InvoiceId = ?
                 AND ProductId = ?
                 FOR UPDATE`,
                [expired.SupplierId, invoiceId, productId]))
            let creditUsed = 0;

            if (creditRows.length && creditRows[0].RemainingCredit > 0) {

                const availableCredit = parseFloat(creditRows[0].RemainingCredit);

                creditUsed = Math.min(availableCredit, recoverable);

                await conn.execute(
                    `UPDATE SupplierInvoiceCredit
                     SET UsedCredit = UsedCredit + ?,
                         RemainingCredit = RemainingCredit - ?
                     WHERE Id = ?`,
                    [creditUsed, creditUsed, creditRows[0].Id]
                );
console.log(`UPDATE SupplierInvoiceCredit
                     SET UsedCredit = UsedCredit + ?,
                         RemainingCredit = RemainingCredit - ?
                     WHERE Id = ?`,
                    [creditUsed, creditUsed, creditRows[0].Id])
                recoverable -= creditUsed;
            }

            // 🔹 Step B: If still amount remains → use invoice price difference
            if (recoverable > 0) {

                const usableAmount = Math.min(recoverable, remainingExpiredAmount);

                await conn.execute(
                    `INSERT INTO ExpiredSettlement
                    (ExpiredStockId, InvoiceId, InvoiceDetailId, ProductId,
                     SettlementType, Qty, OldPrice, NewPrice,
                     SettlementAmount, CreatedBy)
                     VALUES (?,?,?,?, 'PRICE_REDUCTION',?,?,?,?,?)`,
                    [
                        expiredId,
                        invoiceId,
                        invoiceDetailId,
                        productId,
                        qty,
                        oldPrice,
                        newPrice,
                        usableAmount,
                        userId
                    ]
                );

                totalSettledNow += usableAmount;
                remainingExpiredAmount -= usableAmount;
                console.log(mysql.format(`INSERT INTO ExpiredSettlement
                    (ExpiredStockId, InvoiceId, InvoiceDetailId, ProductId,
                     SettlementType, Qty, OldPrice, NewPrice,
                     SettlementAmount, CreatedBy)
                     VALUES (?,?,?,?, 'PRICE_REDUCTION',?,?,?,?,?)`,
                    [
                        expiredId,
                        invoiceId,
                        invoiceDetailId,
                        productId,
                        qty,
                        oldPrice,
                        newPrice,
                        usableAmount,
                        userId
                    ]))

                // 🔹 If extra credit generated
                const extraCredit = recoverable - usableAmount;

                if (extraCredit > 0) {

                    await conn.execute(
                        `INSERT INTO SupplierInvoiceCredit
                        (SupplierId, InvoiceId, ProductId,
                         TotalCredit, RemainingCredit)
                         VALUES (?,?,?,?,?)
                         ON DUPLICATE KEY UPDATE
                         TotalCredit = TotalCredit + VALUES(TotalCredit),
                         RemainingCredit = RemainingCredit + VALUES(RemainingCredit)`,
                        [
                            expired.SupplierId,
                            invoiceId,
                            productId,
                            extraCredit,
                            extraCredit
                        ]
                    );

                    console.log(mysql.format(`INSERT INTO SupplierInvoiceCredit
                        (SupplierId, InvoiceId, ProductId,
                         TotalCredit, RemainingCredit)
                         VALUES (?,?,?,?,?)
                         ON DUPLICATE KEY UPDATE
                         TotalCredit = TotalCredit + VALUES(TotalCredit),
                         RemainingCredit = RemainingCredit + VALUES(RemainingCredit)`,
                        [
                            expired.SupplierId,
                            invoiceId,
                            productId,
                            extraCredit,
                            extraCredit
                        ]))
                }
            }
        }

        // 3️⃣ Update expired stock
        const newSettled = parseFloat(expired.SettledAmount) + totalSettledNow;

        console.log('newSettled:'+ newSettled)

        console.log('remainingExpiredAmount:'+ remainingExpiredAmount)
console.log('4')
        const status =
            remainingExpiredAmount <= 0
                ? 'SETTLED'
                : newSettled > 0
                    ? 'PARTIAL'
                    : 'PENDING';

        await conn.execute(
            `UPDATE ExpiredStock
             SET SettledAmount = ?,
                 RemainingAmount = ?,
                 SettlementStatus = ?
             WHERE Id = ?`,
            [newSettled, remainingExpiredAmount, status, expiredId]
        );

        console.log(mysql.format(`UPDATE ExpiredStock
             SET SettledAmount = ?,
                 RemainingAmount = ?,
                 SettlementStatus = ?
             WHERE Id = ?`,
            [newSettled, remainingExpiredAmount, status, expiredId]))
console.log('5')
        await conn.commit();
        conn.release();

        return { success: true };

    } catch (error) {
        await conn.rollback();
        conn.release();
        throw error;
    }
};


/**
 * ============================================================
 * Function: getInvoiceCredit
 * ============================================================
 *
 * Description:
 *   Fetches available credit details for a specific supplier invoice.
 *   This function retrieves product-level credit information where
 *   RemainingCredit is greater than 0.
 *
 *   Used in:
 *     - Expiry Settlement Module
 *     - Invoice Adjustment / Credit Validation
 *
 * Business Logic:
 *   - Each invoice may generate product-wise credit entries
 *     in SupplierInvoiceCredit table.
 *   - Only credits with RemainingCredit > 0 are considered usable.
 *
 * @async
 * @param {number} invoiceId - The ID of the invoice (required)
 *
 * @returns {Promise<Array>} Resolves to an array of credit objects:
 * [
 *   {
 *     ProductId: number,
 *     ProductName: string,
 *     TotalCredit: number,
 *     UsedCredit: number,
 *     AvailableAmount: number
 *   }
 * ]
 *
 * @throws {Error}
 *   - If invoiceId is missing
 *   - If database query execution fails
 *
 * Notes for Developers:
 *   - This function does NOT handle HTTP responses.
 *   - Controller layer is responsible for validation response formatting.
 *   - Always ensure invoiceId is a valid integer before calling.
 */
const getInvoiceCredit = async (invoiceId) => {
  try {

      if (!invoiceId) {
          throw new Error("Invoice ID is required");
      }

      const [rows] = await dbConnection.connection.promise().execute(`
          SELECT 
              sic.ProductId,
              p.ProductName,
              sic.TotalCredit,
              sic.UsedCredit,
              sic.RemainingCredit AS AvailableAmount
          FROM SupplierInvoiceCredit sic
          JOIN Products p 
              ON p.Id = sic.ProductId
          WHERE sic.InvoiceId = ?
          AND sic.RemainingCredit > 0
      `, [invoiceId]);

      return rows;

  } catch (error) {
      console.error("Error in getInvoiceCredit:", error);
      throw error;
  }
};

module.exports={
    createSupplier:createSupplier,
    getSuppliersList:getSuppliersList,
    createProduct:createProduct,
    getProductList:getProductList,
    createCustomer:createCustomer,
    getCustomerList:getCustomerList,
   // addStock:addStock,
    getStockList:getStockList,
    createSale:createSale,
    getSalesData:getSalesData,
    addNotes:addNotes,
    getNotes:getNotes,
   // getSalesForPayment:getSalesForPayment,
    addPayment:addPayment,
    //getDues:getDues,
    getStockTransactions:getStockTransactions,
    getCustomerLedger:getCustomerLedger,
    getPrintSaleData:getPrintSaleData,
    getCustomerDetails:getCustomerDetails,
    getPrintTotalSaleData:getPrintTotalSaleData,
    createPurchasePo:createPurchasePo,
    getSupplierDetails:getSupplierDetails,
    getTotalPurchasePoDetails:getTotalPurchasePoDetails,
    getTotalPurchasePoAmount:getTotalPurchasePoAmount,
    getPurchasePoList:getPurchasePoList,
    getInvoiceDetails:getInvoiceDetails,
    getSearchedSalesData:getSearchedSalesData,
    getSalesReport:getSalesReport,
    generateInvoice:generateInvoice,
    getCustomersLedger:getCustomersLedger,
    getProductPrice:getProductPrice,
    getSuppliersProductWithCustomerPricing:getSuppliersProductWithCustomerPricing,
    setProductPricingForCustomer:setProductPricingForCustomer,
    getInvoiceDetailsThroughSupplierInvoiceNo:getInvoiceDetailsThroughSupplierInvoiceNo,
    getStocks:getStocks,
    getStockDetails:getStockDetails,
    getProductDetails:getProductDetails,
    updateSales:updateSales,
    processReturn:processReturn,
    getSalesReportSupplierWise:getSalesReportSupplierWise,
    updateCustomerDetails:updateCustomerDetails,
    getPurchasePoListForReceivingTheOrder:getPurchasePoListForReceivingTheOrder,
    getSupplierLedger:getSupplierLedger,
    addPaymentToSupplier:addPaymentToSupplier,
    getChallanDetails:getChallanDetails,
    createChallan:createChallan,
    getAllChallans:getAllChallans,
    cancelTheChallan:cancelTheChallan,
    deliverTheProduct:deliverTheProduct,
    convertToSale:convertToSale,
    isChallanAlreadyConvertedToSale:isChallanAlreadyConvertedToSale,
    getCustomerListWithDues:getCustomerListWithDues,
    getProductFromStockId:getProductFromStockId,
    getNonMovableSummary:getNonMovableSummary,
    getNonMovableStocks:getNonMovableStocks,
    getExpiredProductDetails:getExpiredProductDetails,
    moveExpiredProduct:moveExpiredProduct,
    getProductPriceHistory:getProductPriceHistory,
    getListOfMovedExpiredProduct:getListOfMovedExpiredProduct,
    searchSupplierInvoice:searchSupplierInvoice,
    getInvoiceProducts:getInvoiceProducts,
    getLastThreePricesBulk:getLastThreePricesBulk,
    settleExpiredStock:settleExpiredStock,
    getInvoiceCredit:getInvoiceCredit,
    getStockTransactions:getStockTransactions,
    getLedgerStock:getLedgerStock,
    getProductNameFromStockId:getProductNameFromStockId,
   // getStocksTest:getStocksTest


}