// Dias da semana no padrão ISO-8601 usado no banco: 1 = segunda-feira ... 7 = domingo.

export const DIAS_SEMANA: { value: number; label: string; curto: string }[] = [
  { value: 1, label: "Segunda-feira", curto: "Seg" },
  { value: 2, label: "Terça-feira", curto: "Ter" },
  { value: 3, label: "Quarta-feira", curto: "Qua" },
  { value: 4, label: "Quinta-feira", curto: "Qui" },
  { value: 5, label: "Sexta-feira", curto: "Sex" },
  { value: 6, label: "Sábado", curto: "Sáb" },
  { value: 7, label: "Domingo", curto: "Dom" },
];

export function nomeDia(dia: number): string {
  return DIAS_SEMANA.find((d) => d.value === dia)?.label ?? "—";
}

const FUSO = "America/Sao_Paulo";

/** Retorna { diaSemanaIso, horaMinuto } representando "agora" no fuso de São Paulo. */
export function agoraEmSaoPaulo(): { diaSemanaIso: number; horaMinuto: string; dataISO: string } {
  const agora = new Date();

  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);

  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";

  const mapaDia: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  const diaSemanaIso = mapaDia[get("weekday")] ?? 1;
  const hora = get("hour").padStart(2, "0");
  const minuto = get("minute").padStart(2, "0");

  return {
    diaSemanaIso,
    horaMinuto: `${hora}:${minuto}`,
    dataISO: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Converte "HH:MM:SS" ou "HH:MM" pra minutos desde a meia-noite. */
export function paraMinutos(horaMinuto: string): number {
  const [h, m] = horaMinuto.split(":").map(Number);
  return h * 60 + m;
}
