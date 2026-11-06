/**
 * routes/mrStockIssue.js  (mounted at /mrStockIssue in lab.js)
 */
const express = require('express');
const router = express.Router();
const c = require('../controllers/MrStockIssueController');
const User = require('../models/User');

const guard = [User.checkLoggedIn, User.checkAuthorisation];

router.get('/', guard, c.getMrIssuesListPage);
router.get('/new', guard, c.getNewMrIssuePage);
router.get('/:id', guard, c.getMrIssueDetailPage);

router.post('/', guard, c.postCreateMrIssue);
router.post('/:id/transfer', guard, c.postTransferMrIssue);
router.post('/:id/return', guard, c.postReturnMrIssue);
router.post('/:id/sample', guard, c.postSampleMrIssue);
router.post('/:id/lost', guard, c.postLostMrIssue);
router.post('/:id/replace', guard, c.postReplaceMrIssue);
router.post('/:id/release', guard, c.postReleaseMrIssue);
router.post('/:id/link-invoice', guard, c.postLinkInvoiceMrIssue);
router.post('/:id/reverse', guard, c.postReverseMrIssue);

module.exports = router;
