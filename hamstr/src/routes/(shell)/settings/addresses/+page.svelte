<script>
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { toast } from "@hamstr/ui/state.svelte.ts";
	import { call } from "#lib/client/accounts.ts";

	let { data } = $props();
	let names = $state(data.network.names);
	let address = $state(data.network.address);
	let busy = $state(false);
	let check = $state(null);

	const options = [
		{ value: "off", title: "Ports", text: "Each app gets its own port on this box. Works offline and on any network; the ports have to be reachable." },
		{ value: "sslip.io", title: "sslip.io names", text: "Each app gets a name like crumb-abc.192-168-1-5.sslip.io on Hamstr's own port. Needs internet DNS." },
		{ value: "nip.io", title: "nip.io names", text: "The same with nip.io, if sslip.io is blocked or down." },
	];
	const here = $derived(page.url.hostname);
	const hereIsAddress = $derived(/^\d{1,3}(\.\d{1,3}){3}$/.test(here));
	const using = $derived(address.trim() || (hereIsAddress ? here : ""));
	const sample = $derived(using ? `crumb-example.${using.replaceAll(".", "-")}.${names}${page.url.port ? `:${page.url.port}` : ""}` : "");
	const dirty = $derived(names !== data.network.names || address.trim() !== data.network.address);

	async function test() {
		check = { state: "testing" };
		const host = `test.${using.replaceAll(".", "-")}.${names}${page.url.port ? `:${page.url.port}` : ""}`;
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

<svelte:head><title>Addresses · Settings</title></svelte:head>

<div class="page-head">
	<div>
		<h1>Addresses</h1>
		<p class="dim">How your apps are reached. Every app runs on an address of its own, so apps stay separate from each other and from this page.</p>
	</div>
</div>

<div class="rows">
	{#each options as o (o.value)}
		<label class="item" style="cursor: pointer">
			<input type="radio" name="names" value={o.value} bind:group={names} />
			<div class="item-main"><strong>{o.title}</strong><span class="dim small">{o.text}</span></div>
			{#if data.network.names === o.value}<div class="item-side"><span class="chip accent">In use</span></div>{/if}
		</label>
	{/each}
</div>

{#if names !== "off"}
	<div class="field" style="margin-top: 1rem">
		<label for="address">This box's IPv4 address</label>
		<input id="address" class="input mono" bind:value={address} placeholder={hereIsAddress ? `${here} (from your address bar)` : "192.168.1.5"} autocomplete="off" />
		<span class="dim small">
			{#if hereIsAddress}Left empty, the address you opened Hamstr with ({here}) is used.
			{:else}You opened Hamstr as <span class="mono">{here}</span>, a name, so these names need the address typed here. Without it apps open on ports.{/if}
		</span>
	</div>
	{#if sample}<p class="dim small">Example: <span class="mono">http://{sample}</span></p>{/if}
	<p class="callout">sslip.io and nip.io are public domains shared with everyone, so any website on them can set cookies that your apps would also see; if an app stops loading with a "too large" error, clear cookies for that domain, or use ports. These names come from a public DNS service, so they need internet access. Some routers block public names that point at private addresses (DNS rebinding protection); use Test to check yours.</p>
	{#if check?.state === "ok"}
		<p class="callout">It works: your browser resolved <span class="mono">{check.host}</span> and reached Hamstr.</p>
	{:else if check?.state === "failed"}
		<p class="callout error">Your browser could not reach <span class="mono">{check.host}</span>. Check the address, your internet DNS, or your router's rebinding protection, or switch services or back to ports.</p>
	{/if}
{/if}

<div class="head-actions" style="margin-top: 1rem">
	{#if names !== "off"}<button class="button ghost" type="button" disabled={!using || check?.state === "testing"} onclick={test}>{check?.state === "testing" ? "Testing…" : "Test"}</button>{/if}
	<button class="button" type="button" disabled={!dirty || busy} onclick={save}>Save</button>
</div>
