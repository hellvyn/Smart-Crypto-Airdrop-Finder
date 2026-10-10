import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseRepo } from "../src/store/supabase-repo.js";

/**
 * Records every insert and every delete filter; answers like PostgREST does for an insert or delete without
 * `.select()`.
 */
function recordingClient(): {
  client: SupabaseClient;
  inserts: { table: string; row: unknown }[];
  deletes: { table: string; filters: [string, unknown][] }[];
} {
  const inserts: { table: string; row: unknown }[] = [];
  const deletes: { table: string; filters: [string, unknown][] }[] = [];
  const ok = { data: null, error: null, count: null, status: 204, statusText: "No Content" };
  const client = {
    from: (table: string) => ({
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { ...ok, status: 201, statusText: "Created" };
      },
      delete: () => {
        const filters: [string, unknown][] = [];
        deletes.push({ table, filters });
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          then: (resolve: (value: typeof ok) => unknown) => resolve(ok),
        };
        return query;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts, deletes };
}

describe("SupabaseRepo.replaceTasks", () => {
  it("replaces one document's steps, storing each step's position and cadence", async () => {
    const { client, inserts, deletes } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.replaceTasks("p-1", "doc-1", [
      { text: "Check in", cadence: "daily" },
      { text: "Bridge", cadence: "once" },
    ]);

    expect(deletes).toEqual([{ table: "tasks", filters: [["project_id", "p-1"], ["document_id", "doc-1"]] }]);
    expect(inserts).toEqual([
      {
        table: "tasks",
        row: [
          { project_id: "p-1", document_id: "doc-1", description: "Check in", position: 0, cadence: "daily" },
          { project_id: "p-1", document_id: "doc-1", description: "Bridge", position: 1, cadence: "once" },
        ],
      },
    ]);
  });
});

describe("SupabaseRepo.saveExtraction", () => {
  it("stores served_model with each extraction attempt", async () => {
    const { client, inserts } = recordingClient();
    const repo = new SupabaseRepo(client);

    await repo.saveExtraction(
      "doc-1",
      {
        model: "freellm:auto",
        servedModel: "gpt-oss:120b",
        httpStatus: 200,
        finishReason: "stop",
        latencyMs: 12.6,
        error: "json_parse",
        raw: "not json",
      },
      "2026-10-10.2",
    );
    await repo.saveExtraction(
      "doc-1",
      {
        model: "nvidia:z-ai/glm-5.3-flash",
        servedModel: null,
        httpStatus: 0,
        finishReason: null,
        latencyMs: 180_000,
        error: "http_0",
        raw: "",
      },
      "2026-10-10.2",
    );

    expect(inserts).toEqual([
      {
        table: "extractions",
        row: {
          document_id: "doc-1",
          model: "freellm:auto",
          served_model: "gpt-oss:120b",
          prompt_version: "2026-10-10.2",
          raw: "not json",
          http_status: 200,
          finish_reason: "stop",
          latency_ms: 13,
          error: "json_parse",
        },
      },
      {
        table: "extractions",
        row: {
          document_id: "doc-1",
          model: "nvidia:z-ai/glm-5.3-flash",
          served_model: null,
          prompt_version: "2026-10-10.2",
          raw: "",
          http_status: 0,
          finish_reason: null,
          latency_ms: 180000,
          error: "http_0",
        },
      },
    ]);
  });
});
