const dbConnection = require("../config/DBConnection");
const mysql = require("mysql2"); // Ensure you have mysql2 package
// ═══════════════════════════════════════════════════════════════════
// models/Technician.js
// ═══════════════════════════════════════════════════════════════════
//const dbConnection = require('../DBConnection');

// ── Get room dashboard queue ──────────────────────────────────────
const getRoomDashboardQueue = async (roomCodes) => {
    if (!roomCodes || !roomCodes.length) return [];
    const placeholders = roomCodes.map(() => '?').join(',');

    const [rows] = await dbConnection.query(
        `SELECT
             pq.QueueId,
             pq.PatientTestId,
             pq.RoomCode,
             pq.IsEmergency,
             pq.ArrivalTime,
             pq.QueuePosition,
             pq.Status                              AS QueueStatus,
             pd.Id                                  AS PatientId,
             CONCAT(pd.Title,' ',pd.Name)           AS PatientName,
             pd.Age, pd.Ymd, pd.Gender, pd.PhoneNumber,
             ptr.Id                                 AS PtrId,
             mtt.TestName,
             ptr.TestStatus,
             ptr.StatusNote,
             pq.PriorityNote,
             pq.PrioritisedAt,
             CONCAT(d.FirstName,' ',d.LastName)     AS DoctorName
         FROM PatientQueue pq
         JOIN PatientDetails pd         ON pd.Id  = pq.PatientId
         JOIN PatientTestRefference ptr ON ptr.Id = pq.PatientTestId
         JOIN MainTestTable mtt         ON mtt.Id = ptr.TestId
         LEFT JOIN DoctorDetails d      ON d.Id   = pq.ReferredDoctorId
         WHERE pq.RoomCode IN (${placeholders})
           AND DATE(pq.ArrivalTime) = CURDATE()
           AND pq.Status IN ('Waiting','InProgress','Aborted')
         ORDER BY pq.RoomCode, pq.IsEmergency DESC,
                  pq.QueuePosition ASC, pq.ArrivalTime ASC`,
        roomCodes
    );

    if (!rows.length) return [];

    // All tests per patient for the info strip
    const patientIds      = [...new Set(rows.map(r => r.PatientId))];
    const patPlaceholders = patientIds.map(() => '?').join(',');

    const [allTestRows] = await dbConnection.query(
        `SELECT
             ptr2.PatientId,
             mtt2.TestName,
             ptr2.TestStatus,
             pq2.RoomCode
         FROM PatientTestRefference ptr2
         JOIN PatientQueue pq2   ON pq2.PatientTestId = ptr2.Id
         JOIN MainTestTable mtt2 ON mtt2.Id = ptr2.TestId
         WHERE ptr2.PatientId IN (${patPlaceholders})
           AND DATE(pq2.ArrivalTime) = CURDATE()`,
        patientIds
    );

    const testsByPatient = {};
    allTestRows.forEach(function(t) {
        if (!testsByPatient[t.PatientId]) testsByPatient[t.PatientId] = [];
        testsByPatient[t.PatientId].push({
            testName:   t.TestName,
            testStatus: t.TestStatus,
            roomCode:   t.RoomCode
        });
    });

    rows.forEach(function(row) {
        row.AllTests = JSON.stringify(testsByPatient[row.PatientId] || []);
    });

    return rows;
};

// ── Update test status ────────────────────────────────────────────
const updateTestStatus = async (patientTestId, status, userId, note = null) => {
    const connection = await dbConnection.getConnection();
    try {
        await connection.beginTransaction();

        if (status === 'InProgress') {
            await connection.execute(
                `UPDATE PatientTestRefference
                 SET TestStatus = 'InProgress', EntryTime = NOW(), StartedBy = ?,
                     ExitTime = NULL, StatusNote = NULL
                 WHERE Id = ?`,
                [userId, patientTestId]
            );
            await connection.execute(
                `UPDATE PatientQueue
                 SET Status = 'InProgress', ExitTime = NULL
                 WHERE PatientTestId = ?`,
                [patientTestId]
            );

        } else if (status === 'Completed') {
            await connection.execute(
                `UPDATE PatientTestRefference
                 SET TestStatus = 'Completed', ExitTime = NOW(), CompletedBy = ?
                 WHERE Id = ?`,
                [userId, patientTestId]
            );
            await connection.execute(
                `UPDATE PatientQueue
                 SET Status = 'Completed', ExitTime = NOW()
                 WHERE PatientTestId = ?`,
                [patientTestId]
            );

        } else if (status === 'Aborted') {
            await connection.execute(
                `UPDATE PatientTestRefference
                 SET TestStatus = 'Aborted', ExitTime = NOW(), CompletedBy = ?, StatusNote = ?
                 WHERE Id = ?`,
                [userId, note, patientTestId]
            );
            await connection.execute(
                `UPDATE PatientQueue
                 SET Status = 'Aborted', ExitTime = NOW()
                 WHERE PatientTestId = ?`,
                [patientTestId]
            );

        } else {
            throw new Error(`Unknown status: ${status}`);
        }

        let allDone = false;
        if (status === 'Completed' || status === 'Aborted') {
            const [[ptr]] = await connection.execute(
                `SELECT PatientId FROM PatientTestRefference WHERE Id = ?`,
                [patientTestId]
            );
            const [[pending]] = await connection.execute(
                `SELECT COUNT(*) AS cnt
                 FROM PatientTestRefference
                 WHERE PatientId = ?
                   AND TestStatus NOT IN ('Completed','Aborted')`,
                [ptr.PatientId]
            );
            allDone = pending.cnt === 0;
        }

        await connection.commit();
        return { allDone };

    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

// ── Move patient up in queue ──────────────────────────────────────
const movePatientUp = async (queueId, roomCode) => {
    const connection = await dbConnection.getConnection();
    try {
        await connection.beginTransaction();

        // Get all waiting patients for this room ordered by position
        const [rows] = await connection.execute(
            `SELECT QueueId, QueuePosition
             FROM PatientQueue
             WHERE RoomCode = ?
               AND DATE(ArrivalTime) = CURDATE()
               AND Status = 'Waiting'
               AND IsEmergency = 0
             ORDER BY QueuePosition ASC, ArrivalTime ASC`,
            [roomCode]
        );

        // Find index of the patient being moved
        const idx = rows.findIndex(r => r.QueueId == queueId);
        if (idx <= 0) {
            // Already first or not found
            await connection.commit();
            return { success: false, message: 'Patient is already first in queue.' };
        }

        // Swap QueuePosition with the patient above
        const current  = rows[idx];
        const above    = rows[idx - 1];

        // Assign sequential positions if null
        const posAbove   = above.QueuePosition   ?? (idx);
        const posCurrent = current.QueuePosition ?? (idx + 1);

        await connection.execute(
            `UPDATE PatientQueue SET QueuePosition = ? WHERE QueueId = ?`,
            [posAbove,   current.QueueId]
        );
        await connection.execute(
            `UPDATE PatientQueue SET QueuePosition = ? WHERE QueueId = ?`,
            [posCurrent, above.QueueId]
        );

        await connection.commit();
        return { success: true };

    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

// ── Reorder queue (full save from drag-drop) ──────────────────────
const saveQueueOrder = async (orderedQueueIds) => {
    const connection = await dbConnection.getConnection();
    try {
        await connection.beginTransaction();
        for (let i = 0; i < orderedQueueIds.length; i++) {
            await connection.execute(
                `UPDATE PatientQueue SET QueuePosition = ? WHERE QueueId = ?`,
                [i + 1, orderedQueueIds[i]]
            );
        }
        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};


// ── Prioritise patient (move up with comment) ─────────────────────
const prioritisePatient = async (queueId, roomCode, note, userId) => {
    const connection = await dbConnection.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT QueueId, QueuePosition
             FROM PatientQueue
             WHERE RoomCode = ?
               AND DATE(ArrivalTime) = CURDATE()
               AND Status = 'Waiting'
               AND IsEmergency = 0
             ORDER BY QueuePosition ASC, ArrivalTime ASC`,
            [roomCode]
        );

        const idx = rows.findIndex(r => r.QueueId == queueId);
        if (idx <= 0) {
            await connection.commit();
            return { success: false, message: 'Patient is already first in queue.' };
        }

        const current = rows[idx];
        const above   = rows[idx - 1];
        const posA    = above.QueuePosition   ?? idx;
        const posC    = current.QueuePosition ?? (idx + 1);

        await connection.execute(
            `UPDATE PatientQueue SET QueuePosition = ? WHERE QueueId = ?`,
            [posA, current.QueueId]
        );
        await connection.execute(
            `UPDATE PatientQueue SET QueuePosition = ? WHERE QueueId = ?`,
            [posC, above.QueueId]
        );
        await connection.execute(
            `UPDATE PatientQueue
             SET PriorityNote  = ?,
                 PrioritisedBy = ?,
                 PrioritisedAt = NOW()
             WHERE QueueId = ?`,
            [note, userId, queueId]
        );

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

// ── Move patient to any position ──────────────────────────────────
const movePatientToPosition = async (queueId, beforeQueueId, roomCode, note, userId) => {
    const connection = await dbConnection.getConnection();
    try {
        await connection.beginTransaction();

        // All waiting non-emergency patients EXCEPT the one being moved
        const [rows] = await connection.execute(
            `SELECT QueueId
             FROM PatientQueue
             WHERE RoomCode = ?
               AND DATE(ArrivalTime) = CURDATE()
               AND Status = 'Waiting'
               AND IsEmergency = 0
               AND QueueId != ?
             ORDER BY QueuePosition ASC, ArrivalTime ASC`,
            [roomCode, queueId]
        );

        // Build new order — insert before beforeQueueId, or at end if null
        var newOrder = rows.map(function(r){ return r.QueueId; });
        var insertIdx = beforeQueueId
            ? newOrder.indexOf(parseInt(beforeQueueId))
            : -1;

        if (insertIdx >= 0) {
            newOrder.splice(insertIdx, 0, parseInt(queueId));
        } else {
            newOrder.unshift(parseInt(queueId)); // default: move to front
        }

        // Save positions
        for (var i = 0; i < newOrder.length; i++) {
            await connection.execute(
                `UPDATE PatientQueue SET QueuePosition = ? WHERE QueueId = ?`,
                [i + 1, newOrder[i]]
            );
        }

        // Save priority note
        if (note) {
            await connection.execute(
                `UPDATE PatientQueue
                 SET PriorityNote  = ?,
                     PrioritisedBy = ?,
                     PrioritisedAt = NOW()
                 WHERE QueueId = ?`,
                [note, userId, queueId]
            );
        }

        await connection.commit();
        return { success: true, newPosition: newOrder.indexOf(parseInt(queueId)) + 1 };

    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

module.exports = {
    movePatientToPosition,
    prioritisePatient,
    getRoomDashboardQueue,
    updateTestStatus,
    movePatientUp,
    saveQueueOrder
};
