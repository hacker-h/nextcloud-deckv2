<script>
  import BoardApp from './components/BoardApp.svelte';
</script>

<!-- Temporary until T11 wires this to the authenticated user from the auth store. -->
<BoardApp currentUser={import.meta.env.VITE_NC_USER} />
