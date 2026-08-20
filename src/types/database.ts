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
