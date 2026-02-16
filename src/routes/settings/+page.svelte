<div class="page">
  <header class="header">
    <h1>Settings</h1>
    <a href="/">Back to Chat</a>
  </header>

  <div class="grid">
    <a class="card" href="/settings/ai">
      <h2>AI Provider</h2>
      <p>Provider mode, default provider/model, and custom providers list.</p>
    </a>

    <a class="card" href="/settings/telegram">
      <h2>Telegram Bot</h2>
      <p>Bot token and allowed chat IDs.</p>
    </a>
  </div>
</div>

<style>
  :global(html, body, #svelte) {
    margin: 0;
    background: #0b1020;
    color: #e5e7eb;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  a {
    color: #93c5fd;
    text-decoration: none;
  }

  .grid {
    display: grid;
    gap: 14px;
  }

  .card {
    display: block;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 14px;
    background: #111827;
  }

  .card h2 {
    margin: 0 0 6px 0;
    font-size: 16px;
    color: #f8fafc;
  }

  .card p {
    margin: 0;
    color: #cbd5e1;
    font-size: 13px;
  }
</style>
