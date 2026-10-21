import { z } from "zod";
import { checkedVariables } from "./values.js";

export const environmentId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/);
export const repositoryKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
export const requiredVariables = z
  .array(z.string().min(1).max(128))
  .max(64)
  .default([])
  .refine((names) => {
    try {
      if (new Set(names).size !== names.length) return false;
      checkedVariables(Object.fromEntries(names.map((key) => [key, ""])));
      return true;
    } catch {
      return false;
    }
  }, "Required variable names must be valid and unique");
export const definitionSchema = z.strictObject({
  id: environmentId,
  name: z.string().trim().min(1).max(160),
  repositories: z
    .array(
      z
        .strictObject({
          key: repositoryKey,
          mode: z.enum(["checkout", "worktree"]),
          baseRef: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .regex(/^[^\x00-\x1f\x7f]+$/)
            .optional(),
        })
        .refine(
          (repo) => repo.mode === "worktree" || repo.baseRef === undefined,
          "A current checkout does not switch branches",
        ),
    )
    .min(1)
    .max(8)
    .refine(
      (repos) => new Set(repos.map((repo) => repo.key)).size === repos.length,
      "Repository keys must be unique",
    ),
  requiredVariables,
});
export const portableSchema = z.strictObject({
  version: z.literal(1),
  environments: z
    .array(definitionSchema)
    .max(32)
    .refine(
      (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
      "Environment identities must be unique",
    ),
});
