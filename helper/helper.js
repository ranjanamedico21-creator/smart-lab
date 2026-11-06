const moment = require("moment");
let getCurrentDateAndTime = ()=>{
       
        // current date in YYYY-MM-DD format
        const currDate = moment().format('YYYY-MM-DD');
        console.log(currDate);

        // current time in HH:MM format
        let currTime=  moment().format('HH:mm:ss'); // 24-hour format
        //creating a array
        let dateObjet=[]
        //push current date and time
        dateObjet.push(currDate);
        dateObjet.push(currTime);
        return dateObjet;
}
/**
 * Using it for updating dues table
 * old date dues can be cleared , not todays date dues. hence check
 * @param {fromDate } oldDate YYYY-MM-DD
 * @returns boolean
 */
let compareDate =(fromDate)=>{
    return moment(fromDate).isBefore(moment(), 'day');
}

/**
 * Using it for search Patient
 * from date should be less that To date for search in database
 * e.g 1-06-2023 to 1-07-2023
 * @param { fromDate} oldDate YYYY-MM-DD
 * @param {toDate } toDate YYYY-MM-DD
 * @returns boolean
 */
let compareDateForSearch =(fromDate,toDate)=>{
    console.log(fromDate);
    console.log(toDate);
    console.log('***************************')
    return moment(fromDate, "YYYY-MM-DD").isSameOrBefore(moment(toDate, "YYYY-MM-DD"), 'day')
}
/**
 * 
 * @param {*} date dd-mm-yyyy
 * @returns date yyyy-mm-dd
 */
let parseDate=(date)=>{
    return moment(date, "DD-MM-YYYY").format("YYYY-MM-DD"); 
}
/**
 * 
 * @param {*} registeredDate yyyy-mm-dd
 * @returns boolean
 */
let isItTodayDate = (registeredDate) => {
    return moment(registeredDate).isSame(moment(), 'day');
}



/**
 * Get a valid date range.
 * - If both provided → use them
 * - If only one provided → use the other as today
 * - If none provided → both = today
 * @param {string|null} fromDate - expected format DD-MM-YYYY
 * @param {string|null} toDate   - expected format DD-MM-YYYY
 * @returns {{ from: string, to: string }} formatted as "YYYY-MM-DD HH:mm:ss"
 */
const getDateRange = (fromDate, toDate) => {
  let fromMoment, toMoment;

  if (fromDate) {
    fromMoment = moment(fromDate, "DD-MM-YYYY", true);
    if (!fromMoment.isValid()) {
      throw new Error("Invalid From Date format. Expected DD-MM-YYYY");
    }
  } else {
    fromMoment = moment(); // default = today
  }

  if (toDate) {
    toMoment = moment(toDate, "DD-MM-YYYY", true);
    if (!toMoment.isValid()) {
      throw new Error("Invalid To Date format. Expected DD-MM-YYYY");
    }
  } else {
    toMoment = moment(); // default = today
  }

  // Validation
  if (fromMoment.isAfter(toMoment)) {
    throw new Error("From Date cannot be after To Date");
  }

  const from = fromMoment.startOf("day").format("YYYY-MM-DD HH:mm:ss");
  const to   = toMoment.endOf("day").format("YYYY-MM-DD HH:mm:ss");

  return { from, to };
};




module.exports = {
    getCurrentDateAndTime:getCurrentDateAndTime,
    compareDate:compareDate,
    parseDate:parseDate,
    compareDateForSearch:compareDateForSearch,
    isItTodayDate:isItTodayDate,
    getDateRange:getDateRange
}