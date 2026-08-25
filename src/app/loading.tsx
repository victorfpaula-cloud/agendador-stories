// Tela de carregamento instantânea. O Next.js mostra isso automaticamente
// enquanto a página de verdade ainda está buscando os dados no servidor
// (login, lista de contas, grade semanal) — é exatamente a "tela branca"
// que aparecia ao abrir o app pelo ícone da tela de início. Não depende de
// nenhum dado nem de JavaScript rodando no celular: já vem pronta no HTML
// que o servidor manda primeiro, então aparece bem mais rápido que o
// conteúdo real.
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50">
      <img
        src="/icon.png"
        alt="Agendador de Stories"
        className="h-16 w-16 animate-pulse rounded-xl2 shadow-sm"
      />
      <div className="flex gap-1.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
      </div>
    </div>
  );
}
