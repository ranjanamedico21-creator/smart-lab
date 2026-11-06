/**
 * models/MrStockIssue.js
 *
 * THE RULE: every unit issued to an MR is always in exactly one place.
 *
 *   IssuedQty = RemainingQty (with the MR)
 *             + ReturnedQty        same batch back in store         Stock +qty
 *             + ReplacedQty        other batch came back instead    other batch Stock +qty
 *             + PendingBillQty     released, invoice not linked     Stock +qty
 *             + BilledQty          linked to an invoice line        see linkInvoice
 *             + SampleQty          used as a free sample            no stock change
 *             + LostQty            lost or damaged                  no stock change
 *             + TransferredOutQty  moved to another MR's issue      no stock change
 *
 * Stock.Quantity is what the store has on its books. MR units left it when issued,
 * so sample and lost entries do not change it again.
 */
const db = require('../config/DBConnection');

const BILLING_PAGE_URL = '/billing/addSale';
const MARKETING_ROLE_ID = 5; // same value as User.getMarketingPersonList()
const OVERDUE_DAYS = 30;
const PAGE_SIZE = 50;

const STATUSES = ['WITH_MR', 'PARTIAL', 'AWAITING_INVOICE', 'SETTLED'];
const BUCKET_COLUMNS = ['ReturnedQty', 'ReplacedQty', 'PendingBillQty', 'BilledQty', 'SampleQty', 'LostQty', 'TransferredOutQty'];
const REVERSIBLE = ['RETURN', 'REPLACE', 'RELEASE', 'BILL', 'SAMPLE', 'LOST'];

/* ---------- validation ---------- */
class UserError extends Error {
  constructor(message) { super(message); this.isUserError = true; }
}
class AlreadySaved extends UserError {
  constructor() { super('This was already saved. Your second click was ignored.'); this.alreadySaved = true; }
}

// A repeated form field arrives as an array, and String(['5']) would look like a valid "5"
const scalar = (v) => (v !== null && typeof v === 'object' ? '' : String(v == null ? '' : v).trim());

function parseId(value, label = 'Record') {
  const raw = scalar(value);
  if (!/^[1-9]\d{0,9}$/.test(raw)) throw new UserError(`${label}: invalid selection`);
  return Number(raw);
}
function parseOptionalId(value, label) {
  return value === undefined || value === null || value === '' ? null : parseId(value, label);
}
// Accepts only digits. Number("1e2"), Number("0x10") and Number(" 5 ") must not count as quantities.
function parseQty(value, { max, label = 'Quantity' } = {}) {
  const raw = scalar(value);
  if (raw === '') throw new UserError(`${label} is required`);
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new UserError(`${label} must be a number`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new UserError(`${label} must be a whole number`);
  if (n <= 0) throw new UserError(`${label} must be at least 1`);
  if (n > 1000000) throw new UserError(`${label} is too large`);
  if (max !== undefined && n > max) throw new UserError(`${label} (${n}) is more than the ${max} available`);
  return n;
}
function parseDate(value, label = 'Date') {
  const raw = scalar(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw new UserError(`${label} is required (YYYY-MM-DD)`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new UserError(`${label} is not a real date`);
  }
  return raw;
}
const cleanText = (v, max = 255) => {
  const s = scalar(v).slice(0, max);
  return s || null;
};
const cleanToken = (v) => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v) ? v : null);
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const fullName = (a) => `TRIM(CONCAT(IFNULL(${a}.FirstName, ''), ' ', IFNULL(${a}.LastName, '')))`;

/* ---------- transaction helpers ---------- */
async function inTransaction(work) {
  for (let attempt = 1; ; attempt++) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY' && /uq_mr_ledger_token/.test(err.message)) throw new AlreadySaved();
      if ((err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') && attempt < 3) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

async function lockIssue(conn, issueId) {
  const id = parseId(issueId, 'Issue');
  const [[issue]] = await conn.query(
    `SELECT i.*, DATE_FORMAT(i.IssuedOn, '%Y-%m-%d') AS IssuedOnText
       FROM MrStockIssues i WHERE i.Id = ? FOR UPDATE`, [id]);
  if (!issue) throw new UserError('Issue not found');
  return issue;
}

async function checkActionDate(conn, value, issue, label = 'Date') {
  const date = parseDate(value, label);
  if (date > await today(conn)) throw new UserError(`${label} cannot be in the future`);
  if (issue && date < issue.IssuedOnText) throw new UserError(`${label} cannot be before the issue date (${issue.IssuedOnText})`);
  return date;
}

async function requireActiveUser(conn, userId, label) {
  const id = parseId(userId, label);
  const [[user]] = await conn.query(
    `SELECT Id, ${fullName('u')} AS Name FROM Users u WHERE u.Id = ? AND IFNULL(u.IsActive, 1) <> 0`, [id]);
  if (!user) throw new UserError(`${label}: not found or no longer active`);
  return user;
}
async function requireCustomer(conn, customerId) {
  const id = parseOptionalId(customerId, 'Customer');
  if (id === null) return null;
  const [[c]] = await conn.query('SELECT Id FROM Customers WHERE Id = ?', [id]);
  if (!c) throw new UserError('Customer not found');
  return id;
}

// Positive delta = stock comes in. A decrease can never take a batch below zero.
async function applyMoves(conn, moves, remark) {
  const ordered = [...moves].filter((m) => m.delta !== 0).sort((a, b) => a.stockId - b.stockId);
  for (const m of ordered) {
    const qty = Math.abs(m.delta);
    if (m.delta > 0) {
      const [u] = await conn.query('UPDATE Stock SET Quantity = Quantity + ? WHERE Id = ?', [qty, m.stockId]);
      if (u.affectedRows !== 1) throw new UserError('Stock batch not found');
    } else {
      const [u] = await conn.query('UPDATE Stock SET Quantity = Quantity - ? WHERE Id = ? AND Quantity >= ?', [qty, m.stockId, qty]);
      if (u.affectedRows !== 1) {
        throw new UserError(`The store no longer has ${qty} units of this batch, it may have been sold. Nothing was changed.`);
      }
    }
    await conn.query(
      `INSERT INTO StockTransactions (StockId, TransactionType, Effect, Quantity, Timestamp, Remarks)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [m.stockId, m.delta > 0 ? 'MR_RETURN_IN' : 'MR_ISSUE_OUT', m.delta > 0 ? 'IN' : 'OUT', qty, String(remark).slice(0, 255)]
    );
  }
}

async function applyBuckets(conn, issueId, buckets) {
  const keys = Object.keys(buckets);
  if (!keys.length) return;
  keys.forEach((k) => { if (!BUCKET_COLUMNS.includes(k)) throw new Error(`Unknown quantity column ${k}`); });
  await conn.query(
    `UPDATE MrStockIssues SET ${keys.map((k) => `\`${k}\` = \`${k}\` + ?`).join(', ')} WHERE Id = ?`,
    [...keys.map((k) => buckets[k]), issueId]
  );
}

async function addLedger(conn, row) {
  const [r] = await conn.query(
    `INSERT INTO MrStockIssueLedger
       (IssueId, ActionType, Quantity, FromUserId, ToUserId, CustomerId, SaleHeaderId, SalesItemId,
        Buckets, Moves, ReversesId, FormToken, Remarks, ActionDate, CreatedBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.issueId, row.type, row.qty, row.fromUserId || null, row.toUserId || null, row.customerId || null,
     row.saleHeaderId || null, row.salesItemId || null, JSON.stringify(row.buckets || {}), JSON.stringify(row.moves || []),
     row.reversesId || null, row.token || null, cleanText(row.remarks), row.actionDate, row.actorId]
  );
  return r.insertId;
}

/* ---------- lookups ---------- */
async function getMarketingUsers() {
  const [rows] = await db.query(
    `SELECT u.Id, ${fullName('u')} AS Name FROM Users u
      WHERE u.RoleId = ? AND IFNULL(u.IsActive, 1) <> 0 ORDER BY u.FirstName, u.LastName`, [MARKETING_ROLE_ID]);
  if (rows.length) return rows;
  const [all] = await db.query(
    `SELECT u.Id, ${fullName('u')} AS Name FROM Users u
      WHERE IFNULL(u.IsActive, 1) <> 0 ORDER BY u.FirstName, u.LastName`);
  return all;
}

// Other batches of the same product that a replacement can go into
async function getReplacementLots(issue) {
  const [rows] = await db.query(
    `SELECT s.Id, s.BatchNumber, s.Quantity, DATE_FORMAT(s.ExpiryDate, '%d-%m-%Y') AS ExpiryText
       FROM Stock s
      WHERE s.ProductId = ? AND s.Id <> ? AND s.ExpiryDate > CURDATE()
      ORDER BY s.ExpiryDate DESC, s.Id DESC`, [issue.ProductId, issue.StockId]);
  return rows;
}

// Invoice lines of this product, made on or after the issue date, with quantity still free to link
async function getLinkableInvoiceLines(issue) {
  const [rows] = await db.query(
    `SELECT si.Id AS SalesItemId, sh.Id AS SaleId, sh.InvoiceId, c.CustomerName, s.BatchNumber,
            DATE_FORMAT(sh.CreatedAt, '%d-%m-%Y') AS CreatedText,
            (si.StockId = ?) AS SameBatch, (sh.CustomerId <=> ?) AS SameCustomer,
            si.QuantitySold - IFNULL(si.ReturnedQty, 0) - IFNULL(l.Linked, 0) AS FreeQty
       FROM SalesItems si
       JOIN SalesHeader sh ON sh.Id = si.SaleId
       JOIN Stock s ON s.Id = si.StockId
       JOIN Customers c ON c.Id = sh.CustomerId
       LEFT JOIN (SELECT SalesItemId, SUM(Quantity) AS Linked FROM MrStockIssueLedger
                   WHERE ActionType = 'BILL' AND ReversedAt IS NULL GROUP BY SalesItemId) l ON l.SalesItemId = si.Id
      WHERE s.ProductId = ? AND DATE(sh.CreatedAt) >= ?
     HAVING FreeQty > 0
      ORDER BY SameCustomer DESC, sh.Id DESC LIMIT 100`,
    [issue.StockId, issue.CustomerId, issue.ProductId, issue.IssuedOnText]
  );
  return rows;
}

/* ---------- list, detail, reports ---------- */
const ISSUE_SELECT = `
  SELECT i.Id, i.ParentIssueId, i.StockId, s.BatchNumber, i.ProductId, p.ProductName, p.KnownAs,
         i.IssuedQty, i.ReturnedQty, i.ReplacedQty, i.PendingBillQty, i.BilledQty, i.SampleQty, i.LostQty,
         i.TransferredOutQty, i.RemainingQty, i.Status,
         i.CurrentHolderId, ${fullName('hu')} AS CurrentHolderName,
         ${fullName('iu')} AS IssuedToName, ${fullName('bu')} AS IssuedByName,
         i.CustomerId, c.CustomerName, i.Purpose, i.Remarks,
         DATE_FORMAT(i.IssuedOn, '%Y-%m-%d') AS IssuedOnText,
         DATE_FORMAT(i.IssuedOn, '%d-%m-%Y') AS IssuedOnDisplay,
         DATE_FORMAT(s.ExpiryDate, '%d-%m-%Y') AS ExpiryText,
         (s.ExpiryDate < CURDATE()) AS IsExpired,
         DATEDIFF(CURDATE(), i.IssuedOn) AS DaysOutstanding
    FROM MrStockIssues i
    JOIN Stock s          ON s.Id = i.StockId
    JOIN Products p       ON p.Id = i.ProductId
    JOIN Users hu         ON hu.Id = i.CurrentHolderId
    JOIN Users iu         ON iu.Id = i.IssuedToId
    JOIN Users bu         ON bu.Id = i.IssuedById
    LEFT JOIN Customers c ON c.Id = i.CustomerId`;

function listFilter({ status, holderId, search }) {
  const where = [];
  const params = [];
  if (status === 'OPEN') where.push(`i.Status <> 'SETTLED'`);
  else if (STATUSES.includes(status)) { where.push('i.Status = ?'); params.push(status); }
  const holder = parseInt(holderId, 10);
  if (holder > 0) { where.push('i.CurrentHolderId = ?'); params.push(holder); }
  const term = scalar(search).slice(0, 100).replace(/[\\%_]/g, '\\$&');
  if (term) {
    where.push(`(p.ProductName LIKE ? OR p.KnownAs LIKE ? OR s.BatchNumber LIKE ? OR c.CustomerName LIKE ?
                 OR ${fullName('hu')} LIKE ?)`);
    params.push(...Array(5).fill(`%${term}%`));
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function listIssues({ status = 'OPEN', holderId, search = '', page = 1 } = {}) {
  const f = listFilter({ status, holderId, search });
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM (${ISSUE_SELECT} ${f.sql}) t`, f.params);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
  const [rows] = await db.query(
    `${ISSUE_SELECT} ${f.sql} ORDER BY (i.Status = 'SETTLED'), i.IssuedOn, i.Id LIMIT ? OFFSET ?`,
    [...f.params, PAGE_SIZE, (current - 1) * PAGE_SIZE]
  );
  return { rows, total, page: current, pages };
}

async function getSummary() {
  const [[row]] = await db.query(
    `SELECT IFNULL(SUM(i.RemainingQty), 0) AS WithMrUnits,
            IFNULL(SUM(i.RemainingQty * IFNULL(s.PurchasePrice, 0)), 0) AS WithMrValue,
            IFNULL(SUM(i.PendingBillQty), 0) AS AwaitingInvoiceUnits,
            COUNT(DISTINCT CASE WHEN i.RemainingQty > 0 THEN i.CurrentHolderId END) AS MrCount,
            IFNULL(SUM(CASE WHEN i.RemainingQty > 0 AND DATEDIFF(CURDATE(), i.IssuedOn) > ? THEN 1 ELSE 0 END), 0) AS OverdueLines,
            IFNULL(SUM(i.SampleQty + i.LostQty), 0) AS WrittenOffUnits,
            IFNULL(SUM((i.SampleQty + i.LostQty) * IFNULL(s.PurchasePrice, 0)), 0) AS WrittenOffValue
       FROM MrStockIssues i JOIN Stock s ON s.Id = i.StockId`, [OVERDUE_DAYS]);
  return row;
}

// "Who holds what": open units per MR, product and batch
async function getHoldings() {
  const [rows] = await db.query(
    `SELECT i.CurrentHolderId, ${fullName('u')} AS HolderName, p.ProductName, s.BatchNumber,
            DATE_FORMAT(s.ExpiryDate, '%d-%m-%Y') AS ExpiryText, (s.ExpiryDate < CURDATE()) AS IsExpired,
            SUM(i.RemainingQty) AS Units, SUM(i.RemainingQty * IFNULL(s.PurchasePrice, 0)) AS Value,
            MAX(DATEDIFF(CURDATE(), i.IssuedOn)) AS OldestDays
       FROM MrStockIssues i
       JOIN Stock s ON s.Id = i.StockId
       JOIN Products p ON p.Id = i.ProductId
       JOIN Users u ON u.Id = i.CurrentHolderId
      WHERE i.RemainingQty > 0
      GROUP BY i.CurrentHolderId, HolderName, p.ProductName, s.Id, s.BatchNumber, s.ExpiryDate
      ORDER BY HolderName, p.ProductName, s.ExpiryDate`);
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.CurrentHolderId)) map.set(r.CurrentHolderId, { Id: r.CurrentHolderId, Name: r.HolderName, Units: 0, Value: 0, items: [] });
    const h = map.get(r.CurrentHolderId);
    h.Units += Number(r.Units); h.Value += Number(r.Value); h.items.push(r);
  });
  return [...map.values()];
}

// Invoice lines that were edited or removed after being linked
async function getBrokenInvoiceLinks() {
  const [rows] = await db.query(
    `SELECT l.IssueId, l.SalesItemId, sh.InvoiceId, SUM(l.Quantity) AS LinkedQty,
            IFNULL(si.QuantitySold, 0) - IFNULL(si.ReturnedQty, 0) AS InvoiceQty
       FROM MrStockIssueLedger l
       LEFT JOIN SalesItems si ON si.Id = l.SalesItemId
       LEFT JOIN SalesHeader sh ON sh.Id = l.SaleHeaderId
      WHERE l.ActionType = 'BILL' AND l.ReversedAt IS NULL
      GROUP BY l.IssueId, l.SalesItemId, sh.InvoiceId, si.QuantitySold, si.ReturnedQty`);
  // Totals per line, because one invoice line can settle several issues
  const perLine = new Map();
  rows.forEach((r) => perLine.set(r.SalesItemId, (perLine.get(r.SalesItemId) || 0) + Number(r.LinkedQty)));
  return rows.filter((r) => perLine.get(r.SalesItemId) > Number(r.InvoiceQty));
}

async function getIssueById(id) {
  const issueId = parseId(id, 'Issue');
  const [rows] = await db.query(`${ISSUE_SELECT} WHERE i.Id = ?`, [issueId]);
  return rows[0] || null;
}

async function getLedgerForIssue(issueId) {
  const [rows] = await db.query(
    `SELECT l.Id, l.IssueId, l.ActionType, l.Quantity, l.Remarks, l.ReversesId, l.ReversedAt, l.SaleHeaderId, l.SalesItemId,
            ${fullName('fu')} AS FromUserName, ${fullName('tu')} AS ToUserName,
            ${fullName('cu')} AS CreatedByName, c.CustomerName, sh.InvoiceId,
            DATE_FORMAT(l.ActionDate, '%d-%m-%Y') AS ActionDisplay
       FROM MrStockIssueLedger l
       LEFT JOIN Users fu ON fu.Id = l.FromUserId
       LEFT JOIN Users tu ON tu.Id = l.ToUserId
       LEFT JOIN Users cu ON cu.Id = l.CreatedBy
       LEFT JOIN Customers c ON c.Id = l.CustomerId
       LEFT JOIN SalesHeader sh ON sh.Id = l.SaleHeaderId
      WHERE l.IssueId = ? ORDER BY l.Id DESC`, [parseId(issueId, 'Issue')]);
  return rows.map((r) => ({ ...r, CanUndo: REVERSIBLE.includes(r.ActionType) && !r.ReversedAt }));
}

async function getRelatedIssues(issue) {
  const [rows] = await db.query(
    `SELECT i.Id, i.IssuedQty, i.RemainingQty, i.Status, ${fullName('u')} AS HolderName
       FROM MrStockIssues i JOIN Users u ON u.Id = i.CurrentHolderId
      WHERE i.ParentIssueId = ? OR i.Id = ? ORDER BY i.Id`, [issue.Id, issue.ParentIssueId || 0]);
  return rows;
}

/* ---------- actions ---------- */

// Issue many products in one save. Either every line is saved or none is.
// lines: [{ stockId, quantity, customerId?, remarks? }]
async function createIssues({ issuedToId, issuedOn, purpose, remarks, lines, formToken }, actorId) {
  if (!Array.isArray(lines) || lines.length === 0) throw new UserError('Add at least one product');
  if (lines.length > 100) throw new UserError('Too many lines in one go (max 100)');
  const clean = lines.map((l, i) => {
    const prefix = `Line ${i + 1}`;
    if (!l || typeof l !== 'object') throw new UserError(`${prefix}: invalid`);
    return {
      n: i + 1,
      stockId: parseId(l.stockId, `${prefix}: product`),
      quantity: parseQty(l.quantity, { label: `${prefix}: quantity` }),
      customerId: parseOptionalId(l.customerId, `${prefix}: customer`),
      remarks: cleanText(l.remarks, 200),
    };
  });
  const token = cleanToken(formToken);

  return inTransaction(async (conn) => {
    const mr = await requireActiveUser(conn, issuedToId, 'MR');
    const date = await checkActionDate(conn, issuedOn, null, 'Issue date');

    const stockIds = [...new Set(clean.map((l) => l.stockId))].sort((a, b) => a - b);
    const [stockRows] = await conn.query(
      `SELECT Id, ProductId, BatchNumber, Quantity, (ExpiryDate < CURDATE()) AS IsExpired
         FROM Stock WHERE Id IN (?) ORDER BY Id FOR UPDATE`, [stockIds]);
    const stockMap = new Map(stockRows.map((r) => [Number(r.Id), r]));

    const running = new Map();
    for (const l of clean) {
      const s = stockMap.get(l.stockId);
      if (!s) throw new UserError(`Line ${l.n}: stock batch not found`);
      if (Number(s.IsExpired)) throw new UserError(`Line ${l.n}: batch ${s.BatchNumber} has expired`);
      const total = (running.get(l.stockId) || 0) + l.quantity;
      running.set(l.stockId, total);
      if (total > Number(s.Quantity)) {
        throw new UserError(`Line ${l.n}: batch ${s.BatchNumber} has only ${s.Quantity} in stock` +
          (total !== l.quantity ? ` (your lines for it add up to ${total})` : ''));
      }
      l.customerId = await requireCustomer(conn, l.customerId);
    }

    const ids = [];
    for (const l of clean) {
      const s = stockMap.get(l.stockId);
      const lineRemarks = l.remarks || cleanText(remarks, 200);
      await applyMoves(conn, [{ stockId: l.stockId, delta: -l.quantity }],
        `Issued to MR ${mr.Name}${lineRemarks ? ' - ' + lineRemarks : ''}`);
      const [r] = await conn.query(
        `INSERT INTO MrStockIssues
           (StockId, ProductId, IssuedQty, CurrentHolderId, IssuedToId, IssuedById, CustomerId, Purpose, IssuedOn, Remarks, CreatedBy)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [l.stockId, s.ProductId, l.quantity, mr.Id, mr.Id, actorId, l.customerId,
         cleanText(purpose) || 'Sample / customer testing', date, lineRemarks, actorId]);
      ids.push(r.insertId);
      await addLedger(conn, {
        issueId: r.insertId, type: 'ISSUE', qty: l.quantity, fromUserId: actorId, toUserId: mr.Id, customerId: l.customerId,
        remarks: lineRemarks, actionDate: date, actorId, token: token ? `${token}:${l.n}` : null,
      });
    }
    return ids;
  });
}

// Runs one simple settlement. `build` returns the buckets and stock moves for the validated quantity.
function settle(type, build) {
  return (issueId, input, actorId) => inTransaction(async (conn) => {
    const issue = await lockIssue(conn, issueId);
    const qty = parseQty(input.quantity, { max: Number(issue.RemainingQty), label: 'Quantity' });
    const actionDate = await checkActionDate(conn, input.actionDate, issue);
    const plan = await build(conn, issue, qty, input);
    await applyBuckets(conn, issue.Id, plan.buckets);
    await applyMoves(conn, plan.moves || [], `${plan.note} (MR issue #${issue.Id})`);
    await addLedger(conn, {
      issueId: issue.Id, type, qty, fromUserId: issue.CurrentHolderId, customerId: plan.customerId,
      buckets: plan.buckets, moves: plan.moves, remarks: input.remarks, actionDate, actorId,
      token: cleanToken(input.formToken),
    });
    return { issue, qty, ...plan };
  });
}

const returnIssue = settle('RETURN', async (conn, issue, qty) => ({
  buckets: { ReturnedQty: qty },
  moves: [{ stockId: issue.StockId, delta: qty }],
  note: 'Returned by MR',
}));

const useAsSample = settle('SAMPLE', async (conn, issue, qty, input) => ({
  buckets: { SampleQty: qty },
  customerId: (await requireCustomer(conn, input.customerId)) || issue.CustomerId,
  note: 'Used as sample',
}));

const markLost = settle('LOST', async (conn, issue, qty, input) => {
  if (!cleanText(input.remarks)) throw new UserError('Write what happened to these units');
  return { buckets: { LostQty: qty }, note: 'Lost or damaged' };
});

// MR hands back the same product in a different batch
const replaceWithBatch = settle('REPLACE', async (conn, issue, qty, input) => {
  const stockId = parseId(input.newStockId, 'New batch');
  if (stockId === Number(issue.StockId)) throw new UserError('That is the same batch. Use Return to store instead.');
  const [[lot]] = await conn.query('SELECT Id, ProductId, BatchNumber FROM Stock WHERE Id = ? FOR UPDATE', [stockId]);
  if (!lot) throw new UserError('New batch not found');
  if (Number(lot.ProductId) !== Number(issue.ProductId)) throw new UserError('The new batch must be the same product');
  return {
    buckets: { ReplacedQty: qty },
    moves: [{ stockId, delta: qty }],
    note: `Replacement received for batch of issue, into batch ${lot.BatchNumber}`,
  };
});

// No invoice yet and the store has no book stock to bill from: put the units on the books
// so the normal billing page can sell them. They stay "awaiting invoice" until linked.
const releaseForBilling = settle('RELEASE', async (conn, issue, qty, input) => ({
  buckets: { PendingBillQty: qty },
  moves: [{ stockId: issue.StockId, delta: qty }],
  customerId: (await requireCustomer(conn, input.customerId)) || issue.CustomerId,
  note: 'Released for billing',
}));

/**
 * Connects MR units to an invoice line. The invoice took units off the store's books, but the
 * customer really received the MR's units, so the store's book count must be put right:
 *
 *   Units still with the MR:  invoice line's batch +qty. This is correct for the same batch
 *                             and for "settled through new stock" (a different batch).
 *   Units already released:   same batch, no change. Different batch: released batch -qty,
 *                             invoice batch +qty.
 */
function linkInvoice(issueId, input, actorId) {
  return inTransaction(async (conn) => {
    const issue = await lockIssue(conn, issueId);
    const salesItemId = parseId(input.salesItemId, 'Invoice line');
    const pending = Number(issue.PendingBillQty);
    const qty = parseQty(input.quantity, { max: pending + Number(issue.RemainingQty), label: 'Quantity' });
    const actionDate = await checkActionDate(conn, input.actionDate, issue);

    const [[line]] = await conn.query(
      `SELECT si.Id, si.StockId, si.QuantitySold, IFNULL(si.ReturnedQty, 0) AS ReturnedQty, s.ProductId, s.BatchNumber,
              sh.Id AS SaleId, sh.InvoiceId, sh.CustomerId, DATE_FORMAT(sh.CreatedAt, '%Y-%m-%d') AS CreatedText
         FROM SalesItems si
         JOIN SalesHeader sh ON sh.Id = si.SaleId
         JOIN Stock s ON s.Id = si.StockId
        WHERE si.Id = ? FOR UPDATE OF si`, [salesItemId]);
    if (!line) throw new UserError('Invoice line not found');
    if (Number(line.ProductId) !== Number(issue.ProductId)) throw new UserError('That invoice line is a different product');
    if (line.CreatedText < issue.IssuedOnText) throw new UserError(`Invoice ${line.InvoiceId} was made before this issue`);

    const [[{ linked }]] = await conn.query(
      `SELECT IFNULL(SUM(Quantity), 0) AS linked FROM MrStockIssueLedger
        WHERE SalesItemId = ? AND ActionType = 'BILL' AND ReversedAt IS NULL`, [salesItemId]);
    const free = Number(line.QuantitySold) - Number(line.ReturnedQty) - Number(linked);
    if (qty > free) throw new UserError(`Invoice ${line.InvoiceId} has only ${Math.max(free, 0)} units of this line free to link`);

    const fromPending = Math.min(qty, pending);
    const fromMr = qty - fromPending;
    const lineStock = Number(line.StockId);
    const sameBatch = lineStock === Number(issue.StockId);
    const totals = new Map();
    const add = (stockId, delta) => totals.set(stockId, (totals.get(stockId) || 0) + delta);
    if (fromMr) add(lineStock, fromMr);
    if (fromPending && !sameBatch) { add(Number(issue.StockId), -fromPending); add(lineStock, fromPending); }
    const moves = [...totals].map(([stockId, delta]) => ({ stockId, delta }));
    const buckets = { BilledQty: qty };
    if (fromPending) buckets.PendingBillQty = -fromPending;

    await applyBuckets(conn, issue.Id, buckets);
    await applyMoves(conn, moves, `Settled against invoice ${line.InvoiceId} (MR issue #${issue.Id})`);
    await addLedger(conn, {
      issueId: issue.Id, type: 'BILL', qty, fromUserId: issue.CurrentHolderId, customerId: line.CustomerId,
      saleHeaderId: line.SaleId, salesItemId, buckets, moves, remarks: input.remarks, actionDate, actorId,
      token: cleanToken(input.formToken),
    });
    return { invoiceId: line.InvoiceId, sameBatch };
  });
}

// Give all or part of what an MR holds to another MR. A part transfer becomes a new issue
// that keeps the original issue date, so overdue tracking cannot be reset by passing stock around.
function transferIssue(issueId, input, actorId) {
  return inTransaction(async (conn) => {
    const issue = await lockIssue(conn, issueId);
    const remaining = Number(issue.RemainingQty);
    if (remaining <= 0) throw new UserError('Nothing left with the MR to transfer');
    const to = await requireActiveUser(conn, input.toUserId, 'New MR');
    if (Number(to.Id) === Number(issue.CurrentHolderId)) throw new UserError('Already with this MR');
    const qty = parseQty(input.quantity === undefined || input.quantity === '' ? remaining : input.quantity,
      { max: remaining, label: 'Quantity' });
    const actionDate = await checkActionDate(conn, input.actionDate || await today(conn), issue);
    const base = {
      type: 'TRANSFER', qty, fromUserId: issue.CurrentHolderId, toUserId: to.Id, remarks: input.remarks, actionDate, actorId,
    };

    if (qty === remaining) {
      await conn.query('UPDATE MrStockIssues SET CurrentHolderId = ? WHERE Id = ?', [to.Id, issue.Id]);
      await addLedger(conn, { ...base, issueId: issue.Id, token: cleanToken(input.formToken) });
      return { issueId: issue.Id, split: false };
    }

    await applyBuckets(conn, issue.Id, { TransferredOutQty: qty });
    await addLedger(conn, { ...base, issueId: issue.Id, buckets: { TransferredOutQty: qty }, token: cleanToken(input.formToken) });
    const [r] = await conn.query(
      `INSERT INTO MrStockIssues
         (ParentIssueId, StockId, ProductId, IssuedQty, CurrentHolderId, IssuedToId, IssuedById, CustomerId, Purpose, IssuedOn, Remarks, CreatedBy)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [issue.Id, issue.StockId, issue.ProductId, qty, to.Id, to.Id, actorId, issue.CustomerId, issue.Purpose,
       issue.IssuedOnText, cleanText(`Transferred from issue #${issue.Id}`), actorId]);
    await addLedger(conn, { ...base, issueId: r.insertId, remarks: input.remarks || `From issue #${issue.Id}` });
    return { issueId: r.insertId, split: true };
  });
}
async function today(conn = db) {
  const [[{ d }]] = await conn.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d`);
  return d;
}

// Undo one entry that was saved by mistake. The history keeps both entries.
function reverseEntry(issueId, ledgerId, input, actorId) {
  return inTransaction(async (conn) => {
    const issue = await lockIssue(conn, issueId);
    const [[entry]] = await conn.query(
      'SELECT * FROM MrStockIssueLedger WHERE Id = ? AND IssueId = ? FOR UPDATE', [parseId(ledgerId, 'Entry'), issue.Id]);
    if (!entry) throw new UserError('History entry not found');
    if (entry.ReversedAt) throw new UserError('This entry was already undone');
    if (!REVERSIBLE.includes(entry.ActionType)) throw new UserError('This type of entry cannot be undone');

    const buckets = {};
    Object.entries(parseJson(entry.Buckets) || {}).forEach(([k, v]) => { buckets[k] = -Number(v); });
    for (const [k, delta] of Object.entries(buckets)) {
      if (Number(issue[k]) + delta < 0) {
        throw new UserError('A later entry depends on this one. Undo the later entry first.');
      }
    }
    const moves = (parseJson(entry.Moves) || []).map((m) => ({ stockId: m.stockId, delta: -Number(m.delta) }));

    await applyBuckets(conn, issue.Id, buckets);
    await applyMoves(conn, moves, `Undo of ${entry.ActionType} (MR issue #${issue.Id})`);
    await conn.query('UPDATE MrStockIssueLedger SET ReversedAt = NOW(), ReversedBy = ? WHERE Id = ?', [actorId, entry.Id]);
    await addLedger(conn, {
      issueId: issue.Id, type: 'REVERSAL', qty: entry.Quantity, reversesId: entry.Id, buckets, moves,
      saleHeaderId: entry.SaleHeaderId, remarks: input.remarks || `Undo of ${entry.ActionType}`,
      actionDate: await today(conn), actorId, token: cleanToken(input.formToken),
    });
  });
}

module.exports = {
  BILLING_PAGE_URL, OVERDUE_DAYS, STATUSES, UserError, today,
  getMarketingUsers, getReplacementLots, getLinkableInvoiceLines,
  listIssues, getSummary, getHoldings, getBrokenInvoiceLinks, getIssueById, getLedgerForIssue, getRelatedIssues,
  createIssues, returnIssue, useAsSample, markLost, replaceWithBatch, releaseForBilling, linkInvoice, transferIssue, reverseEntry,
};
