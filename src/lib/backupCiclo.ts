import type { createAdminClient } from "@/lib/supabase/admin";

// Cópia de segurança das imagens do Story Engine: cada arquivo de
// story-media ganha uma cópia no bucket privado story-backup (mesmo caminho).
// Se o original sumir por qualquer motivo, é restaurado de lá.
type Admin = ReturnType<typeof createAdminClient>;

const BUCKET = "story-media";
const BACKUP = "story-backup";

// DESLIGADO por padrão (20/10/2026): as cópias dobraram o uso de Storage e o
// projeto estourou o limite de 1 GB do plano gratuito (Supabase bloqueou tudo).
// Só ligue com BACKUP_CICLO=1 depois de ter espaço de sobra (plano Pro).
const LIGADO = () => process.env.BACKUP_CICLO === "1";

export async function copiarParaBackup(admin: Admin, path: string): Promise<boolean> {
  if (!LIGADO()) return false;
  const { error } = await admin.storage.from(BUCKET).copy(path, path, { destinationBucket: BACKUP });
  return !error;
}

export async function restaurarDoBackup(admin: Admin, path: string): Promise<boolean> {
  const { error } = await admin.storage.from(BACKUP).copy(path, path, { destinationBucket: BUCKET });
  return !error;
}

// Roda a cada 30 min junto da geração: faz as cópias que faltam (poucas por
// vez) e restaura o que tiver sumido e tiver cópia.
export async function manterBackupDoCiclo(admin: Admin): Promise<{ copiados: number; restaurados: number }> {
  let copiados = 0;
  let restaurados = 0;
  if (!LIGADO()) return { copiados, restaurados };
  try {
    const { data: faltam } = await admin.rpc("itens_ciclo_sem_backup", { p_limite: 15 });
    for (const r of (faltam ?? []) as { media_path: string }[]) {
      if (await copiarParaBackup(admin, r.media_path)) copiados++;
    }
    const { data: perdidos } = await admin.rpc("itens_ciclo_para_restaurar", { p_limite: 15 });
    for (const r of (perdidos ?? []) as { media_path: string }[]) {
      if (await restaurarDoBackup(admin, r.media_path)) restaurados++;
    }
  } catch {
    // Backup nunca pode atrapalhar a geração dos Stories.
  }
  return { copiados, restaurados };
}
