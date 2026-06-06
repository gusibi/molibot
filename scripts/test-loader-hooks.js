import fs from "node:fs";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".md") || url.includes(".md?raw")) {
    const cleanUrl = url.split("?")[0];
    const filePath = new URL(cleanUrl);
    const content = fs.readFileSync(filePath, "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(content)};`
    };
  }
  return nextLoad(url, context);
}
