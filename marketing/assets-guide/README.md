# Visual assets guide

You'll want a few images to make the channel and posts look legit. This lists
what to make and the sizes, so you (or a designer) can produce them. The brand
look to match is in `web/css/styles.css`:

- **Accent gradient:** `#7c5cff` (violet) → `#00e0b8` (teal)
- **Background:** near-black `#0a0b10`
- **Font vibe:** clean geometric sans (Inter)
- **Logo mark:** a rounded square with the violet→teal gradient + soft glow
  (that's the `.logo-dot` in the header — a real logo can riff on it)

## Images to create

| Asset | Size | Use |
|-------|------|-----|
| Logo (square) | 512×512 PNG, transparent | Telegram channel photo, Discord icon |
| Channel banner | 1280×640 | Telegram/Discord header |
| Launch post image | 1200×675 (16:9) | Pinned launch announcement |
| Game spotlight cards | 1080×1080 (square) | One per game, reuse the gradient |
| "Provably fair" explainer graphic | 1200×675 | The trust post — diagram the 4 steps |
| OG/share image | 1200×630 | Website link preview (add to `index.html` `<head>`) |

## Keep it consistent
- Same gradient + dark background on every asset → instantly recognizable.
- Put the house edge and "provably fair" on promo art — honesty is the brand.
- Don't put fake numbers (balances, winnings) on art. Mockup UI is fine; faked
  results are not.

## Adding a share preview to the site
Once you have the 1200×630 image, add to `web/index.html` `<head>`:
```html
<meta property="og:title" content="Vanta — provably fair crypto games" />
<meta property="og:description" content="Verify every bet yourself." />
<meta property="og:image" content="https://yoursite/og.png" />
<meta name="twitter:card" content="summary_large_image" />
```
