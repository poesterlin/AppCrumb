<script>
	// Settings → Addresses → On your network: ports, sslip.io or nip.io names.
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { toast } from "@hamstr/ui/state.svelte.ts";
	import { call } from "#lib/client/accounts.ts";
	import AddressField from "./AddressField.svelte";

	let { network } = $props();

	let names = $state(network.names);
	let address = $state(network.address);
	let busy = $state(false);
	let check = $state(null);

	const here = $derived(page.url.hostname);
	const port = $derived(page.url.port ? `:${page.url.port}` : "");
	const hereIsAddress = $derived(/^\d{1,3}(\.\d{1,3}){3}$/.test(here));
	const using = $derived(address.trim() || (hereIsAddress ? here : ""));
	const dashed = $derived((using || "192.168.1.5").replaceAll(".", "-"));
	const options = $derived([
		{ value: "off", title: "Ports", text: "Each app on its own port of this box. Works offline; the ports have to be reachable." },
		{ value: "sslip.io", title: "sslip.io names", text: `Names like crumb-abc.${dashed}.sslip.io on Hamstr's own port. Needs internet DNS.` },
		{ value: "nip.io", title: "nip.io names", text: "The same names through nip.io, for when sslip.io is blocked or down." },
	]);
	const sample = $derived(using ? `http://crumb-example.${dashed}.${names}${port}` : "");
	const dirty = $derived(names !== network.names || address.trim() !== network.address);
	const testing = $derived(check?.state === "testing");

	async function test() {
		check = { state: "testing" };
		const host = `test.${dashed}.${names}${port}`;
		try {
			await fetch(`http://${host}/api/health`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(6000) });
			check = { state: "ok", host };
		} catch {
			check = { state: "failed", host };
		}
	}
	async function save() {
		busy = true;
		try {
			await call("PUT", "/api/admin/home-network", { names, address: address.trim() });
			await invalidateAll();
			toast(names === "off" ? "Apps open on ports" : `Apps open on ${names} names`);
		} finally {
			busy = false;
		}
	}
</script>

<section class="section first">
	<h2>On your network</h2>
	<div class="choices" role="radiogroup" aria-label="How apps are reached on your network">
		{#each options as o (o.value)}
			<label class="choice" class:on={names === o.value}>
				<input type="radio" name="names" value={o.value} bind:group={names} />
				<span class="choice-text">
					<span class="choice-title">
						<strong>{o.title}</strong>
						{#if network.names === o.value}<span class="chip accent">In use</span>{/if}
					</span>
					<span class="dim small">{o.text}</span>
				</span>
			</label>
		{/each}
	</div>

	{#if names !== "off"}
		<AddressField bind:address {here} {hereIsAddress} {sample} {check} />
	{/if}

	<div class="actions">
		{#if names !== "off"}<button class="button ghost" type="button" disabled={!using || testing} onclick={test}>{testing ? "Testing…" : "Test"}</button>{/if}
		<button class="button" type="button" disabled={!dirty || busy} onclick={save}>{busy ? "Saving…" : "Save"}</button>
	</div>
</section>

<style>
	.choices {
		display: grid;
		gap: 8px;
	}
	.choice {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.choice:hover {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
	}
	.choice.on {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.choice input {
		flex: none;
		width: 18px;
		height: 18px;
		margin: 2px 0 0;
		accent-color: var(--accent);
	}
	.choice-text {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	.choice-title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 8px;
	}
	@media (max-width: 640px) {
		.choice {
			padding: 14px;
		}
	}
</style>
