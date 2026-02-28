/**
 * BeadsPanelViewProvider - Provides the main Beads Panel view
 *
 * Features:
 * - Table/list view of all beads
 * - Column sorting
 * - Filtering by status, priority, labels, type
 * - Text search
 * - Click to open details
 */

import * as vscode from "vscode";
import { BaseViewProvider } from "./BaseViewProvider";
import { BeadsProjectManager } from "../backend/BeadsProjectManager";
import { WebviewToExtensionMessage, Bead, issueToWebviewBead } from "../backend/types";
import { Logger } from "../utils/logger";

export class BeadsPanelViewProvider extends BaseViewProvider {
  protected readonly viewType = "beadsPanel";
  private selectedBeadId: string | null = null;

  constructor(
    extensionUri: vscode.Uri,
    projectManager: BeadsProjectManager,
    logger: Logger
  ) {
    super(extensionUri, projectManager, logger.child("Panel"));
  }

  /**
   * Set the selected bead ID and notify webview
   */
  public setSelectedBead(beadId: string | null): void {
    this.selectedBeadId = beadId;
    this.postMessage({ type: "setSelectedBeadId", beadId });
  }

  protected async loadData(): Promise<void> {
    const backend = this.projectManager.getBackend();
    if (!backend) {
      this.postMessage({ type: "setBeads", beads: [] });
      return;
    }

    this.setLoading(true);
    this.setError(null);

    try {
      const issues = await backend.list();
      const beads = issues.map(issueToWebviewBead).filter((b): b is Bead => b !== null);
      this.postMessage({ type: "setBeads", beads });
    } catch (err) {
      this.setError(String(err));
      this.postMessage({ type: "setBeads", beads: [] });
      this.log.error(`Failed to load beads: ${err}`);
    } finally {
      this.setLoading(false);
    }
  }

  protected async handleCustomMessage(
    message: WebviewToExtensionMessage
  ): Promise<void> {
    const backend = this.projectManager.getBackend();
    if (!backend) {
      return;
    }

    switch (message.type) {
      case "updateBead":
        try {
          // Map webview field names to CLI field names
          const updates = message.updates as Record<string, unknown>;
          const updateArgs: Record<string, unknown> = { id: message.beadId };

          for (const [key, value] of Object.entries(updates)) {
            switch (key) {
              case "labels":
                updateArgs.set_labels = value;
                break;
              case "externalRef":
                updateArgs.external_ref = value;
                break;
              case "acceptanceCriteria":
                updateArgs.acceptance_criteria = value;
                break;
              case "estimatedMinutes":
                updateArgs.estimated_minutes = value;
                break;
              case "type":
                updateArgs.issue_type = value;
                break;
              default:
                updateArgs[key] = value;
            }
          }

          await backend.update(updateArgs as Parameters<typeof backend.update>[0]);
          // Refresh to show changes (no mutation events in CLI mode)
          await this.loadData();
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to update bead: ${err}`);
        }
        break;

      case "deleteBead":
        vscode.window.showWarningMessage(
          "Delete functionality is not yet implemented"
        );
        break;
    }
  }
}
