import express from 'express';

export default (db, logger) => {
  const router = express.Router();

  router.get('/:id', async (req, res) => {
    try {
      const missionId = req.params.id;
      const userId = req.user.id; // Populated by authenticateToken middleware

      // Query checks both ID and Ownership
      const [missions] = await db.execute(
        'SELECT * FROM FormSubmissions WHERE Id = ? AND user_id = ?',
        [missionId, userId]
      );

      if (missions.length === 0) {
        logger.info(
          `User ${userId} attempted to access unauthorized or non-existent mission: ${missionId}`
        );
        return res
          .status(404)
          .json({ message: 'Mission not found or access denied.' });
      }

      const mission = missions[0];

      // Parallel fetch for associated data
      const [images, videos, documents, milestones] = await Promise.all([
        db.execute(
          'SELECT image_url FROM FormSubmissionImages WHERE submission_id = ?',
          [missionId]
        ),
        db.execute(
          'SELECT video_url FROM FormSubmissionVideos WHERE submission_id = ?',
          [missionId]
        ),
        db.execute(
          'SELECT document_url FROM FormSubmissionDocuments WHERE submission_id = ?',
          [missionId]
        ),
        db.execute(
          'SELECT milestone_name, target_amount FROM FormSubmissionMilestones WHERE submission_id = ? ORDER BY target_amount ASC',
          [missionId]
        ),
      ]);

      mission.images = images[0].map((img) => img.image_url);
      mission.videos = videos[0].map((vid) => vid.video_url);
      mission.documents = documents[0].map((doc) => doc.document_url);
      mission.milestones = milestones[0];

      res.json(mission);
    } catch (error) {
      logger.error(`Error fetching private mission ${req.params.id}:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
};
