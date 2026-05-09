/** Supabase Auth returns this when cookies have no valid refresh token (anonymous public visitors). */
export function isRefreshTokenNotFoundError(err: unknown): boolean {
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message)
      : err instanceof Error
        ? err.message
        : '';
  return msg.includes('Refresh Token Not Found');
}
