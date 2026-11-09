<script>
	// A connected tailnet: Hamstr's link, how many apps have a name, the last sync.
	import { timeAgo } from "@hamstr/ui/format.ts";
	import { when } from "#lib/client/accounts.ts";

	let { ts, busy, editing = $bindable(), onsync, onoff } = $props();
	const apps = $derived(`${ts.services} ${ts.services === 1 ? "app has" : "apps have"} a name`);
</script>

<div class="rows status">
	<div class="item">
		<div class="item-main wrap">
			<span class="dim small">Hamstr</span>
			{#if ts.shell}<a class="mono" href="https://{ts.shell}">https://{ts.shell}</a>{:else}<span class="dim">Not on the tailnet yet</span>{/if}
		</div>
	</div>
	<div class="item">
		<div class="item-main wrap">
			<span class="dim small">Apps</span>
			<span>{apps}{#if ts.domain}&nbsp;under <span class="mono">{ts.domain}</span>{/if}</span>
		</div>
	</div>
	<div class="item">
		<div class="item-main wrap">
			<span class="dim small">Last sync</span>
			<span>{ts.lastSync ? timeAgo(when(ts.lastSync.at)) : "Not yet"}</span>
		</div>
	</div>
</div>
{#if ts.error}<p class="callout error">{ts.error}</p>{/if}
<div class="actions">
	<button class="button ghost" type="button" disabled={!!busy} onclick={() => (editing = !editing)}>{editing ? "Cancel" : "Change"}</button>
	<button class="button ghost" type="button" disabled={!!busy} onclick={onsync}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
	<button class="button danger" type="button" disabled={!!busy} onclick={onoff}>{busy === "off" ? "Turning off…" : "Turn off"}</button>
</div>

<style>
	.status {
		margin-bottom: 12px;
	}
	.item-main.wrap > * {
		white-space: normal;
	}
</style>
