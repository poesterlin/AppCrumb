<script>
	// Settings → Addresses → Tailscale: Hamstr's own machine and a service per app.
	import { invalidateAll } from "$app/navigation";
	import { toast } from "@hamstr/ui/state.svelte.ts";
	import { call } from "#lib/client/accounts.ts";
	import TailscaleForm from "./TailscaleForm.svelte";
	import TailscaleSetup from "./TailscaleSetup.svelte";
	import TailscaleStatus from "./TailscaleStatus.svelte";

	let { ts } = $props();
	let editing = $state(false);
	let busy = $state("");
	const chips = { running: { cls: "ok", text: "Connected" }, connecting: { cls: "", text: "Connecting" }, error: { cls: "warn", text: "Needs attention" } };
	const chip = $derived((ts.configured && chips[ts.state]) || { cls: "", text: "Off" });

	async function act(label, method, path, body) {
		busy = label;
		try {
			const status = await call(method, path, body);
			await invalidateAll();
			return status;
		} finally {
			busy = "";
		}
	}
	async function connect(fields) {
		const status = await act("connect", "PUT", "/api/admin/tailnet", fields);
		editing = false;
		toast(status.shell ? `Hamstr is on your tailnet as ${status.shell}` : "Connected to Tailscale");
	}
	async function syncNow() {
		const status = await act("sync", "POST", "/api/admin/tailnet/sync");
		toast(status.error ? "Synced, with problems" : "Synced");
	}
	async function turnOff() {
		if (!confirm("Remove Hamstr and its app names from your tailnet?")) return;
		await act("off", "DELETE", "/api/admin/tailnet");
		toast("Tailscale is off");
	}
</script>

<section class="section">
	<div class="section-head">
		<h2>Tailscale</h2>
		<span class="chip {chip.cls}">{chip.text}</span>
	</div>
	<p class="dim lead">
		An https name on your tailnet for Hamstr and each app, like <span class="mono">crumb-abc.{ts.domain || "your-tailnet.ts.net"}</span>. Opened over Tailscale, apps use these names;
		on your network they keep the addresses above.
	</p>

	{#if !ts.available && !ts.configured}
		<p class="callout">This install has no Tailscale built in. The Hamstr appliance and Home Assistant add-on have it.</p>
	{:else}
		{#if ts.configured}
			<TailscaleStatus {ts} {busy} bind:editing onsync={syncNow} onoff={turnOff} />
		{:else}
			<TailscaleSetup />
		{/if}
		{#if !ts.configured || editing}
			<TailscaleForm {ts} {busy} onconnect={connect} />
		{/if}
		<p class="callout warn small">Home mode has no sign-in: anyone your tailnet policy lets reach these tags can open Hamstr and every app.</p>
	{/if}
</section>

<style>
	.section-head h2 {
		margin: 0;
	}
	.lead {
		margin: 0 0 14px;
	}
</style>
