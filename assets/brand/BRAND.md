# AgentFund Brand Assets

## Mark concept

The mark is an abstract letter **"A"** built from two tapered payment/fund
streams that flow upward from the base and converge into a single circular
node at the apex — the autonomous agent. A horizontal bar crosses the two
streams partway up, textured with three small "packet" dots to evoke a
payment/data stream (a nod to the x402 request/settle flow). Small dot
accents sit at the base of each stream (circuit/wallet endpoints), and the
apex node has a bright inner core representing the agent's active state.

Reading the mark: **capital flows in from two directions (donors / agents),
cross a settlement stream, and converge into one on-chain agent node.**

The mark is designed to read clearly at 16px (favicon) up through large
hero use, and is built for dark backgrounds — the primary brand surface.

## Files

| File | Purpose |
|---|---|
| `logo.svg` | Master lockup: mark + "AgentFund" wordmark, hand-authored SVG |
| `logo-mark.svg` | Mark only, square, self-contained with dark rounded background (app-icon style) |
| `logo-400.png` | 400x400 PNG render of the mark, for marketplace/registry listings (e.g. Cline) |
| `favicon.png` | 64x64 PNG render of the mark |
| `og-image.svg` / `og-image.png` | 1200x630 social share card: mark + wordmark + tagline |

All PNGs were rendered from the source SVGs with `@resvg/resvg-js` (see
render script used at generation time; not checked into this repo).

## Color palette

These are the exact tokens already in use on the AgentFund web app
(`web/styles/globals.css`) — the brand assets were matched to them so the
logo and site are pixel-consistent.

| Token | Hex | Usage |
|---|---|---|
| `--af-bg` (Deep Space) | `#050508` | Primary dark background |
| `--af-bg-raised` | `#0a0a12` | Raised surface / card background |
| `--af-violet` (Electric Violet) | `#7c3aed` | Primary accent — left flow stream, "Agent" wordmark accent option |
| `--af-violet-soft` | `#a78bfa` | Violet gradient highlight / base dot |
| `--af-cyan` (Neon Cyan) | `#06b6d4` | Secondary accent — right flow stream |
| `--af-cyan-soft` | `#67e8f9` | Cyan gradient highlight / "Fund" wordmark |
| `--af-success` | `#22d3a5` | Reserved for status/success UI, not used in the mark |
| Off-white (wordmark "Agent", node core) | `#f5f3ff` | High-contrast text/core on dark bg |
| Dim gray (tagline / secondary text) | `#a1a1b5` | Supporting copy on dark bg |

Gradients used in the mark:
- Left stream: `#a78bfa -> #7c3aed` (top to bottom)
- Right stream: `#67e8f9 -> #06b6d4` (top to bottom)
- Crossbar: `#7c3aed -> #06b6d4` (left to right)
- Apex node: radial `#c4b5fd -> #7c3aed -> #06b6d4`
- "Fund" wordmark: `#a78bfa -> #67e8f9` (left to right)

No gold, orange, or "generic crypto" tones are used anywhere in the mark.

## Usage guidance

- Primary background: deep space dark (`#050508` / `#0a0a12`). The mark and
  wordmark are designed for this surface first.
- On light backgrounds, use `logo-mark.svg` as-is (it carries its own dark
  rounded background chip) rather than placing the transparent streams
  directly on light UI.
- Minimum clear space: roughly 0.25x the mark's height on all sides.
- Do not recolor the two streams to the same color — the two-tone
  violet/cyan convergence is the core visual idea (two flows becoming one
  agent node).
- Wordmark font: Arial/Helvetica Bold (system sans, weight 800) for
  portability; if a brand webfont is later chosen (e.g. a geometric
  sans like Inter or Space Grotesk), swap it in `logo.svg`'s `<text>`
  `font-family` without touching the mark geometry.
