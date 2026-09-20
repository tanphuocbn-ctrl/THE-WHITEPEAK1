import { useEffect, useState, useRef } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";

const PROVIDERS = [
  { value: "gemini", label: "Gemini 3.1 Pro" },
  { value: "openai", label: "OpenAI GPT-5.4" },
  { value: "anthropic", label: "Claude Sonnet 4.6" },
];

export default function ScriptImport() {
  const { projectId, myRole } = useProject();
  const { user } = useAuth();
  const [stagings, setStagings] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [diff, setDiff] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const fileRef = useRef();
  const canWrite = can(user, myRole, "script.write");

  const loadStagings = () => api.get(`/projects/${projectId}/scripts/stagings`).then((r) => setStagings(r.data));
  useEffect(() => { loadStagings(); /* eslint-disable-next-line */ }, [projectId]);

  const openDiff = async (id) => {
    const { data } = await api.get(`/projects/${projectId}/scripts/stagings/${id}/diff`);
    setDiff(data);
    setSelected(new Set(data.diff.filter((d) => d.status === "added").map((d) => d.code)));
  };

  const submitManual = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (useAI) {
        const { data } = await api.post(`/projects/${projectId}/scripts/ai-parse`, { raw_text: text, provider });
        toast.success(`AI (${provider}) đã tách ${data.parsed_scenes.length} cảnh`);
        setText(""); await loadStagings(); openDiff(data.id);
      } else {
        const { data } = await api.post(`/projects/${projectId}/scripts/manual`, { raw_text: text });
        toast.success("Đã tạo bản nhập (staging)");
        setText(""); await loadStagings(); openDiff(data.id);
      }
    } catch (e) {
      toast.error(apiError(e));
      if (useAI) toast.message("Gợi ý: tắt AI để nhập tay khi provider gặp lỗi.");
    } finally { setBusy(false); }
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

  const toggle = (code) => {
    const n = new Set(selected);
    n.has(code) ? n.delete(code) : n.add(code);
    setSelected(n);
  };

  const confirm = async (stagingId) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${projectId}/scripts/stagings/${stagingId}/confirm`, {
        selected_codes: Array.from(selected),
      });
      toast.success(`Đã xác nhận: tạo ${data.created_scenes} scene mới`);
      setDiff(null); await loadStagings();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const selectedAdded = diff ? diff.diff.filter((d) => d.status === "added" && selected.has(d.code)).length : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 animate-fade-up">
      <div className="space-y-4">
        {!diff ? (
          canWrite ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
              <h2 className="font-head text-lg font-bold mb-1">Nhập kịch bản</h2>
              <p className="text-sm text-[var(--muted)] mb-4">Tải DOCX/PDF/TXT, nhập tay, hoặc để AI tách cảnh. Sau đó: staging → diff → chọn cảnh → xác nhận.</p>
              <Tabs defaultValue="manual">
                <TabsList className="bg-[var(--panel-2)] border border-[var(--border)]">
                  <TabsTrigger value="manual" data-testid="script-tab-manual">Nhập tay / AI</TabsTrigger>
                  <TabsTrigger value="upload" data-testid="script-tab-upload">Tải file</TabsTrigger>
                </TabsList>
                <TabsContent value="manual" className="mt-4">
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
                    placeholder={"NỘI. QUÁN CÀ PHÊ - NGÀY\nNhân vật A ngồi chờ...\n\nNGOẠI. ĐƯỜNG PHỐ - ĐÊM\n..."}
                    data-testid="script-manual-input" className="bg-[var(--panel-2)] border-[var(--border)] font-mono text-sm" />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={useAI} onCheckedChange={(v) => setUseAI(!!v)} data-testid="use-ai-checkbox" />
                      <span className="text-sm text-[var(--muted)] flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-violet-400" /> Tách bằng AI</span>
                    </label>
                    {useAI && (
                      <Select value={provider} onValueChange={setProvider}>
                        <SelectTrigger data-testid="ai-provider-select" className="w-48 bg-[var(--panel-2)] border-[var(--border)] h-8"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                          {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Button onClick={submitManual} disabled={busy || !text.trim()} data-testid="script-manual-submit"
                      className={`ml-auto text-white ${useAI ? "bg-violet-600 hover:bg-violet-500" : "bg-blue-600 hover:bg-blue-500"}`}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : useAI ? <Sparkles className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                      {useAI ? "Tách bằng AI" : "Tách scene"}
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="upload" className="mt-4">
                  <input ref={fileRef} type="file" accept=".docx,.pdf,.txt" onChange={(e) => submitFile(e.target.files?.[0])}
                    data-testid="script-file-input"
                    className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-500" />
                  {busy && <div className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý...</div>}
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">Bạn không có quyền nhập kịch bản.</div>
          )
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-head text-lg font-bold">Diff & chọn cảnh</h2>
                <p className="text-sm text-[var(--muted)]">{diff.summary.added} cảnh mới · {diff.summary.exists} đã tồn tại (không ghi đè) · chọn {selectedAdded}</p>
                {diff.staging.cost_note && <p className="text-xs text-violet-400 mt-0.5">{diff.staging.cost_note}</p>}
              </div>
              <Button variant="ghost" onClick={() => setDiff(null)} className="text-[var(--muted)]" data-testid="diff-back">Đóng</Button>
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto thin-scroll">
              {diff.diff.map((d, i) => {
                const added = d.status === "added";
                return (
                  <label key={i} data-testid={`diff-row-${d.code}`}
                    className={`flex items-start gap-3 rounded-md border p-3 ${added ? "border-emerald-500/30 bg-emerald-500/10 cursor-pointer" : "border-[var(--border)] bg-[var(--panel-2)] opacity-70"}`}>
                    {added ? (
                      <Checkbox checked={selected.has(d.code)} onCheckedChange={() => toggle(d.code)}
                        data-testid={`diff-check-${d.code}`} className="mt-0.5" />
                    ) : <span className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[var(--muted)]">{d.code}</span>
                        <span className={`text-xs ${added ? "text-emerald-400" : "text-[var(--muted-2)]"}`}>{added ? "＋ Mới" : "● Đã có"}</span>
                      </div>
                      <p className={`mt-1 text-sm ${added ? "text-emerald-200" : "text-[var(--muted)]"}`}>{d.title}</p>
                      {d.description && <p className="mt-1 text-xs text-[var(--muted-2)] line-clamp-2 whitespace-pre-line">{d.description}</p>}
                    </div>
                  </label>
                );
              })}
            </div>
            {canWrite && (
              <Button onClick={() => confirm(diff.staging.id)} disabled={busy || selectedAdded === 0}
                data-testid="script-confirm-btn" className="mt-4 bg-emerald-600 hover:bg-emerald-500 text-white">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Xác nhận & tạo {selectedAdded} cảnh đã chọn
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="overline mb-3">Bản nhập gần đây</p>
        <div className="space-y-2">
          {stagings.length === 0 ? (
            <p className="text-sm text-[var(--muted-2)]">Chưa có bản nhập nào.</p>
          ) : stagings.map((s) => (
            <button key={s.id} onClick={() => openDiff(s.id)} data-testid={`staging-${s.id}`}
              className="flex w-full items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-left hover:border-[var(--border)] transition-colors">
              {String(s.source_type).startsWith("ai") ? <Sparkles className="h-4 w-4 text-violet-400 shrink-0" /> : <FileText className="h-4 w-4 text-[var(--muted-2)] shrink-0" />}
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm">{s.filename}</p>
                <p className="text-xs text-[var(--muted-2)]">{s.parsed_scenes?.length || 0} cảnh · {fmtDate(s.created_at)}</p>
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
