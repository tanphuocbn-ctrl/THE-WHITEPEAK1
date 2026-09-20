import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import AuthLayout from "./AuthLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      toast.success("Đặt lại mật khẩu thành công. Vui lòng đăng nhập.");
      nav("/login");
    } catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Đặt lại mật khẩu" subtitle="Nhập mật khẩu mới của bạn">
      {!token ? (
        <div className="space-y-4">
          <p className="text-sm text-red-400" data-testid="reset-no-token">Liên kết không hợp lệ hoặc thiếu token.</p>
          <Link to="/forgot-password" className="text-sm text-blue-400 hover:text-blue-300">Yêu cầu liên kết mới</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
          <div className="space-y-2">
            <Label htmlFor="password">Mật khẩu mới</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required minLength={6} data-testid="reset-password-input" className="bg-[var(--panel)] border-[var(--border)]" />
          </div>
          {error && <p className="text-sm text-red-400" data-testid="reset-error">{error}</p>}
          <Button type="submit" disabled={loading} data-testid="reset-submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Đặt lại mật khẩu
          </Button>
          <Link to="/login" className="block text-center text-sm text-blue-400 hover:text-blue-300">← Quay lại đăng nhập</Link>
        </form>
      )}
    </AuthLayout>
  );
}
