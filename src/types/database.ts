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
  // Quantas vezes já tentou publicar esse horário hoje — só manda e-mail de
  // erro depois de esgotar (ver LIMITE_TENTATIVAS em /api/cron/run).
  tentativas: number;
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
  // Quantas vezes já tentou publicar nessa conta — só marca "error" (e
  // entra no e-mail) depois de esgotar (ver LIMITE_TENTATIVAS em
  // /api/cron/publicar-feed).
  tentativas: number;
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
// Sem carrossel (Instagram não tem isso pra Story) e sem legenda. Desde
// 17/09/2026 não guarda mais horário nenhum aqui — cada arquivo do Drive
// carrega o seu próprio horário embutido no nome (que vem do assunto do
// e-mail que o Google Apps Script processa), ver
// src/lib/storyDriveIngestao.ts e supabase/story-drive-horario-do-assunto.sql.
export interface StoryDriveConfig {
  account_id: string;
  pasta_drive_id: string | null;
  updated_at: string;
}

export type StoryDriveExecucaoResultado = "sem_config" | "sem_pasta" | "ja_existe" | "stories_criados" | "erro";

export interface StoryDriveExecucao {
  id: string;
  account_id: string | null;
  executado_em: string;
  resultado: StoryDriveExecucaoResultado;
  detalhe: string | null;
  created_at: string;
}

// ---------- Story Engine (banco de imagens por categoria, gira sem repetir) ----------
// Módulo isolado de AutoFeed/AutoStory — pedido explícito do Victor pra não
// misturar por baixo dos panos. Cada categoria já é o "slot": tem nome,
// dias da semana ativos, uma lista de horários e uma galeria de
// imagens/vídeos que o robô escolhe (sempre a que está há mais tempo sem
// uso — ver função gerar_story_ciclo no banco) sem nunca precisar de reset.
export interface StoryCicloCategoria {
  id: string;
  account_id: string;
  nome: string;
  dias_semana: number[]; // 1 = segunda ... 7 = domingo
  // Chave de ligar/desligar — pausa sem apagar nada (horários, imagens e o
  // "usado_em" de cada item ficam intactos pra quando reativar).
  ativa: boolean;
  created_at: string;
}

export interface StoryCicloHorario {
  id: string;
  category_id: string;
  horario: string; // "HH:MM:SS"
  is_active: boolean;
  created_at: string;
}

// Um item do "balde" de uma categoria. usado_em nulo = nunca publicado
// ainda; preenchido = a última vez que foi escolhido pra publicar.
export interface StoryCicloItem {
  id: string;
  category_id: string;
  media_url: string;
  media_path: string;
  media_type: MediaType;
  thumbnail_data_url: string | null;
  usado_em: string | null;
  created_at: string;
}

export type StoryCicloPostStatus = "pending" | "publishing" | "success" | "error";

export interface StoryCicloPost {
  id: string;
  account_id: string;
  category_id: string;
  horario_id: string | null;
  item_id: string | null;
  dia: string; // "AAAA-MM-DD"
  scheduled_at: string;
  media_url: string | null;
  media_path: string | null;
  media_type: MediaType;
  thumbnail_data_url: string | null;
  status: StoryCicloPostStatus;
  ig_media_id: string | null;
  error_message: string | null;
  // Quantas vezes já tentou publicar esse Story — só marca "error" (e
  // manda e-mail) depois de esgotar (ver LIMITE_TENTATIVAS em
  // /api/cron/publicar-stories-ciclo).
  tentativas: number;
  published_at: string | null;
  created_at: string;
}

export type StoryPostStatus = "pending" | "publishing" | "success" | "error";

// Um Story criado automaticamente a partir do Drive — cada linha é uma
// publicação de Story independente (nunca agrupada em carrossel). `dia` é
// sempre preenchido (o dia da pasta do Drive lida); `scheduled_at` só depois
// que um horário existir — automático (nome do arquivo) ou definido à mão
// por Victor na lista de "Stories de hoje" quando vem faltando (status vira
// "error" nesse caso até ele preencher). `drive_file_id` identifica o
// arquivo de origem no Drive, pra nunca duplicar o mesmo arquivo processado
// de novo (ver índice único em story_posts_account_drive_file_unique).
export interface StoryPost {
  id: string;
  account_id: string;
  dia: string; // "AAAA-MM-DD"
  scheduled_at: string | null;
  drive_file_id: string | null;
  media_url: string | null;
  media_path: string | null;
  media_type: MediaType;
  thumbnail_data_url: string | null;
  source: "drive";
  status: StoryPostStatus;
  ig_media_id: string | null;
  error_message: string | null;
  // Quantas vezes já tentou publicar esse Story — só marca "error" (e
  // manda e-mail) depois de esgotar (ver LIMITE_TENTATIVAS em
  // /api/cron/publicar-stories-drive).
  tentativas: number;
  published_at: string | null;
  created_at: string;
}
