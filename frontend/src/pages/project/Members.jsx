import { useState } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can, PROJECT_ROLES, ROLE_LABEL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Members() {
  const { project, projectId, myRole, reload } = useProject();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const canManage = can(user, myRole, "project.manage_members");
  const members = project.members || [];

  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/members`, { email, role });
      toast.success("Đã thêm thành viên");
      setEmail(""); reload();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const remove = async (uid) => {
    try { await api.delete(`/projects/${projectId}/members/${uid}`); toast.success("Đã thu hồi quyền"); reload(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="mx-auto max-w-3xl animate-fade-up space-y-6">
      {canManage && (
        <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-5">
          <h2 className="font-head font-bold mb-4">Thêm thành viên</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-2">
              <Label className="text-xs">Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nguoidung@studio.vn"
                data-testid="member-email-input" className="bg-[#0f0f11] border-zinc-800" />
            </div>
            <div className="w-full sm:w-48 space-y-2">
              <Label className="text-xs">Vai trò</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger data-testid="member-role-select" className="bg-[#0f0f11] border-zinc-800"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#18181b] border-zinc-800">
                  {PROJECT_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={add} disabled={busy || !email} data-testid="member-add-btn" className="bg-blue-600 hover:bg-blue-500 text-white">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />} Thêm
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-zinc-800/80 bg-[#18181b]">
        <div className="border-b border-zinc-800/80 p-4"><h2 className="font-head font-bold">Thành viên ({members.length})</h2></div>
        <div className="divide-y divide-zinc-800/80">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 p-4" data-testid={`member-${m.email}`}>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold">
                {(m.name || m.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm">{m.name}</p>
                <p className="truncate text-xs text-zinc-500">{m.email}</p>
              </div>
              <span className="rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-300">{ROLE_LABEL[m.role] || m.role}</span>
              {canManage && m.user_id !== user.id && (
                <Button size="icon" variant="ghost" onClick={() => remove(m.user_id)} data-testid={`remove-${m.email}`}
                  className="text-zinc-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
