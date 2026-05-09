# Card design — owner-facing QR card orders

## Style labels (B / C)

**Option A** is **reserved for a future visual preset** and is **not** exposed in the order UI today.

**Active presets:**

| Label in UI | Internal `card_style` | Description |
|-------------|----------------------|-------------|
| Option **B** | `dark` | Dark navy + teal accent (default “premium dark”). |
| Option **C** | `light` | White / light face + teal accent. |

Eyad confirmed **B/C labelling is intentional** (Option A deliberately omitted until a third preset ships).

See also: `CardOrderModal`, `CardTemplatePreview`, `generateOrderPdf`, admin PDF route.
