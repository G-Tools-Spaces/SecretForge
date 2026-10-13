'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@/lib/useUser';
import { api, auth, Org, Project } from '@/lib/api';
import s from './shell.module.css';

function userInitials(name: string | null, email: string) {
  const parts = (name || email).split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Dismiss a menu on outside click or Escape. */
function useDismiss<T extends HTMLElement>(active: boolean, onDismiss: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, onDismiss]);
  return ref;
}

export function Topbar({ project }: { project?: Project }) {
  const { user, logout } = useUser();
  const [accountOpen, setAccountOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const close = useCallback(() => setAccountOpen(false), []);
  const accountRef = useDismiss<HTMLDivElement>(accountOpen, close);

  useEffect(() => {
    if (user) {
      api<Org[]>('/orgs')
        .then(setOrgs)
        .catch(() => {});
    }
  }, [user]);

  if (!user) return null;

  // The org in context: the project's org on project pages, else the first.
  const contextOrg = project
    ? orgs.find((o) => o.id === project.org.id) ?? { id: project.org.id, name: project.org.name }
    : orgs[0];

  return (
    <header className={s.topbar}>
      <nav aria-label="Breadcrumb" className={s.crumbs}>
        <Link href="/projects" className={s.brand}>
          Secret<span style={{ color: 'var(--accent-soft)' }}>Forge</span>
        </Link>
        {contextOrg && (
          <>
            <span aria-hidden="true" className={s.slash}>
              /
            </span>
            <Link
              href={`/orgs/${contextOrg.id}`}
              className={s.switcher}
              style={{ textDecoration: 'none' }}
              title="Manage organization"
            >
              <span aria-hidden="true" className={s.orgMark}>
                {contextOrg.name.slice(0, 1).toUpperCase()}
              </span>
              {`${contextOrg.name}'s Org`}
            </Link>
          </>
        )}
        {!project &&
          orgs.slice(1).map((o) => (
            <Link key={o.id} href={`/orgs/${o.id}`} className={s.navLink} style={{ fontSize: 12 }}>
              {o.name}
            </Link>
          ))}
        {project && (
          <>
            <span aria-hidden="true" className={s.slash}>
              /
            </span>
            <Link href={`/projects/${project.id}`} className={s.switcher} style={{ textDecoration: 'none' }}>
              <span aria-hidden="true" className={s.orgMark}>
                {project.name.slice(0, 1).toUpperCase()}
              </span>
              {project.name}
            </Link>
          </>
        )}
      </nav>

      <div className={s.right}>
        <Link href="/projects" className={s.navLink}>
          Projects
        </Link>
        <Link href="/docs" className={s.navLink}>
          Docs
        </Link>
        <div ref={accountRef} className={s.switcherWrap}>
          <button
            type="button"
            aria-label="Account menu"
            aria-expanded={accountOpen}
            className={s.avatar}
            onClick={() => setAccountOpen((o) => !o)}
          >
            {userInitials(user.name, user.email)}
          </button>
          {accountOpen && (
            <div className={`${s.menu} ${s.menuRight}`} role="menu">
              <div style={{ padding: '8px 12px' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name || user.email}</div>
                <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                  {user.email}
                </div>
              </div>
              <div className={s.menuSep} />
              <Link
                href="/account"
                role="menuitem"
                className={s.menuItem}
                style={{ textDecoration: 'none', display: 'block', width: '100%', textAlign: 'left' }}
                onClick={close}
              >
                Account settings
              </Link>
              <button
                type="button"
                role="menuitem"
                className={s.menuItem}
                onClick={() => {
                  auth.logout();
                  logout();
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
