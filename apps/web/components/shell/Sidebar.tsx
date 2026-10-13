'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, IconName } from '@/components/Icon';
import { Project } from '@/lib/api';
import s from './shell.module.css';

interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  segment: string; // '' = project root
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Project',
    items: [
      { key: 'overview', label: 'Overview', icon: 'overview', segment: '' },
      { key: 'secrets', label: 'Secrets', icon: 'secrets', segment: 'secrets' },
      { key: 'versions', label: 'Versions', icon: 'versions', segment: 'versions' },
    ],
  },
  {
    label: 'Access',
    items: [
      { key: 'members', label: 'Members', icon: 'members', segment: 'members' },
      { key: 'tokens', label: 'Tokens', icon: 'tokens', segment: 'tokens' },
    ],
  },
  {
    label: 'Integrate',
    items: [{ key: 'integrate', label: 'Integrate', icon: 'integrate', segment: 'integrate' }],
  },
  {
    label: 'Manage',
    items: [
      { key: 'audit', label: 'Audit log', icon: 'audit', segment: 'audit' },
      { key: 'settings', label: 'Settings', icon: 'settings', segment: 'settings' },
    ],
  },
];

export function Sidebar({ project }: { project: Project }) {
  const pathname = usePathname();
  const base = `/projects/${project.id}`;

  return (
    <nav aria-label="Project navigation" className={s.sidebar}>
      <Link href="/projects" className={s.back}>
        <Icon name="back" size={14} strokeWidth={2.2} />
        All projects
      </Link>

      <div className={s.projectCard}>
        <span aria-hidden="true" className={s.projectMark}>
          {project.name.slice(0, 2).toUpperCase()}
        </span>
        <span className={s.projectMeta}>
          <span className={s.projectName}>{project.name}</span>
          <span className={s.projectSub}>
            {project.yourRole && <span className="badge badge-accent">{project.yourRole}</span>}
            <span className={s.projectId}>{project.org.name}</span>
          </span>
        </span>
      </div>

      {NAV.map((group) => (
        <div key={group.label} className={s.group}>
          <div className={s.groupLabel}>{group.label}</div>
          {group.items.map((item) => {
            const href = item.segment ? `${base}/${item.segment}` : base;
            const active = item.segment ? pathname.startsWith(href) : pathname === base;
            return (
              <Link
                key={item.key}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`${s.item} ${active ? s.itemActive : ''}`}
              >
                <Icon name={item.icon} />
                <span className={s.itemLabel}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
