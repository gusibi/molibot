import adapter from "./scripts/svelte-adapter-node-sqlite.js";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      out: "build"
    })
  }
};

export default config;
