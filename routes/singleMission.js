import express from 'express';

export default (db, jwtConfig, logger) => {
    const router = express.Router();

    // This route definition should be RELATIVE to the base path where the router is mounted in server.js
    // If mounted at /api/approved-missions, this becomes /api/approved-missions/:id
    router.get('/:id', async (req, res) => { // <--- Changed from '/single-missions/:id' to '/:id'
        try {
            const missionId = req.params.id;

            const [missions] = await db.execute("SELECT * FROM FormSubmissions WHERE Id = ? AND Status = 'Approved'", [missionId]);

            if (missions.length === 0) {
                logger.info(`Retrieved 0 approved missions for ID: ${missionId}`);
                return res.status(404).json({ message: 'Mission not found or not approved.' });
            }

            const mission = missions[0];

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
