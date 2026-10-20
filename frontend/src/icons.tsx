// Small line illustrations for the equipment, picked from the item's id and
// name, plus a few UI icons. Plain SVG, so no icon dependency.

type Kind = 'board' | 'ultrasonic' | 'climate' | 'servo' | 'infrared' | 'part';

export function kindOf(id: string, name = ''): Kind {
  const s = `${id} ${name}`.toLowerCase();
  if (/arduino|board|uno|kit/.test(s)) return 'board';
  if (/ultrasonic|hc-sr04|distance/.test(s)) return 'ultrasonic';
  if (/dht|temperature|humidity/.test(s)) return 'climate';
  if (/servo|motor/.test(s)) return 'servo';
  if (/\bir\b|infrared|obstacle/.test(s)) return 'infrared';
  return 'part';
}

export function categoryOf(id: string, name = ''): 'Boards' | 'Sensors' | 'Motors' | 'Other' {
  const k = kindOf(id, name);
  if (k === 'board') return 'Boards';
  if (k === 'servo') return 'Motors';
  if (k === 'part') return 'Other';
  return 'Sensors';
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ItemArt({ id, name, size = 56 }: { id: string; name?: string; size?: number }) {
  const kind = kindOf(id, name);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={`art art-${kind}`}>
      {kind === 'board' && (
        <g {...stroke}>
          <rect x="8" y="14" width="48" height="36" rx="4" />
          <rect x="14" y="22" width="14" height="12" rx="1.5" />
          <path d="M34 20h16M34 25h16M34 30h10" />
          <circle cx="16" cy="44" r="2" />
          <path d="M24 44h24" strokeDasharray="2 4" />
          <path d="M8 22h-4M8 30h-4" />
        </g>
      )}
      {kind === 'ultrasonic' && (
        <g {...stroke}>
          <rect x="6" y="20" width="52" height="26" rx="4" />
          <circle cx="20" cy="33" r="8" />
          <circle cx="44" cy="33" r="8" />
          <circle cx="20" cy="33" r="3" />
          <circle cx="44" cy="33" r="3" />
          <path d="M26 12c4-3 8-3 12 0M22 7c7-5 13-5 20 0" />
        </g>
      )}
      {kind === 'climate' && (
        <g {...stroke}>
          <path d="M22 38V12a6 6 0 0 1 12 0v26a10 10 0 1 1-12 0z" />
          <circle cx="28" cy="46" r="4" />
          <path d="M28 42V22" />
          <path d="M46 18c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" />
        </g>
      )}
      {kind === 'servo' && (
        <g {...stroke}>
          <rect x="10" y="22" width="40" height="24" rx="3" />
          <path d="M4 30h6M50 30h6" />
          <circle cx="24" cy="22" r="7" />
          <path d="M24 22L46 8" strokeWidth="4" />
          <circle cx="24" cy="22" r="1.5" />
          <path d="M18 54h24" />
        </g>
      )}
      {kind === 'infrared' && (
        <g {...stroke}>
          <rect x="8" y="30" width="48" height="20" rx="4" />
          <path d="M18 30v-8a4 4 0 0 1 8 0v8M38 30v-8a4 4 0 0 1 8 0v8" />
          <path d="M22 10v4M16 12l2 3M28 12l-2 3" />
          <path d="M14 40h6M44 40h6" />
        </g>
      )}
      {kind === 'part' && (
        <g {...stroke}>
          <rect x="16" y="16" width="32" height="32" rx="4" />
          <path d="M24 16V8M32 16V8M40 16V8M24 56v-8M32 56v-8M40 56v-8M16 24H8M16 32H8M16 40H8M56 24h-8M56 32h-8M56 40h-8" />
        </g>
      )}
    </svg>
  );
}

const icon = (path: JSX.Element) =>
  function Icon({ size = 18 }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke} strokeWidth={2}>
        {path}
      </svg>
    );
  };

export const ChatIcon = icon(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />);
export const CheckIcon = icon(<path d="M5 12l5 5 9-10" />);
export const ShieldIcon = icon(<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />);
export const BoxIcon = icon(<path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10" />);
export const ClockIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const SearchIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const SendIcon = icon(<path d="M4 12l16-8-6 16-2-7z" />);
export const SparkIcon = icon(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />);
export const UserIcon = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>);
