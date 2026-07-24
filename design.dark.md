---
version: beta
name: macOS Semantic Dark
description: Dark appearance references for the Molibot macOS product layer. DESIGN.md is authoritative.
colors:
  window: "#282828"
  grouped: "#2E2E2E"
  elevated: "#323232"
  surface-secondary: "#3A3A3A"
  foreground: "rgb(255 255 255 / 84.7%)"
  muted-foreground: "rgb(255 255 255 / 54.9%)"
  tertiary-foreground: "rgb(255 255 255 / 24.7%)"
  separator: "rgb(255 255 255 / 9.8%)"
  unemphasized-selection: "#464646"
  accent: "#007AFF"
  success: "#30D158"
  destructive: "#FF4245"
  warning: "#FF9230"
---

# macOS Semantic Dark References

This file is a compact companion to the authoritative macOS product rules in
`DESIGN.md`. Values mirror resolved AppKit semantic roles instead of the superseded
Geist/OKLCH dark palette.

| Product token family | Value | AppKit meaning |
| --- | --- | --- |
| `--mac-window-background` | `#282828` | Main window/workspace background (`underPageBackgroundColor`) |
| `--mac-grouped-background` | `#2E2E2E` | Quiet grouped canvas |
| `--mac-elevated-background` | `#323232` | Cards, popovers, composer, raised neutral controls (`windowBackgroundColor`) |
| `--surface-secondary` | `#3A3A3A` | Nested neutral content only |
| `--mac-label` | white 84.7% | Primary label |
| `--mac-secondary-label` | white 54.9% | Secondary label |
| `--mac-tertiary-label` | white 24.7% | Tertiary label |
| `--mac-separator` | white 9.8% | Structural separators |
| `--mac-unemphasized-selection` | `#464646` | Inactive/unemphasized selection |
| `--accent` | `#007AFF` | macOS control accent reference |

Never use `#000000`, `#0A0A0A`, or `#1E1E1E` for structural Desktop surfaces. The
window base is `underPageBackgroundColor` (`#282828`); `#1E1E1E` is macOS
`controlBackgroundColor` (a recessed field color) and reads as too black for the
workspace. Pure black is allowed only for intentional media or code canvases. Keep
the window, grouped, and elevated roles distinct (a monotonic ramp from `#282828`
to `#323232`) so the dark interface retains macOS depth without shadows.
