<script>
	import NetworkNames from "#lib/components/addresses/NetworkNames.svelte";
	import Tailscale from "#lib/components/addresses/Tailscale.svelte";

	let { data } = $props();
</script>

<svelte:head><title>Addresses · Settings</title></svelte:head>

<div class="page-head">
	<div>
		<h1>Addresses</h1>
		<p class="dim">Every app gets an address of its own, so apps stay apart from each other and from this page. Choose how they are reached.</p>
	</div>
</div>

<div class="addresses">
	<NetworkNames network={data.network} />
	{#if data.tailnet}<Tailscale ts={data.tailnet} />{/if}
</div>

<style>
	/* Shared by the sections in #lib/components/addresses. */
	.addresses :global(h2) {
		margin: 0 0 12px;
	}
	.addresses :global(.spaced) {
		margin-top: 16px;
	}
	.addresses :global(.mono) {
		overflow-wrap: anywhere;
	}
	.addresses :global(.note) {
		margin: 12px 0;
	}
	.addresses :global(.note summary) {
		cursor: pointer;
		font-weight: 560;
		font-size: 0.9rem;
		color: var(--dim);
	}
	.addresses :global(.note summary:hover) {
		color: var(--ink);
	}
	.addresses :global(.note p) {
		margin: 8px 0 0;
	}
	.addresses :global(.actions) {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
		margin-top: 16px;
	}
	@media (max-width: 640px) {
		.addresses :global(.actions > *) {
			flex: 1;
		}
	}
</style>
