import Airplane from "reicon-svelte/icons/Airplane";
import Box from "reicon-svelte/icons/Box";
import Chat from "reicon-svelte/icons/Chat";
import ChatDots from "reicon-svelte/icons/ChatDots";
import ChatRound from "reicon-svelte/icons/ChatRound";
import CheckSquare from "reicon-svelte/icons/CheckSquare";
import Component from "reicon-svelte/icons/Component";
import Database from "reicon-svelte/icons/Database";
import DiagramTree from "reicon-svelte/icons/DiagramTree";
import Eye from "reicon-svelte/icons/Eye";
import File from "reicon-svelte/icons/File";
import FileText from "reicon-svelte/icons/FileText";
import Folder from "reicon-svelte/icons/Folder";
import FolderOpen from "reicon-svelte/icons/FolderOpen";
import Globe from "reicon-svelte/icons/Globe";
import Grid from "reicon-svelte/icons/Grid";
import Image from "reicon-svelte/icons/Image";
import ListCheck from "reicon-svelte/icons/ListCheck";
import Magnifier from "reicon-svelte/icons/Magnifier";
import Memo from "reicon-svelte/icons/Memo";
import Microphone from "reicon-svelte/icons/Microphone";
import Notebook from "reicon-svelte/icons/Notebook";
import PenLine from "reicon-svelte/icons/PenLine";
import Plug from "reicon-svelte/icons/Plug";
import PuzzlePiece from "reicon-svelte/icons/PuzzlePiece";
import Soundwave from "reicon-svelte/icons/Soundwave";
import Sparkle from "reicon-svelte/icons/Sparkle";
import TerminalSquare from "reicon-svelte/icons/TerminalSquare";
import type { ReiconComponent } from "../components/ui/iconTypes";
import type { ActivityGroupAction, ActivityToolIconName } from "./activityView";

/** Reicon components for each semantic tool class produced by `activityToolIcon`. */
export const ACTIVITY_TOOL_ICONS: Record<ActivityToolIconName, ReiconComponent> = {
  terminal: TerminalSquare,
  edit: PenLine,
  read: FileText,
  web: Globe,
  search: Magnifier,
  folder: FolderOpen,
  memory: Database,
  agent: DiagramTree,
  app: Box,
  mcp: Plug,
  plugin: PuzzlePiece,
  image: Image,
  audio: Soundwave,
  tool: Component
};

/** Reicon components for grouped activity actions in the process timeline. */
export const ACTIVITY_GROUP_ICONS: Record<ActivityGroupAction, ReiconComponent> = {
  read: FileText,
  change: PenLine,
  search: Magnifier,
  command: TerminalSquare
};

/**
 * Channel/source glyphs. Brand logos are not part of Reicon, so each platform
 * keeps a distinguishable neutral glyph while the label carries the identity.
 */
export const CHANNEL_ICONS: Record<string, ReiconComponent> = {
  globe: Globe,
  browser: Globe,
  "folder-simple": Folder,
  "telegram-logo": Airplane,
  bird: Chat,
  "linux-logo": ChatRound,
  "wechat-logo": ChatDots
};

/** Mini App message-action icons declared by manifests, plus the fallback. */
const CONTRIBUTION_ICONS: Record<string, ReiconComponent> = {
  "check-square": CheckSquare,
  microphone: Microphone,
  sparkle: Sparkle,
  "note-blank": Memo,
  eye: Eye
};

export function contributionIcon(name: string | undefined): ReiconComponent {
  return (name && CONTRIBUTION_ICONS[name]) || Airplane;
}

/** Mini App result card icons; unknown names fall back to the app glyph. */
export function cardIcon(name: string | undefined): ReiconComponent {
  return (name && CONTRIBUTION_ICONS[name]) || Grid;
}

/** Empty-state quick actions offered on the chat landing view. */
export type EmptyActionIcon = "list-checks" | "magnifying-glass" | "notebook";

const EMPTY_ACTION_ICONS: Record<EmptyActionIcon, ReiconComponent> = {
  "list-checks": ListCheck,
  "magnifying-glass": Magnifier,
  notebook: Notebook
};

export function emptyActionIcon(name: string): ReiconComponent {
  return EMPTY_ACTION_ICONS[name as EmptyActionIcon] ?? Notebook;
}

/** Composer invocation kinds shown as kickers and slash suggestions. */
export const INVOCATION_ICONS: Record<"command" | "skill" | "miniapp" | "file", ReiconComponent> = {
  command: TerminalSquare,
  skill: Sparkle,
  miniapp: Grid,
  file: File
};
