import express from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

export default (db, config, logger) => {
  const router = express.Router();
  const b2Config = config.backblazeB2S3;

  const s3Client = new S3Client({
    region: b2Config.region,
    endpoint: b2Config.serviceUrl,
    credentials: {
      accessKeyId: b2Config.accessKeyId,
      secretAccessKey: b2Config.applicationKey,
    },
    forcePathStyle: true,
  });

  const deleteFileFromS3 = async (url) => {
    try {
      if (!url) return;
      const key = url.split(`${b2Config.bucketName}/`)[1];
      if (!key) return;
      await s3Client.send(new DeleteObjectCommand({ Bucket: b2Config.bucketName, Key: key }));
      logger.info("Deleted S3 asset: " + key);
    } catch (err) {
      logger.error("S3 Delete Failed: " + url, err);
    }
  };

  const uploadFileToS3 = async (file, folder) => {
    const fileNameInBucket = `${folder}/${uuidv4()}${path.extname(file.originalname)}`;
    const command = new PutObjectCommand({
      Bucket: b2Config.bucketName,
      Key: fileNameInBucket,
      Body: file.buffer,
      ContentType: file.mimetype,
    });
    await s3Client.send(command);
    return `${b2Config.publicFileUrlPrefix}/${b2Config.bucketName}/${fileNameInBucket}`;
  };

  router.get('/:id', async (req, res) => {
    try {
      const missionId = req.params.id;
      const userId = req.user.id;
      const [missions] = await db.execute('SELECT * FROM FormSubmissions WHERE Id = ? AND user_id = ?', [missionId, userId]);
      if (missions.length === 0) return res.status(404).json({ message: 'Mission not found' });
      const mission = missions[0];
      const [imgs, vids, docs, stones] = await Promise.all([
        db.execute('SELECT image_url FROM FormSubmissionImages WHERE submission_id = ?', [missionId]),
        db.execute('SELECT video_url FROM FormSubmissionVideos WHERE submission_id = ?', [missionId]),
        db.execute('SELECT document_url FROM FormSubmissionDocuments WHERE submission_id = ?', [missionId]),
        db.execute('SELECT milestone_name, target_amount FROM FormSubmissionMilestones WHERE submission_id = ? ORDER BY target_amount ASC', [missionId])
      ]);
      mission.images = imgs[0].map(r => r.image_url);
      mission.videos = vids[0].map(r => r.video_url);
      mission.documents = docs[0].map(r => r.document_url);
      mission.milestones = stones[0].map(m => ({ milestone_name: m.milestone_name, target_amount: m.target_amount }));
      res.json(mission);
    } catch (e) { res.status(500).json({ message: 'Internal error' }); }
  });

  router.put('/:id', (req, res, next) => {
    upload.fields([
      { name: 'images', maxCount: 10 },
      { name: 'video', maxCount: 5 },
      { name: 'documents', maxCount: 10 },
    ])(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        logger.warn("Multer validation error: " + err.code);
        return res.status(400).json({ message: "Upload error: " + err.message });
      } else if (err) {
        return res.status(500).json({ message: 'Unknown upload error' });
      }
      next();
    });
  }, async (req, res) => {
    const missionId = req.params.id;
    const userId = req.user.id;
    const connection = await db.getConnection();
    logger.info("Starting Update Sequence for Mission ID: " + missionId);
    try {
      await connection.beginTransaction();
      const { title, description, goals, type, launchDate, teamInfo, fundingGoal, budgetBreakdown, rewards, milestoneName, milestoneTarget, deleteImages, deleteVideos, deleteDocuments } = req.body;
      const updateSql = `UPDATE FormSubmissions SET title=?, description=?, goals=?, type=?, launchDate=?, teamInfo=?, fundingGoal=?, budgetBreakdown=?, rewards=? WHERE Id=? AND user_id=?`;
      const [updateResult] = await connection.execute(updateSql, [title, description, goals, type, launchDate ? new Date(launchDate) : null, teamInfo, fundingGoal, budgetBreakdown, rewards, missionId, userId]);
      if (updateResult.affectedRows === 0) throw new Error("Unauthorized access attempt");

      const deletions = [
        { json: deleteImages, table: 'FormSubmissionImages', col: 'image_url' },
        { json: deleteVideos, table: 'FormSubmissionVideos', col: 'video_url' },
        { json: deleteDocuments, table: 'FormSubmissionDocuments', col: 'document_url' }
      ];
      for (const item of deletions) {
        if (item.json) {
          const urls = JSON.parse(item.json);
          if (urls.length > 0) {
            logger.info("Step 2: Processing " + urls.length + " deletions for " + item.table);
            for (const url of urls) {
              await deleteFileFromS3(url);
              await connection.execute(`DELETE FROM ${item.table} WHERE submission_id = ? AND ${item.col} = ?`, [missionId, url]);
            }
          }
        }
      }

      const incomingFiles = req.files || {};
      const uploadTasks = [
        { files: incomingFiles['images'], folder: 'images', table: 'FormSubmissionImages', col: 'image_url' },
        { files: incomingFiles['video'], folder: 'videos', table: 'FormSubmissionVideos', col: 'video_url' },
        { files: incomingFiles['documents'], folder: 'documents', table: 'FormSubmissionDocuments', col: 'document_url' }
      ];
      for (const task of uploadTasks) {
        if (task.files && task.files.length > 0) {
          logger.info("Step 3: Uploading " + task.files.length + " new files to: " + task.folder);
          for (const file of task.files) {
            const url = await uploadFileToS3(file, task.folder);
            await connection.execute(`INSERT INTO ${task.table} (submission_id, ${task.col}) VALUES (?, ?)`, [missionId, url]);
          }
        }
      }

      logger.info("Step 4: Syncing milestones for mission ID: " + missionId);
      await connection.execute('DELETE FROM FormSubmissionMilestones WHERE submission_id = ?', [missionId]);
      const names = Array.isArray(milestoneName) ? milestoneName : [];
      const targets = Array.isArray(milestoneTarget) ? milestoneTarget : [];
      for (let i = 0; i < Math.min(names.length, targets.length); i++) {
        const n = names[i]?.trim();
        const t = parseFloat(targets[i]);
        if (n && !isNaN(t)) await connection.execute('INSERT INTO FormSubmissionMilestones (submission_id, milestone_name, target_amount) VALUES (?, ?, ?)', [missionId, n, t]);
      }

      await connection.commit();
      logger.info("Mission Update sequence COMPLETED successfully");
      res.status(200).json({ message: 'Mission updated successfully' });
    } catch (error) {
      if (connection) await connection.rollback();
      logger.error("MISSION UPDATE FAILED: " + error.message);
      res.status(500).json({ message: 'Internal server error during update' });
    } finally {
      if (connection) connection.release();
    }
  });

  return router;
};
