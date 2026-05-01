import { prisma } from './db';
import { coolify } from './coolify/client';

let lastSyncAt    = 0;
let syncInProgress = false;

export async function syncRegistry(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  const now = new Date().toISOString();

  try {
    const [projects, apps, services] = await Promise.all([
      coolify.getProjects(),
      coolify.getApplications(),
      coolify.getServices(),
    ]);

    // ── Projects & environments ──────────────────────────────
    const projectUuids = projects.map((p) => p.uuid);
    // Map from Coolify's numeric environment id → { uuid, name } for resolving app/service env UUIDs
    const envIdToInfo = new Map<number, { uuid: string; name: string }>();

    for (const p of projects) {
      await prisma.registryProject.upsert({
        where:  { uuid: p.uuid },
        create: { uuid: p.uuid, name: p.name, description: p.description ?? null, syncedAt: now, deletedAt: null },
        update: { name: p.name, description: p.description ?? null, syncedAt: now, deletedAt: null },
      });

      const envUuids = p.environments.map((e) => e.uuid);
      for (const e of p.environments) {
        if (e.id != null) envIdToInfo.set(e.id, { uuid: e.uuid, name: e.name });
        await prisma.registryEnvironment.upsert({
          where:  { uuid: e.uuid },
          create: { uuid: e.uuid, name: e.name, projectUuid: p.uuid, syncedAt: now, deletedAt: null },
          update: { name: e.name, projectUuid: p.uuid, syncedAt: now, deletedAt: null },
        });
      }

      // Soft-delete environments no longer in this project
      await prisma.registryEnvironment.updateMany({
        where: {
          projectUuid: p.uuid,
          deletedAt:   null,
          ...(envUuids.length > 0 ? { uuid: { notIn: envUuids } } : {}),
        },
        data: { deletedAt: now },
      });
    }

    // Soft-delete projects no longer returned by Coolify
    await prisma.registryProject.updateMany({
      where: {
        deletedAt: null,
        ...(projectUuids.length > 0 ? { uuid: { notIn: projectUuids } } : {}),
      },
      data: { deletedAt: now },
    });

    // ── Applications ─────────────────────────────────────────
    const appUuids   = apps.map((a) => a.uuid);
    const appUpdates = await Promise.all(
      apps.map(async (app) => {
        let latestDeploymentUuid:      string | null = null;
        let latestDeploymentStatus:    string | null = null;
        let latestDeploymentUpdatedAt: string | null = null;

        if (app.isDockerCompose) {
          try {
            const deps = await coolify.getApplicationDeployments(app.uuid);
            if (deps[0]) {
              latestDeploymentUuid      = deps[0].uuid;
              latestDeploymentStatus    = deps[0].status;
              latestDeploymentUpdatedAt = deps[0].updatedAt;
            }
          } catch { /* ignore per-app failures */ }
        }

        return { app, latestDeploymentUuid, latestDeploymentStatus, latestDeploymentUpdatedAt };
      }),
    );

    for (const { app, latestDeploymentUuid, latestDeploymentStatus, latestDeploymentUpdatedAt } of appUpdates) {
      const data = {
        name:                      app.name,
        status:                    app.status,
        fqdn:                      app.fqdn             ?? null,
        buildPack:                 app.buildPack         ?? null,
        dockerComposeRaw:          app.dockerComposeRaw  ?? null,
        dockerCompose:             app.dockerCompose      ?? null,
        environmentUuid:           (app.environmentId != null ? envIdToInfo.get(app.environmentId)?.uuid : undefined) ?? app.environmentUuid ?? null,
        environmentName:           (app.environmentId != null ? envIdToInfo.get(app.environmentId)?.name : undefined) ?? app.environmentName ?? null,
        latestDeploymentUuid,
        latestDeploymentStatus,
        latestDeploymentUpdatedAt,
        syncedAt:                  now,
        deletedAt:                 null,
        coolifyCreatedAt:          app.createdAt,
        coolifyUpdatedAt:          app.updatedAt,
      };
      await prisma.registryApplication.upsert({
        where:  { uuid: app.uuid },
        create: { uuid: app.uuid, ...data },
        update: data,
      });
    }

    await prisma.registryApplication.updateMany({
      where: {
        deletedAt: null,
        ...(appUuids.length > 0 ? { uuid: { notIn: appUuids } } : {}),
      },
      data: { deletedAt: now },
    });

    // ── Services ─────────────────────────────────────────────
    const serviceUuids = services.map((s) => s.uuid);

    for (const svc of services) {
      const data = {
        name:             svc.name,
        status:           svc.status,
        dockerComposeRaw: svc.dockerComposeRaw ?? null,
        environmentUuid:  svc.environmentUuid  ?? null,
        environmentName:  svc.environmentName  ?? null,
        syncedAt:         now,
        deletedAt:        null,
        coolifyCreatedAt: svc.createdAt,
        coolifyUpdatedAt: svc.updatedAt,
      };
      await prisma.registryService.upsert({
        where:  { uuid: svc.uuid },
        create: { uuid: svc.uuid, ...data },
        update: data,
      });
    }

    await prisma.registryService.updateMany({
      where: {
        deletedAt: null,
        ...(serviceUuids.length > 0 ? { uuid: { notIn: serviceUuids } } : {}),
      },
      data: { deletedAt: now },
    });

    lastSyncAt = Date.now();
    console.log(`[sync] Registry synced at ${now}`);
  } catch (err) {
    console.error('[sync] Registry sync failed:', err);
  } finally {
    syncInProgress = false;
  }
}

export function getLastSyncAt(): number { return lastSyncAt; }

export function maybeBackgroundSync(): void {
  if (Date.now() - lastSyncAt > 10 * 60 * 1000) {
    lastSyncAt = Date.now();
    syncRegistry().catch(() => {});
  }
}
