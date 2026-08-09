/** Keep the client-side converter bounded like the Agent's document reader. */
export const DOCX_MAX_BYTES = 50 * 1024 * 1024;

export interface DocxDocument {
  markdown: string;
  warnings: string[];
}

type MammothModule = typeof import("mammoth") & {
  convertToMarkdown: (input: unknown, options?: Record<string, unknown>) => Promise<{
    value: string;
    messages: Array<{ type: string; message: string }>;
  }>;
};

/**
 * Converts DOCX bytes lazily in the WebView. Mammoth is imported only when a
 * DOCX tab is opened, external file access is disabled, and the resulting
 * Markdown goes through the existing sanitized Markdown viewer. This is a
 * read-only content preview, not a
 * layout-faithful Word renderer or an editor.
 */
export async function parseDocx(input: ArrayBuffer | Uint8Array): Promise<DocxDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > DOCX_MAX_BYTES) {
    throw new Error(`DOCX is too large to preview (${bytes.byteLength} bytes).`);
  }

  // Import Mammoth's browser bundle explicitly. Vite otherwise inlines the
  // CommonJS Node entry into the main chunk instead of keeping conversion
  // genuinely lazy.
  const mammoth = (await import("mammoth/mammoth.browser.js") as unknown) as MammothModule;
  const inputSpec = { arrayBuffer: bytes.slice().buffer };
  const result = await mammoth.convertToMarkdown(
    inputSpec,
    {
      externalFileAccess: false,
      // Keep embedded media from becoming data-URI resource loads in the
      // WebView. The document text and structure remain available.
      convertImage: mammoth.images.imgElement(async () => ({ src: "" }))
    }
  );

  return {
    markdown: result.value,
    warnings: result.messages
      .filter((message) => message.type === "warning")
      .map((message) => message.message)
  };
}
