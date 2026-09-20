import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import api from "@/lib/api";
import { Loader2, GitBranch, KanbanSquare, FileText, Users, History, Frame } from "lucide-react";
import { cn } from "@/lib/utils";

const ProjectContext = createContext(null);
export const useProject = () => useContext(ProjectContext);

export default function ProjectLayout() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await api.get(`/projects/${id}`);
    setProject(data);
    return data;
  }, [id]);

  useEffect(() => { setLoading(true); reload().finally(() => setLoading(false)); }, [reload]);

  if (loading || !project) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>;
  }

  const myRole = project.my_role;
  const tab = ({ isActive }) =>
    cn("flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-sm transition-colors duration-150",
      isActive ? "border-blue-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200");

  return (
    <ProjectContext.Provider value={{ project, myRole, reload, projectId: id }}>
      <div className="sticky top-0 z-20 border-b border-zinc-800/80 bg-[#09090b]/80 backdrop-blur-xl">
        <div className="px-6 lg:px-8 pt-5">
          <p className="font-mono text-xs text-zinc-500">{project.code}</p>
          <h1 className="font-head text-2xl font-extrabold tracking-tight mt-0.5">{project.title}</h1>
          <nav className="mt-4 flex gap-6 overflow-x-auto">
            <NavLink to={`/projects/${id}`} end className={tab} data-testid="tab-structure"><GitBranch className="h-4 w-4" /> Cấu trúc</NavLink>
            <NavLink to={`/projects/${id}/board`} className={tab} data-testid="tab-board"><KanbanSquare className="h-4 w-4" /> Phân công</NavLink>
            <NavLink to={`/projects/${id}/canvas`} className={tab} data-testid="tab-canvas"><Frame className="h-4 w-4" /> Canvas</NavLink>
            <NavLink to={`/projects/${id}/script`} className={tab} data-testid="tab-script"><FileText className="h-4 w-4" /> Kịch bản</NavLink>
            <NavLink to={`/projects/${id}/members`} className={tab} data-testid="tab-members"><Users className="h-4 w-4" /> Thành viên</NavLink>
            <NavLink to={`/projects/${id}/audit`} className={tab} data-testid="tab-audit"><History className="h-4 w-4" /> Lịch sử</NavLink>
          </nav>
        </div>
      </div>
      <div className="p-6 lg:p-8">
        <Outlet />
      </div>
    </ProjectContext.Provider>
  );
}
