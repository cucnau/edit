import React, { useState, useEffect } from 'react';
import { auth } from '../services/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider
} from 'firebase/auth';
import { 
  LogIn, 
  LogOut, 
  User as UserIcon, 
  Lock, 
  Mail, 
  Chrome, 
  X, 
  AlertCircle, 
  CheckCircle2,
  Link as LinkIcon,
  Loader2
} from 'lucide-react';

export const AuthPanel: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Feedback states
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // Map Firebase errors to Vietnamese friendly messages
  const getFriendlyErrorMessage = (errorCode: string) => {
    switch (errorCode) {
      case 'auth/email-already-in-use':
        return 'Email này đã được sử dụng bởi một tài khoản khác.';
      case 'auth/invalid-email':
        return 'Địa chỉ email không hợp lệ.';
      case 'auth/weak-password':
        return 'Mật khẩu quá yếu (yêu cầu tối thiểu 6 ký tự).';
      case 'auth/wrong-password':
        return 'Mật khẩu không chính xác.';
      case 'auth/user-not-found':
        return 'Không tìm thấy tài khoản sử dụng email này.';
      case 'auth/credential-already-in-use':
        return 'Thông tin đăng nhập này đã liên kết với một tài khoản khác.';
      case 'auth/provider-already-linked':
        return 'Tài khoản này đã được liên kết với hình thức đăng nhập này rồi.';
      case 'auth/invalid-credential':
        return 'Thông tin đăng nhập không hợp lệ (sai email hoặc sai mật khẩu).';
      default:
        return 'Có lỗi xảy ra trong quá trình xác thực. Vui lòng thử lại sau.';
    }
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
  };

  const handleOpenModal = () => {
    resetForm();
    setAuthMode('signin');
    setIsModalOpen(true);
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setSuccess('Đăng nhập bằng Google thành công!');
      setTimeout(() => setIsModalOpen(false), 800);
    } catch (err: any) {
      console.error('Lỗi đăng nhập Google:', err);
      setError(getFriendlyErrorMessage(err.code || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim() || !password) {
      setError('Vui lòng điền đầy đủ email và mật khẩu.');
      return;
    }

    setLoading(true);

    try {
      if (authMode === 'register') {
        if (password !== confirmPassword) {
          setError('Xác nhận mật khẩu không trùng khớp.');
          setLoading(false);
          return;
        }
        await createUserWithEmailAndPassword(auth, email, password);
        setSuccess('Đăng ký tài khoản mới thành công!');
        setTimeout(() => setIsModalOpen(false), 1000);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        setSuccess('Đăng nhập thành công!');
        setTimeout(() => setIsModalOpen(false), 1000);
      }
    } catch (err: any) {
      console.error('Lỗi xác thực email:', err);
      setError(getFriendlyErrorMessage(err.code || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleLinkEmailPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!user) {
      setError('Bạn cần đăng nhập trước khi thực hiện liên kết.');
      return;
    }

    if (!email.trim() || !password) {
      setError('Vui lòng điền đầy đủ email và mật khẩu để liên kết.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Xác nhận mật khẩu liên kết không khớp.');
      return;
    }

    setLoading(true);
    const credential = EmailAuthProvider.credential(email, password);

    try {
      await linkWithCredential(user, credential);
      setSuccess('Liên kết Email & Mật khẩu vào tài khoản Google thành công!');
      resetForm();
    } catch (err: any) {
      console.error('Lỗi liên kết Email/Password:', err);
      setError(getFriendlyErrorMessage(err.code || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleLinkGoogle = async () => {
    setError('');
    setSuccess('');

    if (!user) {
      setError('Bạn cần đăng nhập trước khi liên kết Google.');
      return;
    }

    setLoading(true);
    const provider = new GoogleAuthProvider();

    try {
      await linkWithCredential(user, provider);
      setSuccess('Liên kết tài khoản Google thành công!');
    } catch (err: any) {
      console.error('Lỗi liên kết Google:', err);
      setError(getFriendlyErrorMessage(err.code || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setError('');
    setSuccess('');
    try {
      await signOut(auth);
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Lỗi đăng xuất:', err);
    }
  };

  // Check providers of current user
  const hasGoogleProvider = user?.providerData.some(p => p.providerId === 'google.com') || false;
  const hasEmailProvider = user?.providerData.some(p => p.providerId === 'password') || false;

  return (
    <>
      {user ? (
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button 
            onClick={handleOpenModal}
            className="flex items-center gap-1.5 text-[10px] font-medium text-[#FFECB3] hover:text-white hover:bg-[#5D4037] bg-[#5D4037]/30 h-8 px-2.5 rounded-full border border-[#FFECB3]/20 transition-colors"
            title="Quản lý tài khoản"
          >
            <UserIcon size={12} />
            <span className="max-w-[80px] sm:max-w-[120px] truncate">{user.displayName || user.email}</span>
          </button>
          
          <button 
            onClick={handleSignOut} 
            className="flex items-center justify-center w-8 h-8 rounded-full border border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#5D4037] transition-all bg-[#5D4037]/20" 
            title="Đăng xuất"
          >
            <LogOut size={12} />
          </button>
        </div>
      ) : (
        <button 
          onClick={handleOpenModal} 
          className="flex items-center gap-1.5 text-[10px] font-medium text-[#FFECB3] hover:text-white bg-[#5D4037] hover:bg-[#4E342E] h-8 px-3 rounded-full border border-[#FFECB3]/30 transition-colors"
        >
          <LogIn size={12} />
          <span>Đăng nhập</span>
        </button>
      )}

      {/* AUTHENTICATION MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in">
          {/* Backdrop Click */}
          <div className="absolute inset-0" onClick={() => setIsModalOpen(false)} />
          
          <div className="relative w-full max-w-md bg-[#F5E6D3] text-[#3E2723] rounded-2xl border border-[#D7CCC8] shadow-2xl overflow-hidden z-10 p-5 sm:p-6 animate-scale-up">
            
            {/* Header */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-[#D7CCC8]/60">
              <h3 className="text-base font-bold text-[#3E2723] flex items-center gap-1.5">
                <UserIcon size={16} />
                {user ? 'Quản lý tài khoản' : authMode === 'signin' ? 'Đăng nhập hệ thống' : 'Đăng ký tài khoản'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-full text-[#5D4037] hover:bg-[#EFE5D9] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Error & Success Messages */}
            {error && (
              <div className="mb-4 p-2.5 rounded-lg bg-red-100 border border-red-200 text-red-800 text-[11px] flex items-start gap-1.5 leading-[1.3]">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="mb-4 p-2.5 rounded-lg bg-green-100 border border-green-200 text-green-800 text-[11px] flex items-start gap-1.5 leading-[1.3]">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span>{success}</span>
              </div>
            )}

            {/* NOT LOGGED IN MODE */}
            {!user ? (
              <div className="flex flex-col gap-4">
                {/* Mode Selector */}
                <div className="flex bg-[#EFE5D9] p-0.5 rounded-lg border border-[#D7CCC8]">
                  <button 
                    onClick={() => { setAuthMode('signin'); setError(''); }}
                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${authMode === 'signin' ? 'bg-[#4E342E] text-[#FFECB3]' : 'text-[#5D4037] hover:text-[#3E2723]'}`}
                  >
                    Đăng nhập
                  </button>
                  <button 
                    onClick={() => { setAuthMode('register'); setError(''); }}
                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${authMode === 'register' ? 'bg-[#4E342E] text-[#FFECB3]' : 'text-[#5D4037] hover:text-[#3E2723]'}`}
                  >
                    Đăng ký mới
                  </button>
                </div>

                {/* Google Sign-in Button */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-[#D7CCC8] rounded-xl bg-white text-[#3E2723] font-semibold text-xs hover:bg-[#F5F5F5] transition-all shadow-xs disabled:opacity-50"
                >
                  <Chrome size={14} className="text-red-500" />
                  <span>Đăng nhập nhanh bằng Google</span>
                </button>

                {/* Divider */}
                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-[#D7CCC8]"></div>
                  <span className="flex-shrink mx-3 text-[10px] text-[#8D6E63] uppercase tracking-wider font-semibold">hoặc sử dụng Email</span>
                  <div className="flex-grow border-t border-[#D7CCC8]"></div>
                </div>

                {/* Email Form */}
                <form onSubmit={handleEmailAuthSubmit} className="flex flex-col gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-[#5D4037] mb-1">Địa chỉ Email</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-2.5 text-[#8D6E63]" />
                      <input 
                        type="email"
                        placeholder="ten@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={loading}
                        required
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D7CCC8] bg-white text-[#3E2723] focus:border-[#4E342E] focus:ring-1 focus:ring-[#4E342E] focus:outline-hidden disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-[#5D4037] mb-1">Mật khẩu</label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3 top-2.5 text-[#8D6E63]" />
                      <input 
                        type="password"
                        placeholder="••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading}
                        required
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D7CCC8] bg-white text-[#3E2723] focus:border-[#4E342E] focus:ring-1 focus:ring-[#4E342E] focus:outline-hidden disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {authMode === 'register' && (
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#5D4037] mb-1">Xác nhận mật khẩu</label>
                      <div className="relative">
                        <Lock size={14} className="absolute left-3 top-2.5 text-[#8D6E63]" />
                        <input 
                          type="password"
                          placeholder="••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={loading}
                          required
                          className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D7CCC8] bg-white text-[#3E2723] focus:border-[#4E342E] focus:ring-1 focus:ring-[#4E342E] focus:outline-hidden disabled:opacity-50"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#4E342E] text-[#FFECB3] font-bold text-xs hover:bg-[#3E2723] transition-all disabled:opacity-50 shadow-md"
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : authMode === 'signin' ? (
                      <LogIn size={14} />
                    ) : (
                      <UserIcon size={14} />
                    )}
                    <span>{authMode === 'signin' ? 'Đăng nhập' : 'Đăng ký tài khoản'}</span>
                  </button>
                </form>
              </div>
            ) : (
              /* LOGGED IN & ACCOUNT LINKING MANAGEMENT MODE */
              <div className="flex flex-col gap-4">
                {/* User Info card */}
                <div className="bg-[#EFE5D9] p-3 rounded-xl border border-[#D7CCC8] flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-[#8D6E63] uppercase tracking-wider">Tài khoản hiện tại</span>
                  <div className="text-xs font-bold text-[#3E2723] truncate">{user.displayName || 'Người dùng mới'}</div>
                  <div className="text-[11px] text-[#5D4037] truncate">{user.email || 'Chưa cung cấp email'}</div>
                </div>

                <div className="border-t border-[#D7CCC8]/60 pt-3">
                  <h4 className="text-xs font-bold text-[#5D4037] mb-3 flex items-center gap-1">
                    <LinkIcon size={14} />
                    <span>Trạng thái liên kết đăng nhập</span>
                  </h4>

                  <div className="flex flex-col gap-3">
                    {/* Google Provider Status */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl border bg-white border-[#D7CCC8]/60 text-xs">
                      <div className="flex items-center gap-2">
                        <Chrome size={14} className="text-red-500" />
                        <span className="font-semibold text-[#3E2723]">Google Auth</span>
                      </div>
                      {hasGoogleProvider ? (
                        <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 size={10} /> Đã liên kết
                        </span>
                      ) : (
                        <button
                          onClick={handleLinkGoogle}
                          disabled={loading}
                          className="text-[10px] font-bold text-[#FFECB3] bg-[#4E342E] hover:bg-[#3E2723] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                        >
                          Liên kết Google
                        </button>
                      )}
                    </div>

                    {/* Email/Password Provider Status & Form */}
                    <div className="p-2.5 rounded-xl border bg-white border-[#D7CCC8]/60 text-xs">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Mail size={14} className="text-blue-500" />
                          <span className="font-semibold text-[#3E2723]">Email + Mật khẩu</span>
                        </div>
                        {hasEmailProvider ? (
                          <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={10} /> Đã liên kết
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            Chưa có liên kết
                          </span>
                        )}
                      </div>

                      {/* Link Email/Password Form if not linked */}
                      {!hasEmailProvider && (
                        <form onSubmit={handleLinkEmailPassword} className="mt-3 flex flex-col gap-2 border-t border-[#EFE5D9] pt-2">
                          <p className="text-[10px] text-[#8D6E63] italic mb-1">
                            Để có thể đăng nhập bằng email + mật khẩu vào tài khoản Google hiện tại, vui lòng điền thông tin bên dưới:
                          </p>
                          
                          <div>
                            <input 
                              type="email"
                              placeholder="Nhập Email của bạn"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              disabled={loading}
                              required
                              className="w-full px-2.5 py-1.5 text-[11px] rounded-lg border border-[#D7CCC8] bg-white text-[#3E2723] focus:border-[#4E342E] focus:outline-hidden disabled:opacity-50"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <input 
                              type="password"
                              placeholder="Đặt mật khẩu"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              disabled={loading}
                              required
                              className="w-full px-2.5 py-1.5 text-[11px] rounded-lg border border-[#D7CCC8] bg-white text-[#3E2723] focus:border-[#4E342E] focus:outline-hidden disabled:opacity-50"
                            />
                            <input 
                              type="password"
                              placeholder="Xác nhận lại"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              disabled={loading}
                              required
                              className="w-full px-2.5 py-1.5 text-[11px] rounded-lg border border-[#D7CCC8] bg-white text-[#3E2723] focus:border-[#4E342E] focus:outline-hidden disabled:opacity-50"
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={loading}
                            className="mt-1 w-full py-1.5 rounded-lg bg-[#4E342E] text-[#FFECB3] font-bold text-[10px] hover:bg-[#3E2723] transition-colors flex items-center justify-center gap-1 shadow-xs"
                          >
                            {loading ? <Loader2 size={10} className="animate-spin" /> : <LinkIcon size={10} />}
                            <span>Tạo liên kết Email & Mật khẩu</span>
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>

                {/* Logout Action */}
                <button
                  onClick={handleSignOut}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-red-700 bg-red-50 font-bold text-xs hover:bg-red-100 transition-all shadow-xs"
                >
                  <LogOut size={14} />
                  <span>Đăng xuất khỏi thiết bị</span>
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
};

