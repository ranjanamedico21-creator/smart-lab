const passport = require("passport");
const Billing = require("../models/Billing");
const flash = require('connect-flash');
require("dotenv").config();
const ejs = require('ejs');
const moment =require('moment');
const DBConnection = require("../config/DBConnection");
const puppeteer =require("puppeteer");
const path= require('path')
const ExcelJS = require('exceljs');
const fs = require('fs');

const crypto = require("crypto");

const uploadId = crypto.randomUUID();

const pdfParser = require("../helper/pdfParser");

const uploadStore = new Map();


/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
const renderHomeWithError = (res, error, customMessage = '') => {
    const notifications = [];  // Declare notifications array inside the function

    // Use customMessage if provided, otherwise use error.message
    //const errorMessage = customMessage || error || "An unexpected error occurred.";

    if(customMessage)
        notifications.push({
            type: 'danger', // Error notification type
            messages: customMessage,
            icon: 'bi-exclamation-triangle-fill' // Error icon
        });
    if(error)
        notifications.push({
            type: 'danger', // Error notification type
            messages: error,
            icon: 'bi-exclamation-triangle-fill' // Error icon
        });

    console.error("Error:", error); // Log the error stack for debugging
    
    res.render('home', {
        notifications,
        title: 'Home',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
    });
};

  /**
   * 
   * @param {*} req 
   * @param {*} res 
   */
const getCreateSupplierPage = async(req,res)=>{
    res.render('createSupplier',{title:'Create Supplier',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function is used to create a supplier as the name suggests
 */
const createSupplier = async (req, res) => {
    const notifications = [];
    try {
        const message = await Billing.createSupplier(req.body);
        const suppliers = await Billing.getSuppliersList();
        
        notifications.push({
            type: 'success',
            messages: message,
            icon: 'bi-check-circle-fill' // Success icon
        });
        
        res.render('suppliersList', {
            suppliers,
            notifications,
            title: 'Supplier List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (error) {
        console.error("Error creating supplier:", error.stack); // Log stack trace for better debugging

        notifications.push({
            type: 'danger', // Corrected to 'danger' for errors
            messages: error.message || "An unexpected error occurred.",
            icon: 'bi-exclamation-triangle-fill' // Error icon
        });

        const { name = "", address = "", mobileNumber = "", gstIn = "", dlNo = "", cin = "" } = req.body || {}; // Default values to avoid undefined

        res.render('createSupplier', {
            notifications,
            name,
            address,
            mobileNumber,
            gstIn,
            dlNo,
            cin,
            title: 'Create Supplier',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }
};
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This gives suppliers list
 */
const getSupplierList= async(req,res)=>{
    try {
        console.log('hihihihi')
        console.log(Billing);
        console.log('i m hre ')
        const suppliers = await Billing.getSuppliersList()
        res.render('suppliersList',{suppliers,title:'Supplier List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return  renderHomeWithError(res, error, 'Some error occurred. Please retry get suplier list.');
    }
}

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 * This is used to create multiple product for a particylar supplier
 */

const getCreateProductPage= async(req,res)=>{
    try {
        const supplierLists= await Billing.getSuppliersList()
        //for edit product to work we need this variable as null to be exist
        const productDetails=''

        console.log(supplierLists)
        res.render('product',{supplierLists,productDetails,title:'create product List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return  renderHomeWithError(res, error, 'Some error occurred. Please retry get create product page.');
    }
}

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * 
 */
const createProduct = async (req, res) => {
    const notifications = [];
    try {
        const message = await Billing.createProduct(req);
        const products = await Billing.getProductList();

        notifications.push({
            type: 'success',
            messages: message,
            icon: 'bi-check-circle-fill' // Success icon
        });

        res.render('productList', {
            products,
            notifications,
            title: 'Product List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (error) {
        console.error("Error creating product:", error.stack); // Improved error logging

        notifications.push({
            type: 'danger',
            messages: error.message || "An unexpected error occurred.",
            icon: 'bi-exclamation-triangle-fill' // Different icon for errors
        });

        // Ensure req.body is safely accessed
        const { supplier = "", name = "", hsn = "" } = req.body || {}; 

        const supplierLists = await Billing.getSuppliersList();

        res.render('product', {
            supplierLists,
            supplier,
            name,
            hsn,
            notifications,
            title: 'Create Product',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }
};


const getProductList= async(req,res)=>{
    try {
        const products= await Billing.getProductList()
       // console.log(products)
        console.log('*************')
        res.render('productList',{products,title:'Product List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return  renderHomeWithError(res, error, 'Some error occurred. Please retry get  product list page.');
    }
}

const getCreateCustomerPage = async(req,res)=>{
    try {
        const suppliers= await Billing.getSuppliersList()
        console.log(suppliers);
       
        const products= await Billing.getProductList();
        console.log(products)
        res.render('createCustomer',{suppliers,products,title:'create customer ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error, 'Some error occurred. Please retry get create customer page.');
    }
}

const createCustomer = async (req, res) => {
    const notifications = [];
    try {

       // console.log(req.body)
       let message={}
        const result = await Billing.createCustomer(req);
              message.type='success'
              message.msg=result;
              message.icon='bi-check-circle-fill'
        req.flash('message', JSON.stringify(message));  // Store success message in flash and stringify the object
        res.redirect('/billing/getCustomerList');
    } catch (error) {
        console.error("Error creating customer:", error.stack);  // Log the error stack for debugging
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

        notifications.push({
            type: 'danger', // Error notification type
            messages: error.message || "An unexpected error occurred.",
            icon: 'bi-exclamation-triangle-fill' // Error icon
        });

        res.render('createCustomer', {
            notifications,
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
            title: 'Create Customer',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }
};

const getCustomerList = async(req,res)=>{
    const notifications=[]
    try {
        const customers = await Billing.getCustomerList()
        const flashMessages = req.flash('message');
        let message = flashMessages.length > 0 ? JSON.parse(flashMessages[0]) : null;

        if (message) {
            notifications.push({
                type: message.type,
                messages: message.msg,
                icon: message.icon
            });
        }

       
        res.render('customerList',{notifications,customers,title:'Customer List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        
        return  renderHomeWithError(res, error, 'Some error occurred. Please retry get create customer list page.');
    }
}

/*const getAddStockPage= async(req,res)=>{
    try {
       const products= await Billing.getProductList()
       const suppliers= await Billing.getSuppliersList()
       console.log(products);
       console.log('sapna')
       res.render('addStock',{suppliers,products,title:'Add stock ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return  renderHomeWithError(res, error, 'Some error occurred. Please retry get add stock page.');
    }
}

const addStock = async (req, res) => {
    const notifications = []; // Initialize notifications array
    try {
        const message = await Billing.addStock(req);
        req.flash('message', message);  // Store success message in flash
        res.redirect('/billing/getStockList');
    } catch (error) {
        // Fetch products and suppliers in parallel to improve performance
        const [products, suppliers] = await Promise.all([
            Billing.getProductList(),
            Billing.getSuppliersList()
        ]);
        
        const { productId = "", batchNumber = "", quantity = "", expiryDate = "", purchasePrice = "", sgst = "", cgst = "", supplierId = "" } = req.body || {}; // Default values
        
        // Add error message to alerts
        notifications.push({
            type: 'danger',
            messages: error.message || 'An error occurred while adding the stock.',
            icon: '#exclamation-triangle-fill'
        });

        res.render('addStock', {
            productId, batchNumber, quantity, expiryDate, purchasePrice, sgst, cgst, supplierId,
            notifications, suppliers, products,
            title: 'Add Stock',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
        console.error("Error adding stock:", error.stack); // Log the error stack for debugging
    }
};*/
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 * This is used to get the stocks in the system
 */

const getStockListPage = async (req, res) => {
    try {
  
      const supplierId = req.query.Supplier || '';
  
      const page = parseInt(req.query.page) || 1;
      const limit = 20;
  
      // ✅ Correct function call (NO offset)
      const { stocks, totalProducts } = await Billing.getStocks(
        supplierId,
        page,
        limit,
        false
      );
  
      const totalPages = Math.ceil(totalProducts / limit);
  
      const suppliers = await Billing.getSuppliersList();
  
      res.render('stockList', {
        suppliers,
        supplierId,
        stocks,
        title: 'Stock List',
        currentPage: page,
        totalPages,
        selectedSupplier: supplierId,
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
  
    } catch (error) {
      return renderHomeWithError(res, error, '');
    }
  };

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 * you can also download stocks in excel . This can be supplier sepecific
 * if user has selected a supplier
 */
const getStockList= async(req,res)=>{
    let notifications=[]
    try {
        const suppliers= await Billing.getSuppliersList();
        const action= req.body.action
        //selected supplier
        const supplierId=req.body.Supplier;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
  
      // ✅ Correct function call (NO offset)
      const { stocks, totalProducts } = await Billing.getStocks(
        supplierId,
        page,
        limit,
        false
      );
  
      const totalPages = Math.ceil(totalProducts / limit);
       // const stocks= await Billing.getStocks(supplierId,1,20,false);
        if(action=='search')
            res.render('stockList',{supplierId, currentPage: page,totalPages,suppliers,stocks,title:'Stock List ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        else if(action=="download")
            downloadStockInExcel(req,res)
    } catch (error) {
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        return  renderHomeWithError(res, error,'');
    }
}

const getStockDetails=async(req,res)=>{

    try {
       // const stockId= req.params.stockId
        const productId=req.params.productId
        const stockDetails= await Billing.getStockDetails(productId)
        res.render('stockDetails',{stockDetails,title:'Stock Details ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return  renderHomeWithError(res, error,'');
    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
const getSalePage= async(req,res)=>{
    try {
        const customers= await Billing.getCustomerList();
        const stocks= await Billing.getStockList()
        /**Here in flash we are saveing entire notifications array */
        const notifications= req.flash('message')//here it will give error addSale/error we also have to take care of the products saled data
       // console.log(messages)
        res.render('addSale',{customers,notifications,stocks,title:'Add Sale ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
const addSale = async (req, res) => {
    const notifications = [];
    try {
        // Attempt to create the sale
        const invoiceId =await Billing.createSale(req);
        const salesData= await Billing.getPrintSaleData(req.body.customerId,invoiceId)
        const customerDetails= await Billing.getCustomerDetails(req.body.customerId);
        const totalSaleDetails= await Billing.getPrintTotalSaleData(req.body.customerId,invoiceId)
        // Add success message to alerts
        notifications.push({
            type: 'success',
            messages: `Sales created successfully with invoice no ${invoiceId}`,
            icon: 'bi-check-circle-fill'
        });
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)
        res.render('printSale',{notifications,salesData,companyDetails,customerDetails,totalSaleDetails,invoiceId,title:'Sales data ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
    } catch (error) {
        console.error('Error in addSale:', error);

        // Add error message to alerts
        notifications.push({
            type: 'danger',
            messages: error.message || 'An error occurred while adding the sale.',
            icon: 'bi-exclamation-triangle-fill'
        });

        // Flash the error messages and redirect back to the add sale page
        //also hve to take care of sales data to be prelist with error later on we will do that 
        req.flash('message', notifications);
        return res.redirect('/billing/addSale?error');
    }
};
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
const getSalesData = async(req,res)=>{
    try {
        const sales= await Billing.getSalesData();
        res.render('salesData',{sales,title:'Sales data ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        
        return  renderHomeWithError(res, error,'');
    }
}
const getupdateSalesPage= async(req,res)=>{
    try {
        const invoiceId=req.params.invoiceId;
        const customerId=req.params.customerId;
        if(!invoiceId || ! customerId)
            throw new Error('Invoice Id or Customer Id missing.')
        const salesData= await Billing.getPrintSaleData(customerId,invoiceId)

        console.log(salesData);

        console.log('saerr')
        const customerDetails= await Billing.getCustomerDetails(customerId);
        const totalSaleDetails= await Billing.getPrintTotalSaleData(customerId,invoiceId)
        res.render('updateSales',{salesData,customerDetails,totalSaleDetails,invoiceId,customerId,title:'Update sales data ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});

    } catch (error) {
        console.log(error)
        renderHomeWithError(res,error)
    }
}

const updateSales= async(req,res)=>{
    let notifications=[]
    try {
        const removedRows = JSON.parse(req.body.removedRows || "[]");

        console.log(req.body);
        console.log('removed rows')
        const customerId=req.params.customerId;
        const invoiceId=req.params.invoiceId

        if(!customerId || ! invoiceId)
            throw new Error('Either customerId or invoiceId is mising.')
        // Loop through the request body to process edited data
        const updatedSales = [];
        const processedIds = new Set(); // Track processed IDs

        for (const key in req.body) {
            if (key.startsWith("quantity_") || key.startsWith("sgst_") || key.startsWith("cgst_") || key.startsWith("rate_")) {
                const id = key.split("_")[1]; // Extract ID

                if (!processedIds.has(id) && !removedRows.includes(id)) {
                    // Add ID to the processed set
                    processedIds.add(id);

                    // Get values once per ID
                    const quantity = req.body[`quantity_${id}`] || 0;
                    const sgst = req.body[`sgst_${id}`] || 0;
                    const cgst = req.body[`cgst_${id}`] || 0;
                    const rate = req.body[`rate_${id}`] || 0;
                    updatedSales.push({ id, quantity, sgst, cgst, rate });
                }
            }
        }
console.log(updatedSales)
            const result= await Billing.updateSales(updatedSales,removedRows,customerId,invoiceId)
           // const invoiceId =await Billing.createSale(req);
        const salesData= await Billing.getPrintSaleData(customerId,invoiceId)
        const customerDetails= await Billing.getCustomerDetails(customerId);
        const totalSaleDetails= await Billing.getPrintTotalSaleData(customerId,invoiceId)
        // Add success message to alerts
        notifications.push({
            type: 'success',
            messages: result,
            icon: 'bi-check-circle-fill'
        });
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)
        res.render('printSale',{notifications,salesData,companyDetails,customerDetails,totalSaleDetails,invoiceId,title:'updated Sales data ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
   
        
    } catch (error) {
        console.error("Error updating sales:", error);
        renderHomeWithError(res,error)
       // res.status(500).send("Internal Server Error");
    }    

}

const getAddNotesPage = async(req,res)=>{
    try {
        const sales= await Billing.getSalesData()
        res.render('addNotes',{sales,title:'Add Notes ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}

const addNotes= async(req,res)=>{
    const notifications=[]
    try {
       const message= await Billing.addNotes(req);
        req.flash('message',message);//success message
        res.redirect('/billing/notes')
        
    } catch (error) {
       // throw error
       const sales= await Billing.getSalesData()
       const {saleId,noteType,amount,reason}= req.body;
       // Add error message to alerts
       notifications.push({
        type: 'danger',
        messages: error.message || 'An error occurred while adding the sale.',
        icon: 'bi-exclamation-triangle-fill'
    });
       res.render('addNotes',{saleId,noteType,amount,reason,sales,notifications,title:'Add Notes ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    }
}

const displayAllNotes = async(req,res)=>{
    try {
        const message= req.flash('message');
        const notes= await Billing.getNotes();
        const notifications=[];//for success message 
        // Add success message to alerts
        notifications.push({
            type: 'success',
            messages: message,
            icon: 'bi-check-circle-fill'
        });

        res.render('notes',{notes,notifications,title:'Add Notes ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}

const getAddPaymentPage = async(req,res)=>{
    try {
       // const sales = await Billing.getSalesForPayment(); //this is changed
        const customers= await Billing.getCustomerList()
        const customerId= req.query.cId || ''
        res.render('addPayment',{customers,customerId,title:'payment ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
const getAddPaymentPageForSupplier= async(req,res)=>{
    try {
       // const sales = await Billing.getSalesForPayment(); //this is changed
        const suppliers= await Billing.getSuppliersList()
        res.render('Billing/addPaymentToSupplier',{suppliers,title:'payment ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}

const addPayment = async (req, res) => {
    // Extract and assign default values for request body fields
    let { customerId = "", paymentDate = "", amountPaid = "", paymentType = "", paymentNo = "" } = req.body || {};
    let notifications = []; // Initialize as an array
    let customers = []; // Initialize customers to avoid undefined errors

    try {
        // Attempt to add payment
        const message = await Billing.addPayment(req);
        notifications.push(createNotification('success', message, 'bi-check-circle-fill'));
        // Reset fields on success
        customerId = "";
        paymentDate = "";
        paymentType = "";
        paymentNo="";
    } catch (error) {
        console.error("Error adding payment:", error.stack); // Log the error stack for debugging
        notifications.push(createNotification('danger', error.message || 'An error occurred while adding the payment.', 'bi-exclamation-triangle-fill'));
    }

    // Fetch customer list with error handling
    try {
        customers = await Billing.getCustomerList();
    } catch (error) {
        console.error("Error fetching customer list:", error.stack); // Log the error stack for debugging
        notifications.push(createNotification('danger',error.message, 'bi-exclamation-triangle-fill'));
    }

    // Render the page with notifications and customer list
    res.render('addPayment', {
        customerId, paymentDate, amountPaid, paymentType, paymentNo,
        customers,
        notifications,
        title: 'Add Payment',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
    });
};


const addPaymentToSupplier = async (req, res) => {
    // Extract and assign default values for request body fields
    let { supplierId = "", paymentDate = "", amountPaid = "", paymentType = "", paymentNo = "" } = req.body || {};
    let notifications = []; // Initialize as an array
    let suppliers = []; // Initialize customers to avoid undefined errors

    try {
        // Attempt to add payment
        const message = await Billing.addPaymentToSupplier(req);
        notifications.push(createNotification('success', message, 'bi-check-circle-fill'));
        // Reset fields on success
        supplierId = "";
        paymentDate = "";
        paymentType = "";
        paymentNo="";
    } catch (error) {
        console.error("Error adding payment:", error.stack); // Log the error stack for debugging
        notifications.push(createNotification('danger', error.message || 'An error occurred while adding the payment.', 'bi-exclamation-triangle-fill'));
    }

    // Fetch customer list with error handling
    try {
        suppliers = await Billing.getSuppliersList();
    } catch (error) {
        console.error("Error fetching supplier list:", error.stack); // Log the error stack for debugging
        notifications.push(createNotification('danger',error.message, 'bi-exclamation-triangle-fill'));
    }

    // Render the page with notifications and customer list
    res.render('Billing/addPaymentToSupplier', {
        supplierId, paymentDate, amountPaid, paymentType, paymentNo,
        suppliers,
        notifications,
        title: 'Add Payment',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
    });
};




/*const getDues= async(req,res)=>{
    const notifications=[]
    try {
        const message= req.flash('message');
        // Add success message to alerts
        notifications.push({
            type: 'success',
            messages: message,
            icon: '#check-circle-fill'
        });
        const dues= await Billing.getDues();
        res.render('dues',{dues,notifications,title:'Add Payment ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}*/

/*const getStockHistoryprev = async (req, res) => {
    try {

        const stockId = req.params.stockId;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;

        const type = req.query.type || null;
        const fromDate = req.query.fromDate || null;
        const toDate = req.query.toDate || null;
        const search = req.query.search || null;

        const offset = (page - 1) * limit;

        const {
            transactions,
            totalCount,
            totalAdded,
            totalReduced
        } = await Billing.getStockTransactions({
            stockId,
            limit,
            offset,
            type,
            search,
            fromDate,
            toDate
        });

        const netStock = totalAdded - totalReduced;
        const totalPages = Math.ceil(totalCount / limit) || 1;

        res.render('stockTransactionsHistory', {
            currentPage: page,
            totalPages,
            netStock,
            totalReduced,
            totalAdded,
            transactions,
            search,
            type,
            fromDate,
            toDate,
            title: 'Stock Transaction History',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (error) {
        return renderHomeWithError(res, error, '');
    }
};*/

const getStockHistory = async (req, res) => {
    try {
      const stockId = req.params.stockId;
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
  
      const type = req.query.type || null;
      const fromDate = req.query.fromDate || null;
      const toDate = req.query.toDate || null;
      const search = req.query.search || null;
  
      const offset = (page - 1) * limit;
  
      // 🔹 Real ledger stock (no filter)
      const currentStock = await Billing.getLedgerStock(stockId);
      
      //get product name from stock 
        const productDeatails = await Billing.getProductNameFromStockId(stockId)
  
      // 🔹 Filtered transactions
      const {
        transactions,
        totalCount,
        openingBalance
      } = await Billing.getStockTransactions({
        stockId,
        limit,
        offset,
        type,
        search,
        fromDate,
        toDate
      });
  
      let totalAdded = 0;
      let totalReduced = 0;
  
      transactions.forEach(t => {
        if (t.Effect === 'IN') {
          totalAdded += Number(t.Quantity);
        } else {
          totalReduced += Number(t.Quantity);
        }
      });
  
      const netStock = openingBalance + totalAdded - totalReduced;
  
      // 🔹 Running Balance
      let runningBalance = openingBalance;
  
      const enrichedTransactions = transactions.map(t => {
  
        if (t.Effect === 'IN') {
          runningBalance += Number(t.Quantity);
        } else {
          runningBalance -= Number(t.Quantity);
        }
  
        return {
          ...t,
          runningBalance
        };
      });
  
      const totalPages = Math.ceil(totalCount / limit);
  
      res.render('stockTransactionsHistory', {
        transactions: enrichedTransactions,
        totalAdded,
        totalReduced,
        currentStock,
        productDeatails,
        netStock,
        currentPage: page,
        totalPages,
        openingBalance,
        search,
        type,
        fromDate,
        toDate,
        title: 'Stock Ledger',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
  
    } catch (error) {
      return renderHomeWithError(res, error, '');
    }
  };
  




const getPurchasePoPage= async(req,res)=>{
    try {
        //await Billing.createPurchasePo(req)
        console.log('i m here in purchase po')
        const suppliers= await Billing.getSuppliersList();
        const products= await Billing.getProductList()
        res.render('Billing/createPurchasePo',{
            suppliers,
            products,
            title: 'Purchase Po',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
        })
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}

const createPurchasePo = async(req,res)=>{
    try {
        const purchaseOrderId = await Billing.createPurchasePo(req)
       // console.log('order created ');
        //console.log(purchaseOrderId)

       // console.log()
        const supplierId= req.body.supplierId
        const supplierDetails= await Billing.getSupplierDetails(supplierId);

       // console.log(supplierDetails);
        const totalPurchaseDetails= await Billing.getTotalPurchasePoDetails(purchaseOrderId)

       // console.log(totalPurchaseDetails)
        const totalPurchasePoAmount= await Billing.getTotalPurchasePoAmount(purchaseOrderId)

       // console.log(totalPurchasePoAmount)
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)
        res.render('purchasePoOrder',{
            supplierDetails,
            totalPurchaseDetails,
            purchaseOrderId,
            companyDetails,
            totalPurchasePoAmount,
            title: 'Purchase Po',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        })
     
    } catch (error) {
        const suppliers= await Billing.getSuppliersList();
        const products= await Billing.getProductList()
        const{productId,supplierId,quantity,purchasePrice,igst,mrp}=req.body
        const notifications=[]
         // Add error message to alerts
         notifications.push({
            type: 'danger',
            messages: error.message || 'An error occurred while adding the payment.',
            icon: 'bi-exclamation-triangle-fill'
        });
        res.render('Billing/createPurchasePo',{
            suppliers,
            productId,
            supplierId,
            quantity,
            purchasePrice,
            igst,
            mrp,
            products,
            title: 'Purchase Po',
            BRAND_NAME: process.env.BRAND_NAME,
            notifications,
            layout: 'loggedInLayout',
        })
    }
}

/*const downloadPurchasePo = async(req,res)=>{

    try {
        const purchaseOrderId= req.params.purchaseId
        const supplierId= req.params.supplierId
        const supplierDetails= await Billing.getSupplierDetails(supplierId);

        const totalPurchaseDetails= await Billing.getTotalPurchasePoDetails(purchaseOrderId)
        const totalPurchasePoAmount= await Billing.getTotalPurchasePoAmount(purchaseOrderId)
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)
        const templatePath = path.join(__dirname, '../views/partials/downloadPurchasePo.ejs');

        // Render HTML for PDF generation
        let html= await ejs.renderFile(templatePath,{supplierDetails,totalPurchaseDetails,companyDetails,totalPurchasePoAmount,purchaseOrderId});
        console.log(html)
         // Generate PDF with Puppeteer
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        // Ensure media type is screen to render proper CSS
        await page.emulateMediaType('screen');


       // await page.setContent(html, { waitUntil: 'networkidle0' }); // Wait for content to load
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
       // const pdfBuffer = await page.pdf({ format: 'A4' });
       // Create the PDF
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            margin: {
            top: '20mm',
            bottom: '20mm',
            left: '10mm',
            right: '10mm',
            },
            // Optional header/footer
            displayHeaderFooter: false, // set true to enable footer
            // headerTemplate: `<div style="font-size:10px;text-align:center;width:100%;">Company Header</div>`,
            // footerTemplate: `<div style="font-size:10px;text-align:center;width:100%;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        });
        await browser.close();
       // filename=' + patientDetails[0].Name + '.pdf'
        res.setHeader('Content-Disposition', `attachment; filename="PurchasePo-${purchaseOrderId}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);
        
    } catch (error) {
        console.log(error)
        console.log('Erron in downloading of purchase po.')
    }

}*/


const downloadPurchasePo = async (req, res) => {
  try {
    const purchaseOrderId = req.params.purchaseId;
    const supplierId = req.params.supplierId;

    const supplierDetails = await Billing.getSupplierDetails(supplierId);
    const totalPurchaseDetails = await Billing.getTotalPurchasePoDetails(purchaseOrderId);
    const totalPurchasePoAmount = await Billing.getTotalPurchasePoAmount(purchaseOrderId);
    const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS);

    const templatePath = path.join(__dirname, '../views/partials/downloadPurchasePo.ejs');
    const headerTemplate = `
<style>
  .header-wrap {
      width: 100%;
      padding: 4px 15px 4px 25px; /* extra padding-left = 25px */
      font-family: 'Roboto', sans-serif;
      font-size: 20px;
      border-bottom: 2px solid #000;
      box-sizing: border-box;
  }
  .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      width: 100%;
      margin-bottom:5px;
      margin-top:5px;
  }
  .header-title {
      text-transform: uppercase;
      font-weight: 700;
      font-size: 20px;
  }
  .header-small {
      font-size: 15px;
  }
  .badge-tax {
      background: #000;
      color: #fff;
      padding: 2px 6px;
      font-size: 9px;
      border-radius: 3px;
      text-transform: uppercase;
  }
  img {
    max-height: 26px;
    max-width: 80px;
  }
</style>

<div class="header-wrap">
  <div class="header-top">
    <div>
      <div class="header-title">${companyDetails.coreCompany}</div>
      <div class="header-small">${companyDetails.coreCompanyAddress}</div>
      <div class="header-small">
        Email: ${companyDetails.coreCompanyEmail} |
        Phone: ${companyDetails.coreCompanyPhoneNumber}
      </div>
    </div>
    <div style="text-align:right;">
      <div class="badge-tax">Tax Invoice</div>
      <img src="${companyDetails.coreCompanyLogoUrl || 'logo-placeholder.png'}" />
    </div>
  </div>
</div>
`;


    // Render EJS to HTML
    const html = await ejs.renderFile(templatePath, {
      supplierDetails,
      totalPurchaseDetails,
      companyDetails,
      totalPurchasePoAmount,
      purchaseOrderId
    });

    // Launch Puppeteer and create PDF buffer
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.emulateMediaType('screen');
    await page.setContent(html, { waitUntil: 'networkidle0' });


    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
        margin: {
        top: '90px',    // enough space for header
        bottom: '60px',
        left: '25mm',
        right: '25mm'
        },
    headerTemplate,   // <-- direct HTML string
    footerTemplate: `<div></div>` // can keep empty or add page numbers,
    });

    await browser.close();
   // res.send(pdfBuffer)

    // Send the PDF to the client
    res.setHeader('Content-Disposition', `attachment; filename=PurchasePo-${purchaseOrderId}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error in downloading purchase PO:', error);
    res.status(500).send('Error generating purchase order PDF');
  }
};


const viewPurchasePo = async(req,res)=>{
    try {
        const filters = {
            PurchaseInvoiceNo: req.body.PurchaseInvoiceNo || null,
            Supplier: req.body.Supplier || null,
            FromDate: req.body.FromDate || null,
            ToDate: req.body.ToDate || null
        };
        const supplierLists= await Billing.getSuppliersList();
        console.log(supplierLists);
        const purchasePoLists=await Billing.getPurchasePoList(filters)
        console.log(purchasePoLists[0])
        res.render('Billing/viewPurchasePo',{supplierLists,purchasePoLists,title:'Purchase Po History ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return  renderHomeWithError(res, error,'');
    }
}

const viewPurchasePoList = async(req,res)=>{
    try {
        const filters = {
            PurchaseInvoiceNo: req.body.PurchaseInvoiceNo || null,
            Supplier: req.body.Supplier || null,
            FromDate: req.body.FromDate || null,
            ToDate: req.body.ToDate || null
        };

        console.log(filters);
        const supplierLists= await Billing.getSuppliersList();
        const purchasePoLists= await Billing.getPurchasePoList(filters)
        console.log(req.body);
        console.log('**** i m supplier')
        res.render('Billing/viewPurchasePo', {
            supplierLists,
            purchasePoLists,
            PurchaseInvoiceNo: filters.PurchaseInvoiceNo,
            Supplier: filters.Supplier,
            FromDate: filters.FromDate,
            ToDate: filters.ToDate,
            title: 'Purchase Po History',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    } catch (error) {
        console.log(error.stack)
        return  renderHomeWithError(res, error,'');
    }
}




const getReceivePurchaseOrderPage = async (req, res) => {
    try {

        // Handle GET and POST methods safely
        const purchaseOrderId = req.params.purchaseOrderId || null;
        
        // Get purchase order details only if `purchaseOrderId` is available
        let purchaseOrderDetails = [];
        if (purchaseOrderId) {
            purchaseOrderDetails = await Billing.getTotalPurchasePoDetails(purchaseOrderId);
        }
        
        // Ensure `purchaseOrderDetails` has at least one record to avoid undefined errors
        const purchaseOrderData = purchaseOrderDetails.length > 0 ? purchaseOrderDetails[0] : {};
        console.log(purchaseOrderData);
        
        // Safe fallback values
        const filters = {
            PurchaseInvoiceNo: req.body?.PurchaseInvoiceNo || purchaseOrderData.PurchaseInvoiceNo || null,
            Supplier: req.body?.Supplier || purchaseOrderData.SupplierId || null,
            FromDate: req.body?.FromDate || purchaseOrderData.OrderDate || null,
            ToDate: req.body?.ToDate || null
        };
        const suppliers = await Billing.getSuppliersList();

      //  console.log(suppliers)
        console.log('supp')
        const purchaseOrders = await Billing.getPurchasePoListForReceivingTheOrder(filters);
        //console.log(purchaseOrders)
       // console.log('i am here in purd')

        res.render('Billing/receivePurchaseOrder', {
            suppliers,
            purchaseOrderDetails: purchaseOrders,
            PurchaseInvoiceNo: req.body.PurchaseInvoiceNo || purchaseOrderData.PurchaseInvoiceNo || null,
            Supplier: req.body.Supplier || purchaseOrderData.SupplierId || null,
            FromDate: req.body.FromDate || moment(purchaseOrderData.OrderDate, 'YYYY-MM-DD').format('DD-MM-YYYY') || null,
            ToDate: req.body.ToDate || moment(purchaseOrderData.OrderDate, 'YYYY-MM-DD').format('DD-MM-YYYY') || null,
            title: 'Receive Purchase Order',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    } catch (error) {
        console.log(error.stack);
        res.status(500).send("Error fgt loading page");
    }
};


/**
 * Controller to generate and download a PDF of sales data for a specific invoice.
 *
 * @async
 * @function downloadSales
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * 
 * @description
 * This function fetches sales data, customer details, and total sale data for a given
 * invoiceId and customerId. It then renders an EJS template to generate HTML content,
 * converts it to a PDF using Puppeteer, and sends the PDF as a downloadable response.
 *
 * @throws Will respond with 404 if sales data or customer details are not found.
 * @throws Will respond with 500 if there is an error generating the PDF.
 *
 * @example
 * // Route definition
 * app.get('/sales/download/:customerId/:invoiceId', downloadSales);
 */
const downloadSales = async (req, res) => {
    try {
        const { invoiceId, customerId } = req.params;
        
        // Fetch data
        const salesData = await Billing.getPrintSaleData(customerId, invoiceId);
        const customerDetails = await Billing.getCustomerDetails(customerId);
        const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, invoiceId);
       // const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS);
       const companyDetails = {
                                  coreCompany: process.env.SELLER_NAME,
                                  coreCompanyAddress: process.env.SELLER_ADDRESS,
                                  coreCompanyPhoneNumber: process.env.SELLER_PHONE,
                                  coreCompanyEmail: process.env.SELLER_EMAIL,
                                  coreCompanyBankName: process.env.SELLER_BANK,
                                  coreCompanyAccountNo: process.env.SELLER_ACC_NO,
                                  coreCompanyIFSCCode: process.env.SELLER_IFSC,
                                  coreCompanyGstNo: process.env.SELLER_GST,
                                  coreCompanyDLNo: process.env.SELLER_DL,
                                };

        // Check for missing data
        if (!salesData || salesData.length === 0) {
            return res.status(404).send("No sales data found for this invoice.");
        }
        if (!customerDetails || Object.keys(customerDetails).length === 0) {
            return res.status(404).send("Customer details not found.");
        }

        // Convert company logo to Base64 for PDF
        const imagePath = path.resolve(__dirname, '../images/RanjanaImaging.png');
        const imageData = fs.readFileSync(imagePath).toString('base64');
        const imageBase64 = `data:image/jpeg;base64,${imageData}`;

        // Render EJS template
        const templatePath = path.join(__dirname, '../views/partials/downloadSales.ejs');
        const htmlContent = await ejs.renderFile(templatePath, { 
            salesData, 
            customerDetails, 
            totalSaleDetails, 
            invoiceId, 
            companyDetails,
            imageBase64
        });

        // Launch Puppeteer to generate PDF
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--single-process'
            ]
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load', timeout: 0 });

        // Generate PDF
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        // Send PDF as response
        const safeFileName = encodeURIComponent(`${customerDetails.CustomerName}-${invoiceId}.pdf`);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error in downloadSales:", error);
        res.status(500).send("Error generating sales PDF.");
    }
};

/*const pdf = require("html-pdf");


const downloadSales = async (req, res) => {
    try {
        const { invoiceId, customerId } = req.params;

        // Fetch data
        const salesData = await Billing.getPrintSaleData(customerId, invoiceId);
        const customerDetails = await Billing.getCustomerDetails(customerId);
        const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, invoiceId);
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS || "{}");

        if (!salesData || salesData.length === 0) {
            return res.status(404).send("No sales data found for this invoice.");
        }

        if (!customerDetails || Object.keys(customerDetails).length === 0) {
            return res.status(404).send("Customer details not found.");
        }

        // Logo → Base64
        const imagePath = path.resolve(__dirname, "../images/RanjanaImaging.png");
        const imageBase64 = `data:image/png;base64,${fs.readFileSync(imagePath, "base64")}`;

        // Render EJS
        const templatePath = path.join(__dirname, "../views/partials/downloadSales.ejs");
        const htmlContent = await ejs.renderFile(templatePath, {
            salesData,
            customerDetails,
            totalSaleDetails,
            invoiceId,
            companyDetails,
            imageBase64
        });

        // PDF options
        const options = {
            format: "A4",
            border: {
                top: "5mm",
                right: "5mm",
                bottom: "5mm",
                left: "5mm"
            },
            timeout: 60000
        };
//return res.send(htmlContent)
        // Generate PDF
        pdf.create(htmlContent, options).toBuffer((err, buffer) => {
            if (err) {
                console.error("PDF Error:", err);
                return res.status(500).send("PDF generation failed");
            }

            const safeFileName = encodeURIComponent(
                `${customerDetails.CustomerName}-${invoiceId}.pdf`
            );

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
            res.send(buffer);
        });

    } catch (error) {
        console.error("Error in downloadSales:", error);
        res.status(500).send("Error generating sales PDF.");
    }
};
*/





const viewSales= async(req,res)=>{
    try {
        const customers= await Billing.getCustomerList();
        const customerLists= await Billing.getSearchedSalesData(req)
        res.render('viewSales',{customers,customerLists,title:'Sales History ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return  renderHomeWithError(res, error,'');
    }
}
const viewSaleThroughSearch= async(req,res)=>{

    try {
        
        const customers= await Billing.getCustomerList();
        const customerLists= await Billing.getSearchedSalesData(req)

        console.log(customerLists);
        console.log('i m in view sale s post')
        const {InvoiceId,Customer,FromDate,ToDate}=req.body
        res.render('viewSales',{customers,customerLists,InvoiceId,Customer,FromDate,ToDate,title:'Sales History ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error.stack)
        return  renderHomeWithError(res, error,'');
    }
}
const customerWiseSales= async(req,res)=>{

    try {
        const customers = await Billing.getCustomerList();
        const invoices= await Billing.getSalesReport(req)
        const Customer = req.body?.Customer || '';
        const FromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        const ToDate   = req.body?.ToDate   || moment().format('DD-MM-YYYY');
        res.render('salesReport',{Customer,invoices,FromDate,ToDate,customers,title:'Sales Report ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})

    } catch (error) {
        
        console.log(error.stack)
        return  renderHomeWithError(res, error,'');
    }
}

/*const custometrWiseSalesSearcheReport = async (req, res) => {
    try {
      const customers = await Billing.getCustomerList();
      const salesReports = await Billing.getSalesReport(req);
      //rearranging vakues into proper format for the view
      const invoices = {};
      salesReports.forEach(row => {
            if (!invoices[row.InvoiceId]) {
            invoices[row.InvoiceId] = {
                InvoiceId: row.InvoiceId,
                CustomerName: row.CustomerName,
                GstNo: row.GstNo,
                CreatedAt: row.CreatedAt,
                Products: [],
                SubTotal: 0,
                GrandTotal: 0
            };
            }
        
            invoices[row.InvoiceId].Products.push(row);
            invoices[row.InvoiceId].SubTotal += Number(row.TotalValue);
            invoices[row.InvoiceId].GrandTotal += Number(row.TotalValueWithTax);
  });
      const Customer = req.body?.Customer || '';
      const FromDate  = req.body?.FromDate  || '';
      const ToDate    = req.body?.ToDate    || '';
  
      res.render('salesReport', {
        title: 'Sales Report',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout',
        customers,
        invoices: Object.values(invoices),
        salesReports,
        Customer,
        FromDate,
        ToDate
      });
  
    } catch (error) {
      console.error(error);
      res.status(500).send('Something went wrong');
    }
  };*/
  
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function is used to receive order against purchase po from the supplier.
 */
const generateInvoice = async (req, res) => {

    const notifications = [];  // Declare notifications array inside the function
   // const purchaseOrderId = req.body.purchaseOrderId


    console.log(req.body)
    const { purchaseOrderId, supplierInvoiceNo, products } = req.body;
  const selectedProducts = products.filter(p => p.selected); // Only process checked rows
  console.log(selectedProducts)

    try {
        const {message} = await Billing.generateInvoice(req);
        console.log(message)
        console.log('invoice generated')
        req.flash('message',message)
        res.redirect(`/Billing/invoiceDetails/${purchaseOrderId}`)
    } catch (error) {
    //write code for error 
    } 
};

const invoiceDetails= async(req,res)=>{
    const { purchaseOrderId } = req.params;
    let notifications=[]
    try {
        const purchaseOrder= await Billing.getTotalPurchasePoDetails(purchaseOrderId)
        const invoices= await Billing.getInvoiceDetails(purchaseOrderId)
        const message= req.flash('message')
        console.log(message);
        console.log('invoice details')
         notifications.push(createNotification('success',message,'bi-check-circle-fill'))
        console.log(notifications)
        console.log('i m suer')
        res.render('invoiceDetails', {
            purchaseOrder: purchaseOrder || null,
            invoices,
            BRAND_NAME:process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            title: 'Purchase Order Invoice Details',
            notifications
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Error fetching invoice details");
    }
}

const getCustomersLedger= async(req,res)=>{

    try {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // 0 = January, so add 1

        if (req.method === "POST") {
            // If the form is submitted, use provided startDate and endDate
            startDate = req.body.startDate || "";
            endDate = req.body.endDate || today.toISOString().split('T')[0]; // Default to today if no endDate is provided
        } else {
            // On first-time URL hit, default to current financial year
            if (currentMonth < 4) {
                startDate = `${currentYear - 1}-04-01`;
            } else {
                startDate = `${currentYear}-04-01`;
            }
            endDate = today.toISOString().split('T')[0]; // Default end date is today
        }
        //These message will be set from sales return due to any reason then if its is successful the redirect to customer ledger
       
       const customersLedger= await Billing.getCustomersLedger(startDate,endDate);

       // console.log('in customerLedger')
       res.render('customersLedger', {
        customersLedger,
        startDate,
        endDate,
        BRAND_NAME:process.env.BRAND_NAME,
        layout: 'loggedInLayout',
        title: 'Customer Ledger'
    });
    } catch (error) {
        
        console.log(error)
        renderHomeWithError(res,error)
    }
}



const getIndividualCustomerLedger = async (req, res) => {
    
    const customerId =req.params.customerId;
    let { startDate, endDate } = req.body;
   
    try {
        
          let financialYear=''
    
            // 🗓️ Calculate Financial Year Start Date
           // const today = new Date();
           // const currentYear = today.getFullYear();
           // const currentMonth = today.getMonth() + 1; // 0 = January, so add 1
    
           /* if (req.method === "POST") {
                // If the form is submitted, use provided startDate and endDate
                financialYear=req.body.financialYear;
               // startDate = moment(req.body.startDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
                //endDate = moment(req.body.endDate, 'DD-MM-YYYY').format('YYYY-MM-DD');// Default to today if no endDate is provided
                startDateForQuery = moment(req.body.startDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
                endDateForQuery = moment(req.body.endDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
            } else {
                // On first-time URL hit, default to current financial year
                if (currentMonth < 4) {
                    startDateForQuery= startDate = `${currentYear - 1}-04-01`;
                   // startOf('day').format('YYYY-MM-DD HH:mm:ss');
                   startDateForQuery=startDate = moment(startDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
                } else {
                    startDateForQuery= startDate = `${currentYear}-04-01`;
                }
                //endDate = today.toISOString().split('T')[0]; // Default end date is today
                endDateForQuery=endDate = moment().endOf('day').format('YYYY-MM-DD  HH:mm:ss');
            }*/
                const today = moment()
                const currentYear = today.year();
                const currentMonth = today.month() + 1; // 0-indexed, so +1
                
                // Determine financial year start date
                const fyStart = currentMonth < 4
                  ? moment(`${currentYear - 1}-04-01`, 'YYYY-MM-DD')
                  : moment(`${currentYear}-04-01`, 'YYYY-MM-DD');
                
                // Final startDate and endDate setup
                 startDate = req.body.startDate
                  ? moment(req.body.startDate, 'DD-MM-YYYY')
                  : fyStart;
                
                 endDate = req.body.endDate
                  ? moment(req.body.endDate, 'DD-MM-YYYY')
                  : today;
                

                  console.log(startDate);
                 // alert(startDate);
                  console.log(endDate)
        const message= req.flash('returnStock')
        let notifications=[]
            notifications.push(createNotification('success',message,'bi-check-circle-fill'))

        
            const { ledger, totalDebit, totalCredit, closingBalance } = await Billing.getCustomerLedger(customerId, startDate, endDate);
            const customerDetails = await Billing.getCustomerDetails(customerId); // Your own DB function
           // startDate = moment(startDate, 'YYYY-MM-DD').format('DD-MM-YYYY');
           // endDate = moment(endDate, 'YYYY-MM-DD').format('DD-MM-YYYY');// Default to today if no endDate is provided
           startDate = moment(startDate).format('DD-MM-YYYY');

           console.log(endDate);
           endDate = moment(endDate).format('DD-MM-YYYY');
           
            
        
            res.render("customersLedger", {
              customerLedger: ledger,
              customerDetails,
              startDate,
              endDate,
              totalDebit,
              totalCredit,
              closingBalance,
              title: 'Customer Ledger ',
              BRAND_NAME: process.env.BRAND_NAME,
              layout: 'loggedInLayout',
            });
          } catch (error) {
              
             // res.send('hi')
              console.log('i m in error roro ror')
            console.error("Ledger error:", error);
            res.render("customersLedger", {
              customerLedger: [],
              customerDetails: null,
              startDate,
              endDate,
              totalDebit: 0,
              totalCredit: 0,
              closingBalance: '0',
              errorMessage: "Error generating ledger.",
              title: 'Customer Ledger errrrrrrrrr ',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            });
          }
};


/*const getCustomerledgerInPdf = async(req,res)=>{
    try {
        const customerId = req.params.customerId || req.query.customerId
        const fromDate = req.query.fromDate || moment().format('DD-MM-YYYY');
        const toDate = req.query.toDate || moment().format('DD-MM-YYYY');
        console.log(req.params)
console.log('parameter printed')
        res.render('test', {
           
            title: 'Stock Transaction History',
            BRAND_NAME: process.env.BRAND_NAME,
           
        });

        // Fetch data using the same ledger query
       // const ledgerData = await dbQuery(ledgerQuery, [customerId]); // Assume dbQuery is a promise-based wrapper
       const  { customerLedger, totalDebit, totalCredit, closingBalance }= await Billing.getCustomerLedger(customerId,fromDate,toDate);// Assume dbQuery is a promise-based wrapper

        console.log(ledgerData);

        console.log('*******************************ledger')

       const templatePath = path.join(__dirname, '../views/partials/downloadCustomerLedger.ejs');
//console.log('EJS Template Path:', templatePath);
//let html= await ejs.renderFile(templatePath,{patientDetails});


        // Render HTML for PDF generation
        const htmlContent = await ejs.renderFile(templatePath,{customerLedger, totalDebit, totalCredit, closingBalance});

        console.log(htmlContent);
        console.log('printing html content ')

        // Generate PDF with Puppeteer
      /*  const browser = await puppeteer.launch();
        const page = await browser.newPage();

        await page.setContent(htmlContent);
        const pdfBuffer = await page.pdf({ format: 'A4' });

        await browser.close();

        res.setHeader('Content-Disposition', 'attachment; filename="ledger.pdf"');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);*/

   /* } catch (error) {
        
        console.log(error)
        throw error
    }
}*/

/*const getCustomerLedgerInPdf = async (req, res) => {
    try {
        const customerId = req.params.customerId || req.query.customerId;
        const fromDate = moment(req.query.fromDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
        const toDate = moment(req.query.toDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

        console.log(`Generating PDF for customer: ${customerId}, From: ${fromDate}, To: ${toDate}`);

        // Fetch ledger data
        const { customerLedger, totalDebit, totalCredit, closingBalance } =
            await Billing.getCustomerLedger(customerId, fromDate, toDate);

        // Load EJS template
        const templatePath = path.join(__dirname, '../views/partials/downloadCustomerLedger.ejs');

        // Render HTML content
        const htmlContent = await ejs.renderFile(templatePath, {
            customerLedger,
            totalDebit,
            totalCredit,
            closingBalance,
            fromDate: moment(fromDate).format('DD-MM-YYYY'),
            toDate: moment(toDate).format('DD-MM-YYYY'),
            brandName: process.env.BRAND_NAME || "My Brand",
            openingBalance: customerLedger[0]?.Balance || 0
        });

        // Generate PDF using Puppeteer
        const browser = await puppeteer.launch({
            headless: "new", // Required for some environments
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        // Send PDF to user
        res.setHeader('Content-Disposition', 'attachment; filename="Customer_Ledger.pdf"');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Something went wrong while generating the PDF.');
    }
};*/

const getCustomerLedgerInPdf = async (req, res) => {
    try {
        const customerId = req.params.customerId || req.query.customerId;
        //console.log(customerId);
       // console.log('rakesh ')
        const fromDate = moment(req.params.startDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
        const toDate = moment(req.params.endDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
        const imagePath = path.resolve(__dirname, '../images/RanjanaImaging.png');
        const imageData = fs.readFileSync(imagePath).toString('base64');
        const imageBase64 = `data:image/jpeg;base64,${imageData}`;

        const { ledger, totalDebit, totalCredit, closingBalance } =
            await Billing.getCustomerLedger(customerId, fromDate, toDate);

           // console.log('in legdeger rakesh ')

            //console.log(ledger)

        const customer = await Billing.getCustomerDetails(customerId);
        const templatePath = path.join(__dirname, '../views/partials/downloadCustomerLedger.ejs');
        const htmlContent = await ejs.renderFile(templatePath, { 
            company: JSON.parse(process.env.SELLER_COMPANY_DETAILS || "{}"),
            ledger,
            customer,
            totalDebit,
            totalCredit,
            closingBalance,
            fromDate: moment(fromDate).format('DD-MM-YYYY'),
            toDate: moment(toDate).format('DD-MM-YYYY'),
            currentDate: moment().format('DD-MM-YYYY'),
            openingBalance: ledger[0]?.Balance || 0,
            imageBase64
        });
        
        return res.send(htmlContent);

       /* res.render('/partials/downloadCustomerLedger', {
             company: JSON.parse(process.env.SELLER_COMPANY_DETAILS || "{}"),
            ledger,
            customer,
            totalDebit,
            totalCredit,
            closingBalance,
            fromDate: moment(fromDate).format('DD-MM-YYYY'),
            toDate: moment(toDate).format('DD-MM-YYYY'),
            currentDate: moment().format('DD-MM-YYYY'),
            openingBalance: ledger[0]?.Balance || 0,
            imageBase64
        });*/

    } catch (error) {
        console.error('Error loading ledger:', error);
        res.status(500).send('Something went wrong while loading the ledger.');
    }
};


/**
 * 
 * @param {*} req 
 * @param {*} res 
 */

/*const downloadLedgerInExcel = async (req, res) => {
  try {
    const customerId = req.params.customerId;
    const startDate = moment(req.params.startDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    const endDate = moment(req.params.endDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Customer Ledger");

    const customerDetails = await Billing.getCustomerDetails(customerId);
    const { ledger, totalDebit, totalCredit, closingBalance } = await Billing.getCustomerLedger(customerId, startDate, endDate);

    // Set column widths early
    sheet.columns = [
      { header: 'Date', key: 'Date', width: 20 },
      { header: 'Description', key: 'Description', width: 30 },
      { header: 'Debit', key: 'Debit', width: 15 },
      { header: 'Credit', key: 'Credit', width: 15 },
      { header: 'Balance', key: 'Balance', width: 20 },
      { header: 'OpeningBalance', key: 'OpeningBalance', width: 20 }
    ];

    // Customer details header
    sheet.addRow([]);
    const customerHeadingRow = sheet.addRow(["Customer Details"]);
    customerHeadingRow.font = { bold: true, size: 16 };
    sheet.mergeCells(`A${customerHeadingRow.number}:F${customerHeadingRow.number}`);

    sheet.addRow(["Name", customerDetails.CustomerName]);
    sheet.addRow(["Address", `${customerDetails.BillingAddress}, ${customerDetails.BillingDistrict}, ${customerDetails.BillingState} - ${customerDetails.BillingPincode}`]);
    sheet.addRow(["GST No", customerDetails.GstNo]);
    sheet.addRow(["DL No", customerDetails.DlNo]);
    sheet.addRow(["Mobile No", customerDetails.MobileNo]);
    sheet.addRow([]);

    // Ledger Table Header
    sheet.addRow(["Date", "Description", "Debit", "Credit", "Balance", "Opening Balance"]).font = { bold: true, size: 14 };

    ledger.forEach((row, index) => {
      sheet.addRow([
        row.Date,
        row.Description,
        row.Debit,
        row.Credit,
        row.Balance,
        index === 0 ? row.Balance : ""
      ]);
    });

    sheet.addRow([]);
    sheet.addRow(["", "Total", totalDebit.toFixed(2), totalCredit.toFixed(2)]).font = { bold: true, size: 14 };
    sheet.addRow(["", "Closing Balance", "", "", closingBalance]).font = { bold: true, size: 14 };

    const filePath = path.join(__dirname, `Customer_Ledger_${customerId}.xlsx`);
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, `Customer_Ledger_${customerId}.xlsx`, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        return res.status(500).send("Download failed.");
      }
      fs.unlink(filePath, () => {}); // Cleanup
    });
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).send("Something went wrong while generating Excel.");
  }
};*/

/**
 * 
 * @param {*} req 
 * @param {*} res 
 */

const downloadSupplierLedgerInExcel = async (req, res) => {
    try {
      const supplierId = req.params.supplierId;
      const startDate = moment(req.params.startDate, 'DD-MM-YYYY').startOf('day').format('YYYY-MM-DD HH:mm:ss');
      const endDate = moment(req.params.endDate, 'DD-MM-YYYY').endOf('day').format('YYYY-MM-DD HH:mm:ss');

     // const startDate = moment(req.params.startDate, 'DD-MM-YYYY').format('YYYY-MM-DD hh:mm:ss');
     // const endDate = moment(req.params.endDate, 'DD-MM-YYYY').format('YYYY-MM-DD hh:mm:ss');
  
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Supplier Ledger");
  
      const supplierDetails = await Billing.getSupplierDetails(supplierId);
      const { ledger, totalDebit, totalCredit, closingBalance } = await Billing.getSupplierLedger(supplierId, startDate, endDate);
  
      // Set column widths early
      sheet.columns = [
        { header: 'Date', key: 'Date', width: 20 },
        { header: 'Description', key: 'Description', width: 30 },
        { header: 'Debit', key: 'Debit', width: 15 },
        { header: 'Credit', key: 'Credit', width: 15 },
        { header: 'Balance', key: 'Balance', width: 20 },
        { header: 'OpeningBalance', key: 'OpeningBalance', width: 20 }
      ];
  
      // Customer details header
      sheet.addRow([]);
      const customerHeadingRow = sheet.addRow(["Supplier Details"]);
      customerHeadingRow.font = { bold: true, size: 16 };
      sheet.mergeCells(`A${customerHeadingRow.number}:F${customerHeadingRow.number}`);
  
      sheet.addRow(["Name", supplierDetails[0].Name]);
      sheet.addRow(["Address", `${supplierDetails[0].Address}, ${supplierDetails[0].District}, ${supplierDetails[0].State} - ${supplierDetails[0].Pincode}`]);
      sheet.addRow(["GST No", supplierDetails[0].GstNo]);
      sheet.addRow(["DL No", supplierDetails[0].DlNo]);
      sheet.addRow(["Mobile No", supplierDetails[0].ContactNo]);
      sheet.addRow([]);
  
      // Ledger Table Header
      sheet.addRow(["Date", "Description", "Debit", "Credit", "Balance", "Opening Balance"]).font = { bold: true, size: 14 };
  
      ledger.forEach((row, index) => {
        sheet.addRow([
          row.Date,
          row.Description,
          row.Debit,
          row.Credit,
          row.Balance,
          index === 0 ? row.Balance : ""
        ]);
      });
  
      sheet.addRow([]);
      sheet.addRow(["", "Total", totalDebit.toFixed(2), totalCredit.toFixed(2)]).font = { bold: true, size: 14 };
      sheet.addRow(["", "Closing Balance", "", "", closingBalance]).font = { bold: true, size: 14 };
  
      const filePath = path.join(__dirname, `Supplier_Ledger_${supplierId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);
  
      res.download(filePath, `Supplier_Ledger_${supplierId}.xlsx`, (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          return res.status(500).send("Download failed.");
        }
        fs.unlink(filePath, () => {}); // Cleanup
      });
    } catch (err) {
      console.error("Excel export error:", err);
      res.status(500).send("Something went wrong while generating Excel.");
    }
  };


  const downloadLedgerInExcel = async (req, res) => {
    try {
      const customerId = req.params.customerId;
      const startDate = moment(req.params.startDate, "DD-MM-YYYY").format("YYYY-MM-DD");
      const endDate = moment(req.params.endDate, "DD-MM-YYYY").format("YYYY-MM-DD");
  
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Customer Ledger", {
        views: [{ state: "frozen", ySplit: 15 }] // Freeze after header area
      });
  
      const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS || {});
      const customerDetails = await Billing.getCustomerDetails(customerId);
      const { ledger, totalDebit, totalCredit, closingBalance } =
        await Billing.getCustomerLedger(customerId, startDate, endDate);
  
      /* =====================================================
         COLUMN STRUCTURE
      ===================================================== */
  
      sheet.columns = [
        { header: "Date", key: "Date", width: 18 },
        { header: "Description", key: "Description", width: 30 },
        { header: "Payment No", key: "PaymentNo", width: 18 },
        { header: "Payment Type", key: "PaymentType", width: 18 },
        { header: "Debit", key: "Debit", width: 15 },
        { header: "Credit", key: "Credit", width: 15 },
        { header: "Balance", key: "Balance", width: 18 }
      ];
  
      /* =====================================================
         COMPANY HEADER
      ===================================================== */
  
      const companyRow = sheet.addRow([companyDetails.coreCompany]);
      companyRow.font = { size: 18, bold: true };
      companyRow.alignment = { horizontal: "center" };
      sheet.mergeCells(`A${companyRow.number}:G${companyRow.number}`);
  
      const addressRow = sheet.addRow([companyDetails.coreCompanyAddress]);
      addressRow.alignment = { horizontal: "center" };
      sheet.mergeCells(`A${addressRow.number}:G${addressRow.number}`);
  
      const contactRow = sheet.addRow([
        `Phone: ${companyDetails.coreCompanyPhoneNumber} | Email: ${companyDetails.coreCompanyEmail}`
      ]);
      contactRow.alignment = { horizontal: "center" };
      sheet.mergeCells(`A${contactRow.number}:G${contactRow.number}`);
  
      const gstRow = sheet.addRow([
        `GST: ${companyDetails.coreCompanyGstNo} | DL: ${companyDetails.coreCompanyDLNo}`
      ]);
      gstRow.alignment = { horizontal: "center" };
      sheet.mergeCells(`A${gstRow.number}:G${gstRow.number}`);
  
      const bankRow = sheet.addRow([
        `Bank: ${companyDetails.coreCompanyBankName} | A/C: ${companyDetails.coreCompanyAccountNo} | IFSC: ${companyDetails.coreCompanyIFSCCode}`
      ]);
      bankRow.alignment = { horizontal: "center" };
      sheet.mergeCells(`A${bankRow.number}:G${bankRow.number}`);
  
      sheet.addRow([]);
  
      /* =====================================================
         CUSTOMER DETAILS
      ===================================================== */
  
      const custHeader = sheet.addRow(["Customer Ledger"]);
      custHeader.font = { bold: true, size: 14 };
      sheet.mergeCells(`A${custHeader.number}:G${custHeader.number}`);
  
      sheet.addRow(["Customer Name", customerDetails.CustomerName]);
      sheet.addRow([
        "Address",
        `${customerDetails.BillingAddress}, ${customerDetails.BillingDistrict}, ${customerDetails.BillingState} - ${customerDetails.BillingPincode}`
      ]);
      sheet.addRow(["GST No", customerDetails.GstNo]);
      sheet.addRow(["Mobile", customerDetails.MobileNo]);
  
      sheet.addRow([]);
      sheet.addRow([]);
  
      /* =====================================================
         TABLE HEADER
      ===================================================== */
  
      const headerRow = sheet.addRow([
        "Date",
        "Description",
        "Payment No",
        "Payment Type",
        "Debit",
        "Credit",
        "Balance"
      ]);
  
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center" };
  
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "D9D9D9" }
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" }
        };
      });
  
      /* =====================================================
         LEDGER DATA
      ===================================================== */
  
      ledger.forEach((row) => {
        const newRow = sheet.addRow([
          row.Date,
          row.Description,
          row.PaymentNo || "",
          row.PaymentType || "",
          row.Debit,
          row.Credit,
          row.Balance
        ]);
  
        newRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" }
          };
  
          if (colNumber === 5 || colNumber === 6) {
            cell.numFmt = '"₹"#,##0.00';
            cell.alignment = { horizontal: "right" };
          }
  
          if (colNumber === 7) {
            cell.alignment = { horizontal: "right" };
          }
        });
      });
  
      /* =====================================================
         TOTALS SECTION
      ===================================================== */
  
      sheet.addRow([]);
  
      const totalRow = sheet.addRow([
        "",
        "Total",
        "",
        "",
        totalDebit,
        totalCredit,
        ""
      ]);
  
      totalRow.font = { bold: true };
  
      totalRow.getCell(5).numFmt = '"₹"#,##0.00';
      totalRow.getCell(6).numFmt = '"₹"#,##0.00';
  
      const closingRow = sheet.addRow([
        "",
        "Closing Balance",
        "",
        "",
        "",
        "",
        closingBalance
      ]);
  
      closingRow.font = { bold: true };
  
      /* =====================================================
         DOWNLOAD
      ===================================================== */
  
      const filePath = path.join(__dirname, `Customer_Ledger_${customerId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);
  
      res.download(filePath, `Customer_Ledger_${customerId}.xlsx`, (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          return res.status(500).send("Download failed.");
        }
        fs.unlink(filePath, () => {});
      });
  
    } catch (err) {
      console.error("Excel export error:", err);
      res.status(500).send("Something went wrong while generating Excel.");
    }
  };
  
  
const getProductPrice= async(req,res)=>{

    try {
        const { productId, customerId } = req.body;
        console.log(req.body)
        const result = await Billing.getProductPrice(productId,customerId)
        console.log(result)
        if (result.length > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false }); // No price found, trigger modal
        }
    } catch (error) {
        
        console.log(error)
    }
}

const getupdatePricePageForCustomer= async(req,res)=>{
    let notifications=[]

    try {
        console.log(req)
        const customerId= req.params.customerId || req.body.customerId;
        const supplierId= req.body.supplierId || ''
        const productPricingForCustomer= await Billing.getSuppliersProductWithCustomerPricing(customerId,supplierId)

        console.log('i m in update price');
        console.log(productPricingForCustomer);
        console.log('i m in here ')
        const customers= await Billing.getCustomerList()
        const suppliers= await Billing.getSuppliersList()
        res.render('setProductPricing',{
            customers,
            suppliers,
            customerId,
            supplierId,
            productPricingForCustomer,
            BRAND_NAME:process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            title: 'Customer product pricing'
        })
    } catch (error) {
      //  notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        renderHomeWithError(res,error)
    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
const setProductPriceForCustomer = async (req, res) => {
    let notifications = [];
    let productPricingForCustomer = []; // ✅ Define before try block

    try {

        console.log(req)
        console.log('reg')
        // Extract request parameters
        let customerId = req.params.customerId;
        const supplierId = req.params.supplierId;
        const productId = req.params.productId;
        const stockId=req.params.stockId
        const newProductPrice = req.body.newProductPrice;

        // ✅ Validate required parameters
        if (!customerId || !productId || !newProductPrice || !stockId) {
            console.log('Missing parameters detected');
            notifications.push(createNotification('danger', 'Missing required parameters.', 'bi-exclamation-triangle-fill'));

            // Fetch customers and suppliers even if an error occurs
            const [customers, suppliers] = await Promise.all([
                Billing.getCustomerList(),
                Billing.getSuppliersList()
            ]);

            return res.render('setProductPricing', {
                customers,
                suppliers,
                customerId,
                supplierId,
                productPricingForCustomer, // ✅ Always defined
                notifications,
                BRAND_NAME: process.env.BRAND_NAME,
                layout: 'loggedInLayout',
                title: 'Customer Product Pricing'
            });
        }

        // ✅ Update product pricing
        const result = await Billing.setProductPricingForCustomer(customerId, supplierId, productId, newProductPrice,stockId);
        notifications.push(createNotification('success', result, 'bi-check-circle-fill'));

        // ✅ Fetch required data in parallel
        const [fetchedProductPricing, customers, suppliers] = await Promise.all([
            Billing.getSuppliersProductWithCustomerPricing(customerId, supplierId),
            Billing.getCustomerList(),
            Billing.getSuppliersList()
        ]);

        productPricingForCustomer = fetchedProductPricing; // ✅ Assign only if no error occurs

        console.log('Fetched Product Pricing:', productPricingForCustomer);

        // ✅ Render response
        res.render('setProductPricing', {
            customers,
            suppliers,
            customerId,
            supplierId,
            productPricingForCustomer,
            notifications,
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            title: 'Customer Product Pricing'
        });

    } catch (error) {
        console.error("Error in setProductPriceForCustomer:", error);
        notifications.push(createNotification('danger', 'An error occurred while setting product pricing.', 'bi-exclamation-triangle-fill'));

        // ✅ Ensure `customers` and `suppliers` are always available
        let customers = [];
        let suppliers = [];

        try {
            [customers, suppliers] = await Promise.all([
                Billing.getCustomerList(),
                Billing.getSuppliersList()
            ]);
        } catch (fetchError) {
            console.error("Error fetching customer/supplier list:", fetchError);
        }

        // ✅ Render with default `productPricingForCustomer`
        res.render('setProductPricing', {
            customers,
            suppliers,
            customerId: req.params.customerId || null,
            supplierId: req.params.supplierId || null,
            productPricingForCustomer, // ✅ Now always defined, preventing errors
            notifications,
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            title: 'Customer Product Pricing'
        });
    }
};



const downloadInvoice = async (req, res) => {
    try {
        const supplierInvoiceNo = req.params.supplierInvoice;
        const invoiceDetails = await Billing.getInvoiceDetailsThroughSupplierInvoiceNo(supplierInvoiceNo);
        const purchaseOrder = await Billing.getTotalPurchasePoDetails(invoiceDetails[0].PurchaseOrderId);

        if (invoiceDetails.length === 0) {
            return res.status(404).send("No data found for this Supplier Invoice No");
        }

        // Load and render the EJS template
        const templatePath = path.join(__dirname, '../views/partials/downloadInvoice.ejs');
        const templateHtml = await ejs.renderFile(templatePath, { 
            invoiceDetails, 
            purchaseOrder, 
            moment 
        });

        // Launch Puppeteer with optimized settings
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setContent(templateHtml, { waitUntil: 'load', timeout: 0 });

        // Generate PDF as a buffer and send it directly
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        res.setHeader('Content-Disposition', `attachment; filename="PurchaseOrder_${supplierInvoiceNo}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);
        
    } catch (error) {
        console.error("Error generating invoice PDF:", error);
        res.status(500).send("Error generating invoice PDF");
    }
};

const editProductDetail= async(req,res)=>{
    let notifications=[]

    try {
        const productId=req.params.productId || ''
        if(!productId)
            throw new Error('No product Id found')
        let productDetails= await Billing.getProductDetails(productId) ||[]

      //  productDetails=[]
        const supplierLists= await Billing.getSuppliersList()
        if(productDetails)
            notifications.push(createNotification('danger',`No Product with this Id ${productId} has been found.`,'bi-exclamation-triangle-fill'))
        if(supplierLists)
            notifications.push(createNotification('danger',`No Supplier has been found.`,'bi-exclamation-triangle-fill'))
        res.render('product',{supplierLists,productDetails,title:'create product List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error);
        renderHomeWithError(res,error)
    }
}

const getReturnSalePage= async(req,res)=>{

    try {
        const customers= await Billing.getCustomerList();
        const suppliers= await Billing.getSuppliersList();
        const products= await Billing.getProductList();
        res.render('return',{customers,suppliers,products,title:'Return sales page',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})

    } catch (error) {
        console.log(error)
        renderHomeWithError(res,error)
    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
const salesReturn = async (req, res) => {
    try {
        // Extracting required fields from request body
        const { Customer: customerId, Supplier: supplierId, Product: productId, BatchNumber: batchNumber, Quantity, Reason: reason, condition } = req.body;

        // Validate required parameters
        /*if (!customerId || !supplierId || !productId || !batchNumber || !Quantity || !reason) {
            throw new Error("Key parameters are missing.");
        }*/

            const missingParams = [];
            if (!customerId) missingParams.push("customerId");
            if (!supplierId) missingParams.push("supplierId");
            if (!productId) missingParams.push("productId");
            if (!batchNumber) missingParams.push("batchNumber");
            if (!Quantity) missingParams.push("Quantity");
            if (!reason) missingParams.push("reason");
            
            if (missingParams.length > 0) {
                throw new Error(`Missing parameters: ${missingParams.join(", ")}`);
            }

        // Convert quantity to a number & validate
        const quantity = Number(Quantity);
        if (isNaN(quantity) || quantity <= 0) {
            throw new Error("Invalid quantity. It must be a positive number.");
        }

        // Ensure defective is treated as a boolean
        // Process the return using the Billing module
        const result = await Billing.processReturn(customerId,productId,batchNumber,quantity,reason, condition,req.user.Id, supplierId,);

        // Setting the success message for display when redirected to the ledger page
        req.flash("returnStock", result);
        res.redirect(`/billing/customerLedger/${customerId}`);
    } catch (error) {
        console.error("Sales Return Error:", error.message);
        renderHomeWithError(res, error);
    }
};




/*const downloadStockInExcel = async (req, res) => {
  let notifications = [];
  try {
    const supplierId = req.body.Supplier;
    const stocks = await Billing.getStocks(supplierId); // Ensure this method accepts supplierId if needed

    // Create a new Excel workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Stock Data');

    // Add today's date at the top and merge cells for the title
    const currentDate = new Date();
    const title = `Stock as of: ${currentDate.toLocaleDateString()}`;
    worksheet.mergeCells('A1:D1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = title;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center' };
    worksheet.getRow(1).height = 20; // Adjust row height for title

    worksheet.addRow([]); // Blank row for spacing

    // Add header row with Serial No, Product Name, and Quantity
    const headerRow = worksheet.addRow(['Serial No', 'Product Name','Batch No','Quantity']);
    headerRow.font = { size: 12, bold: true };
    headerRow.alignment = { horizontal: 'center' };
    worksheet.getRow(3).height = 18; // Adjust row height for headers

    // Add data rows with serial numbers
    stocks.forEach((stock, index) => {
      worksheet.addRow([index + 1, stock.ProductName,stock.BatchNumber, stock.TotalQuantity]);
    });

    // Auto-fit column widths based on content length
    worksheet.columns.forEach((column, index) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? cell.value.toString().length : 0;
        maxLength = Math.max(maxLength, cellLength);
      });
      column.width = maxLength < 10 ? 10 : maxLength + 2;
    });

    // Enable text wrapping for all cells
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      });
    });

    // Set the response headers to prompt for download
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=stock_data.xlsx'
    );

    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating Excel file:', error);
   // notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'));
    renderHomeWithError(res, error);
  }
};*/


/*const downloadStockInExcel = async (req, res) => {
  try {

    const supplierId = req.body.Supplier;
    const stocks = await Billing.getStocks(supplierId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Stock Report');

    // ===============================
    // TITLE
    // ===============================
    const currentDate = new Date();
    const title = `STOCK REPORT AS ON ${currentDate.toLocaleDateString()}`;

    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = title;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 25;

    worksheet.addRow([]);

    // ===============================
    // HEADER
    // ===============================
    const headerRow = worksheet.addRow([
      'S.No',
      'Supplier',
      'Product',
      'Batch No',
      'Quantity'
    ]);

    headerRow.height = 20;

    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2F75B5' } // Professional blue
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Freeze header
    worksheet.views = [{ state: 'frozen', ySplit: 3 }];

    let serial = 1;

    // ===============================
    // DATA ROWS
    // ===============================
    stocks.forEach(stock => {

      stock.Batches.forEach(batch => {

        const row = worksheet.addRow([
          serial++,
          stock.SupplierName,
          stock.ProductName,
          batch.BatchNumber,
          Number(batch.Quantity) || 0
        ]);

        // Column-wise alignment
        row.getCell(1).alignment = { horizontal: 'center' }; // S.No
        row.getCell(2).alignment = { horizontal: 'left' };   // Supplier
        row.getCell(3).alignment = { horizontal: 'left' };   // Product
        row.getCell(4).alignment = { horizontal: 'center' }; // Batch
        row.getCell(5).alignment = { horizontal: 'right' };  // Quantity

        // Number format for quantity
        row.getCell(5).numFmt = '#,##0';

        // Borders
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });

      });

      // ===============================
      // PRODUCT TOTAL ROW
      // ===============================
      const totalRow = worksheet.addRow([
        '',
        '',
        `${stock.ProductName} Total`,
        '',
        stock.TotalQuantity
      ]);

      totalRow.font = { bold: true };

      totalRow.getCell(5).numFmt = '#,##0';
      totalRow.getCell(5).alignment = { horizontal: 'right' };

      totalRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' } // Light grey
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

    });

    // ===============================
    // COLUMN WIDTHS (Fixed Professional)
    // ===============================
    worksheet.columns = [
      { width: 8 },   // S.No
      { width: 25 },  // Supplier
      { width: 60 },  // Product
      { width: 18 },  // Batch
      { width: 15 }   // Quantity
    ];

    // ===============================
    // RESPONSE
    // ===============================
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=stock_report.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error generating Excel file:', error);
    renderHomeWithError(res, error);
  }
};*/

const downloadStockInExcel = async (req, res) => {
    try {
  
      const supplierId = req.body.Supplier;
      const {stocks} = await Billing.getStocks(supplierId,null,null,true);
  
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Stock Report');
  
      // ===============================
      // TITLE
      // ===============================
      const currentDate = new Date();
      const title = `STOCK REPORT AS ON ${currentDate.toLocaleDateString('en-IN')}`;
  
      worksheet.mergeCells('A1:G1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = title;
      titleCell.font = { size: 16, bold: true };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 25;
  
      worksheet.addRow([]);
  
      // ===============================
      // HEADER
      // ===============================
      const headerRow = worksheet.addRow([
        'S.No',
        'Supplier',
        'Product',
        'Batch No',
        'Expiry Date',
        'Quantity',
        'Expiry Status'
      ]);
  
      headerRow.height = 20;
  
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2F75B5' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
  
      worksheet.views = [{ state: 'frozen', ySplit: 3 }];
  
      let serial = 1;
  
      // ===============================
      // DATA ROWS
      // ===============================
      stocks.forEach(stock => {
  
        stock.Batches.forEach(batch => {
  
          let expiryStatus = 'Valid';
          let expiryDisplay = '-';
  
          if (batch.ExpiryDate) {
  
            // DD-MM-YYYY format expected
            const parts = batch.ExpiryDate.split('-');
  
            if (parts.length === 3) {
  
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              const year = parseInt(parts[2], 10);
  
              const expiryDate = new Date(year, month, day);
              expiryDisplay = batch.ExpiryDate;
  
              const today = new Date();
              today.setHours(0, 0, 0, 0);
  
              const threeMonthsLater = new Date(today);
              threeMonthsLater.setMonth(today.getMonth() + 3);
  
              if (expiryDate < today) {
                expiryStatus = 'Expired';
              } else if (expiryDate <= threeMonthsLater) {
                expiryStatus = 'Expiring Soon';
              }
            }
          }
  
          const row = worksheet.addRow([
            serial++,
            stock.SupplierName,
            stock.ProductName,
            batch.BatchNumber,
            expiryDisplay,
            Number(batch.Quantity) || 0,
            expiryStatus
          ]);
  
          // Alignments
          row.getCell(1).alignment = { horizontal: 'center' };
          row.getCell(4).alignment = { horizontal: 'center' };
          row.getCell(5).alignment = { horizontal: 'center' };
          row.getCell(6).alignment = { horizontal: 'right' };
          row.getCell(7).alignment = { horizontal: 'center' };
  
          row.getCell(6).numFmt = '#,##0';
  
          // Conditional formatting color
          if (expiryStatus === 'Expired') {
            row.getCell(7).font = { bold: true, color: { argb: 'FFFF0000' } };
          } else if (expiryStatus === 'Expiring Soon') {
            row.getCell(7).font = { bold: true, color: { argb: 'FFFFA500' } };
          } else {
            row.getCell(7).font = { color: { argb: 'FF008000' } };
          }
  
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
  
        });
  
        // PRODUCT TOTAL ROW
        const totalRow = worksheet.addRow([
          '',
          '',
          `${stock.ProductName} Total`,
          '',
          '',
          stock.TotalQuantity,
          ''
        ]);
  
        totalRow.font = { bold: true };
        totalRow.getCell(6).numFmt = '#,##0';
        totalRow.getCell(6).alignment = { horizontal: 'right' };
  
        totalRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' }
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
  
      });
  
      // ===============================
      // COLUMN WIDTHS
      // ===============================
      worksheet.columns = [
        { width: 8 },   // S.No
        { width: 25 },  // Supplier
        { width: 60 },  // Product
        { width: 18 },  // Batch
        { width: 15 },  // Expiry
        { width: 12 },  // Quantity
        { width: 18 }   // Expiry Status
      ];
  
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
  
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=stock_report.xlsx'
      );
  
      await workbook.xlsx.write(res);
      res.end();
  
    } catch (error) {
      console.error('Error generating Excel file:', error);
      renderHomeWithError(res, error);
    }
  };

/*const downloadSalesReportInExcel = async (req, res) => {
    try {
        const FromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        const ToDate = req.body?.ToDate || moment().format('DD-MM-YYYY');
        const supplierId = req.body?.Supplier || null;

        // Fetch sales data
        const salesData = await Billing.getSalesReportSupplierWise(FromDate, ToDate, supplierId);

        // Create a new Excel workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sales Report');

        // Merge cells for title
        const reportTitle = `Sales Report as on From ${FromDate} To ${ToDate}`;
        worksheet.mergeCells('A1:I1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = reportTitle;
        titleCell.font = { size: 14, bold: true };
        titleCell.alignment = { horizontal: 'center' };
        worksheet.getRow(1).height = 20;

        // Add a blank row for spacing
        worksheet.addRow([]);

        // Add headers
        const headers = [
            'Serial No', 'Supplier Name', 'Product Name','ExpDate','Batch Number', 'Opening Quantity',
            'Quantity Sold', 'Remaining Quantity', 'Price/Unit', 'Remaining Stock Price'
        ];
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { size: 12, bold: true };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        // Set column widths for better readability
        worksheet.getColumn(1).width = 2;  // Serial No
        worksheet.getColumn(2).width =30; // Supplier Name
        worksheet.getColumn(3).width = 50; // Product Name
        worksheet.getColumn(4).width = 20; // Batch Number
        worksheet.getColumn(5).width = 15; // Batch Number
        worksheet.getColumn(6).width = 15; // Opening Quantity
        worksheet.getColumn(7).width = 15; // Quantity Sold
        worksheet.getColumn(8).width = 15; // Remaining Quantity
        worksheet.getColumn(9).width = 15; // Price Per Unit
        worksheet.getColumn(10).width = 20; // Remaining Stock Price

        // Add sales data rows
        salesData.forEach((product, index) => {
            const dataRow = worksheet.addRow([
                index + 1, product.SupplierName, product.ProductName,product.ExpiryDate,product.BatchNumber, product.OpeningQuantity,
                product.QuantitySold, product.RemainingQuantity, product.PurchasePrice, product.RemainingStockTotalPrice
            ]);

            dataRow.alignment = { horizontal: 'left', vertical: 'left' };
        });

        // Set response headers for download
        const filePath = path.join(__dirname, 'sales_report.xlsx');
        await workbook.xlsx.writeFile(filePath);

        res.download(filePath, 'sales_report.xlsx', (err) => {
            if (err) {
                console.error('File download error:', err.message);
                return res.status(500).send('File download error: ' + err.message);
            }
            // Delete file after successful download
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr.message);
            });
        });

    } catch (error) {
        console.error('Error generating sales report:', error.message);
        res.status(500).send('Error generating sales report');
    }
};*/

/**
 * Download sales report in Excel format for a given date range and supplier.
 *
 * - Fetches sales data from the database using `Billing.getSalesReportSupplierWise`.
 * - Generates an Excel file with formatted headers, column widths, and data rows.
 * - Numbers are stored as numbers (avoids Excel "number stored as text" warnings).
 * - Highlights expiry dates:
 *    - "Valid" (normal)
 *    - "Expiring Soon" (within 3 months → red background, white text)
 *    - "Expired" (past date → dark red background, white text)
 * - Sends the generated file as a downloadable response.
 *
 * @async
 * @function downloadSalesReportInExcel
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Sends the Excel file as a download response
 *
 * @throws {Error} If an error occurs during data fetching, file creation, or download.
 */
const downloadSalesReportInExcel = async (req, res) => {
    try {
        const FromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        const ToDate = req.body?.ToDate || moment().format('DD-MM-YYYY');
        const supplierId = req.body?.Supplier || null;

        // Fetch sales data
        const salesData = await Billing.getSalesReportSupplierWise(FromDate, ToDate,1, supplierId,true);

        // Create a new Excel workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sales Report');

        // Merge cells for title
        const reportTitle = `Sales Report as on From ${FromDate} To ${ToDate}`;
        worksheet.mergeCells('A1:K1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = reportTitle;
        titleCell.font = { size: 14, bold: true };
        titleCell.alignment = { horizontal: 'center' };
        worksheet.getRow(1).height = 20;

        // Add a blank row for spacing
        worksheet.addRow([]);

        // Add headers (added Expiry Status column)
        const headers = [
            'Serial No', 'Supplier Name', 'Product Name', 'ExpDate', 'Batch Number',
            'Opening Quantity', 'Quantity Sold', 'Remaining Quantity',
            'Price/Unit', 'Remaining Stock Price', 'Expiry Status', 'Added On'
        ];
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { size: 12, bold: true };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        // Adjust column widths
        worksheet.getColumn(1).width = 10;  // Serial No
        worksheet.getColumn(2).width = 30; // Supplier Name
        worksheet.getColumn(3).width = 50; // Product Name
        worksheet.getColumn(4).width = 20; // ExpDate
        worksheet.getColumn(5).width = 20; // Batch Number
        worksheet.getColumn(6).width = 18; // Opening Quantity
        worksheet.getColumn(7).width = 18; // Quantity Sold
        worksheet.getColumn(8).width = 20; // Remaining Quantity
        worksheet.getColumn(9).width = 15; // Price Per Unit
        worksheet.getColumn(10).width = 22; // Remaining Stock Price
        worksheet.getColumn(11).width = 20; // Expiry Status
        worksheet.getColumn(11).width = 20; // Product Added On.


        // Add sales data rows
        salesData.forEach((product, index) => {
            const expDate = product.ExpiryDate ? moment(product.ExpiryDate) : null;
            const createdAt=product.CreatedAt ? moment(product.CreatedAt) : null;
            const today = moment();
            const threeMonthsFromNow = moment().add(3, 'months');

            let expiryStatus = "Valid";
            let style = null;

            if (expDate) {
                if (expDate.isBefore(today, 'day')) {
                    expiryStatus = "Expired";
                    style = {
                        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF800000' } }, // Dark Red
                        font: { color: { argb: 'FFFFFFFF' }, bold: true }
                    };
                } else if (expDate.isBetween(today, threeMonthsFromNow, null, '[]')) {
                    expiryStatus = "Expiring Soon";
                    style = {
                        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }, // Bright Red
                        font: { color: { argb: 'FFFFFFFF' }, bold: true }
                    };
                }
            }

            const dataRow = worksheet.addRow([
                index + 1,
                product.SupplierName,
                product.ProductName,
                expDate ? expDate.format("DD-MMM-YYYY") : "",
                product.BatchNumber,
                Number(product.OpeningQuantity),
                Number(product.QuantitySold),
                Number(product.RemainingQuantity),
                Number(product.PurchasePrice),
                Number(product.RemainingStockTotalPrice),
                expiryStatus,
                createdAt ? createdAt.format("DD-MMM-YYYY") : "",
            ]);

            dataRow.alignment = { horizontal: 'left', vertical: 'middle' };

            // Apply style to ExpDate + Expiry Status if needed
            if (style) {
                const expCell = dataRow.getCell(4);  // ExpDate
                const statusCell = dataRow.getCell(11); // Expiry Status
                expCell.fill = style.fill;
                expCell.font = style.font;
                statusCell.fill = style.fill;
                statusCell.font = style.font;
            }
        });

        // Generate file
        const filePath = path.join(__dirname, 'sales_report.xlsx');
        await workbook.xlsx.writeFile(filePath);

        // Send file to client
        res.download(filePath, 'sales_report.xlsx', (err) => {
            if (err) {
                console.error('File download error:', err.message);
                return res.status(500).send('File download error: ' + err.message);
            }
            // Delete file after successful download
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr.message);
            });
        });

    } catch (error) {
        console.error('Error generating sales report:', error.message);
        res.status(500).send('Error generating sales report');
    }
};



const getSalesReportSupplierWisePage = async(req,res)=>{
    let notifications=[]

    try {
        const suppliers= await Billing.getSuppliersList();
        const FromDate= moment().format('DD-MM-YYYY')
        const ToDate= moment().format('DD-MM-YYYY')
        const {rows,pagination,grandTotals}= await Billing.getSalesReportSupplierWise(FromDate,ToDate,1,null,false)

        //console.log(salesReports);
        console.log('*****i m ready to do this ******')
        res.render('supplierWiseSalesReport',{suppliers,moment,rows,pagination,grandTotals,FromDate,ToDate,title:'Supplier Sales Report ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        
    } catch (error) {
      //  notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        renderHomeWithError(res,error)
        
    }

}

const salesReportSupplierWise= async(req,res)=>{
    let notifications=[]
    try {

        console.log('i m here ')
        const FromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        const ToDate = req.body?.ToDate || moment().format('DD-MM-YYYY');
        const action= req.body.action

        console.log(action);

        console.log('2')
        const Supplier= req.body.Supplier
        console.log('3')
        console.log(req.body)
        const page= parseInt(req.body.page);
        console.log('4')
        console.log(req.body)
        const suppliers= await Billing.getSuppliersList();
        console.log('supplier:'+ Supplier)
        const {rows,pagination,grandTotals}= await Billing.getSalesReportSupplierWise(FromDate,ToDate,page,Supplier,false)
        if(action=="search")
            res.render('supplierWiseSalesReport',{suppliers,Supplier,rows,pagination,grandTotals,moment,FromDate,ToDate,title:'Supplier Sales Report ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        else if(action=="download")
            await downloadSalesReportInExcel(req,res)
            
    } catch (error) {
       // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    }
}

const editCustomer= async(req,res)=>{
    try {
        const customerId=req.params.customerId;
        if(!customerId)
           throw new Error('Customer Id is missing.Kindly try again.')
        const customerDetails= await Billing.getCustomerDetails(customerId)
        res.render('editCustomer',{customerDetails,title:'Edit customer details',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        let message={}
        message.type='danger'
        message.msg=error.message;
        message.icon='bi-exclamation-triangle-fill'
        req.flash('message', JSON.stringify(message));  // Store success message in flash and stringify the object
        res.redirect('/billing/getCustomerList');
    }
}
const updateCustomer= async(req,res)=>{
    let notifications=[]
    let message={}
    try {
        const customerId= req.params.customerId;
      
        if(!customerId)
                throw new Error('Customer Id is missing.')
        const result= await Billing.updateCustomerDetails(req);
        message.type='success'
              message.msg=result;
              message.icon='bi-check-circle-fill'
        req.flash('message', JSON.stringify(message));  // Store success message in flash and stringify the object
        res.redirect('/billing/getCustomerList');
       

    } catch (error) {
       
        message.type='danger'
        message.msg=error.message;
        req.flash('message', JSON.stringify(message));  // Store success message in flash and stringify the object
        res.redirect('/billing/getCustomerList');
    }
}



const getSupplierLedger = async (req, res) => {

    const supplierId =req.params.supplierId;
    let { startDate, endDate } = req.body;

    console.log(req.body)
    try {
        
          let financialYear=''
    
            // 🗓️ Calculate Financial Year Start Date
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth() + 1; // 0 = January, so add 1
    
            if (req.method === "POST") {

                console.log('hhihiihihi hhihii')
                // If the form is submitted, use provided startDate and endDate
                financialYear=req.body.financialYear;
               // startDate = moment(req.body.startDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
                //endDate = moment(req.body.endDate, 'DD-MM-YYYY').format('YYYY-MM-DD');// Default to today if no endDate is provided
                startDate = moment(startDate, 'DD-MM-YYYY').startOf('day').format('YYYY-MM-DD HH:mm:ss');
                endDate = moment(endDate, 'DD-MM-YYYY').endOf('day').format('YYYY-MM-DD HH:mm:ss');

                console.log(startDate)
               // endDate = moment(endDate).endOf('day').format('YYYY-MM-DD HH:mm:ss');
                console.log(endDate)
            } else {
                // On first-time URL hit, default to current financial year
                if (currentMonth < 4) {
                    console.log('555555555')
                    startDate = `${currentYear - 1}-04-01`;
                   // startOf('day').format('YYYY-MM-DD HH:mm:ss');
                    startDate = moment(startDate).startOf('day').format('YYYY-MM-DD HH:mm:ss');
                } else {
                    console.log('66666666')
                    startDate = `${currentYear}-04-01`;
                }
                //endDate = today.toISOString().split('T')[0]; // Default end date is today
                 endDate = moment().endOf('day').format('YYYY-MM-DD  HH:mm:ss');
            }
       
        //const message= req.flash('returnStock')
       // let notifications=[]
          //  notifications.push(createNotification('success',message,'bi-check-circle-fill'))

        
            const { ledger, totalDebit, totalCredit, closingBalance } = await Billing.getSupplierLedger(supplierId, startDate, endDate);
            const supplierDetails = await Billing.getSupplierDetails(supplierId); // Your own DB function
            startDate = moment(startDate).format('DD-MM-YYYY');
            //endDate = moment(endDate).format('DD-MM-YYYY');
            console.log(endDate)
            endDate = moment(endDate, 'YYYY-MM-DD HH:mm:ss').format('DD-MM-YYYY');

            console.log(endDate)
            console.log('enenenenenenenenenes')
        
            res.render("supplierLedger", {
              supplierLedger: ledger,
              supplierDetails,
              startDate,
              endDate,
              totalDebit,
              totalCredit,
              closingBalance,
              title: 'Supplier Ledger ',
              BRAND_NAME: process.env.BRAND_NAME,
              layout: 'loggedInLayout',
            });
          } catch (error) {
            console.error("Ledger error:", error);
            res.render("supplierLedger", {
              supplierLedger: [],
              supplierDetails: null,
              startDate,
              endDate,
              totalDebit: 0,
              totalCredit: 0,
              closingBalance: '0',
              errorMessage: "Error generating ledger.",
              title: 'Supplier Ledger ',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            });
          }
};

const getCreateChallanPage= async(req,res)=>{
    try {
        const customers= await Billing.getCustomerList();
        const stocks= await Billing.getStockList()
        /**Here in flash we are saveing entire notifications array */
        const notifications= req.flash('message')//here it will give error addSale/error we also have to take care of the products saled data
       // console.log(messages)
        res.render('Challan/createChallan',{customers,notifications,stocks,title:'Create challan ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        
    }
}

const createChallan= async(req,res)=>{
    const notifications = [];
    try {
        // Attempt to create the sale
        const challanId = await Billing.createChallan(req);
       // const challanData= await Billing.getPrintSaleData(req.body.customerId,challanId)
        const customerDetails= await Billing.getCustomerDetails(req.body.customerId);
        const challans= await Billing.getChallanDetails(req.body.customerId,challanId)

        console.log('totototototototo');

        console.log(challans)

        console.log('totototototototo');
        // Add success message to alerts
        notifications.push({
            type: 'success',
            messages: `Challan created successfully with challan no ${challanId}`,
            icon: 'bi-check-circle-fill'
        });
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)
        res.render('Challan/viewChallan',{notifications,companyDetails,customerDetails,challans,challanId,title:'Challan data ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
        
    } catch (error) {
        
        console.error('Error in create challan:', error);

        // Add error message to alerts
        notifications.push({
            type: 'danger',
            messages: error.message || 'An error occurred while creating the challan.',
            icon: 'bi-exclamation-triangle-fill'
        });

        // Flash the error messages and redirect back to the add sale page
        //also hve to take care of sales data to be prelist with error later on we will do that 
        req.flash('message', notifications);
        return res.redirect('/billing/createChallan?error');
    }

}

/**
 * Controller to render the view for a specific challan.
 *
 * @async
 * @function viewChallan
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 * 
 * @description
 * Retrieves customer details and challan details for a given challanId and customerId,
 * then renders the 'viewChallan' template with all necessary data.
 */
const viewChallan = async (req, res) => {
    try {
        const challanId = req.params.challanId;
        const customerId = req.params.customerId;

        // Fetch customer details
        const customerDetails = await Billing.getCustomerDetails(customerId);

        // Fetch total challan details
        const challans = await Billing.getChallanDetails(customerId, challanId);

        console.log('hi i m in challans');

        console.log(challans);

        console.log('hi i m out of challas')

        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)

        // Render the view with the retrieved data
        res.render('Challan/viewChallan', {
            companyDetails,
            customerDetails,
            challans,
            challanId,
            title: 'Challan data',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (error) {
        console.error('Error fetching challan details:', error);
        res.status(500).send('Internal Server Error');
    }
};

const downloadChallanInPdf= async(req,res)=>{
    try {
        const { challanId, customerId } = req.params;
        
        // Fetch data
       // const salesData = await Billing.getPrintSaleData(customerId, invoiceId);
        const customerDetails = await Billing.getCustomerDetails(customerId);
         // Fetch total challan details
         const totalChallanDetails = await Billing.getChallanDetails(customerId, challanId);
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS);

        // Check for missing data
        if (!totalChallanDetails || totalChallanDetails.length === 0) {
            return res.status(404).send(`No challan data found for this challanId ${challanId}.`);
        }
        if (!customerDetails || Object.keys(customerDetails).length === 0) {
            return res.status(404).send("Customer details not found.");
        }

        // Convert company logo to Base64 for PDF
        const imagePath = path.resolve(__dirname, '../images/RanjanaImaging.png');
        const imageData = fs.readFileSync(imagePath).toString('base64');
        const imageBase64 = `data:image/jpeg;base64,${imageData}`;

        // Render EJS template
        const templatePath = path.join(__dirname, '../views/partials/downloadChallan.ejs');
        const htmlContent = await ejs.renderFile(templatePath, { 
            customerDetails, 
            totalChallanDetails, 
            challanId, 
            companyDetails,
            imageBase64
        });

        // Launch Puppeteer to generate PDF
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load', timeout: 0 });

        // Generate PDF
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        // Send PDF as response
        const safeFileName = encodeURIComponent(`${customerDetails.CustomerName}-${challanId}.pdf`);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error in downloadSales:", error);
        res.status(500).send("Error generating sales PDF.");
    }
}

/**
 * Controller to fetch and render a list of challans with filters.
 *
 * @async
 * @function viewChallans
 * @param {import("express").Request} req - Express request object.
 *   @property {Object} body - Request body containing filter values.
 *   @property {string} [body.challanId] - Challan ID filter.
 *   @property {string} [body.customerId] - Customer ID filter.
 *   @property {string} [body.fromDate] - Start date filter (YYYY-MM-DD).
 *   @property {string} [body.toDate] - End date filter (YYYY-MM-DD).
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>} Renders the challan list view with filters and notifications.
 */
const viewChallans = async (req, res) => {
    try {
        // Extract filters safely from request body
        const filters = {
            challanId: req.body?.challanId || "",
            customerId: req.body?.customerId || "",
            fromDate: req.body?.fromDate || "",
            toDate: req.body?.toDate || "",
        };

        // Fetch challans (grouped by customer, date, etc. depending on your model logic)
        const groupedChallans = await Billing.getAllChallans(filters);

        // Fetch all customers for filter dropdown
        const customers = await Billing.getCustomerList();

        // Fetch flash notifications (e.g., from update/cancel actions)
        const notifications = req.flash("message");

        // Render challan list view
        return res.render("Challan/viewAllChallan", {
            groupedChallans,
            customers,
            notifications,
            filters,
            moment,
            title: "Challan List",
            BRAND_NAME: process.env.BRAND_NAME,
            layout: "loggedInLayout"
        });

    } catch (error) {
        console.error("Error fetching challan list:", error);

        // Optionally show a user-friendly error
        return renderHomeWithError(res,error,);
    }
};

/**
 * Handles the cancellation of a challan and renders the challan view with
 * updated customer and company details.
 *
 * - Cancels the challan in the database using `Billing.cancelTheChallan`.
 * - Catches errors during cancellation and pushes an error notification.
 * - Always fetches the customer details, challan details, and renders the view
 *   regardless of success or failure, ensuring consistent rendering.
 *
 * @async
 * @function cancelChallan
 * @param {import('express').Request} req - Express request object containing `challanId` in the body.
 * @param {import('express').Response} res - Express response object used to render the challan view.
 * @returns {Promise<void>} Renders the "Challan/viewChallan" template with relevant data and notifications.
 */

const cancelChallan = async (req, res) => {
    const notifications = [];
    const { challanId, customerId } = req.body;
    let customerDetails = null;
    let challans = null;

    try {
        // Cancel the challan
        await Billing.cancelTheChallan(challanId);

        notifications.push({
            type: 'success',
            messages: 'Challan has been successfully cancelled.',
            icon: 'bi-check-circle-fill'
        });
    } catch (error) {
        console.error(error);

        notifications.push({
            type: 'danger',
            messages: error.message || 'An error occurred while cancelling the challan.',
            icon: 'bi-exclamation-triangle-fill'
        });
    } finally {
        try {
            // Always fetch and render the view
            customerDetails = await Billing.getCustomerDetails(customerId);
            challans = await Billing.getChallanDetails(customerId, challanId);
            const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS);

            res.render('Challan/viewChallan', {
                companyDetails,
                customerDetails,
                challans,
                notifications,
                challanId,
                title: 'Challan data',
                BRAND_NAME: process.env.BRAND_NAME,
                layout: 'loggedInLayout'
            });
        } catch (fetchError) {
            console.error(fetchError);
            res.status(500).send("Unable to load challan details.");
        }
    }
};


/**
 * Handles the delivery process of a challan by updating its status and rendering
 * the challan view with customer and company details.
 *
 * - Marks the challan as delivered in the database.
 * - Pushes a success notification if the operation succeeds.
 * - Catches errors, logs them, and pushes an error notification.
 * - Always fetches the customer details, challan details, and renders the view,
 *   regardless of success or failure, ensuring consistent rendering.
 *
 * @async
 * @function delivery
 * @param {import('express').Request} req - Express request object containing `challanId` and `customerId` in the body.
 * @param {import('express').Response} res - Express response object used to render the challan view.
 * @returns {Promise<void>} Renders the "Challan/viewChallan" template with relevant data and notifications.
 */

const delivery = async (req, res) => {
    const notifications = [];
    const { challanId, customerId } = req.body;
    let customerDetails = null;
    let challans = null;

    try {
        await Billing.deliverTheProduct(challanId);

        notifications.push({
            type: 'success',
            messages: 'Challan is marked as successfully delivered.',
            icon: 'bi-check-circle-fill'
        });
    } catch (error) {
        console.log(error);
        notifications.push({
            type: 'danger',
            messages: error.message || 'An error occurred while delivering the challan.',
            icon: 'bi-exclamation-triangle-fill'
        });
    } finally {
        // Always fetch and render
        customerDetails = await Billing.getCustomerDetails(customerId);
        challans = await Billing.getChallanDetails(customerId, challanId);
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS);

        res.render('Challan/viewChallan', {
            companyDetails,
            customerDetails,
            challans,
            notifications,
            challanId,
            title: 'Challan data',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }
};



const convertToSale= async(req,res)=>{
    const notifications=[]
    try {
        const{challanId,customerId}=req.body
        const invoiceId= await Billing.convertToSale(challanId,customerId);
        const salesData= await Billing.getPrintSaleData(customerId,invoiceId)
        const customerDetails= await Billing.getCustomerDetails(customerId);
        const totalSaleDetails= await Billing.getPrintTotalSaleData(customerId,invoiceId)
        // Add success message to alerts
        notifications.push({
            type: 'success',
            messages: `Sales created successfully with invoice no ${invoiceId}`,
            icon: 'bi-check-circle-fill'
        });
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS)
        res.render('printSale',{notifications,salesData,companyDetails,customerDetails,totalSaleDetails,invoiceId,title:'Sales data ',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
        //after conversion of sale send user to view the sale page


    } catch (error) {
        

        // Add error message to alerts
        notifications.push({
            type: 'danger',
            messages: error.message,
            icon: 'bi-exclamation-triangle-fill'
        });

        // Flash the error messages and redirect back to the add sale page
        //also hve to take care of sales data to be prelist with error later on we will do that 
        req.flash('message', notifications);
        return res.redirect('/billing/viewChallans?error');
    }

}

/**
 * Controller to render the Customer Dues page.
 * Fetches all customers with their pending dues and last payment date,
 * and renders the 'customerDues' view.
 *
 * @async
 * @function viewCustomerDues
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>} Renders the customerDues view. If an error occurs, redirects to home with error.
 */
const getCustomerListWithDues = async (req, res) => {
    try {
        console.log('i m in dues with cust')
      // Fetch all customers with their pending dues
      let customersWithDues = await Billing.getCustomerListWithDues();
      // Convert string sums to numbers so .toFixed() works in EJS
    customersWithDues = customersWithDues.map(cust => ({
        ...cust,
        TotalSales: Number(cust.TotalSales) || 0,
        TotalPayments: Number(cust.TotalPayments) || 0,
        PendingAmount: Number(cust.PendingAmount) || 0
      }));
  
      // Render the view with the fetched data
      res.render('Customer/customerDues', {
        customersWithDues,
        moment,
        title: 'Customer with dues amount',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
  
    } catch (error) {
      console.error('Error in viewCustomerDues:', error);
  
      // Fallback: render home page with error message
      return renderHomeWithError(res, error);
    }
  };
  
  
 // const PAGE_SIZE = 50;
/**
 * getNonMovableStocks
 * -------------------
 * This controller renders the "Non Movable Stocks" page and also handles Excel download.
 *
 * Features:
 * 1. Reads query parameters:
 *    - supplierId: (optional) filter by supplier, else show all suppliers
 *    - search: (optional) filter by product name
 *    - page: (optional) page number for pagination (default 1)
 *    - download: if "true", returns an Excel file instead of HTML
 *
 * 2. Fetches in parallel:
 *    - suppliers: list of all suppliers for the dropdown (Billing.getSuppliersList)
 *    - stocksResult: non-movable / expiring stock rows from vw_non_moving_stock
 *      with filters + pagination (Billing.getNonMovableStocks)
 *    - summary: aggregated counts for cards (total, expired, expiring soon, etc.)
 *      (Billing.getNonMovableSummary)
 *
 * 3. If download=true:
 *    - Creates an Excel workbook
 *    - Adds header row
 *    - Adds one row per stock batch
 *    - Colors rows by StatusFlag (EXPIRED / EXPIRING_SOON / NON_MOVING)
 *    - Sends file as "NonMovingStock.xlsx"
 *
 * 4. If download is not requested:
 *    - Renders the EJS view 'nonMovableDefaultPage' with:
 *        - suppliers list (for dropdown)
 *        - stocks (table data for current page)
 *        - selectedSupplierId, search, page, totalPages, summary
 *        - title / BRAND_NAME / layout
 */
const getNonMovableStocks = async (req, res) => {
    try {
      const supplierId = req.query.supplierId || null;
      const download = req.query.download === "true";
      const search = (req.query.search || '').trim();
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const pageSize = parseInt(process.env.PAGE_SIZE);
  
      // 🔹 Fetch suppliers, stock rows & summary in parallel
      const [suppliers, stocksResult, summary] = await Promise.all([
        Billing.getSuppliersList(),
        Billing.getNonMovableStocks(supplierId, search, page, pageSize),
        Billing.getNonMovableSummary(supplierId, search)
      ]);
  
      const totalPages = Math.max(
        1,
        Math.ceil((summary.totalCount || 0) / pageSize)
      );
  
      // 🔽 Excel download mode
      if (download) {
        const workbook = new ExcelJS.Workbook();
      
        // Main sheet
        const sheet = workbook.addWorksheet("Non Movable Stock");
      
        sheet.addRow([
            "Supplier",
            "Product",
            "Batch",
            "Stock Qty",
            "Sold Qty",
            "Current Stock",
            "Expiry Date",
            "Last Sale Date",
            "Movement Age (Days)",
            "Movement Age (Y-M-D)",
            "Status",
            "Purchase Price",
            "Value At Cost"
          ]);
        
          stocksResult.forEach((row) => {
            sheet.addRow([
              row.SupplierName,                     // text
              row.ProductName,                      // text
              row.BatchNumber,                      // text (batch no is okay as text)
              Number(row.BatchQuantity ?? 0),       // ✅ force number
              Number(row.QuantitySold ?? 0),        // ✅
              Number(row.CurrentStock ?? 0),        // ✅
              row.ExpiryDate ? new Date(row.ExpiryDate) : null,    // date
              row.LastSaleDate ? new Date(row.LastSaleDate) : null,// date
              Number(row.MovementAge ?? 0),         // ✅ number
              row.MovementAgeText,                  // text "1 year 2 months..."
              row.StatusFlag,                       // text
              Number(row.PurchasePrice ?? 0),       // ✅ number
              Number(row.ValueAtCost ?? 0),         // ✅ number
            ]);
          });
        
          // Format numeric columns nicely (optional but good)
          sheet.getColumn(4).numFmt  = '#,##0.00'; // Stock Qty
          sheet.getColumn(5).numFmt  = '#,##0.00'; // Sold Qty
          sheet.getColumn(6).numFmt  = '#,##0.00'; // Current Stock
          sheet.getColumn(9).numFmt  = '0';        // Movement Age (days)
          sheet.getColumn(12).numFmt = '#,##0.00'; // Purchase Price
          sheet.getColumn(13).numFmt = '#,##0.00'; // Value At Cost
      
        // Bold header
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true };
      
        // ✅ Set column widths (so not cramped)
        sheet.getColumn(1).width = 20;  // Supplier
        sheet.getColumn(2).width = 30;  // Product
        sheet.getColumn(3).width = 15;  // Batch
        sheet.getColumn(4).width = 12;  // Stock Qty
        sheet.getColumn(5).width = 12;  // Sold Qty
        sheet.getColumn(6).width = 15;  // Current Stock
        sheet.getColumn(7).width = 15;  // Expiry Date
        sheet.getColumn(8).width = 15;  // Last Sale
        sheet.getColumn(9).width = 18;  // Movement Age (Days)
        sheet.getColumn(10).width = 22; // Movement Age (Y-M-D)
        sheet.getColumn(11).width = 12; // Status
        sheet.getColumn(12).width = 15; // Purchase Price
        sheet.getColumn(13).width = 18; // Value At Cost
      
        // ✅ Color coding by Status (corrected to column 11)
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // skip header
      
          const status = row.getCell(11).value; // Status column
      
          let color = null;
          if (status === "EXPIRED") color = "FFFF6B6B";        // red
          if (status === "EXPIRING_SOON") color = "FFFFD966";  // yellow
          if (status === "NON_MOVING") color = "FFD9D9D9";     // grey
      
          if (color) {
            row.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: color }
              };
            });
          }
        });
      
        // ✅ 2nd sheet: total value per supplier
        const summarySheet = workbook.addWorksheet("Supplier Summary");
        summarySheet.addRow([
          "Supplier",
          "Total Current Stock",
          "Total Value At Cost"
        ]);
        summarySheet.getRow(1).font = { bold: true };
      
        // Build aggregation in JS (no extra SQL needed)
        const supplierMap = new Map();
      
        stocksResult.forEach((row) => {
          const key = row.SupplierName || "Unknown";
          const currentStock = Number(row.CurrentStock || 0);
          const valueAtCost = Number(row.ValueAtCost || 0);
      
          if (!supplierMap.has(key)) {
            supplierMap.set(key, { totalStock: 0, totalValue: 0 });
          }
          const agg = supplierMap.get(key);
          agg.totalStock += currentStock;
          agg.totalValue += valueAtCost;
        });
      
        supplierMap.forEach((agg, supplierName) => {
          summarySheet.addRow([
            supplierName,
            agg.totalStock,
            agg.totalValue
          ]);
        });
      
        // Column widths for summary
        summarySheet.getColumn(1).width = 25;
        summarySheet.getColumn(2).width = 18;
        summarySheet.getColumn(3).width = 20;
      
        // Make summary numbers look nicer (optional)
        summarySheet.getColumn(2).numFmt = '#,##0.00';
        summarySheet.getColumn(3).numFmt = '#,##0.00';
      
        // Response headers
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=NonMovingStock.xlsx"
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
      
        await workbook.xlsx.write(res);
        return res.end();
      }
      
  
      // 🔽 Normal HTML page render
      return res.render('nonMovableDefaultPage', {
        suppliers,
        // here also use stocksResult directly if it is an array
        stocks: stocksResult,
        selectedSupplierId: supplierId,
        search,
        page,
        totalPages,
        summary,
        title: 'Non Movable Stocks',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
    } catch (error) {
      console.error('Error in getNonMovableStocks:', error);
      return renderHomeWithError(res, error);
    }
  };
  



const processUploadedPdf = async (req, res) => {
    try {

       // console.log(req)
      const supplierId = req.body.supplierId;
      const pdfPath = req.file.path;
      console.log(req.file)
  
      // 1. Parse PDF using Google Vision
      const parsedData = await pdfParser.parsePoPdf(pdfPath);
     // const parsedData = await parsePoPdf(pdfPath);

      console.log(req.file)
  
      // 2. Store temporarily
      //const uploadId = uuidv4();
     // uploadStore.set(uploadId, { parsedData, supplierId });
  
      // 3. Load supplier products for dropdown
        const supplierProducts= await Billing.getProductList()

        console.log(parsedData)

        console.log('hi sexy')
  
      // 4. Render review page
      res.render("Billing/poReview", {
        uploadId,
        supplierId,
        header: parsedData.header,
        items: parsedData.items,
        supplierProducts,
        title: 'upload purchase po',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
        
      });
    } catch (err) {
      console.error(err);
      res.send("Error processing PDF");
    }
  };

/**
 * -------------------------------------------------------------
 * downloadSalesReportForGstInExcel
 * -------------------------------------------------------------
 * Purpose:
 * --------
 * Downloads a GST-compliant customer-wise sales report in Excel
 * format based on the selected filters (Customer, FromDate, ToDate).
 *
 * How it works:
 * -------------
 * 1. Reads filter values from request (POST or GET).
 * 2. Fetches sales data using Billing.getSalesReport().
 * 3. Generates an Excel file using ExcelJS.
 * 4. Formats dates as DD-MM-YYYY (GST-friendly format).
 * 5. Applies basic styling and auto-filters.
 * 6. Streams the Excel file directly to the browser.
 *
 * Used by:
 * --------
 * - "Export Excel" button on Sales Report screen
 *
 * Dependencies:
 * -------------
 * - ExcelJS
 * - moment
 * - Billing.getSalesReport()
 *
 * -------------------------------------------------------------
 */
const downloadSalesReportForGstInExcelt = async (req, res) => {
    try {
      // ---------------------------------------------------------
      // 1. Fetch filtered sales data
      // ---------------------------------------------------------
      // NOTE: getSalesReport internally reads filters
      // from req.body (POST) or req.query (GET)
      const salesReports = await Billing.getSalesReport(req);
  
      // ---------------------------------------------------------
      // 2. Create Excel workbook & worksheet
      // ---------------------------------------------------------
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sales Report');
  
      // ---------------------------------------------------------
      // 3. Define Excel columns (GST friendly structure)
      // ---------------------------------------------------------
      sheet.columns = [
        { header: '#', key: 'sn', width: 5 },
        { header: 'Customer Name', key: 'CustomerName', width: 25 },
        { header: 'GST No', key: 'GstNo', width: 18 },
        { header: 'Invoice No', key: 'InvoiceId', width: 15 },
        { header: 'Product Name', key: 'ProductName', width: 25 },
        { header: 'Quantity', key: 'TotalQuantity', width: 10 },
        { header: 'CGST (%)', key: 'Cgst', width: 10 },
        { header: 'SGST (%)', key: 'Sgst', width: 10 },
        { header: 'Total Value (₹)', key: 'TotalValueWithTax', width: 18 },
        { header: 'Invoice Date', key: 'CreatedAt', width: 15 }
      ];
  
      // ---------------------------------------------------------
      // 4. Insert data rows
      // ---------------------------------------------------------
      if (!salesReports || salesReports.length === 0) {
        sheet.addRow({
          CustomerName: 'No records found for selected filters'
        });
      } else {
        salesReports.forEach((r, index) => {
          sheet.addRow({
            sn: index + 1,
            CustomerName: r.CustomerName,
            GstNo: r.GstNo,
            InvoiceId: r.InvoiceId,
            ProductName: r.ProductName,
            TotalQuantity: r.TotalQuantity,
            Cgst: r.Cgst,
            Sgst: r.Sgst,
            TotalValueWithTax: r.TotalValueWithTax,
            CreatedAt: moment(r.CreatedAt).format('DD-MM-YYYY')
          });
        });
      }
  
      // ---------------------------------------------------------
      // 5. Header styling
      // ---------------------------------------------------------
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = {
        vertical: 'middle',
        horizontal: 'center'
      };
  
      // ---------------------------------------------------------
      // 6. Enable auto-filter for easy Excel filtering
      // ---------------------------------------------------------
      sheet.autoFilter = {
        from: 'A1',
        to: 'J1'
      };
  
      // ---------------------------------------------------------
      // 7. Send Excel file to browser
      // ---------------------------------------------------------
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=GST_Sales_Report.xlsx'
      );
  
      await workbook.xlsx.write(res);
      res.end();
  
    } catch (error) {
      // ---------------------------------------------------------
      // 8. Error handling
      // ---------------------------------------------------------
      console.error('GST Sales Excel Export Error:', error);
  
      if (!res.headersSent) {
        res.status(500).send('Failed to generate GST sales Excel report');
      }
    }
  };



const downloadSalesReportForGstInExcel = async (req, res) => {
  try {
    // ==============================
    // 1️⃣ Fetch Grouped Invoice Data
    // ==============================
    const salesReports = await Billing.getSalesReport(req); 
    // ⚠ Must return grouped invoice structure:
    // [
    //   {
    //     InvoiceId,
    //     CustomerName,
    //     GstNo,
    //     CreatedAt,
    //     Products: [],
    //     SubTotal,
    //     TotalCgst,
    //     TotalSgst,
    //     GrandTotal
    //   }
    // ]

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GST Sales Report');

    let currentRow = 1;

    // ==============================
    // 2️⃣ COMPANY HEADER
    // ==============================
    sheet.mergeCells(`A${currentRow}:I${currentRow}`);
    sheet.getCell(`A${currentRow}`).value = 'Ranjana Imaging And Medical Solutions';
    sheet.getCell(`A${currentRow}`).font = { size: 16, bold: true };
    sheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
    currentRow++;

    sheet.mergeCells(`A${currentRow}:I${currentRow}`);
    sheet.getCell(`A${currentRow}`).value = 'GST Sales Report';
    sheet.getCell(`A${currentRow}`).font = { size: 14, bold: true };
    sheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
    currentRow++;

    sheet.mergeCells(`A${currentRow}:I${currentRow}`);
    sheet.getCell(`A${currentRow}`).value =
      `Report Period: ${req.query.FromDate || ''} to ${req.query.ToDate || ''}`;
    sheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
    currentRow += 2;

    // ==============================
    // 3️⃣ Overall Totals Variables
    // ==============================
    let grandSubTotal = 0;
    let grandCgst = 0;
    let grandSgst = 0;
    let grandTotal = 0;

    // ==============================
    // 4️⃣ Invoice Loop
    // ==============================
    salesReports.forEach((invoice) => {

      // 🔹 Invoice Header
      sheet.mergeCells(`A${currentRow}:I${currentRow}`);
      sheet.getCell(`A${currentRow}`).value =
        `Invoice: ${invoice.InvoiceId} | Customer: ${invoice.CustomerName} | GST: ${invoice.GstNo || '-'} | Date: ${invoice.CreatedAt}`;
      sheet.getCell(`A${currentRow}`).font = { bold: true };
      currentRow += 2;

      // 🔹 Table Header
      const headerRow = sheet.addRow([
        'S.No',
        'Product Name',
        'Qty',
        'Taxable Value (₹)',
        'CGST %',
        'CGST Amt (₹)',
        'SGST %',
        'SGST Amt (₹)',
        'Total Value (₹)',
        'Total Value With Tax (₹)'
      ]);

      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center' };

      headerRow.eachCell(cell => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEFEFEF' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      currentRow++;

      // 🔹 Product Rows
      invoice.Products.forEach((product, i) => {

        const taxableValue = parseFloat(product.TotalValue) || 0;
        const cgstPercent = parseFloat(product.Cgst) || 0;
        const sgstPercent = parseFloat(product.Sgst) || 0;
        const cgstAmount = parseFloat(product.CgstAmount) || 0;
        const sgstAmount = parseFloat(product.SgstAmount) || 0;
        const totalValue = parseFloat(product.TotalValue) || 0;
        const totalWithTax = parseFloat(product.TotalValueWithTax) || 0;

        const row = sheet.addRow([
          i + 1,
          product.ProductName,
          product.QuantitySold,
          taxableValue,
          cgstPercent,
          cgstAmount,
          sgstPercent,
          sgstAmount,
          totalValue,
          totalWithTax
        ]);

        row.getCell(4).numFmt = '#,##0.00';
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(8).numFmt = '#,##0.00';
        row.getCell(9).numFmt = '#,##0.00';

        row.eachCell(cell => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });

        currentRow++;
      });

      currentRow++;

      // 🔹 Invoice Totals
      const totals = [
        ['SubTotal', invoice.SubTotal],
        ['Total CGST', invoice.TotalCgst],
        ['Total SGST', invoice.TotalSgst],
        ['Grand Total', invoice.GrandTotal]
      ];

      totals.forEach(t => {
        const row = sheet.addRow(['', '', '', '', '', '', '','', t[0], t[1]]);
        row.font = { bold: true };
        row.getCell(9).numFmt = '#,##0.00';
        currentRow++;
      });

      currentRow += 2;

      // 🔹 Add to overall totals
      grandSubTotal += invoice.SubTotal;
      grandCgst += invoice.TotalCgst;
      grandSgst += invoice.TotalSgst;
      grandTotal += invoice.GrandTotal;
    });

    // ==============================
    // 5️⃣ OVERALL GST SUMMARY
    // ==============================
    sheet.mergeCells(`A${currentRow}:I${currentRow}`);
    sheet.getCell(`A${currentRow}`).value = 'OVERALL GST SUMMARY';
    sheet.getCell(`A${currentRow}`).font = { size: 13, bold: true };
    sheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
    currentRow += 2;

    [
      ['Total Taxable Value', grandSubTotal],
      ['Total CGST', grandCgst],
      ['Total SGST', grandSgst],
      ['Overall Grand Total', grandTotal]
    ].forEach(summary => {

      const row = sheet.addRow(['', '', '', '', '', '', '', summary[0], summary[1]]);
      row.font = { bold: true };
      row.getCell(9).numFmt = '#,##0.00';
      currentRow++;
    });

    // ==============================
    // 6️⃣ Column Widths
    // ==============================
    sheet.columns = [
      { width: 6 },
      { width: 35 },
      { width: 8 },
      { width: 15 },
      { width: 10 },
      { width: 14 },
      { width: 10 },
      { width: 14 },
      { width: 18 },
      { width: 30 }
    ];

    // ==============================
    // 7️⃣ Send File
    // ==============================
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=GST_Sales_Report.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('GST Sales Excel Export Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Failed to generate GST sales Excel report');
    }
  }
};
const viewSalesInHtml = async(req,res)=>{

    try {
        const { invoiceId, customerId } = req.params;
        
        // Fetch data
        const salesData = await Billing.getPrintSaleData(customerId, invoiceId);
        const customerDetails = await Billing.getCustomerDetails(customerId);
        const totalSaleDetails = await Billing.getPrintTotalSaleData(customerId, invoiceId);
        const companyDetails = JSON.parse(process.env.SELLER_COMPANY_DETAILS);
       /*const companyDetails = {
                                  coreCompany: process.env.SELLER_NAME,
                                  coreCompanyAddress: process.env.SELLER_ADDRESS,
                                  coreCompanyPhoneNumber: process.env.SELLER_PHONE,
                                  coreCompanyEmail: process.env.SELLER_EMAIL,
                                  coreCompanyBankName: process.env.SELLER_BANK,
                                  coreCompanyAccountNo: process.env.SELLER_ACC_NO,
                                  coreCompanyIFSCCode: process.env.SELLER_IFSC,
                                  coreCompanyGstNo: process.env.SELLER_GST,
                                  coreCompanyDLNo: process.env.SELLER_DL,
                                };*/

        // Check for missing data
        if (!salesData || salesData.length === 0) {
            return res.status(404).send("No sales data found for this invoice.");
        }
        if (!customerDetails || Object.keys(customerDetails).length === 0) {
            return res.status(404).send("Customer details not found.");
        }

        // Convert company logo to Base64 for PDF
        const imagePath = path.resolve(__dirname, '../images/RanjanaImaging.png');
        const imageData = fs.readFileSync(imagePath).toString('base64');
        const imageBase64 = `data:image/jpeg;base64,${imageData}`;
console.log('in here test')
        // Render EJS template
        const templatePath = path.join(__dirname, '../views/Billing/viewSalesInHtml.ejs');
        const htmlContent = await ejs.renderFile(templatePath, { 
            salesData, 
            customerDetails, 
            totalSaleDetails, 
            invoiceId, 
            companyDetails,
            imageBase64
        });
        console.log('in here 2')
       return res.send(htmlContent);

    } catch (error) {
        
    }

}
/**
 * Controller: Get Details of Expired Products
 * -------------------------------------------
 * Purpose:
 * This function handles the request to view expired product stock.
 * It fetches expired stock details along with supplier and product lists,
 * prepares pagination & filter data, processes flash notifications,
 * and renders the "moveExpiredProduct" view.
 *
 * Flow:
 * 1. Fetch expired product details (with pagination & filters) from Billing service.
 * 2. Fetch supplier list and product list for dropdown filters.
 * 3. Read any flash messages (success/error notifications).
 * 4. Prepare notification objects for UI display.
 * 5. Render the page with:
 *      - Expired stock data
 *      - Supplier & product filters
 *      - Pagination details
 *      - Notification messages
 *
 * Request Dependencies:
 * - req.query.page
 * - req.query.supplierId
 * - req.query.productId
 * - req.flash() for notifications
 *
 * Response:
 * - Renders "Billing/moveExpiredProduct" view with required data.
 *
 * Error Handling:
 * - If any error occurs, fallback to home page with error message.
 *
 * Used When:
 * - User opens the Expired Product page
 * - User applies supplier/product filter
 * - After moving expired stock (redirect target)
 */

const getDetailsOfExpiredProduct= async(req,res)=>{

const notifications=[]
    try {
       const expiredProductDetails= await Billing.getExpiredProductDetails(req);
       const suppliers= await Billing.getSuppliersList();
       const products= await Billing.getProductList()
      // console.log(expiredProductDetails)
       const flashMessages = req.flash('message');
       //console.log(flashMessages); // will be array of objects
        const message = flashMessages.length ? flashMessages[0] : null;
          if (message) { 
            notifications.push(createNotification(message.type,message.msg,message.icon));
        }

       // console.log(notifications);
       // console.log('i m here')
                // 4. Render review page
      res.render("Billing/moveExpiredProduct", {
        expiredStock: expiredProductDetails.data,     // 👈 table rows
            suppliers,
            products,
            pagination: {
                currentPage: expiredProductDetails.currentPage,
                totalPages: expiredProductDetails.totalPages,
                totalRecords: expiredProductDetails.totalRecords,
                pageSize: expiredProductDetails.pageSize
            },
            filters: {
                supplierId: req.query.supplierId || "",
                productId: req.query.productId || ""
            },
        title: 'Expired product',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout',
        notifications
        
      });
    } catch (error) {
         // Fallback: render home page with error message
      return renderHomeWithError(res, error);
    }
}
/**
 * Controller: Move Expired Product
 * --------------------------------
 * Purpose:
 * This function moves selected expired stock items into the ExpiredStock table
 * (or performs settlement logic as defined in Billing service).
 *
 * Flow:
 * 1. Receive selected stock IDs from request body.
 * 2. Call Billing.moveExpiredProduct() service method.
 * 3. Store success notification using flash message.
 * 4. Preserve current pagination & filter state.
 * 5. Redirect back to expired product page with same filters.
 *
 * Request Dependencies:
 * - req.body.stockIds  → Array of selected stock IDs
 * - req.body.page
 * - req.body.supplierId
 * - req.body.productId
 * - req.user.Id        → Logged-in user ID
 *
 * Response:
 * - Redirects to `/billing/moveExpiredProduct`
 *   while maintaining page and filter query parameters.
 *
 * Success Handling:
 * - Shows success notification using flash message.
 *
 * Error Handling:
 * - On failure, stores error notification
 * - Redirects back to expired product page
 *
 * Used When:
 * - User selects expired stock rows
 * - User clicks "Move to Expired" button
 */

const moveExpiredProduct= async(req,res)=>{
    try {

        console.log(req.body)
        const result= await Billing.moveExpiredProduct(req.body.stockIds,req.user.Id);
        const {page,supplierId,productId}=req.body;
        // ✅ store notification
        req.flash('message', {
            type: 'success',
            msg:result,
            icon: 'bi-check-circle'
        });

        const query = new URLSearchParams({
            page: page || 1,
            supplierId: supplierId || "",
            productId: productId || ""
        }).toString();
console.lo
        return res.redirect(`/billing/moveExpiredProduct?${query}`);


    } catch (error) {
        req.flash(error.message, {
            type: 'error',
            msg: 'While moving Expired stock, some error occured.',
            icon: 'bi-exclamation-triangle'
        });
       // req.flash('error', error.message || 'Something went wrong');
        return res.redirect('/billing/moveExpiredProduct');
    }
}

const showIndividualProductPriceHistory = async (req, res) => {
    try {
        const productId = parseInt(req.query.productId);
        const supplierId = req.query.supplierId
            ? parseInt(req.query.supplierId)
            : null;

        const page = req.query.page
            ? parseInt(req.query.page)
            : 1;

        const limit = parseInt(process.env.PAGE_SIZE);

        // 🔁 Fetch data from service/model
        const result = await Billing.getProductPriceHistory(
            productId,
            supplierId,
            page,
            limit
        );

        /**
         * result structure:
         * {
         *   data: [],
         *   pagination: {
         *     totalRecords,
         *     totalPages,
         *     currentPage,
         *     limit
         *   }
         * }
         */

        return res.render('Billing/individualProductPriceHistory', {
            rows: result.data,
            pagination: result.pagination,

            productId,
            selectedSupplierId: supplierId,

            title: 'Product Price History',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (error) {
        console.error(
            'Error in showIndividualProductPriceHistory controller:',
            error
        );
        return renderHomeWithError(res, error, '');
    }
};

/**
 * ------------------------------------------------------------
 * Controller: getListOfMovedExpiredProduct
 * ------------------------------------------------------------
 * Description:
 * Fetches all expired products that have already been moved
 * from Stock table to ExpiredStock table and renders them
 * in a structured list view.
 *
 * Purpose:
 * This page allows users to:
 * - View expired products
 * - Check settlement status
 * - Initiate settlement process
 *
 * Route:
 * GET /expired-stock
 *
 * Returns:
 * Renders nonMovableDefaultPage.ejs with:
 *   - listOfExpiredProducts (Array)
 *   - title (String)
 *   - BRAND_NAME (String)
 *
 * Errors:
 * Logs error and shows 500 page if something fails.
 * ------------------------------------------------------------
 */
/*const getListOfMovedExpiredProduct = async (req, res) => {
    try {

        // 🔽 Fetch expired products from service/model layer
        const expiredList =
            await Billing.getListOfMovedExpiredProduct();

        // 🔽 Render page
        return res.render('Billing/viewMovedExpiredProduct', {
            expiredList,
            title: 'List of Expired Stocks',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (error) {

        console.error('Error in getListOfMovedExpiredProduct:', error);

        return res.status(500).render('errorPage', {
            message: 'Unable to fetch expired products.',
            layout: 'loggedInLayout'
        });
    }
};*/


 /**
 * Controller: Get List of Moved Expired Products
 *
 * Features:
 * - Supplier filter
 * - Status filter (PENDING / PARTIAL / SETTLED)
 * - Pagination (LIMIT + OFFSET)
 * - Returns total count for pagination UI
 *
 * Query Params:
 *  - supplierId (optional)
 *  - status (optional)
 *  - page (default: 1)
 *
 * Renders:
 *  - Billing/viewMovedExpiredProduct
 */
 const getListOfMovedExpiredProduct = async (req, res) => {
    try {

        const supplierId = req.query.supplierId || '';
        const status = req.query.status || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        // 🔽 Fetch paginated result
        const result = await Billing.getListOfMovedExpiredProduct({
            supplierId,
            status,
            limit,
            offset
        });
        console.log(result);
        console.log('result expired')
        const totalRecords = result.total;   // ✅ THIS WAS MISSING
        const totalPages = Math.ceil(totalRecords / limit);

        const suppliers = await Billing.getSuppliersList();

        return res.render('Billing/viewMovedExpiredProduct', {
            expiredList: result.rows,
            suppliers,
            filters: {
                supplierId,
                status
            },
            title: 'List of Expired Stocks',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            pagination: {
                currentPage: page,
                totalPages,
                totalRecords,
                limit
            }
        });

    } catch (error) {

        console.error("Error in getListOfMovedExpiredProduct:", error);
        return renderHomeWithError(res, error, '');
    }
};

const searchSupplierInvoice =async(req,res)=>{
    try {
        
        console.log(req.query)
        const keyword = req.query.keyword || '';
        const supplierId = req.query.supplierId;

        if (!supplierId) {
            return res.status(400).json({
                success: false,
                message: "No SupplierId found."
            });
            
        }

        if (!keyword || keyword.length <=3) {
            return res.status(400).json({
                success: false,
                message: "No Keyword found or Keyword is less or equal to 3 word."
            });
        }
        const invoices = await Billing.searchSupplierInvoice({keyword,supplierId});
        console.log(invoices)
        return res.json(invoices);

    } catch (error) {
        console.error('Invoice search error:', error);
        return res.status(500).json([]);
    }
}

const getInvoiceProducts = async(req,res)=>{
    try {

        const invoiceId = req.query.invoiceId;

        if (!invoiceId) {
            return res.json([]);
        }

        const products =
            await Billing.getInvoiceProducts(invoiceId);

        return res.json(products);

    } catch (error) {
        console.error('Invoice products fetch error:', error);
        return res.status(500).json([]);
    }
}

/*const settleExpiredStock= async(req,res)=>{

    try {

        const {expiredId,invoiceId,settlementDetails} = req.body;
        const userId = req.user?.Id || 1; // adjust as per auth

        if (!expiredId || !invoiceId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request'
            });
        }

        await Billing.settleExpiredStock({
            expiredId,
            invoiceId,
            settlementDetails,
            userId
        });

        return res.json({
            success: true,
            message: 'Settlement completed successfully'
        });

    } catch (error) {

        console.error('Settlement error:', error);

        return res.status(500).json({
            success: false,
            message: 'Settlement failed'
        });
    }
}*/

const getLastThreePricesBulk= async(req,res)=>{

    try {

        const { productIds, supplierId } = req.query;

        if (!productIds || !supplierId) {
            return res.json({});
        }

        const idsArray = productIds.split(',').map(id => parseInt(id));

        const data = await Billing.getLastThreePricesBulk(
            idsArray,
            supplierId
        );

        return res.json(data);

    } catch (error) {
        console.error('Error getLastThreePricesBulk:', error);
        return res.status(500).json([]);
    }

}


/**
 * ============================================================
 * Controller: expiredStockSettle
 * ============================================================
 *
 * Route Type: POST
 *
 * Description:
 *   Handles settlement of expired stock against supplier invoice credit.
 *   This endpoint validates input data and forwards settlement details
 *   to the Billing service layer for processing.
 *
 * Business Flow:
 *   1. Accepts expired stock ID and settlement breakdown.
 *   2. Validates required request body fields.
 *   3. Passes settlement details to Billing.settleExpiredStock().
 *   4. Associates settlement with currently logged-in user.
 *   5. Returns success or error response.
 *
 * Expected Request Body:
 * {
 *   expiredId: number,              // Required - Expired stock record ID
 *   settlements: [                  // Required - Array of settlement entries
 *     {
 *       invoiceId: number,
 *       productId: number,
 *       amount: number
 *     }
 *   ]
 * }
 *
 * Session Requirement:
 *   req.session.user.Id must exist
 *   (Used for audit trail / tracking who performed settlement)
 *
 * Success Response (200):
 * {
 *   message: "Settlement successful"
 * }
 *
 * Error Responses:
 *   400 - Invalid or missing request data
 *   500 - Internal error during settlement processing
 *
 * Important Notes:
 *   - This controller does NOT perform financial calculations.
 *   - All accounting logic is handled inside Billing.settleExpiredStock().
 *   - Ensure settlement amounts are validated at service level
 *     to prevent over-settlement.
 */
const expiredStockSettle = async (req, res) => {

    try {

        const { expiredId, settlements } = req.body;

        console.log(expiredId)

        if (!expiredId || !settlements || !settlements.length) {
            return res.status(400).json({
                message: 'Invalid request data'
            });
        }

        await Billing.settleExpiredStock({
            expiredId,
            settlements,
            userId: req.user.Id
        });

        return res.json({
            message: 'Settlement successful'
        });

    } catch (error) {

        console.error('Settlement error:', error);

        return res.status(500).json({
            message: 'Settlement failed'
        });
    }
};


/**
 * Controller: Check Invoice Credit
 * ---------------------------------
 * This API endpoint fetches credit details for a specific invoice.
 * 
 * Route Type: GET
 * Expected Query Params:
 *   - invoiceId (number) [required]
 * 
 * Description:
 *   - Calls billingModel.getInvoiceCredit(invoiceId)
 *   - Returns credit-related information for the given invoice
 *   - Used in billing / settlement module to verify available credit
 * 
 * Response:
 *   Success (200):
 *     Returns credit object from model
 * 
 *   Error (400):
 *     If invoiceId is missing
 * 
 *   Error (500):
 *     If database or internal error occurs
 */
const checkInvoiceCredit = async (req, res) => {
    try {
        const { invoiceId } = req.query;

        // ✅ Validate input
        if (!invoiceId) {
            return res.status(400).json({
                success: false,
                message: "Invoice ID is required"
            });
        }

        const credit = await Billing.getInvoiceCredit(invoiceId);

        return res.status(200).json({
            success: true,
            data: credit
        });

    } catch (err) {
        console.error("Error in checkInvoiceCredit:", err);

        return res.status(500).json({
            success: false,
            message: "Error fetching invoice credit"
        });
    }
};

// Centralized notification creation
const createNotification = (type, messages, icon) => ({type,messages,icon,});

module.exports= {
    getCreateSupplierPage:getCreateSupplierPage,
    createSupplier:createSupplier,
    getSupplierList:getSupplierList,
    getCreateProductPage:getCreateProductPage,
    createProduct:createProduct,
    getProductList:getProductList,
    getCreateCustomerPage:getCreateCustomerPage,
    createCustomer:createCustomer,
    getCustomerList:getCustomerList,
    //getAddStockPage:getAddStockPage,
    //addStock:addStock,
    getStockListPage:getStockListPage,
    getSalePage:getSalePage,
    addSale:addSale,
    getSalesData:getSalesData,
    getAddNotesPage:getAddNotesPage,
    addNotes:addNotes,
    displayAllNotes:displayAllNotes,
    getAddPaymentPage:getAddPaymentPage,
    addPayment:addPayment,
   // getDues:getDues,
    getStockHistory:getStockHistory,
    getIndividualCustomerLedger:getIndividualCustomerLedger,
    getCustomerLedgerInPdf:getCustomerLedgerInPdf,
    getPurchasePoPage:getPurchasePoPage,
    createPurchasePo:createPurchasePo,
    downloadPurchasePo:downloadPurchasePo,
    downloadSales:downloadSales,
    viewPurchasePo:viewPurchasePo,
    viewPurchasePoList:viewPurchasePoList,
    //makeOrderComplete:makeOrderComplete,
    viewSales:viewSales,
    viewSaleThroughSearch:viewSaleThroughSearch,
    customerWiseSales:customerWiseSales,
   // custometrWiseSalesSearcheReport:custometrWiseSalesSearcheReport,
    getReceivePurchaseOrderPage:getReceivePurchaseOrderPage,
    generateInvoice:generateInvoice,
    invoiceDetails:invoiceDetails,
    getCustomersLedger:getCustomersLedger,
    downloadLedgerInExcel:downloadLedgerInExcel,
    getProductPrice:getProductPrice,
    getupdatePricePageForCustomer:getupdatePricePageForCustomer,
    setProductPriceForCustomer:setProductPriceForCustomer,
    downloadInvoice:downloadInvoice,
    getStockDetails:getStockDetails,
    editProductDetail:editProductDetail,
    getupdateSalesPage:getupdateSalesPage,
    updateSales:updateSales,
    getReturnSalePage:getReturnSalePage,
    salesReturn:salesReturn,
    downloadStockInExcel:downloadStockInExcel,
    downloadSalesReportInExcel:downloadSalesReportInExcel,
    getSalesReportSupplierWisePage:getSalesReportSupplierWisePage,
    salesReportSupplierWise:salesReportSupplierWise,
    getStockList:getStockList,
    editCustomer:editCustomer,
    updateCustomer:updateCustomer,
    getSupplierLedger:getSupplierLedger,
    getAddPaymentPageForSupplier:getAddPaymentPageForSupplier,
    addPaymentToSupplier:addPaymentToSupplier,
    downloadSupplierLedgerInExcel:downloadSupplierLedgerInExcel,
    getCreateChallanPage:getCreateChallanPage,
    createChallan:createChallan,
    viewChallan:viewChallan,
    downloadChallanInPdf:downloadChallanInPdf,
    viewChallans:viewChallans,
    cancelChallan:cancelChallan,
    convertToSale:convertToSale,
    delivery:delivery,
    getCustomerListWithDues:getCustomerListWithDues,
    getNonMovableStocks:getNonMovableStocks,
    processUploadedPdf:processUploadedPdf,
    downloadSalesReportForGstInExcel:downloadSalesReportForGstInExcel,
    viewSalesInHtml:viewSalesInHtml,
    getDetailsOfExpiredProduct:getDetailsOfExpiredProduct,
    moveExpiredProduct:moveExpiredProduct,
    showIndividualProductPriceHistory:showIndividualProductPriceHistory,
    getListOfMovedExpiredProduct:getListOfMovedExpiredProduct,
    searchSupplierInvoice:searchSupplierInvoice,
    getInvoiceProducts:getInvoiceProducts,
   // settleExpiredStock:settleExpiredStock,
    getLastThreePricesBulk:getLastThreePricesBulk,
    expiredStockSettle:expiredStockSettle,
    checkInvoiceCredit:checkInvoiceCredit
    
}