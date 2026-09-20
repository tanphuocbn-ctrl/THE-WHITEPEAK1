import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarRange, ChevronLeft, ChevronRight, Clapperboard, Film, Users, AlertTriangle } from "lucide-react";

const DAY_NAMES = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const FLAG_CLS = {
  overdue: "border-red-500/50 bg-red-500/15 text-red-200",
  normal: "border-zinc-700/70 bg-[#1c1c1f] text-zinc-300",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

function isoWeekStart(offsetWeeks = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const wd = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - wd + offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}

function fmtDayLabel(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Staffing() {
  const [weekStart, setWeekStart] = useState(() => isoWeekStart(0));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const todayIso = new Date().toISOString().slice(0, 10);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/staffing/calendar?week_start=${weekStart}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [weekStart]);
  useEffect(() => { load(); }, [load]);

  const shift = (n) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + n * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  const days = data?.days || [];
  const people = data?.people || [];
  const rangeLabel = days.length ? `${fmtDayLabel(days[0])} – ${fmtDayLabel(days[6])}` : "";

  return (
    <div className="mx-auto max-w-[1400px] p-6 lg:p-8 animate-fade-up" data-testid="staffing-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="overline flex items-center gap-2"><CalendarRange className="h-3.5 w-3.5" /> Lịch nhân sự</p>
          <h1 className="font-head text-3xl font-extrabold tracking-tight mt-1">Ai đang bận việc gì</h1>
          <p className="mt-1 text-sm text-zinc-400">Điều phối nhân sự theo tuần — shot sản xuất & task hậu kỳ xếp theo deadline.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => shift(-1)} data-testid="staffing-prev" className="border-zinc-800 text-zinc-300"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="rounded-md border border-zinc-800 bg-[#18181b] px-3 py-1.5 text-sm tabular text-zinc-200 min-w-[130px] text-center" data-testid="staffing-range">{rangeLabel}</div>
          <Button size="sm" variant="outline" onClick={() => shift(1)} data-testid="staffing-next" className="border-zinc-800 text-zinc-300"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setWeekStart(isoWeekStart(0))} data-testid="staffing-today" className="border-zinc-800 text-zinc-300">Tuần này</Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1.5"><Film className="h-3.5 w-3.5 text-blue-400" /> Shot sản xuất</span>
        <span className="inline-flex items-center gap-1.5"><Clapperboard className="h-3.5 w-3.5 text-violet-400" /> Task hậu kỳ</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-red-400" /> Quá hạn</span>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
      ) : people.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 text-zinc-500">
          <Users className="h-8 w-8" /><p className="text-sm">Không có việc nào có deadline trong tuần này.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-[#111113] thin-scroll">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80">
                <th className="sticky left-0 z-10 bg-[#111113] p-3 text-left text-xs font-medium text-zinc-500 w-48">Nhân sự</th>
                {days.map((d, i) => (
                  <th key={d} className={`p-3 text-center text-xs font-medium ${d === todayIso ? "text-blue-400" : "text-zinc-500"}`}>
                    <div>{DAY_NAMES[i]}</div>
                    <div className="tabular font-normal text-[11px] text-zinc-600">{fmtDayLabel(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.user_id} className="border-b border-zinc-800/50 last:border-0" data-testid={`staffing-row-${p.user_id}`}>
                  <td className="sticky left-0 z-10 bg-[#111113] p-3 align-top">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-300">{(p.name || "?").slice(0, 2).toUpperCase()}</div>
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-200">{p.name}</div>
                        <div className="text-[11px] text-zinc-500">{p.total} việc</div>
                      </div>
                    </div>
                  </td>
                  {days.map((d) => {
                    const items = p.days[d] || [];
                    return (
                      <td key={d} className={`p-1.5 align-top ${d === todayIso ? "bg-blue-500/[0.04]" : ""}`}>
                        <div className="space-y-1.5 min-h-[40px]">
                          {items.map((it) => (
                            <Link key={it.kind + it.id} to={`/projects/${it.project_id}${it.kind === "post" ? "/post" : "/board"}`}
                              data-testid={`staffing-item-${it.id}`}
                              className={`block rounded-md border px-2 py-1.5 text-[11px] leading-tight transition-colors hover:brightness-125 ${FLAG_CLS[it.flag] || FLAG_CLS.normal}`}>
                              <div className="flex items-center gap-1">
                                {it.kind === "post" ? <Clapperboard className="h-3 w-3 shrink-0 text-violet-400" /> : <Film className="h-3 w-3 shrink-0 text-blue-400" />}
                                <span className="truncate font-medium">{it.label}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-500">
                                <span className="font-mono">{it.project_code}</span>
                                {it.flag === "overdue" && <span className="text-red-400">· quá hạn</span>}
                              </div>
                            </Link>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
