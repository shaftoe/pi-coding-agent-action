---
description: Handoff work to GitHub Pull Request
argument-hint: "[PR-number]"
---
The target PR number argument is: "$1"

If that argument is present, treat it strictly: it must be a single positive integer (`^\d+$`). If it is anything else (empty after trimming, contains shell metacharacters, a range, multiple values, etc.), tell the user the PR number is invalid and stop.

Always call the `detect_pull_request` tool first. It resolves the `owner`, `repo`, and `server_url` of the current remote — these are required to post a comment and have no default, so they must come from the working tree regardless of whether an explicit number was passed. `detect_pull_request` surfaces the repo info even when it finds no open PR (e.g. `reason: 'no_pr_for_branch'`), so keep going as long as you have `owner`/`repo`.

Decide the PR `number` to post to:

- If the argument is a valid integer, use it as the `number` (the target PR may differ from the checked-out branch — that is exactly what `/handoff <n>` is for).
- Otherwise, use the `number` from the `detect_pull_request` result. If it resolved no PR (detached HEAD, no remote, unparseable remote, or no open PR and no explicit number), tell the user what happened and stop — do not post a comment.

Once you have `owner`, `repo`, and `number`, call the `post_pr_comment` tool with those values plus the Markdown body below. If the repo is on a self-hosted forge (GitHub Enterprise, Codeberg, Forgejo, Gitea) pass its `server_url` from the `detect_pull_request` result; otherwise omit `server_url` (defaults to github.com).

The comment body must follow this format exactly (the `/pi 🤖 Handoff` marker is how `/pickup` finds the latest handoff, so keep it verbatim):

```
/pi 🤖 Handoff

## Done

- <list of things done>

## Next

- <list of things to be done>
```
