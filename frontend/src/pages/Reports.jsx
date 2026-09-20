import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { API_BASE } from "@/lib/api";
import { SHOT_STATUS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarDays, UploadCloud, CheckCircle2, RotateCcw, Clapperboard, FileDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from "recharts";

const STATUS_COLOR = {
  todo: "var(--chart-6)", in_progress: "var(--chart-1)", review: "var(--chart-3)",
  rejected: "var(--chart-5)", approved: "var(--chart-4)", done: "var(--chart-2)",
};
const tooltipStyle = {
  background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
  color: "var(--text)", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
};
const axisTick = { fill: "var(--muted-2)", fontSize: 11, fontFamily: "JetBrains Mono, monospace" };

const Stat = ({ icon: Icon, label, value, tint }) => (
  <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 transition-transform duration-200 hover:-translate-y-0.5" data-testid={`report-stat-${label}`}>
    <div className="flex items-center justify-between">
      <span className="overline">{label}</span>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${tint} 15%, transparent)` }}><Icon className="h-4 w-4" style={{ color: tint }} /></span>
    </div>
    <div className="mt-3 font-mono text-3xl font-bold tabular text-[var(--text)]">{value}</div>
  </div>
);

export default function Reports() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/reports/weekly").then((r) => setData(r.data)); }, []);
  if (!data) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>;

  const statusData = Object.entries(data.shot_status).map(([k, v]) => ({ name: SHOT_STATUS[k]?.label || k, key: k, value: v }));
  const weekly = [
    { name: "Version", value: data.totals.versions_week, color: "var(--chart-1)" },
    { name: "Duyệt Đạt", value: data.totals.approved_week, color: "var(--chart-4)" },
    { name: "Trả hàng", value: data.totals.returned_week, color: "var(--chart-5)" },
    { name: "HK xong", value: data.totals.post_done_week, color: "var(--chart-2)" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8 animate-fade-up">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="overline flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" /> Báo cáo tuần</p>
          <h1 className="font-head text-3xl font-bold tracking-tight mt-1 text-[var(--text)]">Tổng hợp 7 ngày qua</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Tiến độ sản xuất & hậu kỳ trên toàn studio.</p>
        </div>
        <Button onClick={() => window.open(`${API_BASE}/reports/weekly/pdf`, "_blank")}
          data-testid="report-export-pdf" className="bg-[var(--accent)] hover:opacity-90 text-white">
          <FileDown className="mr-2 h-4 w-4" /> Xuất PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={UploadCloud} label="Version nộp" value={data.totals.versions_week} tint="var(--chart-1)" />
        <Stat icon={CheckCircle2} label="Duyệt Đạt" value={data.totals.approved_week} tint="var(--chart-4)" />
        <Stat icon={RotateCcw} label="Trả hàng" value={data.totals.returned_week} tint="var(--chart-5)" />
        <Stat icon={Clapperboard} label="Task hậu kỳ xong" value={data.totals.post_done_week} tint="var(--chart-2)" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6" data-testid="report-status-chart">
          <h2 className="font-head text-lg font-semibold mb-4 text-[var(--text)]">Phân bố trạng thái shot</h2>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={78} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--panel-2)" }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
                {statusData.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6" data-testid="report-weekly-chart">
          <h2 className="font-head text-lg font-semibold mb-4 text-[var(--text)]">Hoạt động trong tuần</h2>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={weekly} margin={{ left: -10, right: 8 }}>
              <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--panel-2)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                {weekly.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border)] p-4"><h2 className="font-head text-lg font-semibold text-[var(--text)]">Theo dự án ({data.projects.length})</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[var(--muted-2)]">
              <tr className="border-b border-[var(--border)]">
                <th className="p-3 text-left font-medium">Dự án</th>
                <th className="p-3 text-right font-medium">Tiến độ</th>
                <th className="p-3 text-right font-medium">Chờ duyệt</th>
                <th className="p-3 text-right font-medium">Task HK mở</th>
                <th className="p-3 text-right font-medium">Ngân sách</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--panel-2)]" data-testid={`report-row-${p.code}`}>
                  <td className="p-3"><Link to={`/projects/${p.id}`} className="hover:text-[var(--accent)]"><span className="font-mono text-xs text-[var(--muted-2)]">{p.code}</span> · {p.title}</Link></td>
                  <td className="p-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-[var(--panel-2)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p.progress}%`, background: "var(--chart-4)" }} /></div>
                      <span className="font-mono tabular text-[var(--muted)]">{p.progress}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono tabular" style={{ color: "var(--chart-3)" }}>{p.review}</td>
                  <td className="p-3 text-right font-mono tabular text-[var(--muted)]">{p.post_open}</td>
                  <td className="p-3 text-right font-mono tabular">
                    {p.budget > 0 ? <span className={p.over ? "text-red-400" : "text-[var(--muted)]"}>{(p.spent).toLocaleString("vi-VN")}/{(p.budget).toLocaleString("vi-VN")}{p.over && " ⚠"}</span> : <span className="text-[var(--muted-2)]">—</span>}
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
