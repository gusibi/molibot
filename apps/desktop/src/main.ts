import { mount } from "svelte";
import App from "./App.svelte";
// Phosphor icon webfonts (bundled offline) — matches the Momo design language.
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/bold";
import "@phosphor-icons/web/fill";
import "diff2html/bundles/css/diff2html.min.css";
import "./styles.css";

mount(App, {
  target: document.getElementById("app")!
});
