import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/lib/api";
import AuthLayout from "./AuthLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await register(email, password, name);
      nav("/");
    } catch (err) {
      setError(apiError(err));
    } finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Đăng ký" subtitle="Tạo tài khoản mới">
      <form onSubmit={submit} className="space-y-4" data-testid="register-form">
        <div className="space-y-2">
          <Label htmlFor="name">Họ tên</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required
            data-testid="register-name-input" className="bg-[#18181b] border-zinc-800" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            data-testid="register-email-input" className="bg-[#18181b] border-zinc-800" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Mật khẩu</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            minLength={6} data-testid="register-password-input" className="bg-[#18181b] border-zinc-800" />
        </div>
        {error && <p className="text-sm text-red-400" data-testid="register-error">{error}</p>}
        <Button type="submit" disabled={loading} data-testid="register-submit"
          className="w-full bg-blue-600 hover:bg-blue-500 text-white">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Tạo tài khoản
        </Button>
        <p className="text-center text-sm text-zinc-400">
          Đã có tài khoản?{" "}
          <Link to="/login" className="text-blue-400 hover:text-blue-300" data-testid="to-login">Đăng nhập</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
