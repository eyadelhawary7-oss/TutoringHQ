import { describe, it, expect, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async ({ namespace }: { namespace: string }) =>
      (key: string) =>
        `${namespace}.${key}`,
  ),
}));

import CardOrdersTeaser from '@/components/orders/CardOrdersTeaser';

type AnyElement = { type: unknown; props: Record<string, unknown> } | null;

function collectText(node: unknown, acc: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return acc;
  if (typeof node === 'string' || typeof node === 'number') {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, acc);
    return acc;
  }
  if (typeof node === 'object' && 'props' in (node as object)) {
    const props = (node as { props?: Record<string, unknown> }).props ?? {};
    for (const [name, value] of Object.entries(props)) {
      if (name === 'key' || name === 'ref') continue;
      collectText(value, acc);
    }
  }
  return acc;
}

describe('CardOrdersTeaser — Merged-Center-Orders §04', () => {
  it('renders the badge, title, description, all four features and the passed-in action', async () => {
    const action = { type: 'a', props: { children: 'Go to Settings' } };
    const result = (await CardOrdersTeaser({
      locale: 'en',
      action: action as never,
    })) as AnyElement;

    const texts = collectText(result);

    expect(texts).toContain('orders.teaser.badge');
    expect(texts).toContain('orders.teaser.title');
    expect(texts).toContain('orders.teaser.description');
    expect(texts).toContain('orders.teaser.sampleName');
    expect(texts).toContain('orders.teaser.sampleIdBadge');
    // Four features, one per feature icon - not the "notify me" CTA, which is
    // omitted per D7 (BUILD-AFTER-REDESIGN.md): no write destination exists.
    expect(texts).toContain('orders.teaser.feature0');
    expect(texts).toContain('orders.teaser.feature1');
    expect(texts).toContain('orders.teaser.feature2');
    expect(texts).toContain('orders.teaser.feature3');
    expect(texts).not.toContain('orders.teaser.notifyMe');
    // The caller's real CTA (the existing "enable it in Settings" link) is
    // still the one action rendered.
    expect(texts).toContain('Go to Settings');
  });
});
