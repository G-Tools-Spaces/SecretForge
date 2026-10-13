'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useUser } from '@/lib/useUser';
import { auth, Project } from '@/lib/api';
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
  const close = useCallback(() => setAccountOpen(false), []);
  const accountRef = useDismiss<HTMLDivElement>(accountOpen, close);

  if (!user) return null;

  return (
    <header className={s.topbar}>
      <nav aria-label="Breadcrumb" className={s.crumbs}>
        <Link href="/projects" className={s.brand}>
          <span aria-hidden="true" className={s.brandMark}>
            S
          </span>
          SecretForge
        </Link>
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
