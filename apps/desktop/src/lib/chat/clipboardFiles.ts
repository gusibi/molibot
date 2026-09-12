export interface ClipboardFileItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp"
};

/**
 * The browser invented this name instead of reading it off a file, so it carries
 * no identity: macOS hands a screenshot over as one image in several encodings
 * (png + tiff + …) and names every one of them `image.<ext>`, so two entries
 * sharing that shape are two encodings of one pasted image, not two images.
 * Only a real filename (from the filesystem) can tell two pasted files apart.
 */
const GENERATED_IMAGE_NAME = /^image\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|jp2)$/i;

/** Best encoding to keep for one pasted image: the one every preview path renders. */
const REPRESENTATION_PREFERENCE = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Names are minted per paste, so successive pastes of unnamed screenshots stay
// apart (`image-1.png`, `image-2.png`, …) instead of all colliding on
// `image.png` — attachment paths are reserved from the filename, and identical
// names also make the pending chips indistinguishable.
let clipboardImageSequence = 0;

function isGeneratedImageName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "" || GENERATED_IMAGE_NAME.test(trimmed);
}

function representationRank(type: string): number {
  const index = REPRESENTATION_PREFERENCE.indexOf(type);
  return index === -1 ? REPRESENTATION_PREFERENCE.length : index;
}

function extensionFor(file: File, type: string): string {
  const fromType = IMAGE_EXTENSIONS[type];
  if (fromType) return fromType;
  const dot = file.name.lastIndexOf(".");
  const fromName = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : "png";
}

function mintRepresentationName(extension: string, used: Set<string>): string {
  let candidate: string;
  do {
    clipboardImageSequence += 1;
    candidate = `image-${clipboardImageSequence}.${extension}`;
  } while (used.has(candidate));
  return candidate;
}

/** Keeps a real filename, only disambiguating when this paste repeats one. */
function mintNamedName(file: File, used: Set<string>): string {
  if (!used.has(file.name)) return file.name;
  const dot = file.name.lastIndexOf(".");
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot) : "";
  let candidate = `${stem}-2${extension}`;
  for (let counter = 3; used.has(candidate); counter += 1) candidate = `${stem}-${counter}${extension}`;
  return candidate;
}

export function clipboardImageFiles(items: Iterable<ClipboardFileItem>): File[] {
  const named: File[] = [];
  const representations: File[] = [];
  for (const item of items) {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file || file.size === 0) continue;
    if (isGeneratedImageName(file.name)) representations.push(file);
    else named.push(file);
  }

  // A pasted *file* also puts its own bytes on the pasteboard as image data, so
  // the generated-named entries beside a real filename are that same file again
  // — keep the file. With nothing but clipboard data (a screenshot), keep the
  // single best encoding and drop the rest of the representations.
  const kept = named.length > 0
    ? named
    : representations.sort((left, right) => representationRank(left.type.toLowerCase()) - representationRank(right.type.toLowerCase())).slice(0, 1);

  const used = new Set<string>();
  return kept.map((file) => {
    const type = file.type.toLowerCase();
    const name = isGeneratedImageName(file.name)
      ? mintRepresentationName(extensionFor(file, type), used)
      : mintNamedName(file, used);
    used.add(name);
    if (name === file.name) return file;
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  });
}
