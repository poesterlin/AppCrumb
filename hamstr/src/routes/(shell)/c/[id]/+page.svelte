<script>
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { api } from "#lib/client/api.ts";
	import { oops } from "#lib/client/ui.svelte.ts";
	import CrumbView from "#lib/components/CrumbView.svelte";

	let { data } = $props();

	const crumb = $derived(data.crumb);

	async function restore() {
		try {
			await api(`/api/crumbs/${crumb.id}/restore`, { method: "POST", body: {} });
			await invalidateAll();
		} catch (err) {
			oops(err);
		}
	}
</script>

<svelte:head><title>{crumb ? `${crumb.title} · ${page.data.name}` : page.data.name}</title></svelte:head>

{#if data.missing}
	<div class="page">
		<div class="empty">
			<h2>Nothing here</h2>
			<p><a class="button" href="/">Home</a></p>
		</div>
	</div>
{:else if crumb && !data.signedOut}
	{#if crumb.trashedAt}
		<div class="page">
			<div class="empty">
				<h2>“{crumb.title}” is in the trash</h2>
				<p>Restore it to open it again.</p>
				<button type="button" class="button" onclick={restore}>Restore</button>
			</div>
		</div>
	{:else}
		<CrumbView {crumb} app={data.app} />
	{/if}
{/if}
