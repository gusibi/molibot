export interface ClipboardFileItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function clipboardImageFiles(items: Iterable<ClipboardFileItem>): File[] {
  for (const item of items) {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file || file.size === 0) continue;
    if (file.name.trim()) {
      return [file];
    }
    const extension = IMAGE_EXTENSIONS[file.type.toLowerCase()] ?? "png";
    return [new File([file], `clipboard-image-${Date.now()}.${extension}`, {
      type: file.type,
      lastModified: file.lastModified
    })];
  }
  return [];
}
