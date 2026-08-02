<script>
  let { level } = $props();

  const BADGES = {
    manage: {
      icon: '★',
      text: 'Manage',
      label: 'Manage access — you can edit this board and change its settings',
    },
    edit: {
      icon: '✎',
      text: 'Edit',
      label: 'Edit access — you can edit cards on this board',
    },
    view: {
      icon: '👁',
      text: 'View',
      label: 'View access — read only',
    },
  };

  // biome-ignore lint/correctness/noUnusedVariables: Svelte markup consumes this derived value.
  const badge = $derived(BADGES[level] ?? BADGES.view);
</script>

<span class="badge" title={badge.label} aria-label={badge.label}>
  <span class="icon" aria-hidden="true">{badge.icon}</span>
  {badge.text}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: fit-content;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card-bg);
    color: var(--text-dim);
    font-size: 11px;
    line-height: 14px;
    font-weight: 600;
  }

  .icon {
    display: inline-block;
    color: var(--text);
    line-height: 1;
  }
</style>
