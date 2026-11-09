<script>
	// What to set up in the Tailscale admin console before connecting.
	const policy = `"tagOwners": {
  "tag:server": ["autogroup:admin"],
  "tag:container": ["autogroup:admin", "tag:server"]
},
"autoApprovers": {
  "services": { "tag:container": ["tag:server"] }
}`;
</script>

<details class="note">
	<summary>Set up Tailscale first</summary>
	<ol class="small steps">
		<li>
			In your tailnet policy, let Hamstr tag itself and approve its services:
			<pre class="mono">{policy}</pre>
			Your policy also has to let your devices reach <span class="mono">tag:container</span> on port 443.
		</li>
		<li>
			Under <a href="https://login.tailscale.com/admin/settings/oauth" target="_blank" rel="noreferrer">Settings → OAuth clients</a>, create a client with write access to
			<strong>Auth Keys</strong> and <strong>Services</strong>, both with the tags <span class="mono">tag:server</span> and <span class="mono">tag:container</span>.
		</li>
		<li>Paste its ID and secret below. Hamstr joins your tailnet as a machine of its own and makes a Tailscale Service per app. The secret stays on this box.</li>
	</ol>
</details>

<style>
	.steps {
		margin: 10px 0 0;
		padding-left: 1.2rem;
	}
	.steps li {
		min-width: 0;
	}
	.steps li + li {
		margin-top: 10px;
	}
	pre {
		margin: 8px 0;
		padding: 10px 12px;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
		max-width: 100%;
		overflow-x: auto;
	}
</style>
