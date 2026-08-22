<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { parsePluginToHostMessage, type HostToPluginMessage } from "$lib/shared/pluginBridge";

  interface Props {
    pluginId: string;
    pluginVersion: string;
    uiEntry: string;
    locale: "zh-CN" | "en-US";
    theme: "light" | "dark";
    enabled: boolean;
    onSaved?: () => void;
  }

  let { pluginId, pluginVersion, uiEntry, locale, theme, enabled, onSaved }: Props = $props();

  let iframeElement = $state<HTMLIFrameElement | null>(null);
  let frameLoaded = $state(false);
  let frameHeight = $state(320);

  // Derive source URL: in web it's /plugins/<id>/ui/<entry>, in desktop it's molibot-plugin://... or loopback
  let srcUrl = $derived(`/plugins/${encodeURIComponent(pluginId)}/ui/${uiEntry.replace(/^ui\//, "")}`);

  function postToPlugin(message: HostToPluginMessage): void {
    if (!iframeElement?.contentWindow) return;
    iframeElement.contentWindow.postMessage(message, "*");
  }

  function postBootstrap(): void {
    postToPlugin({
      type: "molibot:host:bootstrap",
      version: 1,
      pluginId,
      pluginVersion,
      locale,
      theme,
      themeTokens: (() => {
        const styles = getComputedStyle(document.documentElement);
        return {
          background: styles.getPropertyValue("--background").trim(),
          surface: styles.getPropertyValue("--card").trim(),
          foreground: styles.getPropertyValue("--foreground").trim(),
          muted: styles.getPropertyValue("--muted-foreground").trim(),
          border: styles.getPropertyValue("--border").trim(),
          accent: styles.getPropertyValue("--primary").trim(),
          danger: styles.getPropertyValue("--destructive").trim()
        };
      })(),
      enabled
    });
  }

  async function handlePluginMessage(event: MessageEvent): Promise<void> {
    if (iframeElement?.contentWindow && event.source !== iframeElement.contentWindow) return;
    const data = parsePluginToHostMessage(event.data);
    if (!data) return;

    switch (data.type) {
      case "molibot:plugin:ready": {
        frameLoaded = true;
        break;
      }

      case "molibot:plugin:resize": {
        frameHeight = data.height;
        break;
      }

      case "molibot:plugin:get_settings": {
        try {
          const res = await fetch(`/api/settings/plugins/contract/${pluginId}`);
          if (res.ok) {
            const json = await res.json();
            postToPlugin({
              type: "molibot:host:settings_data",
              correlationId: data.correlationId,
              values: json.detail?.settingsValues ?? {}
            });
          } else {
            postToPlugin({
              type: "molibot:host:error",
              correlationId: data.correlationId,
              error: "Failed to load settings"
            });
          }
        } catch (e) {
          postToPlugin({
            type: "molibot:host:error",
            correlationId: data.correlationId,
            error: e instanceof Error ? e.message : String(e)
          });
        }
        break;
      }

      case "molibot:plugin:save_settings": {
        try {
          const res = await fetch(`/api/settings/plugins/contract/${pluginId}/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values: data.values })
          });
          if (res.ok) {
            postToPlugin({
              type: "molibot:host:saved",
              correlationId: data.correlationId
            });
            onSaved?.();
          } else {
            const json = await res.json();
            postToPlugin({
              type: "molibot:host:error",
              correlationId: data.correlationId,
              error: json.error || "Save failed"
            });
          }
        } catch (e) {
          postToPlugin({
            type: "molibot:host:error",
            correlationId: data.correlationId,
            error: e instanceof Error ? e.message : String(e)
          });
        }
        break;
      }

      case "molibot:plugin:get_secrets_presence": {
        try {
          const res = await fetch(`/api/settings/plugins/contract/${pluginId}`);
          if (res.ok) {
            const json = await res.json();
            postToPlugin({
              type: "molibot:host:secrets_presence",
              correlationId: data.correlationId,
              presence: json.detail?.secretsPresence ?? {}
            });
          }
        } catch (e) {
          postToPlugin({
            type: "molibot:host:error",
            correlationId: data.correlationId,
            error: e instanceof Error ? e.message : String(e)
          });
        }
        break;
      }

      case "molibot:plugin:save_secrets": {
        try {
          const res = await fetch(`/api/settings/plugins/contract/${pluginId}/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secrets: { replace: data.replace, clear: data.clear } })
          });
          if (res.ok) {
            postToPlugin({
              type: "molibot:host:saved",
              correlationId: data.correlationId
            });
          } else {
            const json = await res.json();
            postToPlugin({
              type: "molibot:host:error",
              correlationId: data.correlationId,
              error: json.error || "Failed to update secrets"
            });
          }
        } catch (e) {
          postToPlugin({
            type: "molibot:host:error",
            correlationId: data.correlationId,
            error: e instanceof Error ? e.message : String(e)
          });
        }
        break;
      }

      case "molibot:plugin:invoke_action": {
        try {
          const res = await fetch(`/api/settings/plugins/contract/${pluginId}/actions/${encodeURIComponent(data.action)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: data.input })
          });
          const json = await res.json();
          if (json.ok) {
            postToPlugin({
              type: "molibot:host:action_result",
              correlationId: data.correlationId,
              result: json.result
            });
          } else {
            postToPlugin({
              type: "molibot:host:error",
              correlationId: data.correlationId,
              error: json.error || "Action execution failed"
            });
          }
        } catch (e) {
          postToPlugin({
            type: "molibot:host:error",
            correlationId: data.correlationId,
            error: e instanceof Error ? e.message : String(e)
          });
        }
        break;
      }
    }
  }

  onMount(() => {
    window.addEventListener("message", handlePluginMessage);
  });

  $effect(() => {
    const bootstrapState = [pluginId, pluginVersion, locale, theme, enabled] as const;
    if (frameLoaded && bootstrapState[0]) postBootstrap();
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", handlePluginMessage);
    }
  });
</script>

<div class="w-full rounded-lg border border-border bg-card overflow-hidden">
  <iframe
    bind:this={iframeElement}
    src={srcUrl}
    title="Plugin Settings Frame"
    sandbox="allow-scripts"
    class="w-full border-none bg-background"
    style:height={`${frameHeight}px`}
  ></iframe>
</div>
