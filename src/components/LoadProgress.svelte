<script module>
  // Each instance needs its own id so the bar can point at its own hover panel.
  let seq = 0;
</script>

<script>
  // One bar for two jobs: the determinate "all boards" tally in the topbar and
  // the indeterminate "this board is loading" banner under it. Deck returns a
  // board's stacks in a single request, so the active board's progress cannot
  // honestly be a percentage - it gets a moving stripe and an elapsed clock
  // instead, which is what the user actually needs to know it is not stuck.
  let {
    label,
    done = 0,
    total = 0,
    indeterminate = false,
    valuetext = '',
    text = '',
    details = [],
    wide = false,
  } = $props();

  const tipId = `loadprogress-tip-${(seq += 1)}`;
  let open = $state(false);

  const pct = $derived(total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
</script>

<!-- mouseenter/mouseleave rather than mouseover/mouseout: they do not bubble
  from the children, so the panel does not flicker as the pointer crosses the
  bar's own inner elements. Keyboard and screen-reader users get the same
  numbers from aria-valuetext, so the panel is a visual affordance only. -->
<div
  class="lp"
  class:wide
  role="group"
  aria-label={label}
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = false)}
>
  <div
    class="lp-bar"
    role="progressbar"
    aria-label={label}
    aria-valuemin={indeterminate ? undefined : 0}
    aria-valuemax={indeterminate ? undefined : total}
    aria-valuenow={indeterminate ? undefined : done}
    aria-valuetext={valuetext || undefined}
    aria-describedby={details.length ? tipId : undefined}
  >
    {#if text}
      <span class="lp-text">{text}</span>
    {/if}
    <span class="lp-track">
      {#if indeterminate}
        <span class="lp-fill lp-indet"></span>
      {:else}
        <span class="lp-fill" style={`width: ${pct}%;`}></span>
      {/if}
    </span>
  </div>

  {#if details.length}
    <div class="lp-tip" id={tipId} role="tooltip" hidden={!open}>
      <dl>
        {#each details as detail (detail.term)}
          <dt>{detail.term}</dt>
          <dd>{detail.value}</dd>
        {/each}
      </dl>
    </div>
  {/if}
</div>

<style>
  .lp { position: relative; flex: 0 0 auto; }
  .lp.wide { flex: 1 1 auto; min-width: 0; }

  .lp-bar { display: flex; align-items: center; gap: 8px; }

  .lp-text {
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .lp-track {
    position: relative;
    width: 56px;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }
  .lp.wide .lp-track { width: auto; flex: 1 1 auto; }

  .lp-fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width .3s ease;
  }

  /* An indeterminate bar must not pretend to measure anything, so it sweeps a
     fixed-width stripe instead of growing. */
  .lp-indet {
    position: absolute;
    inset: 0 auto 0 0;
    width: 36%;
    transition: none;
    animation: lp-sweep 1.15s ease-in-out infinite;
  }

  @keyframes lp-sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(280%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .lp-indet { animation: none; width: 100%; opacity: .45; }
    .lp-fill { transition: none; }
  }

  .lp-tip {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 60;
    width: max-content;
    min-width: 200px;
    /* Bounded, because one row is a list of board titles: unbounded it grew
       past the viewport and pushed every value out of sight. */
    max-width: min(320px, 60vw);
    padding: 8px 10px;
    background: #282e33;
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 55%);
    font-size: 12px;
    line-height: 18px;
  }
  .lp-tip[hidden] { display: none; }

  .lp-tip dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 2px 14px;
    margin: 0;
  }
  .lp-tip dt { color: var(--text-dim); white-space: nowrap; }
  .lp-tip dd {
    margin: 0;
    min-width: 0;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    text-align: right;
    overflow-wrap: anywhere;
  }
</style>
