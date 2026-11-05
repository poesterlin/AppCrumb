<script>
	import { page } from "$app/state";
	import Toaster from "@hamstr/ui/components/Toaster.svelte";
	import { api } from "#lib/api.ts";

	let { children } = $props();

	const path = $derived(page.url.pathname);
	const demo = $derived(path.startsWith("/demo/"));

	let scrolled = $state(false);
	let legal = $state({ imprint: null, privacy: null });
	$effect(() => {
		api("/api/health")
			.then((h) => (legal = h.legal ?? legal))
			.catch(() => {});
	});

	const links = $derived([
		{ href: "/", label: "Apps", current: path === "/" || path.startsWith("/apps/") },
		{ href: "/about", label: "About", current: path === "/about" },
		{ href: "/publish", label: "Submit", current: path === "/publish" || path === "/policy" },
	]);
</script>

<svelte:window onscroll={() => (scrolled = window.scrollY > 4)} />

{#if !demo}
	<header class="bar" class:scrolled>
		<a class="brand" href="/">
			<img src="/crumb.svg" width="32" height="32" alt="" />
			<span class="wordmark">appcrumb<span class="tld">.store</span></span>
		</a>
		<nav class="nav" aria-label="Main">
			{#each links as link (link.href)}
				<a href={link.href} aria-current={link.current ? "page" : undefined}>{link.label}</a>
			{/each}
		</nav>
		<a class="button small" href="/account" aria-current={path === "/account" ? "page" : undefined}>Sign in</a>
	</header>
{/if}

<main aria-live="polite">{@render children()}</main>

{#if !demo}
	<footer class="foot">
		<nav aria-label="Store">
			<a href="https://docs.appcrumb.store" rel="noopener">Docs</a>
			<a href="/api/v1/apps">API</a>
			<a href="https://github.com/poesterlin/AppCrumb" rel="noopener">GitHub</a>
		</nav>
		<nav aria-label="Policies">
			<a href="/policy">Content policy</a>
			{#if legal.imprint}<a href={legal.imprint} data-sveltekit-reload>Impressum</a>{/if}
			{#if legal.privacy}<a href={legal.privacy} data-sveltekit-reload>Datenschutz</a>{/if}
		</nav>
	</footer>
{/if}

<Toaster />
