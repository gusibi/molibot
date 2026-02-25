<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/">Chat</a>
        <a class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white" href="/settings">Settings</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/ai">AI</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/telegram">Telegram</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/plugins">Plugins</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/memory">Memory</a>
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-4xl space-y-4">
        <h1 class="text-2xl font-semibold">Settings</h1>
        <p class="text-sm text-slate-400">Manage AI runtime and Telegram configuration.</p>

        <div class="grid gap-3">
          <a
            class="block cursor-pointer rounded-xl border border-white/15 bg-[#2b2b2b] p-4 transition-colors duration-200 hover:bg-[#343434]"
            href="/settings/ai"
          >
            <h2 class="text-base font-semibold">AI Provider</h2>
            <p class="mt-1 text-sm text-slate-400">Provider mode, default provider/model, and custom providers list.</p>
          </a>

          <a
            class="block cursor-pointer rounded-xl border border-white/15 bg-[#2b2b2b] p-4 transition-colors duration-200 hover:bg-[#343434]"
            href="/settings/telegram"
          >
            <h2 class="text-base font-semibold">Telegram Bot</h2>
            <p class="mt-1 text-sm text-slate-400">Bot token and allowed chat IDs.</p>
          </a>

          <a
            class="block cursor-pointer rounded-xl border border-white/15 bg-[#2b2b2b] p-4 transition-colors duration-200 hover:bg-[#343434]"
            href="/settings/plugins"
          >
            <h2 class="text-base font-semibold">Plugins</h2>
            <p class="mt-1 text-sm text-slate-400">Optional features like Memory on/off and core selection.</p>
          </a>

          <a
            class="block cursor-pointer rounded-xl border border-white/15 bg-[#2b2b2b] p-4 transition-colors duration-200 hover:bg-[#343434]"
            href="/settings/memory"
          >
            <h2 class="text-base font-semibold">Memory</h2>
            <p class="mt-1 text-sm text-slate-400">Review, search, flush and curate memory records.</p>
          </a>
        </div>
      </div>
    </section>
  </div>
</main>
