import { useEffect, useState } from "react";
import { useProject } from "./ProjectLayout";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BOARD_COLUMNS, fmtDate } from "@/lib/constants";
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
            data-testid="board-mine" className={mine ? "bg-blue-600 hover:bg-blue-500 text-white" : "border-zinc-800 text-zinc-300"}>
            <User className="mr-1.5 h-3.5 w-3.5" /> Của tôi
          </Button>
          <Button size="sm" variant={!mine ? "default" : "outline"} onClick={() => setMine(false)}
            data-testid="board-all" className={!mine ? "bg-blue-600 hover:bg-blue-500 text-white" : "border-zinc-800 text-zinc-300"}>
            Tất cả
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {BOARD_COLUMNS.map((col) => {
            const items = shots.filter((s) => s.status === col.key);
            return (
              <div key={col.key} className="rounded-lg border border-zinc-800/80 bg-[#111113]" data-testid={`col-${col.key}`}>
                <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2.5">
                  <span className="text-sm font-medium text-zinc-300">{col.label}</span>
                  <span className="rounded-full bg-zinc-800 px-2 text-xs tabular text-zinc-400">{items.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[120px]">
                  {items.map((s) => (
                    <button key={s.id} onClick={() => setOpenShot(s.id)} data-testid={`card-${s.code}`}
                      className="w-full rounded-md border border-zinc-800/80 bg-[#18181b] p-3 text-left hover:border-zinc-700 transition-colors animate-fade-up">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-blue-400">{s.code}</span>
                        <span className="text-xs text-zinc-600">{s.scene_code}</span>
                      </div>
                      <p className="mt-1 text-sm truncate">{s.title}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                        <span className="truncate">{s.assignee_name || "chưa giao"}</span>
                        <span className="tabular">{fmtDate(s.deadline)}</span>
                      </div>
                    </button>
                  ))}
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
