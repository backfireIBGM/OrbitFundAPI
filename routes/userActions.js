import express from 'express';

export default (db, logger) => {
    const router = express.Router();

	router.put('/toggle-approval/:id', async (req, res) => {
        try {
            const missionId = req.params.id;
            
            const userId = req.user.userId || req.user.id; 

            if (!userId) {
                logger.error('Toggle failed: User ID missing from token payload');
                return res.status(401).json({ message: 'Invalid user session.' });
            }

            const [result] = await db.execute(
                `UPDATE FormSubmissions 
                 SET user_approved = NOT user_approved 
                 WHERE Id = ? AND user_id = ?`,
                [missionId, userId]
            );
            
            if (result.affectedRows === 0) {
                logger.warn(
                    `Toggle failed: Mission ${missionId} not found or unauthorized for user ${userId}`
                );
                return res.status(403).json({
                    message: 'Permission denied or mission not found.',
                });
            }

            // Fetch updated state to return to UI
            const [updated] = await db.execute(
                'SELECT user_approved, is_public FROM FormSubmissions WHERE Id = ?',
                [missionId]
            );

            logger.info(`User ${userId} toggled approval on mission ${missionId}`);

            res.json({
                message: 'Status updated successfully.',
                user_approved: !!updated[0].user_approved,
                is_public: !!updated[0].is_public,
            });
        } catch (error) {
            // Handle the Launch Date trigger error
            if (error.sqlState === '45000') {
                return res.status(400).json({
                    message: 'Action blocked: Launch date cannot be in the past.',
                });
            }

            logger.error(`Error in toggle-approval: ${error.message}`);
            res.status(500).json({ message: 'Internal server error.' });
        }
    });

    return router;
};
