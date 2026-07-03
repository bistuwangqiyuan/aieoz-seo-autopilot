import { USER_AGENT } from "@/lib/config";

const API = "https://api.github.com";

export interface RepoFile {
  path: string;
  /** UTF-8 decoded file content, or null if the file does not exist. */
  content: string | null;
  /** Blob sha of the existing file, or null when absent. */
  sha: string | null;
}

export interface CommitFile {
  path: string;
  content: string;
}

export interface CommitResult {
  sha: string;
  url: string;
}

export class GitHubClient {
  private readonly repo: string;
  private readonly branch: string;
  private readonly token: string;

  constructor(opts: { repo: string; branch: string; token: string }) {
    this.repo = opts.repo;
    this.branch = opts.branch;
    this.token = opts.token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `GitHub ${method} ${path} -> ${res.status} ${res.statusText}: ${text.slice(0, 400)}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Read a single file's content and blob sha. Returns nulls if 404. */
  async getFile(path: string): Promise<RepoFile> {
    const encoded = path
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    try {
      const data = await this.request<{ content?: string; sha: string; encoding?: string }>(
        "GET",
        `/repos/${this.repo}/contents/${encoded}?ref=${encodeURIComponent(this.branch)}`,
      );
      const content =
        data.content && data.encoding === "base64"
          ? Buffer.from(data.content, "base64").toString("utf-8")
          : (data.content ?? null);
      return { path, content, sha: data.sha };
    } catch (err) {
      if (err instanceof Error && /-> 404/.test(err.message)) {
        return { path, content: null, sha: null };
      }
      throw err;
    }
  }

  /** Latest commit sha on the branch. */
  private async getHeadSha(): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${this.repo}/git/ref/heads/${encodeURIComponent(this.branch)}`,
    );
    return ref.object.sha;
  }

  private async getCommitTree(commitSha: string): Promise<string> {
    const commit = await this.request<{ tree: { sha: string } }>(
      "GET",
      `/repos/${this.repo}/git/commits/${commitSha}`,
    );
    return commit.tree.sha;
  }

  /**
   * Commit multiple files in a single commit via the Git Data (Trees) API.
   * Returns the new commit sha + html url.
   */
  async commitFiles(files: CommitFile[], message: string): Promise<CommitResult> {
    if (files.length === 0) throw new Error("commitFiles called with no files");

    const headSha = await this.getHeadSha();
    const baseTree = await this.getCommitTree(headSha);

    const tree = await Promise.all(
      files.map(async (f) => {
        const blob = await this.request<{ sha: string }>(
          "POST",
          `/repos/${this.repo}/git/blobs`,
          { content: f.content, encoding: "utf-8" },
        );
        return {
          path: f.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      }),
    );

    const newTree = await this.request<{ sha: string }>(
      "POST",
      `/repos/${this.repo}/git/trees`,
      { base_tree: baseTree, tree },
    );

    const commit = await this.request<{ sha: string; html_url?: string }>(
      "POST",
      `/repos/${this.repo}/git/commits`,
      { message, tree: newTree.sha, parents: [headSha] },
    );

    await this.request(
      "PATCH",
      `/repos/${this.repo}/git/refs/heads/${encodeURIComponent(this.branch)}`,
      { sha: commit.sha, force: false },
    );

    return {
      sha: commit.sha,
      url:
        commit.html_url ??
        `https://github.com/${this.repo}/commit/${commit.sha}`,
    };
  }
}
