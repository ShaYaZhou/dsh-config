// packages/workflow/workflow-ptc/src/index.ts
import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import { relative, isAbsolute, sep } from "node:path";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import * as vm from "node:vm";
import z from "@deepseek-ai/schemastery";
import WorkflowEngine, { WorkflowError as WorkflowError3, WorkflowRunId } from "@deepseek-ai/dsh-workflow";

// packages/workflow/workflow-ptc/src/host.ts
import { SessionId } from "@deepseek-ai/dsh-session";
import { assertObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import { assertNever, snapshotJsonValue } from "@deepseek-ai/dsh-util-values";

// packages/workflow/workflow-ptc/src/guest-source.ts
var WORKFLOW_GUEST_SOURCE = 'import * as vm from "node:vm";\n//#region packages/workflow/workflow-ptc/src/realm.ts\n/**\n* Materializes script VM values as plain JSON and renders thrown values.\n* Getters and proxy traps may execute inside the confined Node process;\n* process isolation and cancellation belong to PTC, not the VM.\n* @module @deepseek-ai/dsh-workflow-ptc/realm\n*/\n/** Thrown by {@link materializeFromRealm}; the caller wraps it into the right `WorkflowError` code. */\nvar MaterializeError = class extends Error {\n\tpath;\n\treason;\n\tconstructor(path, reason) {\n\t\tsuper(`${path}: ${reason}`);\n\t\tthis.path = path;\n\t\tthis.reason = reason;\n\t\tthis.name = "MaterializeError";\n\t}\n};\n/**\n* Render a thrown value to failure text without ever throwing: prefer the\n* `stack` (host or realm — a realm error\'s `stack` is a plain string read),\n* fall back to `message`, then `String()`. Reading those properties MAY run\n* script code; if that code itself throws, a fixed label is returned instead.\n* @param error - any value thrown in the host or guest realm.\n* @returns human-readable text for the failure report; prefers the stack.\n*/\nfunction renderThrown(error) {\n\ttry {\n\t\tconst stack = error?.stack;\n\t\tif (typeof stack === "string" && stack.length > 0) return stack;\n\t\tconst message = error?.message;\n\t\tif (typeof message === "string" && message.length > 0) return message;\n\t\treturn String(error);\n\t} catch {\n\t\treturn "[unrenderable thrown value]";\n\t}\n}\n/**\n* Whether an object\'s prototype chain represents a plain data object: `null`, or a prototype\n* whose own prototype is `null` (the realm\'s `Object.prototype` — which we\n* cannot compare by identity across realms). A `Date`/`Map`/class instance\n* has a longer chain and is rejected.\n*/\nfunction hasPlainPrototype(value) {\n\tconst proto = Object.getPrototypeOf(value);\n\tif (proto === null) return true;\n\treturn Object.getPrototypeOf(proto) === null;\n}\n/**\n* Copy `value` (typically from the vm realm) into plain host JSON data. Root `undefined` is\n* returned unchanged; nested `undefined` and values JSON cannot represent losslessly fail\n* with the offending path. Property accessors run normally, and a throwing read is wrapped\n* with its rendered failure.\n*\n* @param value - the realm value to materialize.\n* @param root - the path label for the root value (error messages).\n* @returns the host-realm copy (plain objects/arrays/scalars only).\n* @throws {@link MaterializeError} for unsupported values, cycles, sparse arrays, exotic\n*   prototypes, or property reads that throw.\n*/\nfunction materializeFromRealm(value, root = "value") {\n\tif (value === void 0) return void 0;\n\ttry {\n\t\treturn materialize(value, root, /* @__PURE__ */ new Set());\n\t} catch (error) {\n\t\tif (error instanceof MaterializeError) throw error;\n\t\tthrow new MaterializeError(root, `reading the value threw: ${renderThrown(error)}`);\n\t}\n}\nfunction materialize(value, path, seen) {\n\tswitch (typeof value) {\n\t\tcase "boolean":\n\t\tcase "string": return value;\n\t\tcase "number":\n\t\t\tif (!Number.isFinite(value)) throw new MaterializeError(path, "non-finite numbers are not JSON data");\n\t\t\treturn value;\n\t\tcase "bigint": throw new MaterializeError(path, "bigints are not JSON data");\n\t\tcase "function": throw new MaterializeError(path, "functions are not plain JSON data");\n\t\tcase "symbol": throw new MaterializeError(path, "symbols are not plain JSON data");\n\t\tcase "undefined": throw new MaterializeError(path, "undefined is not JSON data");\n\t\tcase "object": break;\n\t}\n\tif (value === null) return null;\n\tconst objectValue = value;\n\tif (seen.has(objectValue)) throw new MaterializeError(path, "circular references are not JSON data");\n\tseen.add(objectValue);\n\ttry {\n\t\tif (Array.isArray(objectValue)) return materializeArray(objectValue, path, seen);\n\t\treturn materializeObject(objectValue, path, seen);\n\t} finally {\n\t\tseen.delete(objectValue);\n\t}\n}\nfunction materializeArray(value, path, seen) {\n\tconst out = [];\n\tfor (let index = 0; index < value.length; index++) {\n\t\tif (!(index in value)) throw new MaterializeError(`${path}[${index}]`, "sparse arrays are not JSON data");\n\t\tout.push(materialize(value[index], `${path}[${index}]`, seen));\n\t}\n\tfor (const key of Object.keys(value)) {\n\t\tconst index = Number(key);\n\t\tif (!Number.isInteger(index) || index < 0 || index >= value.length) throw new MaterializeError(`${path}.${key}`, "arrays with non-index properties are not JSON data");\n\t}\n\tif (Object.getOwnPropertySymbols(value).length > 0) throw new MaterializeError(path, "symbol-keyed properties are not plain JSON data");\n\treturn out;\n}\nfunction materializeObject(value, path, seen) {\n\tif (!hasPlainPrototype(value)) throw new MaterializeError(path, "only plain objects and arrays are JSON data (exotic prototype)");\n\tif (Object.getOwnPropertySymbols(value).length > 0) throw new MaterializeError(path, "symbol-keyed properties are not plain JSON data");\n\tconst out = {};\n\tfor (const key of Object.keys(value)) Object.defineProperty(out, key, {\n\t\tvalue: materialize(value[key], `${path}.${key}`, seen),\n\t\tenumerable: true,\n\t\twritable: true,\n\t\tconfigurable: true\n\t});\n\treturn out;\n}\n//#endregion\n//#region packages/util/brand/src/index.ts\n/**\n* Apply a compile-time string brand without changing the value.\n* @param value - string admitted by the domain that owns the target brand.\n* @returns the same string with the requested compile-time brand.\n*/\nfunction brandString(value) {\n\treturn value;\n}\n//#endregion\n//#region packages/util/values/src/index.ts\n/**\n* Mark an unreachable closed-union branch.\n* @param value - impossible value; an unhandled typed variant fails at the call site.\n* @param context - optional switch-site label included in the failure message.\n* @returns never; a runtime value that escaped its type always throws.\n*/\nfunction assertNever(value, context) {\n\tconst rendered = JSON.stringify(value) ?? String(value);\n\tthrow new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);\n}\n/** Whether a realm-owned intrinsic prototype has a native constructor matching this engine\'s representation. */\nfunction hasIntrinsicConstructor$1(prototype, name) {\n\tconst constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;\n\tif (typeof constructor !== "function") return false;\n\ttry {\n\t\treturn constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);\n\t} catch {\n\t\treturn false;\n\t}\n}\n/** Whether a candidate is one realm\'s intrinsic `Object.prototype`. */\nfunction isIntrinsicObjectPrototype$1(value) {\n\treturn Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");\n}\n/** Whether an array uses one realm\'s intrinsic `Array.prototype`, not a subclass or forged prototype. */\nfunction hasPlainArrayPrototype$1(value) {\n\tconst prototype = Object.getPrototypeOf(value);\n\tif (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;\n\tconst objectPrototype = Object.getPrototypeOf(prototype);\n\treturn typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);\n}\n/** Whether an object is a plain or null-prototype record from any JavaScript realm. */\nfunction hasPlainObjectPrototype(value) {\n\tconst prototype = Object.getPrototypeOf(value);\n\treturn prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);\n}\n/** Return every JSON-visible object key, or reject own data JSON would discard. */\nfunction enumerableStringKeys(value) {\n\tconst keys = Reflect.ownKeys(value);\n\tif (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;\n\treturn keys;\n}\n/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */\nfunction walkJsonValue(value, detach) {\n\tconst ancestors = /* @__PURE__ */ new Set();\n\tlet root;\n\tconst assign = (destination, item) => {\n\t\tif (destination === void 0) return;\n\t\tif (destination.kind === "root") root = item;\n\t\telse if (destination.kind === "array") destination.target[destination.index] = item;\n\t\telse Object.defineProperty(destination.target, destination.key, {\n\t\t\tvalue: item,\n\t\t\tenumerable: true,\n\t\t\tconfigurable: true,\n\t\t\twritable: true\n\t\t});\n\t};\n\tconst tasks = [{\n\t\tkind: "visit",\n\t\tvalue,\n\t\t...detach ? { destination: { kind: "root" } } : {}\n\t}];\n\tfor (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {\n\t\tif (task.kind === "leave") {\n\t\t\tancestors.delete(task.source);\n\t\t\tcontinue;\n\t\t}\n\t\tif (task.kind === "array-item") {\n\t\t\tif (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;\n\t\t\ttasks.push({\n\t\t\t\tkind: "visit",\n\t\t\t\tvalue: task.source[task.index],\n\t\t\t\t...task.target === void 0 ? {} : { destination: {\n\t\t\t\t\tkind: "array",\n\t\t\t\t\ttarget: task.target,\n\t\t\t\t\tindex: task.index\n\t\t\t\t} }\n\t\t\t});\n\t\t\tcontinue;\n\t\t}\n\t\tif (task.kind === "object-property") {\n\t\t\ttasks.push({\n\t\t\t\tkind: "visit",\n\t\t\t\tvalue: task.source[task.key],\n\t\t\t\t...task.target === void 0 ? {} : { destination: {\n\t\t\t\t\tkind: "object",\n\t\t\t\t\ttarget: task.target,\n\t\t\t\t\tkey: task.key\n\t\t\t\t} }\n\t\t\t});\n\t\t\tcontinue;\n\t\t}\n\t\tconst current = task.value;\n\t\tif (current === null) {\n\t\t\tassign(task.destination, null);\n\t\t\tcontinue;\n\t\t}\n\t\tif (typeof current === "boolean" || typeof current === "string") {\n\t\t\tassign(task.destination, current);\n\t\t\tcontinue;\n\t\t}\n\t\tif (typeof current === "number") {\n\t\t\tif (!Number.isFinite(current) || Object.is(current, -0)) return void 0;\n\t\t\tassign(task.destination, current);\n\t\t\tcontinue;\n\t\t}\n\t\tif (typeof current !== "object") return void 0;\n\t\tif (ancestors.has(current)) return void 0;\n\t\tif (Array.isArray(current)) {\n\t\t\tif (!hasPlainArrayPrototype$1(current)) return void 0;\n\t\t\tconst length = current.length;\n\t\t\tif (Reflect.ownKeys(current).length !== length + 1) return void 0;\n\t\t\tconst target = detach ? [] : void 0;\n\t\t\tif (target !== void 0) assign(task.destination, target);\n\t\t\tancestors.add(current);\n\t\t\ttasks.push({\n\t\t\t\tkind: "leave",\n\t\t\t\tsource: current\n\t\t\t});\n\t\t\tfor (let index = length - 1; index >= 0; index--) tasks.push({\n\t\t\t\tkind: "array-item",\n\t\t\t\tsource: current,\n\t\t\t\tindex,\n\t\t\t\t...target === void 0 ? {} : { target }\n\t\t\t});\n\t\t\tcontinue;\n\t\t}\n\t\tif (!hasPlainObjectPrototype(current)) return void 0;\n\t\tconst keys = enumerableStringKeys(current);\n\t\tif (keys === void 0) return void 0;\n\t\tconst target = detach ? {} : void 0;\n\t\tif (target !== void 0) assign(task.destination, target);\n\t\tancestors.add(current);\n\t\ttasks.push({\n\t\t\tkind: "leave",\n\t\t\tsource: current\n\t\t});\n\t\tfor (let index = keys.length - 1; index >= 0; index--) {\n\t\t\tconst key = keys[index];\n\t\t\t/* v8 ignore next -- the loop is bounded by the captured key count. */\n\t\t\tif (key === void 0) return void 0;\n\t\t\ttasks.push({\n\t\t\t\tkind: "object-property",\n\t\t\t\tsource: current,\n\t\t\t\tkey,\n\t\t\t\t...target === void 0 ? {} : { target }\n\t\t\t});\n\t\t}\n\t}\n\treturn detach ? root : true;\n}\n/**\n* Test the same lossless JSON rules as {@link snapshotJsonValue} without detaching the value.\n* @param value - candidate value to test.\n* @returns whether the value survives a JSON round trip without loss.\n*/\nfunction isJsonValue(value) {\n\treturn walkJsonValue(value, false) === true;\n}\n//#endregion\n//#region packages/llm/llm/src/error.ts\n/**\n* Harness error base with a stable machine-routable code and chained cause.\n* Package errors extend it so tool results and replay can retain failure class.\n* @module @deepseek-ai/dsh-llm/error\n*/\n/**\n* Base class for all harness errors. Carries a `code` (stable, programmatic —\n* e.g. `NO_ADAPTER`, `INVALID_ARGS`) distinct from the\n* human-readable `message`, and supports `cause` chaining via the standard\n* `ErrorOptions`. `name` defaults to the subclass constructor name.\n*/\nvar HarnessError = class extends Error {\n\t/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */\n\tcode;\n\tconstructor(message, code, options) {\n\t\tsuper(message, options);\n\t\tthis.code = code;\n\t\tthis.name = new.target.name;\n\t}\n};\nnew RegExp(String.raw`(?:^|[^a-z0-9])context[\\s_-](?:length|window)[\\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\\s_-]exceeded)(?:$|[^a-z0-9])`, "i");\nnew RegExp(String.raw`\\b(?:request|prompt|input|messages?)\\s+(?:is\\s+|are\\s+)?` + String.raw`too\\s+(?:large|long)\\s+for\\s+(?:(?:this|the)\\s+)?` + String.raw`(?:model(?:\'s)?\\s+)?context(?:\\s+window)?\\b`, "i");\nnew RegExp(String.raw`\\b(?:input|prompt|request|messages?)\\b.{0,40}` + String.raw`\\b(?:exceed(?:s|ed)?|overflows?|is\\s+larger\\s+than)\\b.{0,40}` + String.raw`\\b(?:the\\s+)?(?:model(?:\'s)?\\s+)?context(?:\\s+(?:length|window))?\\b`, "i");\n//#endregion\n//#region packages/core/tools/src/json-schema.ts\n/**\n* Enforced JSON Schema subset shared by tool outputs, generated PTC mode\n* types, subagents, and workflows. The subset accepts any JSON root, an\n* annotation-only schema for unconstrained JSON, one scalar `type`, object\n* `properties`/`required`/boolean `additionalProperties`, array `items`,\n* type-correct scalar `enum`/`const`, and exact-one `oneOf`.\n*\n* Unsupported or misplaced keywords reject rather than being accepted without\n* enforcement. Consumers that require an object root apply\n* {@link assertObjectJsonSchema} before accepting input.\n* @module dsh-tools/json-schema\n*/\n/**\n* Thrown when a raw schema falls outside the enforced subset. `violations`\n* lists every offending path instead of stopping at the first author error.\n*/\nvar JsonSchemaError = class extends HarnessError {\n\t/** Individual schema violations in walk order. */\n\tviolations;\n\tconstructor(violations) {\n\t\tsuper(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");\n\t\tthis.name = "JsonSchemaError";\n\t\tthis.violations = violations;\n\t}\n};\nconst CONSTRAINT_KEYWORDS = /* @__PURE__ */ new Set([\n\t"type",\n\t"oneOf",\n\t"properties",\n\t"required",\n\t"additionalProperties",\n\t"items",\n\t"enum",\n\t"const"\n]);\nconst ANNOTATION_KEYWORDS = /* @__PURE__ */ new Set([\n\t"description",\n\t"title",\n\t"default",\n\t"examples"\n]);\nconst SCHEMA_TYPES = [\n\t"object",\n\t"array",\n\t"string",\n\t"number",\n\t"integer",\n\t"boolean",\n\t"null"\n];\n/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */\nfunction hasIntrinsicConstructor(prototype, name) {\n\tconst constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;\n\tif (typeof constructor !== "function") return false;\n\ttry {\n\t\treturn constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;\n\t} catch {\n\t\treturn false;\n\t}\n}\n/** Whether a candidate is one realm\'s intrinsic `Object.prototype`. */\nfunction isIntrinsicObjectPrototype(value) {\n\treturn Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");\n}\n/**\n* Test for a realm-agnostic plain JSON record without accepting arrays or\n* exotic objects.\n* @param value - candidate record from any JavaScript realm.\n* @returns Whether the value has a plain-object prototype chain.\n*/\nfunction isPlainJsonRecord(value) {\n\tif (typeof value !== "object" || value === null || Array.isArray(value)) return false;\n\ttry {\n\t\tconst prototype = Object.getPrototypeOf(value);\n\t\treturn prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);\n\t} catch {\n\t\treturn false;\n\t}\n}\n/** Whether an array uses one realm\'s intrinsic `Array.prototype`. */\nfunction hasPlainArrayPrototype(value) {\n\tconst prototype = Object.getPrototypeOf(value);\n\tif (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;\n\tconst objectPrototype = Object.getPrototypeOf(prototype);\n\treturn typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);\n}\n/** Return whether a record contains only own enumerable string keys. */\nfunction hasOnlyEnumerableStringKeys(value) {\n\ttry {\n\t\treturn Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));\n\t} catch {\n\t\treturn false;\n\t}\n}\n/**\n* Test for an ordinary schema record whose keys survive JSON projection.\n* @param value - candidate record from any JavaScript realm.\n* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.\n*/\nfunction isJsonSchemaRecord(value) {\n\treturn isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);\n}\n/**\n* Test for a dense ordinary array with no JSON-invisible decorations.\n* @param value - candidate array from any JavaScript realm.\n* @returns Whether the array is intrinsic, dense, and undecorated.\n*/\nfunction isPlainJsonArray(value) {\n\tif (!Array.isArray(value)) return false;\n\ttry {\n\t\tif (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;\n\t\tfor (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;\n\t\treturn true;\n\t} catch {\n\t\treturn false;\n\t}\n}\n/** Lossless finite JSON number, excluding negative zero. */\nfunction isJsonNumber(value) {\n\treturn typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);\n}\n/** Whether a scalar is valid for one declared schema type. */\nfunction scalarMatches(type, value) {\n\tswitch (type) {\n\t\tcase "string": return typeof value === "string";\n\t\tcase "number": return isJsonNumber(value);\n\t\tcase "integer": return isJsonNumber(value) && Number.isInteger(value);\n\t\tcase "boolean": return typeof value === "boolean";\n\t\tcase "null": return value === null;\n\t\t/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */\n\t\tdefault: return assertNever(type, "JsonSchemaType");\n\t}\n}\n/** Keywords that are invalid beside `oneOf`. */\nconst ONE_OF_SIBLING_KEYWORDS = [\n\t"properties",\n\t"required",\n\t"additionalProperties",\n\t"items",\n\t"enum",\n\t"const"\n];\n/** Validate object-only fields after its property schemas have been visited. */\nfunction checkObjectSchemaTail(node, path, properties, violations) {\n\tconst hasRequired = Object.hasOwn(node, "required");\n\tconst required = hasRequired ? node.required : void 0;\n\tif (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);\n\telse {\n\t\tconst declared = isJsonSchemaRecord(properties) ? properties : {};\n\t\tfor (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);\n\t}\n\tif (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);\n}\n/** Collect every violation for one raw schema tree without using the JavaScript call stack. */\nfunction checkSchemaNode(root, rootPath, violations, seen) {\n\tconst tasks = [{\n\t\tkind: "enter",\n\t\tnode: root,\n\t\tpath: rootPath\n\t}];\n\tfor (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {\n\t\tif (task.kind === "leave") {\n\t\t\tseen.delete(task.node);\n\t\t\tcontinue;\n\t\t}\n\t\tif (task.kind === "one-of-tail") {\n\t\t\tfor (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);\n\t\t\tcontinue;\n\t\t}\n\t\tif (task.kind === "object-tail") {\n\t\t\tcheckObjectSchemaTail(task.node, task.path, task.properties, violations);\n\t\t\tcontinue;\n\t\t}\n\t\tconst { node, path } = task;\n\t\tif (!isJsonSchemaRecord(node)) {\n\t\t\tviolations.push(`${path} must be a schema object`);\n\t\t\tcontinue;\n\t\t}\n\t\tif (seen.has(node)) {\n\t\t\tviolations.push(`${path} is circular`);\n\t\t\tcontinue;\n\t\t}\n\t\tseen.add(node);\n\t\ttasks.push({\n\t\t\tkind: "leave",\n\t\t\tnode\n\t\t});\n\t\tfor (const key of Object.keys(node)) {\n\t\t\tif (CONSTRAINT_KEYWORDS.has(key)) continue;\n\t\t\tif (ANNOTATION_KEYWORDS.has(key)) {\n\t\t\t\ttry {\n\t\t\t\t\tif (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);\n\t\t\t\t} catch {\n\t\t\t\t\tviolations.push(`${path}.${key} annotation must be lossless JSON data`);\n\t\t\t\t}\n\t\t\t\tcontinue;\n\t\t\t}\n\t\t\tviolations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);\n\t\t}\n\t\tif (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);\n\t\tif (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);\n\t\tconst hasType = Object.hasOwn(node, "type");\n\t\tconst hasOneOf = Object.hasOwn(node, "oneOf");\n\t\tif (hasType && hasOneOf) {\n\t\t\tviolations.push(`${path} cannot declare both type and oneOf`);\n\t\t\tcontinue;\n\t\t}\n\t\tif (!hasType && !hasOneOf) {\n\t\t\tfor (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);\n\t\t\tcontinue;\n\t\t}\n\t\tif (hasOneOf) {\n\t\t\tconst oneOf = node.oneOf;\n\t\t\ttasks.push({\n\t\t\t\tkind: "one-of-tail",\n\t\t\t\tnode,\n\t\t\t\tpath\n\t\t\t});\n\t\t\tif (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);\n\t\t\telse for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({\n\t\t\t\tkind: "enter",\n\t\t\t\tnode: oneOf[index],\n\t\t\t\tpath: `${path}.oneOf[${index}]`\n\t\t\t});\n\t\t\tcontinue;\n\t\t}\n\t\tconst type = node.type;\n\t\tif (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {\n\t\t\tviolations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);\n\t\t\tcontinue;\n\t\t}\n\t\tconst schemaType = type;\n\t\tfor (const [key, types] of Object.entries({\n\t\t\tproperties: ["object"],\n\t\t\trequired: ["object"],\n\t\t\tadditionalProperties: ["object"],\n\t\t\titems: ["array"],\n\t\t\tenum: [\n\t\t\t\t"string",\n\t\t\t\t"number",\n\t\t\t\t"integer",\n\t\t\t\t"boolean",\n\t\t\t\t"null"\n\t\t\t],\n\t\t\tconst: [\n\t\t\t\t"string",\n\t\t\t\t"number",\n\t\t\t\t"integer",\n\t\t\t\t"boolean",\n\t\t\t\t"null"\n\t\t\t]\n\t\t})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);\n\t\tswitch (schemaType) {\n\t\t\tcase "object": {\n\t\t\t\tconst properties = Object.hasOwn(node, "properties") ? node.properties : void 0;\n\t\t\t\ttasks.push({\n\t\t\t\t\tkind: "object-tail",\n\t\t\t\t\tnode,\n\t\t\t\t\tpath,\n\t\t\t\t\tproperties\n\t\t\t\t});\n\t\t\t\tif (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);\n\t\t\t\telse {\n\t\t\t\t\tconst entries = Object.entries(properties);\n\t\t\t\t\tfor (let index = entries.length - 1; index >= 0; index--) {\n\t\t\t\t\t\tconst entry = entries[index];\n\t\t\t\t\t\t/* v8 ignore next -- the loop is bounded by the captured entry count. */\n\t\t\t\t\t\tif (entry === void 0) continue;\n\t\t\t\t\t\ttasks.push({\n\t\t\t\t\t\t\tkind: "enter",\n\t\t\t\t\t\t\tnode: entry[1],\n\t\t\t\t\t\t\tpath: `${path}.properties.${entry[0]}`\n\t\t\t\t\t\t});\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tcase "array":\n\t\t\t\tif (Object.hasOwn(node, "items")) tasks.push({\n\t\t\t\t\tkind: "enter",\n\t\t\t\t\tnode: node.items,\n\t\t\t\t\tpath: `${path}.items`\n\t\t\t\t});\n\t\t\t\tbreak;\n\t\t\tcase "string":\n\t\t\tcase "number":\n\t\t\tcase "integer":\n\t\t\tcase "boolean":\n\t\t\tcase "null": {\n\t\t\t\tconst hasEnum = Object.hasOwn(node, "enum");\n\t\t\t\tconst allowed = hasEnum ? node.enum : void 0;\n\t\t\t\tconst enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));\n\t\t\t\tif (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);\n\t\t\t\tconst hasConst = Object.hasOwn(node, "const");\n\t\t\t\tconst declaredConst = hasConst ? node.const : void 0;\n\t\t\t\tconst constValid = scalarMatches(schemaType, declaredConst);\n\t\t\t\tif (hasConst) {\n\t\t\t\t\tif (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);\n\t\t\t\t\telse if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);\n\t\t\t\t}\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\t/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */\n\t\t\tdefault: assertNever(schemaType, "JsonSchemaType");\n\t\t}\n\t}\n}\n/**\n* Assert the enforced subset plus the object-root constraint retained by\n* subagent and workflow structured outputs.\n* @param schema - untrusted caller-supplied schema.\n* @returns Assertion that the schema belongs to the supported subset and has an object root.\n*/\nfunction assertObjectJsonSchema(schema) {\n\tconst violations = [];\n\tcheckSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());\n\tif (violations.length === 0 && (!isJsonSchemaRecord(schema) || !Object.hasOwn(schema, "type") || schema.type !== "object")) violations.push("schema.type must be \\"object\\" (structured output is object-rooted)");\n\tif (violations.length > 0) throw new JsonSchemaError(violations);\n}\n//#endregion\n//#region packages/workflow/workflow/src/index.ts\n/**\n* Typed error for workflow-seam failures. Extends {@link HarnessError}, so the\n* `code` is machine-routable taxonomy. `fatal` drives the combinator\n* discipline: `parallel()`/`pipeline()` re-throw a fatal error (a typo\'d\n* option or a tripped cap must kill the script loudly), and reserve the\n* per-item `null` for child-run failures and ordinary in-stage script errors.\n* Every {@link WorkflowErrorCode} is fatal; the flag exists so the\n* distinction is explicit at every catch site rather than implied.\n*/\nvar WorkflowError = class extends HarnessError {\n\t/** Whether combinators must propagate this error instead of nulling the item. */\n\tfatal;\n\tconstructor(message, code, options) {\n\t\tsuper(message, code, options);\n\t\tthis.name = "WorkflowError";\n\t\tthis.fatal = options?.fatal ?? true;\n\t}\n};\n/**\n* Whether combinators must re-throw `error` instead of mapping the item to `null`.\n* @param error - any thrown value; fatality is host `instanceof` (unforgeable from a script realm).\n* @returns true iff `error` is a {@link WorkflowError} whose `fatal` flag is set.\n*/\nfunction isFatalWorkflowError(error) {\n\treturn error instanceof WorkflowError && error.fatal;\n}\n//#endregion\n//#region packages/workflow/workflow-ptc/src/runtime.ts\n/**\n* Workflow VM hooks, child callbacks, ordinary concurrency limits and result serialization.\n* PTC owns process confinement and cancellation. Fatal hook and provider failures propagate\n* through combinators; ordinary child failures and stage errors become per-item nulls.\n* @module @deepseek-ai/dsh-workflow-ptc/runtime\n*/\n/** The `agent()` options the script may pass; everything else rejects loud. */\nconst SUPPORTED_AGENT_OPTIONS = /* @__PURE__ */ new Set([\n\t"label",\n\t"phase",\n\t"cwd",\n\t"read_only",\n\t"reasoning_effort",\n\t"browser",\n\t"session",\n\t"schema",\n\t"provider",\n\t"model"\n]);\n/** Deferred Claude Code options we name explicitly in the rejection message. */\nconst DEFERRED_AGENT_OPTIONS = /* @__PURE__ */ new Set([\n\t"effort",\n\t"isolation",\n\t"agentType"\n]);\n/** Flatten a child\'s final output blocks to text (the non-schema `agent()` result). */\nfunction outputText(blocks) {\n\treturn blocks.filter((block) => block.type === "text").map((block) => block.text).join("");\n}\n/** A short display label derived from the prompt when the script passes none. */\nfunction defaultLabel(prompt) {\n\tconst newline = prompt.indexOf("\\n");\n\tconst line = newline === -1 ? prompt : prompt.slice(0, newline);\n\treturn line.length <= 48 ? line : `${line.slice(0, 47)}…`;\n}\n/**\n* One script execution inside the confined Node process. The host owns\n* cancellation and cleanup of any dropped child work.\n*/\nvar WorkflowExecution = class {\n\tlimits;\n\tobserver;\n\tchildren;\n\t/** 1-based count of `agent()` calls started (the `agentsStarted` result field). */\n\tstarted = 0;\n\t/** Child tokens debited so far; only the host can report them, after each child settles. */\n\tspentTokens = 0;\n\t/** Run start on the PTC process clock, the basis for the elapsed-time budget. */\n\tstartedAt = Date.now();\n\tactiveSlots = 0;\n\tslotWaiters = [];\n\tcurrentPhase;\n\tcontext;\n\tcompiled;\n\tconstructor(meta, body, args, limits, observer, children) {\n\t\tthis.limits = limits;\n\t\tthis.observer = observer;\n\t\tthis.children = children;\n\t\ttry {\n\t\t\tthis.compiled = new vm.Script(`(async () => {\\n${body}\\n})()`, {\n\t\t\t\tfilename: `workflow:${meta.name}`,\n\t\t\t\tlineOffset: -1\n\t\t\t});\n\t\t} catch (error) {\n\t\t\tthrow new WorkflowError(`workflow script does not parse before any agent starts: ${String(error)}. Check delimiters and double-escaped newlines: between statements use actual newlines or semicolons, not literal backslash-n. Fix the script; do not start empty probe workflows.`, "SCRIPT_PARSE", { cause: error });\n\t\t}\n\t\tthis.context = vm.createContext({}, { name: `workflow:${meta.name}` });\n\t\tconst globals = {\n\t\t\tagent: (prompt, opts) => this.contain(this.agent(prompt, opts)),\n\t\t\tparallel: (thunks) => this.contain(this.parallel(thunks)),\n\t\t\tpipeline: (items, ...stages) => this.contain(this.pipeline(items, stages)),\n\t\t\tphase: (title) => {\n\t\t\t\tthis.phase(title);\n\t\t\t},\n\t\t\tlog: (message) => {\n\t\t\t\tthis.log(message);\n\t\t\t},\n\t\t\targs,\n\t\t\tbudget: Object.freeze({\n\t\t\t\ttotal: this.limits.budgetTokens,\n\t\t\t\ttimeLimitMs: this.limits.budgetMs,\n\t\t\t\tspent: () => this.spentTokens,\n\t\t\t\tremaining: () => this.limits.budgetTokens === null ? null : Math.max(0, this.limits.budgetTokens - this.spentTokens),\n\t\t\t\telapsedMs: () => Date.now() - this.startedAt,\n\t\t\t\ttimeRemainingMs: () => this.limits.budgetMs === null ? null : Math.max(0, this.limits.budgetMs - (Date.now() - this.startedAt))\n\t\t\t})\n\t\t};\n\t\tfor (const [key, value] of Object.entries(globals)) this.context[key] = typeof value === "function" ? Object.freeze(value) : value;\n\t}\n\t/**\n\t* Run the script and materialize its JSON return value.\n\t* @returns A completed or error result; script failures never reject.\n\t*/\n\tasync drive() {\n\t\ttry {\n\t\t\tconst scriptPromise = this.compiled.runInContext(this.context, { timeout: this.limits.syncTimeoutMs });\n\t\t\tconst raw = await this.contain(Promise.resolve(scriptPromise));\n\t\t\treturn {\n\t\t\t\tvalue: raw === void 0 ? null : this.materializeResult(raw),\n\t\t\t\tstopReason: "completed",\n\t\t\t\tagentsStarted: this.started\n\t\t\t};\n\t\t} catch (error) {\n\t\t\tconst failure = renderThrown(error);\n\t\t\tconst authored = this.started === 0 && /undefined|is not a function|is not iterable/.test(failure);\n\t\t\treturn {\n\t\t\t\tvalue: null,\n\t\t\t\tstopReason: "error",\n\t\t\t\terror: authored ? failure + ". The script threw before its first agent started: this is an authoring error in this workflow call (most often a missing args key), not an engine defect. Fix the script or pass args, then rerun; do not inspect engine source." : failure,\n\t\t\t\tagentsStarted: this.started\n\t\t\t};\n\t\t}\n\t}\n\t/**\n\t* Attach a no-op rejection consumer WITHOUT changing what the caller\n\t* receives: if the script drops the promise, a host rejection cannot become\n\t* an unhandled rejection that kills the process; if\n\t* the script does await it, it still observes the rejection.\n\t*/\n\tcontain(promise) {\n\t\tpromise.catch(() => {});\n\t\treturn promise;\n\t}\n\t/** Materialize the script\'s return value; violations become RESULT_UNSERIALIZABLE. */\n\tmaterializeResult(raw) {\n\t\ttry {\n\t\t\treturn materializeFromRealm(raw, "workflow result");\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */\n\t\t\tif (!(error instanceof MaterializeError)) throw error;\n\t\t\tthrow new WorkflowError(`the workflow\'s return value is not plain JSON data — ${error.message}. Return only JSON-serializable objects/arrays/scalars.`, "RESULT_UNSERIALIZABLE", { cause: error });\n\t\t}\n\t}\n\t/** Acquire one concurrency slot in FIFO order. */\n\tacquireSlot() {\n\t\tif (this.activeSlots < this.limits.maxConcurrentAgents) {\n\t\t\tthis.activeSlots += 1;\n\t\t\treturn Promise.resolve();\n\t\t}\n\t\treturn new Promise((resolve) => {\n\t\t\tthis.slotWaiters.push(() => {\n\t\t\t\tthis.activeSlots += 1;\n\t\t\t\tresolve();\n\t\t\t});\n\t\t});\n\t}\n\treleaseSlot() {\n\t\tthis.activeSlots -= 1;\n\t\tconst next = this.slotWaiters.shift();\n\t\tif (next) next();\n\t}\n\t/** The `agent(prompt, opts)` hook. */\n\tasync agent(rawPrompt, rawOpts) {\n\t\tif (typeof rawPrompt !== "string" || rawPrompt.length === 0) throw new WorkflowError("agent() requires a non-empty prompt string", "INVALID_ARGUMENT");\n\t\tthis.assertBudget();\n\t\tconst opts = this.readAgentOptions(rawOpts);\n\t\tif (this.started >= this.limits.maxTotalAgents) throw new WorkflowError(`this run reached its total agent cap (${this.limits.maxTotalAgents}) — a runaway-loop backstop; raise the applicable maxTotalAgents limit if the scale is intentional`, "AGENT_CAP");\n\t\tthis.started += 1;\n\t\tconst seq = this.started;\n\t\tif (this.limits.warnAboveAgents > 0 && seq === this.limits.warnAboveAgents + 1) this.observer.log(`large workflow: starting agent #${seq}, beyond this session\'s ${this.limits.warnAboveAgents}-agent size guideline; confirm the scale is intentional`);\n\t\tconst label = opts.label ?? defaultLabel(rawPrompt);\n\t\tconst phase = opts.phase ?? this.currentPhase;\n\t\tawait this.acquireSlot();\n\t\ttry {\n\t\t\tthis.assertBudget();\n\t\t\tlet run;\n\t\t\ttry {\n\t\t\t\trun = await this.children.startAgent({\n\t\t\t\t\tseq,\n\t\t\t\t\tprompt: rawPrompt,\n\t\t\t\t\t...Object.fromEntries(["cwd", "read_only", "browser", "session", "reasoning_effort"].filter(key => opts[key] !== undefined).map(key => [key, opts[key]])),\n\t\t\t\t\t...opts.schema !== void 0 ? { schema: opts.schema } : {},\n\t\t\t\t\t...opts.provider !== void 0 ? { provider: opts.provider } : {},\n\t\t\t\t\t...opts.model !== void 0 ? { model: opts.model } : {}\n\t\t\t\t});\n\t\t\t} catch (error) {\n\t\t\t\tif (error.resourceConflict === true) { this.observer.log(error.message); return null; }\n\t\t\t\tthrow new WorkflowError(`agent() could not start a child: ${renderThrown(error)}`, "AGENT_START", { cause: error });\n\t\t\t}\n\t\t\tconst info = {\n\t\t\t\tseq,\n\t\t\t\tlabel,\n\t\t\t\t...phase !== void 0 ? { phase } : {},\n\t\t\t\tchildId: brandString(run.id)\n\t\t\t};\n\t\t\tthis.observer.agentStart(info);\n\t\t\ttry {\n\t\t\t\tlet result;\n\t\t\t\ttry {\n\t\t\t\t\tresult = await run.result;\n\t\t\t\t} catch (error) {\n\t\t\t\t\tthis.observer.agentEnd({\n\t\t\t\t\t\t...info,\n\t\t\t\t\t\toutcome: "failed"\n\t\t\t\t\t});\n\t\t\t\t\tthrow new WorkflowError(`child agent run failed: ${renderThrown(error)}`, "AGENT_RESULT", { cause: error });\n\t\t\t\t}\n\t\t\t\tthis.spentTokens += result.tokens;\n\t\t\t\tif (result.stopReason === "completed") {\n\t\t\t\t\tif (opts.schema !== void 0) {\n\t\t\t\t\t\tif (result.structured === void 0) {\n\t\t\t\t\t\t\tthis.observer.agentEnd({\n\t\t\t\t\t\t\t\t...info,\n\t\t\t\t\t\t\t\toutcome: "failed"\n\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\treturn null;\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthis.observer.agentEnd({\n\t\t\t\t\t\t\t...info,\n\t\t\t\t\t\t\toutcome: "completed"\n\t\t\t\t\t\t});\n\t\t\t\t\t\treturn result.structured;\n\t\t\t\t\t}\n\t\t\t\t\tthis.observer.agentEnd({\n\t\t\t\t\t\t...info,\n\t\t\t\t\t\toutcome: "completed"\n\t\t\t\t\t});\n\t\t\t\t\treturn outputText(result.output);\n\t\t\t\t}\n\t\t\t\tthis.observer.agentEnd({\n\t\t\t\t\t...info,\n\t\t\t\t\toutcome: "failed"\n\t\t\t\t});\n\t\t\t\treturn null;\n\t\t\t} finally {\n\t\t\t\tawait run.dispose();\n\t\t\t}\n\t\t} finally {\n\t\t\tthis.releaseSlot();\n\t\t}\n\t}\n\t/** Materialize + validate the `agent()` options bag from the realm. */\n\treadAgentOptions(rawOpts) {\n\t\tif (rawOpts === void 0) return {};\n\t\tlet opts;\n\t\ttry {\n\t\t\topts = materializeFromRealm(rawOpts, "agent() options");\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */\n\t\t\tif (!(error instanceof MaterializeError)) throw error;\n\t\t\tthrow new WorkflowError(`agent() options must be plain JSON data — ${error.message}`, "INVALID_ARGUMENT", { cause: error });\n\t\t}\n\t\tif (typeof opts !== "object" || opts === null || Array.isArray(opts)) throw new WorkflowError("agent() options must be an object", "INVALID_ARGUMENT");\n\t\tconst record = opts;\n\t\tfor (const key of Object.keys(record)) {\n\t\t\tif (SUPPORTED_AGENT_OPTIONS.has(key)) continue;\n\t\t\tif (DEFERRED_AGENT_OPTIONS.has(key)) throw new WorkflowError(`agent() option "${key}" is deferred and not supported by this engine (supported: label, phase, schema, provider, model)`, "UNSUPPORTED_OPTION");\n\t\t\tthrow new WorkflowError(`agent() option "${key}" is not recognized (supported: label, phase, schema, provider, model)`, "UNSUPPORTED_OPTION");\n\t\t}\n\t\tfor (const key of [\n\t\t\t"label",\n\t\t\t"phase",\n\t\t\t"provider",\n\t\t\t"model"\n\t\t]) if (record[key] !== void 0 && typeof record[key] !== "string") throw new WorkflowError(`agent() option "${key}" must be a string`, "INVALID_ARGUMENT");\n\t\tfor (const key of ["read_only", "browser"]) if (record[key] !== undefined && typeof record[key] !== "boolean") throw new WorkflowError(key + " must be boolean", "INVALID_ARGUMENT");\n        if (record.cwd !== undefined && typeof record.cwd !== "string") throw new WorkflowError("cwd must be string", "INVALID_ARGUMENT");\n        if (record.reasoning_effort !== undefined && !["off","minimal","low","medium","high","xhigh","max"].includes(record.reasoning_effort)) throw new WorkflowError("Unsupported reasoning_effort", "INVALID_ARGUMENT");\n        if (record.session !== undefined && !["subagent", "linked"].includes(record.session)) throw new WorkflowError("session must be subagent or linked", "INVALID_ARGUMENT");\n        let schema;\n\t\tif (record.schema !== void 0) try {\n\t\t\tassertObjectJsonSchema(record.schema);\n\t\t\tschema = record.schema;\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- defensive rethrow arm: assertObjectJsonSchema only throws JsonSchemaError */\n\t\t\tif (!(error instanceof JsonSchemaError)) throw error;\n\t\t\tthrow new WorkflowError(`agent() schema is outside the supported subset — ${error.message}`, "UNSUPPORTED_SCHEMA", { cause: error });\n\t\t}\n\t\treturn {\n\t\t\t...Object.fromEntries(["cwd", "read_only", "browser", "session", "reasoning_effort"].filter(key => record[key] !== undefined).map(key => [key, record[key]])),\n\t\t\t...record.label !== void 0 ? { label: record.label } : {},\n\t\t\t...record.phase !== void 0 ? { phase: record.phase } : {},\n\t\t\t...record.provider !== void 0 ? { provider: record.provider } : {},\n\t\t\t...record.model !== void 0 ? { model: record.model } : {},\n\t\t\t...schema !== void 0 ? { schema } : {}\n\t\t};\n\t}\n\t/** The `parallel(thunks)` hook: each thunk caught → `null`; fatal errors propagate. */\n\tasync parallel(rawThunks) {\n\t\tif (!Array.isArray(rawThunks)) throw new WorkflowError("parallel() requires an array of zero-argument functions", "INVALID_ARGUMENT");\n\t\tthis.assertItemCap(rawThunks.length, "parallel()");\n\t\tconst thunks = rawThunks.map((thunk, index) => {\n\t\t\tif (typeof thunk !== "function") throw new WorkflowError(`parallel() item ${index} is not a function`, "INVALID_ARGUMENT");\n\t\t\treturn thunk;\n\t\t});\n\t\treturn Promise.all(thunks.map(async (thunk) => {\n\t\t\ttry {\n\t\t\t\treturn await thunk();\n\t\t\t} catch (error) {\n\t\t\t\tif (isFatalWorkflowError(error)) throw error;\n\t\t\t\treturn null;\n\t\t\t}\n\t\t}));\n\t}\n\t/** The `pipeline(items, ...stages)` hook: per-item stage chains, NO cross-stage barrier. */\n\tasync pipeline(rawItems, rawStages) {\n\t\tif (!Array.isArray(rawItems)) throw new WorkflowError("pipeline() requires an items array", "INVALID_ARGUMENT");\n\t\tthis.assertItemCap(rawItems.length, "pipeline()");\n\t\tif (rawStages.length === 0) throw new WorkflowError("pipeline() requires at least one stage function", "INVALID_ARGUMENT");\n\t\tconst stages = rawStages.map((stage, index) => {\n\t\t\tif (typeof stage !== "function") throw new WorkflowError(`pipeline() stage ${index} is not a function`, "INVALID_ARGUMENT");\n\t\t\treturn stage;\n\t\t});\n\t\treturn Promise.all(rawItems.map(async (item, index) => {\n\t\t\tlet value = item;\n\t\t\ttry {\n\t\t\t\tfor (const stage of stages) value = await stage(value, item, index);\n\t\t\t\treturn value;\n\t\t\t} catch (error) {\n\t\t\t\tif (isFatalWorkflowError(error)) throw error;\n\t\t\t\treturn null;\n\t\t\t}\n\t\t}));\n\t}\n\t/**\n\t* Refuse a new `agent()` call once a budget is exhausted. The run itself\n\t* stays alive so the script can return the results it already gathered.\n\t*/\n\tassertBudget() {\n\t\tconst tokens = this.limits.budgetTokens;\n\t\tif (tokens !== null && this.spentTokens >= tokens) throw new WorkflowError(`this run exhausted its token budget (spent ${this.spentTokens} of ${tokens} tokens) — further agent() calls are refused; raise the budget or return the results already gathered`, "AGENT_CAP");\n\t\tconst ms = this.limits.budgetMs;\n\t\tconst elapsed = Date.now() - this.startedAt;\n\t\tif (ms !== null && elapsed >= ms) throw new WorkflowError(`this run exhausted its time budget (${elapsed} ms of ${ms} ms elapsed) — further agent() calls are refused; raise the budget or return the results already gathered`, "AGENT_CAP");\n\t}\n\tassertItemCap(length, hook) {\n\t\tif (length > this.limits.maxItemsPerCall) throw new WorkflowError(`${hook} received ${length} items — over the per-call cap (${this.limits.maxItemsPerCall}); split the work or raise maxItemsPerCall in the engine config`, "ITEM_CAP");\n\t}\n\t/** The `phase(title)` hook: sets the current label for subsequent `agent()` calls and notifies observers. */\n\tphase(title) {\n\t\tif (typeof title !== "string" || title.length === 0) throw new WorkflowError("phase() requires a non-empty title string", "INVALID_ARGUMENT");\n\t\tthis.currentPhase = title;\n\t\tthis.observer.phase(title);\n\t}\n\t/** The `log(message)` hook: narration to observers. */\n\tlog(message) {\n\t\tif (typeof message !== "string") throw new WorkflowError("log() requires a message string", "INVALID_ARGUMENT");\n\t\tthis.observer.log(message);\n\t}\n};\n//#endregion\n//#region packages/workflow/workflow-ptc/src/guest.ts\n/**\n* Run a workflow with one progress batch in flight. Drain progress before child\n* disposal and the terminal result; PTC and the host own cancellation and cleanup.\n* @param host - JSON callbacks owned by this workflow run.\n* @returns The script result after progress delivery; initialization failures reject.\n*/\nasync function runWorkflowGuest(host) {\n\tconst init = await host.begin({});\n\tlet queued = [];\n\tlet inFlight;\n\tlet progressError;\n\tconst flush = () => {\n\t\tif (inFlight !== void 0 || queued.length === 0) return;\n\t\tconst batch = queued;\n\t\tqueued = [];\n\t\tinFlight = host.progress(batch).then(() => {\n\t\t\tinFlight = void 0;\n\t\t\tflush();\n\t\t}, (error) => {\n\t\t\tprogressError = renderThrown(error);\n\t\t\tqueued = [];\n\t\t\tinFlight = void 0;\n\t\t});\n\t};\n\tconst send = (event) => {\n\t\tif (progressError !== void 0) return;\n\t\tqueued.push(event);\n\t\tflush();\n\t};\n\tconst drain = async () => {\n\t\twhile (inFlight !== void 0) await inFlight;\n\t};\n\tconst result = await new WorkflowExecution(init.meta, init.body, init.args, init.limits, {\n\t\tphase: (title) => {\n\t\t\tsend({\n\t\t\t\ttype: "phase",\n\t\t\t\ttitle\n\t\t\t});\n\t\t},\n\t\tlog: (message) => {\n\t\t\tsend({\n\t\t\t\ttype: "log",\n\t\t\t\tmessage\n\t\t\t});\n\t\t},\n\t\tagentStart: (info) => {\n\t\t\tsend({\n\t\t\t\ttype: "agent-start",\n\t\t\t\tinfo\n\t\t\t});\n\t\t},\n\t\tagentEnd: (info) => {\n\t\t\tsend({\n\t\t\t\ttype: "agent-end",\n\t\t\t\tinfo\n\t\t\t});\n\t\t}\n\t}, { async startAgent(request) {\n\t\tconst admitted = await host.startChild(request);\n        if (admitted.denied) throw Object.assign(new Error(admitted.denied), {resourceConflict:true});\n        const { callId, childId } = admitted;\n\t\tconst result = host.childResult({ callId });\n\t\tresult.catch(() => {});\n\t\treturn {\n\t\t\tid: childId,\n\t\t\tresult,\n\t\t\tasync dispose() {\n\t\t\t\tawait drain();\n\t\t\t\tawait host.disposeChild({ callId });\n\t\t\t}\n\t\t};\n\t} }).drive();\n\tawait drain();\n\treturn progressError === void 0 ? result : {\n\t\tvalue: null,\n\t\tstopReason: "error",\n\t\terror: progressError,\n\t\tagentsStarted: result.agentsStarted\n\t};\n}\n//#endregion\nexport { runWorkflowGuest };\n//# sourceURL=dsh-workflow-guest.js\n';

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
  for (const key of ["read_only", "browser"]) {
    if (request[key] !== undefined && typeof request[key] !== "boolean") throw new Error(`workflow ${key} must be boolean`);
  }
  if (request.cwd !== undefined) text(request.cwd, "cwd");
  if (request.reasoning_effort !== undefined && !["off","minimal","low","medium","high","xhigh","max"].includes(request.reasoning_effort))
    throw new Error("Unsupported workflow reasoning_effort");
  if (request.session !== undefined && !["subagent", "linked"].includes(request.session)) throw new Error("workflow session must be subagent or linked");
  let schema;
  if (request.schema !== void 0) {
    const candidate = object(request.schema);
    assertObjectJsonSchema(candidate);
    schema = candidate;
  }
  return {
    seq: request.seq,
    prompt,
    ...Object.fromEntries(["cwd", "read_only", "browser", "session", "reasoning_effort"].filter(key => request[key] !== undefined).map(key => [key, request[key]])),
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
  failedWriteLeases = new Set();
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
    if (this.cleanupFailed) throw new Error("Previous child cleanup is unconfirmed; no further stages may start");
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
  async planChild(request) {
    if (request.cwd !== undefined && !isAbsolute(request.cwd)) throw new Error("Workflow cwd must be the absolute prepared workspace path");
    const cwd = realpathSync(request.cwd ?? await this.cwd);
    const root = realpathSync(this.policy.workspaceRoot ?? await this.cwd);
    const delta = relative(root, cwd);
    if (delta === ".." || delta.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) || isAbsolute(delta))
      throw new Error("Workflow worker cwd is outside the inherited workspace boundary");
    // rc.2 native spawn retains the parent's immutable sandbox root even when
    // request.cwd changes its working directory. A fresh linked session is the
    // existing public creation path that can actually narrow that boundary.
    const separateRoot = cwd !== realpathSync(this.parent.session.header.cwd);
    const mode = request.session ?? (separateRoot ? "linked" : this.deps.workerMode);
    if (mode === "subagent" && separateRoot)
      throw new Error("Native subagent cwd does not isolate its sandbox in this host version; use session:linked for an isolated directory");
    if (mode === "subagent" && typeof this.subagents.getProvider(this.provider)?.prepareContinuable !== "function")
      throw new Error("This provider does not use the native child creation boundary; confined Workflow execution is unsupported");
    const linked = this.ctx.get("nestedSessions");
    if (mode === "linked" && (!linked?.startWorkflowChild || ["off", "worker"].includes(linked.delegationMode(this.parent.id))))
      throw new Error("Linked workers are unavailable or disabled");
    if (mode === "linked" && request.schema !== undefined) throw new Error("Linked workers return text; omit schema");
    const access = {cwd, readOnly: request.read_only === true || this.policy.mode === "read-only", browser: request.browser === true};
    if (this.policy.mode !== "workspace-write" && this.policy.mode !== "read-only")
      throw new Error("Workflow parallel isolation requires a confined workspace-write or read-only sandbox");
    return {cwd, mode, linked, access};
  }
  async activate(request, callId, admission) {
    const {cwd, mode, linked, access} = admission?.plan ?? await this.planChild(request);
    const release = admission?.release ?? this.deps.claim?.(access) ?? (() => {});
    const prepare = child => {
      if (access.readOnly) setSandboxMode(child.session, "read-only");
      const policy = this.ctx.sandboxPolicy.resolve({session:child.session});
      if (realpathSync(policy.workspaceRoot) !== cwd || policy.mode !== (access.readOnly ? "read-only" : "workspace-write"))
        throw new Error("Worker sandbox does not match its admitted directory and access");
      this.ctx.get("ultracodeState")?.registerWorker(child.id, access);
    };
    let run;
    try {
      if (mode === "linked") {
        run = await linked.startWorkflowChild({parent:this.parent, prompt:request.prompt,
          title:`${this.meta.name} stage ${callId}`, provider:request.provider, model:request.model, reasoningEffort:request.reasoning_effort,
          cwd, prepare, signal:this.controller.signal});
      } else {
        const childId = SessionId(randomUUID());
        const unhook = this.ctx.on("agent/created", ({agent}) => { if (agent.id === childId) prepare(agent); });
        try {
          run = await this.subagents.startActivation({provider:this.provider, childId,
            label:`${this.meta.name} child ${callId}`, delivery:"caller", signal:this.controller.signal,
            request:{cwd, prompt:[{type:"text",text:request.prompt}], parent:this.parent,
              ...(request.schema === undefined ? {} : {outputSchema:request.schema}),
              ...(request.provider === undefined && request.model === undefined && request.reasoning_effort === undefined ? {} : {agentOptions:{
                ...(request.provider === undefined ? {} : {provider:request.provider}),
                ...(request.reasoning_effort === undefined ? {} : {reasoningEffort:request.reasoning_effort}),
                ...(request.model === undefined ? {} : {model:request.model})}})}});
        } finally { unhook(); }
      }
    } catch (error) {
      // Activation may have published a child before failing. Keep its lease until
      // explicit reconciliation rather than allowing another writer into that root.
      this.cleanupFailed = true;
      this.activationError = renderThrown(error);
      throw error;
    }
    const activation = {...run, access, dispose:async () => {
      this.ctx.get("ultracodeState")?.releaseWorker(run.childId);
      await run.dispose();
      if (activation.uncertainWrites) this.failedWriteLeases.add(release);
      else release();
    }};
    return activation;
  }

  async startChild(request) {
    this.requireActive();
    const callId = ++this.started;
    const replay = this.deps.journal?.takeReplay(request, this.provider);
    if (replay !== void 0) {
      this.children.set(callId, { callId, seq: request.seq, replay });
      return { callId, childId: replay.childId };
    }
    const plan = await this.planChild(request);
    let release;
    try { release = this.deps.claim?.(plan.access) ?? (() => {}); }
    catch (error) {
      if (error.code !== "RESOURCE_CONFLICT") throw error;
      this.failedCalls += 1;
      this.observer.log(`Stage ${request.seq} refused before dispatch: ${error.message}`);
      return {denied:error.message};
    }
    try { this.deps.journal?.recordIntent(request, this.provider); }
    catch (error) { release(); throw error; }
    const run = await this.activate(request, callId, {plan, release});
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
      if (payload.stopReason !== "completed") {
        this.failedCalls += 1;
        // A missing/failed result may follow a successful write. Keep only that
        // directory occupied until this script settles, so it cannot retry it.
        if (!run.access.readOnly) run.uncertainWrites = true;
      }
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
      if (this.runtime.sandboxMode === void 0) {
        throw new Error("workflow runtime cannot enforce a read-only orchestration process");
      }
      const outcome = await this.runtime.run(this.runtime.resolve({
        program: this.runtime.programFormat === "repl" ? `await (async () => {
${PROGRAM}
})()` : PROGRAM,
        bindings: [{ global: "workflowHost", functions: this.bindings() }],
        cwd,
        // node:vm is not a security boundary. Only admitted workers may write;
        // keep their inherited policy intact while confining the guest process.
        sandboxPolicy: { ...this.policy, mode: "read-only" },
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
      if (!this.cleanupFailed) {
        for (const release of this.failedWriteLeases) release();
        this.failedWriteLeases.clear();
      }
      if (!this.cleanupFailed) for (const info of this.liveAgents.values()) this.endAgent({ ...info, outcome: "cancelled" });
    }
    if (this.cleanupFailed) {
      try { this.deps.stopOwner?.(); } catch (error) { this.ctx.logger.warn(String(error)); }
      return {value:result?.value ?? null,stopReason:"error",error:`Child cleanup was not confirmed; recovery remains blocked${this.activationError ? ": " + this.activationError : ""}`,agentsStarted:this.started};
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
    throw new WorkflowError3(`workflow script does not parse before any agent starts: ${String(error)}. Check delimiters and double-escaped newlines: between statements use actual newlines or semicolons, not literal backslash-n. Fix the script; do not start empty probe workflows.`, "SCRIPT_PARSE", { cause: error });
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
  static resourceClaims = new Set();
  resourceClaims = PtcWorkflowEngine.resourceClaims;
  claim(access) {
    const overlaps = (a, b) => { const d = relative(a, b); return d === "" || (d !== ".." && !d.startsWith(".." + sep) && !isAbsolute(d)); };
    for (const held of this.resourceClaims) {
      if ((access.browser && held.browser) || (!access.readOnly && !held.readOnly &&
          (overlaps(access.cwd, held.cwd) || overlaps(held.cwd, access.cwd))))
        throw Object.assign(new Error("Workflow resource conflict: await the current owner before handing off this directory or browser; independent isolated work may continue"), {code:"RESOURCE_CONFLICT"});
    }
    access.active = true;
    this.resourceClaims.add(access);
    return () => { access.active = false; this.resourceClaims.delete(access); };
  }
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
      ...(source.identity.workerMode ? {worker_mode:source.identity.workerMode} : {}),
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
    const strict = this.ctx.get("ultracodeState")?.requiresWorkflow(request.parent) === true;
    const linked = this.ctx.get("nestedSessions");
    const preference = linked?.delegationMode(request.parent.session.id);
    // 关联执行者默认值是独立开关：只在 Ultracode 生效时改变默认值，
    // 且从不覆盖 /collaborate off|worker 的明确禁用。
    const linkedDefault = strict && preference !== "off" && preference !== "worker" &&
      this.ctx.get("enhancementSettings")?.ultracodeLinkedWorkerDefault?.() === true;
    const workerMode = extras.workerMode ?? (linkedDefault || (strict && preference === "linked") ? "linked" : "subagent");
    if (!["subagent", "linked"].includes(workerMode)) throw new Error("Unknown workflow worker mode");
    if (workerMode === "linked" && (!linked?.startWorkflowChild || preference === "off" || preference === "worker"))
      throw new Error("Linked workers are unavailable or disabled; do not bypass the linked-session boundary");
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
    const identity={owner,cwd,policy,limits,workerMode,preset:request.parent.session.header.agentPreset??null,
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
        workerMode,
        claim: access => this.claim(access),
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
