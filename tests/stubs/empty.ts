// Empty module. Aliased in vitest.config.ts for `server-only`, whose real
// implementation throws when imported outside a React Server Component. Under
// vitest we resolve it to this no-op so server-side libs can be unit-tested.
export {};
