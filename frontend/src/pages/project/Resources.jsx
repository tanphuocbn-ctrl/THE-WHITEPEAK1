import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import {
  Loader2, User, MapPin, Plus, Trash2, Upload, Boxes, Wand2, LayoutGrid,
  ImageIcon, ExternalLink, Users as UsersIcon, Clapperboard,
} from "lucide-react";
import { toast } from "sonner";

export default function Resources() {
  const { project, projectId, myRole } = useProject();
  const { user } = useAuth();
  const canWrite = can(user, myRole, "structure.write");

  const [chars, setChars] = useState([]);
  const [bgs, setBgs] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mediaUrls, setMediaUrls] = useState({});
  const [aiBusy, setAiBusy] = useState(false);
  const [buildBusy, setBuildBusy] = useState(false);
  const blobCache = useRef({});

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      api.get(`/projects/${projectId}/resources`),
      api.get(`/projects/${projectId}/scenes`),
    ]);
    setChars(r.data.filter((x) => x.kind === "character"));
    setBgs(r.data.filter((x) => x.kind === "background"));
    setScenes(s.data);
  }, [projectId]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const loadMedia = useCallback((mid) => {
    if (!mid || blobCache.current[mid]) return;
    blobCache.current[mid] = true;
    api.get(`/projects/${projectId}/canvas/media/${mid}`, { responseType: "blob" })
      .then((r) => setMediaUrls((p) => ({ ...p, [mid]: URL.createObjectURL(r.data) })))
      .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    [...chars, ...bgs].forEach((x) => x.media_id && loadMedia(x.media_id));
    scenes.forEach((s) => s.design_media_id && loadMedia(s.design_media_id));
  }, [chars, bgs, scenes, loadMedia]);

  const uploadFile = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    const { data } = await api.post(`/projects/${projectId}/canvas/media`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    return data;
  };

  const addResource = async (kind, name) => {
    if (!name.trim()) return;
    try { await api.post(`/projects/${projectId}/resources`, { kind, name: name.trim() }); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const uploadResourceImg = async (rid, file) => {
    if (!file) return;
    try { const d = await uploadFile(file); await api.patch(`/projects/${projectId}/resources/${rid}`, { media_id: d.media_id, media_name: d.filename }); load(); toast.success("Đã tải ảnh"); }
    catch (e) { toast.error(apiError(e)); }
  };
  const delResource = async (rid) => {
    try { await api.delete(`/projects/${projectId}/resources/${rid}`); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  const patchScene = async (scene, changes) => {
    try {
      await api.patch(`/projects/${projectId}/scenes/${scene.id}`, { ...changes, rev: scene.rev });
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const toggleSceneChar = (scene, cid) => {
    const cur = scene.characters || [];
    const next = cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid];
    patchScene(scene, { characters: next });
  };
  const uploadDesign = async (scene, file) => {
    if (!file) return;
    try { const d = await uploadFile(file); await patchScene(scene, { design_media_id: d.media_id }); toast.success("Đã tải ảnh thiết kế"); }
    catch (e) { toast.error(apiError(e)); }
  };

  const runAutoMap = async () => {
    setAiBusy(true);
    try { const { data } = await api.post(`/projects/${projectId}/resources/auto-map`); await load(); toast.success(`AI đã phân bổ: ${data.updated_scenes} scene · ${data.chars_assigned} lượt nhân vật`); }
    catch (e) { toast.error(apiError(e)); } finally { setAiBusy(false); }
  };
  const runBuild = async () => {
    setBuildBusy(true);
    try { const { data } = await api.post(`/projects/${projectId}/canvas/build-scenes`); const c = (data.nodes || []).filter((n) => n.type === "frame" && n.ref_id).length; toast.success(`Đã dựng ${c} khung theo scene vào canvas dự án`); }
    catch (e) { toast.error(apiError(e)); } finally { setBuildBusy(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>;

  return (
    <div className="animate-fade-up space-y-8" data-testid="resources-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="overline flex items-center gap-2"><Boxes className="h-3.5 w-3.5" /> Thư viện tài nguyên</p>
          <h1 className="font-head text-2xl font-extrabold tracking-tight mt-1">Nhân vật · Bối cảnh · Scene design</h1>
          <p className="mt-1 text-sm text-zinc-400">Nhập tài nguyên, để AI phân bổ về từng scene, rồi dựng vào canvas.</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button onClick={runAutoMap} disabled={aiBusy} data-testid="auto-map-btn" variant="outline" className="border-blue-600/40 text-blue-300 hover:bg-blue-600/10">
              {aiBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />} AI tự phân bổ
            </Button>
            <Button onClick={runBuild} disabled={buildBusy} data-testid="build-scenes-btn" className="bg-blue-600 hover:bg-blue-500 text-white">
              {buildBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LayoutGrid className="mr-2 h-4 w-4" />} Dựng canvas theo scene
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ResourceColumn kind="character" title="Nhân vật" icon={User} accent="#f59e0b" items={chars}
          canWrite={canWrite} mediaUrls={mediaUrls} onAdd={(n) => addResource("character", n)}
          onUpload={uploadResourceImg} onDelete={delResource} />
        <ResourceColumn kind="background" title="Bối cảnh" icon={MapPin} accent="#10b981" items={bgs}
          canWrite={canWrite} mediaUrls={mediaUrls} onAdd={(n) => addResource("background", n)}
          onUpload={uploadResourceImg} onDelete={delResource} />
      </div>

      {/* Scene mapping */}
      <div className="rounded-lg border border-zinc-800/80 bg-[#18181b]">
        <div className="border-b border-zinc-800/80 p-4">
          <h3 className="font-head font-semibold flex items-center gap-2"><Clapperboard className="h-4 w-4 text-zinc-500" /> Phân bổ theo Scene ({scenes.length})</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Gán nhân vật, bối cảnh & thiết kế cho từng cảnh. Bấm "Mở canvas" để xem moodboard riêng của cảnh.</p>
        </div>
        {scenes.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">Chưa có scene. Hãy tạo scene ở tab Cấu trúc hoặc nhập kịch bản.</p>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {scenes.map((s) => {
              const sceneChars = (s.characters || []);
              const bg = bgs.find((b) => b.id === s.background_id);
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`scene-row-${s.id}`}>
                  <div className="min-w-[150px] flex-1">
                    <span className="font-mono text-xs text-blue-400">{s.code}</span>
                    <p className="text-sm truncate">{s.title}</p>
                    {s.location && <p className="text-[11px] text-zinc-500 truncate">📍 {s.location}</p>}
                  </div>

                  {/* characters multi-select */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" data-testid={`scene-chars-${s.id}`} disabled={!canWrite} className="h-8 w-44 justify-start border-zinc-800 bg-[#0f0f11] text-zinc-300">
                        <UsersIcon className="mr-1.5 h-3.5 w-3.5 text-amber-400" /> {sceneChars.length ? `${sceneChars.length} nhân vật` : "Chọn nhân vật"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-zinc-900 border-zinc-800 max-h-64 overflow-y-auto">
                      <DropdownMenuLabel>Nhân vật trong cảnh</DropdownMenuLabel>
                      {chars.length === 0 ? <div className="px-2 py-1.5 text-xs text-zinc-500">Chưa có nhân vật</div> : chars.map((c) => (
                        <DropdownMenuCheckboxItem key={c.id} checked={sceneChars.includes(c.id)} onCheckedChange={() => toggleSceneChar(s, c.id)}
                          data-testid={`scene-char-opt-${s.id}-${c.id}`} className="focus:bg-zinc-800">{c.name}</DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* background select */}
                  <Select value={s.background_id || "none"} onValueChange={(v) => patchScene(s, { background_id: v === "none" ? "" : v })} disabled={!canWrite}>
                    <SelectTrigger data-testid={`scene-bg-${s.id}`} className="h-8 w-40 bg-[#0f0f11] border-zinc-800"><SelectValue placeholder="Bối cảnh" /></SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800">
                      <SelectItem value="none">— Không —</SelectItem>
                      {bgs.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {/* design image */}
                  {canWrite && (
                    <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-zinc-700 px-2 text-xs text-zinc-300 hover:border-pink-500/60" data-testid={`scene-design-label-${s.id}`}>
                      {s.design_media_id && mediaUrls[s.design_media_id]
                        ? <img src={mediaUrls[s.design_media_id]} alt="" className="h-5 w-5 rounded object-cover" />
                        : <Upload className="h-3.5 w-3.5 text-pink-400" />}
                      {s.design_media_id ? "Đổi thiết kế" : "Ảnh thiết kế"}
                      <input type="file" accept="image/*" className="hidden" data-testid={`scene-design-input-${s.id}`} onChange={(e) => uploadDesign(s, e.target.files?.[0])} />
                    </label>
                  )}

                  <Link to={`/projects/${projectId}/scenes/${s.id}/canvas`} data-testid={`scene-open-canvas-${s.id}`}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-zinc-800 px-2.5 text-xs text-zinc-200 hover:bg-zinc-700">
                    <ExternalLink className="h-3.5 w-3.5" /> Mở canvas
                  </Link>

                  {/* design note (full row) */}
                  {canWrite && (
                    <Textarea defaultValue={s.design_note || ""} onBlur={(e) => { if ((e.target.value || "") !== (s.design_note || "")) patchScene(s, { design_note: e.target.value }); }}
                      placeholder="Ghi chú thiết kế cho cảnh…" data-testid={`scene-design-note-${s.id}`} rows={1} className="mt-1 w-full bg-[#0f0f11] border-zinc-800 text-sm" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceColumn({ kind, title, icon: Icon, accent, items, canWrite, mediaUrls, onAdd, onUpload, onDelete }) {
  const [name, setName] = useState("");
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-[#18181b]">
      <div className="flex items-center justify-between border-b border-zinc-800/80 p-4">
        <h3 className="font-head font-semibold flex items-center gap-2"><Icon className="h-4 w-4" style={{ color: accent }} /> {title} <span className="text-xs text-zinc-500">({items.length})</span></h3>
      </div>
      {canWrite && (
        <div className="flex gap-2 border-b border-zinc-800/60 p-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAdd(name); setName(""); } }}
            placeholder={`Tên ${title.toLowerCase()}…`} data-testid={`add-${kind}-input`} className="h-9 bg-[#0f0f11] border-zinc-800" />
          <Button onClick={() => { onAdd(name); setName(""); }} data-testid={`add-${kind}-btn`} className="h-9 bg-zinc-800 hover:bg-zinc-700 text-zinc-100"><Plus className="h-4 w-4" /></Button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="p-6 text-sm text-zinc-500">Chưa có {title.toLowerCase()} nào.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {items.map((it) => (
            <div key={it.id} className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-[#0f0f11]" data-testid={`resource-${it.id}`}>
              <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-950">
                {it.media_id && mediaUrls[it.media_id]
                  ? <img src={mediaUrls[it.media_id]} alt={it.name} className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-zinc-700"><ImageIcon className="h-6 w-6" /></div>}
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <span className="truncate text-xs text-zinc-200">{it.name}</span>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    <label className="cursor-pointer text-zinc-500 hover:text-blue-400" title="Tải ảnh" data-testid={`resource-upload-${it.id}`}>
                      <Upload className="h-3.5 w-3.5" />
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(it.id, e.target.files?.[0])} />
                    </label>
                    <button onClick={() => onDelete(it.id)} data-testid={`resource-delete-${it.id}`} className="text-zinc-500 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
