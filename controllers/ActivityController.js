const Activity = require("../models/Activity");
const Doctor = require("../models/Doctor");

let getUserActivity = async(req,res)=>{
    try {
        let doctorDetails= await Doctor.getDoctorList();
        let patientDetailsHistory = await Activity.getPatientEditHistory()
        res.render("userActivity", {patientDetailsHistory,doctorDetails,title: 'User Activity',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});

    } catch (error) {
        
    }
    
}





module.exports={
    getUserActivity:getUserActivity
}



/*app.get('/daily-report', (req, res) => {
    const reportDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
    
    const revenueQuery = `
      SELECT 
        SUM(CASE WHEN payment_method = 'cash' THEN amount_paid ELSE 0 END) AS cash_revenue,
        SUM(CASE WHEN payment_method = 'online' THEN amount_paid ELSE 0 END) AS online_revenue,
        SUM(CASE WHEN payment_method = 'due' THEN total_amount - amount_paid ELSE 0 END) AS dues,
        SUM(amount_paid) AS total_revenue
      FROM patient_tests
      WHERE DATE(created_at) = ?`;
    
    db.query(revenueQuery, [reportDate], (err, result) => {
      if (err) throw err;
      
      const { cash_revenue, online_revenue, dues, total_revenue } = result[0];
  
      // Store in daily_report table
      const reportQuery = `INSERT INTO daily_report (total_revenue, cash_revenue, online_revenue, dues, report_date) VALUES (?, ?, ?, ?, ?)`;
      db.query(reportQuery, [total_revenue, cash_revenue, online_revenue, dues, reportDate], (err) => {
        if (err) throw err;
        res.send({ message: 'Daily report generated!', report: result[0] });
      });
    });
  });
  */
  