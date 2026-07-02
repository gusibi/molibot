---
version: alpha
name: Momo Liquid Glass
description: Momo for Mac design system, Light theme — a macOS 26 “Liquid Glass” aesthetic for the Momo agent desktop client (Chat + Settings). The Dark theme reuses these token names with different values.
platform: macOS (desktop app)
colors:
  primary: "#1c1c1e"
  secondary: "rgba(60,60,67,0.6)"
  tertiary: "rgba(60,60,67,0.45)"
  accent: "#007AFF"
  accent-soft: "#007aff24"
  label-100: "#1c1c1e"
  label-200: "rgba(60,60,67,0.75)"
  label-300: "rgba(60,60,67,0.6)"
  label-400: "rgba(60,60,67,0.45)"
  label-500: "rgba(60,60,67,0.3)"
  fill-100: "rgba(120,120,128,0.12)"
  fill-200: "rgba(120,120,128,0.16)"
  fill-300: "rgba(120,120,128,0.24)"
  fill-selection: "rgba(118,118,128,0.16)"
  separator: "rgba(0,0,0,0.07)"
  separator-strong: "rgba(0,0,0,0.12)"
  hairline-light: "rgba(255,255,255,0.7)"
  # System accent options (selectable)
  blue: "#007AFF"
  purple: "#AF52DE"
  pink: "#FF2D55"
  orange: "#FF9500"
  green: "#34C759"
  teal: "#30B0C7"
  red: "#FF5A5F"
  graphite: "#8E8E93"
  # Status
  online: "#34C759"
  warning: "#FF9500"
  danger: "#FF3B30"
  # Channel brand colors
  channel-local: "#1c1c1e"
  channel-web: "#0A84FF"
  channel-telegram: "#2AABEE"
  channel-feishu: "#3370FF"
  channel-qq: "#12B7F5"
  channel-weixin: "#07C160"
materials:
  # Translucent “glass” surfaces — always layered over the wallpaper
  window: "rgba(250,250,252,0.7)"
  sidebar: "rgba(255,255,255,0.4)"
  card: "rgba(255,255,255,0.72)"
  bubble: "rgba(255,255,255,0.78)"
  chrome: "rgba(255,255,255,0.22)"
  blur: "blur(40px) saturate(180%)"
  blur-thin: "blur(20px) saturate(160%)"
  # Reduce-transparency fallbacks (opaque)
  window-opaque: "rgba(244,244,247,0.98)"
  sidebar-opaque: "rgba(236,236,240,0.99)"
  card-opaque: "#ffffff"
  blur-off: "saturate(120%)"
wallpaper:
  morning: "radial-gradient + linear-gradient, 蓝→薰衣草→桃 (默认)"
  clouds: "清透蓝白"
  dusk: "靛紫"
  graphite: "中性灰"
typography:
  large-title:
    fontFamily: SF Pro / PingFang SC
    fontSize: 26px
    fontWeight: 700
    lineHeight: 32px
  title-1:
    fontFamily: SF Pro / PingFang SC
    fontSize: 22px
    fontWeight: 700
    lineHeight: 28px
  title-2:
    fontFamily: SF Pro / PingFang SC
    fontSize: 16px
    fontWeight: 700
    lineHeight: 22px
  headline:
    fontFamily: SF Pro / PingFang SC
    fontSize: 15px
    fontWeight: 600
    lineHeight: 20px
  body:
    fontFamily: SF Pro / PingFang SC
    fontSize: 14.5px
    fontWeight: 400
    lineHeight: 22px
  callout:
    fontFamily: SF Pro / PingFang SC
    fontSize: 13.5px
    fontWeight: 450
    lineHeight: 18px
  subhead:
    fontFamily: SF Pro / PingFang SC
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  footnote:
    fontFamily: SF Pro / PingFang SC
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  caption-1:
    fontFamily: SF Pro / PingFang SC
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 15px
  caption-2:
    fontFamily: SF Pro / PingFang SC
    fontSize: 11px
    fontWeight: 400
    lineHeight: 14px
  section-label:
    fontFamily: SF Pro / PingFang SC
    fontSize: 11px
    fontWeight: 600
    lineHeight: 14px
    letterSpacing: 0.04em
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 18px
  6: 24px
  8: 32px
  base: 4px
rounded:
  xs: 6px
  sm: 8px
  md: 10px
  card: 12px
  bubble: 18px
  window: 20px
  full: 9999px
icons:
  library: Phosphor Icons
  weights: "regular (ph) / fill (ph-fill) / bold (ph-bold)"
  ui-size: 17px
  inline-size: 13–15px
components:
  button-primary:
    description: 发送按钮（圆形）
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    size: 36px
    shadow: "0 3px 8px -2px rgba(0,90,200,0.5)"
  button-pill:
    description: 新对话（强调色浅底胶囊）
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.subhead}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: 38px
  button-ghost-round:
    description: 头部操作按钮（搜索/更多）
    backgroundColor: "{colors.fill-200}"
    rounded: "{rounded.full}"
    size: 32px
  toggle:
    width: 38px
    height: 22px
    knob: 18px
    on: "{colors.accent}"
    off: "rgba(120,120,128,0.32)"
  popup-button:
    description: 设置行右侧的值选择器（值 + ▾）
    backgroundColor: "{colors.fill-100}"
    border: "0.5px solid {colors.separator}"
    rounded: "{rounded.xs}"
    padding: "4px 8px"
    typography: "{typography.subhead}"
  list-row:
    rounded: "{rounded.sm}"
    height: 32–46px
    selectedBackground: "{colors.accent-soft}"
    selectedText: "{colors.accent}"
  bubble-me:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "18px 18px 6px 18px"
    padding: "11px 15px"
    typography: "{typography.body}"
  bubble-them:
    backgroundColor: "{materials.bubble}"
    border: "0.5px solid rgba(0,0,0,0.05)"
    textColor: "{colors.primary}"
    rounded: "18px 18px 18px 6px"
    padding: "12px 15px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{materials.card}"
    border: "0.5px solid rgba(0,0,0,0.06)"
    rounded: "{rounded.card}"
    shadow: "0 1px 3px rgba(0,0,0,0.04)"
  settings-row:
    minHeight: 46px
    padding: "8px 15px"
    divider: "0.5px solid {colors.separator}"
  category-icon:
    description: 设置分类彩色圆角图标
    size: 22px
    rounded: "{rounded.xs}"
    glyphColor: "#ffffff"
---

# Momo Liquid Glass

## Overview

Momo Liquid Glass is the design system for Momo’s macOS desktop client. The aesthetic is Apple’s “Liquid Glass”: translucent, frosted surfaces that float over a soft wallpaper, with thin light borders and gentle specular highlights. It follows native macOS conventions — Chat reads like Messages, Settings reads like System Settings — so the app feels at home on the OS rather than like a ported web page.

This is the Light theme. The Dark theme uses the same token names with different values. Color is restrained and signals state or channel identity; the wallpaper provides the only saturated color, seen through the glass.

## Colors

Color tokens encode intent, not just a swatch:

- `label-100` → `label-500` rank text and icons from primary to faint; `label-100` is primary text, `label-300` secondary, `label-400` placeholder/metadata.
- `fill-*` are translucent gray fills that layer over any surface — use them for search fields, unselected chips, icon tiles, and hover. `fill-selection` is the neutral sidebar selection in Settings.
- `separator` / `hairline-light` are the dividing lines: dark hairlines inside content, a light `rgba(255,255,255,0.7)` rim on glass edges.
- `accent` is the single emphasis color (default system blue). `accent-soft` is the same color at ~14% for selected list rows, the New-Chat pill, and panel-toggle states. The accent is user-selectable across `blue / purple / pink / orange / green / graphite`.
- `online / warning / danger` carry status; `online` green also marks “已连接”.
- `channel-*` give each connected channel its identity color (local, web, Telegram, Feishu, QQ, WeChat) — used on channel badges, avatars, and group headers.

Never signal state with color alone — pair it with an icon or label (e.g. 已连接 = green text + dot).

## Materials (Liquid Glass)

The defining layer. Surfaces are translucent and blurred so the wallpaper bleeds through:

- `window` is the panel body; `sidebar` is more transparent than the content area; `card` and `bubble` sit on top, slightly more opaque for legibility; `chrome` is the toolbar/header wash.
- Every glass surface uses `backdrop-filter: {materials.blur}` (`blur(40px) saturate(180%)`); toolbars use `blur-thin`.
- The window shell carries a triple shadow plus an inner top highlight for the “lit glass edge”:
  `box-shadow: 0 40px 80px -24px rgba(28,38,68,0.5), 0 2px 10px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)` with a `0.5px {colors.hairline-light}` border.
- **Reduce Transparency**: when the user enables it (a real macOS accessibility setting, exposed as a tweak), swap to `*-opaque` materials and `blur-off` — panels become solid, blur is dropped.

Implement materials as CSS variables (`--panel-bg`, `--sidebar-bg`, `--card-bg`, `--blur`) so a single switch retints the whole app.

## Typography

San Francisco sets Latin, PingFang SC sets Chinese (`-apple-system, 'SF Pro Text', 'PingFang SC'`). Tokens follow the macOS HIG roles:

- `large-title` / `title-1` title windows and panels (设置, 通用).
- `title-2` / `headline` for brand and conversation names.
- `body` is the default for message bubbles and prose; `callout` / `subhead` for list rows and controls.
- `footnote` / `caption-*` for timestamps and metadata.
- `section-label` is the uppercase-feel grouping header (本地知识库, 对话, 渠道连接): 11px/600, slight letter-spacing, in `label-300`.

Apply the tokens rather than hand-setting size/weight. Keep to two weights per view.

## Layout

Spacing follows a 4px scale (4 / 8 / 12 / 16 / 18 / 24 / 32). Rhythm: 8px inside a group, 16px between groups, 24px between sections. Cards pad 16px; settings rows are 46px tall with hairline dividers.

The app is one macOS desktop scene (`1920×1130`): a translucent menu bar on top, the **Chat** window (left) and **Settings** window (right) floating on the wallpaper.

- **Chat window — 3 columns (1052 wide):** sidebar `270` (brand · actions · 本地知识库 · channel-grouped conversations · account) | conversation thread `flex` (header · messages · composer) | file panel `288` (collapsible).
- **Settings window — 2 columns (744 wide):** category sidebar `228` (search · colored-icon list · account) | content `flex` (title · grouped inset cards).

## Elevation & Depth

Depth comes from translucency and layering first; shadows stay soft.

- Window / panel: the triple shadow above.
- Card, attachment, bubble: `0 2px 8px -3px rgba(0,0,0,0.12)`.
- Settings group card: `0 1px 3px rgba(0,0,0,0.04)`.
- Composer: `0 4px 14px -6px rgba(0,0,0,0.16)` plus an inner top highlight.

Stacking order on glass: wallpaper → window → sidebar/content → cards/bubbles → popovers.

## Motion

Motion is functional and short. Toggles and selection use ~150ms; group collapse and panel show/hide ~200ms; modal/overlay ~300ms. Default easing `cubic-bezier(0.2, 0.8, 0.2, 1)`. The send button and toggles animate transform/background only. Honor `prefers-reduced-motion`.

## Shapes

Radii: `6px` controls and tiles, `8–10px` list rows and pills-in-list, `12px` cards and grouped surfaces, `18px` message bubbles and the composer, `20px` window corners, `full` for circular avatars, toggles, and the send button. Keep one radius family per view.

## Components

Tokens above give ready values per element:

- **Primary button** (send): solid `accent` circle, 36px, white glyph, soft blue shadow.
- **Pill button** (新对话): `accent-soft` fill, `accent` text/icon.
- **Ghost round** (header search/more/panel-toggle): `fill-200` circle, 32px; the file-panel toggle switches to `accent-soft` + `accent` when the panel is open.
- **Toggle**: 38×22 track, 18px knob; `accent` on / translucent gray off; click flips.
- **Popup button**: `fill-100` chip with a `caret-down`, for选择类设置值 (语言, 关闭窗口时).
- **List row**: 32–46px, `sm` radius; selected = `accent-soft` background + `accent` label, with a rounded icon tile (`fill-100`, or `accent`-tinted when active).
- **Message bubbles**: `bubble-me` (accent, right, tail bottom-right) and `bubble-them` (glass, left, tail bottom-left, with 30px avatar).
- **Cards**: attachment card, task-progress card (✓ green / spinning accent / hollow gray steps), settings group card — all `{materials.card}` with hairline border.
- **Category icon**: 22px colored rounded square with a white fill-glyph; one hue per category.

States: hover lifts a row to `fill-100`; selection uses `accent-soft` (lists) or `fill-selection` (Settings sidebar). Focus on text inputs shows the native blue ring `0 0 0 3px {colors.accent}33`.

## Channels & Permissions

A core model of this app:

- Conversations are **grouped by channel** in the sidebar: `Momo · 本地`, `飞书`, `Telegram`, `微信`, (`QQ` 未连接). Group headers show the channel icon, count, and an eye mark for read-only channels; groups collapse.
- **Local (Momo) = editable**: full agent thread with a live composer.
- **Other channels = read-only**: show the channel’s transcript (with sender avatars/names), a “通过 <渠道> · 仅查看” header badge in the channel color, and a read-only footer bar (“此对话来自 X 渠道，仅支持查看 · 前往 X 回复”) in place of the composer. Never render an input for a read-only channel.

## File Panel

The right column of Chat manages files produced in conversations: grouped by `今天 / 昨天 / 更早`; each row is a colored type tile (docx blue, png teal, xlsx green, pdf red, md gray) + name + `size · source conversation` + a more-menu. A filter chip row (全部 / 文档 / 图片 / 表格) sits on top and a storage summary on the bottom. The panel is collapsible from the chat header.

## Voice & Content

Copy is Simplified Chinese, concise, no filler.

- Labels and actions are short noun/verb phrases (新对话, 自动任务, 清除缓存), not 确定/OK.
- In-progress states use 「…」: 正在执行…, 进行中.
- Status is explicit and paired with color/icon: 已连接 (green), 未连接 (gray), 在线, 仅查看.
- Metadata reads `大小 · 来源`：`128 KB · 项目周报数据整理`.
- Use numerals (28 项, 1.2 GB) and the · middle dot as separator.

## Do’s and Don’ts

- Do layer every surface over the wallpaper; glass needs something to refract.
- Do rank text with `label-100/300/400`, not by shrinking everything.
- Do keep accent for state and the single primary action per view.
- Do drive materials from CSS variables so accent / wallpaper / reduce-transparency flip globally.
- Don’t place solid opaque panels on the desktop — that kills the Liquid Glass look (except under Reduce Transparency).
- Don’t signal state with color alone.
- Don’t give read-only channels an input affordance.
- Don’t mix radius families or more than two font weights in one view.
- Don’t invent new colors; use the accent, channel, and gray tokens.
