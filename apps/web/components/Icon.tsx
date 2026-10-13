// Square-cap stroke icons from the Pingie design reference.
const paths = {
  overview: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  secrets: 'M8 11V7a4 4 0 1 1 8 0v4M5 11h14v10H5zM12 15v3',
  versions: 'M12 8v4l3 3M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.4 2.6L21 8M21 3v5h-5',
  members: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  tokens: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L19 4m-3.5 3.5L18 10',
  integrate: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  audit: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  back: 'M15 6l-6 6 6 6',
  chevrons: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  check: 'M5 12l5 5 9-10',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.5 10.7a3 3 0 0 0 4.2 4.2M7.4 7.6C4.4 9.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7s-.9 1.7-2.7 3.4',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L19 4m-3.5 3.5L18 10',
  lock: 'M8 11V7a4 4 0 1 1 8 0v4M5 11h14v10H5z',
  mail: 'M3 5h18v14H3zM3 5l9 8 9-8',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5M12 17v.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M4 21h16M16 8h3a1 1 0 0 1 1 1v12M9 7h2M9 11h2M9 15h2',
} as const;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 16, strokeWidth = 1.9, className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
