export const meta = {
  name: 'plan-dependency-map',
  description: 'Map task-level dependencies and file overlaps across AirdropIQ Plans 4-8',
  phases: [
    { title: 'Map', detail: 'one reader per plan extracts per-task files, symbols, migrations, deps' },
    { title: 'Critic', detail: 'cross-plan check for missed dependencies and collisions' },
  ],
}

const ROOT = '/home/user/Smart-Airdrop-Finder'
const PLANS = [
  { id: 'P7', file: 'docs/superpowers/plans/2026-10-10-plan-7-manual-membership.md' },
  { id: 'P4', file: 'docs/superpowers/plans/2026-10-10-plan-4-data-and-ai-foundation.md' },
  { id: 'P8', file: 'docs/superpowers/plans/2026-10-10-plan-8-farming-tracker.md' },
  { id: 'P5', file: 'docs/superpowers/plans/2026-10-10-plan-5-curation-and-ai-analysis.md' },
  { id: 'P6', file: 'docs/superpowers/plans/2026-10-10-plan-6-web-curation-ui.md' },
]

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'e.g. P4.T3' },
          title: { type: 'string' },
          creates: { type: 'array', items: { type: 'string' } },
          modifies: { type: 'array', items: { type: 'string' } },
          produces: { type: 'array', items: { type: 'string' }, description: 'exported functions/types/tables/views/columns/routes this task introduces or changes the signature of' },
          consumes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                from: { type: 'string', description: 'task id like P4.T4, or "existing" if already in the repo today, or "unknown"' },
                evidence: { type: 'string', description: 'short quote from the plan or file:line in the repo' },
              },
              required: ['symbol', 'from', 'evidence'],
            },
          },
          migrations: { type: 'array', items: { type: 'string' }, description: 'migration file names this task creates' },
          needs_db_tests: { type: 'boolean', description: 'runs pgTAP / needs local Supabase' },
          needs_e2e: { type: 'boolean', description: 'runs Playwright e2e / needs a running web server' },
          depends_on: { type: 'array', items: { type: 'string' }, description: 'task ids that must be merged before this task can start' },
          security_sensitive: { type: 'boolean', description: 'touches RLS, grants, auth, secrets, member gating, or phishing link handling' },
          notes: { type: 'string' },
        },
        required: ['id', 'title', 'creates', 'modifies', 'produces', 'consumes', 'migrations', 'needs_db_tests', 'needs_e2e', 'depends_on', 'security_sensitive', 'notes'],
      },
    },
    plan_level_issues: { type: 'array', items: { type: 'string' }, description: 'contradictions, migration number collisions, references to things no task defines' },
  },
  required: ['plan', 'tasks', 'plan_level_issues'],
}

phase('Map')
const maps = await parallel(PLANS.map(p => () => agent(
  `You are building a task-level dependency map for implementation plan ${p.id} in the repo at ${ROOT}.
Read the whole plan file ${ROOT}/${p.file} (read it in parts if large). The other plans in the same execution set are:
${PLANS.map(q => `${q.id} = ${q.file}`).join('\n')}
Planned execution order was P7 -> P4 -> P8 -> P5 -> P6, but we now want to run as much in parallel as possible, so be precise and evidence-based.

For EVERY "### Task N" in ${p.id}, extract:
- exact file paths it creates and modifies (from its Files block and steps; normalise to repo-relative paths)
- symbols it produces (exported functions, types, DB tables/views/columns/policies, routes, components)
- symbols it consumes, and WHERE each comes from: an earlier task in this plan, a task in another plan (open that plan and grep to find which task defines it), or "existing" if it already exists in the repo today (verify with grep in ${ROOT}/packages, ${ROOT}/pipeline, ${ROOT}/apps, ${ROOT}/supabase). Give evidence for each.
- migrations it creates (file names), whether it needs pgTAP/local Supabase, whether it needs Playwright e2e
- depends_on: the minimal set of task ids (any plan) that must be merged before it can start. A shared file alone is NOT a dependency (that is a merge conflict, tracked separately); a dependency means it needs a symbol, schema, or behaviour that task introduces.
- security_sensitive: true if it touches RLS/grants/auth/secrets/member gating/phishing-link handling
Also list plan-level issues: migration number collisions (check numbers used by other plans and existing files in ${ROOT}/supabase/migrations), symbols referenced that no task defines, contradictions.
Do not edit any files. Do not guess: if you cannot find where a symbol comes from, set from="unknown" and say so in notes.`,
  { label: `map:${p.id}`, phase: 'Map', schema: TASK_SCHEMA },
)))

const ok = maps.filter(Boolean)
if (ok.length < PLANS.length) log(`WARNING: only ${ok.length}/${PLANS.length} plan maps returned`)

// Deterministic file-overlap matrix across tasks of different plans
const allTasks = ok.flatMap(m => m.tasks.map(t => ({ ...t, plan: m.plan })))
const touches = t => new Set([...(t.creates || []), ...(t.modifies || [])])
const overlaps = []
for (let i = 0; i < allTasks.length; i++) {
  for (let j = i + 1; j < allTasks.length; j++) {
    const a = allTasks[i], b = allTasks[j]
    if (a.id.split('.')[0] === b.id.split('.')[0]) continue
    const fa = touches(a)
    const shared = [...touches(b)].filter(f => fa.has(f))
    if (shared.length) overlaps.push({ a: a.id, b: b.id, files: shared })
  }
}

phase('Critic')
const critic = await agent(
  `You are a completeness critic for a cross-plan task dependency map of the repo at ${ROOT}.
Plans: ${PLANS.map(q => `${q.id} = ${ROOT}/${q.file}`).join('; ')}.
Here is the extracted map (JSON):
${JSON.stringify(ok)}
Here are cross-plan file overlaps computed from it:
${JSON.stringify(overlaps)}

Your job: find what the map got WRONG or MISSED. Check, by reading the plans and the repo:
1. Missing cross-plan depends_on edges (a task consumes a symbol/table/column/component another plan's task introduces, but depends_on lacks it). Especially: P8 on P7 design components and P4 tasks.cadence; P5 on P4 extraction v3 / alphadrops / defillama; P6 on P5 views/tables, P7 components, P8 farming code; P7 vs P4 both touching pipeline.
2. Wrong edges (claimed dependency that is not real).
3. Migration number collisions or ordering problems if plans run in parallel (two branches creating the same number, or a migration that alters a table another plan creates).
4. Shared-file conflicts that are likely to be painful (same function edited), versus trivially mergeable (index.ts export lines, stats keys).
Do not edit files. Report only verified corrections with evidence.`,
  {
    label: 'critic', phase: 'Critic', schema: {
      type: 'object',
      properties: {
        add_edges: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, depends_on: { type: 'string' }, evidence: { type: 'string' } }, required: ['task', 'depends_on', 'evidence'] } },
        remove_edges: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, depends_on: { type: 'string' }, evidence: { type: 'string' } }, required: ['task', 'depends_on', 'evidence'] } },
        migration_issues: { type: 'array', items: { type: 'string' } },
        painful_conflicts: { type: 'array', items: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'string' } }, file: { type: 'string' }, why: { type: 'string' } }, required: ['tasks', 'file', 'why'] } },
        other: { type: 'array', items: { type: 'string' } },
      },
      required: ['add_edges', 'remove_edges', 'migration_issues', 'painful_conflicts', 'other'],
    },
  },
)

return { maps: ok, overlaps, critic }
