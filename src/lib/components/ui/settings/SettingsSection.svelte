<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    badge?: string;
    badgeVariant?: "secondary" | "outline" | "destructive";
    children: Snippet;
  }

  let { title, description, badge, badgeVariant = "secondary", children }: Props = $props();
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-col gap-3">
    {#if badge}
      <span
        class={[
          "inline-flex w-fit items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
          badgeVariant === "secondary" && "border-transparent bg-secondary text-secondary-foreground",
          badgeVariant === "outline" && "text-foreground",
          badgeVariant === "destructive" && "border-transparent bg-destructive text-destructive-foreground"
        ]}
      >
        {badge}
      </span>
    {/if}
    <div class="max-w-3xl space-y-2">
      <h1 class="settings-section-title">{title}</h1>
      {#if description}
        <p class="settings-section-desc">{description}</p>
      {/if}
    </div>
  </header>

  {@render children()}
</div>
