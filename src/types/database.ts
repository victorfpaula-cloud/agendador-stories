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
  is_active: boolean;
  created_at: string;
}

export interface PublishLog {
  id: string;
  slot_id: string | null;
  account_id: string | null;
  scheduled_for: string;
  status: "success" | "error";
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
  // media_url/media_path apontam pro arquivo original no Storage — continuam
  // existindo mesmo depois do post publicar (é o que a tela mostra até virar
  // um post "antigo"). Somem quando a publicação é apagada, seja manualmente
  // ou pela limpeza automática que mantém só os últimos 15 posts publicados
  // (ver podarPublicacoesAntigas em /api/cron/publicar-feed).
  media_url: string | null;
  media_path: string | null;
  media_type: MediaType;
  // Miniatura pequena, gerada no navegador (ou null se não foi possível
  // gerar) — guardada como data URL (texto) direto no banco, não como
  // arquivo no Storage. É o que a tela mostra depois que o original é
  // apagado, e some sozinha ~30 dias após a publicação (ver
  // supabase/thumbnails.sql).
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

// Configuração do sub-módulo do Drive (passo 6) — linha única (id sempre 1).
// Editável pela tela, sem precisar mexer em código quando a pasta ou o
// horário mudar. account_ids é a lista de contas-alvo do post automático do
// dia (na prática, só as contas da Dona Baunilha).
export interface DriveConfig {
  id: number;
  pasta_drive_id: string | null;
  horario_publicacao: string; // "HH:MM:SS"
  account_ids: string[];
  updated_at: string;
}

// Um registro do que aconteceu na última vez (ou nas últimas vezes) que o
// cron diário do Drive rodou (passo 7) — pra Victor conseguir ver o
// resultado direto na telinha de configuração, sem precisar olhar log
// nenhum da Vercel.
export type DriveExecucaoResultado = "sem_config" | "sem_pasta" | "ja_existe" | "post_criado" | "erro";

export interface DriveExecucao {
  id: string;
  executado_em: string;
  resultado: DriveExecucaoResultado;
  detalhe: string | null;
  feed_post_id: string | null;
  created_at: string;
}
