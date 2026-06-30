import { mount } from "svelte";
import App from "./App.svelte";
// Phosphor icon webfonts (bundled offline) — matches the Momo design language.
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/bold";
import "@phosphor-icons/web/fill";
import "./styles.css";

mount(App, {
  target: document.getElementById("app")!
});
