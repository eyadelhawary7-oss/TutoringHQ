export const CHART_COLORS = {
  teal: '#0D9488',
  tealLight: '#14B8A6',
  tealDim: '#0D948820',
  amber: '#F59E0B',
  amberDim: '#F59E0B20',
  red: '#EF4444',
  redDim: '#EF444420',
  slate: '#64748B',
  slateDim: '#64748B20',
  navy: '#1E293B',
  purple: '#8B5CF6',
  purpleDim: '#8B5CF620',
  green: '#10B981',
  greenDim: '#10B98120',
  blue: '#3B82F6',
  blueDim: '#3B82F620',
} as const;

export const CHART_STYLE = {
  /** system-ui avoids serif confusion (e.g. 0 vs O) on Recharts axis/tooltip numerals */
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: 12,
  /* Warm neutrals legible on BOTH cream paper and the dark theme (SVG
     presentation attributes cannot resolve CSS vars, so these stay literal). */
  axisColor: '#80827a',
  tickColor: '#80827a',
  gridColor: 'rgba(128, 130, 122, 0.35)',
  /* Inline-style consumers (tooltips) CAN resolve vars — follow the theme. */
  tooltipBg: 'var(--color-surface-2)',
  tooltipBorder: 'var(--color-border)',
  animDuration: 600,
  animEasing: 'ease-out' as const,
  dotRadius: 4,
  dotActiveRadius: 6,
  strokeWidth: 2,
  curveType: 'monotone' as const,
} as const;

/**
 * Recharts `<*Chart margin={...} />` only accepts physical keys (`left`/`right`/…).
 * RTL-EXEMPT: axis gutters are chart-library API, not layout CSS.
 */
export const CHART_MARGIN = {
  top: 8,
  right: 8,
  bottom: 0,
  left: 0,
} as const;

/** Recharts <Tooltip /> wrapper styles — readable in light and dark (custom content still inherits). */
export const RECHARTS_TOOLTIP_WRAPPER_PROPS = {
  contentStyle: {
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    color: 'var(--color-text-primary)',
  },
  labelStyle: { color: 'var(--color-text-primary)' },
  itemStyle: { color: 'var(--color-text-secondary)' },
} as const;

export type GradientKey = 'teal' | 'amber' | 'red' | 'purple' | 'green' | 'blue' | 'slate';

export const LINE_BY_GRADIENT: Record<GradientKey, string> = {
  teal: CHART_COLORS.teal,
  amber: CHART_COLORS.amber,
  red: CHART_COLORS.red,
  purple: CHART_COLORS.purple,
  green: CHART_COLORS.green,
  blue: CHART_COLORS.blue,
  slate: CHART_COLORS.slate,
};
