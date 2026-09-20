import { useEffect, useRef, useState, useCallback } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ShotSheet from "@/components/ShotSheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Clapperboard, Film, User, MapPin, Image as ImageIcon, MessageSquare,
  Undo2, Redo2, Save, Camera, Link2, Trash2, Loader2, History, X, Plus, Minus, Boxes, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

const NODE_TYPES = {
  scene: { label: "Scene", icon: Clapperboard, color: "#3b82f6" },
  shot: { label: "Shot", icon: Film, color: "#a855f7" },
  character: { label: "Nhân vật", icon: User, color: "#f59e0b" },
  setting: { label: "Bối cảnh", icon: MapPin, color: "#10b981" },
  media: { label: "Media", icon: ImageIcon, color: "#ec4899" },
  comment: { label: "Ghi chú", icon: MessageSquare, color: "#71717a" },
};

let idc = 0;
const uid = () => `n${Date.now()}${idc++}`;

export default function Canvas() {
  const { project, projectId, myRole } = useProject();
  const { user } = useAuth();
  const canEdit = can(user, myRole, "canvas.write");

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [rev, setRev] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [snapshots, setSnapshots] = useState([]);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapName, setSnapName] = useState("");
  const [scenes, setScenes] = useState([]);
  const [shots, setShots] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openShot, setOpenShot] = useState(null);

  const past = useRef([]);
  const future = useRef([]);
  const wrap = useRef(null);
  const drag = useRef(null);
  const pan = useRef(null);

  const loadSnaps = useCallback(() => {
    api.get(`/projects/${projectId}/canvas/snapshots`).then((r) => setSnapshots(r.data));
  }, [projectId]);

  useEffect(() => {
    api.get(`/projects/${projectId}/canvas`).then((r) => {
      setNodes(r.data.nodes || []); setEdges(r.data.edges || []); setRev(r.data.rev || 0);
    }).finally(() => setLoading(false));
    loadSnaps();
    Promise.all([
      api.get(`/projects/${projectId}/scenes`),
      api.get(`/projects/${projectId}/shots`),
    ]).then(([sc, sh]) => { setScenes(sc.data); setShots(sh.data); }).catch(() => {});
  }, [projectId, loadSnaps]);

  const snapshotState = () => ({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });

  const commit = (nextNodes, nextEdges) => {
    past.current.push(snapshotState());
    if (past.current.length > 50) past.current.shift();
    future.current = [];
    setNodes(nextNodes); setEdges(nextEdges); setDirty(true);
  };

  const undo = () => {
    if (!past.current.length) return;
    future.current.push(snapshotState());
    const prev = past.current.pop();
    setNodes(prev.nodes); setEdges(prev.edges); setDirty(true);
  };
  const redo = () => {
    if (!future.current.length) return;
    past.current.push(snapshotState());
    const nxt = future.current.pop();
    setNodes(nxt.nodes); setEdges(nxt.edges); setDirty(true);
  };

  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel && canEdit) { e.preventDefault(); removeNode(sel); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line
  }, [sel, nodes, edges, canEdit]);

  const addNode = (type) => {
    if (!canEdit) return;
    const rect = wrap.current.getBoundingClientRect();
    const off = (nodes.length % 6) * 34;
    const cx = (-view.tx + rect.width / 2) / view.scale - 90 + off;
    const cy = (-view.ty + rect.height / 2) / view.scale - 45 + off;
    const t = NODE_TYPES[type];
    const n = { id: uid(), type, x: cx, y: cy, w: 180, h: 90, title: t.label + " mới", text: "", color: t.color };
    commit([...nodes, n], edges);
    setSel(n.id);
  };

  const addRefNode = (type, item) => {
    if (!canEdit) return;
    const existing = nodes.find((n) => n.ref_id === item.id && n.type === type);
    if (existing) { setSel(existing.id); setPickerOpen(false); toast.message("Node đã có trên canvas"); return; }
    const rect = wrap.current.getBoundingClientRect();
    const off = (nodes.length % 6) * 34;
    const cx = (-view.tx + rect.width / 2) / view.scale - 90 + off;
    const cy = (-view.ty + rect.height / 2) / view.scale - 45 + off;
    const t = NODE_TYPES[type];
    const n = {
      id: uid(), type, x: cx, y: cy, w: 190, h: 90,
      title: `${item.code} · ${item.title}`, text: "", color: t.color, ref_id: item.id,
    };
    commit([...nodes, n], edges);
    setSel(n.id);
    setPickerOpen(false);
  };

  const removeNode = (nid) => {
    commit(nodes.filter((n) => n.id !== nid), edges.filter((e) => e.source !== nid && e.target !== nid));
    setSel(null);
  };

  const updateNode = (nid, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, ...patch } : n)));
    setDirty(true);
  };

  const onNodeMouseDown = (e, n) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSel(n.id);
    if (connectFrom && connectFrom !== n.id) {
      if (!edges.some((ed) => ed.source === connectFrom && ed.target === n.id)) {
        commit(nodes, [...edges, { id: uid(), source: connectFrom, target: n.id }]);
      }
      setConnectFrom(null);
      return;
    }
    if (!canEdit) return;
    past.current.push(snapshotState());
    future.current = [];
    drag.current = { id: n.id, startX: e.clientX, startY: e.clientY, ox: n.x, oy: n.y };
  };

  const onBgMouseDown = (e) => {
    setSel(null); setConnectFrom(null);
    pan.current = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty };
  };

  const onMouseMove = (e) => {
    if (drag.current) {
      const dx = (e.clientX - drag.current.startX) / view.scale;
      const dy = (e.clientY - drag.current.startY) / view.scale;
      setNodes((ns) => ns.map((n) => (n.id === drag.current.id ? { ...n, x: drag.current.ox + dx, y: drag.current.oy + dy } : n)));
    } else if (pan.current) {
      setView((v) => ({ ...v, tx: pan.current.tx + (e.clientX - pan.current.startX), ty: pan.current.ty + (e.clientY - pan.current.startY) }));
    }
  };

  const onMouseUp = () => {
    if (drag.current) { drag.current = null; setDirty(true); }
    pan.current = null;
  };

  const onWheel = (e) => {
    const rect = wrap.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = -e.deltaY * 0.0015;
    setView((v) => {
      const scale = Math.min(2.5, Math.max(0.3, v.scale * (1 + delta)));
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  };

  const zoomBtn = (f) => setView((v) => ({ ...v, scale: Math.min(2.5, Math.max(0.3, v.scale * f)) }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/projects/${projectId}/canvas`, { nodes, edges, rev });
      setRev(data.rev); setDirty(false);
      toast.success("Đã lưu canvas");
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  const createSnapshot = async () => {
    try {
      await api.post(`/projects/${projectId}/canvas/snapshots`, { name: snapName || "Snapshot" });
      toast.success("Đã lưu snapshot"); setSnapName(""); loadSnaps();
    } catch (e) { toast.error(apiError(e)); }
  };

  const restoreSnapshot = async (id) => {
    try {
      const { data } = await api.post(`/projects/${projectId}/canvas/snapshots/${id}/restore`);
      past.current = []; future.current = [];
      setNodes(data.nodes || []); setEdges(data.edges || []); setRev(data.rev); setDirty(false);
      toast.success("Đã khôi phục snapshot"); setSnapOpen(false);
    } catch (e) { toast.error(apiError(e)); }
  };

  const nodeCenter = (n) => ({ x: n.x + (n.w || 180) / 2, y: n.y + (n.h || 90) / 2 });
  const selNode = nodes.find((n) => n.id === sel);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>;

  return (
    <div className="animate-fade-up">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {canEdit && Object.entries(NODE_TYPES).map(([k, t]) => {
          const Icon = t.icon;
          return (
            <Button key={k} size="sm" variant="outline" onClick={() => addNode(k)} data-testid={`add-node-${k}`}
              className="border-zinc-800 bg-[#18181b] text-zinc-200 hover:bg-[#27272a]">
              <Icon className="mr-1.5 h-3.5 w-3.5" style={{ color: t.color }} /> {t.label}
            </Button>
          );
        })}
        {canEdit && (
          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="add-from-project-btn"
                className="border-blue-800 bg-blue-950/40 text-blue-200 hover:bg-blue-900/40">
                <Boxes className="mr-1.5 h-3.5 w-3.5" /> Từ dự án
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#18181b] border-zinc-800">
              <DialogHeader><DialogTitle className="font-head">Thêm node liên kết dữ liệu thật</DialogTitle></DialogHeader>
              <Tabs defaultValue="shots">
                <TabsList className="bg-[#0f0f11] border border-zinc-800">
                  <TabsTrigger value="shots" data-testid="picker-tab-shots">Shots ({shots.length})</TabsTrigger>
                  <TabsTrigger value="scenes" data-testid="picker-tab-scenes">Scenes ({scenes.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="shots" className="mt-3 max-h-72 overflow-y-auto thin-scroll space-y-1.5">
                  {shots.length === 0 ? <p className="text-sm text-zinc-500 py-2">Chưa có shot.</p> : shots.map((s) => (
                    <button key={s.id} onClick={() => addRefNode("shot", s)} data-testid={`pick-shot-${s.code}`}
                      className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-[#0f0f11] p-2.5 text-left hover:border-purple-600 transition-colors">
                      <Film className="h-4 w-4 text-purple-400 shrink-0" />
                      <span className="font-mono text-xs text-purple-300">{s.code}</span>
                      <span className="flex-1 truncate text-sm">{s.title}</span>
                      <Plus className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                  ))}
                </TabsContent>
                <TabsContent value="scenes" className="mt-3 max-h-72 overflow-y-auto thin-scroll space-y-1.5">
                  {scenes.length === 0 ? <p className="text-sm text-zinc-500 py-2">Chưa có scene.</p> : scenes.map((s) => (
                    <button key={s.id} onClick={() => addRefNode("scene", s)} data-testid={`pick-scene-${s.code}`}
                      className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-[#0f0f11] p-2.5 text-left hover:border-blue-600 transition-colors">
                      <Clapperboard className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="font-mono text-xs text-blue-300">{s.code}</span>
                      <span className="flex-1 truncate text-sm">{s.title}</span>
                      <Plus className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                  ))}
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={undo} disabled={!canEdit} data-testid="canvas-undo" className="text-zinc-400"><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={redo} disabled={!canEdit} data-testid="canvas-redo" className="text-zinc-400"><Redo2 className="h-4 w-4" /></Button>
          <div className="mx-1 flex items-center gap-1 rounded-md border border-zinc-800 bg-[#18181b]">
            <Button size="icon" variant="ghost" onClick={() => zoomBtn(0.9)} className="h-8 w-8 text-zinc-400"><Minus className="h-3.5 w-3.5" /></Button>
            <span className="w-12 text-center text-xs tabular text-zinc-400">{Math.round(view.scale * 100)}%</span>
            <Button size="icon" variant="ghost" onClick={() => zoomBtn(1.1)} className="h-8 w-8 text-zinc-400"><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          <Dialog open={snapOpen} onOpenChange={(o) => { setSnapOpen(o); if (o) loadSnaps(); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="canvas-snapshots-btn" className="border-zinc-800 bg-[#18181b] text-zinc-200"><History className="mr-1.5 h-3.5 w-3.5" /> Snapshot</Button>
            </DialogTrigger>
            <DialogContent className="bg-[#18181b] border-zinc-800">
              <DialogHeader><DialogTitle className="font-head">Snapshots canvas</DialogTitle></DialogHeader>
              {canEdit && (
                <div className="flex gap-2">
                  <Input value={snapName} onChange={(e) => setSnapName(e.target.value)} placeholder="Tên snapshot"
                    data-testid="snap-name-input" className="bg-[#0f0f11] border-zinc-800" />
                  <Button onClick={createSnapshot} data-testid="snap-create-btn" className="bg-blue-600 hover:bg-blue-500 text-white"><Camera className="mr-1.5 h-4 w-4" /> Lưu</Button>
                </div>
              )}
              <div className="max-h-72 overflow-y-auto thin-scroll space-y-2">
                {snapshots.length === 0 ? <p className="text-sm text-zinc-500 py-2">Chưa có snapshot.</p> : snapshots.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-[#0f0f11] p-3" data-testid={`snap-${s.id}`}>
                    <Camera className="h-4 w-4 text-zinc-500" />
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate text-sm">{s.name}</p>
                      <p className="text-xs text-zinc-500">{s.node_count} node · {s.created_by_name}</p>
                    </div>
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => restoreSnapshot(s.id)} data-testid={`snap-restore-${s.id}`} className="text-blue-400">Khôi phục</Button>}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          {canEdit && (
            <Button size="sm" onClick={save} disabled={saving || !dirty} data-testid="canvas-save-btn" className="bg-blue-600 hover:bg-blue-500 text-white">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} {dirty ? "Lưu" : "Đã lưu"}
            </Button>
          )}
        </div>
      </div>

      {connectFrom && <div className="mb-2 text-xs text-blue-400" data-testid="connect-hint">Chọn node đích để nối · nhấp nền để hủy</div>}

      {/* Board */}
      <div ref={wrap} onMouseDown={onBgMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}
        data-testid="canvas-board"
        className="relative h-[68vh] overflow-hidden rounded-lg border border-zinc-800/80 bg-[#0d0d0f] cursor-grab active:cursor-grabbing select-none"
        style={{ backgroundImage: "radial-gradient(circle, #1f1f23 1px, transparent 1px)", backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.tx}px ${view.ty}px` }}>
        <div className="absolute top-0 left-0" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
          <svg className="absolute overflow-visible pointer-events-none" style={{ width: 1, height: 1 }}>
            {edges.map((ed) => {
              const s = nodes.find((n) => n.id === ed.source), t = nodes.find((n) => n.id === ed.target);
              if (!s || !t) return null;
              const a = nodeCenter(s), b = nodeCenter(t);
              return <line key={ed.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3f3f46" strokeWidth={2} />;
            })}
          </svg>
          {nodes.map((n) => {
            const t = NODE_TYPES[n.type] || NODE_TYPES.comment;
            const Icon = t.icon;
            return (
              <div key={n.id} onMouseDown={(e) => onNodeMouseDown(e, n)} data-testid={`node-${n.id}`}
                className={`absolute rounded-lg border bg-[#18181b] shadow-lg transition-shadow ${sel === n.id ? "border-blue-500 ring-1 ring-blue-500" : "border-zinc-700"}`}
                style={{ left: n.x, top: n.y, width: n.w || 180, minHeight: n.h || 90, borderLeft: `3px solid ${n.color || t.color}` }}>
                <div className="flex items-center gap-1.5 px-2.5 pt-2">
                  <Icon className="h-3.5 w-3.5" style={{ color: n.color || t.color }} />
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">{t.label}</span>
                  {canEdit && (
                    <button onMouseDown={(e) => { e.stopPropagation(); setConnectFrom(n.id); }} data-testid={`link-${n.id}`}
                      title="Nối tới node khác" className="ml-auto text-zinc-500 hover:text-blue-400"><Link2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
                <div className="px-2.5 pb-2.5 pt-1">
                  <p className="text-sm font-medium text-zinc-100 leading-tight break-words">{n.title}</p>
                  {n.text && <p className="mt-1 text-xs text-zinc-400 break-words whitespace-pre-line">{n.text}</p>}
                  {n.ref_id && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/20">● dữ liệu thật</span>
                      {n.type === "shot" && (
                        <button onMouseDown={(e) => { e.stopPropagation(); setOpenShot(n.ref_id); }}
                          data-testid={`node-open-${n.ref_id}`} className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline">
                          <ExternalLink className="h-3 w-3" /> Mở
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <Clapperboard className="h-10 w-10 text-zinc-700 mb-2" />
            <p className="text-zinc-500 text-sm">{canEdit ? "Thêm node từ thanh công cụ · kéo để di chuyển · cuộn để zoom" : "Chưa có nội dung canvas."}</p>
          </div>
        )}
      </div>

      {/* Inline editor */}
      {selNode && canEdit && (
        <div className="mt-3 rounded-lg border border-zinc-800/80 bg-[#18181b] p-4" data-testid="node-editor">
          <div className="flex items-center justify-between mb-3">
            <span className="overline">Sửa node · {(NODE_TYPES[selNode.type] || {}).label}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => removeNode(selNode.id)} data-testid="node-delete-btn" className="text-red-400"><Trash2 className="mr-1 h-3.5 w-3.5" /> Xóa</Button>
              <Button size="icon" variant="ghost" onClick={() => setSel(null)} className="text-zinc-500"><X className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={selNode.title} onChange={(e) => updateNode(selNode.id, { title: e.target.value })}
              placeholder="Tiêu đề" data-testid="node-title-input" className="bg-[#0f0f11] border-zinc-800" />
            <div className="flex items-center gap-2">
              {["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ec4899", "#71717a"].map((c) => (
                <button key={c} onClick={() => updateNode(selNode.id, { color: c })}
                  className={`h-6 w-6 rounded-full border-2 ${selNode.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <Textarea value={selNode.text} onChange={(e) => updateNode(selNode.id, { text: e.target.value })}
            placeholder="Nội dung / ghi chú" data-testid="node-text-input" className="mt-3 bg-[#0f0f11] border-zinc-800 text-sm" />
        </div>
      )}

      {openShot && (
        <ShotSheet projectId={projectId} shotId={openShot} myRole={myRole} members={project.members || []}
          onClose={() => setOpenShot(null)} onChanged={() => {}} />
      )}
    </div>
  );
}
