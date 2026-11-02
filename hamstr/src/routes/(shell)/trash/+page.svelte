<script>
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { api } from "#lib/client/api.ts";
	import { oops, toast } from "#lib/client/ui.svelte.ts";
	import { timeAgo } from "@hamstr/ui/format.ts";
	import AppIcon from "@hamstr/ui/components/AppIcon.svelte";
	import Modal from "@hamstr/ui/components/Modal.svelte";

	let { data } = $props();

	let confirming = $state(null); // the crumb awaiting "delete forever"

	async function restore(id) {
		try {
			await api(`/api/crumbs/${id}/restore`, { method: "POST", body: {} });
			toast("Restored");
			await invalidateAll();
		} catch (err) {
			oops(err);
		}
	}

	async function remove(crumb, event) {
		const button = event.currentTarget;
		button.disabled = true;
		try {
			await api(`/api/crumbs/${crumb.id}`, { method: "DELETE" });
			confirming = null;
			toast("Deleted");
			await invalidateAll();
		} catch (err) {
			button.disabled = false;
			oops(err);
		}
	}
</script>

<svelte:head><title>Trash · {page.data.name}</title></svelte:head>

{#if !data.signedOut}
	<div class="page">
		<div class="page-head">
			<div>
				<h1>Trash</h1>
				<p class="dim">Things here are deleted for good after 30 days. Nobody can open them meanwhile.</p>
			</div>
		</div>
		{#if data.trash.length}
			<div class="rows">
				{#each data.trash as crumb (crumb.id)}
					<div class="row" data-id={crumb.id}>
						<AppIcon app={crumb.app} />
						<div class="grow">
							<strong>{crumb.title}</strong>
							<div class="dim small">{crumb.app.name} · trashed {timeAgo(crumb.trashedAt)}</div>
						</div>
						<button type="button" class="button ghost small" onclick={() => restore(crumb.id)}>Restore</button>
						<button type="button" class="button danger small" onclick={() => (confirming = crumb)}>Delete forever</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="empty"><h2>The trash is empty</h2><p>Nice and tidy.</p></div>
		{/if}
	</div>
{/if}

{#if confirming}
	<Modal title="Delete forever?" onclose={() => (confirming = null)}>
		<p>“{confirming.title}” and all of its data will be erased. This can't be undone.</p>
		<div class="sheet-foot">
			<button type="button" class="button ghost" onclick={() => (confirming = null)}>Keep it</button>
			<button type="button" class="button" onclick={(event) => remove(confirming, event)}>Delete forever</button>
		</div>
	</Modal>
{/if}
