'use strict';

/**
 * DoctorBusinessController.js — Doctor Business Tracker (marketing).
 *
 *   GET /report/doctorBusiness                       → the page (filters in the URL, so it can be bookmarked/shared)
 *   GET /report/api/doctorBusiness/:doctorId         → one doctor: month × category + latest patients (JSON)
 */

const DoctorBusiness = require('../models/DoctorBusiness');
require('dotenv').config();

const page = (res, data, status = 200) => res.status(status).render('Report/doctorBusinessReport', {
    BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', title: 'Doctor Business Tracker', ...data,
});

const getDoctorBusinessPage = async (req, res) => {
    try {
        const report = await DoctorBusiness.getReport(req.query);
        return page(res, { report, error: null });
    } catch (err) {
        console.error('[DoctorBusiness] page:', err);
        const why = err && err.sqlMessage ? ` (Database said: ${err.sqlMessage})` : '';
        return page(res, { report: null, error: `Could not build the report.${why}` }, 500);
    }
};

const getDoctorBusinessDetail = async (req, res) => {
    try {
        const data = await DoctorBusiness.getDoctorDetail(req.params.doctorId, req.query);
        return res.json({ success: true, ...data });
    } catch (err) {
        if (!err.isUserError) console.error('[DoctorBusiness] detail:', err);
        return res.status(err.isUserError ? 400 : 500).json({ success: false, message: err.isUserError ? err.message : 'Could not load this doctor.' });
    }
};

module.exports = { getDoctorBusinessPage, getDoctorBusinessDetail };
