export function load({ locals }) {
	return { stores: locals.core.storesList() };
}
