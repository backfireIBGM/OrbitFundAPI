import express from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

export default (db, config, logger) => {
  const router = express.Router();

  const b2Config = config.backblazeB2S3;
  const mysqlConnectionString = config.mysqlConnectionString;

  // --- S3 client is always initialized now, as server.js guarantees config ---
  const s3Client = new S3Client({
    region: b2Config.Region,
    endpoint: b2Config.serviceUrl,
    credentials: {
      accessKeyId: b2Config.accessKeyId,
      secretAccessKey: b2Config.applicationKey,
    },
    forcePathStyle: true,
  });
  logger.info('S3 Client initialized within SubmissionController.');

  const uploadFileToS3 = async (file, folder) => {
    if (!file || file.size === 0 || !file.originalname) {
      logger.warn(`Skipping empty or null-named file in folder: ${folder}`);
      return null;
    }

    const fileNameInBucket = `${folder}/${uuidv4()}${path.extname(file.originalname)}`;

    try {
      const command = new PutObjectCommand({
        Bucket: b2Config.bucketName,
        Key: fileNameInBucket,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read', // Ensure your B2 bucket policies allow this
      });

      await s3Client.send(command);

      const fileUrl = `${b2Config.publicFileUrlPrefix}/${b2Config.bucketName}/${fileNameInBucket}`;
      logger.info(`Successfully uploaded ${file.originalname} to Backblaze B2 S3: ${fileUrl}`);
      return fileUrl;
    } catch (s3Ex) {
      logger.error(
        s3Ex,
        "Backblaze B2 S3 Upload Failed for '%s'. Message: %s",
        file.originalname,
        s3Ex.message
      );
      throw s3Ex;
    }
  };

  router.post(
    '/',
    upload.fields([
      { name: 'images', maxCount: 10 },
      { name: 'video', maxCount: 5 },
      { name: 'documents', maxCount: 10 },
    ]),
    async (req, res) => {
      logger.info('--- Incoming Submission Data ---');
      const formData = req.body;
      for (const key in formData) {
        logger.info(`  ${key}: ${formData[key] || 'NULL'}`);
      }
      const incomingFiles = req.files || {};

      logger.info(
        `Image Count: ${incomingFiles['images'] ? incomingFiles['images'].length : 0}`
      );
      logger.info(
        `Video Count: ${incomingFiles['video'] ? incomingFiles['video'].length : 0}`
      );
      logger.info(
        `Document Count: ${incomingFiles['documents'] ? incomingFiles['documents'].length : 0}`
      );
      logger.info('--- End Incoming Submission Data ---');

      const {
        title,
        description,
        goals,
        type,
        launchDate,
        teamInfo,
        fundingGoal,
        duration,
        budgetBreakdown,
        rewards,
      } = formData;

      const images = incomingFiles['images'] || [];
      const video = incomingFiles['video'] || [];
      const documents = incomingFiles['documents'] || [];

      const savedImageUrls = [];
      const savedVideoUrls = [];
      const savedDocUrls = [];
      let fileOperationsSucceeded = true; // Assume success, will be set to false on any upload error

      try {
        // --- S3 Uploads are now always attempted ---
        // Upload Mission Images
        if (images.length > 0) {
          for (const imageFile of images) {
            try {
              const url = await uploadFileToS3(imageFile, 'images');
              if (url) savedImageUrls.push(url);
            } catch (error) {
              fileOperationsSucceeded = false;
              logger.error('Error uploading image file: %s', imageFile.originalname, error);
            }
          }
        }

        // Upload Mission Videos
        if (video.length > 0) {
          for (const videoFile of video) {
            try {
              const url = await uploadFileToS3(videoFile, 'videos');
              if (url) savedVideoUrls.push(url);
            } catch (error) {
              fileOperationsSucceeded = false;
              logger.error('Error uploading video file: %s', videoFile.originalname, error);
            }
          }
        } else {
          logger.info('No video files were provided.');
        }

        // Upload Technical Documents
        if (documents.length > 0) {
          for (const docFile of documents) {
            try {
              const url = await uploadFileToS3(docFile, 'documents');
              if (url) savedDocUrls.push(url);
            } catch (error) {
              fileOperationsSucceeded = false;
              logger.error('Error uploading document file: %s', docFile.originalname, error);
            }
          }
        }
        // --- End S3 Uploads ---

        if (!mysqlConnectionString) {
          logger.error("MySQL Connection string is not set in configuration.");
          return res.status(500).json({ message: 'Server configuration error: Database connection string is missing.' });
        }
        logger.info("MySQL Connection string successfully loaded for submission.");

        const sqlString = `
          INSERT INTO FormSubmissions (
              title, description, goals, type, launchDate, teamInfo, fundingGoal, duration, budgetBreakdown, rewards
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
        const [result] = await db.execute(sqlString, [
          title || null,
          description || null,
          goals || null,
          type || null,
          launchDate ? new Date(launchDate) : null,
          teamInfo || null,
          fundingGoal || null,
          duration || null,
          budgetBreakdown || null,
          rewards || null,
        ]);

        const submissionId = result.insertId;

        // Insert into FormSubmissionImages
        if (savedImageUrls.length > 0) {
          const imageInsertSql =
            'INSERT INTO FormSubmissionImages (submission_id, image_url) VALUES (?, ?)';
          for (const imageUrl of savedImageUrls) {
            await db.execute(imageInsertSql, [submissionId, imageUrl]);
          }
          logger.info(
            'Successfully stored %d image URLs for submissionId: %s',
            savedImageUrls.length,
            submissionId
          );
        }

        // Insert into FormSubmissionVideos
        if (savedVideoUrls.length > 0) {
          const videoInsertSql =
            'INSERT INTO FormSubmissionVideos (submission_id, video_url) VALUES (?, ?)';
          for (const videoUrl of savedVideoUrls) {
            await db.execute(videoInsertSql, [submissionId, videoUrl]);
          }
          logger.info(
            'Successfully stored %d video URLs for submissionId: %s',
            savedVideoUrls.length,
            submissionId
          );
        }

        // Insert into FormSubmissionDocuments
        if (savedDocUrls.length > 0) {
          const documentInsertSql =
            'INSERT INTO FormSubmissionDocuments (submission_id, document_url) VALUES (?, ?)';
          for (const docUrl of savedDocUrls) {
            await db.execute(documentInsertSql, [submissionId, docUrl]);
          }
          logger.info(
            'Successfully stored %d document URLs for submissionId: %s',
            savedDocUrls.length,
            submissionId
          );
        }

        logger.info(
          "Successfully stored core mission data for: '%s'. InsertId: %s",
          title || 'N/A',
          result.insertId
        );

        let responseMessage = `Mission '${
          title || 'N/A'
        }' data submitted successfully!`;
        if (fileOperationsSucceeded) {
          responseMessage += ` All associated files uploaded to Backblaze B2 S3.`;
        } else {
          responseMessage += ` WARNING: Some or all files failed to upload to Backblaze B2 S3.`;
        }


        return res.status(200).json({
          message: responseMessage,
          imageUrls: savedImageUrls,
          videoUrls: savedVideoUrls,
          docUrls: savedDocUrls,
        });
      } catch (error) {
        logger.error(
          error,
          'General Error during submission processing (DB or S3 operation): %s',
          error.message
        );
        return res.status(500).json({
          message: `An internal error occurred processing your submission: ${error.message}. Database insertion might have failed.`,
          imageUrls: savedImageUrls,
          videoUrls: savedVideoUrls,
          docUrls: savedDocUrls,
        });
      }
    }
  );

  return router;
};