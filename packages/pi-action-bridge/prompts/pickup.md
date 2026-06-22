---
description: Pickup work from GitHub Pull Request
argument-hint: "[PR-number]"
---
The target PR number argument is: "$1"

If that argument is present, treat it strictly: it must be a single positive integer (`^\d+$`). If it is anything else (empty after trimming, contains shell metacharacters, a range, multiple values, etc.), tell the user the PR number is invalid and stop.

Always call the `detect_pull_request` tool first. It resolves the `owner`, `repo`, and `server_url` of the current remote — these are required to read the thread and have no default, so they must come from the working tree regardless of whether an explicit number was passed. `detect_pull_request` surfaces the repo info even when it finds no open PR (e.g. `reason: 'no_pr_for_branch'`), so keep going as long as you have `owner`/`repo`.

Decide the PR `number`:

- If the argument is a valid integer, use it as the `number` (the target PR may differ from the checked-out branch — that is exactly what `/pickup <n>` is for).
- Otherwise, use the `number` from the `detect_pull_request` result. If it resolved no PR (detached HEAD, no remote, unparseable remote, or no open PR and no explicit number), tell the user what happened and stop — do not pull or read anything.

Call the `read_pr_thread` tool with the `owner`, `repo`, and `number` to read the title, description, and comments, and to learn the PR's `head_branch`. If the repo is on a self-hosted forge (GitHub Enterprise, Codeberg, Forgejo, Gitea) pass its `server_url` from the `detect_pull_request` result; otherwise omit `server_url` (defaults to github.com).

Then sync the working tree to the PR's `head_branch` (not the current branch): `git fetch`, `git checkout <head_branch>` if you are not already on it, and `git pull --ff-only`. Using `--ff-only` keeps pickups clean: it fast-forwards when the branches have diverged cleanly and fails loudly instead of creating an unexpected merge commit when they have diverged. Skipping the checkout risks pulling the wrong branch when the PR isn't the checked-out one.

The last comment whose body starts with `/pi 🤖 Handoff` is the most recent handoff to the GitHub CI/CD coding agent.

Summarize the status of the work in the PR (drawing on the handoff's **Done** / **Next** sections, the PR title/body, and any later comments) and suggest concrete next steps.
