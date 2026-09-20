import { useEffect, useState, useRef } from "react";
import api, { apiError, API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate, fmtBytes, SHOT_STATUS } from "@/lib/constants";
import { StatusPill } from "@/components/StatusPill";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Upload, Download, CheckCircle2, XCircle, Plus, Trash2, Clock, FileVideo, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const CHUNK = 5 * 1024 * 1024;

function tcToSeconds(tc) {
  if (!tc) return null;
  const parts = String(tc).trim().split(":").map((p) => parseFloat(p));
  if (parts.some((n) => isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function secondsToTc(s) {
  if (s == null || isNaN(s)) return "00:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function ShotSheet({ projectId, shotId, myRole, members, onClose, onChanged }) {
  const { user } = useAuth();
  const [shot, setShot] = useState(null);
  const [versions, setVersions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [s, v, r] = await Promise.all([
      api.get(`/projects/${projectId}/shots/${shotId}`),
      api.get(`/projects/${projectId}/shots/${shotId}/versions`),
      api.get(`/projects/${projectId}/shots/${shotId}/reviews`),
    ]);
    setShot(s.data); setVersions(v.data); setReviews(r.data);
    setLoading(false);
  };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [shotId]);

  const refreshAll = async () => { await load(); onChanged?.(); };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl bg-[#111113] border-zinc-800 p-0 overflow-y-auto thin-scroll" data-testid="shot-sheet">
        {loading || !shot ? (
          <>
            <SheetHeader className="sr-only"><SheetTitle>Chi tiết shot</SheetTitle></SheetHeader>
            <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
          </>
        ) : (
          <>
            <SheetHeader className="border-b border-zinc-800/80 p-5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-blue-400">{shot.code}</span>
                <StatusPill status={shot.status} />
              </div>
              <SheetTitle className="font-head text-left text-xl">{shot.title}</SheetTitle>
              <p className="text-sm text-zinc-500 text-left">{shot.shot_type || "—"} · Hạn: {fmtDate(shot.deadline)} · Giao cho: {shot.assignee_name || "chưa giao"}</p>
            </SheetHeader>

            <Tabs defaultValue="versions" className="p-5">
              <TabsList className="bg-[#18181b] border border-zinc-800">
                <TabsTrigger value="versions" data-testid="tab-versions">Phiên bản</TabsTrigger>
                <TabsTrigger value="review" data-testid="tab-review">Duyệt</TabsTrigger>
                <TabsTrigger value="assign" data-testid="tab-assign">Phân công</TabsTrigger>
              </TabsList>

              <TabsContent value="versions" className="mt-4">
                <VersionsTab projectId={projectId} shot={shot} versions={versions} myRole={myRole} user={user} onChanged={refreshAll} />
              </TabsContent>
              <TabsContent value="review" className="mt-4">
                <ReviewTab projectId={projectId} shot={shot} versions={versions} reviews={reviews} myRole={myRole} user={user} onChanged={refreshAll} />
              </TabsContent>
              <TabsContent value="assign" className="mt-4">
                <AssignTab projectId={projectId} shot={shot} members={members} myRole={myRole} user={user} onChanged={refreshAll} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function VersionsTab({ projectId, shot, versions, myRole, user, onChanged }) {
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(null);
  const inputRef = useRef();
  const canUpload = can(user, myRole, "version.upload");

  const doUpload = async () => {
    if (!file) return;
    try {
      setProgress(0);
      const { data: sess } = await api.post(`/projects/${projectId}/shots/${shot.id}/versions/init`, {
        filename: file.name, content_type: file.type || "application/octet-stream", total_size: file.size, note,
      });
      const uploadId = sess.upload_id;
      let offset = 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + CHUNK);
        const buf = await chunk.arrayBuffer();
        await api.put(`/projects/${projectId}/uploads/${uploadId}/chunk?offset=${offset}`, buf, {
          headers: { "Content-Type": "application/octet-stream" },
        });
        offset += chunk.size;
        setProgress(Math.round((offset / file.size) * 100));
      }
      await api.post(`/projects/${projectId}/shots/${shot.id}/versions/complete?upload_id=${uploadId}`);
      toast.success("Đã nộp phiên bản mới");
      setFile(null); setNote(""); setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
      onChanged();
    } catch (e) {
      toast.error(apiError(e)); setProgress(null);
    }
  };

  const download = (v) => {
    window.open(`${API_BASE}/projects/${projectId}/versions/${v.id}/download`, "_blank");
  };

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-4">
          <Label className="text-sm">Nộp phiên bản mới (versioning bất biến)</Label>
          <input ref={inputRef} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
            data-testid="version-file-input"
            className="mt-2 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-500" />
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú phiên bản (tuỳ chọn)"
            data-testid="version-note-input" className="mt-2 bg-[#0f0f11] border-zinc-800 text-sm" />
          {progress !== null && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{progress}% (resumable/multipart)</p>
            </div>
          )}
          <Button onClick={doUpload} disabled={!file || progress !== null} data-testid="upload-version-btn"
            className="mt-3 bg-blue-600 hover:bg-blue-500 text-white">
            <Upload className="mr-2 h-4 w-4" /> Nộp phiên bản
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {versions.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4 text-center">Chưa có phiên bản nào được nộp.</p>
        ) : versions.map((v) => (
          <div key={v.id} data-testid={`version-row-${v.version_number}`}
            className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-[#18181b] p-3">
            <FileVideo className="h-5 w-5 text-zinc-500 shrink-0" />
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-zinc-200">v{v.version_number}</span>
                {v.id === shot.approved_version_id && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {v.status === "rejected" && <XCircle className="h-4 w-4 text-red-400" />}
                {v.id === shot.latest_version_id && <span className="text-xs text-blue-400">mới nhất</span>}
              </div>
              <p className="truncate text-xs text-zinc-500">{v.original_filename} · {fmtBytes(v.size)} · {v.uploaded_by_name}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => download(v)} data-testid={`download-v${v.version_number}`}
              className="text-zinc-400 hover:text-zinc-100"><Download className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewTab({ projectId, shot, versions, reviews, myRole, user, onChanged }) {
  const canReview = can(user, myRole, "review.decide");
  const latest = versions.find((v) => v.id === shot.latest_version_id) || versions[0];
  const [comments, setComments] = useState([{ timecode: "", text: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const isVideo = latest && (latest.content_type || "").startsWith("video");

  useEffect(() => {
    let url;
    let active = true;
    if (isVideo) {
      api.get(`/projects/${projectId}/versions/${latest.id}/download`, { responseType: "blob" })
        .then((r) => { if (active) { url = URL.createObjectURL(r.data); setVideoUrl(url); } })
        .catch(() => {});
    }
    return () => { active = false; if (url) URL.revokeObjectURL(url); setVideoUrl(null); };
    // eslint-disable-next-line
  }, [latest?.id]);

  const seekTo = (tc) => {
    const s = tcToSeconds(tc);
    if (s != null && videoRef.current) {
      videoRef.current.currentTime = s;
      videoRef.current.play().catch(() => {});
    }
  };

  const captureTime = (i) => {
    if (!videoRef.current) return;
    const n = [...comments];
    n[i].timecode = secondsToTc(videoRef.current.currentTime);
    setComments(n);
  };

  const decide = async (decision, force = false) => {
    if (!latest) { toast.error("Chưa có phiên bản để duyệt"); return; }
    setBusy(true);
    try {
      const payload = {
        decision, note, shot_rev: shot.rev, force,
        comments: comments.filter((c) => c.text.trim()),
      };
      await api.post(`/projects/${projectId}/shots/${shot.id}/versions/${latest.id}/review`, payload);
      toast.success(decision === "pass" ? "Đã duyệt Đạt" : "Đã trả hàng (Không đạt)");
      setComments([{ timecode: "", text: "" }]); setNote("");
      onChanged();
    } catch (e) {
      const status = e?.response?.status;
      if (status === 409 && !force) {
        if (window.confirm(apiError(e) + "\n\nVẫn tiếp tục duyệt phiên bản này?")) return decide(decision, true);
      } else { toast.error(apiError(e)); }
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {isVideo && (
        <div className="rounded-lg overflow-hidden border border-zinc-800/80 bg-black">
          {videoUrl ? (
            <video ref={videoRef} src={videoUrl} controls className="w-full max-h-72 bg-black" data-testid="review-video" />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-zinc-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang tải video…</div>
          )}
        </div>
      )}
      {canReview && latest ? (
        <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-4">
          <p className="text-sm text-zinc-300 mb-3">Duyệt phiên bản <span className="font-mono text-blue-400">v{latest.version_number}</span></p>
          <Label className="text-xs text-zinc-400">Phản hồi kèm timecode</Label>
          <div className="mt-2 space-y-2">
            {comments.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input value={c.timecode} onChange={(e) => { const n = [...comments]; n[i].timecode = e.target.value; setComments(n); }}
                  placeholder="00:12" data-testid={`tc-time-${i}`} className="w-24 bg-[#0f0f11] border-zinc-800 font-mono text-sm" />
                {isVideo && (
                  <Button type="button" size="icon" variant="ghost" onClick={() => captureTime(i)} title="Lấy thời điểm hiện tại của video"
                    data-testid={`tc-capture-${i}`} className="text-blue-400 shrink-0"><Clock className="h-4 w-4" /></Button>
                )}
                <Input value={c.text} onChange={(e) => { const n = [...comments]; n[i].text = e.target.value; setComments(n); }}
                  placeholder="Ghi chú tại timecode này" data-testid={`tc-text-${i}`} className="flex-1 bg-[#0f0f11] border-zinc-800 text-sm" />
                {comments.length > 1 && (
                  <Button size="icon" variant="ghost" onClick={() => setComments(comments.filter((_, j) => j !== i))}
                    className="text-zinc-500"><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setComments([...comments, { timecode: "", text: "" }])}
            data-testid="add-timecode-btn" className="mt-2 text-blue-400"><Plus className="mr-1 h-3.5 w-3.5" /> Thêm timecode</Button>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nhận xét chung"
            data-testid="review-note-input" className="mt-2 bg-[#0f0f11] border-zinc-800 text-sm" />
          <div className="mt-3 flex gap-2">
            <Button onClick={() => decide("pass")} disabled={busy} data-testid="review-pass-btn"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Đạt
            </Button>
            <Button onClick={() => decide("fail")} disabled={busy} data-testid="review-fail-btn"
              className="flex-1 bg-red-600 hover:bg-red-500 text-white">
              <XCircle className="mr-2 h-4 w-4" /> Không đạt (Trả hàng)
            </Button>
          </div>
        </div>
      ) : !latest ? (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-[#18181b] p-4 text-sm text-zinc-400">
          <AlertTriangle className="h-4 w-4 text-amber-400" /> Chưa có phiên bản nào để duyệt.
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="overline">Lịch sử duyệt</p>
        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-500 py-2">Chưa có lượt duyệt.</p>
        ) : reviews.map((r) => (
          <div key={r.id} data-testid={`review-row-${r.id}`}
            className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-3">
            <div className="flex items-center gap-2">
              {r.decision === "pass"
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : <XCircle className="h-4 w-4 text-red-400" />}
              <span className="text-sm text-zinc-200">{r.decision === "pass" ? "Đạt" : "Không đạt"} · v{r.version_number}</span>
              <span className="ml-auto text-xs text-zinc-500">{r.reviewer_name}</span>
            </div>
            {r.note && <p className="mt-2 text-sm text-zinc-400">{r.note}</p>}
            {r.comments?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {r.comments.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    {isVideo ? (
                      <button onClick={() => seekTo(c.timecode)} data-testid={`seek-${r.id}-${i}`}
                        className="font-mono text-amber-400 hover:underline">{c.timecode || "—"}</button>
                    ) : (
                      <span className="font-mono text-amber-400">{c.timecode || "—"}</span>
                    )}
                    <span className="text-zinc-400">{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssignTab({ projectId, shot, members, myRole, user, onChanged }) {
  const canAssign = can(user, myRole, "assignment.write");
  const [assignee, setAssignee] = useState(shot.assignee_id || "none");
  const [deadline, setDeadline] = useState(shot.deadline ? shot.deadline.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/shots/${shot.id}/assign`, {
        assignee_id: assignee === "none" ? null : assignee,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        rev: shot.rev,
      });
      toast.success("Đã cập nhật phân công");
      onChanged();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  if (!canAssign) {
    return <p className="text-sm text-zinc-500">Bạn không có quyền phân công. Người phụ trách: {shot.assignee_name || "chưa giao"}.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Giao cho</Label>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger data-testid="assignee-select" className="bg-[#18181b] border-zinc-800"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#18181b] border-zinc-800">
            <SelectItem value="none">— Chưa giao —</SelectItem>
            {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name} ({m.role})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-sm">Deadline</Label>
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
          data-testid="deadline-input" className="bg-[#18181b] border-zinc-800" />
      </div>
      <Button onClick={save} disabled={busy} data-testid="save-assign-btn" className="bg-blue-600 hover:bg-blue-500 text-white">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Lưu phân công
      </Button>
    </div>
  );
}
