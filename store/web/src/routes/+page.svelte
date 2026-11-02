<script>
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import AppCard from "@hamstr/ui/components/AppCard.svelte";
	import { ICON } from "@hamstr/ui/icons.ts";
	import { plural } from "@hamstr/ui/format.ts";
	import { api } from "#lib/api.ts";

	const query = $derived(page.url.searchParams.get("q") ?? "");
	const tag = $derived(page.url.searchParams.get("tag") ?? "");
	const category = $derived(page.url.searchParams.get("category") ?? "");

	let result = $state({ apps: [], total: 0 });
	let error = $state("");
	let loading = $state(true);
	let categories = $state([]);
	const shown = $derived(categories.filter((c) => c.count > 0 || c.id === category));
	const labelOf = $derived(new Map(categories.map((c) => [c.id, c.label])));

	$effect(() => {
		api("/api/v1/categories")
			.then((body) => (categories = body.categories))
			.catch(() => {});
	});

	let request = 0;
	$effect(() => {
		const params = new URLSearchParams({ limit: "60" });
		if (query) params.set("q", query);
		if (tag) params.set("tag", tag);
		if (category) params.set("category", category);
		const seq = ++request;
		loading = true;
		api(`/api/v1/apps?${params}`)
			.then((body) => {
				if (seq !== request) return;
				result = body;
				error = "";
			})
			.catch((err) => seq === request && (error = err.message))
			.finally(() => seq === request && (loading = false));
	});

	function filter(next) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(next)) value ? params.set(key, value) : params.delete(key);
		goto(`?${params}`, { replace: true, reset: false });
	}

	let timer;
	function search(event) {
		const value = event.target.value.trim();
		clearTimeout(timer);
		timer = setTimeout(() => filter({ q: value }), 250);
	}

	function browseApps() {
		document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
	}
</script>

<svelte:head><title>AppCrumb · Tiny apps. Big ideas.</title></svelte:head>

<div class="page">
	<section class="home-hero" aria-label="Welcome">
		<div class="hero-copy">
			<p class="hero-kicker">Tiny apps. Big ideas.</p>
			<h1>The new self-hosting primitive.</h1>
			<p class="hero-lead">Apps that just do the thing. No ads, no logins, no upsells — open it, use it, close it.</p>
			<div class="hero-actions">
				<button type="button" class="button" onclick={browseApps}>Browse apps →</button>
				<a class="button ghost" href="/about">How it works</a>
			</div>
		</div>
		<div class="hero-visual" aria-hidden="true">
			<span class="hero-crumb c1"></span>
			<span class="hero-crumb c2"></span>
			<span class="hero-crumb c3"></span>
			<img class="hero-mascot" src="/crumb-mascot.webp" width="400" height="358" alt="" />
		</div>
	</section>

	<section id="catalog" aria-label="App catalog">
		<p class="catalog-label">The catalog</p>
		<div class="toolbar">
			<label class="search-box">
				{@html ICON.search}
				<input type="search" placeholder="Search for little apps…" aria-label="Search apps" value={query} oninput={search} />
			</label>
			{#if tag}
				<button type="button" class="chip accent removable" onclick={() => filter({ tag: "" })} aria-label="Stop filtering by #{tag}">
					#{tag} <span aria-hidden="true">×</span>
				</button>
			{/if}
		</div>
		{#if shown.length > 1}
			<div class="segmented categories" role="group" aria-label="Category">
				<button type="button" aria-pressed={!category} onclick={() => filter({ category: "" })}>All</button>
				{#each shown as c (c.id)}
					<button type="button" aria-pressed={category === c.id} onclick={() => filter({ category: c.id })}>
						{c.label} <span class="count">{c.count}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if error}
			<p class="callout error">{error}</p>
		{:else if loading && !result.apps.length}
			<p class="dim"><span class="spinner"></span> Loading apps…</p>
		{:else}
			<div class="cards" aria-busy={loading}>
				{#each result.apps as app (app.id)}
					<AppCard {app} href="/apps/{app.id}" meta="by {app.publisher} · v{app.version}">
						{#snippet actions()}
							{#if app.category}<span class="chip">{labelOf.get(app.category) ?? app.category}</span>{/if}
							<a class="button ghost small push" href="/apps/{app.id}">Details</a>
						{/snippet}
					</AppCard>
				{:else}
					<div class="empty span-all">
						<h2>No apps match</h2>
						{#if category || tag}
							<p>Nothing here matches yet. <button type="button" class="link-button" onclick={() => filter({ category: "", tag: "", q: "" })}>Show all apps</button></p>
						{:else}
							<p>Try another word, or <a href="/publish">publish one</a>.</p>
						{/if}
					</div>
				{/each}
			</div>
			{#if result.total}
				<p class="dim small hint">{plural(result.total, "app")} · <a href="/publish">Publish yours</a></p>
			{/if}
		{/if}
	</section>
</div>
