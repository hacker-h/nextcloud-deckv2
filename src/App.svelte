<script>
  import { createAuthStore } from './lib/auth.svelte.js';
  import LoginScreen from './components/LoginScreen.svelte';
  import BoardApp from './components/BoardApp.svelte';

  let { auth = createAuthStore() } = $props();

  $effect(() => {
    auth.check();
  });

  async function signIn() {
    const url = await auth.signIn();
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
</script>

{#if auth.state.status === 'checking'}
  <main class="splash" aria-label="Checking sign-in status">
    <section class="splash-card">
      <p class="eyebrow">Nextcloud Deck</p>
      <h1>Loading your boards</h1>
    </section>
  </main>
{:else if auth.state.status === 'authenticated'}
  <BoardApp currentUser={auth.state.user} onSignOut={auth.signOut} onUnauthorized={auth.handleUnauthorized} />
{:else}
  <LoginScreen
    instanceName={auth.state.instance}
    status={auth.state.status}
    error={auth.state.error}
    expired={auth.state.expired}
    loginUrl={auth.state.loginUrl}
    onSignIn={signIn}
    onCancel={auth.cancel}
  />
{/if}

<style>
  .splash {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px;
    background-image: var(--board-gradient);
  }

  .splash-card {
    width: min(100%, 360px);
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--card-bg) 86%, transparent);
    box-shadow: var(--card-shadow);
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
    font-size: 22px;
    line-height: 28px;
  }
</style>
