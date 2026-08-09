/** Keep the browser-side presentation parser bounded before it opens an OOXML archive. */
export const PPTX_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Copies the authorized bytes into a standalone ArrayBuffer for the viewer.
 * The copy also prevents a caller's Uint8Array window from leaking an unrelated
 * backing buffer into the WASM parser.
 */
export function preparePptxBytes(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > PPTX_MAX_BYTES) {
    throw new Error(`PPTX is too large to preview (${bytes.byteLength} bytes).`);
  }
  return bytes.slice().buffer;
}
