
const Schedule = require("../models/Schedule");

let getTodaysScheduleForVisitingDoctors= async(req,res)=>{

    try {
        console.log('i m here')
        /* marketing person id will be users to get the list of doctor tagged with marketing person */
        const users=[]
        /** area attribute comes through search part of schedule. First time it will not exist hence this */
        const area= req.body.area || ''; // Set to an empty string if not provided
        const doctorsListToBeVisted = await Schedule.getTodaysDoctorListToBeVisted(area)
        //console.log(doctorsListToBeVisted)
        res.render('getDoctorsSchedule',{area,users,doctorsListToBeVisted,title:'Doctor List For Marketing',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    } catch (error) {
        
    }
}

const updateVisitingLogs= async(req,res)=>{
    let notifications=[]
    try {
        console.log('in visit')
        console.log(req.body)
        const users=[]
       const message= await Schedule.updateVisitingLogs(req.body.doctorId,req.body.notes,req.user.Id)
        notifications.push(createNotification('success',message,'bi-check-circle-fill'))
        const doctorsListToBeVisted = await Schedule.getTodaysDoctorListToBeVisted()
        res.render('getDoctorsSchedule',{notifications,users,doctorsListToBeVisted,title:'Doctor List For Marketing',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    } catch (error) {
        console.log(error)
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    }
}
 /**
 * 
 * @param {*} type 
 * @param {*} messages 
 * @param {*} icon 
 * @returns 
 */
// Centralized notification creation
const createNotification = (type, messages, icon) => ({type,messages,icon,});

module.exports ={
    getTodaysScheduleForVisitingDoctors:getTodaysScheduleForVisitingDoctors,
    updateVisitingLogs:updateVisitingLogs,
}