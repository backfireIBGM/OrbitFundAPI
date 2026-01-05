import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import winston from 'winston';
import cors from 'cors';
import jwt from 'jsonwebtoken';


import createUsersRouter from './routes/users.js';
import createSubmissionsRouter from './routes/submissions.js';
import createMissionsRouter from './routes/publicMissions.js';
import createUserMissionsRouter from './routes/userMissions.js';
import createApprovedMissionByIdRouter from './routes/singleMission.js';
import createApprovalRouter from './routes/approval.js';
import createAuthMiddleware from './middleware/auth.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://127.0.0.1:5500',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      ({ level, message, timestamp, stack }) =>
        `${timestamp} ${level.toUpperCase()}: ${message} ${stack ? stack : ''}`
    )
  ),
  transports: [new winston.transports.Console()],
});

let db;
try {
  db = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  logger.info('Successfully connected to the MySQL database.');
} catch (error) {
  logger.error('Failed to connect to the database:', error);
  process.exit(1);
}

const appConfig = {
  jwt: {
    jwtSecret: process.env.JWT_KEY,
    jwtIssuer: process.env.JWT_ISSUER,
    jwtAudience: process.env.JWT_AUDIENCE,
  },
  backblazeB2S3: {
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    applicationKey: process.env.B2_APPLICATION_KEY,
    serviceUrl: process.env.B2_SERVICE_URL,
    bucketName: process.env.B2_BUCKET_NAME,
    publicFileUrlPrefix: process.env.B2_PUBLIC_FILE_URL_PREFIX,
  },
  mysqlConnectionString: `mysql://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}/${process.env.DB_NAME}`,
};

if (!appConfig.jwt.jwtSecret || !appConfig.jwt.jwtIssuer || !appConfig.jwt.jwtAudience) {
  logger.error('Missing JWT configuration. Ensure JWT_KEY, JWT_ISSUER, JWT_AUDIENCE are set in .env');
  process.exit(1);
}

if (
  !appConfig.backblazeB2S3.accessKeyId ||
  !appConfig.backblazeB2S3.applicationKey ||
  !appConfig.backblazeB2S3.serviceUrl ||
  !appConfig.backblazeB2S3.bucketName ||
  !appConfig.backblazeB2S3.publicFileUrlPrefix
) {
  logger.error(
    'CRITICAL ERROR: Missing Backblaze B2 S3 configuration. Server cannot start without it.'
  );
  process.exit(1);
}

const { authenticateToken, authorizeAdmin } = createAuthMiddleware(appConfig.jwt, logger);

app.use('/api/users', createUsersRouter(db, appConfig.jwt, logger));
logger.info('Users routes mounted at /api/users.');

app.use('/api/submission', authenticateToken, createSubmissionsRouter(db, appConfig, logger));
logger.info('Submission routes mounted at /api/submission.');

app.use('/api/missions', createMissionsRouter(db, appConfig.jwt, logger));
logger.info('Public Missions routes mounted at /api/missions (publicly accessible).');

app.use('/api/approved-missions', createApprovedMissionByIdRouter(db, appConfig.jwt, logger)); // <--- Consistent mount point
logger.info('Approved Mission By ID routes mounted at /api/approved-missions (publicly accessible).'); // <--- Consistent log

app.use('/api/user-missions', authenticateToken, createUserMissionsRouter(db, logger));
logger.info('User-specific missions routes mounted at /api/user-missions (authenticated).');

app.use('/api/Approval', authenticateToken, authorizeAdmin, createApprovalRouter(db, appConfig.jwt, logger));
logger.info('Approval routes mounted at /api/Approval with Admin authorization.');


app.listen(port, () => {
  logger.info(`OrbitFund backend listening at http://localhost:${port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  if (db && typeof db.end === 'function') {
    db.end().then(() => {
      logger.info('Database pool closed.');
      process.exit(0);
    }).catch(err => {
      logger.error('Error closing database pool:', err);
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
});
