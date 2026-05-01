import { Router } from 'express';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/auth/me — returns only what the client needs (no firebase_uid)
router.get('/me', (req: AuthRequest, res) => {
  const { id, email, name, photoUrl, role } = req.user!;
  res.json({ id, email, name, photo_url: photoUrl, role });
});

export default router;
