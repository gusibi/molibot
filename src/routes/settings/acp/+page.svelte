<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Inactive</Badge>
    <div class="flex max-w-2xl flex-col gap-2">
      <h1 class="text-2xl font-semibold tracking-tight text-foreground">ACP is no longer active</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        ACP configuration is retained only for legacy compatibility while the Agent v2.2 runtime moves coding work through the normal Agent, Workspace, ToolRuntime, and approval paths.
      </p>
    </div>
  </header>

  <Card>
    <CardHeader>
      <CardTitle>Runtime path removed</CardTitle>
      <CardDescription>
        Commands such as /acp, /approve, and /deny now return an inactive-path notice instead of opening or managing ACP sessions.
      </CardDescription>
    </CardHeader>
    <CardContent class="text-sm leading-6 text-muted-foreground">
      Legacy ACP source files remain in the repository until the final cleanup phase, but this settings page no longer edits ACP targets or projects.
    </CardContent>
  </Card>
</div>
