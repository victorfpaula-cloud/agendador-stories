export type MediaType = "IMAGE" | "VIDEO";

export interface Account {
  id: string;
  name: string;
  page_id: string;
  ig_user_id: string;
  ig_username: string | null;
  page_access_token: string;
  token_obtained_at: string;
  is_active: boolean;
  // Cache da foto de perfil (até 30 dias — ver /api/contas/avatares) pra não
  // precisar buscar na Graph API do Meta toda vez que a tela de contas abre.
  avatar_url: string | null;
  avatar_atualizado_em: string | null;
  created_at: string;
}

export interface ScheduleSlot {
  id: string;
  account_id: string;
  day_of_week: number; // 1 = segunda ... 7 = domingo
  time_of_day: string; // "HH:MM:SS"
  media_url: string;
  media_path: string;
  media_type: MediaType;
  // Miniatura pequena (data URL, gerada no navegador — ver gerarThumbnail em
  // thumbnail.ts), usada como preview na grade da semana. Diferente do
  // módulo de Publicações, aqui o arquivo original NUNCA é apagado (o mesmo
  // Story se repete toda semana, no ciclo recorrente), então a miniatura é
  // só pra evitar carregar o arquivo inteiro à toa — não substitui o
  // original. Pode ser null (arquivo enviado antes dessa miniatura existir,
  // ou geração falhou) — nesse caso a tela cai pro arquivo original mesmo.
  thumbnail_data_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PublishLog {
  id: string;
  slot_id: string | null;
  account_id: string | null;
  scheduled_for: string;
  // "publishing" é só um estado transitório enquanto o cron reivindica o
  // horário antes de publicar (ver reivindicar_publicacao no banco e
  // /api/cron/run) — nunca deveria ficar assim por muito tempo nem aparecer
  // pra quem lê essa tabela depois, mas o tipo existe porque a coluna aceita.
  status: "success" | "error" | "publishing";
  ig_media_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PendingConnectionPage {
  page_id: string;
  name: string;
  ig_user_id: string;
  ig_username: string | null;
  page_access_token: string;
}

// ---------- Publicações no Feed/Reels (módulo novo, separado dos Stories) ----------

export type FeedMediaType = "IMAGE" | "VIDEO" | "CAROUSEL" | "REELS";
export type FeedPostStatus = "pending" | "publishing" | "success" | "error";
export type FeedPostSource = "manual" | "drive";
export type FeedPostAccountStatus = "pending" | "success" | "error";

export interface FeedPost {
  id: string;
  caption: string;
  scheduled_at: string; // timestamptz ISO
  media_type: FeedMediaType;
  share_to_feed: boolean; // só relevante pra REELS
  source: FeedPostSource;
  status: FeedPostStatus;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}

// Uma mídia do post — 1 linha se for foto/vídeo/reels avulso, várias (position
// 0, 1, 2...) se for carrossel.
export interface FeedPostMedia {
  id: string;
  feed_post_id: string;
  position: number;
  // media_url/media_path apontam pro arquivo original no Storage — só
  // existem até o post publicar com sucesso; depois disso o arquivo é
  // apagado e esses dois campos ficam null (ver /api/cron/publicar-feed). A
  // miniatura abaixo é a única coisa que sobra pra representar o post dali
  // em diante.
  media_url: string | null;
  media_path: string | null;
  media_type: MediaType;
  // Miniatura pequena (ou null se não foi possível gerar) — guardada como
  // data URL (texto) direto no banco, não como arquivo no Storage. Gerada
  // no navegador pro fluxo manual (gerarThumbnail, thumbnail.ts) ou pelo
  // próprio Google Drive pro fluxo automático (baixarThumbnailDrive,
  // drive.ts). É a ÚNICA coisa que a tela de Publicações usa pra desenhar o
  // preview — nunca cai pro arquivo original, pra não gastar egress do
  // Storage à toa (ver MiniaturaMidia em PublicacoesClient.tsx). Some
  // sozinha ~30 dias após a publicação (ver supabase/thumbnails.sql).
  thumbnail_data_url: string | null;
  created_at: string;
}

// Em qual conta esse post vai (ou já foi) publicado — status individual, pois
// o mesmo post pode ir pra várias contas e cada uma pode ter um resultado diferente.
export interface FeedPostAccount {
  id: string;
  feed_post_id: string;
  account_id: string;
  status: FeedPostAccountStatus;
  ig_media_id: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}

// Formato "com detalhes" usado na tela: o post já vem com a(s) mídia(s) e a(s)
// conta(s)-alvo (com o nome da conta) embutidas, pra não precisar de consultas
// extras pra montar a lista.
export interface FeedPostComDetalhes extends FeedPost {
  feed_post_media: FeedPostMedia[];
  feed_post_accounts: (FeedPostAccount & { accounts: Pick<Account, "id" | "name" | "ig_username"> })[];
}

// Configuração do sub-módulo do Drive (passo 6) — uma linha por conta
// (account_id é a chave primária, ver supabase/drive_config-por-conta.sql).
// Editável pela tela de Publicações > Drive de cada conta, sem precisar
// mexer em código quando a pasta ou o horário mudar.
export interface DriveConfig {
  account_id: string;
  pasta_drive_id: string | null;
  horario_publicacao: string; // "HH:MM:SS"
  updated_at: string;
}

// Um registro do que aconteceu na última vez (ou nas últimas vezes) que o
// cron diário do Drive rodou (passo 7) — pra Victor conseguir ver o
// resultado direto na telinha de configuração, sem precisar olhar log
// nenhum da Vercel. account_id fica null em registros antigos, de antes da
// automação virar por conta.
export type DriveExecucaoResultado = "sem_config" | "sem_pasta" | "ja_existe" | "post_criado" | "erro";

export interface DriveExecucao {
  id: string;
  executado_em: string;
  resultado: DriveExecucaoResultado;
  detalhe: string | null;
  feed_post_id: string | null;
  account_id: string | null;
  created_at: string;
}

// ---------- Story Automático via Drive (sub-módulo irmão do de cima, mas pra Stories) ----------
// Sem carrossel (Instagram não tem isso pra Story) e sem legenda — até 5
// arquivos por dia, cada um com seu próprio horário (horario_1..horario_5).
// Em branco = esse arquivo não publica, mesmo que exista (ver
// supabase/story-drive-automation.sql).
export interface StoryDriveConfig {
  account_id: string;
  pasta_drive_id: string | null;
  horario_1: string | null; // "HH:MM:SS"
  horario_2: string | null;
  horario_3: string | null;
  horario_4: string | null;
  horario_5: string | null;
  updated_at: string;
}

export type StoryDriveExecucaoResultado =
  | "sem_config"
  | "sem_pasta"
  | "sem_horario"
  | "ja_existe"
  | "stories_criados"
  | "erro";

export interface StoryDriveExecucao {
  id: string;
  account_id: string | null;
  executado_em: string;
  resultado: StoryDriveExecucaoResultado;
  detalhe: string | null;
  created_at: string;
}

export type StoryPostStatus = "pending" | "publishing" | "success" | "error";

// Um Story criado automaticamente a partir do Drive — cada linha é uma
// publicação de Story independente (nunca agrupada em carrossel).
export interface StoryPost {
  id: string;
  account_id: string;
  scheduled_at: string;
  media_url: string | null;
  media_path: string | null;
  media_type: MediaType;
  thumbnail_data_url: string | null;
  source: "drive";
  status: StoryPostStatus;
  ig_media_id: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}
