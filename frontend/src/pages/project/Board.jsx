import { useEffect, useState } from "react";
import { useProject } from "./ProjectLayout";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BOARD_COLUMNS, fmtDate, deadlineFlag, DEADLINE_CLS } from "@/lib/constants";
import ShotSheet from "@/components/ShotSheet";
import { Button } from "@/components/ui/button";
import { Loader2, User } from "lucide-react";

export default function Board() {
  const { project, projectId, myRole, reload } = useProject();
  const { user } = useAuth();
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(false);
  const [openShot, setOpenShot] = useState(null);

  const load = async () => {
    const { data } = await api.get(`/projects/${projectId}/board?mine=${mine}`);
    setShots(data); setLoading(false);
  };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [projectId, mine]);

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-head text-lg font-bold">Bảng phân công</h2>
        <div className="flex gap-2">
          <Button size="sm" variant={mine ? "default" : "outline"} onClick={() => setMine(true)}
            data-testid="board-mine" className={mine ? "bg-blue-600 hover:bg-blue-500 text-white" : "border-[var(--border)] text-[var(--muted)]"}>
            <User className="mr-1.5 h-3.5 w-3.5" /> Của tôi
          </Button>
          <Button size="sm" variant={!mine ? "default" : "outline"} onClick={() => setMine(false)}
            data-testid="board-all" className={!mine ? "bg-blue-600 hover:bg-blue-500 text-white" : "border-[var(--border)] text-[var(--muted)]"}>
            Tất cả
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {BOARD_COLUMNS.map((col) => {
            const items = shots.filter((s) => s.status === col.key);
            return (
              <div key={col.key} className="rounded-lg border border-[var(--border)] bg-[var(--panel)]" data-testid={`col-${col.key}`}>
                <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
                  <span className="text-sm font-medium text-[var(--muted)]">{col.label}</span>
                  <span className="rounded-full bg-[var(--panel-2)] px-2 text-xs tabular text-[var(--muted)]">{items.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[120px]">
                  {items.map((s) => {
                    const fl = deadlineFlag(s.deadline, s.status);
                    return (
                    <button key={s.id} onClick={() => setOpenShot(s.id)} data-testid={`card-${s.code}`}
                      className={`w-full rounded-md border bg-[var(--panel)] p-3 text-left transition-colors animate-fade-up ${fl === "overdue" ? "border-red-500/50 ring-1 ring-red-500/20" : fl === "soon" ? "border-amber-500/40" : "border-[var(--border)] hover:border-[var(--border)]"}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-blue-400">{s.code}</span>
                        <span className="text-xs text-[var(--muted-2)]">{s.scene_code}</span>
                      </div>
                      <p className="mt-1 text-sm truncate">{s.title}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted-2)]">
                        <span className="truncate">{s.assignee_name || "chưa giao"}</span>
                        <span className={`tabular rounded px-1.5 py-0.5 border ${fl ? DEADLINE_CLS[fl] : "border-transparent"}`}>{fmtDate(s.deadline)}</span>
                      </div>
                    </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openShot && (
        <ShotSheet projectId={projectId} shotId={openShot} myRole={myRole} members={project.members || []}
          onClose={() => setOpenShot(null)} onChanged={() => { load(); reload(); }} />
      )}
    </div>
  );
}
