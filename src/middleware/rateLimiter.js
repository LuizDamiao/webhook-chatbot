import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // 5 tentativas por IP
  message: { error: 'Muitas tentativas. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
