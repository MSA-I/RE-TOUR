import { useState, useMemo } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/hooks/useProjects";
import { useProjectsWithCounts, ProjectWithCounts } from "@/hooks/useProjectsWithCounts";
import { useJobFeed, JobFeedItem, JobStatusFilter } from "@/hooks/useJobFeed";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Search,
  MoreVertical,
  Building2,
  FolderOpen,
  CheckCircle,
  XCircle,
  Clock,
  Image,
  Layers,
  ExternalLink,
  FileImage,
  Grid3X3,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const ITEMS_PER_PAGE = 10;

type StatusFilter = "all" | "draft" | "active" | "completed" | "failed";

export default function Projects() {
  const { user, loading: authLoading } = useAuth();
  const { createProject, deleteProject } = useProjects();
  const { data: projectsWithCounts, isLoading: projectsLoading } = useProjectsWithCounts();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Get job feed for non-"all" tabs
  const jobStatusFilter = statusFilter !== "all" ? statusFilter as JobStatusFilter : undefined;
  const { data: jobFeed, isLoading: jobsLoading } = useJobFeed(jobStatusFilter);

  const isLoading = statusFilter === "all" ? projectsLoading : jobsLoading;

  // Filter projects for "All Projects" tab - MUST be before early returns
  const filteredProjects = useMemo(() => {
    let result = projectsWithCounts || [];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(query));
    }
    return result;
  }, [projectsWithCounts, searchQuery]);

  // Filter jobs for job-based tabs - MUST be before early returns
  const filteredJobs = useMemo(() => {
    let result = jobFeed || [];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((j) => 
        j.source_filename?.toLowerCase().includes(query) ||
        j.project_name?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [jobFeed, searchQuery]);

  // Get counts for filter badges - MUST be before early returns
  const filterCounts = useMemo(() => {
    const projects = projectsWithCounts || [];
    const totalActive = projects.reduce((sum, p) => sum + p.active_jobs_count, 0);
    const totalCompleted = projects.reduce((sum, p) => sum + p.completed_jobs_count, 0);
    const totalFailed = projects.reduce((sum, p) => sum + p.failed_jobs_count, 0);
    const totalDraft = projects.filter((p) => p.status === "draft").length;
    
    return {
      all: projects.length,
      draft: totalDraft,
      active: totalActive,
      completed: totalCompleted,
      failed: totalFailed,
    };
  }, [projectsWithCounts]);

  // Early returns AFTER all hooks
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Pagination (computed values, not hooks)
  const totalItems = statusFilter === "all" ? filteredProjects.length : filteredJobs.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const paginatedProjects = filteredProjects.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const paginatedJobs = filteredJobs.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setIsCreating(true);
    try {
      await createProject.mutateAsync(newProjectName.trim());
      toast({ title: "Project created" });
      setNewProjectName("");
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: "Failed to create project",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;

    try {
      await deleteProject.mutateAsync(id);
      toast({ title: "Project deleted" });
    } catch (error) {
      toast({
        title: "Failed to delete project",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleStatusFilterChange = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  // Use last_job_updated_at for dynamic "Last Updated"
  const getProjectLastUpdated = (project: ProjectWithCounts): string => {
    return project.last_job_updated_at || project.created_at || new Date().toISOString();
  };

  const statusFilters: { label: string; value: StatusFilter; count: number }[] = [
    { label: "All Projects", value: "all", count: filterCounts.all },
    { label: "Draft", value: "draft", count: filterCounts.draft },
    { label: "Active Jobs", value: "active", count: filterCounts.active },
    { label: "Completed", value: "completed", count: filterCounts.completed },
    { label: "Failed", value: "failed", count: filterCounts.failed },
  ];

  const getStatusBadge = (project: ProjectWithCounts) => {
    let effectiveStatus = project.status;
    if (project.active_jobs_count > 0) effectiveStatus = "active";
    else if (project.failed_jobs_count > 0 && project.completed_jobs_count === 0) effectiveStatus = "failed";
    else if (project.completed_jobs_count > 0) effectiveStatus = "completed";

    const statusStyles: Record<string, string> = {
      draft: "bg-muted text-muted-foreground border-muted-foreground/30",
      active: "bg-primary/20 text-primary border-primary/30",
      completed: "bg-green-500/20 text-green-500 border-green-500/30",
      failed: "bg-destructive/20 text-destructive border-destructive/30",
    };

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[effectiveStatus] || statusStyles.draft}`}
      >
        {effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}
      </span>
    );
  };

  const getJobStatusBadge = (status: string) => {
    const statusStyles: Record<string, string> = {
      queued: "bg-muted text-muted-foreground border-muted-foreground/30",
      pending: "bg-muted text-muted-foreground border-muted-foreground/30",
      running: "bg-primary/20 text-primary border-primary/30",
      processing: "bg-primary/20 text-primary border-primary/30",
      approved: "bg-green-500/20 text-green-500 border-green-500/30",
      needs_review: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
      completed: "bg-green-500/20 text-green-500 border-green-500/30",
      failed: "bg-destructive/20 text-destructive border-destructive/30",
      rejected: "bg-destructive/20 text-destructive border-destructive/30",
    };

    const labels: Record<string, string> = {
      queued: "Queued",
      pending: "Pending",
      running: "Running",
      processing: "Processing",
      approved: "Approved",
      needs_review: "Review",
      completed: "Completed",
      failed: "Failed",
      rejected: "Rejected",
    };

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[status] || statusStyles.queued}`}
      >
        {labels[status] || status}
      </span>
    );
  };

  const getJobTypeIcon = (jobType: string) => {
    switch (jobType) {
      case "panorama_job":
        return <Image className="h-4 w-4 text-primary" />;
      case "batch_item":
        return <Layers className="h-4 w-4 text-blue-500" />;
      case "floorplan_step":
        return <Grid3X3 className="h-4 w-4 text-amber-500" />;
      default:
        return <FileImage className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getJobTypeLabel = (job: JobFeedItem) => {
    switch (job.job_type) {
      case "panorama_job":
        return "Panorama";
      case "batch_item":
        return "Batch";
      case "floorplan_step":
        return `Floor Plan (Step ${job.step_number || 1})`;
      default:
        return "Job";
    }
  };

  const renderJobSummary = (project: ProjectWithCounts) => {
    const parts: React.ReactNode[] = [];

    if (project.active_jobs_count > 0) {
      parts.push(
        <span key="active" className="flex items-center gap-1 text-primary">
          <Clock className="h-3 w-3" />
          Active: {project.active_jobs_count}
        </span>
      );
    }
    if (project.completed_jobs_count > 0) {
      parts.push(
        <span key="completed" className="flex items-center gap-1 text-green-500">
          <CheckCircle className="h-3 w-3" />
          Completed: {project.completed_jobs_count}
        </span>
      );
    }
    if (project.failed_jobs_count > 0) {
      parts.push(
        <span key="failed" className="flex items-center gap-1 text-destructive">
          <XCircle className="h-3 w-3" />
          Failed: {project.failed_jobs_count}
        </span>
      );
    }

    if (parts.length === 0) {
      return <span className="text-muted-foreground text-xs">No jobs yet</span>;
    }

    return <div className="flex flex-col gap-1 text-xs">{parts}</div>;
  };

  const renderProjectsTable = () => (
    <>
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div className="col-span-4">Project Name</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-3">Job Summary</div>
        <div className="col-span-2">Last Updated</div>
        <div className="col-span-1 text-right">Actions</div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-border">
        {paginatedProjects.map((project) => (
          <div
            key={project.id}
            className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-muted/20 transition-colors"
          >
            <div className="col-span-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <Link
                  to={`/projects/${project.id}`}
                  className="font-medium hover:text-primary truncate block"
                >
                  {project.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(project.created_at!), "MMM d, yyyy")}
                </p>
              </div>
            </div>
            <div className="col-span-2">
              {getStatusBadge(project)}
            </div>
            <div className="col-span-3 text-xs">
              {renderJobSummary(project)}
            </div>
            <div className="col-span-2 text-sm text-muted-foreground">
              {/* Use most recent job activity for dynamic "Last Updated" */}
              {formatDistanceToNow(
                new Date(getProjectLastUpdated(project)),
                { addSuffix: true }
              )}
            </div>
            <div className="col-span-1 flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-2 hover:bg-muted rounded-lg transition-colors">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/projects/${project.id}`}>
                      Open Project
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() =>
                      handleDeleteProject(project.id, project.name)
                    }
                  >
                    Delete Project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const renderJobsTable = () => (
    <>
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div className="col-span-1">Type</div>
        <div className="col-span-3">Input File</div>
        <div className="col-span-2">Project</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-2">Updated</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-border">
        {paginatedJobs.map((job) => (
          <div
            key={`${job.job_type}-${job.job_id}`}
            className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-muted/20 transition-colors"
          >
            <div className="col-span-1">
              <div className="flex items-center gap-2">
                {getJobTypeIcon(job.job_type)}
              </div>
            </div>
            <div className="col-span-3 min-w-0">
              <p className="font-medium truncate">{job.source_filename || "Unknown"}</p>
              <p className="text-xs text-muted-foreground">{getJobTypeLabel(job)}</p>
            </div>
            <div className="col-span-2 min-w-0">
              <Link 
                to={`/projects/${job.project_id}`}
                className="text-sm hover:text-primary truncate block"
              >
                {job.project_name}
              </Link>
            </div>
            <div className="col-span-2">
              {getJobStatusBadge(job.status)}
              {job.last_error && (
                <p className="text-xs text-destructive mt-1 truncate" title={job.last_error}>
                  {job.last_error.slice(0, 30)}...
                </p>
              )}
            </div>
            <div className="col-span-2 text-sm text-muted-foreground">
              {formatDistanceToNow(new Date(job.updated_at), { addSuffix: true })}
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(job.deep_link_route)}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Open
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-1">Projects</h1>
            <p className="text-muted-foreground">
              Manage your virtual tour renders and deployments
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-2" />
                Create New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateProject}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="project-name">Project Name</Label>
                    <Input
                      id="project-name"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="My Virtual Tour"
                      required
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={statusFilter === "all" ? "Search projects..." : "Search jobs..."}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 bg-card border-border"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {statusFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => handleStatusFilterChange(filter.value)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  statusFilter === filter.value
                    ? "bg-muted text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {filter.label}
                {filter.count > 0 && (
                  <span className="text-xs bg-background/50 px-1.5 py-0.5 rounded">
                    {filter.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : totalItems === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                {searchQuery
                  ? "No results match your search"
                  : statusFilter === "all" 
                    ? "No projects yet"
                    : `No ${statusFilter} jobs`}
              </p>
              {!searchQuery && statusFilter === "all" && (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first project
                </Button>
              )}
            </div>
          ) : statusFilter === "all" ? (
            renderProjectsTable()
          ) : (
            renderJobsTable()
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing{" "}
                <span className="font-medium">
                  {(currentPage - 1) * ITEMS_PER_PAGE + 1}
                </span>{" "}
                to{" "}
                <span className="font-medium">
                  {Math.min(currentPage * ITEMS_PER_PAGE, totalItems)}
                </span>{" "}
                of <span className="font-medium">{totalItems}</span>{" "}
                {statusFilter === "all" ? "projects" : "jobs"}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(
                  (page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        currentPage === page
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      {page}
                    </button>
                  )
                )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-sm rounded-lg bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
