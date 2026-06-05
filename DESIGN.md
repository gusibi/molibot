---
version: v2.0
name: Molipibot Warm Shadcn
description: A high-density, "Warm Shadcn" design system for Molipibot's complex setting suite. It blends the structural precision of Shadcn UI with the warm, editorial palette of Anthropic (Paper, Charcoal, Terracotta). The system handles extreme information density via a double-sidebar navigation and master-detail patterns.

colors:
  # Base Palette (OKLch)
  bg: "oklch(98.5% 0.004 60)"          # Warm White Paper
  surface: "oklch(100% 0 0)"           # Pure White
  fg: "oklch(25% 0.02 60)"             # Soft Charcoal
  muted: "oklch(60% 0.015 60)"         # Mid-tone gray
  border: "oklch(93% 0.01 60)"         # Hairline borders
  accent: "oklch(60% 0.15 35)"         # Anthropic Terracotta
  accent-soft: "oklch(96% 0.025 35)"   # Subtle highlight/active state
  
  # Dark Mode overrides
  dark-bg: "oklch(20% 0.01 60)"
  dark-surface: "oklch(24% 0.01 60)"
  dark-fg: "oklch(94% 0.005 60)"
  dark-border: "oklch(30% 0.015 60)"

typography:
  display:
    fontFamily: "'Iowan Old Style', 'Charter', Georgia, serif"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    lineHeight: "1.6"
  mono:
    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace"
    fontSize: "13px"

shapes:
  radius-base: "10px"   # Standard for cards/buttons
  radius-sm: "6px"     # Standard for inputs/pills
  shadow: "0 1px 3px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.04)"

layout:
  sidebar-primary-w: "72px"
  sidebar-secondary-w: "260px"
  header-h: "64px"
  max-width: "1200px"

---

## Design Philosophy

Molipibot is a complex technical tool. The design philosophy balances **Information Density** (high) with **Visual Warmth** (soft). It rejects the "cold" tech aesthetic of slate and blue in favor of a literary, editorial feel.

### 1. The Double-Sidebar Navigation
To manage 24+ setting pages, we use a two-tiered hierarchy:
- **Primary Sidebar (Icons)**: High-level categories (Overview, AI, Channels, Data, System). 
- **Secondary Sidebar (List)**: Detailed page links within the active category.
This eliminates deep nesting and allows for 2-click access to any configuration.

### 2. Master-Detail Split
For entities like **AI Providers**, **Channels**, and **Agents**, we use a master-list on the left and a scrollable detail pane on the right. This maintains context while allowing deep configuration.

### 3. Collapsible Hierarchy
To handle the repetitive nature of Markdown files (BOT.md, SOUL.md, etc.), we use **Accordions**. This allows multiple files to exist on one page without overwhelming the user vertically.

## Components

### Cards
- **Feature Card**: Used on the Dashboard. High-contrast, large icon, generous padding.
- **Metric Card**: Used in Usage/Statistics. High-density, mono-fonts for numbers.

### Forms (Shadcn-style)
- **Inputs**: Hairline borders, subtle ring-focus states.
- **Buttons**: `radius-sm` (6px), primary button in Terracotta.
- **Tabs**: Pilled toggle switch for view switching within a card.

### Editors
- **Markdown Textarea**: Monospace font, high-contrast, contained within collapsible accordion items.
- **JSON Editor**: Monospace, strict validation styling.

## Colors & Theming

The system uses **OKLch** for all color definitions to ensure perceptual uniformity and perfect accessibility in both Light and Dark modes.

| Use Case | Token |
|---|---|
| Page Background | `--bg` |
| Primary Action | `--accent` |
| Active States | `--accent-soft` |
| Data / Code | `--font-mono` |

## CSS Class Naming Convention

To ensure future theme-ability, all UI components **must** use **custom semantic class names** rather than directly applying Tailwind utility classes in markup.

### Why
Hard-coded Tailwind classes (e.g. `text-sm font-medium text-muted-foreground`) make it impossible to override styles globally via a theme layer. Custom class names act as an abstraction — they decouple the component markup from the underlying style implementation.

### How
1. **Define a custom class name** that describes the component or role (e.g. `.setting-card-title`, `.channel-badge`).
2. **Compose Tailwind utilities inside that class** using `@apply` or standard CSS rules.
3. **Never place raw Tailwind classes directly on JSX/HTML elements** unless they are purely layout primitives (`flex`, `grid`, `absolute`) that have no visual style to theme.

```css
/* ✅ Good — semantic class, tailwind composed inside */
.setting-card-title {
  @apply text-sm font-medium text-muted-foreground;
}

/* ❌ Bad — hard-coded on the element */
<h2 class="text-sm font-medium text-muted-foreground">
```

### UI Framework
The frontend is built on **Shadcn UI** (Radix + Tailwind). Shadcn's own component classes (e.g. `button`, `card`, `dialog`) are acceptable as they are already customizable via the Shadcn theming system. This convention applies to **custom application-level styling** layered on top of Shadcn.

## Do's and Don'ts

### Do
- Use **Serif headlines** for page titles to add character.
- Use **Tabular Numerics** (`font-variant-numeric: tabular-nums`) for all stats.
- Keep border weights at **1px**.
- Use the **Double-Sidebar** for any view with more than 5 pages.

### Don't
- Don't use saturated blues or purples for UI elements.
- Don't hide important configuration behind more than 2 levels of modals.
- Don't use generic placeholder text (lorem ipsum); use real technical examples.
