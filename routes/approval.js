import express from 'express';

export default (db, jwtConfig, logger) => { // jwtConfig passed but not directly used within this file's logic
    const router = express.Router();

    // Helper to handle string list splitting (like in C#)
    const splitStringToList = (str) => {
        if (!str) return [];
        return str.split(',').filter(s => s.trim() !== '');
    };

    // GET: /api/Approval/pending-ids
    router.get('/pending-ids', async (req, res) => {
        // req.user is available here due to authenticateToken & authorizeAdmin middleware in server.js
        try {
            const [rows] = await db.execute("SELECT id FROM FormSubmissions WHERE Status = 'Pending' ORDER BY id DESC");
            const submissionIds = rows.map(row => row.id);
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
                    id, title, description, goals, type, launchDate, teamInfo, fundingGoal, duration,
                    budgetBreakdown, rewards, image_urls, video_urls, document_urls, Status, CreatedAt
                FROM FormSubmissions
                WHERE id = ?`;

            const [rows] = await db.execute(sql, [id]);

            if (rows.length === 0) {
                logger.warn(`Admin user ${req.user.username} (ID: ${req.user.id}) requested submission ID ${id}, but it was not found.`);
                return res.status(404).json({ message: `Submission with ID ${id} not found.` });
            }

            const row = rows[0];
            const submission = {
                id: row.id,
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
                imageUrls: splitStringToList(row.image_urls),
                videoUrls: splitStringToList(row.video_urls),
                documentUrls: splitStringToList(row.document_urls),
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
                WHERE id = ? AND Status = 'Pending'`;

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