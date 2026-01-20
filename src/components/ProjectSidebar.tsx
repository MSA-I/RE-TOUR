import { Link, useLocation } from "react-router-dom";
import { useRenderJobs } from "@/hooks/useRenderJobs";
import { useUploads } from "@/hooks/useUploads";
import { useProjects } from "@/hooks/useProjects";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Image, Play, CheckCircle, FolderOpen, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";

interface ProjectSidebarProps {
  projectId: string;
  onNavigate?: (tab: string) => void;
}

export function ProjectSidebar({ projectId, onNavigate }: ProjectSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;

  // Fetch data for counts
  const { uploads: panoramas } = useUploads(projectId, "panorama");
  const { jobs } = useRenderJobs(projectId);
  const { projects } = useProjects();

  // Categorize jobs
  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const completedJobs = jobs.filter((j) => j.status === "approved" || j.status === "needs_review");

  const [projectsOpen, setProjectsOpen] = useState(false);

  const navItems = [
    {
      title: "Uploaded Images",
      icon: Image,
      tabValue: "uploads",
      count: panoramas.length,
    },
    {
      title: "Render Jobs",
      icon: Play,
      tabValue: "jobs",
      count: activeJobs.length,
      description: "Active",
    },
    {
      title: "Edited Images",
      icon: CheckCircle,
      tabValue: "jobs",
      count: completedJobs.length,
      description: "Completed",
    },
  ];

  const handleNavClick = (tabValue: string) => {
    if (onNavigate) {
      onNavigate(tabValue);
    }
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50 z-40">
      <SidebarContent>
        {/* Main navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    onClick={() => handleNavClick(item.tabValue)}
                    tooltip={item.title}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <item.icon className="h-4 w-4" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">
                          {item.title}
                          {item.description && (
                            <span className="block text-[10px] text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {item.count}
                        </span>
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Projects section */}
        <SidebarGroup>
          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer hover:bg-muted/50 rounded flex items-center justify-between pr-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  {!collapsed && <span>Projects</span>}
                </div>
                {!collapsed && (
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${projectsOpen ? "rotate-180" : ""}`}
                  />
                )}
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {projects.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton asChild tooltip={project.name}>
                        <Link
                          to={`/projects/${project.id}`}
                          className={`${
                            currentPath === `/projects/${project.id}`
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <FolderOpen className="h-4 w-4" />
                          {!collapsed && (
                            <span className="truncate flex-1">{project.name}</span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
