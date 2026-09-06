/**
 * Saves a fetched blob to disk under a name the user controls.
 *
 * The desktop shell is Tauri's WKWebView, which drops `<a download>` clicks
 * silently (no `on_download` handler is registered), so inside Tauri the bytes
 * go through the native `save_file_dialog` command — the same channel Mini App
 * `file.save` uses. The anchor route stays for plain-browser dev only.
 */
export async function saveBlobAsFile(blob: Blob, filename: string): Promise<"saved" | "cancelled"> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file data"));
      reader.readAsDataURL(blob);
    });
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("save_file_dialog", {
      defaultName: filename,
      dataBase64: dataUrl
    });
    return path ? "saved" : "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return "saved";
}
