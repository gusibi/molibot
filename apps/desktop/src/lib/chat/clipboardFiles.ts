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
  const files: File[] = [];
  let sawUnnamedImage = false;
  for (const item of items) {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file || file.size === 0) continue;
    if (file.name.trim()) {
      files.push(file);
      continue;
    }
    // Unnamed items are format representations of one pasted image (e.g.
    // Safari's png + tiff fallback): keep only the first.
    if (sawUnnamedImage) continue;
    sawUnnamedImage = true;
    const extension = IMAGE_EXTENSIONS[file.type.toLowerCase()] ?? "png";
    files.push(new File([file], `clipboard-image-${Date.now()}.${extension}`, {
      type: file.type,
      lastModified: file.lastModified
    }));
  }
  return files;
}
