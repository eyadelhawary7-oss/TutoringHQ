/**
 * CenterHQ Design System Tokens - TypeScript mirror
 * Use ONLY when CSS variables are inaccessible: Recharts, canvas, Three.js etc.
 * Source of truth is always globals.css @theme - keep in sync manually.
 */

export const colors = {
  brand: {
    50:  '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    300: '#5eead4',
    400: '#2dd4bf',
    500: '#0D9488',
    600: '#0f766e',
    700: '#115e59',
    800: '#134e4a',
    900: '#042f2e',
  },
  navy: {
    50:  '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#080f1a',
  },
  gold: {
    50:  '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#F59E0B',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  surface: {
    0: '#080f1a',
    1: '#0f172a',
    2: '#1e293b',
    3: '#334155',
    4: '#475569',
  },
  state: {
    success:      '#10b981',
    successMuted: '#064e3b',
    warning:      '#F59E0B',
    warningMuted: '#451a03',
    danger:       '#ef4444',
    dangerMuted:  '#450a0a',
    info:         '#3b82f6',
    infoMuted:    '#1e3a5f',
  },
  text: {
    primary:   '#f8fafc',
    secondary: '#94a3b8',
    tertiary:  '#64748b',
    disabled:  '#475569',
    brand:     '#0D9488',
    amber:     '#F59E0B',
  },
} as const;

export const duration = {
  instant: 80,
  fast:    150,
  normal:  220,
  slow:    350,
  slower:  500,
  lazy:    700,
} as const;

export const radius = {
  xs:      2,
  sm:      4,
  md:      8,
  lg:      12,
  xl:      16,
  '2xl':   20,
  '3xl':   24,
  card:    16,
  panel:   12,
  button:  8,
  modal:   20,
  full:    9999,
} as const;

/** Use for Recharts and canvas - not for CSS */
export const chartColors = {
  primary:   colors.brand[500],
  secondary: colors.gold[500],
  success:   colors.state.success,
  danger:    colors.state.danger,
  muted:     colors.navy[600],
  grid:      colors.navy[700],
  tick:      colors.navy[500],
  tooltip: {
    bg:     colors.surface[2],
    border: colors.navy[700],
    text:   colors.text.primary,
  },
} as const;
