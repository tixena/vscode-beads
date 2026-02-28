/**
 * BeadsProjectManager - Project Discovery and Active Project Management
 *
 * This service handles:
 * - Discovering Beads projects in the current VS Code workspace
 * - Managing the currently active project
 * - CLI backend lifecycle (no daemon)
 * - Periodic polling for change detection
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { BeadsProject } from "./types";
import { BeadsCliBackend } from "./BeadsCliBackend";
import { Logger } from "../utils/logger";

const ACTIVE_PROJECT_KEY = "beads.activeProjectId";

export class BeadsProjectManager implements vscode.Disposable {
  private projects: BeadsProject[] = [];
  private activeProject: BeadsProject | null = null;
  private backend: BeadsCliBackend | null = null;
  private log: Logger;
  private context: vscode.ExtensionContext;
  private pollInterval: NodeJS.Timeout | null = null;

  private readonly _onProjectsChanged = new vscode.EventEmitter<BeadsProject[]>();
  public readonly onProjectsChanged = this._onProjectsChanged.event;

  private readonly _onActiveProjectChanged = new vscode.EventEmitter<BeadsProject | null>();
  public readonly onActiveProjectChanged = this._onActiveProjectChanged.event;

  private readonly _onDataChanged = new vscode.EventEmitter<void>();
  public readonly onDataChanged = this._onDataChanged.event;

  constructor(context: vscode.ExtensionContext, logger: Logger) {
    this.context = context;
    this.log = logger.child("ProjectManager");
  }

  /**
   * Initializes the project manager by discovering all projects
   */
  async initialize(): Promise<void> {
    await this.discoverProjects();

    // Restore previously selected project, or default to first
    if (this.projects.length > 0 && !this.activeProject) {
      const savedProjectId = this.context.workspaceState.get<string>(ACTIVE_PROJECT_KEY);
      const targetProject = savedProjectId
        ? this.projects.find((p) => p.id === savedProjectId)
        : null;

      await this.setActiveProject(targetProject?.id || this.projects[0].id);
    }
  }

  /**
   * Discovers Beads projects in all workspace folders
   */
  async discoverProjects(): Promise<void> {
    this.log.info("Discovering Beads projects...");

    const discoveredProjects: BeadsProject[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    // Check each workspace folder for a .beads directory
    for (const folder of workspaceFolders) {
      const beadsDir = path.join(folder.uri.fsPath, ".beads");

      try {
        const stats = await fs.promises.stat(beadsDir);
        if (stats.isDirectory()) {
          const project = this.createProjectFromPath(
            folder.uri.fsPath,
            beadsDir,
            folder.name
          );
          discoveredProjects.push(project);
          this.log.info(`Found project: ${project.name} at ${project.rootPath}`);
        }
      } catch {
        // .beads directory doesn't exist in this folder, skip
      }
    }

    this.projects = discoveredProjects;
    this._onProjectsChanged.fire(this.projects);

    this.log.info(`Discovered ${this.projects.length} project(s)`);
  }

  /**
   * Creates a BeadsProject from a discovered path
   */
  private createProjectFromPath(
    rootPath: string,
    beadsDir: string,
    folderName: string
  ): BeadsProject {
    return {
      id: this.generateProjectId(beadsDir),
      name: folderName,
      rootPath,
      beadsDir,
      connectionStatus: "unknown",
    };
  }

  /**
   * Generates a stable ID for a project based on its beads directory path
   */
  private generateProjectId(beadsDir: string): string {
    return crypto.createHash("sha256").update(beadsDir).digest("hex").slice(0, 12);
  }

  /**
   * Gets all discovered projects
   */
  getProjects(): BeadsProject[] {
    return this.projects;
  }

  /**
   * Gets the currently active project
   */
  getActiveProject(): BeadsProject | null {
    return this.activeProject;
  }

  /**
   * Gets the CLI backend for the active project
   */
  getBackend(): BeadsCliBackend | null {
    return this.backend;
  }

  /**
   * Sets the active project by ID
   */
  async setActiveProject(projectId: string): Promise<boolean> {
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) {
      this.log.warn(`Project not found: ${projectId}`);
      return false;
    }

    // Clean up previous backend
    if (this.backend) {
      this.backend.dispose();
    }
    this.stopPolling();

    this.activeProject = project;

    // Save selection to workspace state
    await this.context.workspaceState.update(ACTIVE_PROJECT_KEY, project.id);

    // Create new CLI backend
    this.backend = new BeadsCliBackend(project.beadsDir, {
      cwd: project.rootPath,
    });

    this.log.info(`Active project set to: ${project.name}`);

    // Check health
    const healthy = await this.backend.checkHealth();
    if (healthy) {
      project.connectionStatus = "connected";
      this.log.info("CLI backend healthy");
    } else {
      project.connectionStatus = "error";
      this.log.warn("CLI backend health check failed - bd may not be installed or .beads not initialized");
    }

    // Start polling for changes
    this.startPolling();

    this._onActiveProjectChanged.fire(this.activeProject);
    this._onDataChanged.fire();

    return true;
  }

  /**
   * Starts periodic polling for data changes
   */
  private startPolling(): void {
    this.stopPolling();

    const config = vscode.workspace.getConfiguration("beads");
    const intervalMs = config.get<number>("refreshInterval", 30000);

    if (intervalMs <= 0) {
      return;
    }

    this.pollInterval = setInterval(() => {
      this._onDataChanged.fire();
    }, intervalMs);
  }

  /**
   * Stops periodic polling
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Refreshes data for the active project
   */
  async refresh(): Promise<void> {
    if (!this.activeProject || !this.backend) {
      return;
    }

    // Re-check health
    const healthy = await this.backend.checkHealth();
    this.activeProject.connectionStatus = healthy ? "connected" : "error";

    this._onActiveProjectChanged.fire(this.activeProject);
    this._onDataChanged.fire();
  }

  /**
   * Shows a quick pick to select a project
   */
  async showProjectPicker(): Promise<BeadsProject | undefined> {
    if (this.projects.length === 0) {
      vscode.window.showWarningMessage(
        "No Beads projects found. Initialize a project with `bd init` first."
      );
      return undefined;
    }

    const items = this.projects.map((project) => ({
      label: project.name,
      description: project.rootPath,
      detail: `Status: ${project.connectionStatus}`,
      project,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a Beads project",
      title: "Switch Beads Project",
    });

    if (selected) {
      await this.setActiveProject(selected.project.id);
      return selected.project;
    }

    return undefined;
  }

  /**
   * Dolt sync: push and pull
   */
  async doltSync(): Promise<boolean> {
    if (!this.backend) return false;

    try {
      await this.backend.doltPull();
      await this.backend.doltPush();
      this._onDataChanged.fire();
      return true;
    } catch (err) {
      this.log.error(`Dolt sync failed: ${err}`);
      return false;
    }
  }

  /**
   * Dolt push
   */
  async doltPush(): Promise<boolean> {
    if (!this.backend) return false;

    try {
      await this.backend.doltPush();
      return true;
    } catch (err) {
      this.log.error(`Dolt push failed: ${err}`);
      return false;
    }
  }

  /**
   * Dolt pull
   */
  async doltPull(): Promise<boolean> {
    if (!this.backend) return false;

    try {
      await this.backend.doltPull();
      this._onDataChanged.fire();
      return true;
    } catch (err) {
      this.log.error(`Dolt pull failed: ${err}`);
      return false;
    }
  }

  dispose(): void {
    this.stopPolling();
    if (this.backend) {
      this.backend.dispose();
    }
    this._onProjectsChanged.dispose();
    this._onActiveProjectChanged.dispose();
    this._onDataChanged.dispose();
  }
}
