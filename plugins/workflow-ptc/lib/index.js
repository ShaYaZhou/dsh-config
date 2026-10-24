// packages/workflow/workflow-ptc/src/index.ts
import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import * as vm from "node:vm";
import z from "@deepseek-ai/schemastery";
import WorkflowEngine, { WorkflowError as WorkflowError3, WorkflowRunId } from "@deepseek-ai/dsh-workflow";

// packages/workflow/workflow-ptc/src/host.ts
import { SessionId } from "@deepseek-ai/dsh-session";
import { assertObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import { assertNever, snapshotJsonValue } from "@deepseek-ai/dsh-util-values";

// packages/workflow/workflow-ptc/src/guest-source.ts
var WORKFLOW_GUEST_SOURCE = 'import * as vm from "node:vm";\n//#region packages/workflow/workflow-ptc/src/realm.ts\n/**\n* Materializes script VM values as plain JSON and renders thrown values.\n* Getters and proxy traps may execute inside the confined Node process;\n* process isolation and cancellation belong to PTC, not the VM.\n* @module @deepseek-ai/dsh-workflow-ptc/realm\n*/\n/** Thrown by {@link materializeFromRealm}; the caller wraps it into the right `WorkflowError` code. */\nvar MaterializeError = class extends Error {\n	path;\n	reason;\n	constructor(path, reason) {\n		super(`${path}: ${reason}`);\n		this.path = path;\n		this.reason = reason;\n		this.name = "MaterializeError";\n	}\n};\n/**\n* Render a thrown value to failure text without ever throwing: prefer the\n* `stack` (host or realm \u2014 a realm error\'s `stack` is a plain string read),\n* fall back to `message`, then `String()`. Reading those properties MAY run\n* script code; if that code itself throws, a fixed label is returned instead.\n* @param error - any value thrown in the host or guest realm.\n* @returns human-readable text for the failure report; prefers the stack.\n*/\nfunction renderThrown(error) {\n	try {\n		const stack = error?.stack;\n		if (typeof stack === "string" && stack.length > 0) return stack;\n		const message = error?.message;\n		if (typeof message === "string" && message.length > 0) return message;\n		return String(error);\n	} catch {\n		return "[unrenderable thrown value]";\n	}\n}\n/**\n* Whether an object\'s prototype chain represents a plain data object: `null`, or a prototype\n* whose own prototype is `null` (the realm\'s `Object.prototype` \u2014 which we\n* cannot compare by identity across realms). A `Date`/`Map`/class instance\n* has a longer chain and is rejected.\n*/\nfunction hasPlainPrototype(value) {\n	const proto = Object.getPrototypeOf(value);\n	if (proto === null) return true;\n	return Object.getPrototypeOf(proto) === null;\n}\n/**\n* Copy `value` (typically from the vm realm) into plain host JSON data. Root `undefined` is\n* returned unchanged; nested `undefined` and values JSON cannot represent losslessly fail\n* with the offending path. Property accessors run normally, and a throwing read is wrapped\n* with its rendered failure.\n*\n* @param value - the realm value to materialize.\n* @param root - the path label for the root value (error messages).\n* @returns the host-realm copy (plain objects/arrays/scalars only).\n* @throws {@link MaterializeError} for unsupported values, cycles, sparse arrays, exotic\n*   prototypes, or property reads that throw.\n*/\nfunction materializeFromRealm(value, root = "value") {\n	if (value === void 0) return void 0;\n	try {\n		return materialize(value, root, /* @__PURE__ */ new Set());\n	} catch (error) {\n		if (error instanceof MaterializeError) throw error;\n		throw new MaterializeError(root, `reading the value threw: ${renderThrown(error)}`);\n	}\n}\nfunction materialize(value, path, seen) {\n	switch (typeof value) {\n		case "boolean":\n		case "string": return value;\n		case "number":\n			if (!Number.isFinite(value)) throw new MaterializeError(path, "non-finite numbers are not JSON data");\n			return value;\n		case "bigint": throw new MaterializeError(path, "bigints are not JSON data");\n		case "function": throw new MaterializeError(path, "functions are not plain JSON data");\n		case "symbol": throw new MaterializeError(path, "symbols are not plain JSON data");\n		case "undefined": throw new MaterializeError(path, "undefined is not JSON data");\n		case "object": break;\n	}\n	if (value === null) return null;\n	const objectValue = value;\n	if (seen.has(objectValue)) throw new MaterializeError(path, "circular references are not JSON data");\n	seen.add(objectValue);\n	try {\n		if (Array.isArray(objectValue)) return materializeArray(objectValue, path, seen);\n		return materializeObject(objectValue, path, seen);\n	} finally {\n		seen.delete(objectValue);\n	}\n}\nfunction materializeArray(value, path, seen) {\n	const out = [];\n	for (let index = 0; index < value.length; index++) {\n		if (!(index in value)) throw new MaterializeError(`${path}[${index}]`, "sparse arrays are not JSON data");\n		out.push(materialize(value[index], `${path}[${index}]`, seen));\n	}\n	for (const key of Object.keys(value)) {\n		const index = Number(key);\n		if (!Number.isInteger(index) || index < 0 || index >= value.length) throw new MaterializeError(`${path}.${key}`, "arrays with non-index properties are not JSON data");\n	}\n	if (Object.getOwnPropertySymbols(value).length > 0) throw new MaterializeError(path, "symbol-keyed properties are not plain JSON data");\n	return out;\n}\nfunction materializeObject(value, path, seen) {\n	if (!hasPlainPrototype(value)) throw new MaterializeError(path, "only plain objects and arrays are JSON data (exotic prototype)");\n	if (Object.getOwnPropertySymbols(value).length > 0) throw new MaterializeError(path, "symbol-keyed properties are not plain JSON data");\n	const out = {};\n	for (const key of Object.keys(value)) Object.defineProperty(out, key, {\n		value: materialize(value[key], `${path}.${key}`, seen),\n		enumerable: true,\n		writable: true,\n		configurable: true\n	});\n	return out;\n}\n//#endregion\n//#region packages/util/brand/src/index.ts\n/**\n* Apply a compile-time string brand without changing the value.\n* @param value - string admitted by the domain that owns the target brand.\n* @returns the same string with the requested compile-time brand.\n*/\nfunction brandString(value) {\n	return value;\n}\n//#endregion\n//#region packages/util/values/src/index.ts\n/**\n* Mark an unreachable closed-union branch.\n* @param value - impossible value; an unhandled typed variant fails at the call site.\n* @param context - optional switch-site label included in the failure message.\n* @returns never; a runtime value that escaped its type always throws.\n*/\nfunction assertNever(value, context) {\n	const rendered = JSON.stringify(value) ?? String(value);\n	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);\n}\n/** Whether a realm-owned intrinsic prototype has a native constructor matching this engine\'s representation. */\nfunction hasIntrinsicConstructor$1(prototype, name) {\n	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;\n	if (typeof constructor !== "function") return false;\n	try {\n		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);\n	} catch {\n		return false;\n	}\n}\n/** Whether a candidate is one realm\'s intrinsic `Object.prototype`. */\nfunction isIntrinsicObjectPrototype$1(value) {\n	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");\n}\n/** Whether an array uses one realm\'s intrinsic `Array.prototype`, not a subclass or forged prototype. */\nfunction hasPlainArrayPrototype$1(value) {\n	const prototype = Object.getPrototypeOf(value);\n	if (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;\n	const objectPrototype = Object.getPrototypeOf(prototype);\n	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);\n}\n/** Whether an object is a plain or null-prototype record from any JavaScript realm. */\nfunction hasPlainObjectPrototype(value) {\n	const prototype = Object.getPrototypeOf(value);\n	return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);\n}\n/** Return every JSON-visible object key, or reject own data JSON would discard. */\nfunction enumerableStringKeys(value) {\n	const keys = Reflect.ownKeys(value);\n	if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;\n	return keys;\n}\n/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */\nfunction walkJsonValue(value, detach) {\n	const ancestors = /* @__PURE__ */ new Set();\n	let root;\n	const assign = (destination, item) => {\n		if (destination === void 0) return;\n		if (destination.kind === "root") root = item;\n		else if (destination.kind === "array") destination.target[destination.index] = item;\n		else Object.defineProperty(destination.target, destination.key, {\n			value: item,\n			enumerable: true,\n			configurable: true,\n			writable: true\n		});\n	};\n	const tasks = [{\n		kind: "visit",\n		value,\n		...detach ? { destination: { kind: "root" } } : {}\n	}];\n	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {\n		if (task.kind === "leave") {\n			ancestors.delete(task.source);\n			continue;\n		}\n		if (task.kind === "array-item") {\n			if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;\n			tasks.push({\n				kind: "visit",\n				value: task.source[task.index],\n				...task.target === void 0 ? {} : { destination: {\n					kind: "array",\n					target: task.target,\n					index: task.index\n				} }\n			});\n			continue;\n		}\n		if (task.kind === "object-property") {\n			tasks.push({\n				kind: "visit",\n				value: task.source[task.key],\n				...task.target === void 0 ? {} : { destination: {\n					kind: "object",\n					target: task.target,\n					key: task.key\n				} }\n			});\n			continue;\n		}\n		const current = task.value;\n		if (current === null) {\n			assign(task.destination, null);\n			continue;\n		}\n		if (typeof current === "boolean" || typeof current === "string") {\n			assign(task.destination, current);\n			continue;\n		}\n		if (typeof current === "number") {\n			if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;\n			assign(task.destination, current);\n			continue;\n		}\n		if (typeof current !== "object") return void 0;\n		if (ancestors.has(current)) return void 0;\n		if (Array.isArray(current)) {\n			if (!hasPlainArrayPrototype$1(current)) return void 0;\n			const length = current.length;\n			if (Reflect.ownKeys(current).length !== length + 1) return void 0;\n			const target = detach ? [] : void 0;\n			if (target !== void 0) assign(task.destination, target);\n			ancestors.add(current);\n			tasks.push({\n				kind: "leave",\n				source: current\n			});\n			for (let index = length - 1; index >= 0; index--) tasks.push({\n				kind: "array-item",\n				source: current,\n				index,\n				...target === void 0 ? {} : { target }\n			});\n			continue;\n		}\n		if (!hasPlainObjectPrototype(current)) return void 0;\n		const keys = enumerableStringKeys(current);\n		if (keys === void 0) return void 0;\n		const target = detach ? {} : void 0;\n		if (target !== void 0) assign(task.destination, target);\n		ancestors.add(current);\n		tasks.push({\n			kind: "leave",\n			source: current\n		});\n		for (let index = keys.length - 1; index >= 0; index--) {\n			const key = keys[index];\n			/* v8 ignore next -- the loop is bounded by the captured key count. */\n			if (key === void 0) return void 0;\n			tasks.push({\n				kind: "object-property",\n				source: current,\n				key,\n				...target === void 0 ? {} : { target }\n			});\n		}\n	}\n	return detach ? root : true;\n}\n/**\n* Test the same lossless JSON rules as {@link snapshotJsonValue} without detaching the value.\n* @param value - candidate value to test.\n* @returns whether the value survives a JSON round trip without loss.\n*/\nfunction isJsonValue(value) {\n	return walkJsonValue(value, false) === true;\n}\n//#endregion\n//#region packages/llm/llm/src/error.ts\n/**\n* Harness error base with a stable machine-routable code and chained cause.\n* Package errors extend it so tool results and replay can retain failure class.\n* @module @deepseek-ai/dsh-llm/error\n*/\n/**\n* Base class for all harness errors. Carries a `code` (stable, programmatic \u2014\n* e.g. `NO_ADAPTER`, `INVALID_ARGS`) distinct from the\n* human-readable `message`, and supports `cause` chaining via the standard\n* `ErrorOptions`. `name` defaults to the subclass constructor name.\n*/\nvar HarnessError = class extends Error {\n	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */\n	code;\n	constructor(message, code, options) {\n		super(message, options);\n		this.code = code;\n		this.name = new.target.name;\n	}\n};\nnew RegExp(String.raw`(?:^|[^a-z0-9])context[\\s_-](?:length|window)[\\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\\s_-]exceeded)(?:$|[^a-z0-9])`, "i");\nnew RegExp(String.raw`\\b(?:request|prompt|input|messages?)\\s+(?:is\\s+|are\\s+)?` + String.raw`too\\s+(?:large|long)\\s+for\\s+(?:(?:this|the)\\s+)?` + String.raw`(?:model(?:\'s)?\\s+)?context(?:\\s+window)?\\b`, "i");\nnew RegExp(String.raw`\\b(?:input|prompt|request|messages?)\\b.{0,40}` + String.raw`\\b(?:exceed(?:s|ed)?|overflows?|is\\s+larger\\s+than)\\b.{0,40}` + String.raw`\\b(?:the\\s+)?(?:model(?:\'s)?\\s+)?context(?:\\s+(?:length|window))?\\b`, "i");\n//#endregion\n//#region packages/core/tools/src/json-schema.ts\n/**\n* Enforced JSON Schema subset shared by tool outputs, generated PTC mode\n* types, subagents, and workflows. The subset accepts any JSON root, an\n* annotation-only schema for unconstrained JSON, one scalar `type`, object\n* `properties`/`required`/boolean `additionalProperties`, array `items`,\n* type-correct scalar `enum`/`const`, and exact-one `oneOf`.\n*\n* Unsupported or misplaced keywords reject rather than being accepted without\n* enforcement. Consumers that require an object root apply\n* {@link assertObjectJsonSchema} before accepting input.\n* @module dsh-tools/json-schema\n*/\n/**\n* Thrown when a raw schema falls outside the enforced subset. `violations`\n* lists every offending path instead of stopping at the first author error.\n*/\nvar JsonSchemaError = class extends HarnessError {\n	/** Individual schema violations in walk order. */\n	violations;\n	constructor(violations) {\n		super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");\n		this.name = "JsonSchemaError";\n		this.violations = violations;\n	}\n};\nconst CONSTRAINT_KEYWORDS = /* @__PURE__ */ new Set([\n	"type",\n	"oneOf",\n	"properties",\n	"required",\n	"additionalProperties",\n	"items",\n	"enum",\n	"const"\n]);\nconst ANNOTATION_KEYWORDS = /* @__PURE__ */ new Set([\n	"description",\n	"title",\n	"default",\n	"examples"\n]);\nconst SCHEMA_TYPES = [\n	"object",\n	"array",\n	"string",\n	"number",\n	"integer",\n	"boolean",\n	"null"\n];\n/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */\nfunction hasIntrinsicConstructor(prototype, name) {\n	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;\n	if (typeof constructor !== "function") return false;\n	try {\n		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;\n	} catch {\n		return false;\n	}\n}\n/** Whether a candidate is one realm\'s intrinsic `Object.prototype`. */\nfunction isIntrinsicObjectPrototype(value) {\n	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");\n}\n/**\n* Test for a realm-agnostic plain JSON record without accepting arrays or\n* exotic objects.\n* @param value - candidate record from any JavaScript realm.\n* @returns Whether the value has a plain-object prototype chain.\n*/\nfunction isPlainJsonRecord(value) {\n	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;\n	try {\n		const prototype = Object.getPrototypeOf(value);\n		return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);\n	} catch {\n		return false;\n	}\n}\n/** Whether an array uses one realm\'s intrinsic `Array.prototype`. */\nfunction hasPlainArrayPrototype(value) {\n	const prototype = Object.getPrototypeOf(value);\n	if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;\n	const objectPrototype = Object.getPrototypeOf(prototype);\n	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);\n}\n/** Return whether a record contains only own enumerable string keys. */\nfunction hasOnlyEnumerableStringKeys(value) {\n	try {\n		return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));\n	} catch {\n		return false;\n	}\n}\n/**\n* Test for an ordinary schema record whose keys survive JSON projection.\n* @param value - candidate record from any JavaScript realm.\n* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.\n*/\nfunction isJsonSchemaRecord(value) {\n	return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);\n}\n/**\n* Test for a dense ordinary array with no JSON-invisible decorations.\n* @param value - candidate array from any JavaScript realm.\n* @returns Whether the array is intrinsic, dense, and undecorated.\n*/\nfunction isPlainJsonArray(value) {\n	if (!Array.isArray(value)) return false;\n	try {\n		if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;\n		for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;\n		return true;\n	} catch {\n		return false;\n	}\n}\n/** Lossless finite JSON number, excluding negative zero. */\nfunction isJsonNumber(value) {\n	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);\n}\n/** Whether a scalar is valid for one declared schema type. */\nfunction scalarMatches(type, value) {\n	switch (type) {\n		case "string": return typeof value === "string";\n		case "number": return isJsonNumber(value);\n		case "integer": return isJsonNumber(value) && Number.isInteger(value);\n		case "boolean": return typeof value === "boolean";\n		case "null": return value === null;\n		/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */\n		default: return assertNever(type, "JsonSchemaType");\n	}\n}\n/** Keywords that are invalid beside `oneOf`. */\nconst ONE_OF_SIBLING_KEYWORDS = [\n	"properties",\n	"required",\n	"additionalProperties",\n	"items",\n	"enum",\n	"const"\n];\n/** Validate object-only fields after its property schemas have been visited. */\nfunction checkObjectSchemaTail(node, path, properties, violations) {\n	const hasRequired = Object.hasOwn(node, "required");\n	const required = hasRequired ? node.required : void 0;\n	if (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);\n	else {\n		const declared = isJsonSchemaRecord(properties) ? properties : {};\n		for (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);\n	}\n	if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);\n}\n/** Collect every violation for one raw schema tree without using the JavaScript call stack. */\nfunction checkSchemaNode(root, rootPath, violations, seen) {\n	const tasks = [{\n		kind: "enter",\n		node: root,\n		path: rootPath\n	}];\n	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {\n		if (task.kind === "leave") {\n			seen.delete(task.node);\n			continue;\n		}\n		if (task.kind === "one-of-tail") {\n			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);\n			continue;\n		}\n		if (task.kind === "object-tail") {\n			checkObjectSchemaTail(task.node, task.path, task.properties, violations);\n			continue;\n		}\n		const { node, path } = task;\n		if (!isJsonSchemaRecord(node)) {\n			violations.push(`${path} must be a schema object`);\n			continue;\n		}\n		if (seen.has(node)) {\n			violations.push(`${path} is circular`);\n			continue;\n		}\n		seen.add(node);\n		tasks.push({\n			kind: "leave",\n			node\n		});\n		for (const key of Object.keys(node)) {\n			if (CONSTRAINT_KEYWORDS.has(key)) continue;\n			if (ANNOTATION_KEYWORDS.has(key)) {\n				try {\n					if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);\n				} catch {\n					violations.push(`${path}.${key} annotation must be lossless JSON data`);\n				}\n				continue;\n			}\n			violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);\n		}\n		if (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);\n		if (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);\n		const hasType = Object.hasOwn(node, "type");\n		const hasOneOf = Object.hasOwn(node, "oneOf");\n		if (hasType && hasOneOf) {\n			violations.push(`${path} cannot declare both type and oneOf`);\n			continue;\n		}\n		if (!hasType && !hasOneOf) {\n			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);\n			continue;\n		}\n		if (hasOneOf) {\n			const oneOf = node.oneOf;\n			tasks.push({\n				kind: "one-of-tail",\n				node,\n				path\n			});\n			if (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);\n			else for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({\n				kind: "enter",\n				node: oneOf[index],\n				path: `${path}.oneOf[${index}]`\n			});\n			continue;\n		}\n		const type = node.type;\n		if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {\n			violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);\n			continue;\n		}\n		const schemaType = type;\n		for (const [key, types] of Object.entries({\n			properties: ["object"],\n			required: ["object"],\n			additionalProperties: ["object"],\n			items: ["array"],\n			enum: [\n				"string",\n				"number",\n				"integer",\n				"boolean",\n				"null"\n			],\n			const: [\n				"string",\n				"number",\n				"integer",\n				"boolean",\n				"null"\n			]\n		})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);\n		switch (schemaType) {\n			case "object": {\n				const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;\n				tasks.push({\n					kind: "object-tail",\n					node,\n					path,\n					properties\n				});\n				if (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);\n				else {\n					const entries = Object.entries(properties);\n					for (let index = entries.length - 1; index >= 0; index--) {\n						const entry = entries[index];\n						/* v8 ignore next -- the loop is bounded by the captured entry count. */\n						if (entry === void 0) continue;\n						tasks.push({\n							kind: "enter",\n							node: entry[1],\n							path: `${path}.properties.${entry[0]}`\n						});\n					}\n				}\n				break;\n			}\n			case "array":\n				if (Object.hasOwn(node, "items")) tasks.push({\n					kind: "enter",\n					node: node.items,\n					path: `${path}.items`\n				});\n				break;\n			case "string":\n			case "number":\n			case "integer":\n			case "boolean":\n			case "null": {\n				const hasEnum = Object.hasOwn(node, "enum");\n				const allowed = hasEnum ? node.enum : void 0;\n				const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));\n				if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);\n				const hasConst = Object.hasOwn(node, "const");\n				const declaredConst = hasConst ? node.const : void 0;\n				const constValid = scalarMatches(schemaType, declaredConst);\n				if (hasConst) {\n					if (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);\n					else if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);\n				}\n				break;\n			}\n			/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */\n			default: assertNever(schemaType, "JsonSchemaType");\n		}\n	}\n}\n/**\n* Assert the enforced subset plus the object-root constraint retained by\n* subagent and workflow structured outputs.\n* @param schema - untrusted caller-supplied schema.\n* @returns Assertion that the schema belongs to the supported subset and has an object root.\n*/\nfunction assertObjectJsonSchema(schema) {\n	const violations = [];\n	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());\n	if (violations.length === 0 && (!isJsonSchemaRecord(schema) || !Object.hasOwn(schema, "type") || schema.type !== "object")) violations.push("schema.type must be \\"object\\" (structured output is object-rooted)");\n	if (violations.length > 0) throw new JsonSchemaError(violations);\n}\n//#endregion\n//#region packages/workflow/workflow/src/index.ts\n/**\n* Typed error for workflow-seam failures. Extends {@link HarnessError}, so the\n* `code` is machine-routable taxonomy. `fatal` drives the combinator\n* discipline: `parallel()`/`pipeline()` re-throw a fatal error (a typo\'d\n* option or a tripped cap must kill the script loudly), and reserve the\n* per-item `null` for child-run failures and ordinary in-stage script errors.\n* Every {@link WorkflowErrorCode} is fatal; the flag exists so the\n* distinction is explicit at every catch site rather than implied.\n*/\nvar WorkflowError = class extends HarnessError {\n	/** Whether combinators must propagate this error instead of nulling the item. */\n	fatal;\n	constructor(message, code, options) {\n		super(message, code, options);\n		this.name = "WorkflowError";\n		this.fatal = options?.fatal ?? true;\n	}\n};\n/**\n* Whether combinators must re-throw `error` instead of mapping the item to `null`.\n* @param error - any thrown value; fatality is host `instanceof` (unforgeable from a script realm).\n* @returns true iff `error` is a {@link WorkflowError} whose `fatal` flag is set.\n*/\nfunction isFatalWorkflowError(error) {\n	return error instanceof WorkflowError && error.fatal;\n}\n//#endregion\n//#region packages/workflow/workflow-ptc/src/runtime.ts\n/**\n* Workflow VM hooks, child callbacks, ordinary concurrency limits and result serialization.\n* PTC owns process confinement and cancellation. Fatal hook and provider failures propagate\n* through combinators; ordinary child failures and stage errors become per-item nulls.\n* @module @deepseek-ai/dsh-workflow-ptc/runtime\n*/\n/** The `agent()` options the script may pass; everything else rejects loud. */\nconst SUPPORTED_AGENT_OPTIONS = /* @__PURE__ */ new Set([\n	"label",\n	"phase",\n	"schema",\n	"provider",\n	"model"\n]);\n/** Deferred Claude Code options we name explicitly in the rejection message. */\nconst DEFERRED_AGENT_OPTIONS = /* @__PURE__ */ new Set([\n	"effort",\n	"isolation",\n	"agentType"\n]);\n/** Flatten a child\'s final output blocks to text (the non-schema `agent()` result). */\nfunction outputText(blocks) {\n	return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");\n}\n/** A short display label derived from the prompt when the script passes none. */\nfunction defaultLabel(prompt) {\n	const newline = prompt.indexOf("\\n");\n	const line = newline === -1 ? prompt : prompt.slice(0, newline);\n	return line.length <= 48 ? line : `${line.slice(0, 47)}\u2026`;\n}\n/**\n* One script execution inside the confined Node process. The host owns\n* cancellation and cleanup of any dropped child work.\n*/\nvar WorkflowExecution = class {\n	limits;\n	observer;\n	children;\n	/** 1-based count of `agent()` calls started (the `agentsStarted` result field). */\n	started = 0;\n	/** Child tokens debited so far; only the host can report them, after each child settles. */\n	spentTokens = 0;\n	/** Run start on the PTC process clock, the basis for the elapsed-time budget. */\n	startedAt = Date.now();\n	activeSlots = 0;\n	slotWaiters = [];\n	currentPhase;\n	context;\n	compiled;\n	constructor(meta, body, args, limits, observer, children) {\n		this.limits = limits;\n		this.observer = observer;\n		this.children = children;\n		try {\n			this.compiled = new vm.Script(`(async () => {\\n${body}\\n})()`, {\n				filename: `workflow:${meta.name}`,\n				lineOffset: -1\n			});\n		} catch (error) {\n			throw new WorkflowError(`workflow script does not parse: ${String(error)}`, "SCRIPT_PARSE", { cause: error });\n		}\n		this.context = vm.createContext({}, { name: `workflow:${meta.name}` });\n		const globals = {\n			agent: (prompt, opts) => this.contain(this.agent(prompt, opts)),\n			parallel: (thunks) => this.contain(this.parallel(thunks)),\n			pipeline: (items, ...stages) => this.contain(this.pipeline(items, stages)),\n			phase: (title) => {\n				this.phase(title);\n			},\n			log: (message) => {\n				this.log(message);\n			},\n			args,\n			budget: Object.freeze({\n				total: this.limits.budgetTokens,\n				timeLimitMs: this.limits.budgetMs,\n				spent: () => this.spentTokens,\n				remaining: () => this.limits.budgetTokens === null ? null : Math.max(0, this.limits.budgetTokens - this.spentTokens),\n				elapsedMs: () => Date.now() - this.startedAt,\n				timeRemainingMs: () => this.limits.budgetMs === null ? null : Math.max(0, this.limits.budgetMs - (Date.now() - this.startedAt))\n			})\n		};\n		for (const [key, value] of Object.entries(globals)) this.context[key] = typeof value === "function" ? Object.freeze(value) : value;\n	}\n	/**\n	* Run the script and materialize its JSON return value.\n	* @returns A completed or error result; script failures never reject.\n	*/\n	async drive() {\n		try {\n			const scriptPromise = this.compiled.runInContext(this.context, { timeout: this.limits.syncTimeoutMs });\n			const raw = await this.contain(Promise.resolve(scriptPromise));\n			return {\n				value: raw === void 0 ? null : this.materializeResult(raw),\n				stopReason: "completed",\n				agentsStarted: this.started\n			};\n		} catch (error) {\n			return {\n				value: null,\n				stopReason: "error",\n				error: renderThrown(error),\n				agentsStarted: this.started\n			};\n		}\n	}\n	/**\n	* Attach a no-op rejection consumer WITHOUT changing what the caller\n	* receives: if the script drops the promise, a host rejection cannot become\n	* an unhandled rejection that kills the process; if\n	* the script does await it, it still observes the rejection.\n	*/\n	contain(promise) {\n		promise.catch(() => {});\n		return promise;\n	}\n	/** Materialize the script\'s return value; violations become RESULT_UNSERIALIZABLE. */\n	materializeResult(raw) {\n		try {\n			return materializeFromRealm(raw, "workflow result");\n		} catch (error) {\n			/* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */\n			if (!(error instanceof MaterializeError)) throw error;\n			throw new WorkflowError(`the workflow\'s return value is not plain JSON data \u2014 ${error.message}. Return only JSON-serializable objects/arrays/scalars.`, "RESULT_UNSERIALIZABLE", { cause: error });\n		}\n	}\n	/** Acquire one concurrency slot in FIFO order. */\n	acquireSlot() {\n		if (this.activeSlots < this.limits.maxConcurrentAgents) {\n			this.activeSlots += 1;\n			return Promise.resolve();\n		}\n		return new Promise((resolve) => {\n			this.slotWaiters.push(() => {\n				this.activeSlots += 1;\n				resolve();\n			});\n		});\n	}\n	releaseSlot() {\n		this.activeSlots -= 1;\n		const next = this.slotWaiters.shift();\n		if (next) next();\n	}\n	/** The `agent(prompt, opts)` hook. */\n	async agent(rawPrompt, rawOpts) {\n		if (typeof rawPrompt !== "string" || rawPrompt.length === 0) throw new WorkflowError("agent() requires a non-empty prompt string", "INVALID_ARGUMENT");\n		this.assertBudget();\n		const opts = this.readAgentOptions(rawOpts);\n		if (this.started >= this.limits.maxTotalAgents) throw new WorkflowError(`this run reached its total agent cap (${this.limits.maxTotalAgents}) \u2014 a runaway-loop backstop; raise the applicable maxTotalAgents limit if the scale is intentional`, "AGENT_CAP");\n		this.started += 1;\n		const seq = this.started;\n		if (this.limits.warnAboveAgents > 0 && seq === this.limits.warnAboveAgents + 1) this.observer.log(`large workflow: starting agent #${seq}, beyond this session\'s ${this.limits.warnAboveAgents}-agent size guideline; confirm the scale is intentional`);\n		const label = opts.label ?? defaultLabel(rawPrompt);\n		const phase = opts.phase ?? this.currentPhase;\n		await this.acquireSlot();\n		try {\n			this.assertBudget();\n			let run;\n			try {\n				run = await this.children.startAgent({\n					seq,\n					prompt: rawPrompt,\n					...opts.schema !== void 0 ? { schema: opts.schema } : {},\n					...opts.provider !== void 0 ? { provider: opts.provider } : {},\n					...opts.model !== void 0 ? { model: opts.model } : {}\n				});\n			} catch (error) {\n				throw new WorkflowError(`agent() could not start a child: ${renderThrown(error)}`, "AGENT_START", { cause: error });\n			}\n			const info = {\n				seq,\n				label,\n				...phase !== void 0 ? { phase } : {},\n				childId: brandString(run.id)\n			};\n			this.observer.agentStart(info);\n			try {\n				let result;\n				try {\n					result = await run.result;\n				} catch (error) {\n					this.observer.agentEnd({\n						...info,\n						outcome: "failed"\n					});\n					throw new WorkflowError(`child agent run failed: ${renderThrown(error)}`, "AGENT_RESULT", { cause: error });\n				}\n				this.spentTokens += result.tokens;\n				if (result.stopReason === "completed") {\n					if (opts.schema !== void 0) {\n						if (result.structured === void 0) {\n							this.observer.agentEnd({\n								...info,\n								outcome: "failed"\n							});\n							return null;\n						}\n						this.observer.agentEnd({\n							...info,\n							outcome: "completed"\n						});\n						return result.structured;\n					}\n					this.observer.agentEnd({\n						...info,\n						outcome: "completed"\n					});\n					return outputText(result.output);\n				}\n				this.observer.agentEnd({\n					...info,\n					outcome: "failed"\n				});\n				return null;\n			} finally {\n				await run.dispose();\n			}\n		} finally {\n			this.releaseSlot();\n		}\n	}\n	/** Materialize + validate the `agent()` options bag from the realm. */\n	readAgentOptions(rawOpts) {\n		if (rawOpts === void 0) return {};\n		let opts;\n		try {\n			opts = materializeFromRealm(rawOpts, "agent() options");\n		} catch (error) {\n			/* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */\n			if (!(error instanceof MaterializeError)) throw error;\n			throw new WorkflowError(`agent() options must be plain JSON data \u2014 ${error.message}`, "INVALID_ARGUMENT", { cause: error });\n		}\n		if (typeof opts !== "object" || opts === null || Array.isArray(opts)) throw new WorkflowError("agent() options must be an object", "INVALID_ARGUMENT");\n		const record = opts;\n		for (const key of Object.keys(record)) {\n			if (SUPPORTED_AGENT_OPTIONS.has(key)) continue;\n			if (DEFERRED_AGENT_OPTIONS.has(key)) throw new WorkflowError(`agent() option "${key}" is deferred and not supported by this engine (supported: label, phase, schema, provider, model)`, "UNSUPPORTED_OPTION");\n			throw new WorkflowError(`agent() option "${key}" is not recognized (supported: label, phase, schema, provider, model)`, "UNSUPPORTED_OPTION");\n		}\n		for (const key of [\n			"label",\n			"phase",\n			"provider",\n			"model"\n		]) if (record[key] !== void 0 && typeof record[key] !== "string") throw new WorkflowError(`agent() option "${key}" must be a string`, "INVALID_ARGUMENT");\n		let schema;\n		if (record.schema !== void 0) try {\n			assertObjectJsonSchema(record.schema);\n			schema = record.schema;\n		} catch (error) {\n			/* v8 ignore next -- defensive rethrow arm: assertObjectJsonSchema only throws JsonSchemaError */\n			if (!(error instanceof JsonSchemaError)) throw error;\n			throw new WorkflowError(`agent() schema is outside the supported subset \u2014 ${error.message}`, "UNSUPPORTED_SCHEMA", { cause: error });\n		}\n		return {\n			...record.label !== void 0 ? { label: record.label } : {},\n			...record.phase !== void 0 ? { phase: record.phase } : {},\n			...record.provider !== void 0 ? { provider: record.provider } : {},\n			...record.model !== void 0 ? { model: record.model } : {},\n			...schema !== void 0 ? { schema } : {}\n		};\n	}\n	/** The `parallel(thunks)` hook: each thunk caught \u2192 `null`; fatal errors propagate. */\n	async parallel(rawThunks) {\n		if (!Array.isArray(rawThunks)) throw new WorkflowError("parallel() requires an array of zero-argument functions", "INVALID_ARGUMENT");\n		this.assertItemCap(rawThunks.length, "parallel()");\n		const thunks = rawThunks.map((thunk, index) => {\n			if (typeof thunk !== "function") throw new WorkflowError(`parallel() item ${index} is not a function`, "INVALID_ARGUMENT");\n			return thunk;\n		});\n		return Promise.all(thunks.map(async (thunk) => {\n			try {\n				return await thunk();\n			} catch (error) {\n				if (isFatalWorkflowError(error)) throw error;\n				return null;\n			}\n		}));\n	}\n	/** The `pipeline(items, ...stages)` hook: per-item stage chains, NO cross-stage barrier. */\n	async pipeline(rawItems, rawStages) {\n		if (!Array.isArray(rawItems)) throw new WorkflowError("pipeline() requires an items array", "INVALID_ARGUMENT");\n		this.assertItemCap(rawItems.length, "pipeline()");\n		if (rawStages.length === 0) throw new WorkflowError("pipeline() requires at least one stage function", "INVALID_ARGUMENT");\n		const stages = rawStages.map((stage, index) => {\n			if (typeof stage !== "function") throw new WorkflowError(`pipeline() stage ${index} is not a function`, "INVALID_ARGUMENT");\n			return stage;\n		});\n		return Promise.all(rawItems.map(async (item, index) => {\n			let value = item;\n			try {\n				for (const stage of stages) value = await stage(value, item, index);\n				return value;\n			} catch (error) {\n				if (isFatalWorkflowError(error)) throw error;\n				return null;\n			}\n		}));\n	}\n	/**\n	* Refuse a new `agent()` call once a budget is exhausted. The run itself\n	* stays alive so the script can return the results it already gathered.\n	*/\n	assertBudget() {\n		const tokens = this.limits.budgetTokens;\n		if (tokens !== null && this.spentTokens >= tokens) throw new WorkflowError(`this run exhausted its token budget (spent ${this.spentTokens} of ${tokens} tokens) \u2014 further agent() calls are refused; raise the budget or return the results already gathered`, "AGENT_CAP");\n		const ms = this.limits.budgetMs;\n		const elapsed = Date.now() - this.startedAt;\n		if (ms !== null && elapsed >= ms) throw new WorkflowError(`this run exhausted its time budget (${elapsed} ms of ${ms} ms elapsed) \u2014 further agent() calls are refused; raise the budget or return the results already gathered`, "AGENT_CAP");\n	}\n	assertItemCap(length, hook) {\n		if (length > this.limits.maxItemsPerCall) throw new WorkflowError(`${hook} received ${length} items \u2014 over the per-call cap (${this.limits.maxItemsPerCall}); split the work or raise maxItemsPerCall in the engine config`, "ITEM_CAP");\n	}\n	/** The `phase(title)` hook: sets the current label for subsequent `agent()` calls and notifies observers. */\n	phase(title) {\n		if (typeof title !== "string" || title.length === 0) throw new WorkflowError("phase() requires a non-empty title string", "INVALID_ARGUMENT");\n		this.currentPhase = title;\n		this.observer.phase(title);\n	}\n	/** The `log(message)` hook: narration to observers. */\n	log(message) {\n		if (typeof message !== "string") throw new WorkflowError("log() requires a message string", "INVALID_ARGUMENT");\n		this.observer.log(message);\n	}\n};\n//#endregion\n//#region packages/workflow/workflow-ptc/src/guest.ts\n/**\n* Run a workflow with one progress batch in flight. Drain progress before child\n* disposal and the terminal result; PTC and the host own cancellation and cleanup.\n* @param host - JSON callbacks owned by this workflow run.\n* @returns The script result after progress delivery; initialization failures reject.\n*/\nasync function runWorkflowGuest(host) {\n	const init = await host.begin({});\n	let queued = [];\n	let inFlight;\n	let progressError;\n	const flush = () => {\n		if (inFlight !== void 0 || queued.length === 0) return;\n		const batch = queued;\n		queued = [];\n		inFlight = host.progress(batch).then(() => {\n			inFlight = void 0;\n			flush();\n		}, (error) => {\n			progressError = renderThrown(error);\n			queued = [];\n			inFlight = void 0;\n		});\n	};\n	const send = (event) => {\n		if (progressError !== void 0) return;\n		queued.push(event);\n		flush();\n	};\n	const drain = async () => {\n		while (inFlight !== void 0) await inFlight;\n	};\n	const result = await new WorkflowExecution(init.meta, init.body, init.args, init.limits, {\n		phase: (title) => {\n			send({\n				type: "phase",\n				title\n			});\n		},\n		log: (message) => {\n			send({\n				type: "log",\n				message\n			});\n		},\n		agentStart: (info) => {\n			send({\n				type: "agent-start",\n				info\n			});\n		},\n		agentEnd: (info) => {\n			send({\n				type: "agent-end",\n				info\n			});\n		}\n	}, { async startAgent(request) {\n		const { callId, childId } = await host.startChild(request);\n		const result = host.childResult({ callId });\n		result.catch(() => {});\n		return {\n			id: childId,\n			result,\n			async dispose() {\n				await drain();\n				await host.disposeChild({ callId });\n			}\n		};\n	} }).drive();\n	await drain();\n	return progressError === void 0 ? result : {\n		value: null,\n		stopReason: "error",\n		error: progressError,\n		agentsStarted: result.agentsStarted\n	};\n}\n//#endregion\nexport { runWorkflowGuest };\n//# sourceURL=dsh-workflow-guest.js\n';

// packages/workflow/workflow-ptc/src/realm.ts
var MaterializeError = class extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.path = path;
    this.reason = reason;
    this.name = "MaterializeError";
  }
  path;
  reason;
};
function renderThrown(error) {
  try {
    const stack = error?.stack;
    if (typeof stack === "string" && stack.length > 0) return stack;
    const message = error?.message;
    if (typeof message === "string" && message.length > 0) return message;
    return String(error);
  } catch {
    return "[unrenderable thrown value]";
  }
}
function hasPlainPrototype(value) {
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return true;
  return Object.getPrototypeOf(proto) === null;
}
function materializeFromRealm(value, root = "value") {
  if (value === void 0) return void 0;
  try {
    return materialize(value, root, /* @__PURE__ */ new Set());
  } catch (error) {
    if (error instanceof MaterializeError) throw error;
    throw new MaterializeError(root, `reading the value threw: ${renderThrown(error)}`);
  }
}
function materialize(value, path, seen) {
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number": {
      if (!Number.isFinite(value)) throw new MaterializeError(path, "non-finite numbers are not JSON data");
      return value;
    }
    case "bigint":
      throw new MaterializeError(path, "bigints are not JSON data");
    case "function":
      throw new MaterializeError(path, "functions are not plain JSON data");
    case "symbol":
      throw new MaterializeError(path, "symbols are not plain JSON data");
    case "undefined":
      throw new MaterializeError(path, "undefined is not JSON data");
    case "object":
      break;
  }
  if (value === null) return null;
  const objectValue = value;
  if (seen.has(objectValue)) throw new MaterializeError(path, "circular references are not JSON data");
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) return materializeArray(objectValue, path, seen);
    return materializeObject(objectValue, path, seen);
  } finally {
    seen.delete(objectValue);
  }
}
function materializeArray(value, path, seen) {
  const out = [];
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) throw new MaterializeError(`${path}[${index}]`, "sparse arrays are not JSON data");
    out.push(materialize(value[index], `${path}[${index}]`, seen));
  }
  for (const key of Object.keys(value)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw new MaterializeError(`${path}.${key}`, "arrays with non-index properties are not JSON data");
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new MaterializeError(path, "symbol-keyed properties are not plain JSON data");
  }
  return out;
}
function materializeObject(value, path, seen) {
  if (!hasPlainPrototype(value)) {
    throw new MaterializeError(path, "only plain objects and arrays are JSON data (exotic prototype)");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new MaterializeError(path, "symbol-keyed properties are not plain JSON data");
  }
  const out = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(out, key, {
      value: materialize(value[key], `${path}.${key}`, seen),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return out;
}

// packages/workflow/workflow-ptc/src/host.ts
var GUEST_URL = `data:text/javascript,${encodeURIComponent(WORKFLOW_GUEST_SOURCE)}`;
var PROGRAM = `const { runWorkflowGuest } = await import(${JSON.stringify(GUEST_URL)}); return await runWorkflowGuest(workflowHost);`;
function object(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("workflow binding requires an object");
  return value;
}
function text(value, name) {
  if (typeof value !== "string") throw new Error(`workflow ${name} must be a string`);
  return value;
}
function json(value) {
  const result = snapshotJsonValue(value);
  if (result === void 0) throw new Error("workflow binding value must be lossless JSON");
  return result;
}
function childRequest(value) {
  const request = object(value);
  if (!Number.isSafeInteger(request.seq) || request.seq < 1) throw new Error("workflow child sequence must be a positive integer");
  const prompt = text(request.prompt, "prompt");
  const provider = request.provider === void 0 ? void 0 : text(request.provider, "provider");
  const model = request.model === void 0 ? void 0 : text(request.model, "model");
  let schema;
  if (request.schema !== void 0) {
    const candidate = object(request.schema);
    assertObjectJsonSchema(candidate);
    schema = candidate;
  }
  return {
    seq: request.seq,
    prompt,
    ...provider === void 0 ? {} : { provider },
    ...model === void 0 ? {} : { model },
    ...schema === void 0 ? {} : { schema }
  };
}
function agentInfo(value) {
  const info = object(value);
  if (!Number.isSafeInteger(info.seq) || info.seq < 1) throw new Error("workflow agent sequence must be a positive integer");
  return {
    seq: info.seq,
    label: text(info.label, "agent label"),
    childId: SessionId(text(info.childId, "child id")),
    ...info.phase === void 0 ? {} : { phase: text(info.phase, "agent phase") }
  };
}
function progress(value) {
  const event = object(value);
  switch (event.type) {
    case "phase":
      return { type: "phase", title: text(event.title, "phase") };
    case "log":
      return { type: "log", message: text(event.message, "log") };
    case "agent-start":
      return { type: "agent-start", info: agentInfo(event.info) };
    case "agent-end": {
      const info = object(event.info);
      if (info.outcome !== "completed" && info.outcome !== "failed" && info.outcome !== "cancelled") throw new Error("invalid workflow agent outcome");
      return { type: "agent-end", info: { ...agentInfo(info), outcome: info.outcome } };
    }
    default:
      throw new Error("invalid workflow progress event");
  }
}
function progressBatch(value) {
  if (!Array.isArray(value)) throw new Error("workflow progress requires an array of events");
  return value.map(progress);
}
function workflowResult(value) {
  const result = object(value);
  if (result.stopReason !== "completed" && result.stopReason !== "error" && result.stopReason !== "cancelled") throw new Error("invalid workflow stop reason");
  if (!Number.isSafeInteger(result.agentsStarted) || result.agentsStarted < 0) throw new Error("invalid workflow agent count");
  if (!Object.hasOwn(result, "value")) throw new Error("workflow result is missing its value");
  return {
    value: result.value,
    stopReason: result.stopReason,
    agentsStarted: result.agentsStarted,
    ...result.error === void 0 ? {} : { error: text(result.error, "error") }
  };
}
var PtcWorkflowRun = class {
  constructor(ctx, subagents, runtime, id, meta, parent, init, provider, policy, observer, deps) {
    this.ctx = ctx;
    this.subagents = subagents;
    this.runtime = runtime;
    this.id = id;
    this.meta = meta;
    this.parent = parent;
    this.init = init;
    this.provider = provider;
    this.policy = policy;
    this.observer = observer;
    this.deps = deps;
    this.externalAbort = () => {
      this.cancel("workflow signal aborted");
    };
    if (deps.signal?.aborted) this.externalAbort();
    else deps.signal?.addEventListener("abort", this.externalAbort, { once: true });
    this.cwd = ctx.workingDirectory.ensure(parent, this.controller.signal);
    this.result = Promise.resolve().then(() => this.drive());
  }
  ctx;
  subagents;
  runtime;
  id;
  meta;
  parent;
  init;
  provider;
  policy;
  observer;
  deps;
  result;
  controller = new AbortController();
  children = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Set();
  liveAgents = /* @__PURE__ */ new Map();
  started = 0;
  /** Schema retries so far; they start children outside the guest's `agent()` counter. */
  retries = 0;
  terminal = false;
  cancelReason;
  failedCalls = 0;
  cleanupFailed = false;
  disposed;
  externalAbort;
  cwd;
  /**
   * Stop the script and abort pending and published children.
   * @param reason - Human-readable cancellation cause; the first request wins.
   */
  cancel(reason = "workflow cancelled") {
    if (this.terminal || this.cancelReason !== void 0) return;
    this.cancelReason = reason;
    try { this.deps.stopOwner?.(); }
    catch (error) { this.cleanupFailed = true; this.ctx.logger.warn(`Cannot persist workflow stop: ${String(error)}`); }
    finally { this.controller.abort(reason); }
    for (const record of this.children.values()) void this.disposeChild(record);
  }
  /**
   * Cancel unfinished work and await the program and child cleanup.
   * @returns One shared completion promise for repeated disposal calls.
   */
  dispose() {
    this.cancel("workflow disposed");
    this.disposed ??= this.result.then(() => {
    });
    return this.disposed;
  }
  requireActive() {
    this.controller.signal.throwIfAborted();
  }
  track(task) {
    this.pending.add(task);
    void task.then(() => {
      this.pending.delete(task);
    }, () => {
      this.pending.delete(task);
    });
    return task;
  }
  bindings() {
    return {
      begin: () => {
        this.requireActive();
        return Promise.resolve(json(this.init));
      },
      startChild: (value) => this.track(this.startChild(childRequest(value))),
      childResult: (value) => this.track(this.childResult(this.child(value))),
      disposeChild: async (value) => {
        await this.disposeChild(this.child(value));
        return null;
      },
      progress: (value) => {
        for (const event of progressBatch(value)) this.onProgress(event);
        return Promise.resolve(null);
      }
    };
  }
  child(value) {
    this.requireActive();
    const callId = object(value).callId;
    if (!Number.isSafeInteger(callId)) throw new Error("workflow child call id must be an integer");
    const record = this.children.get(callId);
    if (record === void 0) throw new Error("workflow child call is not active");
    return record;
  }
  /** Publish one child activation for a call (the first attempt or a schema retry). */
  async activate(request, callId) {
    return await this.subagents.startActivation({
      provider: this.provider,
      label: `${this.meta.name} child ${callId}`,
      delivery: "caller",
      signal: this.controller.signal,
      request: {
        cwd: await this.cwd,
        prompt: [{ type: "text", text: request.prompt }],
        parent: this.parent,
        ...request.schema === void 0 ? {} : { outputSchema: request.schema },
        ...request.provider === void 0 && request.model === void 0 ? {} : {
          agentOptions: {
            ...request.provider === void 0 ? {} : { provider: request.provider },
            ...request.model === void 0 ? {} : { model: request.model }
          }
        }
      }
    });
  }
  async startChild(request) {
    this.requireActive();
    const callId = ++this.started;
    const replay = this.deps.journal?.takeReplay(request, this.provider);
    if (replay !== void 0) {
      this.children.set(callId, { callId, seq: request.seq, replay });
      return { callId, childId: replay.childId };
    }
    this.deps.journal?.recordIntent(request, this.provider);
    const run = await this.activate(request, callId);
    const record = { callId, seq: request.seq, request, run };
    this.children.set(callId, record);
    this.deps.journal?.recordCall(request, this.provider, run.childId);
    this.deps.onChildActive?.(run.childId, true);
    if (this.controller.signal.aborted) {
      await this.disposeChild(record);
      throw new Error("workflow child started after cancellation");
    }
    return { callId, childId: run.childId };
  }
  async childResult(record) {
    if (record.replay !== void 0) return json(record.replay.result);
    const signal = this.controller.signal;
    signal.throwIfAborted();
    const aborted = Promise.withResolvers();
    const onAbort = () => {
      aborted.reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (record.request === void 0) throw new Error("workflow child record has no request");
      const request = record.request;
      const maxRetries = request.schema === void 0 || this.policy.mode !== "read-only" ? 0 : this.deps.schemaRetries ?? 0;
      let run = record.run;
      if (run === void 0) throw new Error("workflow child record has no activation");
      let tokens = 0;
      let payload;
      for (let attempt = 0; ; attempt += 1) {
        const result = await Promise.race([run.result, aborted.promise]);
        tokens += await this.childTokens(run.childId);
        payload = {
          output: result.output,
          stopReason: result.stopReason,
          ...result.structured === void 0 ? {} : { structured: result.structured },
          tokens
        };
        // A provider that finished cleanly without the requested structured
        // value gets a fresh child; a failed or cancelled child is not retried.
        if (payload.structured !== void 0 || payload.stopReason !== "completed" || attempt >= maxRetries) break;
        const cap = this.deps.maxTotalAgents;
        if (cap !== void 0 && this.started + this.retries >= cap) {
          this.observer.log(`workflow: agent #${record.seq} finished without structured output; total agent cap (${cap}) reached, not retrying`);
          break;
        }
        this.retries += 1;
        this.observer.log(`workflow: agent #${record.seq} finished without structured output; retry ${attempt + 1}/${maxRetries}`);
        await this.disposeChild(record);
        this.requireActive();
        run = await this.activate(request, record.callId);
        if (this.controller.signal.aborted) {
          await run.dispose();
          this.deps.onChildActive?.(run.childId, false);
          throw new Error("workflow child started after cancellation");
        }
        record.run = run;
        record.disposal = void 0;
        this.children.set(record.callId, record);
        this.deps.onChildActive?.(run.childId, true);
      }
      if (request.schema !== void 0 && payload.structured === void 0) payload.stopReason = "error";
      if (payload.stopReason !== "completed") this.failedCalls += 1;
      this.deps.journal?.recordResult(record.seq, payload);
      return json(payload);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  /**
   * Read one settled child's provider-reported usage from its session
   * projection. The session is normally already disposed, so the reader uses
   * the host's live-or-cold observation service; any failure degrades to zero
   * rather than failing the workflow.
   */
  async childTokens(childId) {
    const readTokens = this.deps.readTokens;
    if (readTokens === void 0) return 0;
    try {
      return await readTokens(childId);
    } catch (error) {
      this.ctx.logger.warn(`workflow-ptc: could not read token usage for child ${childId}: ${renderThrown(error)}`);
      return 0;
    }
  }
  disposeChild(record) {
    const run = record.run;
    if (run === void 0) {
      this.children.delete(record.callId);
      return Promise.resolve();
    }
    record.disposal ??= Promise.resolve().then(() => run.dispose()).catch((error) => {
      this.cleanupFailed = true;
      record.cleanupFailed = true;
      this.ctx.logger.warn(`workflow-ptc: child dispose failed: ${renderThrown(error)}`);
    }).finally(() => {
      this.children.delete(record.callId);
      if (!record.cleanupFailed) this.deps.onChildActive?.(run.childId, false);
    });
    return record.disposal;
  }
  onProgress(event) {
    this.requireActive();
    switch (event.type) {
      case "phase":
        this.observer.phase(event.title);
        break;
      case "log":
        this.observer.log(event.message);
        break;
      case "agent-start":
        this.liveAgents.set(event.info.seq, event.info);
        this.observer.agentStart(event.info);
        break;
      case "agent-end":
        this.endAgent(event.info);
        break;
      /* v8 ignore next -- progress() validates the closed message union before dispatch. */
      default:
        assertNever(event, "workflow progress");
    }
  }
  endAgent(info) {
    if (!this.liveAgents.delete(info.seq)) return;
    this.observer.agentEnd(info);
  }
  cancelled() {
    return { value: null, stopReason: "cancelled", error: `workflow run cancelled: ${this.cancelReason}`, agentsStarted: this.started };
  }
  async drive() {
    let result;
    try {
      const cwd = await this.cwd;
      if (realpathSync(cwd) !== this.deps.cwd) throw new Error("Workflow directory changed during admission");
      this.requireActive();
      if (this.runtime.sandboxMode === void 0 && this.policy.mode !== "danger-full-access") {
        throw new Error(`workflow runtime cannot enforce the ${this.policy.mode} file policy`);
      }
      const outcome = await this.runtime.run(this.runtime.resolve({
        program: this.runtime.programFormat === "repl" ? `await (async () => {
${PROGRAM}
})()` : PROGRAM,
        bindings: [{ global: "workflowHost", functions: this.bindings() }],
        cwd,
        ...this.runtime.sandboxMode === void 0 ? {} : { sandboxPolicy: this.policy },
        timeoutMs: null,
        signal: this.controller.signal
      }));
      this.terminal = true;
      if (this.cancelReason !== void 0) result = this.cancelled();
      else if (outcome.error !== void 0) result = { value: null, stopReason: "error", error: `workflow execution failed (${outcome.error.kind}): ${outcome.error.message}`, agentsStarted: this.started };
      else result = workflowResult(outcome.value);
    } catch (error) {
      this.terminal = true;
      result = this.cancelReason === void 0 ? { value: null, stopReason: "error", error: renderThrown(error), agentsStarted: this.started } : this.cancelled();
    } finally {
      this.terminal = true;
      this.deps.signal?.removeEventListener("abort", this.externalAbort);
      this.controller.abort("workflow settled");
      for (const record of this.children.values()) void this.disposeChild(record);
      while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
      await Promise.all([...this.children.values()].map((record) => this.disposeChild(record)));
      this.children.clear();
      if (!this.cleanupFailed) for (const info of this.liveAgents.values()) this.endAgent({ ...info, outcome: "cancelled" });
    }
    if (this.cleanupFailed) {
      try { this.deps.stopOwner?.(); } catch (error) { this.ctx.logger.warn(String(error)); }
      return {value:result?.value ?? null,stopReason:"error",error:"Child cleanup was not confirmed; recovery remains blocked",agentsStarted:this.started};
    }
    if (this.deps.journal?.hasUnsettled && result.stopReason === "completed")
      result = {...result,stopReason:"error",error:"Workflow left unfinished child calls; inspect file effects before retrying"};
    if (this.failedCalls && result.stopReason === "completed")
      result = {...result,stopReason:"error",error:`${this.failedCalls} child call(s) failed; partial results remain in the journal`};
    try {
      if (result.stopReason !== "completed") this.deps.stopOwner?.();
      this.deps.journal?.finish(result);
    }
    catch (error) { return {value:result.value,stopReason:"error",error:`Journal finalization failed: ${String(error)}`,agentsStarted:this.started}; }
    return result;
  }
};

import { realpathSync } from "node:fs";
import { WorkflowJournal, isWorkflowRunId, readRun, ownerStopped, stopOwner, releaseOwner } from "./journal.js";

// packages/workflow/workflow-ptc/src/meta.ts
import { WorkflowError as WorkflowError2 } from "@deepseek-ai/dsh-workflow";
function validateMetaShape(meta) {
  const violations = [];
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { violations: ["meta must be an object"] };
  }
  const record = meta;
  const known = /* @__PURE__ */ new Set(["name", "description", "whenToUse", "phases"]);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) violations.push(`meta.${key} is not a recognized field (name/description/whenToUse/phases)`);
  }
  if (typeof record.name !== "string" || record.name.length === 0) violations.push("meta.name must be a non-empty string");
  if (typeof record.description !== "string" || record.description.length === 0) violations.push("meta.description must be a non-empty string");
  if (record.whenToUse !== void 0 && typeof record.whenToUse !== "string") violations.push("meta.whenToUse must be a string");
  const phases = [];
  if (record.phases !== void 0) {
    if (!Array.isArray(record.phases)) {
      violations.push("meta.phases must be an array");
    } else {
      record.phases.forEach((phase, index) => {
        if (typeof phase !== "object" || phase === null || Array.isArray(phase)) {
          violations.push(`meta.phases[${index}] must be an object`);
          return;
        }
        const entry = phase;
        for (const key of Object.keys(entry)) {
          if (!["title", "detail", "provider", "model"].includes(key)) violations.push(`meta.phases[${index}].${key} is not a recognized field`);
        }
        if (typeof entry.title !== "string" || entry.title.length === 0) violations.push(`meta.phases[${index}].title must be a non-empty string`);
        if (entry.detail !== void 0 && typeof entry.detail !== "string") violations.push(`meta.phases[${index}].detail must be a string`);
        if (entry.provider !== void 0 && typeof entry.provider !== "string") violations.push(`meta.phases[${index}].provider must be a string`);
        if (entry.model !== void 0 && typeof entry.model !== "string") violations.push(`meta.phases[${index}].model must be a string`);
        if (violations.length === 0) {
          phases.push({
            title: entry.title,
            ...entry.detail !== void 0 ? { detail: entry.detail } : {},
            ...entry.provider !== void 0 ? { provider: entry.provider } : {},
            ...entry.model !== void 0 ? { model: entry.model } : {}
          });
        }
      });
    }
  }
  if (violations.length > 0) return { violations };
  return {
    violations,
    meta: {
      name: record.name,
      description: record.description,
      ...record.whenToUse !== void 0 ? { whenToUse: record.whenToUse } : {},
      ...record.phases !== void 0 ? { phases } : {}
    }
  };
}
function validateMeta(value) {
  const { meta, violations } = validateMetaShape(value);
  if (meta === void 0) {
    throw new WorkflowError2(`invalid meta: ${violations.join("; ")}`, "META_INVALID");
  }
  return meta;
}

// packages/workflow/workflow-ptc/src/index.ts
var META_STATEMENT = /^\s*export\s+const\s+meta\b/;
function assertBodyParses(body, name) {
  if (META_STATEMENT.test(body)) {
    throw new WorkflowError3("workflow meta rides the `meta` request field, not the script: remove the `export const meta = {...}` statement from the body", "SCRIPT_PARSE");
  }
  try {
    void new vm.Script(`(async () => {
${body}
})()`, { filename: `workflow:${name}`, lineOffset: -1 });
  } catch (error) {
    throw new WorkflowError3(`workflow script does not parse: ${String(error)}`, "SCRIPT_PARSE", { cause: error });
  }
}
function resolveSubagentProvider(ctx, configured, override) {
  const provider = override ?? configured;
  if (provider.length === 0 || provider !== provider.trim()) {
    throw new WorkflowError3(
      "workflow subagentProvider must be a non-empty normalized string",
      "INVALID_ARGUMENT"
    );
  }
  if (ctx.subagents.getProvider(provider) === void 0) {
    throw new WorkflowError3(`no subagent provider registered for "${provider}"`, "AGENT_START");
  }
  return provider;
}
function resolveMaxTotalAgents(requested, ceiling) {
  if (requested === void 0) return ceiling;
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new WorkflowError3("workflow maxTotalAgents must be a positive safe integer", "INVALID_ARGUMENT");
  }
  if (requested > ceiling) {
    throw new WorkflowError3(
      `workflow maxTotalAgents ${requested} exceeds the engine ceiling ${ceiling}`,
      "INVALID_ARGUMENT"
    );
  }
  return requested;
}
function resolveBudget(requested, ceiling, name) {
  if (requested === void 0) return ceiling;
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new WorkflowError3(`workflow ${name} must be a positive safe integer`, "INVALID_ARGUMENT");
  }
  if (ceiling !== null && requested > ceiling) {
    throw new WorkflowError3(`workflow ${name} ${requested} exceeds the engine ceiling ${ceiling}`, "INVALID_ARGUMENT");
  }
  return requested;
}
function resolveWarnAboveAgents(requested, fallback) {
  if (requested === void 0) return fallback;
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new WorkflowError3("workflow warnAboveAgents must be a non-negative safe integer", "INVALID_ARGUMENT");
  }
  return requested;
}
var PtcWorkflowEngine = class extends WorkflowEngine {
  static inject = ["subagents", "ptcRuntime", "sandboxPolicy", "workingDirectory"];
  static Config = z.object({
    provider: z.string().default("spawn"),
    maxConcurrentAgents: z.natural().default(0),
    maxTotalAgents: z.natural().min(1).default(1e3),
    maxItemsPerCall: z.natural().min(1).default(4096),
    syncTimeoutMs: z.natural().min(1).default(5e3),
    budgetTokens: z.union([z.const(null), z.natural().min(1)]).default(null),
    budgetMs: z.union([z.const(null), z.natural().min(1)]).default(null),
    warnAboveAgents: z.natural().default(0),
    journal: z.boolean().default(true),
    journalRoot: z.string().default(""),
    schemaRetries: z.natural().default(5)
  });
  config;
  /**
   * Child sessions this process started on behalf of a workflow run. Used to
   * enforce one nesting level: a workflow child may not start a workflow.
   */
  workflowChildren = /* @__PURE__ */ new Set();
  stoppedOwners = new Set();
  startGrants = new Map();
  activeRuns = new Map();
  /** Called only by the existing human /workflow command, never exposed as a model tool. */
  authorizeStart(parent, runId, requestId) {
    const id=parent.session.id;
    const grant={runId,requestId};
    this.startGrants.set(id,grant);
    return () => {if(this.startGrants.get(id)===grant)this.startGrants.delete(id);};
  }
  isBlocked(parent) {
    const root=this.journalRoot();
    return this.stoppedOwners.has(parent.session.id) || (root!==undefined && ownerStopped(root,parent.session.id));
  }
  async stopRun(parent, runId) {
    const run=this.activeRuns.get(runId);
    if(!run || run.parent.session.id!==parent.session.id) throw new Error("No active workflow with that ID in this session");
    run.cancel("human /workflow stop");
    await run.dispose();
    if(run.cleanupFailed) throw new Error("Stop requested, but child cleanup is not confirmed");
    return {stopped:true,runId};
  }
  resumeRequest(parent, runId) {
    const source=readRun(this.journalRoot(),runId).header;
    if(source.identity.owner!==parent.session.id || source.identity.cwd!==realpathSync(this.ctx.workingDirectory.get(parent.session)))
      throw new Error("Resume belongs to another session or working directory");
    const limits=source.identity.limits;
    if(!limits) throw new Error("Checkpoint has no verified resource limits; start an explicitly reviewed new task");
    return {meta:source.meta,script:source.script,args:source.args,resume_from_run_id:runId,
      ...(limits.budgetTokens===null?{}:{budget_tokens:limits.budgetTokens}),
      ...(limits.budgetMs===null?{}:{budget_ms:limits.budgetMs})};
  }
  constructor(ctx, config) {
    super(ctx);
    if (ctx.ptcRuntime.language !== "typescript") throw new Error("workflow-ptc requires the Node TypeScript PTC runtime");
    this.config = {
      ...config,
      budgetTokens: config.budgetTokens ?? null,
      budgetMs: config.budgetMs ?? null
    };
  }
  /** The host's harness-home path resolver, when mounted. */
  homePath() {
    const lookup = this.ctx.get.bind(this.ctx);
    return lookup("dshHomePath");
  }
  /** The engine's journal directory, or undefined to disable journaling. */
  journalRoot() {
    if (!this.config.journal) return void 0;
    return this.config.journalRoot !== "" ? this.config.journalRoot : this.homePath()?.("workflows", "runs");
  }
  /** Read a settled child's token usage over the live-or-cold session observation service. */
  tokenReader() {
    const lookup = this.ctx.get.bind(this.ctx);
    const query = lookup("sessionQuery");
    if (query === void 0) return void 0;
    return async (childId) => {
      const observation = await query.observeSession(childId, { projectionMode: "all" });
      try {
        const usage = observation.projections?.values.tokenUsage;
        if (usage === void 0) return 0;
        return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      } finally {
        observation[Symbol.dispose]();
      }
    };
  }
  /**
   * Validate and execute a workflow script in a sandboxed Node process. Throws
   * {@link WorkflowError} synchronously (`META_INVALID` for a malformed meta
   * block, `SCRIPT_PARSE` for a body that does not compile) for a request
   * that cannot begin; once a run is returned, every failure resolves through
   * `result.stopReason` instead.
   * @param request - the script body, its meta data and `args`, the parent
   *   agent, and an optional cancel signal.
   * @returns the live run (its `result` resolves when the script settles).
   */
  start(request) {
    const meta = validateMeta(request.meta);
    assertBodyParses(request.script, meta.name);
    if (this.workflowChildren.has(request.parent.session.id)) {
      throw new WorkflowError3(
        "a workflow child cannot start another workflow (one nesting level) \u2014 run this stage inline, or start it after the parent workflow settles",
        "AGENT_CAP"
      );
    }
    const extras = request;
    const budgetTokens = resolveBudget(extras.maxTokens, this.config.budgetTokens, "budget_tokens");
    const budgetMs = resolveBudget(extras.maxDurationMs, this.config.budgetMs, "budget_ms");
    const warnAboveAgents = resolveWarnAboveAgents(extras.warnAboveAgents, this.config.warnAboveAgents);
    const resumeFrom = extras.resumeFromRunId;
    if (resumeFrom !== void 0 && !isWorkflowRunId(resumeFrom)) {
      throw new WorkflowError3("workflow resume_from_run_id must be the run id returned by a prior workflow call", "INVALID_ARGUMENT");
    }
    const subagentProvider = resolveSubagentProvider(this.ctx, this.config.provider, request.subagentProvider);
    const maxTotalAgents = resolveMaxTotalAgents(request.maxTotalAgents, this.config.maxTotalAgents);
    const readTokens = this.tokenReader();
    if (budgetTokens !== null && readTokens === void 0) {
      throw new WorkflowError3(
        "a token budget requires the host session-query service (dsh-session-query); omit budget_tokens or mount it",
        "INVALID_ARGUMENT"
      );
    }
    const id = WorkflowRunId(randomUUID());
    const info = { id, meta };
    const limits = {
      maxConcurrentAgents: this.config.maxConcurrentAgents === 0 ? Math.min(16, Math.max(1, availableParallelism() - 2)) : this.config.maxConcurrentAgents,
      maxTotalAgents,
      maxItemsPerCall: this.config.maxItemsPerCall,
      syncTimeoutMs: this.config.syncTimeoutMs,
      budgetTokens,
      budgetMs,
      warnAboveAgents
    };
    const init = {
      meta,
      body: request.script,
      ...request.args !== void 0 ? { args: structuredClone(request.args) } : {},
      limits
    };
    const root=this.journalRoot();
    if(!root) throw new Error("Workflow lifecycle requires journaling");
    const owner=request.parent.session.id;
    let grant=this.startGrants.get(owner);
    if(grant?.requestId) {
      const event=request.parent.session.snapshotEvents().findLast(event=>event.type==='user/message' && (event.data?.message??event.data)?.source?.kind==='user');
      if((event?.data?.message??event?.data)?.source?.rpcId!==grant.requestId) grant=undefined;
    }
    if(this.stoppedOwners.has(owner) || ownerStopped(root,owner)) {
      if(!grant || (grant.runId!==undefined && grant.runId!==resumeFrom))
        throw new Error("Workflow was stopped. A human must use /workflow new <reviewed task> or /workflow resume <runId>; automatic restart is blocked.");
    }
    const policy=this.ctx.sandboxPolicy.resolve({session:request.parent.session});
    const cwd=realpathSync(this.ctx.workingDirectory.get(request.parent.session));
    const identity={owner,cwd,policy,limits,preset:request.parent.session.header.agentPreset??null,
      provider:subagentProvider,model:request.parent.options?.model??null,llmProvider:request.parent.options?.provider??null,
      reasoningEffort:request.parent.options?.reasoningEffort??null};
    const journal=new WorkflowJournal(root,id,{name:meta.name,provider:subagentProvider,identity,meta,script:request.script,args:request.args??{}},
      message=>this.ctx.logger.warn(message),resumeFrom);
    if(grant) {
      this.startGrants.delete(owner);
      releaseOwner(root,owner);
      this.stoppedOwners.delete(owner);
    }
    const runCtx = this.ctx;
    const subagents = runCtx.subagents;
    const run = new PtcWorkflowRun(
      runCtx,
      subagents,
      runCtx.ptcRuntime,
      id,
      meta,
      request.parent,
      init,
      subagentProvider,
      policy,
      {
        phase: (title) => {
          this.emitWorkflowEvent("workflow/phase", info, title);
        },
        log: (message) => {
          this.emitWorkflowEvent("workflow/log", info, message);
        },
        agentStart: (agent) => {
          this.emitWorkflowEvent("workflow/agent-start", info, agent);
        },
        agentEnd: (agent) => {
          this.emitWorkflowEvent("workflow/agent-end", info, agent);
        }
      },
      {
        journal,
        cwd,
        stopOwner: () => {this.stoppedOwners.add(owner);stopOwner(root,owner,id);},
        ...budgetTokens === null || readTokens === void 0 ? {} : { readTokens },
        schemaRetries: this.config.schemaRetries,
        maxTotalAgents,
        onChildActive: (childId, active) => {
          if (active) this.workflowChildren.add(childId);
          else this.workflowChildren.delete(childId);
        },
        ...request.signal === void 0 ? {} : { signal: request.signal }
      }
    );
    this.activeRuns.set(id,run);
    this.emitWorkflowEvent("workflow/start", info);
    void run.result.then((settled) => {
      this.activeRuns.delete(id);
      this.emitWorkflowEvent("workflow/end", info, {
        stopReason: settled.stopReason,
        ...settled.error !== void 0 ? { error: settled.error } : {},
        agentsStarted: settled.agentsStarted
      });
    });
    return run;
  }
};
var index_default = PtcWorkflowEngine;
export {
  MaterializeError,
  index_default as default,
  materializeFromRealm,
  validateMeta
};
