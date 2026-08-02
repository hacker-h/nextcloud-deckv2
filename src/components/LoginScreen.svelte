<script>
  let {
    instanceName,
    status,
    error = null,
    expired = false,
    loginUrl = null,
    onSignIn,
    onCancel,
  } = $props();

  let primaryAction = $state(null);

  const displayInstance = $derived(friendlyInstanceName(instanceName));
  const waiting = $derived(status === 'pending' && !expired);
  const hasError = $derived(Boolean(error) && !expired);

  $effect(() => {
    if (typeof document === 'undefined') return;
    primaryAction?.focus();
  });

  function friendlyInstanceName(value) {
    if (!value) return 'your Nextcloud';
    try {
      return new URL(value).hostname;
    } catch {
      return value;
    }
  }
</script>

<main class="login-shell" aria-labelledby="login-title">
  <section class="login-card">
    <p class="eyebrow">Nextcloud Deck</p>
    <h1 id="login-title">Sign in to your boards</h1>
    <p class="instance">This app will connect to <strong>{displayInstance}</strong>.</p>

    <div class="status" role="status" aria-live="polite">
      {#if expired}
        <p class="status-title danger">Sign-in request expired</p>
        <p class="copy">Nextcloud sign-in requests live for 20 minutes. Start a fresh request to continue.</p>
      {:else if waiting}
        <p class="status-title">Waiting for approval…</p>
        <p class="copy">Waiting for you to approve the sign-in in Nextcloud…</p>
      {:else if hasError}
        <p class="status-title danger">Sign-in failed</p>
        <p class="copy err">{error}</p>
      {:else}
        <p class="copy">
          A Nextcloud page will open in a new tab where you approve access. Nextcloud creates a per-device app password for this browser, and you can revoke it anytime in Nextcloud → Settings → Security.
        </p>
      {/if}
    </div>

    <div class="actions">
      {#if expired}
        <button class="primary" type="button" onclick={() => onSignIn?.()} bind:this={primaryAction}>Try again</button>
      {:else if waiting}
        <button class="secondary" type="button" onclick={() => onCancel?.()} bind:this={primaryAction}>Cancel</button>
        {#if loginUrl}
          <a class="again" href={loginUrl} target="_blank" rel="noopener noreferrer">Open the sign-in page again</a>
        {/if}
      {:else if hasError}
        <button class="primary" type="button" onclick={() => onSignIn?.()} bind:this={primaryAction}>Try again</button>
      {:else}
        <button class="primary" type="button" onclick={() => onSignIn?.()} bind:this={primaryAction}>Sign in with Nextcloud</button>
      {/if}
    </div>
  </section>
</main>

<style>
  .login-shell {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px;
    background-image: var(--board-gradient);
  }

  .login-card {
    width: min(100%, 460px);
    padding: 28px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card-bg);
    box-shadow: 0 18px 48px rgba(0, 0, 0, .42), var(--card-shadow);
  }

  .eyebrow {
    margin: 0 0 8px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: var(--text);
    font-size: 28px;
    line-height: 34px;
  }

  .instance {
    margin: 10px 0 0;
    color: var(--text-dim);
  }

  .instance strong { color: var(--text); font-weight: 700; }

  .status {
    margin-top: 22px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: rgba(0, 0, 0, .16);
  }

  .status-title {
    margin: 0 0 6px;
    color: var(--text);
    font-weight: 700;
  }

  .copy {
    margin: 0;
    color: var(--text-dim);
  }

  .danger,
  .err { color: var(--danger); }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 22px;
  }

  button,
  .again {
    border-radius: 6px;
    cursor: pointer;
    font-weight: 700;
  }

  button {
    border: 0;
    padding: 8px 14px;
  }

  .primary { background: var(--accent); color: #1d2125; }
  .secondary {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
  }

  button:hover { filter: brightness(1.08); }
  button:focus-visible,
  .again:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .again {
    color: var(--accent);
    text-decoration: none;
  }

  .again:hover { text-decoration: underline; }
</style>
