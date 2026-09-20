import { useEffect, useState } from "react";
import { useProject } from "./ProjectLayout";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, History } from "lucide-react";
import { toast } from "sonner";

const ACTION_LABEL = {
  create: "Tạo", update: "Sửa", delete: "Xóa", archive: "Lưu trữ", assign: "Phân công",
  status: "Đổi trạng thái", upload: "Nộp version", review: "Duyệt", grant: "Cấp quyền",
  revoke: "Thu hồi quyền", stage: "Nhập kịch bản", confirm: "Xác nhận kịch bản", restore: "Khôi phục",
};
const ACTION_COLOR = {
  create: "text-emerald-400", delete: "text-red-400", archive: "text-red-400",
  review: "text-amber-400", restore: "text-blue-400", grant: "text-emerald-400", revoke: "text-red-400",
};

export default function AuditLog() {
  const { projectId, myRole } = useProject();
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const canView = can(user, myRole, "audit.view");
  const canRestore = can(user, myRole, "audit.restore");

  const load = () => api.get(`/projects/${projectId}/audit`).then((r) => setLogs(r.data)).finally(() => setLoading(false));
  useEffect(() => { if (canView) load(); else setLoading(false); /* eslint-disable-next-line */ }, [projectId]);

  const restore = async (id) => {
    try { await api.post(`/projects/${projectId}/audit/${id}/restore`); toast.success("Đã khôi phục"); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  if (!canView) return <p className="text-sm text-zinc-500">Bạn không có quyền xem lịch sử.</p>;

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <div className="flex items-center gap-2 mb-4">
        <History className="h-5 w-5 text-zinc-500" />
        <h2 className="font-head text-lg font-bold">Nhật ký & khôi phục</h2>
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
      ) : (
        <div className="relative border-l border-zinc-800 ml-3 space-y-4">
          {logs.map((l) => (
            <div key={l.id} className="relative pl-6" data-testid={`audit-${l.id}`}>
              <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-zinc-600 border-2 border-[#09090b]" />
              <div className="rounded-lg border border-zinc-800/80 bg-[#18181b] p-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${ACTION_COLOR[l.action] || "text-zinc-400"}`}>{ACTION_LABEL[l.action] || l.action}</span>
                  <span className="text-xs text-zinc-600">·</span>
                  <span className="text-xs text-zinc-500">{l.entity_type}</span>
                  <span className="ml-auto text-xs text-zinc-600 tabular">{new Date(l.created_at).toLocaleString("vi-VN")}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-200">{l.label}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">bởi {l.actor_name}</span>
                  {canRestore && l.restorable && l.action !== "restore" && (
                    <Button size="sm" variant="ghost" onClick={() => restore(l.id)} data-testid={`restore-${l.id}`}
                      className="h-7 text-blue-400 hover:text-blue-300"><RotateCcw className="mr-1 h-3.5 w-3.5" /> Khôi phục</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
