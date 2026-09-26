<script>
  import MarkdownDescription from './MarkdownDescription.svelte';
  let { card, comments = [], attachments = [], onDownload } = $props();
</script>
<p>🔒 Dieses Board ist schreibgeschützt.</p>
{#if card?.duedate}<p>Fällig: {new Date(card.duedate).toLocaleString('de-DE')}{card.done ? ' · Erledigt' : ''}</p>{/if}
<MarkdownDescription text={card?.description ?? ''} />
{#if comments.length}<h3>Kommentare</h3>{#each comments as comment (comment.id)}<p>{comment.message}</p>{/each}{/if}
{#if attachments.length}<h3>Anhänge</h3>{#each attachments.filter((a) => !a.deletedAt) as attachment (attachment.id)}<button onclick={() => onDownload(attachment)}>{attachment.name} herunterladen</button>{/each}{/if}
