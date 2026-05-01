import { useCallback, useEffect, useState } from 'react';
import { Users, RefreshCw, Save, FolderOpen, ShieldCheck, User as UserIcon, ShieldOff } from 'lucide-react';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ErrorAlert from '@/components/ErrorAlert';
import { getAdminUsers, getCoolifyProjects, setUserProjects, setUserRole } from '@/api';
import type { AdminUser, CoolifyProject } from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

export default function UserManagement() {
  const { user: me }            = useAuth();
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [projects, setProjects] = useState<CoolifyProject[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [saving, setSaving]     = useState<number | null>(null);
  const [togglingRole, setTogglingRole] = useState<number | null>(null);

  // Local edits: userId → selected project uuids
  const [edits, setEdits]       = useState<Record<number, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p] = await Promise.all([getAdminUsers(), getCoolifyProjects()]);
      setUsers(u);
      setProjects(p);
      const initial: Record<number, string[]> = {};
      for (const user of u) initial[user.id] = [...user.projects];
      setEdits(initial);
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggleProject(userId: number, projectUuid: string) {
    setEdits((prev) => {
      const current = prev[userId] ?? [];
      return {
        ...prev,
        [userId]: current.includes(projectUuid)
          ? current.filter((p) => p !== projectUuid)
          : [...current, projectUuid],
      };
    });
  }

  async function save(userId: number) {
    setSaving(userId);
    try {
      await setUserProjects(userId, edits[userId] ?? []);
      // Update local users state to reflect saved projects
      setUsers((prev) =>
        prev.map((u) => u.id === userId ? { ...u, projects: edits[userId] ?? [] } : u),
      );
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setSaving(null);
    }
  }

  async function toggleRole(user: AdminUser) {
    setTogglingRole(user.id);
    const newRole = user.role === 'super_admin' ? 'user' : 'super_admin';
    try {
      await setUserRole(user.id, newRole);
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u));
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setTogglingRole(null);
    }
  }

  function isDirty(userId: number, originalProjects: string[]): boolean {
    const edited = edits[userId] ?? [];
    if (edited.length !== originalProjects.length) return true;
    const orig = new Set(originalProjects);
    return edited.some((p) => !orig.has(p));
  }

  return (
    <Layout
      crumbs={[{ label: 'Dashboard', href: '/' }, { label: 'User Management' }]}
      navRight={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2 h-8">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      }
    >
      <div className="max-w-5xl mx-auto w-full px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border">
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">User Management</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Assign Coolify projects to users
            </p>
          </div>
        </div>

        <ErrorAlert error={error} />

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        )}

        {!loading && users.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <Users className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No users have signed in yet.</p>
          </div>
        )}

        {!loading && users.map((user) => (
          <div key={user.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* User header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              {user.photo_url ? (
                <img src={user.photo_url} className="h-8 w-8 rounded-full shrink-0" alt="" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted border shrink-0">
                  <UserIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{user.name ?? user.email}</p>
                  {user.role === 'super_admin' && (
                    <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 h-4">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      Admin
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {me?.id !== user.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={() => void toggleRole(user)}
                    disabled={togglingRole === user.id}
                  >
                    {user.role === 'super_admin'
                      ? <><ShieldOff className="h-3 w-3" /> Remove admin</>
                      : <><ShieldCheck className="h-3 w-3" /> Make admin</>}
                  </Button>
                )}
                {isDirty(user.id, user.projects) && (
                  <Button
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={() => void save(user.id)}
                    disabled={saving === user.id}
                  >
                    <Save className="h-3 w-3" />
                    {saving === user.id ? 'Saving…' : 'Save'}
                  </Button>
                )}
              </div>
            </div>

            {/* Project list */}
            <div className="px-5 py-4">
              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground">No Coolify projects found.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {projects.map((project) => {
                    const assigned = (edits[user.id] ?? []).includes(project.uuid);
                    return (
                      <button
                        key={project.uuid}
                        onClick={() => toggleProject(user.id, project.uuid)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                          assigned
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-border/80',
                        )}
                      >
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        {project.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
