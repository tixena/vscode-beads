/**
 * ProjectDropdown Component
 *
 * Custom dropdown for selecting projects with connection status indicators.
 * Uses generic Dropdown component for consistent behavior.
 */

import type React from "react";
import type { BeadsProject } from "../types";
import { Dropdown, DropdownItem } from "./Dropdown";

interface ProjectDropdownProps {
  projects: BeadsProject[];
  activeProject: BeadsProject | null;
  onSelectProject: (projectId: string) => void;
}

export function ProjectDropdown({
  projects,
  activeProject,
  onSelectProject,
}: ProjectDropdownProps): React.ReactElement {
  if (projects.length === 0) {
    return (
      <div className="project-dropdown">
        <span className="project-dropdown-label">No projects</span>
      </div>
    );
  }

  const handleSelect = (projectId: string) => {
    onSelectProject(projectId);
  };

  const triggerContent = (
    <>
      <ConnectionDot status={activeProject?.connectionStatus || "unknown"} />
      <span className="project-dropdown-name">
        {activeProject?.name || projects[0]?.name || "Select project"}
      </span>
    </>
  );

  return (
    <Dropdown
      trigger={triggerContent}
      className="project-dropdown"
      triggerClassName="project-dropdown-trigger"
      menuClassName="project-dropdown-menu"
      title={activeProject?.rootPath}
    >
      {projects.map((project) => (
        <DropdownItem
          key={project.id}
          className="project-dropdown-item"
          active={project.id === activeProject?.id}
          onClick={() => handleSelect(project.id)}
          title={project.rootPath}
        >
          <ConnectionDot status={project.connectionStatus || "unknown"} />
          <span className="project-dropdown-item-name">{project.name}</span>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

interface ConnectionDotProps {
  status: "connected" | "error" | "unknown";
}

function ConnectionDot({ status }: ConnectionDotProps): React.ReactElement {
  // Map to CSS classes that already exist (connected=running, error=stopped)
  const cssClass = status === "connected" ? "running" : status === "error" ? "stopped" : "unknown";
  return <span className={`daemon-dot ${cssClass}`} title={`Status: ${status}`} />;
}
