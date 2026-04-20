# pi-coding-agent-tools

Reusable tool definitions for the [Pi coding agent](https://pi.dev) — create/update pull requests and fetch issue/PR threads.

## Overview

This package provides ready-to-use tool definitions that extend the Pi coding agent with Git hosting platform capabilities:

- **`create_pull_request`** – Create a new pull request with working-tree changes
- **`update_pull_request`** – Update an existing pull request by pushing new commits
- **`get_issue_or_pr_thread`** – Fetch the full comment thread of an issue or PR

These tools are designed to be platform-agnostic. Consumers implement the minimal [`ToolProvider`](./src/types.ts) interface to connect them to any Git hosting platform (GitHub, GitLab, Bitbucket, etc.).

## Installation

```bash
npm install pi-coding-agent-tools
```

## Quick Start

```typescript
import { createToolsFactory, type ToolProvider } from 'pi-coding-agent-tools';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

// 1. Implement the ToolProvider interface
const myProvider: ToolProvider = {
  createPullRequest: async (params) => {
    // Your platform-specific PR creation logic
    return {
      content: [{ type: 'text', text: `Created PR #1: ${params.title}` }],
      details: {
        pullRequestNumber: 1,
        pullRequestUrl: 'https://github.com/org/repo/pull/1',
        headBranch: 'feature-branch',
        baseBranch: 'main',
        dryRun: false,
      },
    };
  },
  updatePullRequest: async (params) => {
    // Your platform-specific PR update logic
    return {
      content: [{ type: 'text', text: 'Updated PR' }],
      details: {
        pullRequestNumber: 1,
        pullRequestUrl: 'https://github.com/org/repo/pull/1',
        headBranch: 'feature-branch',
        baseBranch: 'main',
        dryRun: false,
      },
    };
  },
  getIssueOrPRThread: async (params) => {
    // Your platform-specific thread fetching logic
    return {
      number: 1,
      title: 'My Issue',
      body: 'Issue description',
      state: 'open',
      author: 'user',
      author_type: 'user',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      closed_at: undefined,
      merged_at: undefined,
      labels: ['bug'],
      is_pull_request: false,
      head_branch: undefined,
      base_branch: undefined,
      head_sha: undefined,
      comments: [],
    };
  },
};

// 2. Create the extension factory
const extensionFactory = createToolsFactory(myProvider);

// 3. Register with the Pi agent
const extension = (pi: ExtensionAPI) => {
  extensionFactory(pi);
};
```

## Individual Tool Factories

You can also import and register tools individually:

```typescript
import {
  createPRToolFactory,
  updatePullRequestToolFactory,
  getIssueOrPRThreadToolFactory,
} from 'pi-coding-agent-tools';

// Create only the tools you need
const createPRTool = createPRToolFactory(myProvider);
const updatePRTool = updatePullRequestToolFactory(myProvider);
const threadTool = getIssueOrPRThreadToolFactory(myProvider);
```

## Utilities

The package also exports reusable utilities:

```typescript
import {
  withCancellation,
  createCancellationResult,
  buildParams,
  formatThreadAsText,
} from 'pi-coding-agent-tools';
```

- **`withCancellation`** – Wraps tool execution with abort signal handling
- **`createCancellationResult`** – Creates a standard cancellation result
- **`buildParams`** – Filters undefined values from parameter objects
- **`formatThreadAsText`** – Formats an `IssueOrPRThread` into a human-readable summary

## Types

All types are exported from the main entry point:

```typescript
import type {
  ToolProvider,
  CreatePullRequestParams,
  CreatePullRequestDetails,
  UpdatePullRequestParams,
  UpdatePullRequestDetails,
  GetIssueOrPRThreadParams,
  IssueOrPRThread,
  ThreadComment,
} from 'pi-coding-agent-tools';
```

## License

MIT
