"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    setCarregando(false);

    if (error) {
      setErro("E-mail ou senha inválidos.");
      return;
    }

    router.push("/contas");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm rounded-xl2 bg-white p-8 shadow-sm ring-1 ring-slate-200"
      >
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Agendador de Stories</h1>
        <p className="mb-6 text-sm text-slate-500">Entre para gerenciar seus agendamentos.</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">Senha</label>
        <input
          type="password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />

        {erro && <p className="mb-4 text-sm text-red-600">{erro}</p>}

        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>

        <p className="mt-4 text-xs text-slate-400">
          O usuário admin é criado direto no painel do Supabase (Authentication → Users → Add user).
        </p>
      </form>
    </main>
  );
}
