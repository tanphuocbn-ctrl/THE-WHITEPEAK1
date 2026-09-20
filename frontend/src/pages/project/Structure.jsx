import { useEffect, useState } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";
import ShotSheet from "@/components/ShotSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Film, Clapperboard, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export default function Structure() {
  const { project, projectId, myRole, reload } = useProject();
  const { user } = useAuth();
  const [sequences, setSequences] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [shots, setShots] = useState([]);
  const [selScene, setSelScene] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [openShot, setOpenShot] = useState(null);

  const canWrite = can(user, myRole, "structure.write");

  const loadStructure = async () => {
    const [sq, sc] = await Promise.all([
      api.get(`/projects/${projectId}/sequences`),
      api.get(`/projects/${projectId}/scenes`),
    ]);
    setSequences(sq.data); setScenes(sc.data);
    const exp = {}; sq.data.forEach((s) => (exp[s.id] = true)); setExpanded(exp);
    setLoading(false);
  };
  useEffect(() => { loadStructure(); /* eslint-disable-next-line */ }, [projectId]);

  const loadShots = async (sceneId) => {
    const { data } = await api.get(`/projects/${projectId}/shots?scene_id=${sceneId}`);
    setShots(data);
  };

  const selectScene = (s) => { setSelScene(s); loadShots(s.id); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 animate-fade-up">
      {/* Tree */}
      <div className="rounded-lg border border-zinc-800/80 bg-[#111113]">
        <div className="flex items-center justify-between border-b border-zinc-800/80 p-3">
          <span className="overline">Cấu trúc</span>
          {canWrite && <NewSequence projectId={projectId} onDone={loadStructure} />}
        </div>
        <div className="p-2 max-h-[70vh] overflow-y-auto thin-scroll">
          {loading ? (
            <div className="p-4"><Loader2 className="h-4 w-4 animate-spin text-zinc-600" /></div>
          ) : sequences.length === 0 ? (
            <p className="p-3 text-sm text-zinc-500">Chưa có sequence. {canWrite && "Tạo sequence để bắt đầu."}</p>
          ) : sequences.map((sq) => {
            const seqScenes = scenes.filter((sc) => sc.sequence_id === sq.id);
            const isOpen = expanded[sq.id];
            return (
              <div key={sq.id} className="mb-1">
                <button onClick={() => setExpanded({ ...expanded, [sq.id]: !isOpen })}
                  data-testid={`seq-${sq.code}`}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-[#1c1c1f] transition-colors">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                  <Film className="h-4 w-4 text-zinc-500" />
                  <span className="truncate">{sq.title}</span>
                </button>
                {isOpen && (
                  <div className="ml-4 border-l border-zinc-800 pl-2">
                    {seqScenes.map((sc) => (
                      <button key={sc.id} onClick={() => selectScene(sc)} data-testid={`scene-${sc.code}`}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${selScene?.id === sc.id ? "bg-[#27272a] text-zinc-100" : "text-zinc-400 hover:bg-[#1c1c1f] hover:text-zinc-200"}`}>
                        <Clapperboard className="h-3.5 w-3.5" />
                        <span className="font-mono text-xs">{sc.code}</span>
                        <span className="truncate">{sc.title}</span>
                      </button>
                    ))}
                    {canWrite && <NewScene projectId={projectId} sequenceId={sq.id} onDone={loadStructure} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scene detail */}
      <div>
        {!selScene ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 text-center">
            <Clapperboard className="h-8 w-8 text-zinc-700 mb-2" />
            <p className="text-zinc-400">Chọn một scene để xem chi tiết và shots.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5">
              <p className="font-mono text-xs text-zinc-500">{selScene.code}</p>
              <h2 className="font-head text-xl font-bold mt-0.5">{selScene.title}</h2>
              <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                <div><span className="overline block mb-1">Bối cảnh</span><span className="text-zinc-300">{selScene.location || "—"}</span></div>
                <div><span className="overline block mb-1">Thời điểm</span><span className="text-zinc-300">{selScene.time_of_day || "—"}</span></div>
              </div>
              {selScene.description && <p className="mt-3 text-sm text-zinc-400 whitespace-pre-line">{selScene.description}</p>}
            </div>

            <div className="rounded-lg border border-zinc-800/80 bg-[#18181b]">
              <div className="flex items-center justify-between border-b border-zinc-800/80 p-4">
                <h3 className="font-head font-semibold">Shots</h3>
                {canWrite && <NewShot projectId={projectId} sceneId={selScene.id} onDone={() => loadShots(selScene.id)} />}
              </div>
              {shots.length === 0 ? (
                <p className="p-6 text-center text-sm text-zinc-500">Chưa có shot trong scene này.</p>
              ) : (
                <div className="divide-y divide-zinc-800/80">
                  {shots.map((sh) => (
                    <button key={sh.id} onClick={() => setOpenShot(sh.id)} data-testid={`shot-row-${sh.code}`}
                      className="flex w-full items-center gap-3 p-4 text-left hover:bg-[#1c1c1f] transition-colors">
                      <span className="font-mono text-sm text-blue-400 w-16">{sh.code}</span>
                      <span className="flex-1 truncate text-sm">{sh.title}</span>
                      <span className="hidden sm:block text-xs text-zinc-500">{sh.assignee_name || "chưa giao"}</span>
                      <span className="hidden sm:block text-xs text-zinc-500 tabular">{fmtDate(sh.deadline)}</span>
                      <StatusPill status={sh.status} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {openShot && (
        <ShotSheet projectId={projectId} shotId={openShot} myRole={myRole} members={project.members || []}
          onClose={() => setOpenShot(null)} onChanged={() => { if (selScene) loadShots(selScene.id); reload(); }} />
      )}
    </div>
  );
}

function DialogForm({ trigger, title, fields, onSubmit, testid }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await onSubmit(vals); setOpen(false); setVals({}); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-[#18181b] border-zinc-800">
        <DialogHeader><DialogTitle className="font-head">{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>{f.label}</Label>
              <Input value={vals[f.key] || ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                placeholder={f.placeholder} data-testid={`${testid}-${f.key}`}
                className={`bg-[#0f0f11] border-zinc-800 ${f.mono ? "font-mono" : ""}`} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="bg-blue-600 hover:bg-blue-500 text-white" data-testid={`${testid}-save`}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NewSequence = ({ projectId, onDone }) => (
  <DialogForm testid="new-seq" title="Tạo Sequence"
    trigger={<Button size="sm" variant="ghost" className="text-blue-400 h-7" data-testid="new-seq-btn"><Plus className="h-4 w-4" /></Button>}
    fields={[{ key: "code", label: "Mã", placeholder: "SEQ-01", mono: true }, { key: "title", label: "Tiêu đề" }]}
    onSubmit={async (v) => { await api.post(`/projects/${projectId}/sequences`, v); toast.success("Đã tạo sequence"); onDone(); }} />
);

const NewScene = ({ projectId, sequenceId, onDone }) => (
  <DialogForm testid="new-scene" title="Tạo Scene"
    trigger={<Button size="sm" variant="ghost" className="text-zinc-500 h-7 w-full justify-start px-2" data-testid="new-scene-btn"><Plus className="h-3.5 w-3.5 mr-1" /> Scene</Button>}
    fields={[{ key: "code", label: "Mã", placeholder: "S1", mono: true }, { key: "title", label: "Tiêu đề" }, { key: "location", label: "Bối cảnh" }, { key: "time_of_day", label: "Thời điểm" }]}
    onSubmit={async (v) => { await api.post(`/projects/${projectId}/scenes`, { ...v, sequence_id: sequenceId }); toast.success("Đã tạo scene"); onDone(); }} />
);

const NewShot = ({ projectId, sceneId, onDone }) => (
  <DialogForm testid="new-shot" title="Tạo Shot"
    trigger={<Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white h-8" data-testid="new-shot-btn"><Plus className="mr-1 h-4 w-4" /> Shot</Button>}
    fields={[{ key: "code", label: "Mã", placeholder: "SH-010", mono: true }, { key: "title", label: "Tiêu đề" }, { key: "shot_type", label: "Loại shot", placeholder: "close-up / wide..." }]}
    onSubmit={async (v) => { await api.post(`/projects/${projectId}/shots`, { ...v, scene_id: sceneId }); toast.success("Đã tạo shot"); onDone(); }} />
);
