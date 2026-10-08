import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  /** Set when authenticated as admin (JWT role === 'admin'). */
  userRole?: string;
}

/**
 * Extract a bearer token from the Authorization header. Robust against:
 * - Duplicate Authorization headers (joined by Node as "Bearer a, Bearer b")
 * - Stray commas / whitespace
 * - Missing "Bearer " prefix (some clients send just the JWT)
 */
function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return null;
  // If duplicated, Node concatenates with ", " — take just the first credential.
  const first = raw.split(',')[0].trim();
  if (!first) return null;
  // "Bearer eyJ..." → "eyJ..."
  const parts = first.split(/\s+/);
  let token = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
  token = token.trim().replace(/^,+|,+$/g, '');
  return token || null;
}

export const authenticateUser = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; phone: string };
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const authenticateAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { adminId: string; role: string };

    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.userId = decoded.adminId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/** If a valid admin JWT is present, sets userRole; otherwise continues as guest (no 401). */
export const optionalAuthenticateAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { adminId: string; role: string };
    if (decoded.adminId && String(decoded.role || '').toLowerCase() === 'admin') {
      req.userId = decoded.adminId;
      req.userRole = 'admin';
    }
    next();
  } catch {
    next();
  }
};

/**
 * If a valid storefront User JWT is present, sets userId; otherwise continues
 * (no 401). Invalid/expired tokens are treated as unauthenticated.
 * Does not override an already-authenticated admin.
 */
export const optionalAuthenticateUser = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole === 'admin') return next();
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId?: unknown };
    if (typeof decoded.userId === 'string' && decoded.userId.trim()) {
      req.userId = decoded.userId.trim();
    }
    next();
  } catch {
    next();
  }
};


