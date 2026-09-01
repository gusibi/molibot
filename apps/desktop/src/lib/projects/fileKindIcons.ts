import Archive from "reicon-svelte/icons/Archive";
import Chart from "reicon-svelte/icons/Chart";
import ChartBar from "reicon-svelte/icons/ChartBar";
import Code from "reicon-svelte/icons/Code";
import CodeFile from "reicon-svelte/icons/CodeFile";
import FilePdf from "reicon-svelte/icons/FilePdf";
import FileText from "reicon-svelte/icons/FileText";
import FileZip from "reicon-svelte/icons/FileZip";
import Film from "reicon-svelte/icons/Film";
import Folder from "reicon-svelte/icons/Folder";
import FolderOpen from "reicon-svelte/icons/FolderOpen";
import Gear from "reicon-svelte/icons/Gear";
import Image from "reicon-svelte/icons/Image";
import Link from "reicon-svelte/icons/Link";
import Lock from "reicon-svelte/icons/Lock";
import Music from "reicon-svelte/icons/Music";
import type { ReiconComponent } from "../components/ui/iconTypes";
import type { FileIconKind } from "./fileIcons";

/** Reicon component per semantic file kind from `fileIconKind`. */
export const FILE_KIND_ICONS: Record<FileIconKind, ReiconComponent> = {
  folder: Folder,
  "folder-open": FolderOpen,
  symlink: Link,
  code: Code,
  data: CodeFile,
  config: Gear,
  lock: Lock,
  text: FileText,
  document: FileText,
  sheet: ChartBar,
  slides: Chart,
  pdf: FilePdf,
  image: Image,
  audio: Music,
  video: Film,
  zip: FileZip,
  archive: Archive,
  file: FileText
};
