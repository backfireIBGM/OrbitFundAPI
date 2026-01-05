import express from 'express';

export default (db, logger) => {
    const router = express.Router();

    // GET: /api/user-missions (or whatever mount point you choose)
    // This route assumes authenticateToken middleware has run and populated req.user
    router.get('/', async (req, res) => {
        const userId = req.user.id; // Get the user ID from the authenticated token

        if (!userId) {
            logger.warn('UserMissions: Missing user ID in token for an authenticated request.');
            return res.status(401).json({ message: 'Unauthorized: User ID not found in token.' });
        }

        try {
            // First, fetch the missions for the authenticated user
            // Assuming 'FormSubmissions' table has a 'user_id' column
            const [missions] = await db.execute(
		`SELECT * FROM FormSubmissions WHERE user_id = ? ORDER BY EndTime DESC`,
                [userId]
            );

            if (missions.length === 0) {
                logger.info(`User ${userId} has no missions.`);
                return res.json([]); // Return an empty array if no missions found
            }

            const missionIds = missions.map(mission => mission.Id);

            // Fetch associated data for all these missions using IN clause for efficiency
            const missionIdsPlaceholder = missionIds.map(() => '?').join(',');

            const [images] = await db.execute(
                `SELECT submission_id, image_url FROM FormSubmissionImages WHERE submission_id IN (${missionIdsPlaceholder})`,
                missionIds
            );
            const [videos] = await db.execute(
                `SELECT submission_id, video_url FROM FormSubmissionVideos WHERE submission_id IN (${missionIdsPlaceholder})`,
                missionIds
            );
            const [documents] = await db.execute(
                `SELECT submission_id, document_url FROM FormSubmissionDocuments WHERE submission_id IN (${missionIdsPlaceholder})`,
                missionIds
            );
            const [milestones] = await db.execute(
                `SELECT submission_id, milestone_name, target_amount FROM FormSubmissionMilestones WHERE submission_id IN (${missionIdsPlaceholder}) ORDER BY target_amount ASC`,
                missionIds
            );

            // Structure the response to include all associated data within each mission object
            const missionsWithAllData = missions.map(mission => {
                return {
                    ...mission,
                    images: images
                        .filter(img => img.submission_id === mission.Id)
                        .map(img => img.image_url),
                    videos: videos
                        .filter(vid => vid.submission_id === mission.Id)
                        .map(vid => vid.video_url),
                    documents: documents
                        .filter(doc => doc.submission_id === mission.Id)
                        .map(doc => doc.document_url),
                    milestones: milestones
                        .filter(mstone => mstone.submission_id === mission.Id)
                        .map(mstone => ({
                            milestone_name: mstone.milestone_name,
                            target_amount: mstone.target_amount,
                        })),
                };
            });

            logger.info(`User ${userId} retrieved ${missionsWithAllData.length} missions.`);
            res.json(missionsWithAllData);

        } catch (error) {
            logger.error(`MySQL Error fetching user missions for user ID ${userId}:`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    return router;
};
