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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Clapperboard, Film, User, MapPin, Image as ImageIcon, MessageSquare, Frame as FrameIcon,
  Undo2, Redo2, Save, Camera, Link2, Trash2, Loader2, History, X, Plus, Minus, Boxes,
  ExternalLink, Download, Upload, LayoutGrid, Workflow, Wand2, Maximize2, Lock, Unlock,
} from "lucide-react";
import { toast } from "sonner";

const NODE_TYPES = {
  frame: { label: "Khung", icon: FrameIcon, color: "#3b82f6" },
  scene: { label: "Scene", icon: Clapperboard, color: "#3b82f6" },
  shot: { label: "Shot", icon: Film, color: "#a855f7" },
  character: { label: "Nhân vật", icon: User, color: "#f59e0b" },
  setting: { label: "Bối cảnh", icon: MapPin, color: "#10b981" },
  media: { label: "Ảnh", icon: ImageIcon, color: "#ec4899" },
  comment: { label: "Ghi chú", icon: MessageSquare, color: "#eab308" },
};
const PALETTE = ["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ec4899", "#ef4444", "#eab308", "#71717a"];
const DEFAULT_SIZE = {
  frame: { w: 480, h: 340 }, scene: { w: 210, h: 96 }, shot: { w: 210, h: 96 },
  character: { w: 190, h: 230 }, setting: { w: 190, h: 230 }, media: { w: 240, h: 170 }, comment: { w: 210, h: 120 },
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
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; }
    else line = test;
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
  const [view, setView] = useState({ tx: 80, ty: 80, scale: 1 });
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
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const mediaImgs = useRef({});

  const past = useRef([]);
  const future = useRef([]);
  const wrap = useRef(null);
  const drag = useRef(null);
  const pan = useRef(null);
  const frameFileRef = useRef(null);

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
      else if (e.key === "Escape") { setConnectFrom(null); setSel(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line
  }, [sel, nodes, edges, canEdit]);

  const centerPos = (type) => {
    const rect = wrap.current.getBoundingClientRect();
    const sz = DEFAULT_SIZE[type] || DEFAULT_SIZE.comment;
    const off = (nodes.length % 6) * 26;
    return {
      x: (-view.tx + rect.width / 2) / view.scale - sz.w / 2 + off,
      y: (-view.ty + rect.height / 2) / view.scale - sz.h / 2 + off,
    };
  };

  const addNode = (type) => {
    if (!canEdit) return;
    const { x, y } = centerPos(type);
    const t = NODE_TYPES[type];
    const sz = DEFAULT_SIZE[type];
    const n = {
      id: uid(), type, x, y, w: sz.w, h: sz.h,
      title: type === "frame" ? "Khung mới" : t.label + " mới", text: "", color: t.color,
      ...(type === "frame" ? { items: [] } : {}),
    };
    commit([...nodes, n], edges);
    setSel(n.id);
  };

  const addRefNode = (type, item) => {
    if (!canEdit) return;
    const existing = nodes.find((n) => n.ref_id === item.id && n.type === type);
    if (existing) { setSel(existing.id); setPickerOpen(false); toast.message("Node đã có trên canvas"); return; }
    const { x, y } = centerPos(type);
    const t = NODE_TYPES[type];
    const sz = DEFAULT_SIZE[type];
    const n = { id: uid(), type, x, y, w: sz.w, h: sz.h, title: `${item.code} · ${item.title}`, text: "", color: t.color, ref_id: item.id };
    commit([...nodes, n], edges);
    setSel(n.id); setPickerOpen(false);
  };

  const removeNode = (nid) => {
    commit(nodes.filter((n) => n.id !== nid), edges.filter((e) => e.source !== nid && e.target !== nid));
    setSel(null);
  };
  const updateNode = (nid, patch) => { setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, ...patch } : n))); setDirty(true); };

  const onNodeMouseDown = (e, n) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSel(n.id);
    if (connectFrom && connectFrom !== n.id) {
      if (!edges.some((ed) => ed.source === connectFrom && ed.target === n.id)) {
        commit(nodes, [...edges, { id: uid(), source: connectFrom, target: n.id, label: "" }]);
      }
      setConnectFrom(null);
      return;
    }
    if (!canEdit || n.locked) return;
    past.current.push(snapshotState()); future.current = [];
    drag.current = { id: n.id, startX: e.clientX, startY: e.clientY, ox: n.x, oy: n.y, moved: false };
  };
  const onBgMouseDown = (e) => {
    setSel(null); setConnectFrom(null);
    pan.current = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onMouseMove = (e) => {
    if (drag.current) {
      const dx = (e.clientX - drag.current.startX) / view.scale;
      const dy = (e.clientY - drag.current.startY) / view.scale;
      if (Math.abs(dx) + Math.abs(dy) > 1) drag.current.moved = true;
      setNodes((ns) => ns.map((n) => (n.id === drag.current.id ? { ...n, x: drag.current.ox + dx, y: drag.current.oy + dy } : n)));
    } else if (pan.current) {
      setView((v) => ({ ...v, tx: pan.current.tx + (e.clientX - pan.current.startX), ty: pan.current.ty + (e.clientY - pan.current.startY) }));
    }
  };
  const onMouseUp = () => {
    if (drag.current) { if (!drag.current.moved) past.current.pop(); drag.current = null; setDirty(true); }
    pan.current = null;
  };
  const onWheel = (e) => {
    const rect = wrap.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = -e.deltaY * 0.0016;
    setView((v) => {
      const scale = Math.min(2.5, Math.max(0.2, v.scale * (1 + delta)));
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  };
  const zoomBtn = (f) => setView((v) => ({ ...v, scale: Math.min(2.5, Math.max(0.2, v.scale * f)) }));

  // media loader (nodes + frame items)
  const loadMedia = useCallback((mid) => {
    if (!mid || mediaUrls[mid]) return;
    api.get(`/projects/${projectId}/canvas/media/${mid}`, { responseType: "blob" }).then((r) => {
      const url = URL.createObjectURL(r.data);
      const img = new Image(); img.src = url; mediaImgs.current[mid] = img;
      setMediaUrls((prev) => ({ ...prev, [mid]: url }));
    }).catch(() => {});
    // eslint-disable-next-line
  }, [projectId, mediaUrls]);
  useEffect(() => {
    nodes.forEach((n) => {
      if (n.media_id) loadMedia(n.media_id);
      (n.items || []).forEach((it) => it.media_id && loadMedia(it.media_id));
    });
    // eslint-disable-next-line
  }, [nodes]);

  const uploadFile = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    const { data } = await api.post(`/projects/${projectId}/canvas/media`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    return data;
  };
  const uploadMedia = async (nid, file) => {
    if (!file) return;
    try {
      const data = await uploadFile(file);
      commit(nodes.map((n) => (n.id === nid ? { ...n, media_id: data.media_id, media_name: data.filename } : n)), edges);
      toast.success("Đã gắn ảnh");
    } catch (e) { toast.error(apiError(e)); }
  };
  const addFrameImages = async (nid, files) => {
    const imgs = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploadingFrame(true);
    try {
      const uploaded = [];
      for (const f of imgs) { const d = await uploadFile(f); uploaded.push({ media_id: d.media_id, media_name: d.filename }); }
      setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, items: [...(n.items || []), ...uploaded] } : n)));
      setDirty(true);
      toast.success(`Đã thêm ${uploaded.length} ảnh vào khung`);
    } catch (e) { toast.error(apiError(e)); } finally { setUploadingFrame(false); }
  };
  const removeFrameItem = (nid, idx) => updateNode(nid, { items: (nodes.find((n) => n.id === nid)?.items || []).filter((_, i) => i !== idx) });

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
        id: uid(), type: "media", w: DEFAULT_SIZE.media.w, h: DEFAULT_SIZE.media.h,
        x: (e.clientX - rect.left - view.tx) / view.scale - 120 + i * 26,
        y: (e.clientY - rect.top - view.ty) / view.scale - 85 + i * 26,
        title: (f.name || "Ảnh").slice(0, 40), text: "", color: NODE_TYPES.media.color,
      }, file: f,
    }));
    commit([...nodes, ...created.map((c) => c.node)], edges);
    setSel(created[created.length - 1].node.id);
    created.forEach(async (c) => {
      try { const d = await uploadFile(c.file); setNodes((ns) => ns.map((x) => (x.id === c.node.id ? { ...x, media_id: d.media_id, media_name: d.filename } : x))); setDirty(true); }
      catch (err) { toast.error(apiError(err)); }
    });
    toast.success(`Đã thêm ${files.length} ảnh vào canvas`);
  };

  const autoLayout = (mode) => {
    if (!canEdit || !nodes.length) return;
    const rowGap = 200, colGap = 260;
    const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
    let next = nodes.map((n) => ({ ...n }));
    const set = (id, x, y) => { if (!next[idx[id]].locked) next[idx[id]] = { ...next[idx[id]], x, y }; };
    if (mode === "grid") {
      const movable = next.filter((n) => !n.locked);
      const cols = Math.max(1, Math.ceil(Math.sqrt(movable.length)));
      movable.forEach((n, i) => set(n.id, (i % cols) * colGap + 40, Math.floor(i / cols) * rowGap + 40));
    } else {
      const shotScene = Object.fromEntries(shots.map((s) => [s.id, s.scene_id]));
      const placed = new Set(); let row = 0;
      next.filter((n) => n.type === "scene").forEach((sn) => {
        set(sn.id, 40, row * rowGap + 40); placed.add(sn.id);
        next.filter((n) => n.type === "shot" && n.ref_id && shotScene[n.ref_id] === sn.ref_id)
          .forEach((k, i) => { set(k.id, 340 + i * colGap, row * rowGap + 40); placed.add(k.id); });
        row++;
      });
      const rest = next.filter((n) => !placed.has(n.id));
      const cols = Math.max(1, Math.ceil(Math.sqrt(rest.length || 1)));
      rest.forEach((n, i) => set(n.id, (i % cols) * colGap + 40, (row + Math.floor(i / cols)) * rowGap + 40));
    }
    commit(next, edges);
    setTimeout(fitView, 40);
    toast.success(mode === "grid" ? "Đã dàn theo lưới" : "Đã dàn theo cây Scene → Shot");
  };

  const setEdgeLabel = (id, label) => commit(nodes, edges.map((e) => (e.id === id ? { ...e, label } : e)));
  const deleteEdge = (id) => { commit(nodes, edges.filter((e) => e.id !== id)); setEditEdge(null); };
  const toggleLock = (id) => commit(nodes.map((n) => (n.id === id ? { ...n, locked: !n.locked } : n)), edges);

  const measure = (n) => {
    const el = document.querySelector(`[data-testid="node-${n.id}"]`);
    return { x: n.x, y: n.y, w: el ? el.offsetWidth : (n.w || 180), h: el ? el.offsetHeight : (n.h || 90) };
  };
  const fitView = () => {
    if (!nodes.length || !wrap.current) return;
    const rects = nodes.map(measure);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach((r) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    const rect = wrap.current.getBoundingClientRect();
    const pad = 80;
    const scale = Math.min(1.4, Math.max(0.2, Math.min((rect.width - pad * 2) / ((maxX - minX) || 1), (rect.height - pad * 2) / ((maxY - minY) || 1))));
    setView({ scale, tx: (rect.width - (maxX - minX) * scale) / 2 - minX * scale, ty: (rect.height - (maxY - minY) * scale) / 2 - minY * scale });
  };

  const exportPng = () => {
    if (!nodes.length) { toast.message("Canvas trống, chưa có gì để xuất"); return; }
    const pad = 56;
    const rects = nodes.map((n) => ({ n, ...measure(n) }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach((r) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    const headerH = 76;
    const W = Math.ceil(maxX - minX) + pad * 2, H = Math.ceil(maxY - minY) + pad * 2 + headerH;
    const s = Math.min(2, 4200 / Math.max(W, H, 1));
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * s); cv.height = Math.round(H * s);
    const ctx = cv.getContext("2d"); ctx.scale(s, s);
    ctx.fillStyle = "#09090b"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#18181b"; ctx.fillRect(0, 0, W, headerH);
    ctx.strokeStyle = "#27272a"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(W, headerH); ctx.stroke();
    ctx.fillStyle = "#3b82f6"; ctx.fillRect(pad, 24, 4, 30);
    ctx.fillStyle = "#fafafa"; ctx.font = "700 20px sans-serif";
    ctx.fillText(`${project.code} · ${project.title}`, pad + 14, 42);
    ctx.fillStyle = "#a1a1aa"; ctx.font = "12px sans-serif";
    ctx.fillText(`Canvas · Xuất ${new Date().toLocaleString("vi-VN")} · ${nodes.length} node`, pad + 14, 60);
    const ox = pad - minX, oy = pad - minY + headerH;
    ctx.strokeStyle = "#52525b"; ctx.lineWidth = 2;
    edges.forEach((e) => {
      const a = rects.find((r) => r.n.id === e.source), b = rects.find((r) => r.n.id === e.target);
      if (!a || !b) return;
      const ax = ox + a.x + a.w / 2, ay = oy + a.y + a.h / 2, bx = ox + b.x + b.w / 2, by = oy + b.y + b.h / 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo((ax + bx) / 2, ay, (ax + bx) / 2, by, bx, by); ctx.stroke();
      if (e.label) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2; ctx.font = "10px sans-serif";
        const tw = ctx.measureText(e.label).width;
        ctx.fillStyle = "#18181b"; roundRect(ctx, mx - tw / 2 - 6, my - 9, tw + 12, 18, 9); ctx.fill();
        ctx.strokeStyle = "#3f3f46"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#d4d4d8"; ctx.fillText(e.label, mx - tw / 2, my + 3);
        ctx.strokeStyle = "#52525b"; ctx.lineWidth = 2;
      }
    });
    const drawImg = (mid, dx, dy, dw, dh) => {
      const img = mediaImgs.current[mid];
      if (!img || !img.complete || !img.naturalWidth) { ctx.fillStyle = "#27272a"; roundRect(ctx, dx, dy, dw, dh, 6); ctx.fill(); return; }
      const ar = img.naturalWidth / img.naturalHeight, dar = dw / dh;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (ar > dar) { sw = sh * dar; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / dar; sy = (img.naturalHeight - sh) / 2; }
      ctx.save(); roundRect(ctx, dx, dy, dw, dh, 6); ctx.clip();
      try { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); } catch {}
      ctx.restore();
    };
    rects.forEach(({ n, x, y, w, h }) => {
      const t = NODE_TYPES[n.type] || NODE_TYPES.comment; const color = n.color || t.color;
      const nx = ox + x, ny = oy + y;
      if (n.type === "frame") {
        roundRect(ctx, nx, ny, w, h, 12); ctx.fillStyle = "rgba(24,24,27,0.5)"; ctx.fill();
        ctx.setLineDash([6, 5]); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#fafafa"; ctx.font = "700 14px sans-serif"; ctx.fillText(n.title || "Khung", nx + 14, ny + 24);
        const items = n.items || []; const cols = 3, gap = 8; const iw = (w - 14 * 2 - gap * (cols - 1)) / cols;
        items.forEach((it, i) => { const cx = nx + 14 + (i % cols) * (iw + gap); const cyy = ny + 40 + Math.floor(i / cols) * (iw + gap); drawImg(it.media_id, cx, cyy, iw, iw); });
        return;
      }
      if (n.type === "media") {
        roundRect(ctx, nx, ny, w, h, 10); ctx.fillStyle = "#18181b"; ctx.fill();
        drawImg(n.media_id, nx, ny, w, h);
        ctx.fillStyle = "rgba(9,9,11,0.75)"; ctx.fillRect(nx, ny + h - 22, w, 22);
        ctx.fillStyle = "#e4e4e7"; ctx.font = "600 11px sans-serif"; ctx.fillText((n.title || "").slice(0, 36), nx + 8, ny + h - 8);
        return;
      }
      roundRect(ctx, nx, ny, w, h, 10); ctx.fillStyle = "#18181b"; ctx.fill();
      ctx.strokeStyle = "#3f3f46"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(nx, ny, 3, h);
      let cy = ny + 20; ctx.fillStyle = "#a1a1aa"; ctx.font = "10px sans-serif";
      ctx.fillText(t.label.toUpperCase(), nx + 14, cy); cy += 16;
      if ((n.type === "character" || n.type === "setting") && n.media_id) { drawImg(n.media_id, nx + 10, cy, w - 20, 120); cy += 128; }
      ctx.fillStyle = "#fafafa"; ctx.font = "600 13px sans-serif"; cy = wrapText(ctx, n.title || "", nx + 12, cy, w - 24, 17);
      if (n.text) { ctx.fillStyle = "#a1a1aa"; ctx.font = "11px sans-serif"; cy = wrapText(ctx, n.text, nx + 12, cy + 2, w - 24, 14); }
    });
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png"); a.download = `canvas-${project.code}-${Date.now()}.png`; a.click();
    toast.success("Đã xuất PNG");
  };

  const save = async () => {
    setSaving(true);
    try { const { data } = await api.put(`/projects/${projectId}/canvas`, { nodes, edges, rev }); setRev(data.rev); setDirty(false); toast.success("Đã lưu canvas"); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  const createSnapshot = async () => {
    try { await api.post(`/projects/${projectId}/canvas/snapshots`, { name: snapName || "Snapshot" }); toast.success("Đã lưu snapshot"); setSnapName(""); loadSnaps(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const restoreSnapshot = async (id) => {
    try { const { data } = await api.post(`/projects/${projectId}/canvas/snapshots/${id}/restore`); past.current = []; future.current = []; setNodes(data.nodes || []); setEdges(data.edges || []); setRev(data.rev); setDirty(false); toast.success("Đã khôi phục snapshot"); setSnapOpen(false); }
    catch (e) { toast.error(apiError(e)); }
  };

  const nodeCenter = (n) => ({ x: n.x + (n.w || 180) / 2, y: n.y + (n.h || 90) / 2 });
  const selNode = nodes.find((n) => n.id === sel);
  const frames = nodes.filter((n) => n.type === "frame");
  const others = nodes.filter((n) => n.type !== "frame");

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>;

  const IconBtn = ({ onClick, title, disabled, active, children, testid }) => (
    <button onClick={onClick} disabled={disabled} title={title} data-testid={testid}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 disabled:opacity-30 ${active ? "bg-blue-600 text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white active:scale-95"}`}>
      {children}
    </button>
  );

  return (
    <div className="animate-fade-up -mx-6 -my-6 lg:-mx-8 lg:-my-8">
      {connectFrom && <div className="absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-full border border-blue-500/40 bg-blue-950/70 px-3 py-1 text-xs text-blue-200 backdrop-blur" data-testid="connect-hint">Chọn node đích để nối · nhấp nền để hủy</div>}

      <div ref={wrap} onMouseDown={onBgMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} data-testid="canvas-board"
        className={`relative h-[calc(100vh-9.5rem)] w-full overflow-hidden bg-[#09090b] cursor-grab active:cursor-grabbing select-none transition-colors ${dropActive ? "ring-2 ring-inset ring-pink-500/50" : ""}`}
        style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: `${26 * view.scale}px ${26 * view.scale}px`, backgroundPosition: `${view.tx}px ${view.ty}px` }}>

        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-pink-500/5" data-testid="drop-overlay">
            <span className="rounded-xl border border-pink-500/40 bg-zinc-900/90 px-5 py-2.5 text-sm text-pink-200 backdrop-blur"><ImageIcon className="mr-2 inline h-4 w-4" /> Thả ảnh để tạo node Ảnh</span>
          </div>
        )}

        <div className="absolute top-0 left-0" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
          {/* edges */}
          <svg className="absolute overflow-visible pointer-events-none" style={{ width: 1, height: 1 }}>
            {edges.map((ed) => {
              const s = nodes.find((n) => n.id === ed.source), t = nodes.find((n) => n.id === ed.target);
              if (!s || !t) return null;
              const a = nodeCenter(s), b = nodeCenter(t);
              const d = `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`;
              return <path key={ed.id} d={d} fill="none" stroke="#52525b" strokeWidth={2} />;
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
              <div key={`lbl-${ed.id}`} style={{ left: mx, top: my }} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" onMouseDown={(e) => e.stopPropagation()} data-testid={`edge-label-${ed.id}`}>
                {editing ? (
                  <input autoFocus value={editEdge.value} onChange={(e) => setEditEdge({ id: ed.id, value: e.target.value })}
                    onBlur={() => { setEdgeLabel(ed.id, editEdge.value); setEditEdge(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { setEdgeLabel(ed.id, editEdge.value); setEditEdge(null); } if (e.key === "Escape") setEditEdge(null); }}
                    className="w-32 rounded-full border border-blue-500 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-100 outline-none" />
                ) : (
                  <div className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-300 whitespace-nowrap backdrop-blur">
                    <button onClick={() => canEdit && setEditEdge({ id: ed.id, value: ed.label || "" })} data-testid={`edge-edit-${ed.id}`} className={canEdit ? "hover:text-blue-400" : "cursor-default"}>{ed.label || "＋ nhãn"}</button>
                    {canEdit && <button onClick={() => deleteEdge(ed.id)} data-testid={`edge-del-${ed.id}`} className="text-zinc-500 hover:text-red-400"><X className="h-3 w-3" /></button>}
                  </div>
                )}
              </div>
            );
          })}

          {/* frames first (behind) */}
          {frames.map((n) => (
            <FrameNode key={n.id} n={n} selected={sel === n.id} canEdit={canEdit} mediaUrls={mediaUrls}
              onMouseDown={(e) => onNodeMouseDown(e, n)} onLock={() => toggleLock(n.id)} onLink={() => setConnectFrom(n.id)}
              onAddImages={() => { setSel(n.id); frameFileRef.current?.click(); }} onRemoveItem={(i) => removeFrameItem(n.id, i)} />
          ))}
          {/* other nodes */}
          {others.map((n) => (
            <RegularNode key={n.id} n={n} selected={sel === n.id} canEdit={canEdit} mediaUrls={mediaUrls}
              onMouseDown={(e) => onNodeMouseDown(e, n)} onLock={() => toggleLock(n.id)} onLink={() => setConnectFrom(n.id)}
              onOpenShot={() => setOpenShot(n.ref_id)} />
          ))}
        </div>

        {/* empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <FrameIcon className="h-12 w-12 text-zinc-700 mb-3" />
            <p className="text-zinc-400 text-sm font-medium">Bảng dữ liệu dự án của bạn</p>
            <p className="text-zinc-600 text-xs mt-1">{canEdit ? "Thêm Khung / node từ thanh dưới · kéo ảnh vào để làm moodboard · cuộn để zoom" : "Chưa có nội dung canvas."}</p>
          </div>
        )}

        {/* top-right control cluster */}
        <div className="absolute right-4 top-4 z-40 flex items-center gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <IconBtn onClick={undo} disabled={!canEdit} title="Hoàn tác (Ctrl+Z)" testid="canvas-undo"><Undo2 className="h-4 w-4" /></IconBtn>
          <IconBtn onClick={redo} disabled={!canEdit} title="Làm lại" testid="canvas-redo"><Redo2 className="h-4 w-4" /></IconBtn>
          <div className="mx-0.5 h-6 w-px bg-zinc-800" />
          <IconBtn onClick={() => zoomBtn(0.85)} title="Thu nhỏ" testid="canvas-zoom-out"><Minus className="h-4 w-4" /></IconBtn>
          <span className="w-11 text-center text-xs tabular text-zinc-400" data-testid="canvas-zoom-level">{Math.round(view.scale * 100)}%</span>
          <IconBtn onClick={() => zoomBtn(1.15)} title="Phóng to" testid="canvas-zoom-in"><Plus className="h-4 w-4" /></IconBtn>
          <IconBtn onClick={fitView} title="Vừa màn hình" testid="canvas-fit-btn"><Maximize2 className="h-4 w-4" /></IconBtn>
          <div className="mx-0.5 h-6 w-px bg-zinc-800" />
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconBtn title="Sắp xếp tự động" testid="canvas-arrange-btn"><Wand2 className="h-4 w-4" /></IconBtn></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
                <DropdownMenuItem onClick={() => autoLayout("grid")} data-testid="arrange-grid" className="focus:bg-zinc-800"><LayoutGrid className="mr-2 h-4 w-4" /> Theo lưới</DropdownMenuItem>
                <DropdownMenuItem onClick={() => autoLayout("tree")} data-testid="arrange-tree" className="focus:bg-zinc-800"><Workflow className="mr-2 h-4 w-4" /> Theo cây Scene → Shot</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <IconBtn onClick={exportPng} title="Xuất PNG" testid="canvas-export-btn"><Download className="h-4 w-4" /></IconBtn>
          <Dialog open={snapOpen} onOpenChange={(o) => { setSnapOpen(o); if (o) loadSnaps(); }}>
            <DialogTrigger asChild><IconBtn title="Snapshot" testid="canvas-snapshots-btn"><History className="h-4 w-4" /></IconBtn></DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800">
              <DialogHeader><DialogTitle className="font-head">Snapshots canvas</DialogTitle></DialogHeader>
              {canEdit && (
                <div className="flex gap-2">
                  <Input value={snapName} onChange={(e) => setSnapName(e.target.value)} placeholder="Tên snapshot" data-testid="snap-name-input" className="bg-zinc-950 border-zinc-800" />
                  <Button onClick={createSnapshot} data-testid="snap-create-btn" className="bg-blue-600 hover:bg-blue-500 text-white"><Camera className="mr-1.5 h-4 w-4" /> Lưu</Button>
                </div>
              )}
              <div className="max-h-72 overflow-y-auto thin-scroll space-y-2">
                {snapshots.length === 0 ? <p className="text-sm text-zinc-500 py-2">Chưa có snapshot.</p> : snapshots.map((sp) => (
                  <div key={sp.id} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3" data-testid={`snap-${sp.id}`}>
                    <Camera className="h-4 w-4 text-zinc-500" />
                    <div className="flex-1 overflow-hidden"><p className="truncate text-sm">{sp.name}</p><p className="text-xs text-zinc-500">{sp.node_count} node · {sp.created_by_name}</p></div>
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => restoreSnapshot(sp.id)} data-testid={`snap-restore-${sp.id}`} className="text-blue-400">Khôi phục</Button>}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          {canEdit && (
            <>
              <div className="mx-0.5 h-6 w-px bg-zinc-800" />
              <Button size="sm" onClick={save} disabled={saving || !dirty} data-testid="canvas-save-btn" className="h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} {dirty ? "Lưu" : "Đã lưu"}
              </Button>
            </>
          )}
        </div>

        {/* bottom-center add toolbar */}
        {canEdit && (
          <div className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl" data-testid="canvas-add-toolbar">
            {Object.entries(NODE_TYPES).map(([k, t]) => {
              const Icon = t.icon;
              return (
                <button key={k} onClick={() => addNode(k)} data-testid={`add-node-${k}`} title={`Thêm ${t.label}`}
                  className="group flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-white active:scale-95">
                  <Icon className="h-4 w-4" style={{ color: t.color }} /> <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
            <div className="mx-0.5 h-6 w-px bg-zinc-800" />
            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogTrigger asChild>
                <button data-testid="add-from-project-btn" className="flex items-center gap-1.5 rounded-lg bg-blue-600/90 px-3 py-2 text-xs font-medium text-white transition-all hover:bg-blue-500 active:scale-95"><Boxes className="h-4 w-4" /> <span className="hidden sm:inline">Từ dự án</span></button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800">
                <DialogHeader><DialogTitle className="font-head">Thêm node liên kết dữ liệu thật</DialogTitle></DialogHeader>
                <Tabs defaultValue="shots">
                  <TabsList className="bg-zinc-950 border border-zinc-800">
                    <TabsTrigger value="shots" data-testid="picker-tab-shots">Shots ({shots.length})</TabsTrigger>
                    <TabsTrigger value="scenes" data-testid="picker-tab-scenes">Scenes ({scenes.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="shots" className="mt-3 max-h-72 overflow-y-auto thin-scroll space-y-1.5">
                    {shots.length === 0 ? <p className="text-sm text-zinc-500 py-2">Chưa có shot.</p> : shots.map((s) => (
                      <button key={s.id} onClick={() => addRefNode("shot", s)} data-testid={`pick-shot-${s.code}`} className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-left hover:border-purple-600 transition-colors">
                        <Film className="h-4 w-4 text-purple-400 shrink-0" /><span className="font-mono text-xs text-purple-300">{s.code}</span><span className="flex-1 truncate text-sm">{s.title}</span><Plus className="h-3.5 w-3.5 text-zinc-500" />
                      </button>
                    ))}
                  </TabsContent>
                  <TabsContent value="scenes" className="mt-3 max-h-72 overflow-y-auto thin-scroll space-y-1.5">
                    {scenes.length === 0 ? <p className="text-sm text-zinc-500 py-2">Chưa có scene.</p> : scenes.map((s) => (
                      <button key={s.id} onClick={() => addRefNode("scene", s)} data-testid={`pick-scene-${s.code}`} className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-left hover:border-blue-600 transition-colors">
                        <Clapperboard className="h-4 w-4 text-blue-400 shrink-0" /><span className="font-mono text-xs text-blue-300">{s.code}</span><span className="flex-1 truncate text-sm">{s.title}</span><Plus className="h-3.5 w-3.5 text-zinc-500" />
                      </button>
                    ))}
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* right properties panel */}
        {selNode && canEdit && (
          <div className="absolute right-0 top-0 z-40 h-full w-80 border-l border-zinc-800 bg-zinc-900/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl overflow-y-auto thin-scroll animate-slide-in-right" data-testid="node-editor" onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="overline flex items-center gap-1.5">{(() => { const I = (NODE_TYPES[selNode.type] || NODE_TYPES.comment).icon; return <I className="h-3.5 w-3.5" style={{ color: selNode.color }} />; })()} {(NODE_TYPES[selNode.type] || {}).label}</span>
              <div className="flex gap-1">
                <button onClick={() => toggleLock(selNode.id)} title={selNode.locked ? "Mở khóa" : "Khóa vị trí"} data-testid="node-lock-btn" className={selNode.locked ? "text-amber-400 p-1" : "text-zinc-500 hover:text-amber-400 p-1"}>{selNode.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button>
                <button onClick={() => removeNode(selNode.id)} data-testid="node-delete-btn" className="text-zinc-500 hover:text-red-400 p-1"><Trash2 className="h-4 w-4" /></button>
                <button onClick={() => setSel(null)} className="text-zinc-500 hover:text-zinc-200 p-1"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <label className="text-xs text-zinc-500">Tiêu đề</label>
            <Input value={selNode.title} onChange={(e) => updateNode(selNode.id, { title: e.target.value })} placeholder="Tiêu đề" data-testid="node-title-input" className="mt-1 bg-zinc-950 border-zinc-800" />
            <label className="mt-4 block text-xs text-zinc-500">Màu</label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {PALETTE.map((c) => (
                <button key={c} onClick={() => updateNode(selNode.id, { color: c })} data-testid={`node-color-${c}`}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${selNode.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
              ))}
            </div>
            {selNode.type !== "frame" && (
              <>
                <label className="mt-4 block text-xs text-zinc-500">Nội dung / ghi chú</label>
                <Textarea value={selNode.text} onChange={(e) => updateNode(selNode.id, { text: e.target.value })} placeholder="Mô tả, tag (VD: INT. DAY)…" data-testid="node-text-input" className="mt-1 bg-zinc-950 border-zinc-800 text-sm" rows={4} />
              </>
            )}
            {(selNode.type === "media" || selNode.type === "character" || selNode.type === "setting") && (
              <div className="mt-4">
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer rounded-lg border border-dashed border-zinc-700 p-3 hover:border-pink-500/60 transition-colors">
                  <Upload className="h-4 w-4 text-pink-400" /><span>{selNode.media_id ? "Đổi ảnh" : "Tải ảnh lên"}</span>
                  <input type="file" accept="image/*" className="hidden" data-testid="node-media-input" onChange={(e) => uploadMedia(selNode.id, e.target.files?.[0])} />
                </label>
                {selNode.media_name && <p className="mt-1 text-xs text-zinc-500 truncate">{selNode.media_name}</p>}
              </div>
            )}
            {selNode.type === "frame" && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2"><label className="text-xs text-zinc-500">Ảnh trong khung ({(selNode.items || []).length})</label>
                  <button onClick={() => frameFileRef.current?.click()} data-testid="frame-add-images-btn" className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500">{uploadingFrame ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Thêm ảnh</button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(selNode.items || []).map((it, i) => (
                    <div key={i} className="group relative aspect-square overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                      {mediaUrls[it.media_id] ? <img src={mediaUrls[it.media_id]} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Loader2 className="h-3 w-3 animate-spin text-zinc-600" /></div>}
                      <button onClick={() => removeFrameItem(selNode.id, i)} className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 p-0.5 text-red-300 group-hover:block"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-zinc-600">Mẹo: kéo nhiều ảnh cùng lúc để tạo moodboard cho scene.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* hidden multi-file input for frame image upload */}
      <input ref={frameFileRef} type="file" accept="image/*" multiple className="hidden" data-testid="frame-file-input"
        onChange={(e) => { if (selNode?.type === "frame") addFrameImages(selNode.id, e.target.files); e.target.value = ""; }} />

      {openShot && (
        <ShotSheet projectId={projectId} shotId={openShot} myRole={myRole} members={project.members || []} onClose={() => setOpenShot(null)} onChanged={() => {}} />
      )}
    </div>
  );
}

function NodeChrome({ n, canEdit, onLock, onLink }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-2">
      {(() => { const I = (NODE_TYPES[n.type] || NODE_TYPES.comment).icon; return <I className="h-3.5 w-3.5" style={{ color: n.color || (NODE_TYPES[n.type] || {}).color }} />; })()}
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{(NODE_TYPES[n.type] || {}).label}</span>
      {canEdit ? (
        <div className="ml-auto flex items-center gap-1">
          <button onMouseDown={(e) => { e.stopPropagation(); onLock(); }} data-testid={`lock-${n.id}`} title={n.locked ? "Mở khóa" : "Khóa"} className={n.locked ? "text-amber-400" : "text-zinc-500 hover:text-amber-400"}>{n.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
          <button onMouseDown={(e) => { e.stopPropagation(); onLink(); }} data-testid={`link-${n.id}`} title="Nối tới node khác" className="text-zinc-500 hover:text-blue-400"><Link2 className="h-3.5 w-3.5" /></button>
        </div>
      ) : (n.locked && <Lock className="ml-auto h-3.5 w-3.5 text-amber-400" />)}
    </div>
  );
}

function RegularNode({ n, selected, canEdit, mediaUrls, onMouseDown, onLock, onLink, onOpenShot }) {
  const t = NODE_TYPES[n.type] || NODE_TYPES.comment;
  const color = n.color || t.color;
  const base = `group absolute rounded-xl border transition-all duration-150 ${selected ? "border-blue-500 ring-2 ring-blue-500/60" : n.locked ? "border-amber-600/50" : "border-zinc-700 hover:border-zinc-500 hover:-translate-y-0.5"} ${n.locked ? "cursor-default" : ""}`;

  // MEDIA — edge-to-edge image with gradient title scrim
  if (n.type === "media") {
    return (
      <div onMouseDown={onMouseDown} data-testid={`node-${n.id}`} className={`${base} overflow-hidden bg-zinc-900 shadow-xl shadow-black/40`} style={{ left: n.x, top: n.y, width: n.w || 240, height: n.h || 170 }}>
        {n.media_id && mediaUrls[n.media_id] ? (
          <img src={mediaUrls[n.media_id]} alt={n.media_name || ""} data-testid={`node-media-${n.id}`} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-600"><ImageIcon className="h-6 w-6" /><span className="text-[10px]">Chưa có ảnh</span></div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-1.5 pt-6">
          <p className="truncate text-xs font-medium text-zinc-100">{n.title}</p>
        </div>
        {canEdit && (
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button onMouseDown={(e) => { e.stopPropagation(); onLock(); }} data-testid={`lock-${n.id}`} className={`rounded bg-black/60 p-1 ${n.locked ? "text-amber-400" : "text-zinc-300 hover:text-amber-400"}`}>{n.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}</button>
            <button onMouseDown={(e) => { e.stopPropagation(); onLink(); }} data-testid={`link-${n.id}`} className="rounded bg-black/60 p-1 text-zinc-300 hover:text-blue-400"><Link2 className="h-3 w-3" /></button>
          </div>
        )}
        {n.locked && !canEdit && <Lock className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-amber-400" />}
      </div>
    );
  }

  // CHARACTER / SETTING — thumbnail card
  if (n.type === "character" || n.type === "setting") {
    return (
      <div onMouseDown={onMouseDown} data-testid={`node-${n.id}`} className={`${base} overflow-hidden bg-zinc-900 shadow-xl shadow-black/40`} style={{ left: n.x, top: n.y, width: n.w || 190, minHeight: n.h || 230, borderLeft: `3px solid ${color}` }}>
        <NodeChrome n={n} canEdit={canEdit} onLock={onLock} onLink={onLink} />
        <div className="px-2.5 pb-2.5 pt-1">
          <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-zinc-950">
            {n.media_id && mediaUrls[n.media_id] ? <img src={mediaUrls[n.media_id]} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="flex h-full items-center justify-center text-zinc-700">{n.type === "character" ? <User className="h-6 w-6" /> : <MapPin className="h-6 w-6" />}</div>}
          </div>
          <p className="mt-2 text-sm font-medium leading-tight text-zinc-100 break-words">{n.title}</p>
          {n.text && <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-zinc-500 break-words">{n.text}</p>}
        </div>
      </div>
    );
  }

  // COMMENT — sticky note
  if (n.type === "comment") {
    return (
      <div onMouseDown={onMouseDown} data-testid={`node-${n.id}`} className={`${base} bg-yellow-500/10 shadow-xl shadow-black/30`} style={{ left: n.x, top: n.y, width: n.w || 210, minHeight: n.h || 120, borderColor: selected ? undefined : "rgba(234,179,8,0.3)", borderLeft: `3px solid ${color}` }}>
        <NodeChrome n={n} canEdit={canEdit} onLock={onLock} onLink={onLink} />
        <div className="px-2.5 pb-2.5 pt-1">
          <p className="text-sm font-medium text-zinc-100 break-words">{n.title}</p>
          {n.text && <p className="mt-1 whitespace-pre-line text-xs text-zinc-300/90 break-words">{n.text}</p>}
        </div>
      </div>
    );
  }

  // SCENE / SHOT (+ generic)
  return (
    <div onMouseDown={onMouseDown} data-testid={`node-${n.id}`} className={`${base} bg-zinc-900 shadow-xl shadow-black/40`} style={{ left: n.x, top: n.y, width: n.w || 210, minHeight: n.h || 96, borderLeft: `3px solid ${color}` }}>
      <NodeChrome n={n} canEdit={canEdit} onLock={onLock} onLink={onLink} />
      <div className="px-2.5 pb-2.5 pt-1">
        <p className="text-sm font-medium leading-tight text-zinc-100 break-words">{n.title}</p>
        {n.text && <p className="mt-1 text-xs text-zinc-400 break-words whitespace-pre-line">{n.text}</p>}
        {n.ref_id && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">● dữ liệu thật</span>
            {n.type === "shot" && <button onMouseDown={(e) => { e.stopPropagation(); onOpenShot(); }} data-testid={`node-open-${n.ref_id}`} className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline"><ExternalLink className="h-3 w-3" /> Mở</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function FrameNode({ n, selected, canEdit, mediaUrls, onMouseDown, onLock, onLink, onAddImages, onRemoveItem }) {
  const color = n.color || "#3b82f6";
  const items = n.items || [];
  return (
    <div onMouseDown={onMouseDown} data-testid={`node-${n.id}`}
      className={`group absolute rounded-2xl border-2 border-dashed transition-all duration-150 ${selected ? "ring-2 ring-blue-500/50" : ""}`}
      style={{ left: n.x, top: n.y, width: n.w || 480, minHeight: n.h || 340, borderColor: color, background: "rgba(24,24,27,0.45)", backdropFilter: "blur(2px)" }}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <FrameIcon className="h-4 w-4" style={{ color }} />
        <span className="font-head text-sm font-bold text-zinc-100 truncate">{n.title || "Khung"}</span>
        <span className="rounded-full bg-black/30 px-1.5 text-[10px] text-zinc-400">{items.length} ảnh</span>
        {canEdit && (
          <div className="ml-auto flex items-center gap-1.5">
            <button onMouseDown={(e) => { e.stopPropagation(); onAddImages(); }} data-testid={`frame-add-${n.id}`} title="Thêm ảnh" className="text-zinc-400 hover:text-blue-400"><Plus className="h-4 w-4" /></button>
            <button onMouseDown={(e) => { e.stopPropagation(); onLock(); }} data-testid={`lock-${n.id}`} title={n.locked ? "Mở khóa" : "Khóa"} className={n.locked ? "text-amber-400" : "text-zinc-400 hover:text-amber-400"}>{n.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button>
            <button onMouseDown={(e) => { e.stopPropagation(); onLink(); }} data-testid={`link-${n.id}`} title="Nối" className="text-zinc-400 hover:text-blue-400"><Link2 className="h-4 w-4" /></button>
          </div>
        )}
      </div>
      <div className="p-4 pt-3">
        {items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700/70 text-zinc-500">
            <ImageIcon className="h-7 w-7" />
            <p className="text-xs">Kéo ảnh vào đây hoặc bấm ＋ để tạo moodboard</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((it, i) => (
              <div key={i} className="group/it relative aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950" data-testid={`frame-tile-${n.id}-${i}`}>
                {mediaUrls[it.media_id] ? <img src={mediaUrls[it.media_id]} alt={it.media_name || ""} className="h-full w-full object-cover" draggable={false} /> : <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-zinc-600" /></div>}
                {canEdit && <button onMouseDown={(e) => { e.stopPropagation(); onRemoveItem(i); }} className="absolute right-1 top-1 hidden rounded bg-black/70 p-0.5 text-red-300 group-hover/it:block"><X className="h-3 w-3" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
