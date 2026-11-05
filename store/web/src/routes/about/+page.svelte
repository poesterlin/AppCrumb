<script>
	import { ICON } from "@hamstr/ui/icons.ts";
	import PrimitiveViz from "#lib/components/PrimitiveViz.svelte";
</script>

<svelte:head><title>How it works · AppCrumb</title></svelte:head>

<div class="page narrow">
	<p class="eyebrow dim">How it works</p>
	<h1>Any app, on your hardware.</h1>
	<p class="dim lead">
		AppCrumb is the app store. Hamstr is the software on your home server that runs the apps.
	</p>

	<div class="about-viz">
		<PrimitiveViz />
	</div>

	<div class="caps gap-top">
		<div class="cap">
			<span class="cap-icon">{@html ICON.grid}</span>
			<div><strong>Browse the catalog</strong><p class="dim small">AppCrumb hosts the app files and security checksums.</p></div>
		</div>
		<div class="cap">
			<span class="cap-icon">{@html ICON.download}</span>
			<div><strong>One-click install</strong><p class="dim small">Click Get. Your Hamstr downloads the app, checks the file, and adds it to your home screen.</p></div>
		</div>
		<div class="cap">
			<span class="cap-icon">{@html ICON.lock}</span>
			<div><strong>Private by default</strong><p class="dim small">Each app gets its own storage. Apps cannot read your other files or use the internet unless you allow it.</p></div>
		</div>
		<div class="cap">
			<span class="cap-icon">{@html ICON.restore}</span>
			<div><strong>Built-in updates and backups</strong><p class="dim small">Updates replace the app, not its data. Every item can be downloaded as a backup file and restored later.</p></div>
		</div>
	</div>

	<section class="section" id="how-it-works">
		<h2>How it works</h2>
		<p class="dim">
			A request goes to the celld router, which picks the site by hostname. The site's Worker
			runs in its own V8 isolate. Static files are served directly; only requests that need server code
			reach the Worker. State lives in Durable Objects.
		</p>
		<ul class="steps">
			<li><strong>One isolate per app.</strong> A separate JavaScript heap, so one app cannot read another app's memory.</li>
			<li><strong>One SQLite database per app.</strong></li>
			<li><strong>A request wakes the app.</strong> It loads its state from disk in about 100 ms.</li>
		</ul>
	</section>

	<section class="section" id="history">
		<h2>How we got here</h2>
		<ol class="steps">
			<li>
				<strong>Sandstorm.io, 2014.</strong> Kenton Varda's personal app server. Each document ran in its own
				container, called a grain, with capability-based access built on Cap'n Proto. It showed the model could
				work, but every grain was still a container, and the company ran out of funding in early 2017.
			</li>
			<li>
				<strong>Cloudflare Workers, 2017.</strong> The same sandboxing idea with V8 isolates instead of containers:
				thousands of small programs on one machine, started in milliseconds. Kenton started the project after
				joining Cloudflare.
			</li>
			<li>
				<strong>Durable Objects, 2020.</strong> Workers gained named, single-instance objects with durable storage,
				so compute and its data could live together. In 2024 that storage became SQLite.
			</li>
			<li>
				<strong>celld, from Deno.</strong> Takes Workers and Durable Objects off Cloudflare's network. Each node is
				one process that embeds V8, each object is a cell with its own SQLite, and the bucket is the source of
				truth. No control plane and no consensus service.
			</li>
			<li>
				<strong>This stack.</strong> celld, a host router, a local S3 bucket, AppCrumb and Hamstr. Sandstorm had the
				security model but the apps were heavy and distribution never took off. Workers had the runtime, but only
				in Cloudflare's cloud. This puts the runtime on your box and adds the store, identity and update path that
				were missing.
			</li>
		</ol>
	</section>

	<section class="section" id="get-hamstr">
		<h2>Get Hamstr</h2>
		<p class="dim">Hamstr runs on a Raspberry Pi, NAS, Home Assistant, or any small server. You access it from your phone or laptop using Tailscale.</p>
		<ol class="steps">
			<li>Install Tailscale on your phone and computer.</li>
			<li>Install Hamstr on your server (via Home Assistant, Umbrel, CasaOS, Unraid, or Docker).</li>
			<li>Connect Tailscale on the Hamstr setup page to get your private link.</li>
		</ol>
		<p class="dim small">No domain or router setup needed.</p>
	</section>
</div>

<style>
	.about-viz { margin: 18px 0 30px; }
</style>
