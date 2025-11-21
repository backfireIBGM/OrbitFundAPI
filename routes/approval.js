import express from 'express';

export default (db, jwtConfig, logger) => {
    const router = express.Router();

    const splitStringToList = (str) => {
        if (!str) return [];
        return str.split(',').filter(s => s.trim() !== '');
    };

    // GET: /api/Approval/pending-ids
    router.get('/pending-ids', async (req, res) => {
        // req.user is available here due to authenticateToken & authorizeAdmin middleware in server.js
        try {
            const [rows] = await db.execute("SELECT Id FROM FormSubmissions WHERE Status = 'Pending' ORDER BY Id DESC");
            const submissionIds = rows.map(row => row.Id);
            logger.info(`Admin user ${req.user.username} (ID: ${req.user.id}) retrieved ${submissionIds.length} pending submission IDs.`);
            res.json(submissionIds);
        } catch (error) {
            logger.error(`MySQL Error fetching pending submission IDs for admin user ${req.user.username} (ID: ${req.user.id}):`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    // GET: /api/Approval/{id}
    router.get('/:id', async (req, res) => {
        const { id } = req.params;

        if (isNaN(id)) {
            logger.warn(`Admin user ${req.user.username} (ID: ${req.user.id}) requested submission with invalid ID format: ${id}`);
            return res.status(400).json({ message: 'Invalid submission ID format.' });
        }

        try {
            const sql = `
                SELECT
                    fs.Id, fs.title, fs.description, fs.goals, fs.type, fs.launchDate,
                    fs.teamInfo, fs.fundingGoal, fs.duration, fs.budgetBreakdown,
                    fs.rewards, fs.Status, fs.CreatedAt,
                    GROUP_CONCAT(DISTINCT fsi.image_url ORDER BY fsi.id ASC) AS imageUrls,
                    GROUP_CONCAT(DISTINCT fsv.video_url ORDER BY fsv.id ASC) AS videoUrls,
                    GROUP_CONCAT(DISTINCT fsd.document_url ORDER BY fsd.id ASC) AS documentUrls,
                    GROUP_CONCAT(
                        DISTINCT CONCAT(fsm.milestone_name, '||', fsm.target_amount)
                        ORDER BY fsm.id ASC
                    ) AS milestones
                FROM FormSubmissions fs
                LEFT JOIN FormSubmissionImages fsi ON fs.Id = fsi.submission_id
                LEFT JOIN FormSubmissionVideos fsv ON fs.Id = fsv.submission_id
                LEFT JOIN FormSubmissionDocuments fsd ON fs.Id = fsd.submission_id
                LEFT JOIN FormSubmissionMilestones fsm ON fs.Id = fsm.submission_id
                WHERE fs.Id = ?
                GROUP BY fs.Id, fs.title, fs.description, fs.goals, fs.type, fs.launchDate,
                         fs.teamInfo, fs.fundingGoal, fs.duration, fs.budgetBreakdown,
                         fs.rewards, fs.Status, fs.CreatedAt`;

            const [rows] = await db.execute(sql, [id]);

            if (rows.length === 0) {
                logger.warn(`Admin user ${req.user.username} (ID: ${req.user.id}) requested submission ID ${id}, but it was not found.`);
                return res.status(404).json({ message: `Submission with ID ${id} not found.` });
            }

            const row = rows[0];
            const submission = {
                id: row.Id,
                title: row.title,
                description: row.description,
                goals: row.goals,
                type: row.type,
                launchDate: row.launchDate,
                teamInfo: row.teamInfo,
                fundingGoal: row.fundingGoal,
                duration: row.duration,
                budgetBreakdown: row.budgetBreakdown,
                rewards: row.rewards,
                imageUrls: splitStringToList(row.imageUrls),
                videoUrls: splitStringToList(row.videoUrls),
                documentUrls: splitStringToList(row.documentUrls),
                milestones: splitStringToList(row.milestones), // New: split the concatenated milestones
                status: row.Status,
                createdAt: row.CreatedAt
            };

            logger.info(`Admin user ${req.user.username} (ID: ${req.user.id}) retrieved details for submission ID ${id}.`);
            res.json(submission);
        } catch (error) {
            logger.error(`MySQL Error fetching submission details for ID ${id} by admin user ${req.user.username} (ID: ${req.user.id}):`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    // PUT: /api/Approval/update-status
    router.put('/update-status', async (req, res) => {
        const { id, newStatus, adminNotes } = req.body;

        if (!id || isNaN(id) || !newStatus || !['Approved', 'Rejected', 'Archived'].includes(newStatus)) {
            logger.warn(`Admin user ${req.user.username} (ID: ${req.user.id}) sent invalid status update request: ID ${id}, Status: ${newStatus}`);
            return res.status(400).json({ message: "Invalid request: id, newStatus ('Approved', 'Rejected', or 'Archived') are required." });
        }

        try {
            const sql = `
                UPDATE FormSubmissions
                SET Status = ?, AdminNotes = ?, LastUpdated = NOW()
                WHERE Id = ? AND Status = 'Pending'`;

            const [result] = await db.execute(sql, [newStatus, adminNotes || null, id]);

            if (result.affectedRows === 0) {
                logger.warn(`Admin user ${req.user.username} (ID: ${req.user.id}) attempted to update submission ID ${id} to ${newStatus}, but it was not found or not in 'Pending' status.`);
                return res.status(404).json({ message: `Submission with ID ${id} not found or not in 'Pending' status.` });
            }

            logger.info(`Admin user ${req.user.username} (ID: ${req.user.id}) updated submission ID ${id} to status '${newStatus}'.`);
            res.status(200).json({ message: `Submission ID ${id} successfully ${newStatus.toLowerCase()}.` });
        } catch (error) {
            logger.error(`MySQL Error updating submission status for ID ${id} to ${newStatus} by admin user ${req.user.username} (ID: ${req.user.id}):`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    return router;
};