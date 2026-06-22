# Background Jobs

A bundled Pi extension for background execution used by the main agent.

## Responsibilities

- `background-shell.ts`: long-running non-interactive shell commands via the unified `bg_shell` tool.
- `sub-agents.ts`: headless Pi workers via the `sub_agent` tool. One unified `start` action handles single and parallel tasks; `returnToMain` can send results back automatically.
- `job-monitor.ts`: shared footer status and focused right-side jobs overlay.
- `index.ts`: plugin entry point.

## Design

The tools are agent-facing infrastructure. Users should normally ask the main agent for an outcome, while the main agent starts, waits for, checks, and cancels background work as needed. For detached work that should resume the main agent automatically, use `sub_agent` or `bg_shell` with `action: "start"` and `returnToMain: true`.

The user-facing UI is observational:

```text
/jobs          open/toggle all background work
/jobs shell    show shell jobs
/jobs agents   show sub-agent jobs
/jobs failed   show failed/timed-out jobs
/jobs close    close the jobs overlay
/jobs clear    acknowledge failed/timed-out footer warnings
```

Inside the overlay, `Esc`/`q` closes it, `↑↓` scrolls, and `a/s/g/f` switches filters.

The footer uses one aggregate status key:

```text
● bg: 2 running
⚠ bg: 1 failed
● bg: 2 running, 1 failed
```

Running jobs are cancelled on `session_shutdown` by their owning module.
