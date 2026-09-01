import { mount } from "svelte";
import App from "./App.svelte";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "diff2html/bundles/css/diff2html.min.css";
import "./styles.css";
import "katex/dist/katex.min.css";

mount(App, {
  target: document.getElementById("app")!
});
