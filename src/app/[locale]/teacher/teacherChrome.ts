/**
 * Which teacher routes suppress the mobile bottom tab bar.
 *
 * Merged-Teacher-Students §02 (student detail) draws no `.tabbar` in either
 * frame — it is a pushed detail screen whose only dismissal is the appbar
 * chevron — while §01 draws one in both. Shared between TeacherNav (which
 * hides the bar) and TeacherShell (which drops the matching bottom padding) so
 * the two cannot disagree and leave a 96px dead strip.
 *
 * Takes the locale-stripped pathname from `usePathname()` in `@/i18n/routing`.
 */
export function hidesTeacherTabBar(pathname: string): boolean {
  return /^\/teacher\/students\/[^/]+$/.test(pathname);
}
