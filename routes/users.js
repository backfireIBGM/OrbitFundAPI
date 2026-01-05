// routes/users.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import winston from 'winston';

// Import the shared authentication middleware
import createAuthMiddleware from '../middleware/auth.js';

export default (db, jwtConfig, logger) => {
  const router = express.Router();

  const { jwtSecret, jwtIssuer, jwtAudience } = jwtConfig;

  // Instantiate the shared authentication middleware
  const { authenticateToken, authorizeAdmin } = createAuthMiddleware(jwtConfig, logger);

  // --- Helper for Generating JWT Tokens ---
  const generateJwtToken = (user) => {
    const claims = {
      id: user.Id,
      username: user.Username,
      email: user.Email,
    };

    if (user.AdminGrantedAt) {
      claims.role = 'Admin';
    }

    const expiresInMinutes = 120; // 2 hours

    return jwt.sign(claims, jwtSecret, {
      expiresIn: `${expiresInMinutes}m`,
      issuer: jwtIssuer,
      audience: jwtAudience,
    });
  };

  // --- POST /register ---
  router.post(
    '/register',
    [
      body('username')
        .notEmpty()
        .withMessage('Username is required')
        .isLength({ min: 3 })
        .withMessage('Username must be at least 3 characters long'),
      body('email')
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Invalid email format'),
      body('password')
        .notEmpty()
        .withMessage('Password is required')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, email, password } = req.body;

      try {
        const [existingUsers] = await db.query(
          'SELECT Id FROM Users WHERE Email = ? OR Username = ?',
          [email, username]
        );

        if (existingUsers.length > 0) {
          return res.status(409).json({ message: 'User with this email or username already exists.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const [result] = await db.execute(
          `INSERT INTO Users (Username, Email, PasswordHash, CreatedAt)
           VALUES (?, ?, ?, NOW())`,
          [username, email, passwordHash]
        );

        const userId = result.insertId;

        logger.info('User registered: %s', email);
        return res.status(201).json({ message: 'User registered successfully!', userId: userId });
      } catch (error) {
        logger.error('Database error during registration for email: %s', email, error);
        return res.status(500).json({ message: 'An error occurred during registration. Please try again.' });
      }
    }
  );

  // --- POST /login ---
  router.post(
    '/login',
    [
      body('email').notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email format'),
      body('password').notEmpty().withMessage('Password is required'),
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      try {
        const [users] = await db.query('SELECT * FROM Users WHERE Email = ?', [email]);
        const user = users[0];

        if (!user) {
          logger.warn('Login failed: User not found for email: %s', email);
          return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.PasswordHash);

        if (!isPasswordValid) {
          logger.warn('Login failed: Invalid password for email: %s', email);
          return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const token = generateJwtToken(user);
        logger.info('User logged in: %s', email);

        return res.status(200).json({
          token: token,
          username: user.Username,
          message: 'Login successful!',
        });
      } catch (error) {
        logger.error('Database error during login for email: %s', email, error);
        return res.status(500).json({ message: 'An error occurred during login. Please try again.' });
      }
    }
  );

  // --- GET /verifyAdmin ---
  router.get('/verifyAdmin', authenticateToken, async (req, res) => {
    const userId = req.user.id; // From the 'id' claim in the JWT

    if (!userId) {
      logger.warn('VerifyAdmin: User ID claim not found in token for an authenticated user.');
      return res.status(401).json({ message: 'User ID not found in token.' });
    }

    try {
      const [rows] = await db.query('SELECT AdminGrantedAt FROM Users WHERE Id = ?', [userId]);
      const user = rows[0];

      if (!user) {
        logger.warn('VerifyAdmin: User %s not found in DB but token was valid.', userId);
        return res.status(404).json({ message: 'User not found.' });
      }

      if (user.AdminGrantedAt) {
        logger.info(
          'VerifyAdmin: User %s is an admin (AdminGrantedAt: %s).',
          userId,
          user.AdminGrantedAt
        );
        return res.status(200).json({ isAdmin: true, grantedAt: user.AdminGrantedAt });
      } else {
        logger.info('VerifyAdmin: User %s is NOT an admin.', userId);
        return res.status(403).json({ message: 'User does not have administrative privileges.' });
      }
    } catch (error) {
      logger.error('VerifyAdmin: Database error while checking admin status for user %s.', userId, error);
      return res.status(500).json({ message: 'A database error occurred while verifying privileges.' });
    }
  });

  return router;
};
