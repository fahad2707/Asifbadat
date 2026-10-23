import rateLimit from 'express-rate-limit';

const jsonError = { error: 'Too many requests. Please try again later.' };

/** Railway/Vercel set X-Forwarded-For; skip limiter validation so it cannot 500 the request. */
const limiterBase = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  message: jsonError,
  validate: false as const,
};

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  ...limiterBase,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  ...limiterBase,
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  ...limiterBase,
});

export const apiGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  ...limiterBase,
});

export const onlineCheckoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  ...limiterBase,
});

export const onlineTrackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  ...limiterBase,
});
