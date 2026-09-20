import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { ROLE_LABEL } from "@/lib/constants";
import { Film, LayoutDashboard, FolderKanban, LogOut, ChevronRight, Loader2, BarChart3, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AppShell() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/projects").then((r) => setProjects(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [loc.pathname.startsWith("/projects")]);

  const navCls = ({ isActive }) =>
    cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150",
      isActive ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]");

  const initials = (user?.name || user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      <aside className="hidden md:flex w-64 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border)] px-4">
          <Film className="h-5 w-5 text-blue-500" />
          <span className="font-head font-bold tracking-tight">Film Studio</span>
        </div>
        <nav className="flex-1 overflow-y-auto thin-scroll p-3 space-y-1">
          <NavLink to="/" end className={navCls} data-testid="nav-dashboard">
            <LayoutDashboard className="h-4 w-4" /> Bảng điều khiển
          </NavLink>
          <NavLink to="/projects" end className={navCls} data-testid="nav-projects">
            <FolderKanban className="h-4 w-4" /> Dự án
          </NavLink>
          <NavLink to="/reports" end className={navCls} data-testid="nav-reports">
            <BarChart3 className="h-4 w-4" /> Báo cáo tuần
          </NavLink>
          <NavLink to="/staffing" end className={navCls} data-testid="nav-staffing">
            <CalendarRange className="h-4 w-4" /> Lịch nhân sự
          </NavLink>
          <div className="pt-4 pb-1 px-3 overline">Dự án của tôi</div>
          {loading ? (
            <div className="px-3 py-2"><Loader2 className="h-4 w-4 animate-spin text-[var(--muted-2)]" /></div>
          ) : projects.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--muted-2)]">Chưa có dự án</p>
          ) : (
            projects.map((p) => (
              <NavLink key={p.id} to={`/projects/${p.id}`} className={navCls} data-testid={`nav-project-${p.code}`}>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.title}</span>
              </NavLink>
            ))
          )}
        </nav>
        <div className="flex items-center gap-2 border-t border-[var(--border)] p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--panel-2)] transition-colors" data-testid="user-menu-trigger">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{initials}</div>
                <div className="flex-1 text-left overflow-hidden">
                  <div className="truncate text-sm">{user?.name}</div>
                  <div className="truncate text-xs text-[var(--muted-2)]">{ROLE_LABEL[user?.role] || user?.role}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52 bg-[var(--panel)] border-[var(--border)]">
              <DropdownMenuItem onClick={logout} data-testid="logout-btn" className="text-red-400 focus:text-red-300 focus:bg-red-500/10">
                <LogOut className="mr-2 h-4 w-4" /> Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* mobile top bar */}
        <div className="md:hidden flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4">
          <Link to="/" className="flex items-center gap-2"><Film className="h-5 w-5 text-blue-500" /><span className="font-head font-bold">Film Studio</span></Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={logout} data-testid="logout-btn-mobile"><LogOut className="h-5 w-5 text-[var(--muted)]" /></button>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto thin-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
