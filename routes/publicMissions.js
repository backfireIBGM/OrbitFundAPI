import express from 'express';

export default (db, jwtConfig, logger) => {
    const router = express.Router();

    // GET: /api/approved-missions
    router.get('/approved-missions', async (req, res) => {
        try {
            const [rows] = await db.execute("SELECT * FROM FormSubmissions WHERE Status = 'Approved' ORDER BY id DESC");
            logger.info(`User ${req.user.username} (ID: ${req.user.id}) retrieved ${rows.length} approved missions.`);
            res.json(rows); // Send the JSON response with the actual data from the database.
        } catch (error) {
            logger.error(`MySQL Error fetching approved missions for user ${req.user.username} (ID: ${req.user.id}):`, error);
            res.status(500).json({ message: `Database error: ${error.message}` });
        }
    });

    return router;
};