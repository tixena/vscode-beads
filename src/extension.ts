/**
 * Beads VS Code Extension - Main Entry Point
 *
 * Simplified to two views:
 * - Issues: List of all beads
 * - Details: Selected bead details
 */

import * as vscode from "vscode";
import { BeadsProjectManager } from "./backend/BeadsProjectManager";
import { BeadDetailsViewProvider } from "./providers/BeadDetailsViewProvider";
import { BeadsPanelViewProvider } from "./providers/BeadsPanelViewProvider";
import { DashboardViewProvider } from "./providers/DashboardViewProvider";
import { createLogger, type Logger } from "./utils/logger";

let log: Logger;
let projectManager: BeadsProjectManager;
let dashboardProvider: DashboardViewProvider;
let beadsPanelProvider: BeadsPanelViewProvider;
let detailsProvider: BeadDetailsViewProvider;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Create the root logger with LogOutputChannel
  log = createLogger("Beads");

  // Log activation with version and timestamp for debugging
  const ext = context.extension;
  const version = ext.packageJSON.version || "unknown";
  const isDev = ext.extensionPath.includes("-dev") || !ext.extensionPath.includes(".vscode");
  const timestamp = new Date().toISOString();
  log.info(`Activating v${version}${isDev ? " (dev)" : ""} @ ${timestamp}`);

  // Initialize the project manager
  projectManager = new BeadsProjectManager(context, log);
  await projectManager.initialize();

  // Initialize context for conditional menu items
  vscode.commands.executeCommand("setContext", "beads.hasSelectedBead", false);

  // Create view providers
  dashboardProvider = new DashboardViewProvider(context.extensionUri, projectManager, log);

  beadsPanelProvider = new BeadsPanelViewProvider(context.extensionUri, projectManager, log);

  detailsProvider = new BeadDetailsViewProvider(context.extensionUri, projectManager, log);

  // Register webview providers
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("beadsDashboard", dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("beadsPanel", beadsPanelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("beadsDetails", detailsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("beads.switchProject", async () => {
      await projectManager.showProjectPicker();
    }),

    vscode.commands.registerCommand("beads.openBeadsPanel", () => {
      vscode.commands.executeCommand("beadsPanel.focus");
    }),

    vscode.commands.registerCommand("beads.openBeadDetails", async (beadId?: string) => {
      if (!beadId) {
        // Prompt for bead ID
        const backend = projectManager.getBackend();
        if (!backend) {
          vscode.window.showWarningMessage("No active Beads project");
          return;
        }

        try {
          const issues = await backend.list();
          const items = issues.map((issue) => ({
            label: issue.title,
            description: issue.id,
            detail: `Status: ${issue.status} | Priority: P${issue.priority}`,
            issue,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a bead to view details",
          });

          if (selected) {
            beadId = selected.issue.id;
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to load beads: ${err}`);
          return;
        }
      }

      if (beadId) {
        detailsProvider.showBead(beadId);
        beadsPanelProvider.setSelectedBead(beadId);
      }
    }),

    vscode.commands.registerCommand("beads.refresh", async () => {
      log.info("Manual refresh triggered");
      await projectManager.refresh();
      beadsPanelProvider.refresh();
      detailsProvider.refresh();
      log.info("Refresh complete");
      vscode.window.setStatusBarMessage("$(check) Beads: Refreshed", 2000);
    }),

    vscode.commands.registerCommand("beads.createBead", async () => {
      const backend = projectManager.getBackend();
      if (!backend) {
        vscode.window.showWarningMessage("No active Beads project");
        return;
      }

      const title = await vscode.window.showInputBox({
        prompt: "Enter bead title",
        placeHolder: "Bug: Something is broken",
      });

      if (!title) {
        return;
      }

      const type = await vscode.window.showQuickPick(
        ["bug", "feature", "task", "epic", "chore", "decision"],
        { placeHolder: "Select bead type (optional)" }
      );

      const priority = await vscode.window.showQuickPick(
        [
          { label: "Critical (P0)", value: 0 },
          { label: "High (P1)", value: 1 },
          { label: "Medium (P2)", value: 2 },
          { label: "Low (P3)", value: 3 },
          { label: "None (P4)", value: 4 },
        ],
        { placeHolder: "Select priority (optional)" }
      );

      try {
        const created = await backend.create({
          title,
          issue_type: type || "task",
          priority: priority?.value ?? 2,
        });
        log.info(`Created bead: ${created.id}`);
        vscode.window.showInformationMessage(`Created bead: ${created.id}`);
      } catch (err) {
        log.error(`Failed to create bead: ${err}`);
        vscode.window.showErrorMessage(`Failed to create bead: ${err}`);
      }
    }),

    vscode.commands.registerCommand("beads.doltSync", async () => {
      const synced = await projectManager.doltSync();
      if (synced) {
        vscode.window.showInformationMessage("Beads: Dolt sync complete (pull + push)");
        updateStatusBar();
      } else {
        vscode.window.showErrorMessage("Beads: Dolt sync failed");
      }
    }),

    vscode.commands.registerCommand("beads.doltPush", async () => {
      const pushed = await projectManager.doltPush();
      if (pushed) {
        vscode.window.showInformationMessage("Beads: Dolt push complete");
      } else {
        vscode.window.showErrorMessage("Beads: Dolt push failed");
      }
    }),

    vscode.commands.registerCommand("beads.doltPull", async () => {
      const pulled = await projectManager.doltPull();
      if (pulled) {
        vscode.window.showInformationMessage("Beads: Dolt pull complete");
        updateStatusBar();
      } else {
        vscode.window.showErrorMessage("Beads: Dolt pull failed");
      }
    }),

    vscode.commands.registerCommand("beads.copyBeadId", async () => {
      const beadId = detailsProvider.getCurrentBeadId();
      if (beadId) {
        await vscode.env.clipboard.writeText(beadId);
        vscode.window.setStatusBarMessage(`$(check) Copied: ${beadId}`, 2000);
      } else {
        vscode.window.showWarningMessage("No bead selected");
      }
    })
  );

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "beads.showBeadsMenu";
  context.subscriptions.push(statusBarItem);

  // Register menu command
  context.subscriptions.push(
    vscode.commands.registerCommand("beads.showBeadsMenu", async () => {
      const project = projectManager.getActiveProject();
      if (!project) {
        vscode.window.showWarningMessage("No active Beads project");
        return;
      }

      const items: vscode.QuickPickItem[] = [
        { label: "$(refresh) Refresh", description: "Refresh all views" },
        { label: "$(sync) Sync (Pull + Push)", description: "Pull from remote, then push" },
        { label: "$(cloud-upload) Push", description: "Push to Dolt remote" },
        { label: "$(cloud-download) Pull", description: "Pull from Dolt remote" },
        { label: "$(output) Show Logs", description: "Open Beads output panel" },
      ];

      const selected = await vscode.window.showQuickPick(items, {
        title: `Beads: ${project.name} (${project.connectionStatus})`,
        placeHolder: "Select an action",
      });

      if (selected) {
        if (selected.label.includes("Refresh")) {
          vscode.commands.executeCommand("beads.refresh");
        } else if (selected.label.includes("Sync")) {
          vscode.commands.executeCommand("beads.doltSync");
        } else if (selected.label.includes("Push")) {
          vscode.commands.executeCommand("beads.doltPush");
        } else if (selected.label.includes("Pull")) {
          vscode.commands.executeCommand("beads.doltPull");
        } else if (selected.label.includes("Show Logs")) {
          log.show();
        }
      }
    })
  );

  // Subscribe to project changes to refresh views
  context.subscriptions.push(
    projectManager.onDataChanged(() => {
      dashboardProvider.refresh();
      beadsPanelProvider.refresh();
      detailsProvider.refresh();
    }),

    projectManager.onActiveProjectChanged(() => {
      beadsPanelProvider.setSelectedBead(null); // Clear selection on project switch
      dashboardProvider.refresh();
      beadsPanelProvider.refresh();
      detailsProvider.refresh();
      updateStatusBar();
    }),

    // Refresh projects when workspace folders change
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      log.info("Workspace folders changed, refreshing projects...");
      const previousActiveId = projectManager.getActiveProject()?.id;
      await projectManager.discoverProjects();

      // If active project was removed, switch to first available
      const projects = projectManager.getProjects();
      const activeStillExists = projects.some((p) => p.id === previousActiveId);

      if (!activeStillExists && projects.length > 0) {
        log.info("Active project removed, switching to first available");
        await projectManager.setActiveProject(projects[0].id);
      } else if (projects.length === 0) {
        log.info("No beads projects remaining");
        updateStatusBar();
      }

      // Refresh all views
      dashboardProvider.refresh();
      beadsPanelProvider.refresh();
      detailsProvider.refresh();
    })
  );

  // Add project manager and logger to subscriptions for disposal
  context.subscriptions.push(projectManager);
  context.subscriptions.push(log.outputChannel);

  // Initialize status bar
  updateStatusBar();

  log.info("Extension activated");

  // Show warning if no projects found
  if (projectManager.getProjects().length === 0) {
    vscode.window
      .showInformationMessage(
        "No Beads projects found in the workspace. Initialize a project with `bd init` to get started.",
        "Learn More"
      )
      .then((action) => {
        if (action === "Learn More") {
          vscode.env.openExternal(vscode.Uri.parse("https://github.com/steveyegge/beads"));
        }
      });
  }
}

export function deactivate(): void {
  log?.info("Extension deactivating...");
}

/**
 * Updates the status bar item based on current project state
 */
function updateStatusBar(): void {
  const project = projectManager.getActiveProject();

  if (!project) {
    statusBarItem.hide();
    return;
  }

  switch (project.connectionStatus) {
    case "connected":
      statusBarItem.text = "$(check) Beads";
      statusBarItem.backgroundColor = undefined;
      statusBarItem.tooltip = `Beads: ${project.name}\nCLI connected\nClick for options`;
      break;
    case "error":
      statusBarItem.text = "$(warning) Beads";
      statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      statusBarItem.tooltip = `Beads: ${project.name}\nCLI not responding\nClick for options`;
      break;
    default:
      statusBarItem.text = "$(question) Beads";
      statusBarItem.backgroundColor = undefined;
      statusBarItem.tooltip = `Beads: ${project.name}\nUnknown status\nClick for options`;
  }

  statusBarItem.show();
}
