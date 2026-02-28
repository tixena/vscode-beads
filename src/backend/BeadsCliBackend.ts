/**
 * BeadsCliBackend - CLI-based backend for the Beads extension
 *
 * Replaces BeadsDaemonClient. Spawns `bd` CLI commands with `--json` output,
 * parses responses, and returns typed results. No daemon, no sockets.
 */

import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import * as vscode from "vscode";
import { BeadsInfo, CliBeadDependency, issueToWebviewBead, Bead } from "./types";

// Issue type matching CLI JSON output
export interface CliIssue {
  id: string;
  title: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  status: string;
  priority: number;
  issue_type: string;
  owner?: string;
  assignee?: string;
  labels?: string[];
  estimated_minutes?: number;
  external_ref?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  dependencies?: CliBeadDependency[];
  dependents?: CliBeadDependency[];
  comments?: Array<{ id: number; author: string; text: string; created_at: string }>;
}

// Comment from `bd comments --json`
export interface CliComment {
  id: number;
  author: string;
  text: string;
  created_at: string;
}

// Argument types
export interface CreateArgs {
  title: string;
  description?: string;
  issue_type?: string;
  priority?: number;
  design?: string;
  acceptance_criteria?: string;
  assignee?: string;
  external_ref?: string;
  labels?: string[];
}

export interface UpdateArgs {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  assignee?: string;
  external_ref?: string;
  estimated_minutes?: number;
  set_labels?: string[];
}

export interface ListArgs {
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  labels?: string[];
  limit?: number;
}

export interface DepAddArgs {
  from_id: string;
  to_id: string;
  dep_type?: string;
}

const DEFAULT_TIMEOUT = 30000;

export class BeadsCliBackend {
  private beadsDir: string;
  private cwd: string;
  private timeout: number;

  constructor(beadsDir: string, options: { cwd?: string; timeout?: number } = {}) {
    this.beadsDir = beadsDir;
    this.cwd = options.cwd || path.dirname(beadsDir);
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Find the .beads directory starting from a given path
   */
  static findBeadsDir(startPath: string): string | null {
    let current = startPath;
    const root = path.parse(current).root;

    while (current !== root) {
      const beadsDir = path.join(current, ".beads");
      if (fs.existsSync(beadsDir) && fs.statSync(beadsDir).isDirectory()) {
        return beadsDir;
      }
      current = path.dirname(current);
    }
    return null;
  }

  /**
   * Get the configured bd CLI path
   */
  private getBdPath(): string {
    const config = vscode.workspace.getConfiguration("beads");
    return config.get<string>("pathToBd", "bd");
  }

  /**
   * Execute a bd CLI command and return parsed JSON output
   */
  private async exec<T>(args: string[]): Promise<T> {
    const bdPath = this.getBdPath();

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let resolved = false;

      const proc = spawn(bdPath, args, {
        cwd: this.cwd,
        env: { ...process.env, BEADS_DIR: this.beadsDir },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill("SIGTERM");
          reject(new Error(`Command timed out after ${this.timeout}ms: bd ${args.join(" ")}`));
        }
      }, this.timeout);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to spawn bd: ${err.message}`));
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);
        if (resolved) return;
        resolved = true;

        if (code !== 0) {
          const errMsg = stderr.trim() || `bd exited with code ${code}`;
          reject(new Error(errMsg));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          // Some commands return no output on success (e.g., dep add)
          resolve(undefined as unknown as T);
          return;
        }

        try {
          resolve(JSON.parse(trimmed) as T);
        } catch (err) {
          reject(new Error(`Failed to parse JSON from bd: ${err}\nOutput: ${trimmed.slice(0, 200)}`));
        }
      });
    });
  }

  /**
   * Execute a bd CLI command that doesn't return JSON
   */
  private async execRaw(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const bdPath = this.getBdPath();

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let resolved = false;

      const proc = spawn(bdPath, args, {
        cwd: this.cwd,
        env: { ...process.env, BEADS_DIR: this.beadsDir },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill("SIGTERM");
          reject(new Error(`Command timed out after ${this.timeout}ms: bd ${args.join(" ")}`));
        }
      }, this.timeout);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to spawn bd: ${err.message}`));
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);
        if (resolved) return;
        resolved = true;

        if (code !== 0) {
          const errMsg = stderr.trim() || `bd exited with code ${code}`;
          reject(new Error(errMsg));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }

  // --- Health / Info ---

  async info(): Promise<BeadsInfo> {
    return this.exec<BeadsInfo>(["info", "--json"]);
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.info();
      return true;
    } catch {
      return false;
    }
  }

  // --- Issues ---

  async list(args: ListArgs = {}): Promise<CliIssue[]> {
    const cmdArgs = ["list", "--json", "--limit", "0"];

    if (args.status) {
      cmdArgs.push("--status", args.status);
    }
    if (args.priority !== undefined) {
      cmdArgs.push("--priority", String(args.priority));
    }
    if (args.issue_type) {
      cmdArgs.push("--type", args.issue_type);
    }
    if (args.assignee) {
      cmdArgs.push("--assignee", args.assignee);
    }
    if (args.labels?.length) {
      for (const label of args.labels) {
        cmdArgs.push("--label", label);
      }
    }
    if (args.limit !== undefined) {
      // Override the default --limit 0
      const idx = cmdArgs.indexOf("--limit");
      if (idx !== -1) {
        cmdArgs[idx + 1] = String(args.limit);
      }
    }

    const result = await this.exec<CliIssue[]>(cmdArgs);
    return result ?? [];
  }

  async show(id: string): Promise<CliIssue | null> {
    try {
      // bd show --json returns an array, extract the first element
      const result = await this.exec<CliIssue | CliIssue[]>(["show", id, "--json"]);
      if (Array.isArray(result)) {
        return result[0] ?? null;
      }
      return result;
    } catch {
      return null;
    }
  }

  async create(args: CreateArgs): Promise<CliIssue> {
    const cmdArgs = ["create", "--json", "--title", args.title];

    if (args.issue_type) {
      cmdArgs.push("--type", args.issue_type);
    }
    if (args.priority !== undefined) {
      cmdArgs.push("--priority", String(args.priority));
    }
    if (args.description) {
      cmdArgs.push("--description", args.description);
    }
    if (args.assignee) {
      cmdArgs.push("--assignee", args.assignee);
    }
    if (args.labels?.length) {
      for (const label of args.labels) {
        cmdArgs.push("--label", label);
      }
    }

    // bd create --json may return an array
    const result = await this.exec<CliIssue | CliIssue[]>(cmdArgs);
    return Array.isArray(result) ? result[0] : result;
  }

  async update(args: UpdateArgs): Promise<CliIssue> {
    const cmdArgs = ["update", args.id, "--json"];

    if (args.title !== undefined) {
      cmdArgs.push("--title", args.title);
    }
    if (args.description !== undefined) {
      cmdArgs.push("--description", args.description);
    }
    if (args.status !== undefined) {
      cmdArgs.push("--status", args.status);
    }
    if (args.priority !== undefined) {
      cmdArgs.push("--priority", String(args.priority));
    }
    if (args.design !== undefined) {
      cmdArgs.push("--design", args.design);
    }
    if (args.acceptance_criteria !== undefined) {
      cmdArgs.push("--acceptance-criteria", args.acceptance_criteria);
    }
    if (args.notes !== undefined) {
      cmdArgs.push("--notes", args.notes);
    }
    if (args.assignee !== undefined) {
      cmdArgs.push("--assignee", args.assignee);
    }
    if (args.external_ref !== undefined) {
      cmdArgs.push("--external-ref", args.external_ref);
    }
    if (args.estimated_minutes !== undefined) {
      cmdArgs.push("--estimated-minutes", String(args.estimated_minutes));
    }
    if (args.set_labels !== undefined) {
      // Clear existing labels and set new ones
      cmdArgs.push("--set-labels", args.set_labels.join(","));
    }

    // bd update --json returns an array
    const result = await this.exec<CliIssue | CliIssue[]>(cmdArgs);
    return Array.isArray(result) ? result[0] : result;
  }

  async close(id: string, reason?: string): Promise<CliIssue> {
    const cmdArgs = ["close", id, "--json"];
    if (reason) {
      cmdArgs.push("--reason", reason);
    }
    // bd close --json may return an array
    const result = await this.exec<CliIssue | CliIssue[]>(cmdArgs);
    return Array.isArray(result) ? result[0] : result;
  }

  // --- Dependencies ---

  async listDepsDown(id: string): Promise<CliBeadDependency[]> {
    try {
      const result = await this.exec<CliBeadDependency[] | { error: string }>(["dep", "list", id, "--json"]);
      if (!result || !Array.isArray(result)) return [];
      return result;
    } catch {
      return [];
    }
  }

  async listDepsUp(id: string): Promise<CliBeadDependency[]> {
    try {
      const result = await this.exec<CliBeadDependency[] | { error: string }>(["dep", "list", id, "--json", "--direction=up"]);
      if (!result || !Array.isArray(result)) return [];
      return result;
    } catch {
      return [];
    }
  }

  async addDependency(args: DepAddArgs): Promise<void> {
    const cmdArgs = ["dep", "add", args.from_id, args.to_id];
    if (args.dep_type) {
      cmdArgs.push("--type", args.dep_type);
    }
    await this.execRaw(cmdArgs);
  }

  async removeDependency(fromId: string, toId: string): Promise<void> {
    await this.execRaw(["dep", "remove", fromId, toId]);
  }

  // --- Comments ---

  async listComments(id: string): Promise<CliComment[]> {
    try {
      const result = await this.exec<CliComment[]>(["comments", id, "--json"]);
      return result ?? [];
    } catch {
      return [];
    }
  }

  async addComment(id: string, text: string): Promise<void> {
    await this.execRaw(["comments", "add", id, text]);
  }

  // --- Labels ---

  async addLabel(id: string, label: string): Promise<void> {
    await this.execRaw(["label", "add", id, label]);
  }

  async removeLabel(id: string, label: string): Promise<void> {
    await this.execRaw(["label", "remove", id, label]);
  }

  // --- Dolt Operations ---

  async doltPush(): Promise<{ stdout: string; stderr: string }> {
    return this.execRaw(["dolt", "push"]);
  }

  async doltPull(): Promise<{ stdout: string; stderr: string }> {
    return this.execRaw(["dolt", "pull"]);
  }

  async doltCommit(message?: string): Promise<{ stdout: string; stderr: string }> {
    const args = ["dolt", "commit"];
    if (message) {
      args.push("-m", message);
    }
    return this.execRaw(args);
  }

  // --- Helpers ---

  /**
   * Fetch a full bead with deps and comments (3 parallel calls)
   */
  async showFull(id: string): Promise<Bead | null> {
    const [issue, depsDown, depsUp, comments] = await Promise.all([
      this.show(id),
      this.listDepsDown(id),
      this.listDepsUp(id),
      this.listComments(id),
    ]);

    if (!issue) return null;

    // Use inline comments from bd show if present, otherwise use separate bd comments result
    const resolvedComments = (issue.comments && issue.comments.length > 0)
      ? issue.comments
      : comments as Array<{ id: number; author: string; text: string; created_at: string }>;

    // Merge deps and comments into the issue for issueToWebviewBead
    const issueWithData = {
      ...issue,
      dependencies: depsDown,
      dependents: depsUp,
      comments: resolvedComments,
    };

    return issueToWebviewBead(issueWithData);
  }

  dispose(): void {
    // No resources to clean up (no sockets, no watchers)
  }
}
