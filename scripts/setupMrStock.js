/**
 * scripts/setupMrStock.js  -  run once from the project root:
 *     node scripts/setupMrStock.js
 *
 * Creates the MR stock tables. It reads your real table definitions first, so:
 *   - every foreign key column gets the exact type of the Id it points to
 *   - if StockTransactions.TransactionType is an ENUM, the two MR values are added
 *   - tables from the earlier mr_stock_issue_tables.sql are replaced ONLY if they are empty
 * It never touches any other data, and running it again does nothing.
 */
const db = require('../config/DBConnection');

const REFERENCED = ['Stock', 'Products', 'Users', 'Customers', 'SalesHeader', 'SalesItems'];

async function idType(table) {
  const [rows] = await db.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'Id'`, [table]);
  if (!rows.length) throw new Error(`Table ${table} (with an Id column) was not found in this database.`);
  return rows[0].t;
}
async function tableExists(table) {
  const [r] = await db.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  return r.length > 0;
}
async function hasColumn(table, col) {
  const [r] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]);
  return r.length > 0;
}

async function run() {
  const T = {};
  for (const t of REFERENCED) T[t] = await idType(t);

  if (await tableExists('MrStockIssues') && await hasColumn('MrStockIssues', 'PendingBillQty')) {
    console.log('MR stock tables are already installed.');
  } else {
    for (const t of ['MrStockIssueLedger', 'MrStockIssues']) {
      if (!(await tableExists(t))) continue;
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      if (n > 0) throw new Error(`${t} (old layout) has ${n} rows. Nothing was changed. Tell me before removing them.`);
    }
    await db.query('DROP TABLE IF EXISTS MrStockIssueLedger');
    await db.query('DROP TABLE IF EXISTS MrStockIssues');

    await db.query(`
      CREATE TABLE MrStockIssues (
        Id                INT NOT NULL AUTO_INCREMENT,
        ParentIssueId     INT NULL COMMENT 'Set when split off by a part transfer between MRs',
        StockId           ${T.Stock} NOT NULL,
        ProductId         ${T.Products} NOT NULL,

        IssuedQty         INT NOT NULL,
        ReturnedQty       INT NOT NULL DEFAULT 0 COMMENT 'Same batch came back to store',
        ReplacedQty       INT NOT NULL DEFAULT 0 COMMENT 'Settled: a different batch came back',
        PendingBillQty    INT NOT NULL DEFAULT 0 COMMENT 'Released to stock, invoice not linked yet',
        BilledQty         INT NOT NULL DEFAULT 0 COMMENT 'Linked to an invoice line',
        SampleQty         INT NOT NULL DEFAULT 0 COMMENT 'Used as free sample',
        LostQty           INT NOT NULL DEFAULT 0 COMMENT 'Lost or damaged',
        TransferredOutQty INT NOT NULL DEFAULT 0 COMMENT 'Moved to another MR as a new issue',

        RemainingQty INT GENERATED ALWAYS AS (
          IssuedQty - ReturnedQty - ReplacedQty - PendingBillQty - BilledQty - SampleQty - LostQty - TransferredOutQty
        ) STORED,
        Status VARCHAR(20) GENERATED ALWAYS AS (
          CASE
            WHEN IssuedQty - ReturnedQty - ReplacedQty - PendingBillQty - BilledQty - SampleQty - LostQty - TransferredOutQty > 0
              THEN IF(ReturnedQty + ReplacedQty + PendingBillQty + BilledQty + SampleQty + LostQty + TransferredOutQty = 0, 'WITH_MR', 'PARTIAL')
            WHEN PendingBillQty > 0 THEN 'AWAITING_INVOICE'
            ELSE 'SETTLED'
          END
        ) STORED,

        CurrentHolderId ${T.Users} NOT NULL,
        IssuedToId      ${T.Users} NOT NULL,
        IssuedById      ${T.Users} NOT NULL,
        CustomerId      ${T.Customers} NULL,
        Purpose         VARCHAR(255) NOT NULL DEFAULT 'Sample / customer testing',
        IssuedOn        DATE NOT NULL,
        Remarks         VARCHAR(255) NULL,
        CreatedBy       ${T.Users} NOT NULL,
        CreatedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UpdatedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (Id),
        KEY idx_mr_status (Status),
        KEY idx_mr_holder (CurrentHolderId, Status),
        KEY idx_mr_issued_on (IssuedOn),

        CONSTRAINT chk_mr_qty CHECK (
          IssuedQty > 0 AND ReturnedQty >= 0 AND ReplacedQty >= 0 AND PendingBillQty >= 0 AND BilledQty >= 0
          AND SampleQty >= 0 AND LostQty >= 0 AND TransferredOutQty >= 0
          AND ReturnedQty + ReplacedQty + PendingBillQty + BilledQty + SampleQty + LostQty + TransferredOutQty <= IssuedQty
        ),
        CONSTRAINT fk_mr_parent   FOREIGN KEY (ParentIssueId)   REFERENCES MrStockIssues (Id),
        CONSTRAINT fk_mr_stock    FOREIGN KEY (StockId)         REFERENCES Stock (Id),
        CONSTRAINT fk_mr_product  FOREIGN KEY (ProductId)       REFERENCES Products (Id),
        CONSTRAINT fk_mr_holder   FOREIGN KEY (CurrentHolderId) REFERENCES Users (Id),
        CONSTRAINT fk_mr_to       FOREIGN KEY (IssuedToId)      REFERENCES Users (Id),
        CONSTRAINT fk_mr_by       FOREIGN KEY (IssuedById)      REFERENCES Users (Id),
        CONSTRAINT fk_mr_created  FOREIGN KEY (CreatedBy)       REFERENCES Users (Id),
        CONSTRAINT fk_mr_customer FOREIGN KEY (CustomerId)      REFERENCES Customers (Id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // SalesItems has no foreign key on purpose: your Edit Sale page deletes lines, and a
    // foreign key here would make that page fail. Broken links are reported on the list page.
    await db.query(`
      CREATE TABLE MrStockIssueLedger (
        Id           INT NOT NULL AUTO_INCREMENT,
        IssueId      INT NOT NULL,
        ActionType   VARCHAR(20) NOT NULL,
        Quantity     INT NOT NULL,
        FromUserId   ${T.Users} NULL,
        ToUserId     ${T.Users} NULL,
        CustomerId   ${T.Customers} NULL,
        SaleHeaderId ${T.SalesHeader} NULL,
        SalesItemId  ${T.SalesItems} NULL,
        Buckets      JSON NULL COMMENT 'Quantity columns this entry changed, used by Undo',
        Moves        JSON NULL COMMENT 'Stock changes this entry made, used by Undo',
        ReversesId   INT NULL,
        ReversedAt   DATETIME NULL,
        ReversedBy   ${T.Users} NULL,
        FormToken    VARCHAR(80) NULL COMMENT 'Stops a double click saving twice',
        Remarks      VARCHAR(255) NULL,
        ActionDate   DATE NOT NULL,
        CreatedBy    ${T.Users} NOT NULL,
        CreatedAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (Id),
        UNIQUE KEY uq_mr_ledger_token (FormToken),
        KEY idx_mr_ledger_issue (IssueId, Id),
        KEY idx_mr_ledger_item (SalesItemId, ReversedAt),

        CONSTRAINT chk_mr_ledger_qty CHECK (Quantity > 0),
        CONSTRAINT fk_mrl_issue    FOREIGN KEY (IssueId)      REFERENCES MrStockIssues (Id),
        CONSTRAINT fk_mrl_from     FOREIGN KEY (FromUserId)   REFERENCES Users (Id),
        CONSTRAINT fk_mrl_to       FOREIGN KEY (ToUserId)     REFERENCES Users (Id),
        CONSTRAINT fk_mrl_customer FOREIGN KEY (CustomerId)   REFERENCES Customers (Id),
        CONSTRAINT fk_mrl_sale     FOREIGN KEY (SaleHeaderId) REFERENCES SalesHeader (Id),
        CONSTRAINT fk_mrl_reverses FOREIGN KEY (ReversesId)   REFERENCES MrStockIssueLedger (Id),
        CONSTRAINT fk_mrl_created  FOREIGN KEY (CreatedBy)    REFERENCES Users (Id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created MrStockIssues and MrStockIssueLedger.');
  }

  // TransactionType: add the two values only when it is a closed ENUM
  const [[col]] = await db.query(
    `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StockTransactions' AND COLUMN_NAME = 'TransactionType'`);
  if (!col) throw new Error('StockTransactions.TransactionType was not found.');
  if (/^enum\(/i.test(col.t)) {
    const need = ['MR_ISSUE_OUT', 'MR_RETURN_IN'].filter((v) => !col.t.includes(`'${v}'`));
    if (need.length) {
      const list = col.t.replace(/\)$/, '') + ',' + need.map((v) => `'${v}'`).join(',') + ')';
      await db.query(`ALTER TABLE StockTransactions MODIFY TransactionType ${list} ${col.n === 'NO' ? 'NOT NULL' : 'NULL'}`
        + (col.d != null ? ` DEFAULT ${db.pool.escape(col.d)}` : ''));
      console.log('Added to TransactionType:', need.join(', '));
    }
  }
  console.log('Done.');
}

run().then(() => process.exit(0)).catch((e) => { console.error('SETUP FAILED:', e.message); process.exit(1); });
