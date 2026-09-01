// Tela de carregamento instantânea. O Next.js mostra isso automaticamente
// enquanto a página de verdade ainda está buscando os dados no servidor
// (login, lista de contas, grade semanal) — é exatamente a "tela branca"
// que aparecia ao abrir o app pelo ícone da tela de início. Não depende de
// nenhum dado nem de JavaScript rodando no celular: já vem pronta no HTML
// que o servidor manda primeiro, então aparece bem mais rápido que o
// conteúdo real.
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
      <div className="relative flex h-40 w-40 items-center justify-center">
        {/* Anel girando ao redor do logo — efeito clássico de "carregando",
            funciona bem mesmo o ícone tendo fundo branco, já que o anel fica
            por fora dele. */}
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-brand-100 border-t-brand-500" />
        {/* Ícone com fundo transparente — sem moldura (cantos arredondados/
            sombra), pra não aparecer uma "caixa" fantasma ao redor do desenho. */}
        <img
          src="/loading-icon.png"
          alt="Agendador de Stories"
          className="h-28 w-28 animate-pop-in"
        />
      </div>
    </div>
  );
}
