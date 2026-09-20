import { useState } from "react";
import { Link } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import AuthLayout from "./AuthLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Quên mật khẩu" subtitle="Nhập email để nhận liên kết đặt lại">
      {sent ? (
        <div className="space-y-4" data-testid="forgot-success">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
            <p className="text-sm text-emerald-200">
              Nếu email đã đăng ký, liên kết đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư.
            </p>
          </div>
          <Link to="/login" className="text-sm text-blue-400 hover:text-blue-300" data-testid="back-to-login">
            ← Quay lại đăng nhập
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              data-testid="forgot-email-input" className="bg-[#18181b] border-zinc-800" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading} data-testid="forgot-submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Gửi liên kết
          </Button>
          <Link to="/login" className="block text-center text-sm text-blue-400 hover:text-blue-300" data-testid="back-to-login">
            ← Quay lại đăng nhập
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
