import jwt from 'jsonwebtoken';

// This factory function allows us to inject dependencies (like jwtConfig and logger)
// into our middleware, making them reusable and testable.
export default (jwtConfig, logger) => {
  const { jwtSecret, jwtIssuer, jwtAudience } = jwtConfig;

  // Middleware to authenticate JWT token
  const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
      logger.warn('Unauthorized access attempt: No token provided.');
      return res.status(401).json({ message: 'Unauthorized: No token provided.' });
    }

    jwt.verify(token, jwtSecret, { audience: jwtAudience, issuer: jwtIssuer }, (err, user) => {
      if (err) {
        logger.warn('Forbidden access attempt: Invalid token.', { error: err.message });
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ message: 'Unauthorized: Token expired.' });
        }
        return res.status(403).json({ message: 'Forbidden: Invalid token.' });
      }
      req.user = user; // Attach user payload to the request (e.g., { id, username, email, role: 'Admin' })
      next();
    });
  };

  // Middleware to authorize admin role
  const authorizeAdmin = (req, res, next) => {
    // req.user should be populated by authenticateToken, which runs before this.
    if (!req.user || req.user.role !== 'Admin') {
      logger.warn('Forbidden access attempt: User %s (%s) does not have admin role. Role found: %s',
        req.user?.username || 'unknown', req.user?.id || 'unknown', req.user?.role || 'none');
      return res.status(403).json({ message: 'Access Denied: Requires Admin role.' });
    }
    next();
  };

  return { authenticateToken, authorizeAdmin };
};