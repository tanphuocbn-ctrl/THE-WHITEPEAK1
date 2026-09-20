import { useEffect, useState } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, fmtDate } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Wallet, Plus, Trash2, AlertTriangle, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const money = (n) => (n || 0).toLocaleString("vi-VN");

export default function Budget() {
  const { projectId, myRole } = useProject();
  const { user } = useAuth();
  const canWrite = can(user, myRole, "budget.write");
  const [data, setData] = useState(null);
  const [sequences, setSequences] = useState([]);
  const [amount, setAmount] = useState("");
  const [exp, setExp] = useState({ title: "", amount: "", category: "nhân sự", sequence_id: "none" });

  const load = () => api.get(`/projects/${projectId}/budget`).then((r) => { setData(r.data); setAmount(String(r.data.amount || "")); });
  useEffect(() => {
    load();
    api.get(`/projects/${projectId}/sequences`).then((r) => setSequences(r.data));
    // eslint-disable-next-line
  }, [projectId]);

  const saveBudget = async () => {
    try { await api.put(`/projects/${projectId}/budget`, { amount: parseFloat(amount) || 0 }); toast.success("Đã cập nhật ngân sách"); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const addExpense = async () => {
    if (!exp.title || !exp.amount) return;
    try {
      await api.post(`/projects/${projectId}/budget/expenses`, {
        title: exp.title, amount: parseFloat(exp.amount) || 0, category: exp.category,
        sequence_id: exp.sequence_id === "none" ? null : exp.sequence_id,
      });
      setExp({ title: "", amount: "", category: "nhân sự", sequence_id: "none" }); load(); toast.success("Đã thêm chi phí");
    } catch (e) { toast.error(apiError(e)); }
  };
  const delExpense = async (id) => {
    try { await api.delete(`/projects/${projectId}/budget/expenses/${id}`); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>;

  const pct = Math.min(100, data.pct || 0);
  return (
    <div className="mx-auto max-w-4xl animate-fade-up space-y-6">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="flex items-center gap-2 mb-4"><Wallet className="h-5 w-5 text-[var(--muted-2)]" /><h2 className="font-head font-bold">Ngân sách dự án</h2></div>
        {canWrite && (
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[200px] space-y-2"><Label>Tổng ngân sách (VND)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="budget-amount" className="bg-[var(--panel-2)] border-[var(--border)] tabular" /></div>
            <Button onClick={saveBudget} data-testid="budget-save" className="bg-blue-600 hover:bg-blue-500 text-white">Lưu ngân sách</Button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><span className="overline block">Ngân sách</span><span className="font-head text-2xl font-extrabold tabular">{money(data.amount)}</span></div>
          <div><span className="overline block">Đã chi</span><span className="font-head text-2xl font-extrabold tabular text-amber-300">{money(data.spent)}</span></div>
          <div><span className="overline block">Còn lại</span><span className={`font-head text-2xl font-extrabold tabular ${data.remaining < 0 ? "text-red-400" : "text-emerald-300"}`}>{money(data.remaining)}</span></div>
        </div>
        <div className="h-2.5 rounded-full bg-[var(--panel-2)] overflow-hidden">
          <div className={`h-full rounded-full transition-all ${data.over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} data-testid="budget-bar" />
        </div>
        {data.over && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" data-testid="budget-over-warning">
            <AlertTriangle className="h-4 w-4" /> Cảnh báo: chi phí đã vượt ngân sách {money(-data.remaining)} VND!
          </div>
        )}
      </div>

      {data.by_sequence.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="overline mb-3 flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5" /> Chi phí theo Sequence</p>
          <div className="space-y-2">
            {data.by_sequence.map((s) => (
              <div key={s.sequence_id} className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">{s.code !== "—" ? `${s.code} · ` : ""}{s.title}</span>
                <span className="tabular text-amber-300">{money(s.spent)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border)] p-4"><h3 className="font-head font-semibold">Chi phí</h3></div>
        {canWrite && (
          <div className="flex flex-wrap gap-2 p-4 border-b border-[var(--border)]">
            <Input value={exp.title} onChange={(e) => setExp({ ...exp, title: e.target.value })} placeholder="Hạng mục chi" data-testid="exp-title" className="flex-1 min-w-[160px] bg-[var(--panel-2)] border-[var(--border)]" />
            <Input type="number" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="Số tiền" data-testid="exp-amount" className="w-32 bg-[var(--panel-2)] border-[var(--border)] tabular" />
            <Select value={exp.category} onValueChange={(v) => setExp({ ...exp, category: v })}>
              <SelectTrigger data-testid="exp-cat" className="w-36 bg-[var(--panel-2)] border-[var(--border)]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                {["nhân sự", "thiết bị", "bối cảnh", "hậu kỳ", "khác"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={exp.sequence_id} onValueChange={(v) => setExp({ ...exp, sequence_id: v })}>
              <SelectTrigger data-testid="exp-seq" className="w-40 bg-[var(--panel-2)] border-[var(--border)]"><SelectValue placeholder="Sequence" /></SelectTrigger>
              <SelectContent className="bg-[var(--panel)] border-[var(--border)]">
                <SelectItem value="none">Chung</SelectItem>
                {sequences.map((s) => <SelectItem key={s.id} value={s.id}>{s.code}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={addExpense} data-testid="exp-add" className="bg-blue-600 hover:bg-blue-500 text-white"><Plus className="mr-1 h-4 w-4" /> Thêm</Button>
          </div>
        )}
        {data.expenses.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--muted-2)]">Chưa có chi phí nào.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]/80">
            {data.expenses.map((e) => (
              <div key={e.id} className="flex items-center gap-3 p-4" data-testid={`exp-${e.id}`}>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">{e.category}</span>
                <span className="flex-1 truncate text-sm">{e.title}</span>
                <span className="tabular text-sm text-amber-300">{money(e.amount)}</span>
                <span className="hidden sm:block text-xs text-[var(--muted-2)]">{fmtDate(e.created_at)}</span>
                {canWrite && <Button size="icon" variant="ghost" onClick={() => delExpense(e.id)} className="text-[var(--muted-2)] hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
