/**
 * ProjectSelector Component
 *
 * Dropdown for selecting the active Beads project
 */

import type React from "react";
import type { BeadsProject } from "../types";

interface ProjectSelectorProps {
  projects: BeadsProject[];
  activeProject: BeadsProject | null;
  onSelectProject: (projectId: string) => void;
}

export function ProjectSelector({
  projects,
  activeProject,
  onSelectProject,
}: ProjectSelectorProps): React.ReactElement {
  if (projects.length === 0) {
    return (
      <div className="project-selector empty">
        <span>No projects</span>
      </div>
    );
  }

  if (projects.length === 1) {
    return (
      <div className="project-selector single">
        <span className="project-name">{activeProject?.name || projects[0].name}</span>
        <ConnectionBadge status={activeProject?.connectionStatus || "unknown"} />
      </div>
    );
  }

  return (
    <div className="project-selector">
      <select
        value={activeProject?.id || ""}
        onChange={(e) => onSelectProject(e.target.value)}
        className="project-select"
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <ConnectionBadge status={activeProject?.connectionStatus || "unknown"} />
    </div>
  );
}

interface ConnectionBadgeProps {
  status: "connected" | "error" | "unknown";
}

function ConnectionBadge({ status }: ConnectionBadgeProps): React.ReactElement {
  // Map to CSS classes that already exist (connected=running, error=stopped)
  const cssClass =
    status === "connected"
      ? "daemon-running"
      : status === "error"
        ? "daemon-stopped"
        : "daemon-unknown";
  const statusText = status === "connected" ? "●" : status === "error" ? "○" : "?";

  return (
    <span className={`daemon-badge ${cssClass}`} title={`Status: ${status}`}>
      {statusText}
    </span>
  );
}
