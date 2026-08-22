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
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);

  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";

  const ano = get("year");
  const mes = get("month");
  const dia = get("day");
  const hora = get("hour").padStart(2, "0");
  const minuto = get("minute").padStart(2, "0");

  if (!ano || !mes || !dia || !hora || !minuto) {
    // Antes, se algo aqui desse errado, o código caía num valor padrão
    // (segunda-feira) sem avisar — o que fazia os horários de segunda
    // dispararem em qualquer dia. Agora, se não conseguir determinar a
    // data/hora com segurança, prefere falhar (e não publicar nada nesse
    // ciclo) a arriscar publicar no dia errado.
    throw new Error("Não foi possível determinar a data/hora atual em America/Sao_Paulo.");
  }

  // Calcula o dia da semana a partir dos números (ano/mês/dia), não do nome
  // do dia em texto que o Intl devolveria (ex: "Mon") — isso evita depender
  // de um formato de texto que poderia vir diferente do esperado em algum
  // ambiente e cair no bug acima.
  const dataUtcNeutra = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  const diaSemanaJs = dataUtcNeutra.getUTCDay(); // 0 = domingo ... 6 = sábado
  const diaSemanaIso = diaSemanaJs === 0 ? 7 : diaSemanaJs; // 1 = segunda ... 7 = domingo

  return {
    diaSemanaIso,
    horaMinuto: `${hora}:${minuto}`,
    dataISO: `${ano}-${mes}-${dia}`,
  };
}

/** Converte "HH:MM:SS" ou "HH:MM" pra minutos desde a meia-noite. */
export function paraMinutos(horaMinuto: string): number {
  const [h, m] = horaMinuto.split(":").map(Number);
  return h * 60 + m;
}
