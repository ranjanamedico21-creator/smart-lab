const Pathology = require("../models/Pathology");
const SpecimenService = require("../services/SpecimenService");
const moment = require("moment");

const getClientInfo = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress,
  userAgent: req.headers['user-agent']
});

exports.renderSpecimenList = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const dateFrom = req.query.date_from || today;
    const dateTo = req.query.date_to || today;
    const status = req.query.status || 'all';
    const search = req.query.search || '';
    
    let specimens = await Pathology.findSpecimensByFilter(dateFrom, dateTo, status, search);
    
    const stats = await Pathology.findSpecimenStats(dateFrom, dateTo);
    
    res.render("Pathology/specimen-list", {
      specimens,
      stats,
      dateFrom,
      dateTo,
      filterStatus: status,
      search,
      moment,
      user: req.user || null,
      title: "Specimen Dashboard",
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

exports.renderSpecimenAction = async (req, res) => {
  try {
    const ptrId = req.query.ptr;
    if (!ptrId) return res.redirect('/pathology/specimens?toast=' + encodeURIComponent('No patient test selected') + '&type=error');
    
    const detail = await Pathology.findSpecimenDetail(ptrId);
    if (!detail) return res.redirect('/pathology/specimens?toast=' + encodeURIComponent('Patient test not found') + '&type=error');
    
    const auditLog = await Pathology.findSpecimenAuditLog(detail.SpecimenId);
    
    res.render("Pathology/specimen-action", {
      detail,
      auditLog,
      moment,
      user: req.user || null,
      title: "Accept / Reject Specimen",
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

/*exports.acceptSpecimen = async (req, res) => {
  try {
    const { specimenId, patientTestRefferenceId, qualityCheckNotes } = req.body;
    const userId = req.user?.Id;
    const role = req.user?.role || 'technician';
    
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    
    const targetSpecimenId = specimenId || (await Pathology.findSpecimenByPTR(patientTestRefferenceId))?.Id;
    if (!targetSpecimenId) return res.status(404).json({ success: false, message: "Specimen not found" });
    
    const result = await SpecimenService.accept({
      specimenId: targetSpecimenId,
      userId,
      role,
      qualityCheckNotes,
      ...getClientInfo(req)
    });
    
    res.json({ success: true, message: "Specimen accepted successfully", data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};*/

exports.acceptSpecimen = async (req, res) => {
  try {
    const specimenId = req.body.specimenId;
    const userId = req.user ? req.user.Id : null;
    
    if (!userId) {
      return res.redirect('/pathology/specimens?toast=' + encodeURIComponent('Authentication required') + '&type=error');
    }
    if (!specimenId) {
      return res.redirect('/pathology/specimens?toast=' + encodeURIComponent('Specimen ID is missing') + '&type=error');
    }
    
    // Use SpecimenService for proper audit logging, transition validation, and report auto-creation
    await SpecimenService.accept({
      specimenId: parseInt(specimenId),
      userId: userId,
      role: req.user.Role || 'technician',
      qualityCheckNotes: req.body.qualityCheckNotes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    // Find the report that was auto-created (or already existed)
    const specimen = await Pathology.findSpecimenById(specimenId);
    const report = await Pathology.findReportByPatientTestReferenceId(specimen.PatientTestRefferenceId);
    
    if (report) {
      // Redirect to result entry with the new report
      return res.redirect('/pathology/view/entry/' + report.Id);
    }
    
    res.redirect('/pathology/specimens?toast=' + encodeURIComponent('Specimen accepted. Report will be created shortly.') + '&type=success');
  } catch (error) {
    console.error('Accept specimen error:', error);
    res.redirect('/pathology/specimens?toast=' + encodeURIComponent(error.message) + '&type=error');
  }
};

exports.rejectSpecimen = async (req, res) => {
  try {
    const { specimenId, reason, reasonCategory } = req.body;
    const userId = req.user?.Id;
    const role = req.user?.role || 'technician';
    
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!specimenId) return res.status(400).json({ success: false, message: "Specimen ID required" });
    if (!reason) return res.status(400).json({ success: false, message: "Rejection reason required" });
    
    const result = await SpecimenService.transitionStatus({
      specimenId,
      newStatus: 'rejected',
      performedBy: userId,
      role,
      remarks: reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      extraData: { rejectionReason: reason, rejectionReasonCategory: reasonCategory }
    });
    
    res.json({ success: true, message: "Specimen rejected", data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.renderSpecimenMasters = async (req, res) => {
  try {
    const specimenTypes = await Pathology.findAllSpecimenTypes();
    const containerTypes = await Pathology.findAllContainerTypes();
    const requirements = await Pathology.findAllTestSpecimenRequirements();
    
    res.render("Pathology/specimen-masters", {
      specimenTypes,
      containerTypes,
      requirements,
      moment,
      user: req.user || null,
      title: "Specimen Master Configuration",
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};