import { useEffect, useState, useRef } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError, API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate, fmtBytes, deadlineFlag, DEADLINE_CLS, DEADLINE_LABEL } from "@/lib/constants";
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
import {
  Loader2, Film, Plus, Trash2, Download, ExternalLink, Link2, Upload, Star, ListChecks, Users, X,
} from "lucide-react";
import { toast } from "sonner";

const TASK_STATUS = {
  todo: { label: "Chờ làm", cls: "text-[var(--muted)] bg-zinc-500/10 border-zinc-500/30" },
  in_progress: { label: "Đang làm", cls: "text-blue-300 bg-blue-500/10 border-blue-500/30" },
  review: { label: "Chờ duyệt", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  done: { label: "Hoàn tất", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" },
};
const KINDS = [
  { value: "edit", label: "Bản dựng (edit)" },
  { value: "export", label: "Bản xuất (export)" },
  { value: "audio", label: "Âm thanh" },
  { value: "vfx", label: "VFX" },
  { value: "asset", label: "Tài nguyên" },
];

export default function PostProduction() {
  const { project, projectId, myRole } = useProject();
  const { user } = useAuth();
  const canWrite = can(user, myRole, "post.write");
  const [sequences, setSequences] = useState([]);
  const [sel, setSel] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [manifest, setManifest] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [newAssignee, setNewAssignee] = useState("none");
  const [newDeadline, setNewDeadline] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkAssignee, setBulkAssignee] = useState("none");
  const members = project.members || [];

  useEffect(() => {
    api.get(`/projects/${projectId}/sequences`).then((r) => {
      setSequences(r.data);
      if (r.data.length) selectSeq(r.data[0]);
    }).finally(() => setLoading(false));
    // eslint-disable-next-line
  }, [projectId]);

  const loadSeq = async (sid) => {
    const [t, m] = await Promise.all([
      api.get(`/projects/${projectId}/post/tasks?sequence_id=${sid}`),
      api.get(`/projects/${projectId}/post/manifest?sequence_id=${sid}`),
    ]);
    setTasks(t.data); setManifest(m.data); setSelected(new Set());
  };
  const selectSeq = (s) => { setSel(s); loadSeq(s.id); };

  const toggleSel = (id) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected((prev) => prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id)));
  const bulkAssign = async () => {
    try {
      const { data } = await api.post(`/projects/${projectId}/post/tasks/bulk-assign`, {
        task_ids: Array.from(selected),
        assignee_id: bulkAssignee === "none" ? null : bulkAssignee,
      });
      toast.success(`Đã giao ${data.updated} task cho ${data.assignee_name || "— (bỏ giao)"}`);
      setBulkAssignee("none"); loadSeq(sel.id);
    } catch (e) { toast.error(apiError(e)); }
  };

  const addTask = async () => {
    if (!newTask.trim()) return;
    try {
      await api.post(`/projects/${projectId}/post/tasks`, {
        sequence_id: sel.id, title: newTask,
        assignee_id: newAssignee === "none" ? null : newAssignee,
        deadline: newDeadline ? new Date(newDeadline).toISOString() : null,
      });
      setNewTask(""); setNewAssignee("none"); setNewDeadline(""); loadSeq(sel.id); toast.success("Đã thêm task");
    } catch (e) { toast.error(apiError(e)); }
  };
  const patchTask = async (task, patch) => {
    try {
      await api.patch(`/projects/${projectId}/post/tasks/${task.id}`, { ...patch, rev: task.rev });
      loadSeq(sel.id);
    } catch (e) { toast.error(apiError(e)); }
  };
  const setTaskStatus = (task, status) => patchTask(task, { status });
  const delTask = async (id) => {
    try { await api.delete(`/projects/${projectId}/post/tasks/${id}`); loadSeq(sel.id); }
    catch (e) { toast.error(apiError(e)); }
  };
  const delItem = async (id) => {
    try { await api.delete(`/projects/${projectId}/post/manifest/${id}`); loadSeq(sel.id); toast.success("Đã xóa"); }
    catch (e) { toast.error(apiError(e)); }
  };
  const download = (m) => window.open(`${API_BASE}/projects/${projectId}/post/manifest/${m.id}/download`, "_blank");

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 animate-fade-up">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border)] p-3"><span className="overline">Sequence</span></div>
        <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto thin-scroll">
          {sequences.length === 0 ? <p className="p-3 text-sm text-[var(--muted-2)]">Chưa có sequence.</p> : sequences.map((s) => (
            <button key={s.id} onClick={() => selectSeq(s)} data-testid={`post-seq-${s.code}`}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${sel?.id === s.id ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--panel-2)]"}`}>
              <Film className="h-4 w-4 text-[var(--muted-2)]" /><span className="truncate">{s.title}</span>
            </button>
          ))}
        </div>
      </div>

      {!sel ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted-2)]">Chọn một sequence để quản lý hậu kỳ.</div>
      ) : (
        <div className="space-y-6">
          {/* Tasks */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <h3 className="font-head font-semibold flex items-center gap-2"><ListChecks className="h-4 w-4 text-[var(--muted-2)]" /> Task hậu kỳ — {sel.title}</h3>
              {canWrite && tasks.length > 0 && (
                <button onClick={toggleAll} data-testid="post-task-select-all" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
                  {selected.size === tasks.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
              )}
            </div>
            {canWrite && selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 bg-blue-500/[0.06] border-b border-blue-500/20 p-3" data-testid="post-bulk-bar">
                <span className="inline-flex items-center gap-1.5 text-sm text-blue-200"><Users className="h-4 w-4" /> Đã chọn {selected.size} task</span>
                <Select value={bulkAssignee} onValueChange={setBulkAssignee}>
                  <SelectTrigger data-testid="post-bulk-assignee" className="w-48 h-8 bg-[var(--panel-2)] border-[var(--border)]"><SelectValue placeholder="Giao cho…" /></SelectTrigger>
                  <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                    <SelectItem value="none">— Bỏ giao —</SelectItem>
                    {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={bulkAssign} data-testid="post-bulk-apply" className="bg-blue-600 hover:bg-blue-500 text-white h-8">Giao {selected.size} task</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-8 text-[var(--muted)]"><X className="h-4 w-4" /></Button>
              </div>
            )}
            {canWrite && (
              <div className="flex flex-wrap gap-2 p-4 border-b border-[var(--border)]">
                <Input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Tên task (VD: Color grading hồi 1)"
                  onKeyDown={(e) => e.key === "Enter" && addTask()} data-testid="post-task-input" className="flex-1 min-w-[180px] bg-[var(--panel-2)] border-[var(--border)]" />
                <Select value={newAssignee} onValueChange={setNewAssignee}>
                  <SelectTrigger data-testid="post-task-assignee" className="w-44 bg-[var(--panel-2)] border-[var(--border)]"><SelectValue placeholder="Người phụ trách" /></SelectTrigger>
                  <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                    <SelectItem value="none">— Chưa giao —</SelectItem>
                    {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} data-testid="post-task-deadline" className="w-40 bg-[var(--panel-2)] border-[var(--border)]" />
                <Button onClick={addTask} data-testid="post-task-add" className="bg-blue-600 hover:bg-blue-500 text-white"><Plus className="mr-1 h-4 w-4" /> Thêm</Button>
              </div>
            )}
            {tasks.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted-2)]">Chưa có task hậu kỳ.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]/80">
                {tasks.map((t) => {
                  const fl = deadlineFlag(t.deadline, t.status);
                  return (
                  <div key={t.id} className={`flex flex-wrap items-center gap-3 p-4 ${selected.has(t.id) ? "bg-blue-500/[0.05]" : ""}`} data-testid={`post-task-${t.id}`}>
                    {canWrite && (
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)}
                        data-testid={`post-task-check-${t.id}`} className="h-4 w-4 accent-blue-600 cursor-pointer" />
                    )}
                    <span className="flex-1 min-w-[140px] truncate text-sm">{t.title}</span>
                    {fl && <span className={`rounded px-1.5 py-0.5 text-[10px] border ${DEADLINE_CLS[fl]}`} data-testid={`post-task-flag-${t.id}`}>{DEADLINE_LABEL[fl]}</span>}
                    {canWrite ? (
                      <>
                        <Select value={t.assignee_id || "none"} onValueChange={(v) => patchTask(t, { assignee_id: v === "none" ? null : v })}>
                          <SelectTrigger data-testid={`post-task-assignee-${t.id}`} className="w-36 h-8 bg-[var(--panel-2)] border-[var(--border)]"><SelectValue placeholder="Giao cho" /></SelectTrigger>
                          <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                            <SelectItem value="none">— Chưa giao —</SelectItem>
                            {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="date" value={t.deadline ? t.deadline.slice(0, 10) : ""} onChange={(e) => patchTask(t, { deadline: e.target.value ? new Date(e.target.value).toISOString() : null })}
                          data-testid={`post-task-deadline-${t.id}`} className="w-36 h-8 bg-[var(--panel-2)] border-[var(--border)]" />
                        <Select value={t.status} onValueChange={(v) => setTaskStatus(t, v)}>
                          <SelectTrigger data-testid={`post-task-status-${t.id}`} className="w-36 h-8 bg-[var(--panel-2)] border-[var(--border)]"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                            {Object.entries(TASK_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="icon" variant="ghost" onClick={() => delTask(t.id)} className="text-[var(--muted-2)] hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-[var(--muted)]">{t.assignee_name || "chưa giao"}</span>
                        <span className="text-xs text-[var(--muted-2)] tabular">{t.deadline ? fmtDate(t.deadline) : "—"}</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs ${TASK_STATUS[t.status]?.cls}`}>{TASK_STATUS[t.status]?.label}</span>
                      </>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Manifest */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] p-4">
              <h3 className="font-head font-semibold">Manifest — file dựng & bản xuất</h3>
              {canWrite && (
                <div className="flex gap-2">
                  <ExternalDialog projectId={projectId} sequenceId={sel.id} onDone={() => loadSeq(sel.id)} />
                  <UploadDialog projectId={projectId} sequenceId={sel.id} onDone={() => loadSeq(sel.id)} />
                </div>
              )}
            </div>
            {manifest.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted-2)]">Chưa có mục nào. Nhập file dựng ngoại nhập (URL) hoặc tải bản xuất cuối lên.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]/80">
                {manifest.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-4" data-testid={`manifest-${m.id}`}>
                    {m.source_type === "external_url" ? <Link2 className="h-4 w-4 text-blue-400 shrink-0" /> : <Download className="h-4 w-4 text-emerald-400 shrink-0" />}
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm">{m.name}</span>
                        {m.is_final && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 border border-amber-500/20"><Star className="h-3 w-3" /> Bản cuối</span>}
                      </div>
                      <p className="truncate text-xs text-[var(--muted-2)]">{m.kind} · {m.source_type === "upload" ? fmtBytes(m.size) : "liên kết ngoài"} · {m.created_by_name} · {fmtDate(m.created_at)}</p>
                    </div>
                    {m.source_type === "external_url" ? (
                      <a href={m.url} target="_blank" rel="noreferrer" data-testid={`manifest-open-${m.id}`}
                        className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline"><ExternalLink className="h-4 w-4" /> Mở</a>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => download(m)} data-testid={`manifest-dl-${m.id}`} className="text-[var(--muted)] hover:text-white"><Download className="mr-1 h-4 w-4" /> Tải</Button>
                    )}
                    {canWrite && <Button size="icon" variant="ghost" onClick={() => delItem(m.id)} className="text-[var(--muted-2)] hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalDialog({ projectId, sequenceId, onDone }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", url: "", kind: "edit", is_final: false });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/post/manifest/external`, { ...f, sequence_id: sequenceId });
      toast.success("Đã nhập file dựng ngoại nhập"); setOpen(false); setF({ name: "", url: "", kind: "edit", is_final: false }); onDone();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="manifest-external-btn" className="border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]"><Link2 className="mr-1.5 h-3.5 w-3.5" /> Nhập ngoại (URL)</Button></DialogTrigger>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)]">
        <DialogHeader><DialogTitle className="font-head">Nhập file dựng ngoại nhập</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2"><Label>Tên</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="ext-name" className="bg-[var(--panel-2)] border-[var(--border)]" /></div>
          <div className="space-y-2"><Label>URL (S3/Drive/Frame.io...)</Label><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://..." data-testid="ext-url" className="bg-[var(--panel-2)] border-[var(--border)]" /></div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-2"><Label>Loại</Label>
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
                <SelectTrigger data-testid="ext-kind" className="bg-[var(--panel-2)] border-[var(--border)]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[var(--panel)] border-[var(--border)]">{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-end gap-2 pb-2 cursor-pointer"><input type="checkbox" checked={f.is_final} onChange={(e) => setF({ ...f, is_final: e.target.checked })} data-testid="ext-final" /> <span className="text-sm text-[var(--muted)]">Bản cuối</span></label>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy || !f.name || !f.url} data-testid="ext-save" className="bg-blue-600 hover:bg-blue-500 text-white">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Lưu</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ projectId, sequenceId, onDone }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", kind: "export", is_final: true });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const submit = async () => {
    if (!file) { toast.error("Chọn file"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("sequence_id", sequenceId); fd.append("name", f.name || file.name);
      fd.append("kind", f.kind); fd.append("is_final", f.is_final); fd.append("file", file);
      await api.post(`/projects/${projectId}/post/manifest/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Đã tải bản xuất lên"); setOpen(false); setFile(null); setF({ name: "", kind: "export", is_final: true });
      if (ref.current) ref.current.value = ""; onDone();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white" data-testid="manifest-upload-btn"><Upload className="mr-1.5 h-3.5 w-3.5" /> Tải bản xuất</Button></DialogTrigger>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)]">
        <DialogHeader><DialogTitle className="font-head">Tải bản xuất cuối (không encode)</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2"><Label>Tên (mặc định = tên file)</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="up-name" className="bg-[var(--panel-2)] border-[var(--border)]" /></div>
          <input ref={ref} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="up-file"
            className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-500" />
          <div className="flex gap-3">
            <div className="flex-1 space-y-2"><Label>Loại</Label>
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
                <SelectTrigger data-testid="up-kind" className="bg-[var(--panel-2)] border-[var(--border)]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[var(--panel)] border-[var(--border)]">{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-end gap-2 pb-2 cursor-pointer"><input type="checkbox" checked={f.is_final} onChange={(e) => setF({ ...f, is_final: e.target.checked })} data-testid="up-final" /> <span className="text-sm text-[var(--muted)]">Bản cuối</span></label>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy || !file} data-testid="up-save" className="bg-blue-600 hover:bg-blue-500 text-white">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Tải lên</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
