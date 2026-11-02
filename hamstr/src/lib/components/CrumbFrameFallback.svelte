<script>
	/** Open-tab fallback when a crumb cannot run inside the shell iframe. */
	let { title, href, mixed = false } = $props();
</script>

<div class="crumb-frame-fallback" role="status">
	<h1>{title}</h1>
	<p>
		{#if mixed}
			{title} opens in its own tab when this page is https and the app is plain http — the browser blocks it in this frame.
		{:else}
			{title} opens in its own tab when it cannot run inside this panel.
		{/if}
	</p>
	<a class="button" href={href} target="_blank" rel="noopener">Open {title}</a>
	{#if href.startsWith("http")}
		<p>Address:</p>
		<ul>
			<li><a href={href} target="_blank" rel="noopener"><code>{href}</code></a></li>
		</ul>
	{/if}
	{#if mixed}
		<p class="dim">This app uses plain HTTP on its own port. Open it in a new tab, or use Hamstr over http on your home network.</p>
	{/if}
</div>
