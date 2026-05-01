import type { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { config } from '../config';
import { upsertUser, promoteToAdmin } from '../models/users';
import type { User } from '../models/users';
import { getCache } from '../cache';

const USER_CACHE_TTL = 5 * 60 * 1000;
const userCacheKey = (uid: string) => `user:${uid}`;

export async function clearUserCache(firebaseUid: string): Promise<void> {
  await getCache().del(userCacheKey(firebaseUid));
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   config.firebaseProjectId,
      clientEmail: config.firebaseClientEmail,
      privateKey:  config.firebasePrivateKey,
    }),
  });
}

export interface AuthRequest extends Request {
  user?: User;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email   = decoded.email ?? '';

    if (config.allowedEmailDomain && !email.endsWith(`@${config.allowedEmailDomain}`)) {
      return res.status(403).json({ error: `Access restricted to @${config.allowedEmailDomain} accounts` });
    }

    const c = getCache();
    let user = await c.get<User>(userCacheKey(decoded.uid));

    if (!user) {
      user = await upsertUser(decoded.uid, email, decoded.name, decoded.picture);

      if (config.superAdminEmail && user.role === 'user' && email === config.superAdminEmail) {
        await promoteToAdmin(decoded.uid);
        user = { ...user, role: 'super_admin' };
      }

      await c.set(userCacheKey(decoded.uid), user, USER_CACHE_TTL);
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
