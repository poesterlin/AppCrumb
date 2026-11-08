// A small JSON Schema checker for tools/celld.schema.json. It understands only
// the keywords that schema uses (type, enum, const, anyOf, properties,
// additionalProperties, items, pattern, minLength), so it needs no dependency.
// Returns one message per problem, each starting with the JSON path.

const typeOf = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
const show = (value: unknown) => JSON.stringify(value);

/** The forms an `anyOf` allows, as text for the error message. */
const describeOption = (option: any): string => ("const" in option ? show(option.const) : `${option.type ?? "value"}${option.pattern ? ` matching ${option.pattern}` : ""}`);

function checkValue(schema: any, value: unknown, path: string): string[] {
	const errors: string[] = [];
	if ("const" in schema && value !== schema.const) errors.push(`${path} must be ${show(schema.const)}`);
	if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.map(show).join(", ")}`);
	if (schema.anyOf && !schema.anyOf.some((option: any) => validate(option, value, path).length === 0)) {
		errors.push(`${path} matches none of the allowed forms: ${schema.anyOf.map(describeOption).join(" | ")}`);
	}
	return errors;
}

function checkString(schema: any, value: string, path: string): string[] {
	const errors: string[] = [];
	if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must not be empty`);
	if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} must match ${schema.pattern}`);
	return errors;
}

function checkObject(schema: any, value: Record<string, unknown>, path: string): string[] {
	const properties = schema.properties ?? {};
	const errors: string[] = [];
	for (const [key, item] of Object.entries(value)) {
		if (item === undefined) continue; // an absent optional field
		if (key in properties) errors.push(...validate(properties[key], item, `${path}.${key}`));
		else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a known field (known: ${Object.keys(properties).join(", ")})`);
	}
	return errors;
}

export function validate(schema: any, value: unknown, path = "$"): string[] {
	const kind = typeOf(value);
	if (schema.type) {
		const types: string[] = [].concat(schema.type);
		if (!types.includes(kind)) return [`${path} must be ${types.join(" or ")}, not ${kind}`];
	}
	const errors = checkValue(schema, value, path);
	if (kind === "string") errors.push(...checkString(schema, value as string, path));
	if (kind === "array" && schema.items) (value as unknown[]).forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
	if (kind === "object") errors.push(...checkObject(schema, value as Record<string, unknown>, path));
	return errors;
}
