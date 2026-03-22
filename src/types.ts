// ── GitHub Types ───────────────────────────────────────────────────
export interface IssueComment {
  databaseId: number;
  body: string;
  author: { login: string };
  createdAt: string;
}

export interface IssueNode {
  title: string;
  body: string;
  state: string;
  author: { login: string };
  createdAt: string;
  comments?: IssueComment[];
}

export interface PRNode {
  title: string;
  body: string;
  state: string;
  author: { login: string };
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  createdAt: string;
  additions: number;
  deletions: number;
  baseRepository: { nameWithOwner: string };
  headRepository: { nameWithOwner: string };
  commits: {
    totalCount: number;
  };
  files?: {
    path: string;
    additions: number;
    deletions: number;
    changeType: string;
  }[];
  comments?: IssueComment[];
  reviews?: {
    author: { login: string };
    body: string;
    submittedAt: string;
    comments?: {
      path?: string;
      line?: number;
      body: string;
    }[];
  }[];
}

// ── Git Types ─────────────────────────────────────────────────────
export interface GitAuthor {
  name: string;
  email: string;
}

export interface BranchCheckoutOptions {
  remote: string;
  branch: string;
  depth?: number;
  createNew?: boolean;
}
