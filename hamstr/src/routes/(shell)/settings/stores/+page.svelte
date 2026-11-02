<script>
	import { invalidateAll } from "$app/navigation";
	import { toast } from "@hamstr/ui/state.svelte.ts";
	import { call } from "#lib/client/accounts.ts";
	import StoreModal from "#lib/components/accounts/StoreModal.svelte";

	let { data } = $props();
	let editing = $state(null);

	async function activate(s) {
		if (s.active) return;
		await call("PATCH", `/api/admin/stores/${s.id}`, { active: true });
		await invalidateAll();
		toast(`${s.name} is now the active store`);
	}
	async function remove(s) {
		if (!confirm(`Remove ${s.name}?${s.active ? " Another registered store becomes active if you have one." : ""}`)) return;
		await call("DELETE", `/api/admin/stores/${s.id}`);
		await invalidateAll();
		toast(`Removed ${s.name}`);
	}
</script>

<svelte:head><title>Stores · Settings</title></svelte:head>

<div class="page-head">
	<div>
		<h1>Stores</h1>
		<p class="dim">Catalogs this Hamstr can get apps from. Browse and Get use the active one; each installed app keeps updating from the store it came from.</p>
	</div>
	<div class="head-actions"><button class="button" type="button" onclick={() => (editing = {})}>Add a store</button></div>
</div>

{#if data.stores.length}
	<div class="rows">
		{#each data.stores as s (s.id)}
			<div class="item">
				<div class="item-main">
					<strong>{s.name}</strong>
					<span class="dim small mono">{s.url}</span>
					{#if s.publicUrl !== s.url}<span class="dim small">Links: {s.publicUrl}</span>{/if}
				</div>
				<div class="item-side">
					{#if s.active}
						<span class="chip accent">Active</span>
					{:else}
						<button class="button small ghost" type="button" onclick={() => activate(s)}>Make active</button>
					{/if}
					<button class="button small ghost" type="button" onclick={() => (editing = s)}>Edit</button>
					<button class="button small danger" type="button" onclick={() => remove(s)}>Remove</button>
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="empty">
		<h2>No store registered</h2>
		<p>Add <span class="mono">https://appcrumb.store</span> (or another catalog). Fresh installs seed that automatically from <span class="mono">HAMSTR_STORE</span>.</p>
	</div>
{/if}

{#if editing}<StoreModal store={editing.id ? editing : null} onclose={() => (editing = null)} />{/if}
