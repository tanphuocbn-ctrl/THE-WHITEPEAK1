import { Film } from "lucide-react";

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden border-r border-[var(--border)]">
        <img
          src="https://images.unsplash.com/photo-1612544409025-e1f6a56c1152?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwxfHxjaW5lbWF0aWMlMjBmaWxtJTIwc2V0JTIwcHJvZHVjdGlvbnxlbnwwfHx8fDE3ODk4ODQzNTl8MA&ixlib=rb-4.1.0&q=85"
          alt="Film set"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-[#09090b]/60 to-transparent" />
        <div className="relative z-10 flex flex-col justify-end p-12">
          <div className="flex items-center gap-2 mb-4">
            <Film className="h-6 w-6 text-blue-500" />
            <span className="font-head text-lg font-bold tracking-tight">Film Studio Manager</span>
          </div>
          <h2 className="font-head text-4xl font-extrabold leading-tight max-w-md">
            Từ kịch bản đến bản dựng cuối, quản lý tập trung.
          </h2>
          <p className="mt-4 text-[var(--muted)] max-w-md text-sm">
            Phân quyền theo vai trò · Versioning bất biến · Quy trình duyệt & trả hàng · Lịch sử đầy đủ.
          </p>
        </div>
      </div>
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <Film className="h-6 w-6 text-blue-500" />
            <span className="font-head text-lg font-bold">Film Studio Manager</span>
          </div>
          <h1 className="font-head text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-[var(--muted)]">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
