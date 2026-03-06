const dbConnection = require("../config/DBConnection");
const moment = require('moment');
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support


const insertCarryForwardBalances = async (dates) => {
  console.log(dates);
  const connection = await dbConnection.pool.getConnection();

  try {
    //start transaction sice multiple query has to be run
    connection.beginTransaction();
    // Step 1: Delete old carry forward for next financial year
    const deleteQuery = `DELETE FROM CarryForward WHERE FinancialYear = ? `;
    await connection.query(deleteQuery, [dates.nextFY]);

    const deleteQuerySupplier = `DELETE FROM CarryForwardTableForSupplier WHERE FinancialYear = ? `;
    await connection.query(deleteQuerySupplier, [dates.nextFY]);

    // Step 2: Insert new carry forward
    const insertQuery = `
      INSERT INTO CarryForward (
        CustomerId, Debit, Credit, CarryForwardDate, FinancialYear, Description
      )
      SELECT
        c.Id AS CustomerId,

        -- Debit if net balance is positive
        CASE 
          WHEN (
            COALESCE(s.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          ) > 0
          THEN (
            COALESCE(s.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          )
          ELSE 0
        END AS Debit,

        -- Credit if net balance is negative
        CASE 
          WHEN (
            COALESCE(s.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          ) < 0
          THEN ABS(
            COALESCE(s.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          )
          ELSE 0
        END AS Credit,

        ? AS CarryForwardDate,
        ? AS FinancialYear,
        'Auto-generated carry forward balance' AS Description

      FROM Customers c

      -- Sales total (debit side)
      LEFT JOIN (
        SELECT CustomerId, SUM(TotalValueWithTax) AS TotalDebit
        FROM Sales
        WHERE CreatedAt BETWEEN ? AND ?
        GROUP BY CustomerId
      ) s ON c.Id = s.CustomerId

      -- Payments total (credit + debit separately)
      LEFT JOIN (
        SELECT CustomerId,
               SUM(Credit) AS TotalCredit,
               SUM(Debit) AS TotalDebit
        FROM Payments
        WHERE PaymentDate BETWEEN ? AND ?
        GROUP BY CustomerId
      ) p ON c.Id = p.CustomerId

      -- Previous carry forward
      LEFT JOIN (
        SELECT CustomerId, SUM(Debit) AS Debit, SUM(Credit) AS Credit
        FROM CarryForward
        WHERE FinancialYear = ?
        GROUP BY CustomerId
      ) prev ON c.Id = prev.CustomerId
    `;

    const params = [
      dates.nextFYStart,     // CarryForwardDate
      dates.nextFY,          // FinancialYear
      dates.currentFYStart,  // Sales Start
      dates.currentFYEnd,    // Sales End
      dates.currentFYStart,  // Payments Start
      dates.currentFYEnd,    // Payments End
      dates.previousFY       // Previous FY
    ];

    console.log(mysql.format(insertQuery, params)); // Debug print
    await connection.query(insertQuery, params);

    const insertQuerySupplier = `
      INSERT INTO CarryForwardTableForSupplier (
        SupplierId, Debit, Credit, CarryForwardDate, FinancialYear, Description
      )
      SELECT
        s.Id AS SupplierId,

        -- Debit if net balance is positive
        CASE 
          WHEN (
            COALESCE(po.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          ) > 0
          THEN (
            COALESCE(po.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          )
          ELSE 0
        END AS Debit,

        -- Credit if net balance is negative
        CASE 
          WHEN (
            COALESCE(po.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          ) < 0
          THEN ABS(
            COALESCE(po.TotalDebit, 0) 
            - COALESCE(p.TotalCredit, 0) 
            + COALESCE(p.TotalDebit, 0)
            + COALESCE(prev.Debit, 0) 
            - COALESCE(prev.Credit, 0)
          )
          ELSE 0
        END AS Credit,

        ? AS CarryForwardDate,
        ? AS FinancialYear,
        'Auto-generated carry forward balance' AS Description

      FROM Suppliers s

      -- purchase orders total (debit side)
      LEFT JOIN (
        SELECT SupplierId, SUM(TotalAmountWithTax) AS TotalDebit
        FROM PurchaseOrders
        WHERE OrderDate BETWEEN ? AND ?
        GROUP BY SupplierId
      ) po ON s.Id = po.SupplierId

      -- Payments total (credit + debit separately)
      LEFT JOIN (
        SELECT SupplierId,
               SUM(Credit) AS TotalCredit,
               SUM(Debit) AS TotalDebit
        FROM PaymentsToSupplier
        WHERE PaymentDate BETWEEN ? AND ?
        GROUP BY SupplierId
      ) p ON s.Id = p.SupplierId

      -- Previous carry forward
      LEFT JOIN (
        SELECT SupplierId, SUM(Debit) AS Debit, SUM(Credit) AS Credit
        FROM CarryForwardTableForSupplier
        WHERE FinancialYear = ?
        GROUP BY SupplierId
      ) prev ON s.Id = prev.SupplierId
    `;

    const paramsSupplier = [
      dates.nextFYStart,     // CarryForwardDate
      dates.nextFY,          // FinancialYear
      dates.currentFYStart,  // Sales Start
      dates.currentFYEnd,    // Sales End
      dates.currentFYStart,  // Payments Start
      dates.currentFYEnd,    // Payments End
      dates.previousFY       // Previous FY
    ];

    console.log(mysql.format(insertQuerySupplier, paramsSupplier)); // Debug print
     await connection.query(insertQuerySupplier, paramsSupplier);
     await connection.commit()

    return 'Carry forward table for this financial year has been updated.';
  } catch (error) {
    throw error;
  } finally {
    connection.rollback()
    connection.release();
  }
};

module.exports = {
     insertCarryForwardBalances:insertCarryForwardBalances
    };