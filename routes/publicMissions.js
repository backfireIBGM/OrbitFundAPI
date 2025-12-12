import express from 'express';

export default (db, jwtConfig, logger) => {
    const router = express.Router();

    router.get('/approved-missions', async (req, res) => {
        try {
            const { maxMissions, excludeId } = req.query;

            const sqlWhereConditions = ["Status = 'Approved'"]; // Array to build WHERE clauses
            const sqlParams = []; // Array to collect ALL SQL parameters in correct order

            let limitClause = ''; // Will be 'LIMIT ?' or ''

            // 1. Handle excludeId (part of WHERE clause)
            if (excludeId && !isNaN(parseInt(excludeId))) {
                const idToExclude = parseInt(excludeId);
                if (idToExclude > 0) {
                    sqlWhereConditions.push('Id != ?');
                    sqlParams.push(String(idToExclude)); // Add excludeId parameter
                }
            }

            // 2. Build the WHERE clause
            const whereClause = sqlWhereConditions.length > 0 ? `WHERE ${sqlWhereConditions.join(' AND ')}` : '';

            // 3. Handle maxMissions (LIMIT clause, parameter comes LAST)
            if (maxMissions && !isNaN(parseInt(maxMissions))) {
                const limit = parseInt(maxMissions);
                if (limit > 0) {
                    limitClause = 'LIMIT ?';
                    sqlParams.push(String(limit)); // Add limit parameter, which must come after WHERE params
                }
            }

            // Construct the full SQL query string
            const mainMissionsSqlQuery = `SELECT * FROM FormSubmissions ${whereClause} ORDER BY id DESC ${limitClause}`;

            // --- Diagnostic Logging ---
            logger.info(
                `[publicMissions] Executing main mission SQL: "${mainMissionsSqlQuery}" with params: ${JSON.stringify(sqlParams)}`
            );
            // --- End Diagnostic Logging ---

            // 1. Fetch main mission data
            const [missions] = await db.execute(
                mainMissionsSqlQuery,
                sqlParams // Pass the combined parameters array
            );

            if (missions.length === 0) {
                logger.info(`Retrieved 0 approved missions.`);
                return res.json([]); // No missions, send empty array
            }

            const missionIds = missions.map(mission => mission.Id);

            if (missionIds.length === 0) {
                logger.warn(
                    '[publicMissions] No valid mission IDs found for approved missions despite initial fetch, returning empty associated data.'
                );
                return res.json(
                    missions.map(mission => ({
                        ...mission,
                        images: [],
                        videos: [],
                        documents: [],
                        milestones: [],
                    }))
                );
            }

            const missionIdsPlaceholder = missionIds.map(() => '?').join(','); // e.g., ?,?,?

            // All subsequent queries use missionIds directly, which is correct
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

            const missionsWithAllData = missions.map(mission => {
                mission.images = [];
                mission.videos = [];
                mission.documents = [];
                mission.milestones = [];

                images.forEach(img => {
                    if (img.submission_id === mission.Id) {
                        mission.images.push(img.image_url);
                    }
                });
                videos.forEach(vid => {
                    if (vid.submission_id === mission.Id) {
                        mission.videos.push(vid.video_url);
                    }
                });
                documents.forEach(doc => {
                    if (doc.submission_id === mission.Id) {
                        mission.documents.push(doc.document_url);
                    }
                });
                milestones.forEach(mstone => {
                    if (mstone.submission_id === mission.Id) {
                        mission.milestones.push({
                            milestone_name: mstone.milestone_name,
                            target_amount: mstone.target_amount,
                        });
                    }
                });
                return mission;
            });
            logger.info(
                `Retrieved ${missionsWithAllData.length} approved missions with associated data.`
            );
            res.json(missionsWithAllData);
        } catch (error) {
            logger.error(
                `MySQL Error fetching approved missions with all associated data:`,
                error
            );
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    return router;
};