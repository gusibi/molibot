/**
 * Native Pi keeps tool-result images in conversation history, and every later
 * model request re-sends them. A full-size screenshot encoded as PNG can exceed
 * an upstream gateway's request-body limit, so cap the encoded image here.
 *
 * Pi tries PNG first and only falls through to JPEG when the PNG is larger than
 * `maxBytes`. Keeping the pixel dimensions and lowering the byte budget makes
 * Pi keep the capture size while switching the codec to JPEG.
 */
export const NATIVE_IMAGE_RESIZE = Object.freeze({
  maxWidth: 2560,
  maxHeight: 2560,
  maxBytes: 700 * 1024,
  jpegQuality: 80
});

/**
 * Keep only the newest images that fit the request budget. Older observations
 * stay in Pi's session history but are not resent on every model turn.
 */
export function limitNativeImageContext(context, maxBytes = 800 * 1024) {
  if (!context || !Array.isArray(context.messages)) return context;
  let remaining = maxBytes;
  let keptImage = false;
  let changed = false;
  const messages = [...context.messages];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || !Array.isArray(message.content)) continue;
    let messageChanged = false;
    const content = message.content.map((part) => {
      if (part?.type !== "image" || typeof part.data !== "string") return part;
      if (!keptImage || part.data.length <= remaining) {
        remaining -= part.data.length;
        keptImage = true;
        return part;
      }
      messageChanged = true;
      changed = true;
      return { type: "text", text: "[Earlier image omitted to keep this request within the model gateway body limit.]" };
    });
    if (messageChanged) messages[index] = { ...message, content };
  }
  return changed ? { ...context, messages } : context;
}

/** Preserve any stricter provider/model limit and apply the native Pi budget. */
export function withNativeImageLimits(model) {
  if (!model || typeof model !== "object") return model;
  const images = model.inputLimits?.images;
  const resize = images?.resize;
  return {
    ...model,
    inputLimits: {
      ...model.inputLimits,
      images: {
        ...images,
        resize: {
          ...NATIVE_IMAGE_RESIZE,
          ...resize,
          maxWidth: Math.min(NATIVE_IMAGE_RESIZE.maxWidth, resize?.maxWidth ?? Infinity),
          maxHeight: Math.min(NATIVE_IMAGE_RESIZE.maxHeight, resize?.maxHeight ?? Infinity),
          maxBytes: Math.min(NATIVE_IMAGE_RESIZE.maxBytes, resize?.maxBytes ?? Infinity)
        }
      }
    }
  };
}
