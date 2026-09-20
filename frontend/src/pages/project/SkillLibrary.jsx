import { useEffect, useState } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, BookOpen, Trash2, History, Save } from "lucide-react";
import { toast } from "sonner";

const CATS = { guide: "Hướng dẫn", process: "Quy trình", prompt: "Prompt" };
const CAT_CLS = { guide: "text-blue-300 bg-blue-500/10 border-blue-500/30", process: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", prompt: "text-violet-300 bg-violet-500/10 border-violet-500/30" };

export default function SkillLibrary() {
  const { projectId, myRole } = useProject();
  const { user } = useAuth();
  const canWrite = can(user, myRole, "skill.write");
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");

  const load = () => api.get(`/projects/${projectId}/skills`).then((r) => setSkills(r.data)).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const open = async (s) => {
    const { data } = await api.get(`/projects/${projectId}/skills/${s.id}`);
    setSel(data); setDraft(data.content || ""); setNote("");
  };

  const saveVersion = async () => {
    try {
      await api.post(`/projects/${projectId}/skills/${sel.id}/versions`, { content: draft, note });
      toast.success("Đã lưu phiên bản mới"); const { data } = await api.get(`/projects/${projectId}/skills/${sel.id}`);
      setSel(data); setNote(""); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/projects/${projectId}/skills/${id}`); toast.success("Đã xóa"); setSel(null); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 animate-fade-up">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-3">
          <span className="overline">Thư viện Skill</span>
          {canWrite && <NewSkill projectId={projectId} onDone={load} />}
        </div>
        <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto thin-scroll">
          {skills.length === 0 ? <p className="p-3 text-sm text-[var(--muted-2)]">Chưa có skill nào.</p> : skills.map((s) => (
            <button key={s.id} onClick={() => open(s)} data-testid={`skill-${s.id}`}
              className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${sel?.id === s.id ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel-2)]"}`}>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${CAT_CLS[s.category]}`}>{CATS[s.category]}</span>
                <span className="text-xs text-[var(--muted-2)]">v{s.current_version}</span>
              </div>
              <p className="mt-1 truncate text-sm">{s.title}</p>
            </button>
          ))}
        </div>
      </div>

      {!sel ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted-2)]"><BookOpen className="mr-2 h-5 w-5" /> Chọn một skill để xem và chỉnh sửa.</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between">
              <div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${CAT_CLS[sel.category]}`}>{CATS[sel.category]}</span>
                <h2 className="font-head text-xl font-bold mt-2">{sel.title}</h2>
                {sel.description && <p className="text-sm text-[var(--muted)] mt-1">{sel.description}</p>}
              </div>
              {canWrite && <Button size="sm" variant="ghost" onClick={() => del(sel.id)} className="text-[var(--muted-2)] hover:text-red-400"><Trash2 className="mr-1 h-4 w-4" /> Xóa</Button>}
            </div>
            <div className="mt-4">
              <Label className="text-sm">Nội dung (phiên bản hiện tại v{sel.current_version})</Label>
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} disabled={!canWrite}
                data-testid="skill-content" className="mt-2 bg-[var(--panel-2)] border-[var(--border)] font-mono text-sm" />
              {canWrite && (
                <div className="mt-3 flex gap-2">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú phiên bản (tuỳ chọn)" data-testid="skill-version-note" className="bg-[var(--panel-2)] border-[var(--border)]" />
                  <Button onClick={saveVersion} disabled={draft === sel.content} data-testid="skill-save-version" className="bg-blue-600 hover:bg-blue-500 text-white"><Save className="mr-1.5 h-4 w-4" /> Lưu bản mới</Button>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <p className="overline mb-3 flex items-center gap-2"><History className="h-3.5 w-3.5" /> Lịch sử phiên bản</p>
            <div className="space-y-2">
              {(sel.versions || []).map((v) => (
                <div key={v.id} className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--panel-2)] p-2.5" data-testid={`skill-ver-${v.version_number}`}>
                  <span className="font-mono text-sm text-blue-400">v{v.version_number}</span>
                  <span className="flex-1 truncate text-sm text-[var(--muted)]">{v.note || "—"}</span>
                  <span className="text-xs text-[var(--muted-2)]">{v.created_by_name} · {fmtDate(v.created_at)}</span>
                  {canWrite && <Button size="sm" variant="ghost" onClick={() => { setDraft(v.content); toast.message(`Đã nạp nội dung v${v.version_number} vào ô soạn thảo`); }} className="text-blue-400">Nạp</Button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewSkill({ projectId, onDone }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", category: "guide", content: "", description: "" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/projects/${projectId}/skills`, f); toast.success("Đã tạo skill"); setOpen(false); setF({ title: "", category: "guide", content: "", description: "" }); onDone(); }
    catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" className="text-blue-400 h-7" data-testid="new-skill-btn"><Plus className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)]">
        <DialogHeader><DialogTitle className="font-head">Tạo Skill mới</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2"><Label>Tiêu đề</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="skill-title" className="bg-[var(--panel-2)] border-[var(--border)]" /></div>
          <div className="space-y-2"><Label>Loại</Label>
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
              <SelectTrigger data-testid="skill-cat" className="bg-[var(--panel-2)] border-[var(--border)]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[var(--panel)] border-[var(--border)]">{Object.entries(CATS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Nội dung</Label><Textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={6} data-testid="skill-new-content" className="bg-[var(--panel-2)] border-[var(--border)] font-mono text-sm" /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy || !f.title} data-testid="skill-create" className="bg-blue-600 hover:bg-blue-500 text-white">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Tạo</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
