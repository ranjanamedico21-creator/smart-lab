/**
 * controllers/MrStockIssueController.js
 */
const crypto = require('crypto');
const MrStockIssue = require('../models/MrStockIssue');
const Billing = require('../models/Billing');

const BASE = '/mrStockIssue';
const VIEWS = 'MrStockIssues'; // same capital letters as the folder, needed on Linux hosting
const FLASH_KEY = 'mrStockMessage';

// views/partials/messages.ejs prints messages without escaping
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const flash = (req, type, message) => req.flash(FLASH_KEY, {
  type, messages: esc(message), alertDismissible: true,
  icon: type === 'danger' ? 'bi-exclamation-triangle-fill' : type === 'warning' ? 'bi-info-circle-fill' : 'bi-check-circle-fill',
});

const newToken = () => crypto.randomBytes(16).toString('hex');
const actor = (req) => req.user.Id;
const page = (extra) => ({ BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', ...extra });

// Only expected problems show their own text. Database errors are logged, not shown.
function reportError(req, error, fallback = 'Could not save. Nothing was changed. Please try again.') {
  if (error.alreadySaved) return flash(req, 'warning', error.message);
  if (error.isUserError) return flash(req, 'danger', error.message);
  console.error('[MrStockIssue]', error);
  flash(req, 'danger', fallback);
}

function renderError(req, res, error) {
  console.error('[MrStockIssue]', error);
  flash(req, 'danger', 'This page could not be loaded. Please try again.');
  return res.redirect(req.originalUrl.split('?')[0] === BASE ? '/' : BASE);
}

/* ---------- pages ---------- */
const getMrIssuesListPage = async (req, res) => {
  try {
    const tab = req.query.tab === 'holders' ? 'holders' : 'issues';
    const allowed = ['ALL', 'OPEN', ...MrStockIssue.STATUSES];
    const status = allowed.includes(req.query.status) ? req.query.status : 'OPEN';
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : '';
    const holderId = parseInt(req.query.holderId, 10) || '';
    const [list, summary, holdings, brokenLinks, mrOptions] = await Promise.all([
      MrStockIssue.listIssues({ status, search, holderId, page: req.query.page }),
      MrStockIssue.getSummary(),
      MrStockIssue.getHoldings(),
      MrStockIssue.getBrokenInvoiceLinks(),
      MrStockIssue.getMarketingUsers(),
    ]);
    res.render(`${VIEWS}/mrStockIssueDefault`, page({
      title: 'MR stock', tab, status, search, holderId, list, summary, holdings, brokenLinks, mrOptions,
      overdueDays: MrStockIssue.OVERDUE_DAYS, formToken: newToken(), notifications: req.flash(FLASH_KEY),
    }));
  } catch (error) { renderError(req, res, error); }
};

const getNewMrIssuePage = async (req, res) => {
  try {
    const [customers, stocks, suppliers, mrOptions, today] = await Promise.all([
      Billing.getCustomerList(), Billing.getStockList(), Billing.getSuppliersList(), MrStockIssue.getMarketingUsers(), MrStockIssue.today(),
    ]);
    res.render(`${VIEWS}/mrStockIssueNew`, page({
      title: 'Issue products to MR', customers, stocks, suppliers, mrOptions, today,
      formToken: newToken(), notifications: req.flash(FLASH_KEY),
    }));
  } catch (error) { renderError(req, res, error); }
};

const getMrIssueDetailPage = async (req, res) => {
  try {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id)) {
      flash(req, 'danger', 'Issue not found.');
      return res.redirect(BASE);
    }
    const issue = await MrStockIssue.getIssueById(req.params.id);
    if (!issue) {
      flash(req, 'danger', `Issue #${req.params.id} not found.`);
      return res.redirect(BASE);
    }
    const [ledger, related, mrOptions, customers, invoiceLines, lots, today] = await Promise.all([
      MrStockIssue.getLedgerForIssue(issue.Id),
      MrStockIssue.getRelatedIssues(issue),
      MrStockIssue.getMarketingUsers(),
      Billing.getCustomerList(),
      MrStockIssue.getLinkableInvoiceLines(issue),
      MrStockIssue.getReplacementLots(issue),
      MrStockIssue.today(),
    ]);
    res.render(`${VIEWS}/mrStockIssueView`, page({
      title: `MR issue #${issue.Id}`, issue, ledger, related, mrOptions, customers, invoiceLines, lots, today,
      formToken: newToken(), notifications: req.flash(FLASH_KEY),
    }));
  } catch (error) { renderError(req, res, error); }
};

/* ---------- actions ---------- */
const postCreateMrIssue = async (req, res) => {
  try {
    let lines;
    try { lines = JSON.parse(req.body.linesJson || '[]'); } catch (e) {
      throw new MrStockIssue.UserError('Could not read the product lines, please try again');
    }
    const { issuedToId, issuedOn, purpose, remarks, formToken } = req.body;
    const ids = await MrStockIssue.createIssues({ issuedToId, issuedOn, purpose, remarks, lines, formToken }, actor(req));
    flash(req, 'success', `${ids.length} product line${ids.length > 1 ? 's' : ''} issued to the MR.`);
    res.redirect(BASE);
  } catch (error) {
    reportError(req, error);
    res.redirect(error.alreadySaved ? BASE : `${BASE}/new`);
  }
};

// Every settlement posts back to the issue page with a message
const action = (run, message) => async (req, res) => {
  try {
    const result = await run(req);
    flash(req, 'success', typeof message === 'function' ? message(result, req) : message);
  } catch (error) {
    reportError(req, error);
  }
  res.redirect(`${BASE}/${encodeURIComponent(req.params.id)}`);
};

const postReturnMrIssue = action((req) => MrStockIssue.returnIssue(req.params.id, req.body, actor(req)),
  (r) => `${r.qty} returned to store.`);
const postSampleMrIssue = action((req) => MrStockIssue.useAsSample(req.params.id, req.body, actor(req)),
  (r) => `${r.qty} recorded as sample.`);
const postLostMrIssue = action((req) => MrStockIssue.markLost(req.params.id, req.body, actor(req)),
  (r) => `${r.qty} recorded as lost or damaged.`);
const postReplaceMrIssue = action((req) => MrStockIssue.replaceWithBatch(req.params.id, req.body, actor(req)),
  (r) => `${r.qty} settled with the replacement batch. That batch's stock went up by ${r.qty}.`);
const postLinkInvoiceMrIssue = action((req) => MrStockIssue.linkInvoice(req.params.id, req.body, actor(req)),
  (r) => `Settled against invoice ${r.invoiceId}. Stock is corrected.`);
const postReverseMrIssue = action((req) => MrStockIssue.reverseEntry(req.params.id, req.body.ledgerId, req.body, actor(req)),
  'Entry undone. Stock and quantities are back as they were.');

const postTransferMrIssue = async (req, res) => {
  try {
    const r = await MrStockIssue.transferIssue(req.params.id, req.body, actor(req));
    flash(req, 'success', r.split ? `Part transfer saved as new issue #${r.issueId}.` : 'Transferred to the new MR.');
  } catch (error) {
    reportError(req, error);
  }
  res.redirect(`${BASE}/${encodeURIComponent(req.params.id)}`);
};

// Stock goes on the books, then the normal billing page sells it
const postReleaseMrIssue = async (req, res) => {
  try {
    const r = await MrStockIssue.releaseForBilling(req.params.id, req.body, actor(req));
    req.flash('message', {
      type: 'warning', icon: 'bi-info-circle-fill',
      messages: `${r.qty} unit${r.qty === 1 ? '' : 's'} from MR issue #${r.issue.Id} are ready to bill. After saving the invoice, ` +
        `open <a href="${BASE}/${r.issue.Id}">MR issue #${r.issue.Id}</a> and link the invoice.`,
    });
    res.redirect(MrStockIssue.BILLING_PAGE_URL);
  } catch (error) {
    reportError(req, error);
    res.redirect(`${BASE}/${encodeURIComponent(req.params.id)}`);
  }
};

module.exports = {
  getMrIssuesListPage, getNewMrIssuePage, getMrIssueDetailPage,
  postCreateMrIssue, postTransferMrIssue, postReturnMrIssue, postSampleMrIssue, postLostMrIssue,
  postReplaceMrIssue, postReleaseMrIssue, postLinkInvoiceMrIssue, postReverseMrIssue,
};
