import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { UserSession } from '@pb/types';
import { RefreshCw } from 'lucide-react';
import { LoginIllustration } from '../components/LoginIllustration.js';

interface LoginPageProps {
  onLoginSuccess: (user: UserSession, token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<{ id: string; question: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetches a fresh challenge and always leaves the answer field empty — the user must
  // type it in themselves, never auto-computed/auto-filled by the app.
  const fetchCaptcha = async () => {
    try {
      const res = await apiRequest<{ id: string; question: string }>('/auth/captcha');
      setCaptcha(res.data);
      setCaptchaAnswer('');
    } catch (err) {
      console.warn('Captcha fetch error:', err);
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiRequest<{ user: UserSession; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          captchaId: captcha?.id,
          captchaAnswer,
        }),
      });

      localStorage.setItem('pb_token', res.data.token);
      localStorage.setItem('pb_user', JSON.stringify(res.data.user));
      onLoginSuccess(res.data.user, res.data.token);
    } catch (err: any) {
      // Inactive staff (Staffs page Active = NO) signing in with the right password: off to Google
      if (err?.code === 'ACCOUNT_INACTIVE') {
        window.location.replace('https://www.google.com');
        return;
      }
      setError(err.message || 'Login failed');
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const formattedQuestion = captcha?.question || '...';

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-[#1e3b6e]">
      {/* Left Half: Clean White Background with PB Exchange Brand & Illustration */}
      <div className="w-full md:w-1/2 bg-white flex flex-col justify-between items-center py-10 px-8 min-h-[460px] md:min-h-screen">
        {/* Top Header */}
        <div className="pt-2 sm:pt-4">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1c3867] tracking-tight text-center">
            Punjab king
          </h1>
        </div>

        {/* Center Illustration & Community Tagline */}
        <div className="my-auto flex flex-col items-center text-center py-6">
          <LoginIllustration className="w-full max-w-[340px] sm:max-w-[400px] mb-6" />
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-1">
            Join our community
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Turn your imagination into reality
          </p>
        </div>

        {/* Bottom spacing placeholder */}
        <div className="h-4 hidden md:block"></div>
      </div>

      {/* Right Half: Deep Blue Background with Sign In Form */}
      <div className="w-full md:w-1/2 bg-[#1e3b6e] flex flex-col justify-between items-center py-10 sm:py-16 px-6 sm:px-12 min-h-[500px] md:min-h-screen">
        <div className="hidden md:block h-4"></div>

        {/* Form Container */}
        <div className="w-full max-w-[360px] my-auto">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-3xl font-bold text-white tracking-tight mb-1.5">
              Sign In
            </h2>
            <p className="text-xs text-blue-100/80 font-normal">
              Sign in to your account to continue
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-2.5 bg-red-900/40 border border-red-500/60 rounded text-red-200 text-xs font-medium text-center">
              {error}
            </div>
          )}

          {/* Sign In Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Username Field */}
            <div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="ENTER USERNAME"
                className="w-full px-4 py-2.5 bg-white rounded text-slate-900 placeholder:text-slate-400 placeholder:text-xs placeholder:tracking-wider text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all shadow-sm"
              />
            </div>

            {/* Password Field */}
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="ENTER PASSWORD"
                className="w-full px-4 py-2.5 bg-white rounded text-slate-900 placeholder:text-slate-400 placeholder:text-xs placeholder:tracking-wider text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all shadow-sm"
              />
            </div>

            {/* Captcha Field */}
            <div className="pt-1">
              <div className="flex items-center justify-between gap-3">
                {/* Refresh Icon */}
                <button
                  type="button"
                  onClick={fetchCaptcha}
                  title="Refresh Captcha"
                  className="text-white/90 hover:text-white p-1 transition-transform active:rotate-180 duration-200"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>

                {/* Math Question */}
                <span className="text-white font-bold text-sm tracking-wide select-none">
                  {formattedQuestion}
                </span>

                {/* Equal Sign */}
                <span className="text-white font-bold text-sm select-none">
                  =
                </span>

                {/* Captcha Input */}
                <input
                  type="text"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  required
                  className="w-32 px-3 py-1.5 bg-white text-slate-900 text-center font-bold text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-400 shadow-sm transition-all"
                />
              </div>

              {/* Captcha Verification Text */}
              <p className="text-[11px] text-blue-200/90 text-center mt-2 font-normal select-none">
                Please verify you are a human.
              </p>
            </div>

            {/* Login Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-medium text-sm rounded shadow transition-colors disabled:opacity-70 flex items-center justify-center"
              >
                {loading ? 'Logging in...' : 'Login'}
              </button>
            </div>
          </form>
        </div>

        {/* Bottom Footer Credit */}
        <div className="pt-8 text-center select-none">
          <p className="text-[10px] tracking-wider text-blue-200/60 uppercase font-medium">
            POWERED BY PB Exchange @ 2026
          </p>
        </div>
      </div>
    </div>
  );
};
