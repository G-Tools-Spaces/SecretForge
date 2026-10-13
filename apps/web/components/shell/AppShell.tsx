'use client';

import { Project } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import s from './shell.module.css';

/** Org-level shell: topbar only, wide main column. */
export function OrgShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.app}>
      <Topbar />
      <main className={s.mainWide}>{children}</main>
    </div>
  );
}

/** Project-level shell: topbar + sidebar with project nav. */
export function ProjectShell({ project, children }: { project: Project; children: React.ReactNode }) {
  return (
    <div className={s.app}>
      <Topbar project={project} />
      <div className={s.body}>
        <aside className={s.sidebarCol}>
          <Sidebar project={project} />
        </aside>
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}
