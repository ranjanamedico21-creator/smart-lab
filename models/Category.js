
const dbConnection = require("../config/DBConnection");
const currDateAndTime = require("../helper/helper");
const moment = require('moment');


/**
 * 
 * @param {*} req 
 * @returns 
 */
const createCategory = async (req) => {
  // Validate user authentication early
  if (!req.user || !req.user.Id) {
    throw new Error("User authentication failed.");
  }

  // Validate input
  if (!req.body.category) {
    throw new Error("Category name is required.");
  }

  const dateTime = moment().format("YYYY-MM-DD HH:mm:ss");
  let transactionStarted = false;
  const connection = await dbConnection.pool.getConnection();

  try {
    const categoryDetails = {
      Name: req.body.category.trim().toUpperCase(),
      CreatedOn: dateTime,
      CreatedBy: req.user.Id,
      CommissionRate: req.body.thanks !== undefined ? req.body.thanks : 0, // ✅ Ensures 0 if undefined
    };

    await connection.beginTransaction();
    transactionStarted = true;

    // ✅ Insert into Category table
    const categoryQuery = `
      INSERT INTO Category (Name, CreatedOn, CreatedBy) 
      VALUES (?, ?, ?)
    `;
    const [categoryResult] = await connection.query(categoryQuery, [
      categoryDetails.Name,
      categoryDetails.CreatedOn,
      categoryDetails.CreatedBy,
    ]);
    const newCategoryId = categoryResult.insertId;

    // ✅ Insert into DoctorCategoryCommission table
    const commissionQuery = `
      INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy) 
      SELECT Id AS DoctorId, ? AS CategoryId, ? AS CommissionRate, NOW(), NOW(), ? AS CreatedBy 
      FROM DoctorDetails
    `;
    await connection.query(commissionQuery, [
      newCategoryId,
      categoryDetails.CommissionRate,
      categoryDetails.CreatedBy,
    ]);

    // ✅ Commit transaction
    await connection.commit();
    console.log("✅ Category created successfully.");
    return  "Category created successfully.";

  } catch (error) {
    if (transactionStarted) {
      await connection.rollback(); // ✅ Rollback transaction on error
    }
    console.error("❌ Error creating category:", error.message);
    throw new Error("Failed to create category. Please try again.");
  } finally {
    connection.release(); // ✅ Always release connection
  }
};




/**
 * 
 * @param {*} req 
 * @returns 
 */
const createDocumentCategory = async (req) => {
  try {
    // Ensure moment.js is used correctly
    const dateTime = moment().format('YYYY-MM-DD HH:mm:ss');

    // Validate required fields
    if (!req.body.category) {
      throw new Error("Document category name is required.");
    }

    if (!req.user || !req.user.Id) {
      throw new Error("User ID is missing. Please log in.");
    }

    const categoryDetails = {
      Name: req.body.category,
      CreatedOn: dateTime, // ✅ Fixed: Using the correct variable
      CreatedBy: req.user.Id,
    };

    // Insert into the database
    const documentCategoryQuery = "INSERT INTO DocumentCategory SET ?";
    const [result] = await dbConnection.connection.promise().query(documentCategoryQuery, [categoryDetails]);

    // Check if the category was created
    if (result.affectedRows > 0) {
      return "Document category created successfully.";
    }

    throw new Error("Document category creation failed.");
  } catch (error) {
    console.error("Error creating document category:", error.message);
    throw error;
  }
};


const validateUserInput = (req) => {
  const errors = [];
  if (!req.body.category) {
    errors.push({ msg: "Kindly fill in all the fields." });
  }
  return errors;
};
/**
 * 
 * @param {*} categoryName 
 * @param {*} tableName 
 * @returns 
 */

const findCategory = async (categoryName, tableName) => {
  try {
    // Allow only specific table names to prevent SQL injection
    //this function is used for document category also 
    const allowedTables = ["DocumentCategory", "Category"]; // ✅ Define safe tables
    if (!allowedTables.includes(tableName)) {
      throw new Error("Invalid table name.");
    }

    // Use a parameterized query to prevent SQL injection
    const findQuery = `SELECT * FROM ?? WHERE LOWER(Name) = LOWER(?)`;
    const [result] = await dbConnection.connection.promise().query(findQuery, [tableName, categoryName]);

    return result.length > 0 ? result : null; // ✅ Return full result instead of boolean if needed
  } catch (error) {
    console.error("Error finding category:", error.message);
    throw error;
  }
};


const getCategoryList = async () => {
  try {
    // Query to fetch categories with user details and formatted date
    const categoryListQuery = `SELECT 
                                    Category.*, 
                                    Users.FirstName, 
                                    Users.LastName, 
                                    DATE_FORMAT(Category.CreatedOn, '%d-%m-%Y %H:%i:%s') AS CreatedOn 
                                FROM 
                                    Category 
                                JOIN 
                                    Users ON Users.Id = Category.CreatedBy 
                                ORDER BY 
                                    Category.Id DESC`;

    // Execute the query
    const [categories] = await dbConnection.connection.promise().query(categoryListQuery);

    return categories.length > 0 ? categories : []; // ✅ Ensures an empty array instead of `undefined`
  } catch (error) {
    console.error("Error retrieving category list:", error.message);
    throw error; // ✅ Keeps the original error for debugging
  }
};



const getDocumentCategoryList = async () => {
  try {
    // Query to fetch document categories with formatted date
    const documentCategoryQuery =` SELECT 
                                        DocumentCategory.*, 
                                        Users.FirstName, 
                                        Users.LastName, 
                                        DATE_FORMAT(DocumentCategory.CreatedOn, '%d-%m-%Y %H:%i:%s') AS CreatedOn 
                                    FROM 
                                        DocumentCategory 
                                    JOIN 
                                        Users ON Users.Id = DocumentCategory.CreatedBy 
                                    ORDER BY 
                                    DocumentCategory.Id DESC`;
    // Execute query
    const [documentCategories] = await dbConnection.connection.promise().query(documentCategoryQuery);

    return documentCategories.length > 0 ? documentCategories : []; // ✅ Always return an array
  } catch (error) {
    console.error("Error retrieving document category list:", error.message);
    throw error; // ✅ Keeps the original error for debugging
  }
};

const getCategoryById= async(categoryId)=>{

  try {
    const categoryDetailsQuery='Select * from Category where Id=?';
    const [categoryDetails]=await dbConnection.connection.promise().query(categoryDetailsQuery,[categoryId])
    return categoryDetails[0]
  } catch (error) {
    throw error
  }
}
/**
 * 
 * @param {*} categoryName 
 * @param {*} categoryId 
 * @returns 
 * this is used to update the test category like mri ,ct scan
 */
const updateCategory = async (categoryName, categoryId) => {
  try {
   
   // Convert category name to UPPERCASE and remove extra spaces
   categoryName = categoryName.trim().toUpperCase(); 

    // Execute Update Query
    const [result] = await dbConnection.connection
      .promise()
      .query("UPDATE Category SET Name = ? WHERE Id = ?", [categoryName, categoryId]);

    // Check if rows were updated
    if (result.affectedRows > 0) {
      return   "Category updated successfully.";
    } else {
      throw new Error("No category found with the given ID.");
    }
  } catch (error) {
    console.error("❌ Error updating category:", error.message);
    return { success: false, message: error.message };
  }
};

const getDocumentCategoryById= async(documentCategoryId)=>{

  try {
    const [documentCategoryDetails] = await dbConnection.connection.promise().query('select * from DocumentCategory where Id=?',[documentCategoryId])
    return documentCategoryDetails[0];
  } catch (error) {
    console.log(error)
    throw error
  }
}

const updateDocumentCategory = async (documentCategoryName, documentCategoryId) => {
  let connection;

  try {
    // Get a database connection from the pool
    connection = await dbConnection.pool.getConnection();

    const query = "UPDATE DocumentCategory SET Name = ? WHERE Id = ?";
    const [result] = await connection.query(query, [documentCategoryName, documentCategoryId]);

    if (result.affectedRows > 0) {
      return "Document category updated successfully.";
    } else {
      throw new Error(`Document with category ID ${documentCategoryId} not found.`);
    }

  } catch (error) {
    console.error("Error updating document category:", error.message);
    throw error; // Re-throw error to be handled at a higher level

  } finally {
    if (connection) connection.release(); // Ensure the connection is released back to the pool
  }
};


module.exports = updateCategory;

module.exports = {
  validateUserInput,
  findCategory,
  createCategory,
  getCategoryList,
  createDocumentCategory,
  getDocumentCategoryList,
  getCategoryById,
  updateDocumentCategory,
  getDocumentCategoryById,
  updateCategory

};

