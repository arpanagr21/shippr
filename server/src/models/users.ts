import { prisma } from '../db';
import type { User } from '../db';

export type { User };

export async function upsertUser(
  uid:      string,
  email:    string,
  name?:    string,
  photoUrl?: string,
): Promise<User> {
  return prisma.user.upsert({
    where:  { firebaseUid: uid },
    create: { firebaseUid: uid, email, name: name ?? null, photoUrl: photoUrl ?? null },
    update: {
      email,
      name:     name     != null ? name     : undefined,
      photoUrl: photoUrl != null ? photoUrl : undefined,
    },
  });
}

export async function getUserByUid(uid: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { firebaseUid: uid } });
}

export async function getUserById(id: number): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function promoteToAdmin(uid: string): Promise<void> {
  await prisma.user.update({ where: { firebaseUid: uid }, data: { role: 'super_admin' } });
}

export async function promoteToAdminByEmail(email: string): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { email, role: { not: 'super_admin' } },
    data:  { role: 'super_admin' },
  });
  return result.count > 0;
}

export async function getAllUsers(): Promise<(User & { projects: string[] })[]> {
  const users = await prisma.user.findMany({ include: { projects: true } });
  return users.map((u) => ({ ...u, projects: u.projects.map((p) => p.projectUuid) }));
}

export async function getUserProjects(userId: number): Promise<string[]> {
  const rows = await prisma.userProject.findMany({
    where:  { userId },
    select: { projectUuid: true },
  });
  return rows.map((r) => r.projectUuid);
}

export async function setUserRole(userId: number, role: 'user' | 'super_admin'): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

export async function setUserProjects(userId: number, projectUuids: string[]): Promise<void> {
  await prisma.userProject.deleteMany({ where: { userId } });
  if (projectUuids.length > 0) {
    await prisma.userProject.createMany({
      data: projectUuids.map((projectUuid) => ({ userId, projectUuid })),
    });
  }
}
