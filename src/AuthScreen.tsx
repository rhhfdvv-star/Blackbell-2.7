import type { FormEvent } from 'react';
import { useState } from 'react';
import { BookMarked, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';

interface AuthScreenProps {
  onLogin: (user: { email: string; username: string; isAdmin: boolean }) => void;
}

export default function AuthScreen({ onLogin }: AuthScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'signin' 
        ? { email, password } 
        : { email, username, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Authentication failed');
      }

      const data = await res.json();
      if (data.success && data.user) {
        onLogin(data.user);
      } else {
        throw new Error('Invalid response structure');
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Server connection error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#11141E] text-white px-4 py-8 items-center justify-center font-sans">
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Logo */}
        <div className="w-16 h-16 rounded-[20px] bg-[#2C1B4A] flex items-center justify-center mb-4 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
          <BookMarked className="w-8 h-8 text-[#A78BFA]" />
        </div>

        {/* Title */}
        <h1 className="text-3xl font-serif font-bold text-white mb-2 text-center">Blackbell</h1>
        <p className="text-[#9CA3AF] mb-6 text-center text-[15px]">Your AI-powered research companion</p>

        {/* Error alerting */}
        {error && (
          <div className="w-full mb-4 flex items-center gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab Selector */}
        <div className="w-full flex bg-[#1A1D29] rounded-2xl p-1 mb-6 shadow-sm">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
            className={`flex-1 py-3 text-[15px] font-medium rounded-xl transition-colors ${
              mode === 'signin' ? 'bg-purple-900/40 text-purple-200 border border-purple-500/20 shadow-sm' : 'text-[#8892B0] hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`flex-1 py-3 text-[15px] font-medium rounded-xl transition-colors ${
              mode === 'signup' ? 'bg-purple-900/40 text-purple-200 border border-purple-500/20 shadow-sm' : 'text-[#8892B0] hover:text-white'
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col space-y-4">
          <div>
            <input
              type="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full bg-[#1A1D29] border border-[#2A2E3D] rounded-xl px-4 py-3.5 text-white placeholder-[#68728E] text-[15px] focus:outline-none focus:border-[#A78BFA] transition-colors"
            />
          </div>
          
          {mode === 'signup' && (
            <div>
              <input
                type="text"
                required
                disabled={loading}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full bg-[#1A1D29] border border-[#2A2E3D] rounded-xl px-4 py-3.5 text-white placeholder-[#68728E] text-[15px] focus:outline-none focus:border-[#A78BFA] transition-colors"
              />
            </div>
          )}

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-[#1A1D29] border border-[#2A2E3D] rounded-xl pl-4 pr-11 py-3.5 text-white placeholder-[#68728E] text-[15px] focus:outline-none focus:border-[#A78BFA] transition-colors"
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8892B0] hover:text-white transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#4C1D95] text-white font-semibold py-3.5 text-[15px] rounded-xl mt-4 transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)] duration-200 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
