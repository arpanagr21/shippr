import { prisma } from '../db';
import type { User, RegistryApplication, RegistryService, RegistryProject } from '../db';
import { getUserProjects } from './users';

export type RegistryApp = RegistryApplication;
export type { RegistryService, RegistryProject };

// ── Environments ─────────────────────────────────────────────────────────────

export async function getEnvUuidsForProjects(projectUuids: string[]): Promise<Set<string>> {
  if (projectUuids.length === 0) return new Set();
  const envs = await prisma.registryEnvironment.findMany({
    where:  { projectUuid: { in: projectUuids }, deletedAt: null },
    select: { uuid: true },
  });
  return new Set(envs.map((e) => e.uuid));
}

export async function getAllowedEnvUuids(user: User): Promise<Set<string> | 'all'> {
  if (user.role === 'super_admin') return 'all';
  const projectUuids = await getUserProjects(user.id);
  return getEnvUuidsForProjects(projectUuids);
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function findProjects(uuids?: string[]): Promise<RegistryProject[]> {
  return prisma.registryProject.findMany({
    where: uuids !== undefined
      ? { uuid: { in: uuids }, deletedAt: null }
      : { deletedAt: null },
  });
}

export async function findProjectsForUser(user: User): Promise<RegistryProject[]> {
  if (user.role === 'super_admin') return findProjects();
  const projectUuids = await getUserProjects(user.id);
  return findProjects(projectUuids);
}

// ── Applications ─────────────────────────────────────────────────────────────

export async function findApplications(
  allowedEnvUuids: Set<string> | 'all',
): Promise<RegistryApp[]> {
  return prisma.registryApplication.findMany({
    where: {
      deletedAt: null,
      ...(allowedEnvUuids !== 'all' && {
        environmentUuid: allowedEnvUuids.size > 0 ? { in: [...allowedEnvUuids] } : undefined,
      }),
    },
  });
}

export async function findApplicationByUuid(uuid: string): Promise<RegistryApp | null> {
  return prisma.registryApplication.findUnique({ where: { uuid } });
}

export async function canAccessApplication(user: User, appUuid: string): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  const app = await findApplicationByUuid(appUuid);
  if (!app?.environmentUuid) return false;
  const projectUuids = await getUserProjects(user.id);
  const envUuids = await getEnvUuidsForProjects(projectUuids);
  return envUuids.has(app.environmentUuid);
}

// ── Services ─────────────────────────────────────────────────────────────────

export async function findServices(
  allowedEnvUuids: Set<string> | 'all',
): Promise<RegistryService[]> {
  return prisma.registryService.findMany({
    where: {
      deletedAt: null,
      ...(allowedEnvUuids !== 'all' && {
        environmentUuid: allowedEnvUuids.size > 0 ? { in: [...allowedEnvUuids] } : undefined,
      }),
    },
  });
}

export async function findServiceByUuid(uuid: string): Promise<RegistryService | null> {
  return prisma.registryService.findUnique({ where: { uuid } });
}

export async function canAccessService(user: User, serviceUuid: string): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  const svc = await findServiceByUuid(serviceUuid);
  if (!svc?.environmentUuid) return false;
  const projectUuids = await getUserProjects(user.id);
  const envUuids = await getEnvUuidsForProjects(projectUuids);
  return envUuids.has(svc.environmentUuid);
}

export async function isRegistryPopulated(): Promise<boolean> {
  const count = await prisma.registryProject.count({ where: { deletedAt: null } });
  return count > 0;
}
