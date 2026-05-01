import { Router } from 'express';
import { getAllUsers, getUserById, setUserProjects, setUserRole } from '../models/users';
import { requireAdmin, clearUserCache } from '../middleware/auth';
import { prisma } from '../db';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/admin/users
router.get('/users', requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const users = await getAllUsers();
    res.json(users.map(({ id, email, name, photoUrl, role, projects }) => ({
      id, email, name, photo_url: photoUrl, role, projects,
    })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', requireAdmin, async (req: AuthRequest, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  if (userId === req.user!.id) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { role } = req.body as { role?: unknown };
  if (role !== 'user' && role !== 'super_admin') {
    return res.status(400).json({ error: 'role must be "user" or "super_admin"' });
  }

  try {
    await setUserRole(userId, role);
    await clearUserCache(user.firebaseUid);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// PUT /api/admin/users/:id/projects
router.put('/users/:id/projects', requireAdmin, async (req: AuthRequest, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { projects } = req.body as { projects?: unknown };
  if (!Array.isArray(projects) || !projects.every((p) => typeof p === 'string')) {
    return res.status(400).json({ error: 'projects must be an array of strings' });
  }

  const projectUuids = projects as string[];

  if (projectUuids.length > 0) {
    const found = await prisma.registryProject.findMany({
      where:  { uuid: { in: projectUuids }, deletedAt: null },
      select: { uuid: true },
    });
    const foundUuids  = new Set(found.map((p) => p.uuid));
    const invalid     = projectUuids.filter((p) => !foundUuids.has(p));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Unknown project UUIDs: ${invalid.join(', ')}` });
    }
  }

  try {
    await setUserProjects(userId, projectUuids);
    await clearUserCache(user.firebaseUid);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to update projects' });
  }
});

export default router;
