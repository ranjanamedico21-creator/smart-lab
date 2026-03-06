const Activity = require("../models/Activity");
const Doctor = require("../models/Doctor");
const moment= require('moment')
const Admin= require("../models/Admin");


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


 const updateCarryForwardTable =async(req,res)=>{
    let notifications=[]
    try {
        const today = moment();

        // Use > instead of >= to shift boundary after April 1
        const currentFYStart = today.month() > 3
          ? moment().year(today.year()-1).startOf("year").add(3, "months")   // April 1st this year
          : moment().year(today.year() - 1).startOf("year").add(3, "months"); // April 1st last year
        
        const currentFYEnd = moment(currentFYStart).add(1, "year").subtract(1, "day");
        const nextFYStart = moment(currentFYEnd).add(1, "day");
        
        const dates = {
          currentFYStart: currentFYStart.format("YYYY-MM-DD"),
          currentFYEnd: currentFYEnd.format("YYYY-MM-DD"),
          nextFYStart: nextFYStart.format("YYYY-MM-DD"),
          previousFY: `${currentFYStart.year() - 1}-${currentFYStart.year()}`,
          nextFY: `${currentFYStart.year()}-${currentFYStart.year() + 1}`,
        };
      console.log(dates)
        const message= await Admin.insertCarryForwardBalances(dates);
        notifications.push(createNotification('success',message,'bi-check-circle-fill'))
        res.render('adminPanel', {
            notifications,
            title: 'Admin Panel',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
        
    } catch (error) {
       // notifications.push(createNotification('danger',error,'bi-excalamation-triangle-fill'))
        renderHomeWithError(res,error)
    }

 }

 // Centralized notification creation
const createNotification = (type, messages, icon) => ({type,messages,icon,});

module.exports={
    updateCarryForwardTable:updateCarryForwardTable
}
