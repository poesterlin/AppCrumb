<script>
	import { timeAgo } from "@hamstr/ui/format.ts";
	import { contextMenu } from "#lib/client/ui.svelte.ts";
	import AppIcon from "@hamstr/ui/components/AppIcon.svelte";

	let { crumb, meta: label = "", menu = () => [] } = $props();

	const meta = $derived(label || crumb.app.name);
	const hint = $derived(`${crumb.app.name}, opened ${timeAgo(crumb.openedAt ?? crumb.createdAt)}`);
</script>

<a class="tile" href="/c/{crumb.id}" title={hint} use:contextMenu={menu}>
	<AppIcon app={crumb.app} />
	<span class="tile-title">{crumb.title}</span>
	<span class="tile-meta">{meta}</span>
</a>
