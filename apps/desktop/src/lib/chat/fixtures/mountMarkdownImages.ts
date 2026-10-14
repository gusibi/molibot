import { mount, unmount } from "svelte";
import MarkdownImages from "./MarkdownImages.svelte";
export function mountImages(target: HTMLElement, props: { loadBytes: () => Promise<Blob>; locale: "zh-CN" | "en" }) {
  const component = mount(MarkdownImages, { target, props });
  return () => unmount(component);
}
