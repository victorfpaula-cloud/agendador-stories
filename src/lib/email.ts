// Envio de e-mail via Resend (REST API pura, sem SDK — mesmo estilo já
// usado no projeto pra falar com o Meta e o Google Drive, ver meta.ts e
// drive.ts). Usado só pra avisar quando uma publicação (Story ou Feed)
// falha, pra dar tempo de publicar manualmente.
//
// Nunca lança erro: se as variáveis de ambiente não estiverem configuradas
// (RESEND_API_KEY / ALERT_EMAIL), ou o envio falhar por qualquer motivo,
// quem chama segue normalmente — um aviso que não chegou nunca pode ser
// motivo pra travar ou confundir o status de uma publicação real.
const RESEND_API_URL = "https://api.resend.com/emails";

export async function enviarEmail({ assunto, corpo }: { assunto: string; corpo: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const destinatario = process.env.ALERT_EMAIL;

  if (!apiKey || !destinatario) return;

  try {
    await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Remetente padrão do Resend — funciona sem precisar configurar
        // domínio próprio nenhum, é suficiente pra mandar um aviso pra você
        // mesmo.
        from: "Agendador de Stories <onboarding@resend.dev>",
        to: [destinatario],
        subject: assunto,
        text: corpo,
      }),
      cache: "no-store",
    });
  } catch {
    // Ignorado de propósito — ver comentário no topo do arquivo.
  }
}
