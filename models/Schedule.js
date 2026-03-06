const dbConnection = require("../config/DBConnection");
const mysql = require('mysql2'); 
const moment= require('moment');
//const currDateAndTime = require("../helper/helper");
const getremmoveTodaysDoctorListToBeVisted= async(area)=>{
        const currentDay = new Date().toLocaleString("en-US", { weekday: "long" });
        let query = `
                    SELECT 
                        dd.Id, 
                        dd.FirstName, 
                        dd.LastName, 
                        dd.Degree1, 
                        dd.Degree2, 
                        dd.SpecialistIn, 
                        dvs.DayOfWeek,
                        dvs.Area, 
                        GROUP_CONCAT(vl.Notes) AS Notes,
                        COUNT(vl.VisitedOn) AS VisitCount, 
                        GROUP_CONCAT(DATE_FORMAT(vl.VisitedOn, '%Y-%m-%d')) AS VisitedDates
                    FROM DoctorDetails dd
                    JOIN DoctorVisitingSchedule dvs ON dd.Id = dvs.DoctorId
                    LEFT JOIN VisitLog vl ON dd.Id = vl.DoctorId 
                        AND MONTH(vl.VisitedOn) = MONTH(CURDATE()) 
                        AND YEAR(vl.VisitedOn) = YEAR(CURDATE())
                   WHERE dvs.DayOfWeek = ? OR dvs.DayOfWeek = 'AllDay'
                `;

                const params = [currentDay];

                if (area && area.trim() !== '') {
                    console.log(area);
                    query += ' AND LOWER(dvs.Area) LIKE ?'; // Convert database field to lowercase
                    params.push(`%${area.toLowerCase()}%`); // Convert search string to lowercase with wildcards
                }

            /*
            if (marketingPersonId) {
                query += ' AND d.MarketingPersonID = ?';
                params.push(marketingPersonId);
            }
            */

            query += `
                GROUP BY 
                    dd.Id, dd.FirstName, dd.LastName, dd.Degree1, 
                    dd.Degree2, dd.SpecialistIn, dvs.DayOfWeek
                ORDER BY 
                    VisitCount ASC, dd.LastName ASC
            `;

            // Execute your query with the params array
            console.log(query);
            console.log(params);

        console.log(mysql.format(query,params))

        try {
            const [rows] = await dbConnection.connection.promise().execute(query, params);
            const doctors = rows.map(row => ({
                                            Id: row.Id,
                                            FirstName: row.FirstName,
                                            LastName: row.LastName,
                                            SpecialistIn: row.SpecialistIn,
                                            DayOfWeek: row.DayOfWeek,
                                            VisitCount: row.VisitCount,
                                            // Convert VisitedDates string into an array, or an empty array if null/undefined
                                            VisitedDates: row.VisitedDates ? row.VisitedDates.split(',') : [],
                                            Notes: row.Notes ? row.Notes.split(',') : [], // Array of notes (ensure delimiter in query matches)
                                        }));
                  //  console.log(doctors) 
                    console.log('********')                   
            return doctors
            //res.json(rows);
        } catch (error) {
            console.error(error);
            throw error
            //res.status(500).json({ error: 'An error occurred' });
        }
}

const getTodaysDoctorListToBeVisted = async (area) => {
    const currentDay = new Date().toLocaleString("en-US", { weekday: "long" });

    let query = `
        SELECT 
            dd.Id, 
            dd.FirstName, 
            dd.LastName, 
            dd.Degree1, 
            dd.Degree2, 
            dd.SpecialistIn, 
            dvs.DayOfWeek,
            dvs.Area, 
            GROUP_CONCAT(vl.Notes) AS Notes,
            COUNT(vl.VisitedOn) AS VisitCount, 
            GROUP_CONCAT(DATE_FORMAT(vl.VisitedOn, '%d-%m-%Y')) AS VisitedDates  -- ✅ Fix: Change to 'DD-MM-YYYY'
        FROM DoctorDetails dd
        JOIN DoctorVisitingSchedule dvs ON dd.Id = dvs.DoctorId
        LEFT JOIN VisitLog vl ON dd.Id = vl.DoctorId 
            AND MONTH(vl.VisitedOn) = MONTH(CURDATE()) 
            AND YEAR(vl.VisitedOn) = YEAR(CURDATE())
        WHERE dvs.DayOfWeek = ? OR dvs.DayOfWeek = 'AllDay'
    `;

    const params = [currentDay];

    if (area && area.trim() !== '') {
        console.log(area);
        query += ' AND LOWER(dvs.Area) LIKE ?';  // ✅ Ensure case-insensitive search
        params.push(`%${area.toLowerCase()}%`);
    }

    query += `
        GROUP BY 
            dd.Id, dd.FirstName, dd.LastName, dd.Degree1, 
            dd.Degree2, dd.SpecialistIn, dvs.DayOfWeek
        ORDER BY 
            VisitCount ASC, dd.LastName ASC, dd.FirstName ASC  -- ✅ Ensure Fixed Display Order
    `;

    console.log(mysql.format(query, params));

    try {
        const [rows] = await dbConnection.connection.promise().execute(query, params);
        const doctors = rows.map(row => ({
            Id: row.Id,
            FirstName: row.FirstName,
            LastName: row.LastName,
            SpecialistIn: row.SpecialistIn,
            DayOfWeek: row.DayOfWeek,
            VisitCount: row.VisitCount,
            VisitedDates: row.VisitedDates ? row.VisitedDates.split(',') : [],  // ✅ Dates in 'DD-MM-YYYY' format
            Notes: row.Notes ? row.Notes.split(',') : [],  // ✅ Notes array
        }));

        console.log("********");
        return doctors;
    } catch (error) {
        console.error(error);
        throw error;
    }
};


const updateVisitingLogs= async(doctorId,notes,userId)=>{
  
    const query = `INSERT INTO VisitLog (DoctorId, MarketingPersonId, VisitedOn, Notes)
        VALUES (?, ?,?, ?)`;
    const today = moment().format('YYYY-MM-DD HH:mm:ss')//new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const params = [doctorId,userId,today,notes];
    try {
        console.log(mysql.format(query,params))
        await dbConnection.connection.promise().execute(query,params);
        return "Logs succesfully updated."
    } catch (error) {
        console.error(error);
        throw error;
    }
    
}
module.exports={
    getTodaysDoctorListToBeVisted:getTodaysDoctorListToBeVisted,
    updateVisitingLogs:updateVisitingLogs
}