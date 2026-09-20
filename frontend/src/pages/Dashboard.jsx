import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { SHOT_STATUS } from "@/lib/constants";
import { Loader2, FolderKanban, ListChecks, Clock, CheckCircle2, TrendingUp, Film } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const STATUS_COLOR = {
  todo: "var(--chart-6)", in_progress: "var(--chart-1)", review: "var(--chart-3)",
  rejected: "var(--chart-5)", approved: "var(--chart-4)", done: "var(--chart-2)",
};

const Stat = ({ icon: Icon, label, value, tint }) => (
  <div className="group rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 transition-transform duration-200 hover:-translate-y-0.5" data-testid={`stat-${label}`}>
    <div className="flex items-center justify-between">
      <span className="overline">{label}</span>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${tint} 15%, transparent)` }}>
        <Icon className="h-4 w-4" style={{ color: tint }} />
      </span>
    </div>
    <div className="mt-3 font-mono text-3xl font-bold tabular text-[var(--text)]">{value}</div>
  </div>
);

const tooltipStyle = {
  background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
  color: "var(--text)", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => { api.get("/dashboard").then((r) => setData(r.data)); }, []);

  if (!data) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>;

  const total = data.total_shots || 0;
  const pieData = Object.entries(data.shot_status)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: SHOT_STATUS[k]?.label || k, key: k, value: v }));

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8 animate-fade-up">
      <div className="mb-8">
        <p className="overline">Bảng điều khiển</p>
        <h1 className="font-head text-3xl font-bold tracking-tight mt-1 text-[var(--text)]">Xin chào, {user?.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Tổng quan tiến độ sản xuất trên các dự án của bạn.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={FolderKanban} label="Dự án" value={data.project_count} tint="var(--chart-1)" />
        <Stat icon={ListChecks} label="Tổng shot" value={data.total_shots} tint="var(--chart-2)" />
        <Stat icon={Clock} label="Chờ duyệt" value={data.pending_review} tint="var(--chart-3)" />
        <Stat icon={CheckCircle2} label="Việc của tôi" value={data.my_tasks} tint="var(--chart-4)" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Donut */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6" data-testid="shot-status-chart">
          <h2 className="font-head text-lg font-semibold mb-1 text-[var(--text)]">Phân bố trạng thái shot</h2>
          <p className="text-xs text-[var(--muted-2)] mb-4">{total} shot toàn studio</p>
          {total === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--muted-2)]">Chưa có shot nào.</p>
          ) : (
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={90} paddingAngle={2} stroke="none">
                    {pieData.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-3xl font-bold text-[var(--text)]">{total}</span>
                <span className="text-[11px] text-[var(--muted-2)]">tổng shot</span>
              </div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(data.shot_status).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs" data-testid={`dist-${k}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[k] }} />
                <span className="text-[var(--muted)] flex-1">{SHOT_STATUS[k]?.label}</span>
                <span className="font-mono tabular text-[var(--text)]">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent projects */}
        <div className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-head text-lg font-semibold text-[var(--text)]">Dự án gần đây</h2>
            <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline" data-testid="dash-all-projects"><TrendingUp className="h-3.5 w-3.5" /> Tất cả dự án</Link>
          </div>
          {data.projects.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--muted-2)]">Chưa có dự án.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {data.projects.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} data-testid={`dash-project-${p.code}`}
                  className="group flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)]">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-[var(--panel)]">
                    {p.cover_url ? <img src={p.cover_url} alt="" className="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> : <div className="flex h-full items-center justify-center text-[var(--muted-2)]"><Film className="h-5 w-5" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] text-[var(--muted-2)]">{p.code}</p>
                    <h3 className="font-head font-semibold mt-0.5 truncate text-[var(--text)]">{p.title}</h3>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{p.status || "đang sản xuất"}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
