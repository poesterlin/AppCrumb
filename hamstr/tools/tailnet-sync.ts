// One reconcile of Tailscale Services against the crumbs in hamstr.db (read-only).
//   node tools/tailnet-sync.ts [--dry-run] [--db /data/hamstr/hamstr.db]
// Env: TAILSCALE_OAUTH_CLIENT_ID / TAILSCALE_OAUTH_CLIENT_SECRET (or *_FILE),
// TAILNET (default "-"), TAILNET_UPSTREAM (default http://127.0.0.1:8000).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createTailnetServices } from "../lib/tailnet-services.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dbPath = args.includes("--db") ? args[args.indexOf("--db") + 1] : `${process.env.HAMSTR_DATA ?? "/data"}/hamstr.db`;
const secret = (name: string) => process.env[name] ?? (process.env[`${name}_FILE`] ? readFileSync(process.env[`${name}_FILE`]!, "utf8").trim() : "");

const db = new DatabaseSync(dbPath, { readOnly: true });
// Live crumbs only: trashed ones are not served.
const rows = db.prepare("SELECT id, title FROM crumbs WHERE trashed_at IS NULL").all() as { id: string; title: string }[];
db.close();

const services = createTailnetServices({
	clientId: secret("TAILSCALE_OAUTH_CLIENT_ID"),
	clientSecret: secret("TAILSCALE_OAUTH_CLIENT_SECRET"),
	tailnet: process.env.TAILNET || "-",
	upstream: process.env.TAILNET_UPSTREAM || "http://127.0.0.1:8000",
	// Marks the definitions this Hamstr created; only those are ever deleted. Unset: none are.
	instance: process.env.TAILNET_INSTANCE || "",
	maxRemovals: Number(process.env.TAILNET_MAX_REMOVALS || 20)
});
const result = await services.reconcile(rows.map((r) => ({ id: r.id, comment: "Hamstr crumb" })), { dryRun });
console.log(`${dryRun ? "plan (nothing changed)" : "done"}: ${rows.length} crumbs, added ${result.added}, removed ${result.removed}, unchanged ${result.unchanged}, failed ${result.failed}`);
for (const line of result.plan) console.log(`  ${line}`);
process.exit(result.failed ? 1 : 0);
