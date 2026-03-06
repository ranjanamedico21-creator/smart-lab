const dbConnection = require("../config/DBConnection");
const moment = require('moment');
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support



  const createNewClinic = async (data, req) => {
  try {
      // Check if clinic already exists based on Email or PhoneNumber
      const isClinicExist = await checkClinicExist(data.Email, data.PhoneNumber);
      if (isClinicExist) {
          throw new Error(`This email "${data.Email}" or Phone Number "${data.PhoneNumber}" already exists. Please choose another.`);
      }

      // Prepare clinic details for insertion
      const clinicDetail = {
          Name: data.ClinicName,
          Email: data.Email,
          PhoneNumber: data.PhoneNumber,
          SecondaryNumber: data.SecondaryNumber,
          Address: data.Address,
          AdditionalAddress: data.AdditionalAddress,
          KeyArea: data.KeyArea,
          Pincode: data.Pincode,
          City: data.City,
          State: data.State,
          LandMark: data.LandMark,
          CreatedOn: data.CreatedOn,
          CreatedBy: data.CreatedBy,
          AssignedTo: req.body.AssignedId
      };

      // Insert the new clinic into the database
      const [result] = await dbConnection.connection.promise().query("INSERT INTO Clinics SET ?", [clinicDetail]);
      
      // Fetch the updated clinic list
      const clinicDetails = await getClinicList();

      // Add the inserted clinic ID to the response
      clinicDetails.insertedId = result.insertId;

      return clinicDetails;
  } catch (error) {
      console.error("Error creating new clinic:", error.message);
      throw error; // Re-throw error for handling in the calling function
  }
};
  

/**
 * 
 * @param {*} data 
 * @returns 
 */
let checkClinicExist = async(Email,PhoneNumber) => {
 
    try {
      const query = "SELECT * FROM Clinics WHERE Email = ? OR PhoneNumber = ?";
      const [result]= await dbConnection.connection.promise().execute(query,[Email,PhoneNumber])
        return result.length > 0
    } catch (err) {
      throw errror
    }

};


const getClinicList = async () => {
  try {
    const [clinicList] = await dbConnection.connection.promise().execute("SELECT * FROM Clinics ORDER BY Id DESC" );
    return clinicList || []; // Ensure it always returns an array
  } catch (error) {
    throw error; // Let the caller handle the error
  }
};

let findClinicById = async(clinicId) => {
    try {
        const [clinic]= await dbConnection.connection.promise().query("SELECT * FROM `Clinics` WHERE `Id` = ?  ",clinicId)
        return clinic[0];
    } catch (error) {
        throw error;
    }
};



// ✅ Update an existing clinic and store previous details in history
const updateExistingClinic = async (clinicDetails, req) => {
    try {
        // Check if the clinic exists
        const existingClinic = await findClinicById(clinicDetails.clinicId);
        if (!existingClinic) {
            throw new Error(`Clinic with ID ${clinicDetails.clinicId} not found.`);
        }

        // Store previous data in ClinicHistory before updating
        await insertIntoClinicHistoryTable(existingClinic, req);

        // Update the clinic in the database
        const [updateResult] = await dbConnection.connection.promise().query(
            "UPDATE `Clinics` SET `Name`=?, `Email`=?, `PhoneNumber`=?, `SecondaryNumber`=?, `Address`=?, `AdditionalAddress`=?, `KeyArea`=?, `Pincode`=?, `City`=?, `State`=?, `LandMark`=? , `AssignedTo`=? WHERE `ID`=?",
            [
                clinicDetails.Name,
                clinicDetails.Email,
                clinicDetails.PhoneNumber,
                clinicDetails.SecondaryNumber,
                clinicDetails.Address,
                clinicDetails.AdditionalAddress,
                clinicDetails.KeyArea,
                clinicDetails.Pincode,
                clinicDetails.City,
                clinicDetails.State,
                clinicDetails.LandMark,
                clinicDetails.AssignedTo,
                clinicDetails.clinicId
                
            ]
        );

        if (updateResult.affectedRows === 0) {
            throw new Error(`Clinic update failed for ID ${clinicDetails.id}.`);
        }

        // Fetch and return the updated clinic list
        return await getClinicList();
    } catch (error) {
        console.error("Error updating clinic:", error.message);
        throw error;
    }
};

// ✅ Insert old clinic details into the ClinicHistory table before updating
const insertIntoClinicHistoryTable = async (oldClinicDetail, req) => {
    try {
        const date = moment().format('YYYY-MM-DD');

        const [insertResult] = await dbConnection.connection.promise().execute(
            "INSERT INTO `ClinicHistory` (`Id`, `Name`, `Email`, `PhoneNumber`, `SecondaryNumber`, `Address`, `AdditionalAddress`, `KeyArea`, `Pincode`, `City`, `State`, `LandMark`, `UpdatedOn`, `UpdatedBy`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                oldClinicDetail.Id,
                oldClinicDetail.Name,
                oldClinicDetail.Email,
                oldClinicDetail.PhoneNumber,
                oldClinicDetail.SecondaryNumber,
                oldClinicDetail.Address,
                oldClinicDetail.AdditionalAddress,
                oldClinicDetail.KeyArea,
                oldClinicDetail.Pincode,
                oldClinicDetail.City,
                oldClinicDetail.State,
                oldClinicDetail.LandMark,
                date,
                req.user.Id
            ]
        );

        return insertResult.affectedRows > 0;
    } catch (error) {
        console.error("Error inserting into ClinicHistory:", error.message);
        throw error;
    }
};



/*let attachDoctorToClinic = async (req) => {

    try {
      const date = moment().format('YYYY-MM-DD');
      const clinicId = parseInt(req.query.clinicId);
      const userId = req.user.Id;
      let doctorIds = JSON.parse(JSON.stringify(req.body)).doctor;

      //console.log(req.body)
      if(!Array.isArray(doctorIds)){doctorIds = [doctorIds];}

      const values = doctorIds.map((doctorId) => [clinicId,doctorId,date,userId]);resolve("Doctor Attached Successfully");
      let sql = "INSERT INTO ClinicAndDoctorAssociation (ClinicId,DoctorId,AssociatedOn,AssociatedBy) VALUES ?"
     const [result]= await  dbConnection.connection.promise().query(sql,[values]);
        return "Doctor is successfully attached to clinic."
    } catch (error) {
     // dbConnection.connection.rollback();
      throw error
    }
};*/

const attachDoctorToClinic = async (req) => {
  try {
    // Extract input values
    const date = moment().format("YYYY-MM-DD");
    const clinicId = parseInt(req.query.clinicId, 10) ?? null;
    const userId = req.user?.Id;

    // Validate input
    if (!clinicId || !userId) {
      throw new Error("Invalid clinic ID or user ID.");
    }

    let doctorIds = req.body?.doctor;
    
    // Ensure doctorIds is an array
    if (!Array.isArray(doctorIds)) {
      doctorIds = [doctorIds];
    }

    // Validate doctor IDs
    doctorIds = doctorIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    if (doctorIds.length === 0) {
      throw new Error("Invalid doctor IDs provided.");
    }

    // Prepare values for bulk insert
    const values = doctorIds.map((doctorId) => [clinicId, doctorId, date, userId]);

    console.log(values)

    // SQL query for bulk insert
    const sql = `INSERT INTO ClinicAndDoctorAssociation (ClinicId, DoctorId, AssociatedOn, AssociatedBy) VALUES ?`;

    console.log(mysql.format(sql,[values]))

    // Execute query
    const [result] = await dbConnection.connection.promise().query(sql, [values]);

    console.log(result)

    // Return success message
    return { message: "Doctor(s) successfully attached to the clinic.", insertedRows: result.affectedRows };

  } catch (error) {
    throw new Error(`Error attaching doctor to clinic: ${error.message}`);
  }
};


const detachDoctorFromClinic = async (req) => {
  const connection = await dbConnection.pool.getConnection();
  
  try {
    // Extract and validate input parameters
    const doctorId = parseInt(req.params.doctorId, 10) ?? null;
    const clinicId = parseInt(req.params.clinicId, 10) ?? null;
    if (!doctorId || !clinicId) {
      throw new Error("Invalid doctor or clinic ID.");
    }

    const date = moment().format("YYYY-MM-DD");

    // Begin transaction
    await connection.beginTransaction();

    // Remove doctor from clinic association
    await connection.query(
      "DELETE FROM ClinicAndDoctorAssociation WHERE ClinicId = ? AND DoctorId = ?",
      [clinicId, doctorId]
    );

    // Insert record into disassociation history
    await connection.query(
      "INSERT INTO ClinicAndDoctorHistoryDissasociation (ClinicId, DoctorId, DisassociatedOn, DisassociatedBy) VALUES (?, ?, ?, ?)",
      [clinicId, doctorId, date, req.user.Id]
    );

    // Commit transaction
    await connection.commit();

    return { message: "Doctor has been detached from the clinic." };

  } catch (error) {
    // Rollback in case of error
    await connection.rollback();
    throw new Error(`Error detaching doctor: ${error.message}`);
    
  } finally {
    // Release connection
    connection.release();
  }
};

//export all the function
module.exports = {
  checkClinicExist: checkClinicExist,
  createNewClinic: createNewClinic,
  getClinicList: getClinicList,
  findClinicById: findClinicById,
  updateExistingClinic: updateExistingClinic,
  attachDoctorToClinic: attachDoctorToClinic,
  detachDoctorFromClinic: detachDoctorFromClinic,
 // getClinicDetails:getClinicDetails
};
