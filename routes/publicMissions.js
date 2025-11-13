import express from 'express';

export default (db, jwtConfig, logger) => {
    const router = express.Router();

    // GET: /api/approved-missions
    router.get('/approved-missions', async (req, res) => {
        try {
            // 1. Fetch main mission data
            const [missions] = await db.execute("SELECT * FROM FormSubmissions WHERE Status = 'Approved' ORDER BY id DESC");

            if (missions.length === 0) {
                logger.info(`User ${req.user.username} (ID: ${req.user.id}) retrieved 0 approved missions.`);
                return res.json([]); // No missions, send empty array
            }

            // Extract all mission IDs to fetch associated URLs efficiently
            const missionIds = missions.map(mission => mission.Id);
            const missionIdsPlaceholder = missionIds.map(() => '?').join(','); // e.g., ?,?,?

            // 2. Fetch all images for these missions
            const [images] = await db.execute(
                `SELECT submission_id, image_url FROM FormSubmissionImages WHERE submission_id IN (${missionIdsPlaceholder})`,
                missionIds
            );

            // 3. Fetch all videos for these missions
            const [videos] = await db.execute(
                `SELECT submission_id, video_url FROM FormSubmissionVideos WHERE submission_id IN (${missionIdsPlaceholder})`,
                missionIds
            );

            // 4. Fetch all documents for these missions
            const [documents] = await db.execute(
                `SELECT submission_id, document_url FROM FormSubmissionDocuments WHERE submission_id IN (${missionIdsPlaceholder})`,
                missionIds
            );

            // 5. Process the data: Attach URLs to their respective missions
            const missionsWithUrls = missions.map(mission => {
                // Initialize URL arrays
                mission.images = [];
                mission.videos = [];
                mission.documents = [];

                // Attach images
                images.forEach(img => {
                    if (img.submission_id === mission.Id) {
                        mission.images.push(img.image_url);
                    }
                });

                // Attach videos
                videos.forEach(vid => {
                    if (vid.submission_id === mission.Id) {
                        mission.videos.push(vid.video_url);
                    }
                });

                // Attach documents
                documents.forEach(doc => {
                    if (doc.submission_id === mission.Id) {
                        mission.documents.push(doc.document_url);
                    }
                });

                return mission;
            });

            logger.info(`User ${req.user.username} (ID: ${req.user.id}) retrieved ${missionsWithUrls.length} approved missions with associated URLs.`);
            res.json(missionsWithUrls); // Send the combined JSON response

        } catch (error) {
            logger.error(`MySQL Error fetching approved missions with URLs for user ${req.user.username} (ID: ${req.user.id}):`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    return router;
};