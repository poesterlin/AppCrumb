<script>
	// The OAuth client and tags. An empty secret keeps the saved one for the same client.
	let { ts, busy, onconnect } = $props();
	let clientId = $state(ts.clientId ?? "");
	let clientSecret = $state("");
	let tags = $state((ts.tags ?? []).join(", "));
	let serviceTag = $state(ts.serviceTag ?? "");
	const keepsSecret = $derived(ts.configured && clientId.trim() === ts.clientId);
	const canConnect = $derived(clientId.trim() && (clientSecret.trim() || keepsSecret));

	async function submit(e) {
		e.preventDefault();
		await onconnect({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), tags, serviceTag });
		clientSecret = "";
	}
</script>

<form class="tsform" onsubmit={submit}>
	<div class="field">
		<label for="ts-id">OAuth client ID</label>
		<input id="ts-id" class="input mono" bind:value={clientId} autocomplete="off" spellcheck="false" placeholder="k1AbCdEf2CNTRL" />
	</div>
	<div class="field">
		<label for="ts-secret">OAuth client secret</label>
		<input id="ts-secret" class="input mono" type="password" bind:value={clientSecret} autocomplete="off" spellcheck="false" placeholder={ts.configured ? "Unchanged" : "tskey-client-…"} />
	</div>
	<details class="note">
		<summary>Tags</summary>
		<div class="field spaced">
			<label for="ts-tags">Hamstr's machine</label>
			<input id="ts-tags" class="input mono" bind:value={tags} autocomplete="off" spellcheck="false" />
		</div>
		<div class="field">
			<label for="ts-svc">Each app's service</label>
			<input id="ts-svc" class="input mono" bind:value={serviceTag} autocomplete="off" spellcheck="false" />
		</div>
	</details>
	<div class="actions">
		<button class="button" type="submit" disabled={!canConnect || !!busy}>{busy === "connect" ? "Connecting…" : ts.configured ? "Save and reconnect" : "Connect"}</button>
	</div>
</form>

<style>
	.tsform {
		margin-top: 16px;
	}
</style>
