export function load({ locals }) {
	return { network: locals.core.homeNetwork() };
}
