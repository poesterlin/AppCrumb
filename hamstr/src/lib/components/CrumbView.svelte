<script>
	import { onMount } from "svelte";
	import { goto, invalidateAll } from "$app/navigation";
	import { api } from "#lib/client/api.ts";
	import { askManage, oops, toast } from "#lib/client/ui.svelte.ts";
	import { ICON } from "@hamstr/ui/icons.ts";
	import AppIcon from "@hamstr/ui/components/AppIcon.svelte";
	import MoreMenu from "@hamstr/ui/components/MoreMenu.svelte";
	import { downloadCrumb } from "#lib/client/download.ts";
	import CrumbFrameFallback from "./CrumbFrameFallback.svelte";

	let { crumb, app } = $props();

	// Back to where it lives: the app's own page, or Home for a single-instance app.
	const back = $derived(app && app.instances !== "single" ? `/a/${app.slug}` : "/");

	// Only a device the admin approved at install (the manifest's `devices`) is
	// handed to the app's frame; the browser still asks the person.
	const frameAllow = $derived(["clipboard-write", "fullscreen", ...(app?.devices ?? [])].join("; "));
	const needsMic = $derived(Boolean(app?.devices?.includes("microphone")));

	let title = $state("");
	let frameSrc = $state("");
	/** loading → ready | failed. Failed shows an open-in-tab fallback (mixed content, blocked port, …). */
	let frameState = $state("loading");
	let frameEl = $state(null);
	let titleInput = $state(null);
	const mixed = $derived(Boolean(frameSrc && isMixedContent(frameSrc)));
	// Browsers allow the microphone on https and localhost only.
	const micBlocked = $derived(Boolean(needsMic && frameSrc && !micAllowed(frameSrc)));

	$effect(() => {
		title = crumb.title;
	});

	function isMixedContent(url) {
		try {
			return location.protocol === "https:" && new URL(url).protocol === "http:";
		} catch {
			return false;
		}
	}

	function micAllowed(url) {
		try {
			const u = new URL(url);
			return u.protocol === "https:" || u.hostname === "localhost" || u.hostname.endsWith(".localhost") || /^127\./.test(u.hostname);
		} catch {
			return false;
		}
	}

	function markReady() {
		if (frameState !== "loading") return;
		frameState = "ready";
	}

	function markFailed() {
		if (frameState !== "loading") return;
		frameState = "failed";
	}

	function onFrameLoad() {
		// Cross-origin crumb: reading location throws ⇒ real page. Browser error /
		// frame-ancestors interstitial pages are often readable ⇒ treat as failed.
		let href = "";
		try {
			href = frameEl?.contentWindow?.location?.href ?? "";
		} catch {
			markReady();
			return;
		}
		if (!href || href === "about:blank") return;
		if (href.startsWith("chrome-error://") || href.includes("chromewebdata") || href.startsWith("chrome://")) {
			markFailed();
			return;
		}
		markReady();
	}

	onMount(() => {
		let timer = 0;
		let cancelled = false;
		(async () => {
			try {
				const { url } = await api(`/api/crumbs/${crumb.id}/open`, { method: "POST", body: { path: "/" } });
				if (cancelled) return;
				frameSrc = url;
				if (isMixedContent(url)) {
					markFailed();
					return;
				}
				timer = window.setTimeout(markFailed, 4000);
			} catch (err) {
				if (cancelled) return;
				markFailed();
				oops(err);
			}
		})();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	async function saveTitle() {
		const value = title.trim();
		if (!value || value === crumb.title) return void (title = crumb.title);
		try {
			await api(`/api/crumbs/${crumb.id}`, { method: "PATCH", body: { title: value } });
			await invalidateAll();
		} catch (err) {
			title = crumb.title;
			oops(err);
		}
	}

	async function download() {
		toast("Preparing the download…");
		try {
			toast(`Downloaded ${await downloadCrumb(crumb.id)}`);
		} catch (err) {
			oops(err);
		}
	}

	function renameNow() {
		titleInput?.focus();
		titleInput?.select();
	}

	const menu = $derived([
		{ label: "Rename", icon: "pencil", onclick: renameNow },
		{ label: "Manage data…", icon: "download", hidden: !app, onclick: () => askManage(crumb, app) },
		{ label: `About ${app?.name ?? "this app"}`, icon: "info", hidden: !app, onclick: () => goto(`/a/${app.slug}`) },
		{ label: "Move to trash", icon: "trash", danger: true, separator: true, onclick: trash },
	]);

	async function trash() {
		try {
			await api(`/api/crumbs/${crumb.id}/trash`, { method: "POST", body: {} });
			toast("Moved to the trash");
			await goto(back);
		} catch (err) {
			oops(err);
		}
	}

	function onTitleKey(event) {
		if (event.key === "Enter") event.currentTarget.blur();
		if (event.key === "Escape") {
			title = crumb.title;
			event.currentTarget.blur();
		}
	}
</script>

<div class="crumb-view">
	<div class="crumb-bar">
		<a class="icon-button" href={back} aria-label="Back" title="Back">{@html ICON.back}</a>
		<a class="crumb-app" href={app ? `/a/${app.slug}` : back} title={app ? `All of ${app.name}` : "Back"}>
			<AppIcon app={crumb.app} />
			<span class="hide-sm">{crumb.app.name}</span>
		</a>
		<span class="crumb-sep hide-sm">{@html ICON.chevron}</span>
		<input
			class="crumb-title"
			bind:this={titleInput}
			bind:value={title}
			maxlength="80"
			aria-label="Name"
			title="Click to rename"
			onblur={saveTitle}
			onkeydown={onTitleKey}
		/>
		<span class="spacer"></span>
		{#if app?.canExport}
			<button type="button" class="icon-button hide-sm" onclick={download} aria-label="Download data" title="Download data">{@html ICON.download}</button>
		{/if}
		<a class="icon-button" href="/c/{crumb.id}/open" target="_blank" rel="noopener" aria-label="Open in a new tab" title="Open in a new tab">
			{@html ICON.external}
		</a>
		<MoreMenu items={menu} />
	</div>
	{#if micBlocked}
		<div class="callout warn crumb-warn" role="alert">
			<strong>{app.name} needs the microphone, but this page is not on https.</strong>
			<span class="small">Your browser blocks the microphone on plain http addresses, so the app can't listen here. Open Hamstr over https (a Tailscale or Cloudflare link, or a reverse proxy with a certificate) and it will work.</span>
		</div>
	{/if}
	{#if frameState === "failed"}
		<CrumbFrameFallback title={crumb.title} href={frameSrc || `/c/${crumb.id}/open`} {mixed} />
	{:else if frameSrc}
		<!-- A crumb is another origin. No top navigation without a click, so an
		     app cannot silently replace the shell with a look-alike page. -->
		<iframe
			bind:this={frameEl}
			class="crumb-frame"
			title={crumb.title}
			sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation"
			allow={frameAllow}
			src={frameSrc}
			hidden={frameState !== "ready"}
			onload={onFrameLoad}></iframe>
		{#if frameState === "loading"}
			<div class="crumb-loading"><span class="spinner"></span></div>
		{/if}
	{:else}
		<div class="crumb-loading"><span class="spinner"></span></div>
	{/if}
</div>
