---
version: beta
name: macOS Semantic Dark
description: Dark appearance references for the Molibot macOS product layer. DESIGN.md is authoritative.
colors:
  window: "#1E1E1E"
  grouped: "#282828"
  elevated: "#2C2C2E"
  surface-secondary: "#343436"
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
| `--mac-window-background` | `#1E1E1E` | Unified window/workspace **and** sidebar base (opaque System Settings canvas) |
| `--mac-grouped-background` | `#282828` | Quiet grouped canvas |
| `--mac-elevated-background` | `#2C2C2E` | Cards, popovers, composer, raised neutral controls |
| `--surface-secondary` | `#343436` | Nested neutral content only |
| `--mac-label` | white 84.7% | Primary label |
| `--mac-secondary-label` | white 54.9% | Secondary label |
| `--mac-tertiary-label` | white 24.7% | Tertiary label |
| `--mac-separator` | white 9.8% | Structural separators |
| `--mac-unemphasized-selection` | `#464646` | Inactive/unemphasized selection |
| `--accent` | `#007AFF` | macOS control accent reference |

Never use `#000000` or `#0A0A0A` for structural Desktop surfaces. The window base
and the sidebar share `#1E1E1E` — the tone macOS System Settings shows with
reduced transparency — so nav and content read as one plane; the sidebar is never
tinted a different shade. Pure black is allowed only for intentional media or code
canvases. Keep only two structural steps distinct — the shared base (`#1E1E1E`) and
the elevated card (`#2C2C2E`), with `#282828` as the quiet grouped fill — so the
dark interface retains macOS depth without shadows.
