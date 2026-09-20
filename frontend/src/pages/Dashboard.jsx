import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { SHOT_STATUS } from "@/lib/constants";
import { Loader2, FolderKanban, ListChecks, Clock, CheckCircle2 } from "lucide-react";

const Stat = ({ icon: Icon, label, value, accent }) => (
  <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5" data-testid={`stat-${label}`}>
    <div className="flex items-center justify-between">
      <span className="overline">{label}</span>
      <Icon className={`h-4 w-4 ${accent}`} />
    </div>
    <div className="mt-3 font-head text-3xl font-extrabold tabular">{value}</div>
  </div>
);

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => { api.get("/dashboard").then((r) => setData(r.data)); }, []);

  if (!data) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>;

  const total = data.total_shots || 1;

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8 animate-fade-up">
      <div className="mb-8">
        <p className="overline">Bảng điều khiển</p>
        <h1 className="font-head text-3xl font-extrabold tracking-tight mt-1">Xin chào, {user?.name} 👋</h1>
        <p className="mt-1 text-sm text-zinc-400">Tổng quan tiến độ sản xuất trên các dự án của bạn.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={FolderKanban} label="Dự án" value={data.project_count} accent="text-blue-400" />
        <Stat icon={ListChecks} label="Tổng shot" value={data.total_shots} accent="text-zinc-400" />
        <Stat icon={Clock} label="Chờ duyệt" value={data.pending_review} accent="text-amber-400" />
        <Stat icon={CheckCircle2} label="Việc của tôi" value={data.my_tasks} accent="text-emerald-400" />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-800/80 bg-[#18181b] p-5">
        <h2 className="font-head text-lg font-bold mb-4">Phân bố trạng thái shot</h2>
        <div className="space-y-3">
          {Object.entries(data.shot_status).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3" data-testid={`dist-${k}`}>
              <span className="w-24 text-sm text-zinc-400">{SHOT_STATUS[k]?.label}</span>
              <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${(v / total) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-sm tabular text-zinc-300">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="font-head text-lg font-bold mb-4">Dự án gần đây</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} data-testid={`dash-project-${p.code}`}
              className="group rounded-lg border border-zinc-800/80 bg-[#18181b] overflow-hidden hover:border-zinc-700 transition-colors">
              <div className="h-28 bg-zinc-900 overflow-hidden">
                {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />}
              </div>
              <div className="p-4">
                <p className="font-mono text-xs text-zinc-500">{p.code}</p>
                <h3 className="font-head font-semibold mt-1 truncate">{p.title}</h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
