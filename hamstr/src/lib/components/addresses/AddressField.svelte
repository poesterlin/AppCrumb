<script>
	// The box's address for sslip.io / nip.io names, an example, and the Test result.
	let { address = $bindable(), here, hereIsAddress, sample, check } = $props();
</script>

<div class="field spaced">
	<label for="address">This box's IPv4 address</label>
	<input id="address" class="input mono" bind:value={address} placeholder={hereIsAddress ? here : "192.168.1.5"} autocomplete="off" inputmode="decimal" />
	<span class="dim small">
		{#if hereIsAddress}Optional. Empty uses the address in your address bar.
		{:else}Needed: you opened Hamstr as <span class="mono">{here}</span>, a name. Without an address apps open on ports.{/if}
	</span>
</div>
{#if sample}<p class="dim small sample">Example: <span class="mono">{sample}</span></p>{/if}
{#if check?.state === "ok"}
	<p class="callout">It works: your browser found <span class="mono">{check.host}</span> and reached Hamstr.</p>
{:else if check?.state === "failed"}
	<p class="callout error">Your browser could not reach <span class="mono">{check.host}</span>. Check the address and your internet DNS; your router may block public names for private addresses. Try the other service, or ports.</p>
{/if}
<details class="note">
	<summary>About public names</summary>
	<p class="dim small">sslip.io and nip.io are public DNS services: they need internet access, and some routers block names that point at private addresses (DNS rebinding protection), which Test shows. The domains are shared with everyone, so any site on them can set cookies your apps also see; if an app fails with a "too large" error, clear that domain's cookies or use ports.</p>
</details>

<style>
	.sample {
		margin: -4px 0 12px;
		overflow-wrap: anywhere;
	}
</style>
