import { useEffect, useState, useRef } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Upload, FileText, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function ScriptImport() {
  const { projectId, myRole } = useProject();
  const { user } = useAuth();
  const [stagings, setStagings] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState(null);
  const fileRef = useRef();
  const canWrite = can(user, myRole, "script.write");

  const loadStagings = () => api.get(`/projects/${projectId}/scripts/stagings`).then((r) => setStagings(r.data));
  useEffect(() => { loadStagings(); /* eslint-disable-next-line */ }, [projectId]);

  const openDiff = async (id) => {
    const { data } = await api.get(`/projects/${projectId}/scripts/stagings/${id}/diff`);
    setDiff(data);
  };

  const submitManual = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/scripts/manual`, { raw_text: text });
      toast.success("Đã tạo bản nhập (staging)");
      setText(""); await loadStagings(); openDiff(data.id);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const submitFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/projects/${projectId}/scripts/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Đã trích xuất & tạo staging");
      if (fileRef.current) fileRef.current.value = "";
      await loadStagings(); openDiff(data.id);
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const confirm = async (stagingId) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/scripts/stagings/${stagingId}/confirm`, {});
      toast.success(`Đã xác nhận: tạo ${data.created_scenes} scene mới`);
      setDiff(null); await loadStagings();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 animate-fade-up">
      <div className="space-y-4">
        {!diff ? (
          canWrite ? (
            <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5">
              <h2 className="font-head text-lg font-bold mb-1">Nhập kịch bản</h2>
              <p className="text-sm text-zinc-400 mb-4">Tải lên DOCX/PDF/TXT hoặc nhập tay. Hệ thống tách scene → staging → diff → xác nhận.</p>
              <Tabs defaultValue="manual">
                <TabsList className="bg-[#0f0f11] border border-zinc-800">
                  <TabsTrigger value="manual" data-testid="script-tab-manual">Nhập tay</TabsTrigger>
                  <TabsTrigger value="upload" data-testid="script-tab-upload">Tải file</TabsTrigger>
                </TabsList>
                <TabsContent value="manual" className="mt-4">
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
                    placeholder={"NỘI. QUÁN CÀ PHÊ - NGÀY\nNhân vật A ngồi chờ...\n\nNGOẠI. ĐƯỜNG PHỐ - ĐÊM\n..."}
                    data-testid="script-manual-input" className="bg-[#0f0f11] border-zinc-800 font-mono text-sm" />
                  <Button onClick={submitManual} disabled={busy || !text.trim()} data-testid="script-manual-submit"
                    className="mt-3 bg-blue-600 hover:bg-blue-500 text-white">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />} Tách scene
                  </Button>
                </TabsContent>
                <TabsContent value="upload" className="mt-4">
                  <input ref={fileRef} type="file" accept=".docx,.pdf,.txt" onChange={(e) => submitFile(e.target.files?.[0])}
                    data-testid="script-file-input"
                    className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-500" />
                  {busy && <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý...</div>}
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5 text-sm text-zinc-400">Bạn không có quyền nhập kịch bản.</div>
          )
        ) : (
          <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-head text-lg font-bold">Diff kịch bản</h2>
                <p className="text-sm text-zinc-400">{diff.summary.added} scene mới · {diff.summary.exists} đã tồn tại (không ghi đè)</p>
              </div>
              <Button variant="ghost" onClick={() => setDiff(null)} className="text-zinc-400" data-testid="diff-back">Đóng</Button>
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto thin-scroll">
              {diff.diff.map((d, i) => (
                <div key={i} data-testid={`diff-row-${d.code}`}
                  className={`rounded-md border p-3 ${d.status === "added" ? "border-emerald-500/30 bg-emerald-500/10" : "border-zinc-800 bg-[#0f0f11]"}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400">{d.code}</span>
                    <span className={`text-xs ${d.status === "added" ? "text-emerald-400" : "text-zinc-500"}`}>
                      {d.status === "added" ? "＋ Mới" : "● Đã có"}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${d.status === "added" ? "text-emerald-200" : "text-zinc-300"}`}>{d.title}</p>
                  {d.description && <p className="mt-1 text-xs text-zinc-500 line-clamp-2 whitespace-pre-line">{d.description}</p>}
                </div>
              ))}
            </div>
            {canWrite && (
              <Button onClick={() => confirm(diff.staging.id)} disabled={busy || diff.summary.added === 0}
                data-testid="script-confirm-btn" className="mt-4 bg-emerald-600 hover:bg-emerald-500 text-white">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Xác nhận & tạo {diff.summary.added} scene
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="overline mb-3">Bản nhập gần đây</p>
        <div className="space-y-2">
          {stagings.length === 0 ? (
            <p className="text-sm text-zinc-500">Chưa có bản nhập nào.</p>
          ) : stagings.map((s) => (
            <button key={s.id} onClick={() => openDiff(s.id)} data-testid={`staging-${s.id}`}
              className="flex w-full items-center gap-3 rounded-lg border border-zinc-800/80 bg-[#18181b] p-3 text-left hover:border-zinc-700 transition-colors">
              <FileText className="h-4 w-4 text-zinc-500 shrink-0" />
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm">{s.filename}</p>
                <p className="text-xs text-zinc-500">{s.parsed_scenes?.length || 0} scene · {fmtDate(s.created_at)}</p>
              </div>
              {s.status === "confirmed"
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : <span className="text-xs text-amber-400">staging</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
