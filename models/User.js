//const pool = require("./../config/DBConnection");
const dbConnection = require("./../config/DBConnection");
const bcrypt = require("bcrypt");
const mysql = require('mysql2');
const moment =require('moment');
const { strategies } = require("passport");

const createNewUser = async (userDetails) => {
  try {
    const isEmailExist = await checkExistEmail(userDetails.Email);
    console.log(isEmailExist)
    console.log('i m in user login')
        if (isEmailExist) {
          throw new Error(`This email "${userDetails.Email}" already exists. Please choose another one .`);
        }

    // Hash password
    let salt = bcrypt.genSaltSync(10);
    let hashedPassword = bcrypt.hashSync(userDetails.Password, salt);
    // Debug SQL query
    const sqlQuery = mysql.format(`INSERT INTO Users (FirstName, LastName, Email, DateOfJoining, Password, PhoneNumber, Gender) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                      userDetails.FirstName,
                                      userDetails.LastName,
                                      userDetails.Email,
                                      moment(userDetails.DateOfJoining, 'DD-MM-YYYY').format('YYYY-MM-DD'),
                                      hashedPassword,
                                      userDetails.PhoneNumber,
                                      userDetails.Gender
                                    ]
    );

    console.log("Final SQL Query:", sqlQuery);

    // Insert into database
    await dbConnection.connection.promise().execute(sqlQuery);
    return "You have successfully registered. Please login.";
  } catch (error) {
    throw error;
  }
};

const checkExistEmail = async (email) => {
  try {
    const [rows] = await dbConnection.connection.promise().execute(
      "SELECT * FROM Users WHERE Email = ?",
      [email]
    );
    return rows.length > 0;
  } catch (err) {
    throw err;
  }
};


let findUserByEmail = async (email) => {
  try {
    // Using the promise() wrapper to get a promise-based version of execute
    const [users] = await dbConnection.connection.promise().execute(
      "SELECT * FROM `Users` WHERE `Email` = ?", 
      [email]
    );
    
    // Check if a user is found
    if (users.length > 0) {
        return users[0];  // Return the first user found
    } else {
      return false;
    }
  } catch (error) {
    // Handle errors (e.g., database issues)
    throw error;
  }
};


let findUserById = (id) => {
  return new Promise(async(resolve, reject) => {
   // const connection = await pool.getConnection(); // Assuming you have a MySQL connection pool setup
    try {
      dbConnection.connection.execute(" SELECT * FROM `Users` WHERE `Id` = ?",[id],function (err, user) {
          if (err) {
            reject(err);
          }else{
            resolve(user[0]);
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
};

const comparePassword = async (password, userObject) => {
  try {
    const isMatch = await bcrypt.compare(password, userObject.Password);
    return isMatch;
  } catch (error) {
    throw error;
  }
};

// Helper function for error notifications
const createNotification = (type, messages, icon) => ({type, messages,icon,});

let checkLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
   const notifications = [createNotification("danger", "Please login to  access all the features.", "#check-circle-fill"),];
    return res.render("login", {notifications,title:'Login',BRAND_NAME:process.env.BRAND_NAME});
  }
  next();
};

let checkLoggedOut = (req,res,next) => {
  //console.log('hi i m here in the check logout User.js')
  //console.log(req.flash("message"))
 //const message= req.flash("message");
  //req.flash("message",message)
  if (req.isAuthenticated()) {
         res.render("home",{title:'Home',BRAND_NAME:process.env.BRAND_NAME});
  }
  next();
};

let changePassword = (req,res) => {
  return new Promise(async (resolve, reject) => {
    try {
        //console.log(req)
      await comparePassword(req.body.Password,req.user);
      if(req.body.newPassword == req.body.confirmNewPassword){
        //console.log(req.body.newPassword);
            let isUpdated= await updateUserPassword(req.body,req.user.Id)
            if(isUpdated){
                resolve('User Password change has been done successfully')
            }
      }
    } catch (error) {
        reject(error);
    }
  });
};

let updateUserPassword=(req,userId)=>{
    //encryp the password
    return new Promise(async(resolve,reject)=>{
     // const connection = await pool.getConnection(); // Assuming you have a MySQL connection pool setup
        try {
            let salt = bcrypt.genSaltSync(10);
            let encryptedPassword={Password: bcrypt.hashSync(req.newPassword, salt)}
            dbConnection.connection.esecute("UPDATE `Users` SET `Password`=? WHERE `ID`= ?",[encryptedPassword.Password,userId],function(err,rows){
                if(rows.affectedRows >0){
                    resolve(true)
                }
            })
        } catch (error) {
            reject(error)
        }
    })
   
}


const getUserList = async () => {
  try {
    // Execute the database query using a promise which are not admin as these are used to provide access to the function
    //admin alreay has access to all of the functions.
    const [users] = await dbConnection.connection.promise().execute(`SELECT Id,FirstName,LastName,Email,PhoneNumber,DATE_FORMAT(DateOfJoining,'%d-%m-%y')as DateOfJoining FROM Users where IsItAdmin !=1`);

    // Always return users, even if it's an empty array
    return users;
  } catch (error) {

    console.log(error)
    // Throw the error for the controller to catch and handle
    throw error
  }
};


const getAllUnAuthorisedFunctionList= async(userId)=>{
  try {
     // let query = `select * from Functions Where Id NOT IN(select FunctionId from FunctionsAuthorisedToUser where UserId=?)`
     let query =`SELECT  f.FunctionName, f.Id as FunctionId , f.FunctionGroup
                        FROM 
                           Functions f
                        LEFT JOIN 
                            FunctionsAuthorisedToUser fa ON f.Id = fa.FunctionId AND fa.UserId = 2
                        WHERE 
                            fa.FunctionId IS NULL
                        ORDER BY 
                             f.FunctionName`
       const [functions]= await dbConnection.connection.promise().execute(query,[userId])
       return functions
  } catch (error) {
    console.log(error)
    throw error
  }
}


const getAlreadyAuthorisedFunctions= async(userId)=>{
  try {
    
    let query = `SELECT FunctionName,FunctionSlug,FunctionId,FunctionsAuthorisedToUser.Id FROM FunctionsAuthorisedToUser JOIN Functions ON Functions.Id=FunctionsAuthorisedToUser.FunctionId Where FunctionsAuthorisedToUser.UserId=?;`

    console.log(mysql.format(query,[userId]));
    const [alreadyAuthorisedFunctions]= await dbConnection.connection.promise().execute(query,[userId]);
     return alreadyAuthorisedFunctions
  } catch (error) {
    console.log(error)
    throw error;
  }
}


const authoriseUserToFunction = async(selectedFunctions,userId)=>{
  try {
    // Prepare the SQL query
    const sql = 'INSERT INTO FunctionsAuthorisedToUser (UserId,FunctionId) VALUES ?';
    
    // Prepare the data array for bulk insert
    const data = selectedFunctions.map(functionId => [userId, functionId]);

    console.log(mysql.format(sql,[data]))

    // Execute the query
    await dbConnection.connection.promise().query(sql, [data]);
    return  'Functions assigned successfully'
} catch (error) {
    console.error('Error inserting user functions:', error);
    throw error
}
}


const removeAuthorisation= async(userId,functionId)=>{
  try {
    let sql="Delete From FunctionsAuthorisedToUser where UserId=? And FunctionId=?"

    console.log(mysql.format(sql,[userId,functionId]))

    console.log('i m here')
    await dbConnection.connection.promise().execute(sql,[userId,functionId])
    return 'Authorisation successfully removed.'
  } catch (error) {
    console.error('Error during removing authorisation:', error.message || error);
    throw error 

  }
}


const checkAuthorisation = async (req, res, next) => {
  try {
    // Check if the user is an admin
    const adminSql = `SELECT IsItAdmin FROM Users WHERE Id = ?`;
    const [isItAdmin] = await dbConnection.connection.promise().execute(adminSql, [req.user.Id]);
    
    if (isItAdmin[0].IsItAdmin===1) {
      // If the user is an admin, proceed to the next middleware
      return next();
    }

    // If not an admin, check if the user has permission to access the specific function
    const authSql = `SELECT *
                      FROM 
                           FunctionsAuthorisedToUser 
                      JOIN 
                          Functions ON Functions.Id = FunctionsAuthorisedToUser.FunctionId
                      WHERE 
                          FunctionsAuthorisedToUser.UserId = ? 
                      AND 
                          Functions.FunctionSlug = ?;
                    `;
    const [result] = await dbConnection.connection.promise().query(authSql, [req.user.Id, req.path]);

    if (result.length > 0) {
      // User is authorized to access this function
      return next();
    }

    // If not authorized, render the error page
    renderUnauthorizedPage(res);
    
  } catch (error) {
    // Log the error and render an error page
    console.error('Authorization error:', error);
    renderUnauthorizedPage(res, error);
  }
};

// Helper function to render the unauthorized page
const renderUnauthorizedPage = (res, error = null) => {
  let notifications = [];
  
  if (error) {
  //  notifications.push({ msg: error.toString() });  // Capture and log the error details if present
     notifications.push(createNotification("danger",error, "bi-exclamation-triangle-fill"))
  }

 //errors.push({ msg: 'Sorry, you are not authorized to access this page.' });
 notifications.push(createNotification("danger",'Sorry, you are not authorized to access this page.', "bi-exclamation-triangle-fill"))
  
  res.render("home", {
    title: 'Home',
    notifications,
    BRAND_NAME: process.env.BRAND_NAME,
    layout: 'loggedInLayout' 
  });
};

const checkAdmin = async (req, res, next) => {
  try {
    // Ensure req.user exists
    if (!req.user || !req.user.Id) {
      return renderUnauthorizedPage(res, "User not authenticated");
    }

    const adminSql = `SELECT IsItAdmin FROM Users WHERE Id = ?`;
    const [rows] = await dbConnection.connection.promise().execute(adminSql, [req.user.Id]);

    // Check if the user exists and has the admin flag set
    if (rows.length > 0 && rows[0].IsItAdmin === 1) {
      return next(); // User is admin, proceed
    } else {
      return renderUnauthorizedPage(res, "Access Denied");
    }
  } catch (error) {
    console.error("Error in checkAdmin middleware:", error);
    return renderUnauthorizedPage(res, "An error occurred while verifying admin status.");
  }
};

const getRoles = async () => {
  try {
    const rolesSql = `SELECT * FROM Roles`;
    const [roles] = await dbConnection.connection.promise().execute(rolesSql);
    return roles
  } catch (error) {
    console.error("Error fetching roles:", error);
    throw error;
  }
};
const assignRole = async (userId, roleId) => {
  try {
    const updateRoleQuery = "UPDATE Users SET roleId = ? WHERE Id = ?";
    const [result] = await dbConnection.connection.promise().execute(updateRoleQuery, [roleId, userId]);
    return result.affectedRows > 0; // true if update was successful
  } catch (error) {
    console.error("Error assigning role:", error);
    throw error; // optional: rethrow for upstream handling
  }
};

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * for marketing persons role Id is 5 and it is stores in roles table
 * @returns 
 */
const getMarketingPersonList= async(req,res)=>{

  try {
    const updateRoleQuery = "select * from Users where roleId= 5";
    const [result] = await dbConnection.connection.promise().execute(updateRoleQuery);
    return result; // true if update was successful
  } catch (error) {
    console.error("Error getting marketing person list:", error);
    throw error; // optional: rethrow for upstream handling
  }
}

const getLeaveTypes= async()=>{

  try {
    const [leaveTypes] = await dbConnection.connection.promise().query("SELECT Id, Name FROM LeaveTypes");
    return leaveTypes
  } catch (error) {
    throw error
  }
}

const applyLeave= async(startDate,endDate,reason,userId,leaveTypeId)=>{

  try {
    await dbConnection.connection.promise().query(
      `INSERT INTO LeaveApplications (UserId, StartDate, EndDate, Reason, LeaveTypeId) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, startDate, endDate, reason,leaveTypeId]
    );
    
  } catch (error) {
    
    throw error
  }
}

const getLeave= async(userId)=>{

  try {
    const [leaves] = await dbConnection.connection.promise().query(
      `SELECT la.*, lt.Name 
       FROM LeaveApplications la
       JOIN LeaveTypes lt ON la.LeaveTypeId = lt.Id
       WHERE la.UserId = ?
       ORDER BY la.CreatedAt DESC`,
      [userId]
    );
    
    return leaves;
  } catch (error) {
    
  }
}

const getUserLeaveRequests= async()=>{

  try {
    console.log('in User')
    const [leaveRequests] = await dbConnection.connection.promise().query(`
                            SELECT 
                                  L.*, 
                                  CONCAT(U.FirstName, ' ', U.LastName) AS UserName
                              FROM LeaveApplications L
                              JOIN Users U ON L.UserId = U.Id
                              WHERE L.Status = 'Pending' OR L.Status = 'SentBack'
                              ORDER BY L.CreatedAt DESC;
                              `);
    return leaveRequests
  
  } catch (error) {
    
    throw error
  }
}

const actionOnLeave= async(status,remarks,leaveId)=>{

  try {

    console.log(mysql.format(`UPDATE LeaveApplications 
      SET Status = ?, AdminRemarks = ? 
      WHERE Id = ?`,
      [status, remarks, leaveId]))
   const[rows]= await dbConnection.connection.promise().query(`UPDATE LeaveApplications 
                  SET Status = ?, AdminRemarks = ? 
                  WHERE Id = ?`,
                  [status, remarks, leaveId]
    );
console.log(rows);
console.log(' i m in rows')
    return rows;
  } catch (error) {
    throw error
  }

}
module.exports = {
   //handleLogin: handleLogin,
  findUserByEmail: findUserByEmail,
  findUserById: findUserById,
  createNewUser: createNewUser,
  checkLoggedIn: checkLoggedIn,
  checkLoggedOut: checkLoggedOut,
  comparePassword:comparePassword,
  changePassword:changePassword,
  getUserList:getUserList,
  getAllUnAuthorisedFunctionList:getAllUnAuthorisedFunctionList,
  getAlreadyAuthorisedFunctions:getAlreadyAuthorisedFunctions,
  authoriseUserToFunction:authoriseUserToFunction,
  removeAuthorisation:removeAuthorisation,
  checkAuthorisation:checkAuthorisation,
  checkAdmin:checkAdmin,
  getRoles:getRoles,
  assignRole:assignRole,
  getMarketingPersonList:getMarketingPersonList,
  applyLeave:applyLeave,
  getLeave:getLeave,
  getLeaveTypes:getLeaveTypes,
  getUserLeaveRequests:getUserLeaveRequests,
  actionOnLeave:actionOnLeave
};
