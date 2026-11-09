export async function load({ locals }) {
	const c = locals.core;
	return { network: c.homeNetwork(), tailnet: c.tailnet ? await c.tailnet.status() : null };
}
