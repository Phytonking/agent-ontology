// multi-object-pipeline.mjs — One connector that pipelines data to MULTIPLE objects
//
// This is the pattern for complex sources where one API call yields data
// that maps to several ontology objects + their links. E.g. a project
// management API returns projects, tasks, and assignments in one response.
//
// Targets: Team, Agent, Task, Assignment (or your objects)
// Pattern: fetch once → split → upsert each type → link them via ids

export default {
  async sync(ctx) {
    const token = ctx.env("PM_API_TOKEN");
    const url = ctx.config.url ?? "https://api.example.com/projects/export";

    if (!token) return { connector: "multi-pipeline", ingested: 0, errors: ["PM_API_TOKEN not set"] };

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { connector: "multi-pipeline", ingested: 0, errors: [`HTTP ${res.status}`] };
    const data = await res.json();

    let ingested = 0;
    const errors = [];

    // ── step 1: upsert teams ──
    for (const team of data.teams ?? []) {
      try {
        await ctx.upsert("Team", team.id, {
          slug: team.slug,
          name: team.name,
          purpose: team.description ?? "",
        });
        ingested++;
      } catch (e) { errors.push(`Team ${team.id}: ${e.message}`); }
    }

    // ── step 2: upsert agents (with team link) ──
    for (const member of data.members ?? []) {
      try {
        await ctx.upsert("Agent", member.id, {
          handle: `@${member.username}`,
          name: member.name,
          role: member.role,
          status: "idle",
          team_id: member.team_id,  // ← this is the link field
        });
        ingested++;
      } catch (e) { errors.push(`Agent ${member.id}: ${e.message}`); }
    }

    // ── step 3: upsert tasks ──
    for (const task of data.tasks ?? []) {
      try {
        await ctx.upsert("Task", task.id, {
          title: task.title,
          description: task.body ?? "",
          status: mapStatus(task.status),  // map source status → ontology enum
          priority: task.priority ?? "medium",
          tags: task.labels ?? [],
        });
        ingested++;
      } catch (e) { errors.push(`Task ${task.id}: ${e.message}`); }
    }

    // ── step 4: upsert assignments (the N:M join) ──
    for (const task of data.tasks ?? []) {
      for (const assigneeId of task.assignee_ids ?? []) {
        try {
          await ctx.upsert("Assignment", `${task.id}-${assigneeId}`, {
            task_id: task.id,
            agent_id: assigneeId,
          });
          ingested++;
        } catch (e) { errors.push(`Assignment ${task.id}-${assigneeId}: ${e.message}`); }
      }
    }

    // ── stash ids in the bag if a transform runs after this ──
    ctx.bag.teamIds = (data.teams ?? []).map((t) => t.id);
    ctx.bag.taskIds = (data.tasks ?? []).map((t) => t.id);

    return { connector: "multi-pipeline", ingested, errors };
  },
};

// helper: map external status names to your ontology's enum
function mapStatus(externalStatus) {
  const map = {
    open: "backlog",
    "in progress": "in_progress",
    "in review": "review",
    done: "done",
    closed: "done",
    blocked: "blocked",
  };
  return map[externalStatus?.toLowerCase()] ?? "backlog";
}
