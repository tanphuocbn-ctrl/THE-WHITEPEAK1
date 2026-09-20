import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, FolderKanban } from "lucide-react";
import { toast } from "sonner";

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", code: "", description: "" });
  const [saving, setSaving] = useState(false);

  const canCreate = user?.role === "super_admin" || user?.role === "secretary";

  const load = () => api.get("/projects").then((r) => setProjects(r.data)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setSaving(true);
    try {
      await api.post("/projects", form);
      toast.success("Đã tạo dự án");
      setOpen(false); setForm({ title: "", code: "", description: "" });
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8 animate-fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="overline">Danh mục</p>
          <h1 className="font-head text-3xl font-extrabold tracking-tight mt-1">Dự án</h1>
        </div>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-500 text-white" data-testid="new-project-btn">
                <Plus className="mr-2 h-4 w-4" /> Dự án mới
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[var(--panel)] border-[var(--border)]">
              <DialogHeader><DialogTitle className="font-head">Tạo dự án mới</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Tên dự án</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    data-testid="project-title-input" className="bg-[var(--panel-2)] border-[var(--border)]" />
                </div>
                <div className="space-y-2">
                  <Label>Mã dự án</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="VD: PRJ-01" data-testid="project-code-input" className="bg-[var(--panel-2)] border-[var(--border)] font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>Mô tả</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    data-testid="project-desc-input" className="bg-[var(--panel-2)] border-[var(--border)]" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={saving || !form.title || !form.code}
                  className="bg-blue-600 hover:bg-blue-500 text-white" data-testid="project-save-btn">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Tạo dự án
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--muted-2)]" /></div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-20 text-center">
          <FolderKanban className="h-10 w-10 text-zinc-700 mb-3" />
          <p className="text-[var(--muted)]">Chưa có dự án nào.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} data-testid={`project-card-${p.code}`}
              className="group rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden hover:border-[var(--border)] transition-colors">
              <div className="h-32 bg-[var(--panel)] overflow-hidden relative">
                {p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />}
                <span className="absolute top-3 right-3 rounded-full border border-[var(--border)] bg-black/60 px-2 py-0.5 text-xs backdrop-blur">
                  {p.status === "active" ? "Đang chạy" : "Lưu trữ"}
                </span>
              </div>
              <div className="p-4">
                <p className="font-mono text-xs text-[var(--muted-2)]">{p.code}</p>
                <h3 className="font-head font-semibold mt-1 truncate">{p.title}</h3>
                <p className="mt-1 text-sm text-[var(--muted-2)] line-clamp-2">{p.description}</p>
                <p className="mt-3 text-xs text-[var(--muted-2)]">{p.members?.length || 0} thành viên</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
