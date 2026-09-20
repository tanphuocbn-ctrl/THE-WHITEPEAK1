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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Clapperboard, Film, User, MapPin, Image as ImageIcon, MessageSquare,
  Undo2, Redo2, Save, Camera, Link2, Trash2, Loader2, History, X, Plus, Minus, Boxes, ExternalLink, Download, Upload,
  LayoutGrid, Workflow, Wand2, Maximize2, Lock, Unlock,
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(/\s+/);
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lh; line = w;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}

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
  const [mediaUrls, setMediaUrls] = useState({});
  const [dropActive, setDropActive] = useState(false);
  const [editEdge, setEditEdge] = useState(null);
  const mediaImgs = useRef({});

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
    if (n.locked) return;
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

  useEffect(() => {
    nodes.forEach((n) => {
      if (n.media_id && !mediaUrls[n.media_id]) {
        api.get(`/projects/${projectId}/canvas/media/${n.media_id}`, { responseType: "blob" })
          .then((r) => {
            const url = URL.createObjectURL(r.data);
            const img = new Image(); img.src = url; mediaImgs.current[n.media_id] = img;
            setMediaUrls((prev) => ({ ...prev, [n.media_id]: url }));
          }).catch(() => {});
      }
    });
    // eslint-disable-next-line
  }, [nodes, projectId]);

  const uploadMedia = async (nid, file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post(`/projects/${projectId}/canvas/media`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      updateNode(nid, { media_id: data.media_id, media_name: data.filename });
      commit(nodes.map((n) => (n.id === nid ? { ...n, media_id: data.media_id, media_name: data.filename } : n)), edges);
      toast.success("Đã gắn ảnh vào node Media");
    } catch (e) { toast.error(apiError(e)); }
  };

  const onDragOver = (e) => { if (canEdit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropActive(true); } };
  const onDragLeave = (e) => { if (e.target === wrap.current) setDropActive(false); };
  const onDrop = (e) => {
    e.preventDefault(); setDropActive(false);
    if (!canEdit) return;
    const rect = wrap.current.getBoundingClientRect();
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) { toast.message("Chỉ thả được file ảnh"); return; }
    const created = files.map((f, i) => ({
      node: {
        id: uid(), type: "media", w: 200, h: 130,
        x: (e.clientX - rect.left - view.tx) / view.scale - 100 + i * 28,
        y: (e.clientY - rect.top - view.ty) / view.scale - 65 + i * 28,
        title: (f.name || "Ảnh").slice(0, 40), text: "", color: NODE_TYPES.media.color,
      }, file: f,
    }));
    commit([...nodes, ...created.map((c) => c.node)], edges);
    setSel(created[created.length - 1].node.id);
    created.forEach(async (c) => {
      const fd = new FormData(); fd.append("file", c.file);
      try {
        const { data } = await api.post(`/projects/${projectId}/canvas/media`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        setNodes((ns) => ns.map((x) => (x.id === c.node.id ? { ...x, media_id: data.media_id, media_name: data.filename } : x)));
        setDirty(true);
      } catch (err) { toast.error(apiError(err)); }
    });
    toast.success(`Đã thêm ${files.length} ảnh vào canvas`);
  };

  const autoLayout = (mode) => {
    if (!canEdit || !nodes.length) return;
    const rowGap = 180, colGap = 230;
    const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
    let next = nodes.map((n) => ({ ...n }));
    const set = (id, x, y) => { if (!next[idx[id]].locked) next[idx[id]] = { ...next[idx[id]], x, y }; };
    if (mode === "grid") {
      const movable = next.filter((n) => !n.locked);
      const cols = Math.max(1, Math.ceil(Math.sqrt(movable.length)));
      movable.forEach((n, i) => set(n.id, (i % cols) * colGap + 40, Math.floor(i / cols) * rowGap + 40));
    } else {
      const shotScene = Object.fromEntries(shots.map((s) => [s.id, s.scene_id]));
      const placed = new Set();
      let row = 0;
      next.filter((n) => n.type === "scene").forEach((sn) => {
        set(sn.id, 40, row * rowGap + 40); placed.add(sn.id);
        next.filter((n) => n.type === "shot" && n.ref_id && shotScene[n.ref_id] === sn.ref_id)
          .forEach((k, i) => { set(k.id, 320 + i * colGap, row * rowGap + 40); placed.add(k.id); });
        row++;
      });
      const rest = next.filter((n) => !placed.has(n.id));
      const cols = Math.max(1, Math.ceil(Math.sqrt(rest.length || 1)));
      rest.forEach((n, i) => set(n.id, (i % cols) * colGap + 40, (row + Math.floor(i / cols)) * rowGap + 40));
    }
    commit(next, edges);
    setTimeout(fitView, 30);
    toast.success(mode === "grid" ? "Đã dàn theo lưới" : "Đã dàn theo cây Scene → Shot");
  };

  const setEdgeLabel = (id, label) => commit(nodes, edges.map((e) => (e.id === id ? { ...e, label } : e)));
  const deleteEdge = (id) => { commit(nodes, edges.filter((e) => e.id !== id)); setEditEdge(null); };
  const toggleLock = (id) => commit(nodes.map((n) => (n.id === id ? { ...n, locked: !n.locked } : n)), edges);

  const fitView = () => {
    if (!nodes.length || !wrap.current) return;
    const rects = nodes.map((n) => {
      const el = document.querySelector(`[data-testid="node-${n.id}"]`);
      return { x: n.x, y: n.y, w: el ? el.offsetWidth : (n.w || 180), h: el ? el.offsetHeight : (n.h || 90) };
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach((r) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    const rect = wrap.current.getBoundingClientRect();
    const pad = 60;
    const scale = Math.min(1.5, Math.max(0.3, Math.min((rect.width - pad * 2) / ((maxX - minX) || 1), (rect.height - pad * 2) / ((maxY - minY) || 1))));
    setView({
      scale,
      tx: (rect.width - (maxX - minX) * scale) / 2 - minX * scale,
      ty: (rect.height - (maxY - minY) * scale) / 2 - minY * scale,
    });
  };


  const exportPng = () => {
    if (!nodes.length) { toast.message("Canvas trống, chưa có gì để xuất"); return; }
    const pad = 48;
    const rects = nodes.map((n) => {
      const el = document.querySelector(`[data-testid="node-${n.id}"]`);
      return { n, x: n.x, y: n.y, w: el ? el.offsetWidth : (n.w || 180), h: el ? el.offsetHeight : (n.h || 90) };
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach((r) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    const headerH = 72;
    const W = Math.ceil(maxX - minX) + pad * 2, H = Math.ceil(maxY - minY) + pad * 2 + headerH;
    const s = Math.min(2, 4000 / Math.max(W, H, 1));
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * s); cv.height = Math.round(H * s);
    const ctx = cv.getContext("2d");
    ctx.scale(s, s);
    ctx.fillStyle = "#0d0d0f"; ctx.fillRect(0, 0, W, H);
    // Header band: project title + export date
    ctx.fillStyle = "#111113"; ctx.fillRect(0, 0, W, headerH);
    ctx.strokeStyle = "#27272a"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(W, headerH); ctx.stroke();
    ctx.fillStyle = "#3b82f6"; ctx.fillRect(pad, 22, 4, 30);
    ctx.fillStyle = "#f4f4f5"; ctx.font = "700 20px sans-serif";
    ctx.fillText(`${project.code} · ${project.title}`, pad + 14, 40);
    ctx.fillStyle = "#a1a1aa"; ctx.font = "12px sans-serif";
    const dstr = new Date().toLocaleString("vi-VN");
    ctx.fillText(`Canvas · Xuất ngày ${dstr} · ${nodes.length} node`, pad + 14, 58);
    const ox = pad - minX, oy = pad - minY + headerH;
    ctx.strokeStyle = "#3f3f46"; ctx.lineWidth = 2;
    edges.forEach((e) => {
      const a = rects.find((r) => r.n.id === e.source), b = rects.find((r) => r.n.id === e.target);
      if (!a || !b) return;
      const ax = ox + a.x + a.w / 2, ay = oy + a.y + a.h / 2, bx = ox + b.x + b.w / 2, by = oy + b.y + b.h / 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (e.label) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.font = "10px sans-serif";
        const tw = ctx.measureText(e.label).width;
        ctx.fillStyle = "#111113"; roundRect(ctx, mx - tw / 2 - 6, my - 9, tw + 12, 18, 9); ctx.fill();
        ctx.strokeStyle = "#3f3f46"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#d4d4d8"; ctx.fillText(e.label, mx - tw / 2, my + 3);
        ctx.strokeStyle = "#3f3f46"; ctx.lineWidth = 2;
      }
    });
    rects.forEach(({ n, x, y, w, h }) => {
      const t = NODE_TYPES[n.type] || NODE_TYPES.comment;
      const color = n.color || t.color;
      const nx = ox + x, ny = oy + y;
      roundRect(ctx, nx, ny, w, h, 8); ctx.fillStyle = "#18181b"; ctx.fill();
      ctx.strokeStyle = "#3f3f46"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(nx, ny, 3, h);
      let cy = ny + 18;
      ctx.fillStyle = "#a1a1aa"; ctx.font = "10px sans-serif";
      ctx.fillText(t.label.toUpperCase(), nx + 14, cy); cy += 16;
      ctx.fillStyle = "#f4f4f5"; ctx.font = "600 13px sans-serif";
      cy = wrapText(ctx, n.title || "", nx + 12, cy, w - 24, 17);
      const img = n.media_id && mediaImgs.current[n.media_id];
      if (img && img.complete && img.naturalWidth) {
        const iw = w - 16, ih = Math.min(140, iw * (img.naturalHeight / img.naturalWidth));
        try { ctx.drawImage(img, nx + 8, cy + 2, iw, ih); cy += ih + 8; } catch {}
      }
      if (n.text) { ctx.fillStyle = "#a1a1aa"; ctx.font = "11px sans-serif"; cy = wrapText(ctx, n.text, nx + 12, cy + 2, w - 24, 14); }
    });
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png"); a.download = `canvas-${project.code}-${Date.now()}.png`; a.click();
    toast.success("Đã xuất PNG");
  };

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
          <Button size="icon" variant="ghost" onClick={fitView} title="Thu vừa màn hình" data-testid="canvas-fit-btn" className="text-zinc-400"><Maximize2 className="h-4 w-4" /></Button>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="canvas-arrange-btn" className="border-zinc-800 bg-[#18181b] text-zinc-200 hover:bg-[#27272a]"><Wand2 className="mr-1.5 h-3.5 w-3.5" /> Sắp xếp</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#18181b] border-zinc-800">
                <DropdownMenuItem onClick={() => autoLayout("grid")} data-testid="arrange-grid" className="focus:bg-[#27272a]"><LayoutGrid className="mr-2 h-4 w-4" /> Theo lưới</DropdownMenuItem>
                <DropdownMenuItem onClick={() => autoLayout("tree")} data-testid="arrange-tree" className="focus:bg-[#27272a]"><Workflow className="mr-2 h-4 w-4" /> Theo cây Scene → Shot</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" variant="outline" onClick={exportPng} data-testid="canvas-export-btn" className="border-zinc-800 bg-[#18181b] text-zinc-200 hover:bg-[#27272a]"><Download className="mr-1.5 h-3.5 w-3.5" /> PNG</Button>
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
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        data-testid="canvas-board"
        className={`relative h-[68vh] overflow-hidden rounded-lg border bg-[#0d0d0f] cursor-grab active:cursor-grabbing select-none transition-colors ${dropActive ? "border-pink-500 ring-2 ring-pink-500/40" : "border-zinc-800/80"}`}
        style={{ backgroundImage: "radial-gradient(circle, #1f1f23 1px, transparent 1px)", backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.tx}px ${view.ty}px` }}>
        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-pink-500/5" data-testid="drop-overlay">
            <span className="rounded-lg border border-pink-500/40 bg-[#18181b] px-4 py-2 text-sm text-pink-300"><ImageIcon className="mr-2 inline h-4 w-4" /> Thả ảnh để tạo node Media</span>
          </div>
        )}
        <div className="absolute top-0 left-0" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
          <svg className="absolute overflow-visible pointer-events-none" style={{ width: 1, height: 1 }}>
            {edges.map((ed) => {
              const s = nodes.find((n) => n.id === ed.source), t = nodes.find((n) => n.id === ed.target);
              if (!s || !t) return null;
              const a = nodeCenter(s), b = nodeCenter(t);
              return <line key={ed.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3f3f46" strokeWidth={2} />;
            })}
          </svg>
          {edges.map((ed) => {
            const s = nodes.find((n) => n.id === ed.source), t = nodes.find((n) => n.id === ed.target);
            if (!s || !t) return null;
            if (!ed.label && !canEdit) return null;
            const a = nodeCenter(s), b = nodeCenter(t);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const editing = editEdge?.id === ed.id;
            return (
              <div key={`lbl-${ed.id}`} style={{ left: mx, top: my }} className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
                onMouseDown={(e) => e.stopPropagation()} data-testid={`edge-label-${ed.id}`}>
                {editing ? (
                  <input autoFocus value={editEdge.value}
                    onChange={(e) => setEditEdge({ id: ed.id, value: e.target.value })}
                    onBlur={() => { setEdgeLabel(ed.id, editEdge.value); setEditEdge(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { setEdgeLabel(ed.id, editEdge.value); setEditEdge(null); } if (e.key === "Escape") setEditEdge(null); }}
                    className="w-32 rounded-full border border-blue-500 bg-[#0f0f11] px-2 py-0.5 text-[11px] text-zinc-100 outline-none" />
                ) : (
                  <div className="flex items-center gap-1 rounded-full border border-zinc-700 bg-[#18181b] px-2 py-0.5 text-[10px] text-zinc-300 whitespace-nowrap">
                    <button onClick={() => canEdit && setEditEdge({ id: ed.id, value: ed.label || "" })} data-testid={`edge-edit-${ed.id}`}
                      className={canEdit ? "hover:text-blue-400" : "cursor-default"}>{ed.label || "＋ nhãn"}</button>
                    {canEdit && <button onClick={() => deleteEdge(ed.id)} data-testid={`edge-del-${ed.id}`} className="text-zinc-500 hover:text-red-400"><X className="h-3 w-3" /></button>}
                  </div>
                )}
              </div>
            );
          })}
          {nodes.map((n) => {
            const t = NODE_TYPES[n.type] || NODE_TYPES.comment;
            const Icon = t.icon;
            return (
              <div key={n.id} onMouseDown={(e) => onNodeMouseDown(e, n)} data-testid={`node-${n.id}`}
                className={`absolute rounded-lg border bg-[#18181b] shadow-lg transition-shadow ${sel === n.id ? "border-blue-500 ring-1 ring-blue-500" : n.locked ? "border-amber-600/50" : "border-zinc-700"} ${n.locked ? "cursor-default" : ""}`}
                style={{ left: n.x, top: n.y, width: n.w || 180, minHeight: n.h || 90, borderLeft: `3px solid ${n.color || t.color}` }}>
                <div className="flex items-center gap-1.5 px-2.5 pt-2">
                  <Icon className="h-3.5 w-3.5" style={{ color: n.color || t.color }} />
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">{t.label}</span>
                  {canEdit ? (
                    <div className="ml-auto flex items-center gap-1">
                      <button onMouseDown={(e) => { e.stopPropagation(); toggleLock(n.id); }} data-testid={`lock-${n.id}`}
                        title={n.locked ? "Mở khóa vị trí" : "Khóa vị trí"} className={n.locked ? "text-amber-400" : "text-zinc-500 hover:text-amber-400"}>
                        {n.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                      </button>
                      <button onMouseDown={(e) => { e.stopPropagation(); setConnectFrom(n.id); }} data-testid={`link-${n.id}`}
                        title="Nối tới node khác" className="text-zinc-500 hover:text-blue-400"><Link2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (n.locked && <Lock className="ml-auto h-3.5 w-3.5 text-amber-400" />)}
                </div>
                <div className="px-2.5 pb-2.5 pt-1">
                  <p className="text-sm font-medium text-zinc-100 leading-tight break-words">{n.title}</p>
                  {n.media_id && mediaUrls[n.media_id] && (
                    <img src={mediaUrls[n.media_id]} alt={n.media_name || ""} data-testid={`node-media-${n.id}`}
                      className="mt-1.5 w-full rounded object-cover" style={{ maxHeight: 130 }} draggable={false} />
                  )}
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
          {selNode.type === "media" && (
            <div className="mt-3">
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <Upload className="h-4 w-4 text-pink-400" />
                <span>{selNode.media_id ? "Đổi ảnh" : "Tải ảnh cho node Media"}</span>
                <input type="file" accept="image/*" className="hidden" data-testid="node-media-input"
                  onChange={(e) => uploadMedia(selNode.id, e.target.files?.[0])} />
              </label>
              {selNode.media_name && <p className="mt-1 text-xs text-zinc-500">{selNode.media_name}</p>}
            </div>
          )}
        </div>
      )}

      {openShot && (
        <ShotSheet projectId={projectId} shotId={openShot} myRole={myRole} members={project.members || []}
          onClose={() => setOpenShot(null)} onChanged={() => {}} />
      )}
    </div>
  );
}
