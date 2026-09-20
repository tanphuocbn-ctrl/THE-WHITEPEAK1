export const SHOT_STATUS = {
  todo: { label: "Chờ làm", cls: "text-zinc-300 bg-zinc-500/10 border-zinc-500/30" },
  in_progress: { label: "Đang làm", cls: "text-blue-300 bg-blue-500/10 border-blue-500/30" },
  review: { label: "Chờ duyệt", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  rejected: { label: "Trả hàng", cls: "text-red-300 bg-red-500/10 border-red-500/30" },
  approved: { label: "Đã duyệt", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" },
  done: { label: "Hoàn tất", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" },
};

export const BOARD_COLUMNS = [
  { key: "todo", label: "Chờ làm" },
  { key: "in_progress", label: "Đang làm" },
  { key: "review", label: "Chờ duyệt" },
  { key: "rejected", label: "Trả hàng" },
  { key: "approved", label: "Đã duyệt" },
];

export const PROJECT_ROLES = [
  { value: "pm", label: "PM / Production Lead" },
  { value: "team_lead", label: "Team Lead" },
  { value: "member", label: "Member" },
  { value: "editor", label: "Editor" },
  { value: "reviewer", label: "Reviewer" },
  { value: "guest", label: "Guest" },
];

export const ROLE_LABEL = {
  super_admin: "Super Admin",
  secretary: "Thư ký",
  skill_manager: "Skill Manager",
  member: "Member",
  pm: "PM",
  team_lead: "Team Lead",
  editor: "Editor",
  reviewer: "Reviewer",
  guest: "Guest",
};

const CAPS = {
  pm: new Set(["project.edit", "project.manage_members", "structure.write", "assignment.write", "version.upload", "review.decide", "script.write", "audit.view", "audit.restore"]),
  team_lead: new Set(["structure.write", "assignment.write", "version.upload", "script.write", "audit.view"]),
  member: new Set(["version.upload"]),
  editor: new Set(["version.upload"]),
  reviewer: new Set(["review.decide"]),
  guest: new Set([]),
};

export function can(user, myRole, cap) {
  if (user?.role === "super_admin") return true;
  if (!myRole) return false;
  return CAPS[myRole]?.has(cap) || false;
}

export function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
}

export function fmtBytes(n) {
  if (!n && n !== 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
