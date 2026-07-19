type ReefIconProps = {
  name: string;
  size?: number;
};

const paths: Record<string, React.ReactNode> = {
  dashboard: <><path d="M4 13h6V4H4v9Z"/><path d="M14 20h6v-9h-6v9Z"/><path d="M4 20h6v-3H4v3Z"/><path d="M14 7h6V4h-6v3Z"/></>,
  inventory: <><path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M3 8v8l9 5 9-5V8"/></>,
  restock: <><path d="M20 7h-9"/><path d="m16 3 4 4-4 4"/><path d="M4 17h9"/><path d="m8 21-4-4 4-4"/></>,
  reorder: <><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/><path d="m17 14 3 3-3 3"/></>,
  rotation: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
  intelligence: <><path d="M12 3a7 7 0 0 0-4 12.7V20h8v-4.3A7 7 0 0 0 12 3Z"/><path d="M9 20h6"/><path d="M9 11h6"/></>,
  menu: <><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></>,
  close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
};

export function ReefIcon({ name, size = 20 }: ReefIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.dashboard}
    </svg>
  );
}
