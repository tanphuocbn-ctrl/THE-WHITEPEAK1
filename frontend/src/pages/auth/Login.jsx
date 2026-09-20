import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/lib/api";
import AuthLayout from "./AuthLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError(apiError(err));
    } finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Đăng nhập" subtitle="Truy cập hệ thống quản lý sản xuất phim">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@studio.vn" required data-testid="login-email-input"
            className="bg-[var(--panel)] border-[var(--border)]" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Mật khẩu</Label>
            <Link to="/forgot-password" className="text-xs text-blue-400 hover:text-blue-300" data-testid="forgot-link">
              Quên mật khẩu?
            </Link>
          </div>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" required data-testid="login-password-input"
            className="bg-[var(--panel)] border-[var(--border)]" />
        </div>
        {error && <p className="text-sm text-red-400" data-testid="login-error">{error}</p>}
        <Button type="submit" disabled={loading} data-testid="login-submit"
          className="w-full bg-blue-600 hover:bg-blue-500 text-white">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Đăng nhập
        </Button>
        <p className="text-center text-sm text-[var(--muted)]">
          Chưa có tài khoản?{" "}
          <Link to="/register" className="text-blue-400 hover:text-blue-300" data-testid="to-register">Đăng ký</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
