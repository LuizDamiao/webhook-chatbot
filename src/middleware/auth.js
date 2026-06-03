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

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
