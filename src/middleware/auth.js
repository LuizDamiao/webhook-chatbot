import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Authentication middleware for webhook
 * Validates Bearer token from Authorization header
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  const expectedToken = process.env.WEBHOOK_TOKEN;

  if (!token || !expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expectedToken);

  if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

export function authJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}
