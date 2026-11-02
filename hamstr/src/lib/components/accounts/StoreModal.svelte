<script>
	import { invalidateAll } from "$app/navigation";
	import Modal from "@hamstr/ui/components/Modal.svelte";
	import { toast } from "@hamstr/ui/state.svelte.ts";
	import { call } from "#lib/client/accounts.ts";

	let { store, onclose } = $props();
	let draft = $state({
		name: store?.name ?? "",
		url: store?.url ?? "",
		publicUrl: store?.publicUrl && store.publicUrl !== store.url ? store.publicUrl : "",
	});

	async function save() {
		const body = {
			name: draft.name.trim(),
			url: draft.url.trim(),
			publicUrl: draft.publicUrl.trim() || undefined,
		};
		if (store?.id) await call("PATCH", `/api/admin/stores/${store.id}`, body);
		else await call("POST", "/api/admin/stores", body);
		onclose();
		await invalidateAll();
		toast("Saved");
	}
</script>

<Modal title={store?.id ? `Edit ${store.name}` : "Add a store"} sub="Browse and Get use the active store; updates keep using the store each app came from. You can register several and switch which one is active." {onclose}>
	<div class="field"><label for="sn">Name</label><input id="sn" class="input" bind:value={draft.name} placeholder="Shown in Settings" data-autofocus /></div>
	<div class="field"><label for="su">Store URL</label><input id="su" class="input" type="url" bind:value={draft.url} placeholder="https://appcrumb.store" autocomplete="off" spellcheck="false" /></div>
	<div class="field"><label for="sp">Public URL <span class="dim">(optional)</span></label><input id="sp" class="input" type="url" bind:value={draft.publicUrl} placeholder="Same as store URL" autocomplete="off" spellcheck="false" /></div>
	<p class="dim small">Use a public URL when Hamstr reaches the store on an internal address but links should open the public one.</p>
	<div class="sheet-foot"><button class="button" type="button" onclick={save} disabled={!draft.url.trim()}>Save</button></div>
</Modal>
