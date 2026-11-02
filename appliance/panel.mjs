// The Home Assistant sidebar panel (ingress): try to show Hamstr inside the
// panel when the browser will allow it (same scheme — typically both HTTP), and
// otherwise offer links that open Hamstr in its own tab. Ingress serves this
// through Home Assistant's address; Hamstr itself answers on the box's address.
//   node panel.mjs <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const env = process.env;
const links = [];
if (env.TLS_HOSTNAME && env.HAMSTR_AUTH !== "none") {
	const port = env.HTTPS_PORT === "443" ? "" : `:${env.HTTPS_PORT}`;
	links.push({ url: `https://${env.TLS_HOSTNAME}${port}/`, note: "Your Hamstr" });
} else {
	const port = `:${env.HTTP_PORT}`;
	// Always homeassistant.local — the add-on's hostname is like e1255cb9-hamstr,
	// which is not a LAN DNS name and must not become *.local.
	links.push({ url: `http://homeassistant.local${port}/`, note: "On your home network" });
	for (const a of Object.values(networkInterfaces()).flat()) {
		if (a.family !== "IPv4" || a.internal) continue;
		// Docker's and the Supervisor's own bridges are not reachable from outside.
		if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) continue;
		const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address);
		links.push({ url: `http://${a.address}${port}/`, note: tailscale ? "Over Tailscale" : "By IP address" });
	}
}
const [first, ...rest] = links;
// Prefer a LAN IP for the iframe: .local is flaky from some clients, and the
// add-on hostname must never be used (see above).
const embed = links.find((l) => l.note === "By IP address") ?? first;
const embedUrl = JSON.stringify(embed.url);
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Hamstr</title>
<style>
html,body{height:100%;margin:0}
body{font:18px/1.6 system-ui,sans-serif;color:#18181b;background:#f7f7f9}
body.embedded{overflow:hidden;background:#111}
#embed{position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff}
#embed[hidden]{display:none!important}
#fallback{max-width:34em;margin:0 auto;padding:32px 20px}
a.button{display:inline-block;background:#5452e8;color:#fff;text-decoration:none;font-weight:600;border-radius:12px;padding:14px 22px;margin:8px 0 24px}
ul{padding-left:1.2em}li{margin:6px 0}code{font-size:16px}p.dim{color:#5b5b66}
@media(prefers-color-scheme:dark){body{color:#f4f4f6;background:#111116}a{color:#9d9cff}a.button{color:#fff}p.dim{color:#a3a3ad}}
</style></head><body>
<iframe id="embed" title="Hamstr" hidden></iframe>
<div id="fallback">
<h1>Hamstr</h1>
<p>Hamstr opens in its own tab when it cannot run inside this panel.</p>
<a class="button" href="${esc(first.url)}" target="_blank" rel="noopener">Open Hamstr</a>
${rest.length ? `<p>Other addresses:</p><ul>${rest.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener"><code>${esc(l.url)}</code></a> ${esc(l.note)}</li>`).join("")}</ul>` : ""}
${env.HAMSTR_AUTH === "none" ? `<p class="dim">Hamstr uses plain HTTP here. It works on your home network and over Tailscale.
If your browser changes the address to https://, allow http for it.</p>` : ""}
</div>
<script>
(function () {
	var url = ${embedUrl};
	var iframe = document.getElementById("embed");
	var fallback = document.getElementById("fallback");
	var pageHttps = location.protocol === "https:";
	var targetHttp = url.indexOf("http:") === 0;
	// Mixed content: an https Home Assistant page cannot frame http Hamstr.
	if (pageHttps && targetHttp) return;
	var settled = false;
	function embedded() {
		if (settled) return;
		settled = true;
		document.body.className = "embedded";
		fallback.hidden = true;
		iframe.hidden = false;
	}
	function giveUp() {
		if (settled) return;
		settled = true;
		try { iframe.removeAttribute("src"); } catch (e) {}
		iframe.hidden = true;
		fallback.hidden = false;
		document.body.className = "";
	}
	iframe.addEventListener("load", function () {
		// Cross-origin Hamstr: reading location throws ⇒ real page. about:blank
		// or a browser error page is often readable ⇒ keep the open button.
		try {
			var href = iframe.contentWindow && iframe.contentWindow.location.href;
			if (!href || href === "about:blank" || href.indexOf("chrome-error://") === 0 || href.indexOf("chromewebdata") !== -1) return;
			embedded();
		} catch (e) {
			embedded();
		}
	});
	iframe.src = url;
	setTimeout(giveUp, 4000);
})();
</script>
</body></html>
`;
mkdirSync(process.argv[2], { recursive: true });
writeFileSync(join(process.argv[2], "index.html"), page);
