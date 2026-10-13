'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/lib/useUser';
import { auth } from '@/lib/api';

/**
 * App shell matching the wireframe: top bar (logo, org/project breadcrumb,
 * search, avatar) + grouped sidebar navigation.
 */
export function AppShell({
  children,
  breadcrumb,
  sidebar,
}: {
  children: React.ReactNode;
  breadcrumb?: React.ReactNode;
  sidebar?: React.ReactNode;
}) {
  const { user, logout } = useUser();
  const router = useRouter();

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--bd)',
          position: 'sticky',
          top: 0,
          background: 'var(--bg)',
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: 'var(--ac)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <i className="ti ti-lock" style={{ fontSize: 14 }} />
          </div>
          <span style={{ fontWeight: 500, fontSize: 14 }}>SecretForge</span>
          {breadcrumb}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--mu)' }}>
          <span
            className="badge"
            style={{ cursor: 'pointer' }}
            onClick={() => router.push('/projects')}
          >
            <i className="ti ti-layout-grid" style={{ marginRight: 4 }} /> Projects
          </span>
          <div
            title={user?.email}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--ac-25)',
              color: 'var(--al)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            onClick={() => {
              auth.logout();
              logout();
            }}
          >
            {initials}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        {sidebar && (
          <div
            style={{
              width: 190,
              flex: 'none',
              borderRight: '1px solid var(--bd)',
              padding: '12px 10px',
              minHeight: 'calc(100vh - 46px)',
            }}
          >
            {sidebar}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

/** Project sidebar nav (wireframe: PROJECT / ACCESS / INTEGRATE / MANAGE groups). */
export function ProjectSidebar({ projectId, active }: { projectId: string; active: string }) {
  const router = useRouter();

  const items: Array<{ group: string; entries: Array<{ key: string; label: string; icon: string; path: string }> }> = [
    {
      group: 'PROJECT',
      entries: [
        { key: 'overview', label: 'Overview', icon: 'ti-layout-dashboard', path: `/projects/${projectId}` },
        { key: 'secrets', label: 'Secrets', icon: 'ti-key', path: `/projects/${projectId}/secrets` },
        { key: 'versions', label: 'Versions', icon: 'ti-history', path: `/projects/${projectId}/versions` },
      ],
    },
    {
      group: 'ACCESS',
      entries: [
        { key: 'members', label: 'Members', icon: 'ti-users', path: `/projects/${projectId}/members` },
        { key: 'tokens', label: 'Service tokens', icon: 'ti-id-badge', path: `/projects/${projectId}/tokens` },
      ],
    },
    {
      group: 'INTEGRATE',
      entries: [
        { key: 'integrate', label: 'CLI and SDK', icon: 'ti-terminal-2', path: `/projects/${projectId}/integrate` },
      ],
    },
    {
      group: 'MANAGE',
      entries: [
        { key: 'audit', label: 'Audit log', icon: 'ti-clipboard-list', path: `/projects/${projectId}/audit` },
        { key: 'settings', label: 'Project settings', icon: 'ti-adjustments', path: `/projects/${projectId}/settings` },
      ],
    },
  ];

  return (
    <>
      <div
        className="nav-item"
        onClick={() => router.push('/projects')}
        style={{ marginBottom: 4 }}
      >
        <i className="ti ti-arrow-left" /> All projects
      </div>
      {items.map((section) => (
        <div key={section.group}>
          <div className="nav-section">{section.group}</div>
          {section.entries.map((e) => (
            <div
              key={e.key}
              className={`nav-item ${active === e.key ? 'active' : ''}`}
              onClick={() => router.push(e.path)}
            >
              <i className={`ti ${e.icon}`} />
              {e.label}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
