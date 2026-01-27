import express from 'express';

export default (db, jwtConfig, logger) => {
    const router = express.Router();

    router.get('/:id', async (req, res) => {
        try {
            const missionId = req.params.id;

            // Updated query to use is_public = 1 instead of Status = 'Approved'
            const [missions] = await db.execute(
                "SELECT * FROM FormSubmissions WHERE Id = ? AND is_public = 1", 
                [missionId]
            );

            if (missions.length === 0) {
                logger.info(`Retrieved 0 approved missions for ID: ${missionId}`);
                return res.status(404).json({ message: 'Mission not found or not approved.' });
            }

            const mission = missions[0];

            // ... rest of the code for fetching images, videos, etc. remains the same ...
            const [images] = await db.execute(
                `SELECT submission_id, image_url FROM FormSubmissionImages WHERE submission_id = ?`,
                [missionId]
            );
            const [videos] = await db.execute(
                `SELECT submission_id, video_url FROM FormSubmissionVideos WHERE submission_id = ?`,
                [missionId]
            );
            const [documents] = await db.execute(
                `SELECT submission_id, document_url FROM FormSubmissionDocuments WHERE submission_id = ?`,
                [missionId]
            );
            const [milestones] = await db.execute(
                `SELECT submission_id, milestone_name, target_amount FROM FormSubmissionMilestones WHERE submission_id = ? ORDER BY target_amount ASC`,
                [missionId]
            );

            mission.images = images.map(img => img.image_url);
            mission.videos = videos.map(vid => vid.video_url);
            mission.documents = documents.map(doc => doc.document_url);
            mission.milestones = milestones.map(mstone => ({
                milestone_name: mstone.milestone_name,
                target_amount: mstone.target_amount
            }));

            logger.info(`Retrieved approved mission with ID ${missionId} and associated data.`);
            res.json(mission);

        } catch (error) {
            logger.error(`MySQL Error fetching approved mission with ID ${req.params.id}:`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    return router;
};
