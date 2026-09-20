import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { API_BASE } from "@/lib/api";
import { SHOT_STATUS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarDays, UploadCloud, CheckCircle2, RotateCcw, Clapperboard, FileDown } from "lucide-react";

const Stat = ({ icon: Icon, label, value, accent }) => (
  <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5" data-testid={`report-stat-${label}`}>
    <div className="flex items-center justify-between"><span className="overline">{label}</span><Icon className={`h-4 w-4 ${accent}`} /></div>
    <div className="mt-3 font-head text-3xl font-extrabold tabular">{value}</div>
  </div>
);

export default function Reports() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/reports/weekly").then((r) => setData(r.data)); }, []);
  if (!data) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>;
  const total = data.totals.shots || 1;

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8 animate-fade-up">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="overline flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" /> Báo cáo tuần</p>
          <h1 className="font-head text-3xl font-extrabold tracking-tight mt-1">Tổng hợp 7 ngày qua</h1>
          <p className="mt-1 text-sm text-zinc-400">Tiến độ sản xuất & hậu kỳ trên toàn studio.</p>
        </div>
        <Button onClick={() => window.open(`${API_BASE}/reports/weekly/pdf`, "_blank")}
          data-testid="report-export-pdf" className="bg-blue-600 hover:bg-blue-500 text-white">
          <FileDown className="mr-2 h-4 w-4" /> Xuất PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={UploadCloud} label="Version nộp" value={data.totals.versions_week} accent="text-blue-400" />
        <Stat icon={CheckCircle2} label="Duyệt Đạt" value={data.totals.approved_week} accent="text-emerald-400" />
        <Stat icon={RotateCcw} label="Trả hàng" value={data.totals.returned_week} accent="text-red-400" />
        <Stat icon={Clapperboard} label="Task hậu kỳ xong" value={data.totals.post_done_week} accent="text-violet-400" />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-800/80 bg-[#18181b] p-5">
        <h2 className="font-head text-lg font-bold mb-4">Phân bố trạng thái shot (toàn studio)</h2>
        <div className="space-y-3">
          {Object.entries(data.shot_status).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-24 text-sm text-zinc-400">{SHOT_STATUS[k]?.label}</span>
              <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${(v / total) * 100}%` }} /></div>
              <span className="w-8 text-right text-sm tabular text-zinc-300">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-800/80 bg-[#18181b]">
        <div className="border-b border-zinc-800/80 p-4"><h2 className="font-head text-lg font-bold">Theo dự án ({data.projects.length})</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800/80">
                <th className="p-3 text-left font-medium">Dự án</th>
                <th className="p-3 text-right font-medium">Tiến độ</th>
                <th className="p-3 text-right font-medium">Chờ duyệt</th>
                <th className="p-3 text-right font-medium">Task HK mở</th>
                <th className="p-3 text-right font-medium">Ngân sách</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-[#1c1c1f]" data-testid={`report-row-${p.code}`}>
                  <td className="p-3"><Link to={`/projects/${p.id}`} className="hover:text-blue-400"><span className="font-mono text-xs text-zinc-500">{p.code}</span> · {p.title}</Link></td>
                  <td className="p-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${p.progress}%` }} /></div>
                      <span className="tabular text-zinc-300">{p.progress}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-right tabular text-amber-300">{p.review}</td>
                  <td className="p-3 text-right tabular text-zinc-300">{p.post_open}</td>
                  <td className="p-3 text-right tabular">
                    {p.budget > 0 ? <span className={p.over ? "text-red-400" : "text-zinc-300"}>{(p.spent).toLocaleString("vi-VN")}/{(p.budget).toLocaleString("vi-VN")}{p.over && " ⚠"}</span> : <span className="text-zinc-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
